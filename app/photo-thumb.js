"use strict";
/* meta-styles — photo thumbnail maker (NEW hackathon work, building period Oct 27 – Nov 4, 2026).
 *
 * Why this exists: a catalogued piece's original photo is unrecoverable
 * later — the bot deletes inbound media shortly after it is fetched
 * ("collected by client, deleted" in its own logs) — so a reference MUST
 * be captured at catalogue time or it is lost forever for that piece.
 * catalogue_piece calls makeSync() on the inbound imageDataUrl and stores
 * the result as the piece's `photo_thumb` (wardrobe-catalog schema);
 * propose_look later passes those thumbs as Muse Image reference inputs.
 *
 * PNG pure-JS; JPEG via optional Node ffmpeg conversion (2026-10-31):
 * an earlier revision carried a hand-written baseline JPEG codec whose
 * encode->decode path corrupted any 8x8 block with nonzero AC coefficients
 * (flat-DC blocks round-tripped exact; gradient blocks showed maxdiff ~100+;
 * Huffman/magnitude/DC/zigzag paths each verified clean in isolation, so
 * the fault sat in the coefficient-domain FDCT/quant path or MCU assembly).
 * Rather than debug the custom lossy codec further, the JPEG path was
 * removed and PNG kept pixel-perfect (maxdiff 0) via node:zlib. Live
 * Instagram photos are commonly JPEG data URLs, so Node now optionally
 * converts JPEG->PNG via the already-installed ffmpeg binary (spawnSync,
 * arg-array, no shell, stdin/stdout pipes, bounded I/O/time, no temp
 * files, no image-byte logging); the converted PNG then flows through the
 * same PNG decode/resample/crop/encode path so output stays <=96px,
 * <=10KB PNG. No npm dependency added. Browsers keep makeCanvas().
 *
 * Constraints honoured:
 * - stdlib-only, zero npm dependencies (same convention as the servers):
 *   PNG via node:zlib (guarded require — browsers use makeCanvas()
 *   instead); JPEG via optional ffmpeg executable (Node only, fail-soft
 *   to null when unavailable).
 * - Real resize, never a byte-budget trim of the original (a trim
 *   corrupts the image): decode -> box-average resample -> re-encode.
 * - Small output: longest side <= 96px, PNG raw bytes <= 10KB, so one
 *   thumb is ~14KB as a data URL and dozens of pieces still fit the
 *   bot-side 1MB whole-catalog PUT cap (mock-ig-bot MAX_SEND_BODY)
 *   with room to spare.
 * - Lossless filters only: the encoder picks the best of the five PNG
 *   filters per row (min sum of absolute residuals); the decoder already
 *   handles all filter types, so filtered output still round-trips exact.
 * - Fail-soft: anything undecodable (non-JPEG/PNG input, GIF/WebP
 *   in pure Node when ffmpeg cannot handle it, oversized input, garbage
 *   fixtures, missing ffmpeg) resolves null — the piece still catalogues,
 *   the preview just falls back to text description. JPEG conversion
 *   failure never blocks cataloguing. Never throws for bad input (only
 *   for programmer errors).
 *
 * All fixtures this module is tested with are synthetic gradients made
 * from scratch — never real photos.
 */
(function (root) {
  var MAX_DIM = 96;               // longest thumbnail side, px
  var BYTE_BUDGET = 10 * 1024;    // re-encoded thumb must fit (raw bytes)
  var MAX_CHARS = 20 * 1024;      // schema cap (wardrobe-catalog.js mirrors this bound)
  var REF_DIM = 384;              // reference size for Muse edit model (M25)
  var REF_BYTE_BUDGET = 500 * 1024; // 384px PNG typically 20-200KB, allow 500KB max
  var REF_MAX_CHARS = 800 * 1024; // ~500KB raw -> ~700KB base64
  var MAX_INPUT_BYTES = 20 * 1024 * 1024; // decode guard (CPU/DoS bound)
  var MAX_PIXELS = 12 * 1000 * 1000;      // decoded-pixel guard

  var ZLIB = null;
  try {
    if (typeof require !== "undefined") ZLIB = require("node:zlib");
  } catch (e) { ZLIB = null; }

  function fail(msg) { return new Error("photo-thumb: " + msg); }

  // data:image/<mime>;base64,<b64> -> { mime, bytes } or null.
  function parseDataUrl(s) {
    if (typeof s !== "string") return null;
    var m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(s);
    if (!m) return null;
    var bytes;
    try {
      if (typeof Buffer !== "undefined") bytes = Buffer.from(m[2], "base64");
      else {
        var bin = root.atob ? root.atob(m[2]) : null;
        if (bin === null) return null;
        bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
      }
    } catch (e) { return null; }
    if (!bytes || bytes.length === 0 || bytes.length > MAX_INPUT_BYTES) return null;
    return { mime: m[1].toLowerCase(), bytes: bytes };
  }

  function sniffKind(bytes) {
    if (!bytes || bytes.length < 4) return null;
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
        bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d &&
        bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
    return null;
  }

  function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
  function u32(b, o) {
    return ((b[o] * 16777216) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]) >>> 0;
  }

  function bytesToB64(bytes) {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    if (typeof btoa !== "undefined") return btoa(s);
    if (root.btoa) return root.btoa(s);
    throw fail("no base64 encoder in this environment");
  }

  // --- PNG decode (8-bit, non-interlaced) -> { w, h, rgb } ------------------
  // colorTypes 0 (gray), 2 (RGB), 3 (palette), 4 (gray+alpha), 6 (RGBA).
  // Alpha is flattened onto white; palette via PLTE (+tRNS). Anything else
  // (16-bit, interlaced, bad CRC-free layout) -> null via thrown fail().
  function paeth(a, b, c) {
    var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  function decodePng(bytes) {
    if (sniffKind(bytes) !== "png") throw fail("not a PNG");
    var pos = 8, idat = [], idatLen = 0;
    var w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = -1;
    var palette = null, trns = null;
    while (pos + 8 <= bytes.length) {
      var len = u32(bytes, pos);
      var type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
      var data = bytes.slice ? bytes.slice(pos + 8, pos + 8 + len) : null;
      if (type === "IHDR") {
        if (len !== 13) throw fail("bad IHDR");
        w = u32(bytes, pos + 8); h = u32(bytes, pos + 12);
        bitDepth = bytes[pos + 16]; colorType = bytes[pos + 17];
        interlace = bytes[pos + 20];
      } else if (type === "PLTE") {
        palette = data;
      } else if (type === "tRNS") {
        trns = data;
      } else if (type === "IDAT") {
        idat.push(data); idatLen += len;
      } else if (type === "IEND") {
        break;
      }
      pos += 12 + len;
    }
    if (w <= 0 || h <= 0 || w * h > MAX_PIXELS) throw fail("bad PNG dimensions");
    if (bitDepth !== 8) throw fail("only 8-bit PNG supported");
    if (interlace !== 0) throw fail("interlaced PNG unsupported");
    if (!ZLIB) throw fail("no inflate available (node:zlib)");
    var raw = Buffer.alloc(idatLen), off = 0;
    for (var c = 0; c < idat.length; c++) { Buffer.from(idat[c]).copy(raw, off); off += idat[c].length; }
    var inflated;
    try { inflated = ZLIB.inflateSync(raw); } catch (e) { throw fail("PNG inflate failed"); }
    var ch = (colorType === 0 || colorType === 3) ? 1 : (colorType === 4 ? 2 : (colorType === 2 ? 3 : 4));
    if (!(colorType === 0 || colorType === 2 || colorType === 3 || colorType === 4 || colorType === 6)) {
      throw fail("unsupported PNG color type " + colorType);
    }
    var stride = w * ch;
    if (inflated.length !== h * (stride + 1)) throw fail("PNG size mismatch");
    if (colorType === 3 && (!palette || palette.length % 3 !== 0)) throw fail("palette PNG without PLTE");
    var rgb = new Uint8Array(w * h * 3);
    var prev = new Uint8Array(stride);
    var p = 0;
    for (var y = 0; y < h; y++) {
      var f = inflated[p++];
      if (f > 4) throw fail("bad PNG filter");
      var cur = inflated.slice(p, p + stride); p += stride;
      for (var x = 0; x < stride; x++) {
        var a = x >= ch ? cur[x - ch] : 0, b = prev[x], cc = x >= ch ? prev[x - ch] : 0;
        var v = cur[x];
        if (f === 1) v += a;
        else if (f === 2) v += b;
        else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) v += paeth(a, b, cc);
        cur[x] = v & 0xff;
      }
      prev = cur;
      for (var px = 0; px < w; px++) {
        var r, g, bl, al = 255;
        if (colorType === 0) {
          r = g = bl = cur[px];
          if (trns && trns.length >= 2 && cur[px] === u16(trns, 0)) al = 0;
        } else if (colorType === 2) {
          r = cur[px * 3]; g = cur[px * 3 + 1]; bl = cur[px * 3 + 2];
          if (trns && trns.length >= 6 && r === u16(trns, 0) && g === u16(trns, 2) && bl === u16(trns, 4)) al = 0;
        } else if (colorType === 3) {
          var idx = cur[px] * 3;
          if (idx + 2 >= palette.length) throw fail("palette index out of range");
          r = palette[idx]; g = palette[idx + 1]; bl = palette[idx + 2];
          if (trns && cur[px] < trns.length) al = trns[cur[px]];
        } else if (colorType === 4) {
          r = g = bl = cur[px * 2]; al = cur[px * 2 + 1];
        } else {
          r = cur[px * 4]; g = cur[px * 4 + 1]; bl = cur[px * 4 + 2]; al = cur[px * 4 + 3];
        }
        var o = (y * w + px) * 3;
        if (al === 255) { rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = bl; }
        else if (al === 0) { rgb[o] = 255; rgb[o + 1] = 255; rgb[o + 2] = 255; }
        else { rgb[o] = ((r * al + 255 * (255 - al)) / 255) | 0; rgb[o + 1] = ((g * al + 255 * (255 - al)) / 255) | 0; rgb[o + 2] = ((bl * al + 255 * (255 - al)) / 255) | 0; }
      }
    }
    return { w: w, h: h, rgb: rgb };
  }

  // --- PNG encode (8-bit gray/RGB, lossless) ---------------------------------
  // Grayscale-detect: emit color type 0 when R==G==B everywhere (smaller).
  // Per-row filter selection: try all five filters, keep the row with the
  // smallest sum of absolute residuals. Filters are lossless and the
  // decoder above handles all of them, so selection only affects size —
  // a noisy gradient thumb that needs ~18KB unfiltered fits ~11KB
  // filtered at the same pixels. No palette/quantization step: colors stay
  // exact, so encode->decode still round-trips pixel-perfect.
  function encodePngRaw(w, h, rgb) {
    var gray = true;
    for (var i = 0; i < rgb.length; i += 3) {
      if (rgb[i] !== rgb[i + 1] || rgb[i] !== rgb[i + 2]) { gray = false; break; }
    }
    var ch = gray ? 1 : 3;
    var stride = w * ch;
    var raw = new Uint8Array(h * (stride + 1));
    var prev = new Uint8Array(stride);
    var line = new Uint8Array(stride);
    var trial = new Uint8Array(stride);
    var best = new Uint8Array(stride);
    var p = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) * 3;
        if (gray) line[x] = rgb[o];
        else { line[x * 3] = rgb[o]; line[x * 3 + 1] = rgb[o + 1]; line[x * 3 + 2] = rgb[o + 2]; }
      }
      var bestF = 0, bestScore = Infinity, f, x2;
      for (f = 0; f <= 4; f++) {
        var score = 0;
        for (x2 = 0; x2 < stride; x2++) {
          var a = x2 >= ch ? line[x2 - ch] : 0, b = prev[x2], cc = x2 >= ch ? prev[x2 - ch] : 0;
          var v = line[x2];
          if (f === 1) v -= a;
          else if (f === 2) v -= b;
          else if (f === 3) v -= (a + b) >> 1;
          else if (f === 4) v -= paeth(a, b, cc);
          trial[x2] = v & 0xff;
          score += v < 0 ? -v : v;
        }
        if (score < bestScore) { bestScore = score; bestF = f; best.set(trial); }
      }
      raw[p++] = bestF;
      raw.set(best, p); p += stride;
      prev.set(line);
    }
    return { raw: raw, colorType: gray ? 0 : 2 };
  }

  function crc32Table() {
    if (crc32Table.T) return crc32Table.T;
    var T = new Array(256), c;
    for (var n = 0; n < 256; n++) {
      c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      T[n] = c >>> 0;
    }
    crc32Table.T = T;
    return T;
  }
  function chunkBytes(type, data) {
    var T = crc32Table();
    var len = data.length;
    var out = new Uint8Array(12 + len);
    out[0] = (len >>> 24) & 0xff; out[1] = (len >>> 16) & 0xff;
    out[2] = (len >>> 8) & 0xff; out[3] = len & 0xff;
    var crc = 0xffffffff;
    for (var i = 0; i < 4; i++) {
      out[4 + i] = type.charCodeAt(i);
      crc = T[(crc ^ out[4 + i]) & 0xff] ^ (crc >>> 8);
    }
    for (var j = 0; j < len; j++) {
      out[8 + j] = data[j];
      crc = T[(crc ^ data[j]) & 0xff] ^ (crc >>> 8);
    }
    crc ^= 0xffffffff;
    out[8 + len] = (crc >>> 24) & 0xff; out[9 + len] = (crc >>> 16) & 0xff;
    out[10 + len] = (crc >>> 8) & 0xff; out[11 + len] = crc & 0xff;
    return out;
  }

  function encodePng(w, h, rgb) {
    if (!ZLIB) throw fail("no deflate available (node:zlib)");
    var enc = encodePngRaw(w, h, rgb);
    var ihdr = new Uint8Array(13);
    ihdr[0] = (w >>> 24) & 0xff; ihdr[1] = (w >>> 16) & 0xff;
    ihdr[2] = (w >>> 8) & 0xff; ihdr[3] = w & 0xff;
    ihdr[4] = (h >>> 24) & 0xff; ihdr[5] = (h >>> 16) & 0xff;
    ihdr[6] = (h >>> 8) & 0xff; ihdr[7] = h & 0xff;
    ihdr[8] = 8; ihdr[9] = enc.colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    var deflated = ZLIB.deflateSync(Buffer.from(enc.raw), { level: 9 });
    var sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    var parts = [sig, chunkBytes("IHDR", ihdr), chunkBytes("IDAT", new Uint8Array(deflated)), chunkBytes("IEND", new Uint8Array(0))];
    var total = 0, pi;
    for (pi = 0; pi < parts.length; pi++) total += parts[pi].length;
    var out = new Uint8Array(total), oo = 0;
    for (pi = 0; pi < parts.length; pi++) { out.set(parts[pi], oo); oo += parts[pi].length; }
    return out;
  }

  // --- Crop + resample + entry points -------------------------------------------
  // Crop decoded RGB pixels to a fractional rect [x, y, w, h] in [0,1]
  // (the SAM box shape: fractions of full width/height, NOT pixels).
  // Out-of-range edges are clamped to the image; a rect that is missing,
  // non-numeric, non-positive, or empty after clamping returns the image
  // unchanged (the caller then stores the whole-photo thumbnail).
  function cropPixels(img, rect) {
    if (!img || !img.rgb) return img;
    if (!Array.isArray(rect) || rect.length !== 4) return img;
    for (var i = 0; i < 4; i++) {
      if (typeof rect[i] !== "number" || !isFinite(rect[i])) return img;
    }
    if (rect[2] <= 0 || rect[3] <= 0) return img;
    var x0 = Math.max(0, Math.floor(rect[0] * img.w));
    var y0 = Math.max(0, Math.floor(rect[1] * img.h));
    var x1 = Math.min(img.w, Math.ceil((rect[0] + rect[2]) * img.w));
    var y1 = Math.min(img.h, Math.ceil((rect[1] + rect[3]) * img.h));
    if (x1 <= x0 || y1 <= y0) return img;
    var w = x1 - x0, h = y1 - y0, out = new Uint8Array(w * h * 3);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var s = ((y0 + y) * img.w + (x0 + x)) * 3, d = (y * w + x) * 3;
        out[d] = img.rgb[s]; out[d + 1] = img.rgb[s + 1]; out[d + 2] = img.rgb[s + 2];
      }
    }
    return { w: w, h: h, rgb: out };
  }

  // Box-average downscale of RGB to fit longest side <= dim (upscales never).
  function resampleFit(src, dim) {
    var scale = Math.min(1, dim / Math.max(src.w, src.h));
    var dw = Math.max(1, Math.round(src.w * scale));
    var dh = Math.max(1, Math.round(src.h * scale));
    if (dw === src.w && dh === src.h) return { w: dw, h: dh, rgb: src.rgb };
    var dst = new Uint8Array(dw * dh * 3);
    var x0, x1, y0, y1, dx, dy;
    for (dy = 0; dy < dh; dy++) {
      y0 = Math.floor((dy * src.h) / dh); y1 = Math.floor(((dy + 1) * src.h) / dh);
      if (y1 <= y0) y1 = y0 + 1;
      for (dx = 0; dx < dw; dx++) {
        x0 = Math.floor((dx * src.w) / dw); x1 = Math.floor(((dx + 1) * src.w) / dw);
        if (x1 <= x0) x1 = x0 + 1;
        var r = 0, g = 0, b = 0, n = 0, x, y;
        for (y = y0; y < y1; y++) {
          for (x = x0; x < x1; x++) {
            var o = (y * src.w + x) * 3;
            r += src.rgb[o]; g += src.rgb[o + 1]; b += src.rgb[o + 2]; n++;
          }
        }
        var od = (dy * dw + dx) * 3;
        dst[od] = Math.round(r / n); dst[od + 1] = Math.round(g / n); dst[od + 2] = Math.round(b / n);
      }
    }
    return { w: dw, h: dh, rgb: dst };
  }

  // --- JPEG -> PNG via optional ffmpeg (Node only) ----------------------
  // Converts JPEG input bytes to PNG bytes using the system ffmpeg binary
  // when available. Bounded: input already capped by MAX_INPUT_BYTES,
  // output capped, no shell, arg-array only, stdin/stdout pipes, timeout,
  // no temp files, no image-byte logging. Returns Uint8Array PNG or null.
  // Never throws for bad input; programmer errors still throw fail().
  function jpegToPngBytes(jpegBytes, targetDim) {
    if (!jpegBytes || jpegBytes.length === 0 || jpegBytes.length > MAX_INPUT_BYTES) return null;
    var dim = typeof targetDim === "number" && targetDim > 0 ? targetDim : 96;
    // Clamp dim to REF_DIM to avoid unbounded ffmpeg scale.
    if (dim > REF_DIM) dim = REF_DIM;
    var cp = null;
    try {
      if (typeof require === "undefined") return null;
      cp = require("node:child_process");
    } catch (e) { return null; }
    if (!cp || typeof cp.spawnSync !== "function") return null;
    try {
      var res = cp.spawnSync("ffmpeg", [
        "-hide_banner", "-loglevel", "error",
        "-f", "image2pipe", "-i", "pipe:0",
        "-frames:v", "1",
        "-vf", "scale=w=" + dim + ":h=" + dim + ":force_original_aspect_ratio=decrease",
        "-f", "image2pipe", "-vcodec", "png",
        "pipe:1"
      ], {
        input: Buffer.from(jpegBytes),
        maxBuffer: 4 * 1024 * 1024,
        timeout: 5000,
        windowsHide: true
      });
      if (!res || res.error || res.status !== 0) return null;
      var out = res.stdout;
      if (!out || out.length === 0) return null;
      if (out.length < 8 || out[0] !== 0x89 || out[1] !== 0x50 || out[2] !== 0x4e || out[3] !== 0x47) return null;
      return new Uint8Array(out);
    } catch (e) {
      return null;
    }
  }

  // PNG pure-JS; JPEG via optional Node ffmpeg conversion. Any other kind
  // (GIF/WebP, garbage with an image data-URL wrapper) throws fail() and
  // the caller maps it to null — the piece still catalogues without a thumb.
  // JPEG conversion failure also maps to fail() so callers keep fail-soft.
  function decodePixels(bytes, targetDim) {
    var kind = sniffKind(bytes);
    if (kind === "png") return decodePng(bytes);
    if (kind === "jpeg") {
      var pngBytes = jpegToPngBytes(bytes, targetDim);
      if (pngBytes) return decodePng(pngBytes);
      throw fail("JPEG conversion unavailable or failed");
    }
    throw fail("unsupported image kind for thumbnail (PNG pure-JS; JPEG via optional ffmpeg)");
  }

  // Synchronous path (Node stdlib + optional ffmpeg for JPEG).
  // Returns a small data:image/png;base64,... thumbnail or null.
  // PNG is handled pure-JS via node:zlib; JPEG is converted via optional
  // Node ffmpeg (spawnSync, bounded, fail-soft to null) then decoded the
  // same way so output stays <=96px, <=10KB PNG. Optional cropRect
  // ([x,y,w,h] fractions in [0,1], the SAM box shape) crops the decoded
  // pixels BEFORE resampling; invalid rects keep the whole photo. Never
  // throws for bad input — null means "catalogue without a thumb".
  // Optional dim (number) requests a larger reference (e.g. 384px for
  // Muse edit model); JPEG sources go through the same ffmpeg path with
  // size argument, same fail-soft semantics.
  function makeSync(dataUrl, cropRect, dim) {
    try {
      // Backward-compat: makeSync(url, 384) -> dim=384, no crop.
      if (typeof cropRect === "number" && dim === undefined) {
        dim = cropRect; cropRect = null;
      }
      var targetDim = typeof dim === "number" && dim > 0 ? dim : MAX_DIM;
      if (targetDim > REF_DIM) targetDim = REF_DIM;
      var isRef = targetDim > MAX_DIM;
      var byteBudget = isRef ? REF_BYTE_BUDGET : BYTE_BUDGET;
      var charCap = isRef ? REF_MAX_CHARS : MAX_CHARS;
      var parsed = parseDataUrl(dataUrl);
      if (!parsed) return null;
      var img = decodePixels(parsed.bytes, targetDim);
      if (cropRect) img = cropPixels(img, cropRect);
      var dims;
      if (isRef) {
        dims = [targetDim, Math.round(targetDim * 0.75), Math.round(targetDim * 0.5), 96].filter(function (d) { return d > 0 && d <= targetDim; });
        // dedupe
        var seen = {}; dims = dims.filter(function (d){ if(seen[d]) return false; seen[d]=true; return true; });
      } else {
        dims = [96, 80, 64, 48].filter(function (d) { return d <= MAX_DIM; });
        if (dims.length === 0) dims = [MAX_DIM];
      }
      for (var di = 0; di < dims.length; di++) {
        var small = resampleFit(img, dims[di]);
        var bytes = encodePng(small.w, small.h, small.rgb);
        if (bytes.length <= byteBudget) {
          var url = "data:image/png;base64," + bytesToB64(bytes);
          if (url.length <= charCap) return url;
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // Browser path: real downscale via canvas (any format the browser
  // decodes, including WebP/GIF the pure-JS path rejects). Async.
  // Resolves null on any failure. Unused in Node (no document).
  function makeCanvas(dataUrl, opts) {
    try {
      var doc = root.document;
      if (!doc || typeof doc.createElement !== "function" || typeof Image === "undefined") {
        return Promise.resolve(null);
      }
      var dim = (opts && opts.dim) || MAX_DIM;
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          try {
            var iw = img.naturalWidth || img.width;
            var ih2 = img.naturalHeight || img.height;
            if (!iw || !ih2) { resolve(null); return; }
            var scale = Math.min(1, dim / Math.max(iw, ih2));
            var canvas = doc.createElement("canvas");
            canvas.width = Math.max(1, Math.round(iw * scale));
            canvas.height = Math.max(1, Math.round(ih2 * scale));
            var ctx = canvas.getContext("2d");
            if (!ctx) { resolve(null); return; }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            var url = null;
            try { url = canvas.toDataURL("image/png"); } catch (e) { url = null; }
            if (typeof url !== "string" || url.length > MAX_CHARS) { resolve(null); return; }
            resolve(url);
          } catch (e) { resolve(null); }
        };
        img.onerror = function () { resolve(null); };
        img.src = dataUrl;
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function isValidPhotoThumb(s) {
    return typeof s === "string" && s.length <= MAX_CHARS &&
      (s.indexOf("data:image/png;base64,") === 0 || s.indexOf("data:image/jpeg;base64,") === 0);
  }

  var api = {
    MAX_DIM: MAX_DIM,
    BYTE_BUDGET: BYTE_BUDGET,
    MAX_CHARS: MAX_CHARS,
    REF_DIM: REF_DIM,
    REF_BYTE_BUDGET: REF_BYTE_BUDGET,
    REF_MAX_CHARS: REF_MAX_CHARS,
    sniffKind: sniffKind,
    parseDataUrl: parseDataUrl,
    decodePng: decodePng,
    encodePng: encodePng,
    cropPixels: cropPixels,
    resampleFit: resampleFit,
    isValidPhotoThumb: isValidPhotoThumb,
    jpegToPngBytes: jpegToPngBytes,
    makeSync: makeSync,
    makeCanvas: makeCanvas,
  };

  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.photoThumb = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
