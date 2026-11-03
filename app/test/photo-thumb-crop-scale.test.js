"use strict";
/* meta-styles — JPEG crop-before-scale + makeRefSync regression test.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves, with synthetic fixtures only (ffmpeg lavfi solid colours, never
 * a real photo):
 *  (a) makeSync(jpegUrl, rightHalfRect, 96) crops the FULL-RES frame
 *      before scaling: the right-half (solid red) crop fills the 96px
 *      output (longest side 96) and the centre pixel is red. The old
 *      downscale-then-crop order would return a ~48x60 sliver here.
 *  (b) makeRefSync(jpegUrl, rightHalfRect, 384) returns a compact JPEG
 *      reference of the cropped region (longest side 384, raw well under
 *      1 MB) whose centre pixel is the right-half colour — not a sliver
 *      of the downscaled whole photo, and not the whole photo itself.
 *
 * If ffmpeg is missing the fixture cannot be generated; the test skips
 * cleanly (same optional-dependency contract as photo-thumb-jpeg.test.js).
 *
 * Run: node app/test/photo-thumb-crop-scale.test.js
 */
const assert = require("assert");
const cp = require("node:child_process");
const PhotoThumb = require("../photo-thumb.js");

// Left half solid blue, right half solid red, WxH total.
function makeHalvedJpeg(halfW, h) {
  try {
    const r = cp.spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=c=0x0000FF:size=${halfW}x${h}:rate=1`,
      "-f", "lavfi", "-i", `color=c=0xFF0000:size=${halfW}x${h}:rate=1`,
      "-filter_complex", "hstack",
      "-frames:v", "1", "-q:v", "5",
      "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"
    ], { maxBuffer: 32 * 1024 * 1024, timeout: 10000 });
    if (!r || r.status !== 0 || !r.stdout || r.stdout.length === 0) return null;
    return "data:image/jpeg;base64," + r.stdout.toString("base64");
  } catch (e) { return null; }
}

// Decode any image data URL (PNG pure-JS; JPEG via ffmpeg) to {w,h,rgb}.
function decodeUrl(url) {
  const b64 = url.split(",")[1];
  if (url.indexOf("data:image/png;base64,") === 0) {
    return PhotoThumb.decodePng(new Uint8Array(Buffer.from(b64, "base64")));
  }
  const r = cp.spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "image2pipe", "-i", "pipe:0",
    "-frames:v", "1",
    "-f", "image2pipe", "-vcodec", "png", "pipe:1"
  ], { input: Buffer.from(b64, "base64"), maxBuffer: 16 * 1024 * 1024, timeout: 8000 });
  if (!r || r.status !== 0 || !r.stdout || r.stdout.length === 0) return null;
  return PhotoThumb.decodePng(new Uint8Array(r.stdout));
}

function centrePx(img) {
  const cx = Math.floor(img.w / 2), cy = Math.floor(img.h / 2);
  const o = (cy * img.w + cx) * 3;
  return [img.rgb[o], img.rgb[o + 1], img.rgb[o + 2]];
}

function rawLen(url) {
  return Buffer.from(url.split(",")[1], "base64").length;
}

async function run() {
  console.log("photo-thumb-crop-scale.test.js");
  const jpegUrl = makeHalvedJpeg(540, 675); // 1080x675 total, right half red
  if (!jpegUrl) {
    console.log("  skip: ffmpeg unavailable to generate JPEG fixture — optional dependency");
    const fakeJpeg = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 10, 1, 2, 3, 4]).toString("base64");
    assert.strictEqual(PhotoThumb.makeSync(fakeJpeg, [0.5, 0, 0.5, 1], 96), null, "truncated JPEG -> null even without ffmpeg");
    assert.strictEqual(PhotoThumb.makeRefSync(fakeJpeg, [0.5, 0, 0.5, 1], 384), null, "truncated JPEG ref -> null even without ffmpeg");
    console.log("  pass: truncated JPEG still fail-soft to null (optional ffmpeg contract)");
    return;
  }

  const RIGHT = [0.5, 0, 0.5, 1];

  // --- (a) makeSync crops full-res before scaling ---
  console.log("\n[(a) makeSync JPEG crop-first]");
  {
    const thumb = PhotoThumb.makeSync(jpegUrl, RIGHT, 96);
    assert.ok(typeof thumb === "string" && thumb.startsWith("data:image/png;base64,"), "cropped thumb is a PNG data URL");
    assert.ok(rawLen(thumb) <= PhotoThumb.BYTE_BUDGET, "thumb fits BYTE_BUDGET");
    const out = decodeUrl(thumb);
    assert.ok(out, "thumb decodes");
    // Right-half region is 540x675 -> scaled to fit 96 keeps longest 96.
    // Downscale-then-crop would give a 48x60 sliver instead.
    assert.strictEqual(Math.max(out.w, out.h), 96,
      `cropped thumb fills 96px, got ${out.w}x${out.h} (a sliver means crop ran after downscale)`);
    const [r, g, b] = centrePx(out);
    assert.ok(r > 180 && g < 120 && b < 120,
      `centre pixel is the right-half red, got [${r},${g},${b}]`);
    console.log(`  pass: thumb ${out.w}x${out.h} centre [${r},${g},${b}]`);
  }

  // --- (b) makeRefSync returns a compact JPEG of the cropped region ---
  console.log("\n[(b) makeRefSync JPEG cropped reference]");
  {
    const ref = PhotoThumb.makeRefSync(jpegUrl, RIGHT, 384);
    assert.ok(typeof ref === "string" && ref.startsWith("data:image/jpeg;base64,"),
      "reference prefers JPEG, got: " + String(ref).slice(0, 40));
    assert.ok(rawLen(ref) <= PhotoThumb.REF_JPEG_BUDGET,
      `reference raw ${rawLen(ref)} <= REF_JPEG_BUDGET ${PhotoThumb.REF_JPEG_BUDGET}`);
    assert.ok(rawLen(ref) < 1024 * 1024, "reference well under 1 MB");
    const out = decodeUrl(ref);
    assert.ok(out, "reference decodes");
    // Right-half region is 540x675 -> scaled to fit 384 keeps longest 384.
    // Downscale-then-crop would give a 192x240 sliver instead.
    assert.strictEqual(Math.max(out.w, out.h), 384,
      `cropped reference fills 384px, got ${out.w}x${out.h} (a sliver means crop ran after downscale)`);
    const [r, g, b] = centrePx(out);
    assert.ok(r > 180 && g < 120 && b < 120,
      `centre pixel is the right-half red, got [${r},${g},${b}]`);
    const whole = PhotoThumb.makeRefSync(jpegUrl, null, 384);
    assert.ok(whole && whole !== ref, "cropped reference differs from the whole-photo reference");
    console.log(`  pass: ref ${out.w}x${out.h} raw ${rawLen(ref)} bytes centre [${r},${g},${b}]`);
  }

  console.log("\nAll photo-thumb crop-scale tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
