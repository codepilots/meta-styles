"use strict";
/* meta-styles — revise_look image-honesty tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Covers: (a) preview + staging succeed -> delivered:true, real
 * image.dataURL, no caveat; (b) staging fails or no shareId/stageImage ->
 * delivered:false, honest caveat, no example.invalid; (c) no metaClient or
 * preview throws -> image null, requested false-or-failed, and the whole
 * returned object contains no fabricated URL.
 * All clients mocked — no network. All ids synthetic (SYNTH_ prefix).
 */
const assert = require("assert");
const Wardrobe = require("../wardrobe-catalog.js");
const Handler = require("../skills/revise_look/handler.js");

const DURL = "data:image/png;base64,SYNTH_rev_preview_bytes";
const CAVEAT_FRAG = "can\u2019t tuck preview pictures into chat";

function seed() {
  const cat = Wardrobe.createCatalog({ userKey: "SYNTH_rev_" + Math.floor(Math.random() * 1e9) });
  cat.addPiece({ category: "base/top", attributes: {}, source_share_id: "SYNTH_share_rev_1" });
  cat.addPiece({ category: "base/bottom", attributes: {}, source_share_id: "SYNTH_share_rev_2" });
  cat.addPiece({ category: "layer/blazer", attributes: {}, source_share_id: "SYNTH_share_rev_3" });
  // Opus finding #7: excluding the blazer must still leave a valid look
  // (top+bottom+cardigan) so these preview-mechanics cases exercise a
  // real re-selected look instead of the old whole-wardrobe assembly.
  cat.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_share_rev_4" });
  // Mock the browser-global assembler the handler reads via root.MetaStyles.
  globalThis.MetaStyles = globalThis.MetaStyles || {};
  globalThis.MetaStyles.assembleLook = function (items) { return { valid: true, items: items }; };
  return cat;
}

function noFabrication(result, label) {
  const dumped = JSON.stringify(result);
  assert.ok(!/example\.invalid/.test(dumped), label + " must contain no example.invalid: " + dumped.slice(0, 200));
}

async function run() {
  console.log("revise-look-image-honesty.test.js");

  // --- (a) preview + staging succeed ---
  console.log("\n[(a) delivered]");
  {
    const cat = seed();
    let stagedWith = null;
    const metaClient = {
      preview: async function (prompt, ref) {
        assert.ok(/fairycore/i.test(prompt), "preview prompt describes the look");
        return { dataURL: DURL };
      }
    };
    const r = await Handler.handle({
      catalog: cat, text: "drop the blazer please",
      metaClient: metaClient, shareId: "SYNTH_share_rev",
      stageImage: async function (sid, durl) { stagedWith = [sid, durl]; return { ok: true }; }
    });
    assert.strictEqual(r.meta.imageDelivery.requested, true, "requested");
    assert.strictEqual(r.meta.imageDelivery.generated, true, "generated");
    assert.strictEqual(r.meta.imageDelivery.delivered, true, "delivered");
    assert.ok(r.image && r.image.dataURL === DURL, "real dataURL present");
    assert.deepStrictEqual(stagedWith, ["SYNTH_share_rev", DURL], "staged with shareId + dataURL");
    assert.ok(!r.text.includes(CAVEAT_FRAG), "no caveat when delivered");
    noFabrication(r, "delivered result");
    console.log("  pass: delivered:true, real dataURL, staged, no caveat");
  }

  // --- (b1) staging fails -> honest caveat ---
  console.log("\n[(b1) stage_failed]");
  {
    const cat = seed();
    const r = await Handler.handle({
      catalog: cat, text: "drop the blazer please",
      metaClient: { preview: async function () { return { dataURL: DURL }; } },
      shareId: "SYNTH_share_rev",
      stageImage: async function () { return { ok: false }; }
    });
    assert.strictEqual(r.meta.imageDelivery.delivered, false, "not delivered");
    assert.strictEqual(r.meta.imageDelivery.reason, "stage_failed", "truthful reason");
    assert.ok(r.text.includes(CAVEAT_FRAG), "honest caveat appended");
    noFabrication(r, "stage_failed result");
    console.log("  pass: stage_failed, caveat appended, no fabrication");
  }

  // --- (b2) no shareId/stageImage -> text-only, honest caveat ---
  console.log("\n[(b2) text-only send]");
  {
    const cat = seed();
    const r = await Handler.handle({
      catalog: cat, text: "drop the blazer please",
      metaClient: { preview: async function () { return { dataURL: DURL }; } }
    });
    assert.strictEqual(r.meta.imageDelivery.generated, true, "preview still generated");
    assert.strictEqual(r.meta.imageDelivery.delivered, false, "not delivered without staging");
    assert.strictEqual(r.meta.imageDelivery.reason, "text-only send; preview not staged for delivery", "truthful reason");
    assert.ok(r.text.includes(CAVEAT_FRAG), "honest caveat appended");
    noFabrication(r, "text-only result");
    console.log("  pass: text-only reason, caveat appended, no fabrication");
  }

  // --- (c1) no metaClient -> image null, no caveat, no fabrication ---
  console.log("\n[(c1) no metaClient]");
  {
    const cat = seed();
    const r = await Handler.handle({ catalog: cat, text: "drop the blazer please", metaClient: null });
    assert.strictEqual(r.meta.imageDelivery.requested, false, "not requested");
    assert.strictEqual(r.image, null, "image null");
    assert.ok(!r.text.includes(CAVEAT_FRAG), "no caveat when nothing requested");
    noFabrication(r, "no-client result");
    console.log("  pass: requested:false, image null, no fabrication");
  }

  // --- (c2) preview throws -> honest failure, image null ---
  console.log("\n[(c2) preview throws]");
  {
    const cat = seed();
    const r = await Handler.handle({
      catalog: cat, text: "drop the blazer please",
      metaClient: { preview: async function () { throw new Error("proxy down"); } },
      shareId: "SYNTH_share_rev",
      stageImage: async function () { return { ok: true }; }
    });
    assert.strictEqual(r.meta.imageDelivery.requested, true, "requested");
    assert.strictEqual(r.meta.imageDelivery.generated, false, "not generated");
    assert.strictEqual(r.meta.imageDelivery.delivered, false, "not delivered");
    assert.strictEqual(r.image, null, "image null");
    assert.ok(r.text.includes(CAVEAT_FRAG), "honest caveat appended");
    noFabrication(r, "preview-throw result");
    console.log("  pass: preview_failed, image null, caveat appended");
  }

  console.log("\nAll revise_look image-honesty tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
