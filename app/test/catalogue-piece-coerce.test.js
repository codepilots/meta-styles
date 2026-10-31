"use strict";
/* meta-styles regression: catalogue_piece handler placeholder + honest no-pending reply.
 * NEW hackathon work (building period Oct 27 - Nov 4, 2026).
 * Stdlib only, SYNTH_ fixtures, no network.
 * Covers opencode-category-coerce.md step 3 handler side:
 *  - classify placeholder:true + no text hint -> default dress path (auto-add, honest)
 *  - text-only turn with pendingBag null -> "Nothing pending" reply shape
 */
const assert = require("assert");
const Wardrobe = require("../wardrobe-catalog.js");
const Handler = require("../skills/catalogue_piece/handler.js");

const DURL = "data:image/png;base64,SYNTH_coerce_handler_bytes";

function tinyPngDataUrl() {
  return DURL;
}

async function run() {
  console.log("catalogue-piece-coerce.test.js");

  // (a) classify placeholder:true + no text hint -> default dress path (auto-add, honest)
  console.log("\n[placeholder classify + no hint -> default dress, auto-add]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_coerce_placeholder_" + Date.now() });
    const placeholderClient = {
      classify: async function () { return { category: "dress", confidence: 0, placeholder: true }; },
      segment: async function () { return { boxes: [] }; },
      detectGarments: async function () { throw new Error("SYNTH detect unavailable"); }
    };
    const r = await Handler.handle({
      catalog: cat, text: "", imageDataUrl: tinyPngDataUrl(),
      shareId: "SYNTH_share_coerce_placeholder_1", metaClient: placeholderClient
    });
    // Should NOT be the failure copy; should be success dress path
    assert.ok(!r.text.includes("couldn't get that piece tucked"), "must not be failure copy, got: " + r.text);
    assert.ok(/Got your dress|tucked safely/i.test(r.text), "default dress success copy, got: " + r.text);
    assert.strictEqual(cat.getActivePieces().length, 1, "one piece auto-added");
    assert.strictEqual(cat.getActivePieces()[0].category, "dress", "category is dress");
    console.log("  pass: placeholder -> dress fallback, piece added");
  }

  // Also verify text hint still influences category when placeholder path taken
  console.log("\n[placeholder classify + text hint scarf -> scarf]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_coerce_hint_" + Date.now() });
    const placeholderClient = {
      classify: async function () { return { category: "dress", confidence: 0, placeholder: true }; },
      segment: async function () { return { boxes: [] }; },
      detectGarments: async function () { throw new Error("SYNTH detect unavailable"); }
    };
    const r = await Handler.handle({
      catalog: cat, text: "SYNTH my scarf", imageDataUrl: tinyPngDataUrl(),
      shareId: "SYNTH_share_coerce_hint_1", metaClient: placeholderClient
    });
    assert.strictEqual(cat.getActivePieces().length, 1, "one piece added");
    assert.strictEqual(cat.getActivePieces()[0].category, "scarf", "text hint scarf wins, got " + cat.getActivePieces()[0].category);
    console.log("  pass: placeholder + scarf hint -> scarf");
  }

  // (b) text-only turn with pendingBag null -> "Nothing pending" reply shape
  console.log("\n[text-only pendingBag null -> Nothing pending]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_coerce_nopending_" + Date.now() });
    const r = await Handler.handle({
      catalog: cat, text: "yes", imageDataUrl: null,
      pendingBag: null
    });
    assert.strictEqual(r.skill, "catalogue_piece", "skill name");
    assert.ok(/Nothing pending/i.test(r.text), "Nothing pending reply, got: " + r.text);
    assert.ok(r.text.includes("send a photo"), "honest hint to send photo, got: " + r.text);
    assert.ok(!r.text.includes("couldn't get that piece tucked"), "must not be photo-failure copy, got: " + r.text);
    // shape checks
    assert.ok(r.persist && typeof r.persist.summaryDelta === "string", "persist shape");
    assert.strictEqual(r.image, null, "no image");
    console.log("  pass: Nothing pending shape correct");
  }

  // Ensure normal pendingBag flow unchanged (yes with real bag still adds)
  console.log("\n[pendingBag yes flow unchanged -> still adds]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_coerce_pending_yes_" + Date.now() });
    // Simulate a pendingBag from a prior detection with 2 regions
    const bag = {
      at: Date.now(),
      source_share_id: "SYNTH_share_coerce_pending_1",
      regions: [
        { category: "base/top", attributes: {}, bbox: [0.1, 0.1, 0.3, 0.3], cropRect: [0.1, 0.1, 0.3, 0.3], thumb: null, original: null, crop_hash: "aabbccddeeff0011", source_share_id: "SYNTH_share_coerce_pending_1" },
        { category: "base/bottom", attributes: {}, bbox: [0.1, 0.5, 0.3, 0.3], cropRect: [0.1, 0.5, 0.3, 0.3], thumb: null, original: null, crop_hash: "aabbccddeeff0022", source_share_id: "SYNTH_share_coerce_pending_1" }
      ]
    };
    // Set up pending question so handler enters add path
    cat.askQuestion({ text: "SYNTH pending question", skill: "catalogue_piece", expects: "yes_no" });
    const r = await Handler.handle({
      catalog: cat, text: "yes", imageDataUrl: null,
      pendingBag: bag
    });
    assert.ok(cat.getActivePieces().length === 2, "2 pieces added via pendingBag, got " + cat.getActivePieces().length);
    assert.ok(r.text && r.text.length > 0, "reply present");
    console.log("  pass: pendingBag yes still adds");
  }

  console.log("\nAll catalogue-piece-coerce tests passed.");
}
run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
