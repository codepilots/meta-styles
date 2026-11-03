"use strict";
/* meta-styles — revise_look flat-lay sends every chosen reference.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves, with synthetic fixtures only (locally generated 1x1 PNGs,
 * SYNTH_ ids — never real photos):
 *  - a 3-piece revised look whose pieces all carry references calls
 *    metaClient.preview with 3 images (not 1);
 *  - the prompt carries the multi-reference wording shared with
 *    propose_look's flat-lay ("distinct wardrobe garment", no generic
 *    substitutes, no unreferenced garments);
 *  - the shared audit ring logs the 3 sent refs for skill revise_look.
 *
 * Run: node app/test/revise-look-flatlay-refs.test.js
 */
const assert = require("assert");
const PhotoThumb = require("../photo-thumb.js");
const Wardrobe = require("../wardrobe-catalog.js");
const Propose = require("../skills/propose_look/handler.js");
const Handler = require("../skills/revise_look/handler.js");

// Locally generated 1x1 PNGs in distinct solid colours (real encodable
// bytes via the repo's own encoder). Synthetic only — no real photos.
function png1(r, g, b) {
  return "data:image/png;base64," +
    Buffer.from(PhotoThumb.encodePng(1, 1, new Uint8Array([r, g, b]))).toString("base64");
}
const PREVIEW_DURL = png1(7, 7, 7);

function seed() {
  const cat = Wardrobe.createCatalog({ userKey: "SYNTH_revflat_" + Date.now() + "_" + Math.floor(Math.random() * 1e6) });
  // Every piece carries a reference so nothing is skipped as missing.
  cat.addPiece({ category: "base/top", attributes: {}, source_share_id: "SYNTH_share_revflat_1", photo_thumb: png1(200, 40, 40) });
  cat.addPiece({ category: "base/bottom", attributes: {}, source_share_id: "SYNTH_share_revflat_2", photo_thumb: png1(40, 40, 200) });
  cat.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_share_revflat_3", photo_thumb: png1(40, 160, 40) });
  cat.addPiece({ category: "scarf", attributes: {}, source_share_id: "SYNTH_share_revflat_4", photo_thumb: png1(200, 200, 40) });
  cat.addPiece({ category: "bag", attributes: {}, source_share_id: "SYNTH_share_revflat_5", photo_thumb: png1(160, 40, 200) });
  return cat;
}

async function run() {
  console.log("revise-look-flatlay-refs.test.js");
  Propose.clearPreviewAudit();

  const cat = seed();
  const seen = [];
  const metaClient = {
    preview: async function (prompt, images) {
      seen.push({ prompt: prompt, images: Array.isArray(images) ? images.slice() : images });
      return { dataURL: PREVIEW_DURL };
    }
  };
  // "drop the bag" excludes the bag; top+bottom+cardigan is the first
  // valid 3-piece look from the reduced set (no render words -> flat-lay).
  const r = await Handler.handle({ catalog: cat, text: "drop the bag please", metaClient: metaClient });

  assert.strictEqual(seen.length, 1, "preview called once, got " + seen.length);
  const sent = seen[0].images;
  const sentArr = Array.isArray(sent) ? sent : (sent ? [sent] : []);
  assert.strictEqual(sentArr.length, 3,
    "3-piece revised look sends 3 images, got " + sentArr.length);
  assert.ok(/distinct wardrobe garment/.test(seen[0].prompt),
    "prompt names each image as a distinct garment");
  assert.ok(/do not substitute generic garments/.test(seen[0].prompt),
    "prompt forbids generic substitutes");
  assert.ok(/do not add unreferenced garments/.test(seen[0].prompt),
    "prompt forbids unreferenced garments");
  assert.ok(!/Only \d+ of/.test(seen[0].prompt),
    "no shortfall line when every piece has a reference");
  assert.ok(r.meta && r.meta.imageDelivery && r.meta.imageDelivery.generated === true,
    "preview generated");

  // The audit ring logs exactly the refs actually sent.
  const entries = Propose.getPreviewAudit();
  assert.ok(entries.length >= 1, "audit entry logged");
  const e = entries[entries.length - 1];
  assert.strictEqual(e.skill, "revise_look", "entry names revise_look");
  assert.strictEqual(e.renderOnUser, false, "entry is a flat-lay");
  assert.ok(Array.isArray(e.refs) && e.refs.length === 3,
    "audit names all 3 sent refs, got " + JSON.stringify(e.refs).slice(0, 200));
  assert.strictEqual(e.totalRefs, 3, "audit total matches what was sent");
  assert.ok(e.refs.every(function (g) { return typeof g.piece_id === "string" && typeof g.ref_bytes === "number"; }),
    "audit refs carry ids + byte counts, never bytes");
  assert.ok(JSON.stringify(e).indexOf("data:image") === -1, "audit entry carries no image bytes");

  Propose.clearPreviewAudit();
  console.log("  pass: 3-piece revise sends 3 refs, prompt + audit match");
  console.log("\nAll revise-look flat-lay ref tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
