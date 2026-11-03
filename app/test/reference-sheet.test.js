"use strict";
/* meta-styles — reference-sheet slot-overflow tests (M27).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * The proxy accepts at most 4 preview images, so render-on-user (2
 * profile refs) used to carry at most 2 garments ("Only 2 of 3"). Now
 * garments beyond the free slots pre-combine into ONE composite
 * reference sheet. Proves, with synthetic fixtures only (locally
 * generated solid-colour PNGs, SYNTH_ ids — never real photos):
 *  - render-on-user with 3 garments: preview gets exactly 3 images
 *    (headshot, full-body, sheet); the prompt names every piece in
 *    order with the reference-sheet wording and no "Only N of M"
 *    sentence; meta.referencePieces equals the piece count;
 *  - render-on-user with 4 garments: same (3 images, sheet of 4);
 *  - render-on-user with 2 garments: unchanged, 4 individual images;
 *  - flat-lay with <= 4 refs: unchanged individual behaviour;
 *  - buildGarmentImages with 6 pieces, slots 4: composite, one image,
 *    6 refs with integer cell indexes;
 *  - audit entries carry mode and contain no image bytes.
 *
 * Run: node app/test/reference-sheet.test.js
 */
const assert = require("assert");
const PhotoThumb = require("../photo-thumb.js");
const Wardrobe = require("../wardrobe-catalog.js");
const Propose = require("../skills/propose_look/handler.js");

function solidUrl(r, g, b) {
  const rgb = new Uint8Array(16 * 16 * 3);
  for (let i = 0; i < rgb.length; i += 3) { rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b; }
  return "data:image/png;base64," +
    Buffer.from(PhotoThumb.encodePng(16, 16, rgb)).toString("base64");
}

const HS = solidUrl(200, 40, 40);
const FB = solidUrl(40, 40, 200);
const PREVIEW_DURL = solidUrl(7, 7, 7);

function seed(cat, defs) {
  const colours = [
    [220, 40, 40], [40, 220, 40], [40, 40, 220],
    [220, 220, 40], [220, 40, 220], [40, 220, 220],
  ];
  defs.forEach(function (category, i) {
    const c = colours[i % colours.length];
    cat.addPiece({
      category: category, attributes: {},
      source_share_id: "SYNTH_share_sheet_" + i + "_" + category.replace("/", "-"),
      photo_thumb: solidUrl(c[0], c[1], c[2]),
    });
  });
  return cat;
}

function profiled(cat) {
  cat.setProfileConsent(true);
  cat.setProfileReference("headshot", HS);
  cat.setProfileReference("full_body", FB);
  return cat;
}

function idsByCat(cat) {
  const byCat = {};
  cat.getActivePieces().forEach(function (p) { byCat[p.category] = p.piece_id; });
  return byCat;
}

function previewStub(seen) {
  return async function (prompt, images) {
    seen.push({ prompt: prompt, images: Array.isArray(images) ? images.slice() : images });
    return { dataURL: PREVIEW_DURL };
  };
}

function assembleStub(ids) {
  return async function () {
    return { looks: [{ pieceIds: ids, rationale: "SYNTH drape." }] };
  };
}

function entryJsonClean(entry) {
  const s = JSON.stringify(entry);
  return s.indexOf("data:image") === -1 && s.indexOf("base64") === -1;
}

async function run() {
  console.log("reference-sheet.test.js");
  Propose.clearPreviewAudit();

  // --- 3 garments render on the wearer via one sheet ---
  console.log("\n[(a) render-on-user with 3 garments sends headshot + full-body + sheet]");
  {
    const cat = profiled(seed(
      Wardrobe.createCatalog({ userKey: "SYNTH_sheet_a" }),
      ["dress", "scarf", "bag"]));
    const ids = idsByCat(cat);
    const seen = [];
    const mc = {
      assemble: assembleStub([ids["dress"], ids["scarf"], ids["bag"]]),
      preview: previewStub(seen),
    };
    const r = await Propose.handle({
      catalog: cat, metaClient: mc,
      text: "show me a look and show me wearing it", preferences: "",
    });
    assert.strictEqual(r.meta && r.meta.renderOnUser, true, "renders on the wearer");
    assert.strictEqual(seen.length, 1, "preview called once");
    const sent = seen[0].images;
    assert.ok(Array.isArray(sent) && sent.length === 3,
      "exactly 3 images (headshot, full-body, sheet), got " + (Array.isArray(sent) ? sent.length : typeof sent));
    assert.ok(sent.every(function (u) { return /^data:image\//.test(u); }), "all three are data URLs");
    const prompt = seen[0].prompt;
    assert.ok(/Image 3 is a reference sheet of the 3 selected garments/.test(prompt),
      "prompt names image 3 as the 3-garment sheet: " + prompt.slice(0, 200));
    assert.ok(/top-to-bottom: dress, scarf, bag/.test(prompt),
      "prompt names every piece in order: " + prompt.slice(0, 320));
    assert.ok(/Every cell is a separate garment/.test(prompt), "prompt says every cell is a garment");
    assert.ok(/dress the person in ALL of them/.test(prompt), "prompt dresses ALL of them");
    assert.ok(/do not render the grid/.test(prompt), "prompt forbids rendering the grid");
    assert.ok(!/Only \d+ of/.test(prompt), "no shortfall sentence when every piece rides along");
    assert.strictEqual(r.meta.referencePieces, 3, "meta reports pieces represented, got " + r.meta.referencePieces);
    assert.strictEqual(r.meta.referenceGarmentTotal, 3, "meta total is 3");
    assert.strictEqual(r.meta.referenceMode, "composite", "meta names composite mode");
    assert.ok(r.image && r.image.dataURL === PREVIEW_DURL, "preview image surfaced");
    console.log("  pass: 3 images, sheet wording, referencePieces 3");
  }

  // --- 4 garments render on the wearer via one sheet ---
  console.log("\n[(b) render-on-user with 4 garments sends headshot + full-body + sheet]");
  {
    const cat = profiled(seed(
      Wardrobe.createCatalog({ userKey: "SYNTH_sheet_b" }),
      ["base/top", "base/bottom", "scarf", "bag", "dress"]));
    const ids = idsByCat(cat);
    const seen = [];
    const mc = {
      assemble: assembleStub([ids["base/top"], ids["base/bottom"], ids["scarf"], ids["bag"]]),
      preview: previewStub(seen),
    };
    const r = await Propose.handle({
      catalog: cat, metaClient: mc,
      text: "show me a look and show me wearing it", preferences: "",
    });
    assert.strictEqual(r.meta && r.meta.renderOnUser, true, "renders on the wearer");
    assert.strictEqual(seen.length, 1, "preview called once");
    const sent = seen[0].images;
    assert.ok(Array.isArray(sent) && sent.length === 3,
      "exactly 3 images despite 4 garments, got " + (Array.isArray(sent) ? sent.length : typeof sent));
    assert.ok(/Image 3 is a reference sheet of the 4 selected garments/.test(seen[0].prompt),
      "sheet covers all 4 garments");
    assert.ok(/top-to-bottom: top, bottom, scarf, bag/.test(seen[0].prompt),
      "prompt names all four in order");
    assert.ok(!/Only \d+ of/.test(seen[0].prompt), "no shortfall sentence");
    assert.strictEqual(r.meta.referencePieces, 4, "meta reports 4 pieces, got " + r.meta.referencePieces);
    assert.strictEqual(r.meta.referenceMode, "composite", "meta names composite mode");
    console.log("  pass: 3 images, sheet of 4, referencePieces 4");
  }

  // --- 2 garments stay individual (unchanged behaviour) ---
  console.log("\n[(c) render-on-user with 2 garments stays individual]");
  {
    const cat = profiled(seed(
      Wardrobe.createCatalog({ userKey: "SYNTH_sheet_c" }),
      ["dress", "layer/cardigan"]));
    const ids = idsByCat(cat);
    const seen = [];
    const mc = {
      assemble: assembleStub([ids["dress"], ids["layer/cardigan"]]),
      preview: previewStub(seen),
    };
    const r = await Propose.handle({
      catalog: cat, metaClient: mc,
      text: "show me a look and show me wearing it", preferences: "",
    });
    assert.strictEqual(seen.length, 1, "preview called once");
    const sent = seen[0].images;
    assert.ok(Array.isArray(sent) && sent.length === 4,
      "still 4 individual images, got " + (Array.isArray(sent) ? sent.length : typeof sent));
    assert.ok(/remaining attached images are the selected wardrobe garments/.test(seen[0].prompt),
      "individual wording kept");
    assert.ok(!/reference sheet/.test(seen[0].prompt), "no sheet wording");
    assert.strictEqual(r.meta.referencePieces, 2, "meta reports 2 pieces");
    assert.strictEqual(r.meta.referenceMode, "individual", "meta names individual mode");
    console.log("  pass: 4 individual images, wording unchanged");
  }

  // --- flat-lay with <= 4 refs stays individual ---
  console.log("\n[(d) flat-lay with 2 refs stays individual]");
  {
    const cat = seed(
      Wardrobe.createCatalog({ userKey: "SYNTH_sheet_d" }),
      ["dress", "layer/cardigan"]);
    const ids = idsByCat(cat);
    const seen = [];
    const mc = {
      assemble: assembleStub([ids["dress"], ids["layer/cardigan"]]),
      preview: previewStub(seen),
    };
    const r = await Propose.handle({ catalog: cat, metaClient: mc, text: "show me a look", preferences: "" });
    assert.strictEqual(seen.length, 1, "preview called once");
    const sent = seen[0].images;
    const arr = Array.isArray(sent) ? sent : [sent];
    assert.strictEqual(arr.length, 2, "both refs ride individually, got " + arr.length);
    assert.ok(/distinct wardrobe garment/.test(seen[0].prompt), "multi-ref wording kept");
    assert.ok(!/reference sheet/.test(seen[0].prompt), "no sheet wording");
    assert.strictEqual(r.meta.referenceMode, "individual", "flat-lay meta names individual mode");
    assert.strictEqual(r.meta.referencePieces, 2, "flat-lay meta reports 2 pieces");
    console.log("  pass: 2 individual refs, wording unchanged");
  }

  // --- buildGarmentImages with 6 pieces, slots 4 -> composite ---
  console.log("\n[(e) buildGarmentImages over slots composites]");
  {
    const cat = seed(
      Wardrobe.createCatalog({ userKey: "SYNTH_sheet_e" }),
      ["base/top", "base/bottom", "layer/cardigan", "scarf", "bag", "dress"]);
    const active = cat.getActivePieces();
    const chosen = active.map(function (p) { return { id: p.piece_id, category: p.category }; });
    const got = Propose.buildGarmentImages(active, chosen, 4);
    assert.strictEqual(got.mode, "composite", "mode is composite, got " + got.mode);
    assert.strictEqual(got.images.length, 1, "one sheet image");
    assert.ok(/^data:image\//.test(got.images[0]), "sheet is a data URL");
    assert.strictEqual(got.refs.length, 6, "6 per-piece audit rows");
    assert.ok(got.refs.every(function (r, i) { return r.cell === i; }),
      "refs carry cell indexes 0..5, got " + JSON.stringify(got.refs.map(function (r) { return r.cell; })));
    assert.strictEqual(got.total, 6, "total is 6");
    assert.strictEqual(got.represented, 6, "all 6 represented");
    assert.strictEqual(got.orderedNouns.length, 6, "6 ordered nouns");
    assert.ok(got.payloadBytes > 0, "payload bytes counted");
    // Under slots: individual, no cells.
    const two = Propose.buildGarmentImages(active, chosen.slice(0, 2), 4);
    assert.strictEqual(two.mode, "individual", "fits slots -> individual");
    assert.strictEqual(two.images.length, 2, "two individual images");
    assert.ok(two.refs.every(function (r) { return !("cell" in r); }), "no cell index off-sheet");
    // Genuinely missing pieces: unknown id skipped, downgraded, still individual.
    const missing = Propose.buildGarmentImages(active,
      chosen.slice(0, 2).concat([{ id: "SYNTH_piece_missing", category: "bag" }]), 4);
    assert.strictEqual(missing.represented, 2, "missing piece not represented");
    assert.strictEqual(missing.total, 3, "total still counts it");
    assert.strictEqual(missing.downgraded, true, "missing piece downgrades");
    console.log("  pass: composite one image + 6 cell rows; individual + missing cases hold");
  }

  // --- audit entries carry mode, never bytes ---
  console.log("\n[(f) audit entries carry mode, never bytes]");
  {
    const entries = Propose.getPreviewAudit();
    assert.ok(entries.length >= 4, "entries logged, got " + entries.length);
    const onUser = entries.filter(function (e) { return e.renderOnUser === true; });
    assert.ok(onUser.length >= 3, "render entries logged");
    const comp = onUser[onUser.length - 2]; // the 4-garment render is individual? no: (a)+(b) composite
    assert.strictEqual(comp.mode, "composite", "render entry names composite mode");
    assert.ok(comp.refs.length >= 3 && comp.refs.every(function (r) {
      return typeof r.cell === "number" && r.cell >= 0;
    }), "composite refs carry integer cells");
    assert.ok(entries.every(function (e) { return e.mode === "individual" || e.mode === "composite"; }),
      "every entry carries a mode");
    assert.ok(entries.every(entryJsonClean), "no entry carries image bytes");
    const flat = entries.filter(function (e) { return e.renderOnUser === false; });
    assert.ok(flat.length >= 1 && flat[flat.length - 1].mode === "individual",
      "flat-lay entry names individual mode");
    Propose.clearPreviewAudit();
    console.log("  pass: modes recorded, entries byte-free");
  }

  console.log("\nAll reference-sheet tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
