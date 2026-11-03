"use strict";
/* meta-styles — preview audit in the wardrobe-service status surface.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves, with synthetic fixtures only:
 *  - a propose_look flat-lay preview populates the status body's
 *    last_previews field (the same object GET /wardrobe/status
 *    serializes: that route returns statusBody() verbatim);
 *  - the serialized status JSON carries no image bytes/base64 anywhere
 *    (same style as the existing "no profile bytes" checks);
 *  - last_previews stays bounded (newest last, at most 20).
 *
 * Note: this asserts svc.status() — the exact object the GET
 * /wardrobe/status handler JSON-serializes — instead of a live socket
 * GET, because sandboxed CI runners intercept even 127.0.0.1 TCP (the
 * pre-existing live-proxy/stage-colon failures prove it). The route
 * wiring itself (GET /wardrobe/status -> finish(200, statusBody())) is
 * unchanged and covered by inspection.
 */
const assert = require("assert");

process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const Wardrobe = require("../../app/wardrobe-catalog.js");
const Propose = require("../../app/skills/propose_look/handler.js");

// Locally generated 1x1 PNGs. Synthetic only — no real photos.
const ORIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const THUMB = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMINAAAABJRU5ErkJggg==";
const PREVIEW_DURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMISAAAABJRU5ErkJggg==";

function newCatalog() {
  const cat = Wardrobe.createCatalog({ userKey: "SYNTH_pas_" + Math.floor(Math.random() * 1e9) });
  cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_pas_1", image_original: ORIG });
  cat.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_share_pas_2", photo_thumb: THUMB });
  cat.addPiece({ category: "scarf", attributes: {}, source_share_id: "SYNTH_share_pas_3" });
  cat.addPiece({ category: "bag", attributes: {}, source_share_id: "SYNTH_share_pas_4" });
  return cat;
}

async function run() {
  console.log("preview-audit-status.test.js");
  Propose.clearPreviewAudit();

  delete require.cache[require.resolve("../server.js")];
  const Service = require("../server.js");
  const svc = Service.createService({
    botBase: "http://127.0.0.1:59997", proxyBase: "http://127.0.0.1:59998",
    readToken: "SYNTH_mock_token", catalogToken: "SYNTH_mock_token", sendToken: "SYNTH_mock_token",
    port: 0, nowMs: function () { return Date.now(); }
  });

  // Empty ring -> status carries an empty last_previews array.
  const empty = svc.status();
  assert.ok(Array.isArray(empty.last_previews), "last_previews is an array, got " + typeof empty.last_previews);
  assert.strictEqual(empty.last_previews.length, 0, "starts empty, got " + empty.last_previews.length);

  // Drive a real flat-lay preview through the handler (stub client), the
  // same path the service's agentic loop invokes.
  const cat = newCatalog();
  const active = cat.getActivePieces();
  const byCat = {};
  active.forEach(function (p) { byCat[p.category] = p.piece_id; });
  const seen = { calls: [] };
  const mc = {
    assemble: async function () {
      return { looks: [{ pieceIds: [byCat["dress"], byCat["layer/cardigan"]], rationale: "SYNTH drape." }] };
    },
    preview: async function (prompt, images) {
      seen.calls.push({ prompt: prompt, images: Array.isArray(images) ? images.slice() : images });
      return { dataURL: PREVIEW_DURL };
    },
  };
  const r = await Propose.handle({ catalog: cat, metaClient: mc, text: "show me a look", preferences: "" });
  assert.strictEqual(seen.calls.length, 1, "preview ran once, got " + seen.calls.length);
  assert.ok(r.meta && r.meta.selectedCount === 2, "look proposed");

  // The status surface now carries the entry — serialized exactly as GET
  // /wardrobe/status would send it (that route JSON-stringifies this same
  // object verbatim).
  const st = svc.status();
  assert.ok(Array.isArray(st.last_previews), "last_previews is an array");
  assert.strictEqual(st.last_previews.length, 1, "one entry surfaced, got " + st.last_previews.length);
  const body = JSON.parse(JSON.stringify(st));
  assert.strictEqual(body.last_previews.length, 1, "serialized form keeps the entry");
  const e = body.last_previews[0];
  assert.strictEqual(e.skill, "propose_look", "skill named, got " + e.skill);
  assert.strictEqual(e.renderOnUser, false, "flat-lay flagged");
  assert.ok(Array.isArray(e.refs) && e.refs.length === 2, "two refs, got " + JSON.stringify(e.refs));
  assert.strictEqual(e.refs[0].piece_id, byCat["dress"], "dress first");
  assert.strictEqual(e.refs[0].ref_source, "image_original", "dress source, got " + e.refs[0].ref_source);
  assert.strictEqual(e.refs[1].ref_source, "photo_thumb", "cardigan source, got " + e.refs[1].ref_source);

  // No image bytes/base64 anywhere in the serialized status JSON — the
  // same bar as the existing "no profile bytes in status" checks.
  const wire = JSON.stringify(body);
  assert.ok(wire.indexOf("data:image") === -1, "status JSON carries no data URLs");
  assert.ok(wire.indexOf("base64") === -1, "status JSON carries no base64");
  console.log("  pass: last_previews surfaced, byte-free; wire bytes=" + wire.length);

  // Bound: flood the ring past the cap; status still shows at most 20,
  // newest last.
  for (let i = 1; i <= 25; i++) {
    Propose.recordPreviewAudit({
      skill: "propose_look", renderOnUser: false,
      refs: [{ piece_id: "SYNTH_flood_" + i, category: "dress", ref_source: "photo_thumb", ref_bytes: i, downgraded: true }],
      previewPromptPreview: "SYNTH flood " + i,
      totalRefs: 1, totalPayloadBytes: i,
    });
  }
  const capped = svc.status();
  assert.strictEqual(capped.last_previews.length, 20, "capped at 20, got " + capped.last_previews.length);
  assert.strictEqual(capped.last_previews[0].refs[0].piece_id, "SYNTH_flood_6", "oldest evicted");
  assert.strictEqual(capped.last_previews[19].refs[0].piece_id, "SYNTH_flood_25", "newest last");
  const cappedWire = JSON.stringify(capped);
  assert.ok(cappedWire.indexOf("data:image") === -1, "capped status JSON carries no data URLs");
  assert.ok(cappedWire.indexOf("base64") === -1, "capped status JSON carries no base64");
  console.log("  pass: last_previews bounded at 20, newest last, byte-free");

  Propose.clearPreviewAudit();
  console.log("\nAll preview-audit status tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
