"use strict";
/* meta-styles — buildGarmentImages honours a lossy composite sheet.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * In composite mode, orderedNouns, represented and the refs' cell indexes
 * must derive from the sheet's `included` indexes — not from every built
 * ref. If composeSheetSync skips an input (undecodable bytes), the prompt
 * must not name that garment, the skipped piece gets no cell, and it
 * counts as missing so the honest "Only N of M" shortfall line applies.
 * Proved with a stubbed composeSheetSync that drops one input, plus a
 * control run against the real sheet builder where everything decodes.
 * All fixtures synthetic (locally generated 1x1 PNGs, SYNTH_ ids) — no
 * network, no real photos.
 *
 * Run: node app/test/build-garment-images-missing.test.js
 */
const assert = require("node:assert");
const PhotoThumb = require("../photo-thumb.js");
const Propose = require("../skills/propose_look/handler.js");

function png1(r, g, b) {
  return "data:image/png;base64," +
    Buffer.from(PhotoThumb.encodePng(1, 1, new Uint8Array([r, g, b]))).toString("base64");
}
const SHEET_URL = png1(9, 9, 9);

const CATS = ["dress", "scarf", "bag", "layer/cardigan", "layer/blazer"];

function fixtures() {
  const active = CATS.map(function (c, i) {
    return {
      piece_id: "SYNTH_piece_70" + i,
      category: c,
      photo_thumb: png1((i * 50 + 10) % 256, (i * 80 + 60) % 256, (i * 40 + 150) % 256),
    };
  });
  const chosen = active.map(function (p) { return { id: p.piece_id, category: p.category }; });
  return { active: active, chosen: chosen };
}

async function run() {
  console.log("build-garment-images-missing.test.js");

  // --- control: the real sheet builder includes every decodable input ---
  console.log("\n[(control) real sheet includes all 5]");
  {
    const fx = fixtures();
    const out = Propose.buildGarmentImages(fx.active, fx.chosen, 4);
    assert.strictEqual(out.mode, "composite", "5 refs over 4 slots ride one sheet");
    assert.strictEqual(out.images.length, 1, "one sheet image");
    assert.strictEqual(out.total, 5, "total counts every chosen piece");
    assert.strictEqual(out.represented, 5, "real builder represents all 5");
    assert.deepStrictEqual(out.orderedNouns, ["dress", "scarf", "bag", "cardigan", "blazer"],
      "nouns follow selection order: " + out.orderedNouns.join(","));
    assert.strictEqual(out.refs.length, 5, "every placed ref audited");
    assert.deepStrictEqual(out.refs.map(function (r) { return r.cell; }), [0, 1, 2, 3, 4],
      "cells run 0..4 in grid order");
    console.log("  pass: 5 of 5, cells 0..4");
  }

  // --- stubbed sheet drops input 2 (the bag): prompt must not name it ---
  console.log("\n[(stubbed) skipped input is missing, not named]");
  {
    const fx = fixtures();
    const orig = PhotoThumb.composeSheetSync;
    PhotoThumb.composeSheetSync = function () {
      return { url: SHEET_URL, included: [0, 1, 3, 4], cols: 2, rows: 2 };
    };
    let out;
    try {
      out = Propose.buildGarmentImages(fx.active, fx.chosen, 4);
    } finally {
      PhotoThumb.composeSheetSync = orig;
    }
    assert.strictEqual(PhotoThumb.composeSheetSync, orig, "stub restored");
    assert.strictEqual(out.mode, "composite", "still one sheet");
    assert.strictEqual(out.images.length, 1, "one sheet image");
    assert.deepStrictEqual(out.images, [SHEET_URL], "sheet URL rides");
    assert.strictEqual(out.total, 5, "total still counts every chosen piece");
    assert.strictEqual(out.represented, 4, "represented counts placed inputs only, got " + out.represented);
    assert.deepStrictEqual(out.orderedNouns, ["dress", "scarf", "cardigan", "blazer"],
      "dropped bag unnamed: " + out.orderedNouns.join(","));
    assert.strictEqual(out.refs.length, 4, "skipped piece gets no ref row");
    assert.deepStrictEqual(out.refs.map(function (r) { return r.category; }),
      ["dress", "scarf", "layer/cardigan", "layer/blazer"], "rows cover placed pieces");
    assert.deepStrictEqual(out.refs.map(function (r) { return r.cell; }), [0, 1, 2, 3],
      "cells index the sheet grid, not the input order");
    assert.strictEqual(out.downgraded, true, "a skipped input downgrades");
    assert.ok(out.total - out.represented === 1, "the honest shortfall line applies (Only 4 of 5)");
    console.log("  pass: bag unnamed, no cell, shortfall applies");
  }

  console.log("\nAll build-garment-images-missing tests passed.");
}

run().catch((e) => { console.error(e.stack || e); process.exit(1); });
