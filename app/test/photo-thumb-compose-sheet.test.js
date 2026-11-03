"use strict";
/* meta-styles — composite reference sheet tests (M27 slot-overflow work).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves app/photo-thumb.js composeSheetSync, with synthetic fixtures
 * only (locally generated solid-colour PNGs via the repo's own encoder,
 * SYNTH_ ids — never real photos):
 *  - 6 distinct solid-colour refs compose into ONE image whose decoded
 *    cell centres match the inputs in grid order; longest side <= 1024;
 *    included = [0..5]; cols/rows follow the ceil(sqrt) grid;
 *  - one garbage input is skipped (excluded from included), never fatal;
 *  - all-garbage / empty / non-array inputs return null, never throw.
 *
 * Run: node app/test/photo-thumb-compose-sheet.test.js
 */
const assert = require("assert");
const PhotoThumb = require("../photo-thumb.js");

function solidUrl(r, g, b) {
  const rgb = new Uint8Array(32 * 32 * 3);
  for (let i = 0; i < rgb.length; i += 3) { rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b; }
  return "data:image/png;base64," +
    Buffer.from(PhotoThumb.encodePng(32, 32, rgb)).toString("base64");
}

const COLOURS = [
  [220, 40, 40], [40, 220, 40], [40, 40, 220],
  [220, 220, 40], [220, 40, 220], [40, 220, 220],
];

// Decode a composite (PNG exact, or JPEG via the ffmpeg path scaled to
// 384px on the long side) and return { img, scale } where scale maps
// full-sheet coordinates onto the decoded pixels.
function decodeSheet(url) {
  const parsed = PhotoThumb.parseDataUrl(url);
  assert.ok(parsed, "composite parses as a data URL");
  const kind = PhotoThumb.sniffKind(parsed.bytes);
  if (kind === "png") return { img: PhotoThumb.decodePng(parsed.bytes), scale: 1 };
  assert.strictEqual(kind, "jpeg", "composite is JPEG or PNG, got " + kind);
  const png = PhotoThumb.jpegToPngBytes(parsed.bytes, 384);
  assert.ok(png, "JPEG composite converts for sampling");
  return { img: PhotoThumb.decodePng(png), scale: null }; // scale fixed below
}

function sheetGeometry(cols, rows) {
  const M = PhotoThumb.SHEET_MARGIN, G = PhotoThumb.SHEET_GUTTER;
  const m = Math.max(cols, rows);
  const cell = Math.min(PhotoThumb.SHEET_CELL_MAX,
    Math.floor((PhotoThumb.SHEET_MAX_SIDE - G * (m + 1)) / m));
  return {
    cell: cell,
    w: M * 2 + cols * cell + (cols - 1) * G,
    h: M * 2 + rows * cell + (rows - 1) * G,
  };
}

function centreOf(geo, cols, k) {
  const M = PhotoThumb.SHEET_MARGIN, G = PhotoThumb.SHEET_GUTTER;
  const row = Math.floor(k / cols), col = k % cols;
  return {
    x: M + col * (geo.cell + G) + Math.floor(geo.cell / 2),
    y: M + row * (geo.cell + G) + Math.floor(geo.cell / 2),
  };
}

async function run() {
  console.log("photo-thumb-compose-sheet.test.js");

  // --- 6 solid refs -> one sheet, colours in grid order ---
  console.log("\n[(a) six solid refs compose into one sheet]");
  {
    const urls = COLOURS.map(function (c) { return solidUrl(c[0], c[1], c[2]); });
    const sheet = PhotoThumb.composeSheetSync(urls);
    assert.ok(sheet && typeof sheet.url === "string" && /^data:image\//.test(sheet.url),
      "compose returns a data URL, got " + JSON.stringify(sheet).slice(0, 120));
    assert.deepStrictEqual(sheet.included, [0, 1, 2, 3, 4, 5], "included names every input in grid order");
    assert.strictEqual(sheet.cols, 3, "cols = ceil(sqrt(6))");
    assert.strictEqual(sheet.rows, 2, "rows = ceil(6/3)");

    const geo = sheetGeometry(sheet.cols, sheet.rows);
    assert.ok(geo.cell >= 1 && geo.cell <= PhotoThumb.SHEET_CELL_MAX, "cell side bounded, got " + geo.cell);
    const got = decodeSheet(sheet.url);
    const img = got.img;
    const scale = got.scale === 1 ? 1 : img.w / geo.w;
    assert.ok(Math.max(img.w, img.h) <= 1024,
      "decoded longest side <= 1024, got " + img.w + "x" + img.h);
    assert.ok(Math.abs(img.w / img.h - geo.w / geo.h) < 0.05,
      "decoded aspect matches the grid geometry");
    for (let k = 0; k < 6; k++) {
      const c = centreOf(geo, sheet.cols, k);
      const x = Math.min(img.w - 1, Math.round(c.x * scale));
      const y = Math.min(img.h - 1, Math.round(c.y * scale));
      const o = (y * img.w + x) * 3;
      const exp = COLOURS[k];
      const d = Math.max(Math.abs(img.rgb[o] - exp[0]),
        Math.abs(img.rgb[o + 1] - exp[1]), Math.abs(img.rgb[o + 2] - exp[2]));
      assert.ok(d <= 30, "cell " + k + " centre matches input " + exp + ", got [" +
        img.rgb[o] + "," + img.rgb[o + 1] + "," + img.rgb[o + 2] + "] (maxdiff " + d + ")");
    }
    console.log("  pass: one image (" + sheet.url.slice(5, 20) + ", " +
      sheet.url.length + " chars), 6 cell centres match in grid order");
  }

  // --- garbage is skipped, not fatal ---
  console.log("\n[(b) garbage input is skipped]");
  {
    const urls = COLOURS.map(function (c) { return solidUrl(c[0], c[1], c[2]); });
    const mixed = ["data:image/png;base64,AAAA"].concat(urls);
    const sheet = PhotoThumb.composeSheetSync(mixed);
    assert.ok(sheet && /^data:image\//.test(sheet.url), "sheet still composes");
    assert.deepStrictEqual(sheet.included, [1, 2, 3, 4, 5, 6],
      "garbage index excluded, good inputs kept in order");
    console.log("  pass: garbage skipped, included = [1..6]");
  }

  // --- nothing decodable -> null, never throws ---
  console.log("\n[(c) null cases never throw]");
  {
    assert.strictEqual(PhotoThumb.composeSheetSync(["x", "data:image/png;base64,AAAA"]), null,
      "all-garbage -> null");
    assert.strictEqual(PhotoThumb.composeSheetSync([]), null, "empty -> null");
    assert.strictEqual(PhotoThumb.composeSheetSync(null), null, "non-array -> null");
    assert.strictEqual(PhotoThumb.composeSheetSync("data:image/png;base64,AAAA"), null,
      "non-array string -> null");
    console.log("  pass: all null cases return null without throwing");
  }

  console.log("\nAll photo-thumb compose-sheet tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
