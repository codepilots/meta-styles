"use strict";
/* meta-styles — photo-reference thumbnail tests (M21 photo-reference work).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Covers: (a) photo-thumb.js PNG-only round-trip — a synthetic
 * gradient/noise garment stand-in (never a real photo) fits the byte
 * budget and decodes pixel-perfect; JPEG bytes and garbage fail soft to
 * null; (b) catalogue_piece stores a photo_thumb on a normal catalogue
 * call and still catalogues when the image is undecodable; (c)
 * propose_look passes the stored thumb(s) as the preview reference and
 * falls back to the text-only path for pieces without thumbs.
 * No network anywhere — the metaClient is a capturing stub.
 * All ids/text synthetic (SYNTH_ prefix) — never real data.
 */
const assert = require("assert");
const PhotoThumb = require("../photo-thumb.js");
const Wardrobe = require("../wardrobe-catalog.js");
const CataloguePiece = require("../skills/catalogue_piece/handler.js");
const ProposeLook = require("../skills/propose_look/handler.js");

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Synthetic garment stand-in: silk-like diagonal gradient + fold stripes +
// seam checker + deterministic sensor noise. Made from scratch, never a
// real photo.
function synthGarment(w, h) {
  const rgb = new Uint8Array(w * h * 3);
  const rnd = mulberry(20261030);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      let r = 40 + 150 * u + 40 * v;
      let g = 60 + 90 * v + 50 * u;
      let b = 90 + 110 * (1 - u) * v + 30 * u;
      const s = Math.sin((u * 9 + v * 3) * Math.PI * 2);
      r += 18 * s; g += 14 * s; b += 10 * s;
      if (u > 0.7 && v < 0.3 && (((x >> 3) + (y >> 3)) & 1)) { r *= 0.82; g *= 0.82; b *= 0.82; }
      r += (rnd() * 20 - 10); g += (rnd() * 20 - 10); b += (rnd() * 20 - 10);
      const o = (y * w + x) * 3;
      rgb[o] = Math.max(0, Math.min(255, Math.round(r)));
      rgb[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
      rgb[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
  return { w, h, rgb };
}

function pngUrl(w, h, rgb) {
  return "data:image/png;base64," + Buffer.from(PhotoThumb.encodePng(w, h, rgb)).toString("base64");
}

function maxdiff(a, b) {
  assert.strictEqual(a.length, b.length, "same pixel count");
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
}

async function run() {
  console.log("photo-thumb-refs.test.js");

  // --- (a) PNG-only round-trip under budget ---
  console.log("\n[(a) PNG-only round-trip]");
  {
    const src = synthGarment(320, 240);
    // Raw lossless round-trip first: encode -> decode is pixel-perfect.
    const rawDecoded = PhotoThumb.decodePng(new Uint8Array(PhotoThumb.encodePng(src.w, src.h, src.rgb)));
    assert.strictEqual(rawDecoded.w, src.w, "width survives");
    assert.strictEqual(rawDecoded.h, src.h, "height survives");
    assert.strictEqual(maxdiff(rawDecoded.rgb, src.rgb), 0, "PNG encode->decode is pixel-perfect");
    console.log("  pass: raw PNG round-trip maxdiff 0");

    const thumb = PhotoThumb.makeSync(pngUrl(src.w, src.h, src.rgb));
    assert.ok(typeof thumb === "string" && thumb.startsWith("data:image/png;base64,"),
      "makeSync emits a PNG data URL, got: " + String(thumb).slice(0, 40));
    const raw = Buffer.from(thumb.split(",")[1], "base64");
    assert.ok(raw.length <= PhotoThumb.BYTE_BUDGET,
      `thumb raw ${raw.length} fits BYTE_BUDGET ${PhotoThumb.BYTE_BUDGET}`);
    assert.ok(thumb.length <= PhotoThumb.MAX_CHARS, "thumb fits MAX_CHARS");
    assert.ok(thumb.length <= Wardrobe.PHOTO_THUMB_MAX_CHARS,
      "thumb fits the wardrobe per-piece bound (cross-module agreement)");
    const out = PhotoThumb.decodePng(new Uint8Array(raw));
    assert.ok(Math.max(out.w, out.h) <= PhotoThumb.MAX_DIM, `longest side ${Math.max(out.w, out.h)} <= MAX_DIM`);
    // Lossless end-to-end: decoded thumb equals the resampled source exactly.
    const expect = PhotoThumb.resampleFit(
      PhotoThumb.decodePng(Buffer.from(pngUrl(src.w, src.h, src.rgb).split(",")[1], "base64")),
      Math.max(out.w, out.h));
    assert.strictEqual(expect.w, out.w, "expected width matches");
    assert.strictEqual(expect.h, out.h, "expected height matches");
    assert.strictEqual(maxdiff(out.rgb, expect.rgb), 0, "thumb decodes pixel-perfect vs resampled source");
    console.log(`  pass: synthetic fixture thumb ${raw.length} raw bytes (${thumb.length} chars), ` +
      `${out.w}x${out.h}, maxdiff 0`);

    // Grayscale garment takes the color-type-0 path and still round-trips.
    const gray = new Uint8Array(64 * 48 * 3);
    for (let i = 0; i < gray.length; i += 3) { gray[i] = gray[i + 1] = gray[i + 2] = (i / 3) % 256; }
    const gThumb = PhotoThumb.makeSync(pngUrl(64, 48, gray));
    assert.ok(gThumb && gThumb.startsWith("data:image/png;base64,"), "gray fixture thumbs too");
    const gOut = PhotoThumb.decodePng(new Uint8Array(Buffer.from(gThumb.split(",")[1], "base64")));
    assert.strictEqual(maxdiff(gOut.rgb, PhotoThumb.resampleFit({ w: 64, h: 48, rgb: gray }, 96).rgb), 0,
      "gray thumb pixel-perfect");

    // JPEG bytes and garbage fail soft — never throw, never a thumb.
    const jpegMagic = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 10, 1, 2, 3, 4]).toString("base64");
    assert.strictEqual(PhotoThumb.makeSync(jpegMagic), null, "JPEG input -> null (PNG-only)");
    assert.strictEqual(PhotoThumb.makeSync("data:image/png;base64,AAAA"), null, "garbage -> null");
    assert.strictEqual(PhotoThumb.makeSync("not a url"), null, "non-URL -> null");
    assert.strictEqual(PhotoThumb.makeSync(null), null, "null -> null");
    console.log("  pass: JPEG/garbage/non-URL inputs all fail soft to null");
  }

  // --- (b) catalogue_piece stores photo_thumb, fail-soft without it ---
  console.log("\n[(b) catalogue_piece thumb capture]");
  {
    const src = synthGarment(160, 120);
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_thumb_b" });
    const r = await CataloguePiece.handle({
      catalog: cat, text: "my new dress", imageDataUrl: pngUrl(src.w, src.h, src.rgb),
    });
    assert.ok(/dress/.test(r.text), "reply names the piece");
    const pieces = cat.getActivePieces();
    assert.strictEqual(pieces.length, 1, "one piece catalogued");
    assert.ok(pieces[0].photo_thumb && pieces[0].photo_thumb.startsWith("data:image/png;base64,"),
      "photo_thumb stored on the piece");
    assert.ok(pieces[0].photo_thumb.length <= Wardrobe.PHOTO_THUMB_MAX_CHARS, "stored thumb within bound");
    console.log(`  pass: thumb stored (${pieces[0].photo_thumb.length} chars)`);

    const cat2 = Wardrobe.createCatalog({ userKey: "SYNTH_thumb_b2" });
    const r2 = await CataloguePiece.handle({
      catalog: cat2, text: "mystery scarf", imageDataUrl: "data:image/png;base64,AAAA",
    });
    const pieces2 = cat2.getActivePieces();
    assert.strictEqual(pieces2.length, 1, "undecodable image still catalogues");
    assert.ok(pieces2[0].photo_thumb === null || pieces2[0].photo_thumb === undefined,
      "no thumb stored for undecodable input");
    assert.ok(/piece|scarf/.test(r2.text), "reply still produced");
    console.log("  pass: undecodable image catalogues without a thumb");
  }

  // --- (c) propose_look uses stored thumbs, falls back without them ---
  console.log("\n[(c) propose_look reference wiring]");
  {
    const src = synthGarment(160, 120);
    const thumb = PhotoThumb.makeSync(pngUrl(src.w, src.h, src.rgb));
    assert.ok(thumb, "fixture thumb built");
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_thumb_c" });
    const dress = cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_c1", photo_thumb: thumb });
    cat.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_c2", photo_thumb: thumb });
    const seen = [];
    const mc = {
      assemble: async function () {
        return { looks: [{ pieceIds: [dress.piece_id, cat.getActivePieces()[1].piece_id], rationale: "Lovely pairing." }] };
      },
      preview: async function (prompt, image) {
        seen.push({ prompt: prompt, image: image === undefined ? null : image });
        return { dataURL: "data:image/png;base64,SYNTHPREVIEW" };
      },
    };
    const r = await ProposeLook.handle({ catalog: cat, metaClient: mc });
    assert.strictEqual(seen.length, 1, "preview called once");
    // Multi-reference: both selected pieces have thumbs, so preview receives both in order.
    const gotImages = Array.isArray(seen[0].image) ? seen[0].image : [seen[0].image];
    assert.strictEqual(gotImages.length, 2, "both thumbs forwarded");
    assert.ok(gotImages.every(function (u) { return u === thumb; }), "thumbs forwarded in order");
    assert.ok(/reference garment photo/.test(seen[0].prompt), "prompt notes the reference");
    assert.ok(/distinct wardrobe garment/.test(seen[0].prompt), "prompt preserves every reference distinctly");
    assert.strictEqual(r.meta.referenceThumb, true, "meta flags reference use");
    assert.strictEqual(r.meta.referencePieces, 2, "meta reports correct reference count");
    assert.ok(r.image && r.image.dataURL.startsWith("data:image/"), "preview image surfaced");
    console.log("  pass: stored thumbs forwarded to preview in order");

    // Old pieces without thumbs: text-only path still works.
    const catOld = Wardrobe.createCatalog({ userKey: "SYNTH_thumb_c_old" });
    catOld.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_co1" });
    catOld.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_co2" });
    const seenOld = [];
    const mcOld = {
      assemble: async function () {
        const ids = catOld.getActivePieces().map(function (p) { return p.piece_id; });
        return { looks: [{ pieceIds: ids, rationale: "Classic." }] };
      },
      preview: async function (prompt, image) {
        seenOld.push({ prompt: prompt, image: image === undefined ? null : image });
        return { dataURL: "data:image/png;base64,SYNTHPREVIEW" };
      },
    };
    const rOld = await ProposeLook.handle({ catalog: catOld, metaClient: mcOld });
    assert.strictEqual(seenOld.length, 1, "preview still called");
    assert.ok(seenOld[0].image === null, "no image reference without thumbs (text-only path)");
    assert.strictEqual(rOld.meta.referenceThumb, false, "meta flags no reference");
    assert.ok(rOld.image && rOld.image.dataURL.startsWith("data:image/"), "text-only preview still surfaced");
    console.log("  pass: pieces without thumbs keep the text-only prompt path");
  }

  console.log("\nAll photo-thumb reference tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
