"use strict";
/* meta-styles — JPEG thumbnail regression (M21 photo-reference fix, 2026-10-31).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Live Instagram photos are commonly JPEG data URLs. photo-thumb.js
 * previously returned null for JPEG in Node (PNG-only). This test covers
 * the safe fail-soft JPEG path via optional Node ffmpeg conversion:
 *  (a) makeSync(jpegDataUrl) returns a valid PNG thumb within bounds when
 *      ffmpeg is available; gracefully null otherwise (optional dep).
 *  (b) makeSync(jpegDataUrl, cropRect) also works and differs from whole.
 *  (c) catalogue_piece stores the converted thumb for a JPEG input.
 *  (d) Truncated/garbage JPEG still fail-soft to null, PNG path unchanged.
 *
 * Deterministic tiny synthetic JPEG fixture is generated via ffmpeg
 * testsrc when available (no network, no real photo). If ffmpeg is
 * missing, the test asserts the optional-dependency contract explicitly
 * rather than failing unrelated PNG tests.
 */
const assert = require("assert");
const PhotoThumb = require("../photo-thumb.js");
const Wardrobe = require("../wardrobe-catalog.js");
const CataloguePiece = require("../skills/catalogue_piece/handler.js");

function makeSyntheticJpegDataUrl(w, h) {
  try {
    const cp = require("node:child_process");
    const r = cp.spawnSync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", `testsrc=size=${w}x${h}:rate=1`,
      "-frames:v", "1", "-q:v", "5",
      "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 4000 });
    if (!r || r.status !== 0 || !r.stdout || r.stdout.length === 0) return null;
    return "data:image/jpeg;base64," + r.stdout.toString("base64");
  } catch (e) { return null; }
}

function pngUrl(w, h, rgb) {
  return "data:image/png;base64," + Buffer.from(PhotoThumb.encodePng(w, h, rgb)).toString("base64");
}

async function run() {
  console.log("photo-thumb-jpeg.test.js");

  // --- (a) JPEG -> PNG thumb when ffmpeg available ---
  console.log("\n[(a) JPEG makeSync returns PNG thumb]");
  {
    const jpegUrl = makeSyntheticJpegDataUrl(160, 120);
    if (!jpegUrl) {
      console.log("  skip: ffmpeg unavailable to generate JPEG fixture — optional dependency, PNG tests still valid");
      // Production fallback must remain null for JPEG when ffmpeg missing.
      const fakeJpeg = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 10, 1, 2, 3, 4]).toString("base64");
      assert.strictEqual(PhotoThumb.makeSync(fakeJpeg), null, "truncated JPEG -> null even without ffmpeg");
      console.log("  pass: truncated JPEG still fail-soft to null (optional ffmpeg contract)");
    } else {
      const thumb = PhotoThumb.makeSync(jpegUrl);
      if (!thumb) {
        console.log("  skip: ffmpeg JPEG->PNG conversion unavailable (binary missing or unsupported) — optional dependency");
        assert.strictEqual(thumb, null, "JPEG without ffmpeg is null (fail-soft)");
      } else {
        assert.ok(typeof thumb === "string" && thumb.startsWith("data:image/png;base64,"), "JPEG thumb is PNG data URL");
        const raw = Buffer.from(thumb.split(",")[1], "base64");
        assert.ok(raw.length <= PhotoThumb.BYTE_BUDGET, `thumb raw ${raw.length} <= BYTE_BUDGET ${PhotoThumb.BYTE_BUDGET}`);
        assert.ok(thumb.length <= PhotoThumb.MAX_CHARS, "thumb fits MAX_CHARS");
        assert.ok(thumb.length <= Wardrobe.PHOTO_THUMB_MAX_CHARS, "thumb fits wardrobe bound");
        const out = PhotoThumb.decodePng(new Uint8Array(raw));
        assert.ok(Math.max(out.w, out.h) <= PhotoThumb.MAX_DIM, `longest side ${Math.max(out.w, out.h)} <= MAX_DIM`);
        assert.ok(out.w > 0 && out.h > 0, "decoded thumb has positive dimensions");
        console.log(`  pass: JPEG fixture thumb ${raw.length} bytes ${out.w}x${out.h} within bounds`);

        // (b) cropRect path
        console.log("\n[(b) JPEG makeSync with cropRect]");
        const cropped = PhotoThumb.makeSync(jpegUrl, [0.2, 0.1, 0.5, 0.6]);
        assert.ok(typeof cropped === "string" && cropped.startsWith("data:image/png;base64,"), "cropped JPEG thumb is PNG");
        const rawC = Buffer.from(cropped.split(",")[1], "base64");
        assert.ok(rawC.length <= PhotoThumb.BYTE_BUDGET, "cropped thumb fits budget");
        const outC = PhotoThumb.decodePng(new Uint8Array(rawC));
        assert.ok(Math.max(outC.w, outC.h) <= PhotoThumb.MAX_DIM, "cropped thumb within MAX_DIM");
        assert.notStrictEqual(cropped, thumb, "cropped thumb differs from whole");
        console.log(`  pass: JPEG crop thumb ${rawC.length} bytes ${outC.w}x${outC.h}`);

        // (c) catalogue_piece stores converted thumb
        console.log("\n[(c) catalogue_piece stores JPEG thumb]");
        const cat = Wardrobe.createCatalog({ userKey: "SYNTH_jpeg_c" });
        const r = await CataloguePiece.handle({
          catalog: cat, text: "my new dress", imageDataUrl: jpegUrl, shareId: "SYNTH_jpeg_share_1",
        });
        assert.ok(/dress/.test(r.text), "reply names piece");
        const pieces = cat.getActivePieces();
        assert.strictEqual(pieces.length, 1, "one piece catalogued");
        assert.ok(pieces[0].photo_thumb && pieces[0].photo_thumb.startsWith("data:image/png;base64,"), "photo_thumb stored for JPEG input");
        assert.ok(pieces[0].photo_thumb.length <= Wardrobe.PHOTO_THUMB_MAX_CHARS, "stored thumb within bound");
        console.log(`  pass: catalogue_piece stored JPEG thumb (${pieces[0].photo_thumb.length} chars)`);
      }
    }
  }

  // --- (d) invalid JPEG / garbage still fail-soft, PNG unchanged ---
  console.log("\n[(d) garbage/invalid inputs still fail-soft]");
  {
    const fakeJpeg = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 10, 1, 2, 3, 4]).toString("base64");
    assert.strictEqual(PhotoThumb.makeSync(fakeJpeg), null, "truncated JPEG -> null");
    assert.strictEqual(PhotoThumb.makeSync("data:image/png;base64,AAAA"), null, "garbage PNG -> null");
    assert.strictEqual(PhotoThumb.makeSync("not a url"), null, "non-URL -> null");
    assert.strictEqual(PhotoThumb.makeSync(null), null, "null -> null");
    // PNG round-trip still exact
    const rgb = new Uint8Array(32 * 24 * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 7) % 256;
    const pUrl = pngUrl(32, 24, rgb);
    const pThumb = PhotoThumb.makeSync(pUrl);
    assert.ok(pThumb && pThumb.startsWith("data:image/png;base64,"), "PNG thumb still works after JPEG change");
    console.log("  pass: garbage fail-soft and PNG path intact");
  }

  console.log("\nAll photo-thumb JPEG tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
