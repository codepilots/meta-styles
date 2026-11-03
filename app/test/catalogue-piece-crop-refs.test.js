"use strict";
/* meta-styles — catalogue_piece stores cropped per-piece references.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves, with synthetic fixtures only (in-code PNG bytes, SYNTH_ ids —
 * never real photos or ids):
 *  (a) two regions detected in one synthetic photo produce two pieces
 *      whose image_original values DIFFER from each other and from the
 *      input photo (each is its own cropped region, not the whole scene);
 *  (b) each stored original is <= 384px longest side and well under 1 MB;
 *  (c) the two regions keep their own colours (left red, right blue);
 *  (d) the single-piece path with no segment rect stores a <=384px
 *      whole-photo reference (never oversized), also well under 1 MB.
 *
 * Run: node app/test/catalogue-piece-crop-refs.test.js
 */
const assert = require("assert");
const cp = require("node:child_process");
const PhotoThumb = require("../photo-thumb.js");
const Wardrobe = require("../wardrobe-catalog.js");
const Handler = require("../skills/catalogue_piece/handler.js");

// Synthetic 200x200 PNG: left half red, right half blue. Made from
// scratch — never a real photo.
function halvedPng(w, h) {
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      if (x < w / 2) { rgb[o] = 230; rgb[o + 1] = 30; rgb[o + 2] = 30; }
      else { rgb[o] = 30; rgb[o + 1] = 30; rgb[o + 2] = 230; }
    }
  }
  return "data:image/png;base64," + Buffer.from(PhotoThumb.encodePng(w, h, rgb)).toString("base64");
}

function ffmpegAvail() {
  try {
    const r = cp.spawnSync("ffmpeg", ["-version"], { timeout: 2000, windowsHide: true });
    return !!(r && r.status === 0);
  } catch (e) { return false; }
}

// Decode any stored reference (PNG pure-JS; JPEG via ffmpeg) or null.
function decodeRef(url) {
  const b64 = url.split(",")[1];
  if (url.indexOf("data:image/png;base64,") === 0) {
    return PhotoThumb.decodePng(new Uint8Array(Buffer.from(b64, "base64")));
  }
  if (!ffmpegAvail()) return null;
  const r = cp.spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "image2pipe", "-i", "pipe:0",
    "-frames:v", "1",
    "-f", "image2pipe", "-vcodec", "png", "pipe:1"
  ], { input: Buffer.from(b64, "base64"), maxBuffer: 16 * 1024 * 1024, timeout: 8000 });
  if (!r || r.status !== 0 || !r.stdout || r.stdout.length === 0) return null;
  return PhotoThumb.decodePng(new Uint8Array(r.stdout));
}

function rawLen(url) {
  return Buffer.from(url.split(",")[1], "base64").length;
}

function centrePx(img) {
  const o = ((Math.floor(img.h / 2) * img.w) + Math.floor(img.w / 2)) * 3;
  return [img.rgb[o], img.rgb[o + 1], img.rgb[o + 2]];
}

function twoRegionClient() {
  return {
    detectGarments: async function () {
      return {
        placeholder: false,
        pieces: [
          { category: "scarf", attributes: { color: "red" }, bbox: [0, 0, 0.5, 1] },
          { category: "bag", attributes: { color: "blue" }, bbox: [0.5, 0, 0.5, 1] }
        ]
      };
    },
    classify: async function () { return { category: "scarf" }; },
    segment: async function () { return { boxes: [] }; }
  };
}

async function run() {
  console.log("catalogue-piece-crop-refs.test.js");
  const img = halvedPng(200, 200);

  // --- (a/b/c) two regions -> two distinct cropped originals ---
  console.log("\n[(a/b/c) multi-region cropped originals]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_crop_refs_" + Date.now() });
    const r1 = await Handler.handle({
      catalog: cat, text: "", imageDataUrl: img,
      shareId: "SYNTH_share_crop_refs_1", metaClient: twoRegionClient(), pendingBag: {}
    });
    assert.ok(r1.pendingBag && r1.pendingBag.regions.length === 2, "two regions bagged");
    const rYes = await Handler.handle({
      catalog: cat, text: "yes", imageDataUrl: null,
      metaClient: twoRegionClient(), pendingBag: r1.pendingBag
    });
    assert.ok(rYes && rYes.text, "yes reply produced");
    const pieces = cat.getActivePieces();
    assert.strictEqual(pieces.length, 2, "two pieces added, got " + pieces.length);
    const byCat = {};
    pieces.forEach(function (p) { byCat[p.category] = p; });
    assert.ok(byCat["scarf"] && byCat["bag"], "both regions catalogued");

    for (const p of pieces) {
      assert.ok(typeof p.image_original === "string" && p.image_original.indexOf("data:image/") === 0,
        p.category + " carries an image_original");
      assert.notStrictEqual(p.image_original, img,
        p.category + " original is not the whole input photo");
      assert.ok(/^[0-9a-f]{16}$/.test(p.crop_hash), p.category + " crop_hash intact");
    }
    assert.notStrictEqual(byCat["scarf"].image_original, byCat["bag"].image_original,
      "the two pieces' originals differ from each other (per-region crops, not copies of one scene)");

    for (const p of pieces) {
      const raw = rawLen(p.image_original);
      assert.ok(raw < 1024 * 1024, p.category + " original raw " + raw + " well under 1 MB");
      const dec = decodeRef(p.image_original);
      assert.ok(dec, p.category + " original decodes");
      assert.ok(Math.max(dec.w, dec.h) <= 384,
        p.category + " original longest side <= 384, got " + dec.w + "x" + dec.h);
    }
    // Each region keeps its own half's colour (left red, right blue).
    const scarfPx = centrePx(decodeRef(byCat["scarf"].image_original));
    const bagPx = centrePx(decodeRef(byCat["bag"].image_original));
    assert.ok(scarfPx[0] > 150 && scarfPx[2] < 150,
      "scarf region is the red half, got [" + scarfPx + "]");
    assert.ok(bagPx[2] > 150 && bagPx[0] < 150,
      "bag region is the blue half, got [" + bagPx + "]");
    console.log("  pass: two distinct cropped originals, <=384px, own colours kept");
  }

  // --- (d) single-piece, no rect -> whole-photo <=384px reference ---
  console.log("\n[(d) single-piece whole-photo reference]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_crop_refs_single_" + Date.now() });
    const r = await Handler.handle({
      catalog: cat, text: "my red scarf", imageDataUrl: img,
      shareId: "SYNTH_share_crop_refs_single", metaClient: null
    });
    assert.ok(/scarf/.test(r.text), "reply names the piece");
    const pieces = cat.getActivePieces();
    assert.strictEqual(pieces.length, 1, "one piece catalogued");
    const orig = pieces[0].image_original;
    assert.ok(typeof orig === "string" && orig.indexOf("data:image/") === 0, "original stored");
    assert.notStrictEqual(orig, img, "stored reference is resampled, not the raw input");
    const raw = rawLen(orig);
    assert.ok(raw < 1024 * 1024, "single original raw " + raw + " well under 1 MB");
    const dec = decodeRef(orig);
    assert.ok(dec, "single original decodes");
    assert.ok(Math.max(dec.w, dec.h) <= 384,
      "single original longest side <= 384, got " + dec.w + "x" + dec.h);
    console.log(`  pass: single original ${dec.w}x${dec.h}, ${raw} raw bytes`);
  }

  console.log("\nAll catalogue-piece crop-ref tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
