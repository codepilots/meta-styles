"use strict";
/* meta-styles — catalogue_piece honest-copy tests (Opus finding #4, part 2).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Covers app/skills/catalogue_piece/handler.js: when no piece was actually
 * catalogued (pieces.length === 0) the reply must NOT claim the piece was
 * tucked into the wardrobe:
 *  (a) imageDataUrl present but catalog.addPiece always throws (both the
 *      first attempt and the bare retry fail) -> honest copy, no
 *      "tucked safely in your wardrobe".
 *  (b) catalog null + imageDataUrl present -> honest copy.
 *  (c) imageDataUrl null (pre-fix unreachable path, still tested) -> honest
 *      copy, and nothing catalogued.
 *  (d) success path (real imageDataUrl, working addPiece) -> the existing
 *      "tucked safely" copy still fires (no regression).
 * All fixtures synthetic (SYNTH_ prefix); no network — metaClient omitted so
 * classify/segment fall back, thumb capture fail-softs.
 */
const assert = require("assert");
const Wardrobe = require("../wardrobe-catalog.js");
const Handler = require("../skills/catalogue_piece/handler.js");

const SUCCESS_FRAG = "tucked safely in your wardrobe";
const HONEST_FRAG = "couldn't get that piece tucked";
const DURL = "data:image/png;base64,SYNTH_catalogue_piece_bytes";

function throwingCatalog() {
  return {
    addPiece: function () { throw new Error("SYNTH store down"); },
    save: async function () { return { ok: true }; },
  };
}

async function run() {
  console.log("catalogue_piece.test.js");

  // --- (a) addPiece always throws -> honest copy, no false success ---
  console.log("\n[addPiece throws -> honest copy]");
  {
    const r = await Handler.handle({
      catalog: throwingCatalog(), text: "SYNTH dress", imageDataUrl: DURL,
      shareId: "SYNTH_share_fail_1",
    });
    assert.strictEqual(r.skill, "catalogue_piece", "skill name");
    assert.ok(!r.text.includes(SUCCESS_FRAG),
      "must NOT claim success, got: " + r.text);
    assert.ok(r.text.includes(HONEST_FRAG),
      "honest retry copy, got: " + r.text);
    console.log("  pass: throwing store -> honest copy");
  }

  // --- (b) catalog null + image present -> honest copy ---
  console.log("\n[null catalog -> honest copy]");
  {
    const r = await Handler.handle({
      catalog: null, text: "SYNTH scarf", imageDataUrl: DURL,
      shareId: "SYNTH_share_fail_2",
    });
    assert.ok(!r.text.includes(SUCCESS_FRAG),
      "must NOT claim success, got: " + r.text);
    assert.ok(r.text.includes(HONEST_FRAG),
      "honest retry copy, got: " + r.text);
    console.log("  pass: null catalog -> honest copy");
  }

  // --- (c) imageDataUrl null -> honest copy, nothing catalogued ---
  console.log("\n[null image -> honest copy, nothing stored]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_piece_nullimg_" + Date.now() });
    const before = cat.getActivePieces().length;
    const r = await Handler.handle({
      catalog: cat, text: "SYNTH bag", imageDataUrl: null,
      shareId: "SYNTH_share_fail_3",
    });
    assert.ok(!r.text.includes(SUCCESS_FRAG),
      "must NOT claim success, got: " + r.text);
    assert.ok(r.text.includes(HONEST_FRAG),
      "honest retry copy, got: " + r.text);
    assert.strictEqual(cat.getActivePieces().length, before, "nothing catalogued");
    console.log("  pass: null image -> honest copy, store untouched");
  }

  // --- (d) success path unchanged ---
  console.log("\n[working store + image -> success copy]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_piece_ok_" + Date.now() });
    const r = await Handler.handle({
      catalog: cat, text: "SYNTH dress for the party", imageDataUrl: DURL,
      shareId: "SYNTH_share_ok_1",
    });
    assert.ok(r.text.includes(SUCCESS_FRAG),
      "success copy still fires, got: " + r.text);
    assert.ok(cat.getActivePieces().some(function (p) {
      return !!p && p.source_share_id === "SYNTH_share_ok_1";
    }), "piece catalogued with the real share id");
    console.log("  pass: success copy intact, piece stored");
  }

  console.log("\nAll catalogue_piece tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
