"use strict";
/* meta-styles Milestone 19d — turn-loop tests.
 *
 * Fifth step of the M19 chat-first pivot (docs/milestone-19-chat-first-pivot.md
 * §2, §7 task 5): app/turn-loop.js wires triggers → extract-and-catalog on
 * photo shares → Spark propose (drawing on previously catalogued pieces, not
 * just the new share) → UNCHANGED assembleLook validate → in-thread
 * revise-or-flag replies; fabric/price answers gated on §8.4 (plain no-data,
 * never invented).
 *
 * Verifies every acceptance criterion:
 *   1. one photo yields ≥1 valid:true card via chat AND a catalogued
 *      piece record (incl. a real POST /ig/send of the reply via the
 *      19b send-client against the mock bot — the "via chat" proof);
 *   2. an invalid proposal surfaces its reasons[] in-thread;
 *   3. "no bag" revises and re-validates;
 *   4. cross-piece mix-match across two photo shares (for 19g): a second
 *      photo turn proposes a look combining a piece from share 1 with a
 *      piece from share 2 and cites both;
 *   5. fabric/price questions get an honest no-data answer (§8.4).
 *
 * Calls the REAL 19c/19e-adjacent modules (wardrobe-catalog, assembler,
 * spark, send-client, mock bot) — never re-implementations. All ids/text
 * synthetic (SYNTH_ prefix, example.invalid URLs) — never real data.
 *
 * Run: node app/test/milestone19d-turn-loop.test.js
 */

const assert = require("node:assert/strict");

// Sandbox sets an HTTP proxy; the mock is local-only, so bypass it here.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const Catalog = require("../wardrobe-catalog.js");
const Assembler = require("../assembler.js");
const Spark = require("../spark.js");
const SendClient = require("../send-client.js");
const TurnLoop = require("../turn-loop.js");
const { startServer } = require("../../mock-ig-bot/server.js");

const TOKEN = "SYNTH_mock_token";

let server;
let store;
let base;
let failures = 0;
let passes = 0;

function check(name, cond, detail) {
  if (cond) {
    passes++;
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

function freshLoop(userKey) {
  return TurnLoop.createTurnLoop({
    userKey,
    catalog: Catalog.createCatalog({ userKey }),
    validate: Assembler.assembleLook,
    copy: Spark.generateCopy,
  });
}

function photo(shareId, receivedAt) {
  return { shareId, receivedAt: receivedAt || "2026-10-29T12:00:00Z" };
}

// IG-specific + descoped-inventory keys must never appear on any record
// (same banned lists as milestone19c-wardrobe-catalog.test.js).
const BANNED_IG_KEYS = [
  "igsid", "sender_igsid", "ig_id", "ig_user_id",
  "recipient_ref", "mid", "graph_api", "ig_webhook_id",
];
const BANNED_INVENTORY_KEYS = [
  "fabric", "price", "vendor", "vendor_id", "listing", "listing_id", "cost",
];

function collectKeys(value, out) {
  if (Array.isArray(value)) {
    value.forEach((v) => collectKeys(v, out));
  } else if (value && typeof value === "object") {
    Object.keys(value).forEach((k) => {
      out.push(k);
      collectKeys(value[k], out);
    });
  }
  return out;
}

async function main() {
  check("19d: turn-loop module exposes the M19d contract",
    !!(TurnLoop && typeof TurnLoop.createTurnLoop === "function" &&
      typeof TurnLoop.isGroundingQuestion === "function" &&
      typeof TurnLoop.matchReviseCategory === "function" &&
      typeof TurnLoop.NO_DATA_LEAD === "string"));

  // --- 1. One photo -> ≥1 valid:true card via chat + catalog record -----
  const loopA = freshLoop("SYNTH_user_19d_A");
  const shareA = "SYNTH_mid_19d_A1";
  const rA = loopA.handlePhotoShare(photo(shareA), [
    { category: "base/top", attributes: { color: "lilac", silhouette: "cami" } },
    { category: "layer/cardigan", attributes: { color: "cream", layer_role: "open layer" } },
  ]);
  const validCardsA = rA.looks.filter((l) => l.card.valid);
  check("19d: one photo yields ≥1 valid:true card",
    validCardsA.length >= 1 && rA.best.card.valid === true,
    `got ${validCardsA.length} valid of ${rA.looks.length}`);
  const piecesA = loopA.catalog.getActivePieces();
  check("19d: one photo catalogues its piece records",
    piecesA.length === 2 &&
    piecesA.every((p) => p.source_share_id === shareA) &&
    piecesA.some((p) => p.category === "base/top") &&
    piecesA.some((p) => p.category === "layer/cardigan"),
    JSON.stringify(piecesA.map((p) => p.category)));
  check("19d: photo-turn reply cites the source share + both piece ids",
    rA.text.indexOf(shareA) !== -1 &&
    piecesA.every((p) => rA.text.indexOf(p.piece_id) !== -1),
    rA.text.slice(0, 160));
  const turnsA = loopA.catalog.getTurns();
  check("19d: photo turn records a verdict:true turn",
    turnsA.length === 1 && turnsA[0].verdict === true &&
    Array.isArray(turnsA[0].proposal.pieces) && turnsA[0].proposal.pieces.length >= 2,
    JSON.stringify(turnsA).slice(0, 160));

  // "Via chat": the reply text goes out as one turn through the real
  // 19b send-client against the mock bot.
  ({ server, store } = await startServer({ port: 0, token: TOKEN }));
  base = `http://127.0.0.1:${server.address().port}`;
  store.shares.push({
    id: shareA,
    received_at: new Date().toISOString(),
    attachment: { type: "image", payload: { url: "https://example.invalid/synth-media/SYNTH_19d_A.png" } },
    media_id: "SYNTH_media_19d_A1",
    media_available: true,
  });
  const client = SendClient.createSendClient({ base, token: TOKEN });
  const sent = await client.sendTurn({ shareId: shareA, text: rA.text });
  check("19d: photo-turn reply sends via chat (send-client -> mock 200)",
    sent.ok === true && sent.status === 200 && typeof sent.body.message_id === "string" &&
    SendClient.describeForThread(sent).indexOf("Sent") === 0,
    `${sent.status} ${JSON.stringify(sent.body).slice(0, 120)}`);

  // --- 2. Invalid proposal surfaces its reasons[] in-thread --------------
  const loopB = freshLoop("SYNTH_user_19d_B");
  const shareB = "SYNTH_mid_19d_B1";
  const rB = loopB.handlePhotoShare(photo(shareB), [
    { category: "scarf", attributes: { color: "opal" } },
  ]);
  check("19d: lone-scarf proposal validates invalid with reasons",
    rB.best.card.valid === false && rB.best.card.reasons.length > 0,
    JSON.stringify(rB.best.card.reasons).slice(0, 160));
  check("19d: invalid reasons surface verbatim in-thread",
    rB.best.card.reasons.every((r) => rB.text.indexOf(r) !== -1),
    rB.text.slice(0, 200));
  const turnsB = loopB.catalog.getTurns();
  check("19d: invalid turn records verdict:false + reasons[]",
    turnsB.length === 1 && turnsB[0].verdict === false &&
    turnsB[0].reasons.length > 0,
    JSON.stringify(turnsB).slice(0, 160));

  // --- 3. "no bag" revises and re-validates -------------------------------
  const loopC = freshLoop("SYNTH_user_19d_C");
  const shareC = "SYNTH_mid_19d_C1";
  const rC1 = loopC.handlePhotoShare(photo(shareC), [
    { category: "base/top", attributes: { color: "lilac" } },
    { category: "scarf", attributes: { color: "opal" } },
    { category: "bag", attributes: { color: "silver" } },
  ]);
  check("19d: base + scarf + bag starts valid (scarf+bag finish)",
    rC1.best.card.valid === true && rC1.best.card.finish === "scarf+bag",
    rC1.best.card.finish || "none");
  const bagId = loopC.catalog.getActivePieces()
    .filter((p) => p.category === "bag").map((p) => p.piece_id)[0];
  const rC2 = loopC.handleTextTurn("SYNTH no bag");
  const bagNow = loopC.catalog.getPiece(bagId);
  check("19d: 'no bag' rejects the bag piece (history kept, not deleted)",
    rC2.revised === true && bagNow !== null && bagNow.status === "rejected",
    bagNow ? bagNow.status : "missing");
  const turnsC = loopC.catalog.getTurns();
  const lastC = turnsC[turnsC.length - 1];
  check("19d: revise turn re-validates (new verdict:false + reasons[])",
    turnsC.length === 2 && lastC.verdict === false && lastC.reasons.length > 0,
    JSON.stringify(lastC).slice(0, 200));
  check("19d: revised reply names the removal and the re-check reason",
    rC2.text.indexOf(bagId) !== -1 &&
    /bag partner/i.test(rC2.text),
    rC2.text.slice(0, 220));

  // --- 4. Cross-piece mix-match across two photo shares (for 19g) --------
  const loopD = freshLoop("SYNTH_user_19d_D");
  const shareD1 = "SYNTH_mid_19d_D1";
  const shareD2 = "SYNTH_mid_19d_D2";
  loopD.handlePhotoShare(photo(shareD1, "2026-10-29T12:00:00Z"), [
    { category: "dress", attributes: { color: "sage", silhouette: "wrap" } },
  ]);
  const dressId = loopD.catalog.getActivePieces()[0].piece_id;
  const rD2 = loopD.handlePhotoShare(photo(shareD2, "2026-10-29T12:05:00Z"), [
    { category: "layer/blazer", attributes: { color: "charcoal" } },
  ]);
  const blazerId = loopD.catalog.getActivePieces()
    .filter((p) => p.category === "layer/blazer").map((p) => p.piece_id)[0];
  check("19d: second photo turn combines share-1 + share-2 pieces",
    rD2.best.pieceIds.indexOf(dressId) !== -1 &&
    rD2.best.pieceIds.indexOf(blazerId) !== -1,
    JSON.stringify(rD2.best.pieceIds));
  check("19d: mix-match reply cites BOTH source shares",
    rD2.text.indexOf(shareD1) !== -1 && rD2.text.indexOf(shareD2) !== -1,
    rD2.text.slice(0, 220));
  check("19d: cross-piece look validates valid (base + layer finish)",
    rD2.best.card.valid === true && rD2.best.card.finish === "layer",
    `valid=${rD2.best.card.valid} finish=${rD2.best.card.finish}`);

  // --- 5. Fabric/price questions: plain no-data, never invented (§8.4) ---
  const loopE = freshLoop("SYNTH_user_19d_E");
  loopE.handlePhotoShare(photo("SYNTH_mid_19d_E1"), [
    { category: "dress", attributes: { color: "sage" } },
  ]);
  const rE1 = loopE.handleTextTurn("SYNTH show fabric");
  const rE2 = loopE.handleTextTurn("SYNTH cheaper option?");
  for (const [label, r] of [["fabric", rE1], ["price", rE2]]) {
    check(`19d: ${label} question answered with plain no-data (§8.4)`,
      r.noData === true && /don't have that data/i.test(r.text),
      r.text.slice(0, 160));
    check(`19d: ${label} answer invents no listing`,
      r.text.indexOf("$") === -1 &&
      r.text.indexOf(TurnLoop.NO_DATA_LEAD) !== -1 &&
      !/in stock|ships in|silk|cotton|linen|wool|cashmere/i.test(r.text),
      r.text.slice(0, 200));
  }
  const turnsE = loopE.catalog.getTurns();
  check("19d: no-data turns recorded with proposal:null + no_grounding_data",
    turnsE.length === 3 &&
    turnsE[1].proposal === null && turnsE[2].proposal === null &&
    turnsE[1].reasons.join() === "no_grounding_data",
    JSON.stringify(turnsE.map((t) => t.reasons)).slice(0, 120));

  // --- 6. Schema hygiene: no IG / inventory fields anywhere ---------------
  for (const [label, loop] of [["A", loopA], ["C", loopC], ["D", loopD], ["E", loopE]]) {
    const keys = collectKeys(loop.catalog.toJSON(), []).map((k) => k.toLowerCase());
    const igHit = keys.find((k) => BANNED_IG_KEYS.indexOf(k) !== -1);
    const invHit = keys.find((k) => BANNED_INVENTORY_KEYS.indexOf(k) !== -1);
    check(`19d: catalog ${label} carries no IG fields and no fabric/price/vendor fields`,
      igHit === undefined && invHit === undefined,
      igHit || invHit || "");
  }

  console.log(`\n${passes} passed, ${failures} failed.`);
  server.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  if (server) server.close();
  process.exit(1);
});
