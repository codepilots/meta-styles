"use strict";
/* meta-styles — SAM-segmented thumbnail tests (NEW hackathon work, building
 * period Oct 27 – Nov 4, 2026).
 *
 * Covers catalogue_piece's SAM crop step: with a stubbed metaClient.segment
 * resolving SAM-shaped boxes, the stored photo_thumb is cropped to the
 * winning garment box before downscaling; when segment rejects, resolves
 * no usable boxes, or is absent, cataloguing still succeeds and the thumb
 * is exactly the whole-photo downscale from Step A.
 *
 * No network anywhere — metaClient in every case is a hand-built stub,
 * never the real app/meta-client.js. All image fixtures are tiny smooth
 * gradients generated from scratch below — never real photos. All
 * ids/text synthetic (SYNTH_ prefix) — never real data.
 */
const assert = require("assert");
const PhotoThumb = require("../photo-thumb.js");
const Wardrobe = require("../wardrobe-catalog.js");
const CataloguePiece = require("../skills/catalogue_piece/handler.js");

// Synthetic fixture: smooth two-axis gradient, built from scratch. Smooth
// on purpose — it compresses tiny so the thumb keeps full crop resolution
// and the decoded dimensions below are deterministic.
function synthSmooth(w, h) {
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      rgb[o] = Math.round((x / (w - 1)) * 255);
      rgb[o + 1] = Math.round((y / (h - 1)) * 255);
      rgb[o + 2] = 128;
    }
  }
  return { w, h, rgb };
}

function pngUrl(w, h, rgb) {
  return "data:image/png;base64," + Buffer.from(PhotoThumb.encodePng(w, h, rgb)).toString("base64");
}

function decodeThumb(url) {
  return PhotoThumb.decodePng(new Uint8Array(Buffer.from(url.split(",")[1], "base64")));
}

async function run() {
  console.log("sam-segment-thumb.test.js");

  const src = synthSmooth(160, 120);
  const url = pngUrl(src.w, src.h, src.rgb);
  const whole = PhotoThumb.makeSync(url);
  assert.ok(whole && whole.startsWith("data:image/png;base64,"), "whole-photo thumb builds");
  const wholeDims = decodeThumb(whole);
  assert.strictEqual(wholeDims.w, 96, "whole thumb width (160x120 -> 96x72)");
  assert.strictEqual(wholeDims.h, 72, "whole thumb height");

  // --- (a) success: highest-confidence box wins, thumb is cropped ---
  console.log("\n[(a) SAM crop success]");
  {
    const seen = [];
    const mc = {
      segment: async function (imageDataUrl, phrases) {
        seen.push({ imageDataUrl, phrases });
        return {
          polygons: [{ label: "dress", points: [[0.2, 0.1], [0.7, 0.1], [0.7, 0.7], [0.2, 0.7]] }],
          boxes: [
            { label: "dress", rect: [0, 0, 0.1, 0.1], confidence: 0.2, mask: null },
            { label: "dress", rect: [0.2, 0.1, 0.5, 0.6], confidence: 0.9, mask: null },
          ],
          source: "sam-3.1", model: "sam-3.1", placeholder: false,
        };
      },
    };
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_sam_a" });
    const r = await CataloguePiece.handle({
      catalog: cat, text: "my new dress", imageDataUrl: url, metaClient: mc,
    });
    assert.strictEqual(seen.length, 1, "segment called once");
    assert.strictEqual(seen[0].imageDataUrl, url, "segment got the photo");
    assert.ok(Array.isArray(seen[0].phrases) && seen[0].phrases.length >= 1, "segment got phrases");
    assert.strictEqual(seen[0].phrases[0], "dress", "phrase names the detected category");
    assert.ok(/dress/.test(r.text), "reply names the piece");
    const pieces = cat.getActivePieces();
    assert.strictEqual(pieces.length, 1, "one piece catalogued");
    const thumb = pieces[0].photo_thumb;
    assert.ok(thumb && thumb.startsWith("data:image/png;base64,"), "cropped thumb stored");
    assert.notStrictEqual(thumb, whole, "cropped thumb differs from the whole-photo thumb");
    // rect [0.2,0.1,0.5,0.6] of 160x120 -> pixels x[32,112) y[12,84) = 80x72,
    // kept at full size (longest side 80 <= 96), NOT the photo's 96x72.
    const out = decodeThumb(thumb);
    assert.strictEqual(out.w, 80, `cropped width reflects the box (got ${out.w})`);
    assert.strictEqual(out.h, 72, `cropped height reflects the box (got ${out.h})`);
    console.log(`  pass: thumb cropped to the winning box (${out.w}x${out.h} vs whole ${wholeDims.w}x${wholeDims.h})`);
  }

  // --- (b) no numeric confidences: first usable box wins ---
  console.log("\n[(b) first box wins when confidence is absent]");
  {
    const mc = {
      segment: async function () {
        return {
          polygons: [],
          boxes: [
            { label: "dress", rect: [0, 0, 0.5, 0.5], confidence: null, mask: null },
            { label: "dress", rect: [0.5, 0.5, 0.5, 0.5], confidence: null, mask: null },
          ],
          source: "sam-3.1", model: "sam-3.1", placeholder: false,
        };
      },
    };
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_sam_b" });
    await CataloguePiece.handle({
      catalog: cat, text: "my new dress", imageDataUrl: url, metaClient: mc,
    });
    const thumb = cat.getActivePieces()[0].photo_thumb;
    // rect [0,0,0.5,0.5] of 160x120 -> 80x60.
    const out = decodeThumb(thumb);
    assert.strictEqual(out.w, 80, `first-box width (got ${out.w})`);
    assert.strictEqual(out.h, 60, `first-box height (got ${out.h})`);
    console.log(`  pass: first box used (${out.w}x${out.h})`);
  }

  // --- (c) segment rejects: whole-photo fallback, cataloguing succeeds ---
  console.log("\n[(c) segment rejection falls back]");
  {
    const mc = {
      segment: async function () { throw new Error("SYNTH network down"); },
    };
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_sam_c" });
    const r = await CataloguePiece.handle({
      catalog: cat, text: "my new dress", imageDataUrl: url, metaClient: mc,
    });
    assert.ok(/dress/.test(r.text), "reply still produced");
    const pieces = cat.getActivePieces();
    assert.strictEqual(pieces.length, 1, "cataloguing succeeds despite the SAM failure");
    assert.strictEqual(pieces[0].photo_thumb, whole, "thumb is exactly the whole-photo path");
    console.log("  pass: rejection -> identical whole-photo thumb");
  }

  // --- (d) segment resolves no usable boxes: same fallback ---
  console.log("\n[(d) empty/unusable boxes fall back]");
  {
    for (const [name, boxes] of [
      ["empty array", []],
      ["degenerate rects", [{ label: "dress", rect: [0.5, 0.5, 0, 0.2], confidence: 0.99, mask: null }]],
      ["non-numeric rect", [{ label: "dress", rect: ["x", 0, 1, 1], confidence: 0.99, mask: null }]],
    ]) {
      const mc = {
        segment: async function () {
          return { polygons: [], boxes, source: "sam-3.1", model: "sam-3.1", placeholder: false };
        },
      };
      const cat = Wardrobe.createCatalog({ userKey: "SYNTH_sam_d_" + name.replace(/\W+/g, "_") });
      await CataloguePiece.handle({
        catalog: cat, text: "my new dress", imageDataUrl: url, metaClient: mc,
      });
      const pieces = cat.getActivePieces();
      assert.strictEqual(pieces.length, 1, `${name}: still catalogues`);
      assert.strictEqual(pieces[0].photo_thumb, whole, `${name}: whole-photo thumb`);
    }
    console.log("  pass: empty/degenerate/non-numeric boxes -> whole-photo thumb");
  }

  // --- (e) no segment function at all: unchanged Step A behavior ---
  console.log("\n[(e) metaClient without segment]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_sam_e" });
    await CataloguePiece.handle({
      catalog: cat, text: "my new dress", imageDataUrl: url, metaClient: {},
    });
    const pieces = cat.getActivePieces();
    assert.strictEqual(pieces.length, 1, "still catalogues");
    assert.strictEqual(pieces[0].photo_thumb, whole, "thumb is exactly the whole-photo path");
    console.log("  pass: missing segment -> identical whole-photo thumb");
  }

  // --- (f) invalid crop rects keep the whole photo (cropPixels guard) ---
  console.log("\n[(f) invalid crop rects are ignored]");
  {
    for (const bad of [null, undefined, [0, 0], [0, 0, -1, 0.5], ["x", 0, 1, 1], [0.5, 0.5, 0, 0.2]]) {
      assert.strictEqual(PhotoThumb.makeSync(url, bad), whole, `rect ${JSON.stringify(bad)} ignored`);
    }
    console.log("  pass: invalid rects thumbnail the whole photo");
  }

  console.log("\nAll SAM-segment thumbnail tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
