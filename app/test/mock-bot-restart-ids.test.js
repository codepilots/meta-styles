"use strict";
/* meta-styles — mock-bot restart id uniqueness (wardrobe-clear reshare bug).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Root cause (diagnosed live 2026-11-03): the mock bot minted share/media
 * ids from in-memory counters that reset to 0 on every restart, while the
 * per-user wardrobe catalog persists on disk across restarts. After a
 * mock-bot restart, new shares reused ids of earlier pieces (active OR
 * deleted), so catalogue_piece's per-share-id idempotency guard (correct —
 * kept as is) treated a genuinely new photo as an already-processed
 * message. Real Instagram mids are globally unique; the mock must be too.
 *
 * Fix under test: every id the mock bot mints carries a per-process boot
 * tag (random lowercase base36, minted once at store creation), e.g.
 * "SYNTH_mid_op_k3f9x2_001". Opt-in `bootTag: ""` keeps the legacy bare
 * format for pinning; no existing test asserts exact minted ids, so none
 * needed a fixed tag.
 *
 * Covers:
 *  (1) two separate mock-bot store instances (simulating a restart)
 *      produce different share ids AND media ids for their first
 *      incoming photo, all SYNTH_-prefixed in the tagged shape;
 *  (2) end-to-end: catalogue a photo via instance 1's share id, clear the
 *      wardrobe (delete_wardrobe_item clear-all + confirm), then catalogue
 *      the same synthetic photo arriving as instance 2's first share ->
 *      exactly 1 active piece (not "already");
 *  (3) replaying the SAME share id after the clear still does not
 *      resurrect anything (guard intact).
 * All fixtures synthetic (SYNTH_ prefix, locally generated 1px PNG) —
 * never real data.
 *
 * Run: node app/test/mock-bot-restart-ids.test.js
 */
const assert = require("node:assert");
const { startServer, createStore } = require("../../mock-ig-bot/server.js");
const Wardrobe = require("../wardrobe-catalog.js");
const Catalogue = require("../skills/catalogue_piece/handler.js");
const DeleteItem = require("../skills/delete_wardrobe_item/handler.js");

const TOKEN = "SYNTH_restart_ids_token";
const ORIGIN = "http://localhost:8000";

// 1x1 PNG, generated locally — synthetic fixture bytes.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const PNG_DURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function authHeaders(extra) {
  return { Authorization: "Bearer " + TOKEN, ...(extra || {}) };
}

function baseOf(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

async function postPhoto(base, query) {
  const res = await fetch(base + "/mock/incoming-photo" + (query || ""), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "image/png" }),
    body: PNG_1PX,
  });
  assert.strictEqual(res.status, 200, "incoming-photo accepted, got " + res.status);
  return (await res.json()).share;
}

function singleClient() {
  return {
    detectGarments: async function () {
      return {
        placeholder: false, pieces: [
          { category: "dress", attributes: { color: "red" }, bbox: [0.1, 0.1, 0.3, 0.3] }
        ]
      };
    },
    classify: async function () { return { category: "dress" }; },
    segment: async function () { return { boxes: [] }; }
  };
}

function resolveQuestions(cat) {
  cat.getPendingQuestions().forEach((q) => cat.resolveQuestion(q.id));
}

function noSynthLeak(text, label) {
  assert.ok(!/SYNTH_/.test(text), label + " must not leak SYNTH_ ids: " + String(text).slice(0, 200));
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function run() {
  console.log("mock-bot-restart-ids.test.js");
  const servers = [];
  try {
    // --- (1) two instances (restart) -> distinct first-photo ids ------------
    console.log("\n[(1) restart gives distinct share + media ids]");
    const a = await startServer({ port: 0, token: TOKEN, allowOrigin: ORIGIN });
    const b = await startServer({ port: 0, token: TOKEN, allowOrigin: ORIGIN });
    servers.push(a.server, b.server);
    const baseA = baseOf(a.server);
    const baseB = baseOf(b.server);
    const s1 = await postPhoto(baseA);
    const s2 = await postPhoto(baseB);
    assert.notStrictEqual(s1.id, s2.id,
      "first share ids differ across restarts, both got " + s1.id);
    assert.notStrictEqual(s1.media_id, s2.media_id,
      "first media ids differ across restarts, both got " + s1.media_id);
    assert.match(s1.id, /^SYNTH_mid_op_[0-9a-z]{6}_\d{3}$/, "tagged share shape, got " + s1.id);
    assert.match(s2.id, /^SYNTH_mid_op_[0-9a-z]{6}_\d{3}$/, "tagged share shape, got " + s2.id);
    assert.match(s1.media_id, /^SYNTH_media_op_[0-9a-z]{6}_\d{3}$/,
      "tagged media shape, got " + s1.media_id);
    console.log("  pass: " + s1.id + " vs " + s2.id);

    // --- (1b) remaining minted families carry the tag too -------------------
    console.log("\n[(1b) post + outbound families tagged]");
    const post = await postPhoto(baseA, "?kind=post&caption=" + encodeURIComponent("SYNTH gown"));
    assert.match(post.attachment.payload.ig_post_media_id, /^SYNTH_post_op_[0-9a-z]{6}_\d{3}$/,
      "tagged ig_post shape, got " + post.attachment.payload.ig_post_media_id);
    const staged = await fetch(baseA + "/mock/stage-outbound-image/" + s1.id, {
      method: "POST", headers: authHeaders({ "Content-Type": "image/png" }), body: PNG_1PX,
    });
    assert.strictEqual(staged.status, 200, "stage accepted, got " + staged.status);
    const sentRes = await fetch(baseA + "/ig/send", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        share_id: s1.id, text: "SYNTH look", idempotency_key: "SYNTH_key_restart_1",
        confirm: true, image: true,
      }),
    });
    const sent = await sentRes.json();
    assert.strictEqual(sentRes.status, 200, "image send accepted, got " + sentRes.status);
    assert.match(sent.message_id, /^SYNTH_msg_[0-9a-z]{6}_\d{3}$/,
      "tagged message shape, got " + sent.message_id);
    assert.match(sent.image_message_id, /^SYNTH_imgmsg_[0-9a-z]{6}_\d{3}$/,
      "tagged image-message shape, got " + sent.image_message_id);
    const tokens = Array.from(a.store.outboundTokens.keys());
    assert.strictEqual(tokens.length, 1, "one outbound token minted");
    assert.match(tokens[0], /^SYNTH_outbound_[0-9a-z]{6}_\d{3}$/,
      "tagged token shape, got " + tokens[0]);
    console.log("  pass: post + msg + imgmsg + token all tagged");

    // --- (1c) opt-in bootTag:"" keeps the exact legacy format ---------------
    console.log("\n[(1c) bootTag:'' pins legacy format]");
    const legacy = await startServer({
      port: 0, token: TOKEN, allowOrigin: ORIGIN, store: createStore({ bootTag: "" }),
    });
    servers.push(legacy.server);
    const baseL = baseOf(legacy.server);
    const l1 = await postPhoto(baseL);
    assert.strictEqual(l1.id, "SYNTH_mid_op_001", "legacy share id, got " + l1.id);
    assert.strictEqual(l1.media_id, "SYNTH_media_op_001", "legacy media id, got " + l1.media_id);
    // Second share on this store (the share counter is shared across
    // text/image/post intakes, pre-existing behavior).
    const lp = await postPhoto(baseL, "?kind=post&caption=" + encodeURIComponent("SYNTH gown"));
    assert.strictEqual(lp.id, "SYNTH_mid_op_002", "legacy share counter, got " + lp.id);
    assert.strictEqual(lp.attachment.payload.ig_post_media_id, "SYNTH_post_op_002",
      "legacy post id, got " + lp.attachment.payload.ig_post_media_id);
    const lsend = await (await fetch(baseL + "/ig/send", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        share_id: l1.id, text: "SYNTH hi", idempotency_key: "SYNTH_key_legacy_1", confirm: true,
      }),
    })).json();
    assert.strictEqual(lsend.message_id, "SYNTH_msg_001",
      "legacy message id, got " + lsend.message_id);
    console.log("  pass: legacy format byte-identical");

    // --- (2) e2e: clear, then same photo via the NEW restart share ----------
    console.log("\n[(2) reshare after restart + clear catalogues 1 piece]");
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_restart_ids_e2e" });
    const client = singleClient();
    const rA = await Catalogue.handle({
      catalog: cat, text: "", imageDataUrl: PNG_DURL,
      shareId: s1.id, metaClient: client, pendingBag: {},
    });
    assert.ok(rA.pendingBag && rA.pendingBag.regions.length === 1,
      "share 1 asked, got: " + String(rA.text).slice(0, 120));
    await Catalogue.handle({
      catalog: cat, text: "yes", imageDataUrl: null,
      metaClient: client, pendingBag: rA.pendingBag,
    });
    assert.strictEqual(cat.getActivePieces().length, 1, "share 1 catalogued 1 piece");
    const firstId = cat.getActivePieces()[0].piece_id;
    await DeleteItem.handle({ catalog: cat, text: "clear my wardrobe" });
    resolveQuestions(cat);
    await DeleteItem.handle({ catalog: cat, text: "yes" });
    assert.strictEqual(cat.getActivePieces().length, 0, "cleared");
    // The SAME synthetic photo arrives as instance 2's first share (a
    // genuinely new share id after the restart): must re-ask, not "already".
    const rB = await Catalogue.handle({
      catalog: cat, text: "", imageDataUrl: PNG_DURL,
      shareId: s2.id, metaClient: client, pendingBag: {},
    });
    assert.ok(rB.pendingBag && rB.pendingBag.regions.length === 1,
      "restarted share re-asked, got: " + String(rB.text).slice(0, 120));
    const rYes = await Catalogue.handle({
      catalog: cat, text: "yes", imageDataUrl: null,
      metaClient: client, pendingBag: rB.pendingBag,
    });
    assert.ok(/pieces? in/i.test(rYes.text),
      "new piece added, got: " + String(rYes.text).slice(0, 120));
    const after = cat.getActivePieces();
    assert.strictEqual(after.length, 1, "exactly 1 active piece, got " + after.length);
    assert.notStrictEqual(after[0].piece_id, firstId, "fresh piece, not a rejected revival");
    noSynthLeak(rYes.text, "add reply");
    console.log("  pass: restarted share catalogued 1 fresh piece");

    // --- (3) same-share replay after the clear resurrects nothing ------------
    console.log("\n[(3) same-share replay stays idempotent]");
    const rReplay = await Catalogue.handle({
      catalog: cat, text: "", imageDataUrl: PNG_DURL,
      shareId: s1.id, metaClient: client, pendingBag: {},
    });
    assert.ok(/already in your wardrobe/i.test(rReplay.text),
      "replayed share idempotent, got: " + String(rReplay.text).slice(0, 120));
    assert.ok(!rReplay.pendingBag, "no new bag on replay");
    assert.strictEqual(cat.getActivePieces().length, 1, "replay resurrects nothing");
    noSynthLeak(rReplay.text, "replay reply");
    console.log("  pass: guard intact, replay resurrects nothing");
  } finally {
    for (const s of servers) await close(s);
  }

  console.log("\nAll mock-bot-restart-ids tests passed.");
}

if (require.main === module) {
  run().then(
    () => {},
    (e) => { console.error("FAIL:", e && e.message ? e.message : e); process.exit(1); }
  );
}

module.exports = { run };
