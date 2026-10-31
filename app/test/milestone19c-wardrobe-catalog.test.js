"use strict";
/* meta-styles Milestone 19c — user-keyed wardrobe catalog module tests.
 *
 * Third step of the M19 chat-first pivot (docs/milestone-19-chat-first-pivot.md
 * §3, §7 task 3): app/wardrobe-catalog.js owns "this user's wardrobe +
 * what we have discussed with them" — piece records per the §3 schema,
 * turn history (turns, proposals, assembleLook verdicts + reasons[],
 * pending questions), and the own-sent-turn log (Gap 4). The user key
 * is an injected parameter (single-user assumption until §8.9 resolves);
 * the M11 bot-side contract is a sketch/comment only, never built here.
 *
 * Verifies: multi-share accumulation across two photos, reject-then-
 * revise flagging, user-anchored window flagging, and a structural
 * schema-shape assertion (no IG-specific fields, no fabric/price/
 * vendor fields — enforced by the module fail-closed, asserted here).
 *
 * All ids/text below are synthetic (SYNTH_ prefix, example.invalid
 * URLs) — never real Instagram data.
 *
 * Run: node app/test/milestone19c-wardrobe-catalog.test.js
 */

const assert = require("node:assert/strict");

const Catalog = require("../wardrobe-catalog.js");

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

function throwsWith(fn, re) {
  try {
    fn();
  } catch (err) {
    return re.test(String((err && err.message) || err));
  }
  return false;
}

// IG-specific field names must never appear on any record (exact key
// match, case-insensitive — "mid" must not fuzzy-match innocent keys).
const BANNED_IG_KEYS = [
  "igsid", "sender_igsid", "ig_id", "ig_user_id",
  "recipient_ref", "mid", "graph_api", "ig_webhook_id",
];
// Descoped per §8.4 — the agent says it has no such data, never stores it.
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

function scanRecords(label, records) {
  const keys = collectKeys(records, []).map((k) => k.toLowerCase());
  const igHit = keys.find((k) => BANNED_IG_KEYS.indexOf(k) !== -1);
  check(`${label}: no IG-specific field on any record`,
    igHit === undefined, igHit ? `banned key '${igHit}' present` : "");
  const invHit = keys.find((k) => BANNED_INVENTORY_KEYS.indexOf(k) !== -1);
  check(`${label}: no fabric/price/vendor field on any record (§8.4 descoped)`,
    invHit === undefined, invHit ? `banned key '${invHit}' present` : "");
}

function main() {
  check("19c: wardrobe-catalog module exposes the M19c contract",
    !!(Catalog && typeof Catalog.createCatalog === "function" &&
      Array.isArray(Catalog.TAXONOMY) && Array.isArray(Catalog.PIECE_KEYS) &&
      Array.isArray(Catalog.ATTRIBUTE_KEYS) && Array.isArray(Catalog.TURN_KEYS) &&
      typeof Catalog.REPLY_WINDOW_MS === "number"));

  // --- User key is injected, never hardcoded ------------------------------
  check("19c: createCatalog throws without an injected user key",
    throwsWith(() => Catalog.createCatalog(), /user key is required/) &&
    throwsWith(() => Catalog.createCatalog({ userKey: "" }), /user key is required/));
  const wardrobe = Catalog.createCatalog({ userKey: "SYNTH_user_001" });
  check("19c: catalog carries the injected user key",
    wardrobe.userKey === "SYNTH_user_001", wardrobe.userKey);

  // --- Multi-share accumulation across TWO photos, same user ---------------
  const pieceA = wardrobe.addPiece({
    category: "base/top",
    attributes: { color: "washed lilac", silhouette: "cami", layer_role: "base" },
    source_share_id: "SYNTH_share_photo_1",
  });
  check("19c: photo 1 catalogues a piece with an app-assigned SYNTH_ id",
    /^SYNTH_piece_/.test(pieceA.piece_id) && pieceA.status === "active",
    JSON.stringify(pieceA));
  check("19c: piece record carries exactly the §3 field names (incl. optional photo_thumb)",
    JSON.stringify(Object.keys(pieceA).sort()) ===
    JSON.stringify(["added_at", "attributes", "category", "copy_preview_keys", "photo_thumb", "image_original", "held_until", "crop_hash", "piece_id", "source_share_id", "status"].sort()) &&
    pieceA.photo_thumb === null && pieceA.image_original === null,
    Object.keys(pieceA).join(","));
  const pieceB = wardrobe.addPiece({
    category: "bag",
    attributes: { color: "silver", silhouette: "mini shoulder", layer_role: "finish" },
    source_share_id: "SYNTH_share_photo_2",
  });
  check("19c: photo 2 accumulates a second piece for the SAME user key",
    wardrobe.getPieces().length === 2 && pieceA.piece_id !== pieceB.piece_id,
    `${pieceA.piece_id} vs ${pieceB.piece_id}`);
  check("19c: both pieces stay queryable together (multi-share recall)",
    wardrobe.getPiece(pieceA.piece_id) !== null &&
    wardrobe.getPiece(pieceB.piece_id) !== null &&
    wardrobe.getActivePieces().length === 2);
  check("19c: pieces cite distinct source shares (provenance, not identity)",
    wardrobe.getPiece(pieceA.piece_id).source_share_id === "SYNTH_share_photo_1" &&
    wardrobe.getPiece(pieceB.piece_id).source_share_id === "SYNTH_share_photo_2");
  const keyed = wardrobe.setCopyPreviewKeys(pieceA.piece_id, {
    copy: "SYNTH_copykey_A", preview: "SYNTH_previewkey_A",
  });
  check("19c: copy/preview cache keys stored so repeats avoid re-calling the proxy",
    keyed.copy_preview_keys.copy === "SYNTH_copykey_A" &&
    keyed.copy_preview_keys.preview === "SYNTH_previewkey_A",
    JSON.stringify(keyed.copy_preview_keys));

  // --- Reject-then-revise flagging (never delete history) ------------------
  const countBefore = wardrobe.getPieces().length;
  const rejected = wardrobe.rejectPiece(pieceB.piece_id);
  const t1 = wardrobe.recordTurn({
    userText: "SYNTH no bag",
    proposal: { pieces: [pieceA.piece_id, pieceB.piece_id], title: "SYNTH look v1" },
    verdict: { valid: false },
    reasons: ["SYNTH bag finish conflicts with the requested removal — re-proposing without it"],
  });
  check("19c: rejection flips status to 'rejected', never deletes the record",
    rejected.status === "rejected" && wardrobe.getPieces().length === countBefore &&
    wardrobe.getPiece(pieceB.piece_id) !== null,
    `status=${rejected.status} count=${wardrobe.getPieces().length}`);
  check("19c: rejected piece leaves the active pool but stays in history",
    wardrobe.getActivePieces().length === countBefore - 1 &&
    wardrobe.getPieces({ status: "rejected" }).length === 1);
  check("19c: rejection turn recorded as {turn, userText, proposal, verdict, reasons[]}",
    t1.turn === 1 && t1.userText === "SYNTH no bag" && t1.verdict === false &&
    Array.isArray(t1.reasons) && t1.reasons.length === 1,
    JSON.stringify(t1));
  const pieceC = wardrobe.addPiece({
    category: "scarf",
    attributes: { color: "opal", silhouette: "neck wrap", layer_role: "finish" },
    source_share_id: "SYNTH_share_photo_2",
  });
  const superseded = wardrobe.markSuperseded(pieceB.piece_id, pieceC.piece_id);
  const t2 = wardrobe.recordTurn({
    userText: "SYNTH yes, the scarf instead",
    proposal: { pieces: [pieceA.piece_id, pieceC.piece_id], title: "SYNTH look v2" },
    verdict: true,
    reasons: [],
  });
  check("19c: revised piece recorded; old proposal piece flagged 'superseded' (history kept)",
    superseded.status === "superseded" && pieceC.status === "active" &&
    wardrobe.getPieces().length === countBefore + 1,
    `old=${superseded.status} new=${pieceC.piece_id}`);
  check("19c: accepted revision recorded as a new turn with verdict true",
    t2.turn === 2 && t2.verdict === true && wardrobe.getTurns().length === 2,
    JSON.stringify({ turn: t2.turn, verdict: t2.verdict }));

  // --- Own-sent-turn log (Gap 4) + pending questions ------------------------
  const sent1 = wardrobe.recordSentTurn({
    text: "SYNTH catalogued your lilac cami — want a look with it?",
    in_reply_to_share: "SYNTH_share_photo_1",
  });
  check("19c: own sent turn logged locally (no live outbound route to read back)",
    sent1.seq === 1 && wardrobe.getSentTurns().length === 1 &&
    wardrobe.getSentTurns()[0].text === sent1.text);
  const q = wardrobe.askQuestion("SYNTH add the opal scarf as the finish?");
  check("19c: clarifying question pends until resolved",
    wardrobe.getPendingQuestions().length === 1 && q.resolved === false);
  wardrobe.resolveQuestion(q.id);
  check("19c: resolved question leaves the pending list",
    wardrobe.getPendingQuestions().length === 0);
  const hist = wardrobe.historyForPrompt();
  check("19c: historyForPrompt is keyed by the injected user key (recall input)",
    hist.user_key === "SYNTH_user_001" &&
    hist.pieces.length === 2 && hist.turns.length === 2,
    `pieces=${hist.pieces.length} turns=${hist.turns.length}`);

  // --- User-anchored window flagging (Gap 3: user-anchored, not share-id) ---
  const other = Catalog.createCatalog({ userKey: "SYNTH_user_002" });
  other.addPiece({
    category: "dress",
    attributes: { color: "sage", silhouette: "wrap midi", layer_role: "base" },
    // Same share id, different user: linkage must NOT leak across wardrobes.
    source_share_id: "SYNTH_share_photo_1",
  });
  check("19c: history ties to the injected user key, not the share id (isolation)",
    wardrobe.getPieces().length === 3 && other.getPieces().length === 1 &&
    other.getPieces()[0].category === "dress" &&
    wardrobe.getPieces().every((p) => p.category !== "dress"));
  const t0 = Date.parse("2026-10-29T12:00:00.000Z");
  wardrobe.noteInboundShare({ shareId: "SYNTH_share_photo_1", receivedAt: "2026-10-29T12:00:00.000Z" });
  wardrobe.noteInboundShare({ shareId: "SYNTH_share_photo_2", receivedAt: "2026-10-29T13:00:00.000Z" });
  const open = wardrobe.replyWindowStatus(new Date(t0 + 3600 * 1000).toISOString());
  check("19c: window open within 24h of the user's latest inbound (user-anchored)",
    open.open === true && open.anchored === "user" &&
    open.latest_inbound_at === "2026-10-29T13:00:00.000Z",
    JSON.stringify(open));
  const stale = wardrobe.replyWindowStatus(new Date(t0 + 25 * 3600 * 1000).toISOString());
  check("19c: stale user reads 422-honest (window expired, anchored to latest inbound)",
    stale.open === false && stale.reason === "reply_window_expired",
    JSON.stringify(stale));
  const noInbound = other.replyWindowStatus(new Date(t0 + 3600 * 1000).toISOString());
  check("19c: a user with no inbound of their own reads closed (never borrowed)",
    noInbound.open === false && noInbound.reason === "no_inbound_yet",
    JSON.stringify(noInbound));

  // --- Schema-shape assertions (structural, not by promise) ------------------
  scanRecords("19c: piece records", wardrobe.getPieces());
  scanRecords("19c: turn records", wardrobe.getTurns());
  scanRecords("19c: sent-turn + question records",
    wardrobe.getSentTurns().concat(wardrobe.toJSON().pending_questions));
  check("19c: addPiece rejects IG-shaped input fail-closed",
    throwsWith(() => wardrobe.addPiece({
      category: "bag", attributes: {}, source_share_id: "SYNTH_x", recipient_ref: "SYNTH_x",
    }), /rejected key 'recipient_ref'/) &&
    throwsWith(() => wardrobe.addPiece({
      category: "bag", attributes: {}, source_share_id: "SYNTH_x", mid: "SYNTH_x",
    }), /rejected key 'mid'/));
  check("19c: addPiece rejects inferred-fabric/price/vendor input (§8.4)",
    throwsWith(() => wardrobe.addPiece({
      category: "bag", attributes: { fabric: "SYNTH silk" }, source_share_id: "SYNTH_x",
    }), /rejected key 'fabric'/) &&
    throwsWith(() => wardrobe.addPiece({
      category: "bag", attributes: {}, source_share_id: "SYNTH_x", price: "SYNTH 10",
    }), /rejected key 'price'/) &&
    throwsWith(() => wardrobe.addPiece({
      category: "bag", attributes: { vendor: "SYNTH shop" }, source_share_id: "SYNTH_x",
    }), /rejected key 'vendor'/));
  check("19c: addPiece enforces the fixed classifier taxonomy (shoes rejected)",
    throwsWith(() => wardrobe.addPiece({
      category: "shoes", attributes: {}, source_share_id: "SYNTH_x",
    }), /fixed taxonomy term/) &&
    throwsWith(() => wardrobe.recordTurn({
      userText: "SYNTH x", proposal: null, verdict: true,
      reasons: [], recipient_ref: "SYNTH_x",
    }), /rejected key 'recipient_ref'/));

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
