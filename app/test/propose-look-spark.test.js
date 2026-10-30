"use strict";
/* meta-styles — propose_look server-side Spark choice + image delivery tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Covers: (a) six mixed active pieces never yield repeated categories or
 * all pieces; (b) mocked Spark assemble selects a valid subset and its
 * rationale is used; (c) invalid IDs / repeated IDs / impossible combos are
 * rejected and the local fallback is used; (d) Spark outage uses a
 * deterministic local fallback; (e) a natural request through the real
 * agentic loop reaches propose_look and invokes assemble; (f) preview
 * dataURL shape is handled and image delivery status stays truthful.
 * All fixtures synthetic (SYNTH_ prefix) — never real data.
 */
const assert = require("assert");
const Wardrobe = require("../wardrobe-catalog.js");
const Handler = require("../skills/propose_look/handler.js");
const AgenticLoop = require("../agentic-loop.js");
const Router = require("../router.js");
const Summariser = require("../summariser.js");

function seedSix() {
  const cat = Wardrobe.createCatalog({ userKey: "SYNTH_pl_" + Math.floor(Math.random() * 1e9) });
  const cats = ["scarf", "dress", "base/top", "dress", "layer/cardigan", "base/top", "scarf"];
  cats.forEach(function (c, i) {
    cat.addPiece({ category: c, attributes: {}, source_share_id: "SYNTH_share_pl_" + i });
  });
  return cat;
}

function noIds(text, label) {
  assert.ok(!/SYNTH_/.test(text), label + " must not leak IDs: " + text.slice(0, 160));
}

function noFakeUrl(text, label) {
  assert.ok(!/example\.invalid/.test(text), label + " must not show example.invalid: " + text.slice(0, 160));
  assert.ok(!/https?:\/\//.test(text), label + " must not show URLs: " + text.slice(0, 160));
}

async function run() {
  console.log("propose-look-spark.test.js");

  // --- (a) six mixed pieces: no repeated categories, never all pieces ---
  console.log("\n[(a) six mixed pieces]");
  {
    const cat = seedSix();
    const active = cat.getActivePieces();
    assert.strictEqual(active.length, 7, "seeded seven active pieces (dup categories/shapes included)");
    // No Spark client at all -> pure deterministic fallback
    const r = await Handler.handle({ catalog: cat, metaClient: null });
    assert.strictEqual(r.meta.source, "fallback", "no client -> fallback");
    assert.ok(r.meta.selectedCount >= 2 && r.meta.selectedCount <= 4,
      "fallback subset is 2-4 pieces, got " + r.meta.selectedCount);
    assert.ok(r.meta.selectedCount < active.length, "fallback never uses all pieces");
    noIds(r.text, "fallback reply");
    noFakeUrl(r.text, "fallback reply");
    // Spark proposing ALL pieces must be rejected in favour of a subset
    const greedy = {
      assemble: async function () {
        return { looks: [{ pieceIds: active.map(function (p) { return p.piece_id; }), rationale: "wear everything" }] };
      }
    };
    const r2 = await Handler.handle({ catalog: cat, metaClient: greedy });
    assert.ok(r2.meta.selectedCount < active.length,
      "greedy all-pieces rejected, got " + r2.meta.selectedCount + " of " + active.length);
    assert.ok(/^spark_rejected:/.test(r2.meta.rejectedReason || ""),
      "rejection reason recorded, got " + r2.meta.rejectedReason);
    // Nouns in the reply must be unique (no repeated category)
    const nouns = r2.text.split("your ")[1].split(" together?")[0].split(" + ");
    assert.strictEqual(new Set(nouns).size, nouns.length, "no repeated category: " + nouns.join(","));
    noIds(r2.text, "greedy reply");
    console.log("  pass: fallback subset + greedy all-pieces rejected (" + r2.meta.rejectedReason + ")");
  }

  // --- (b) mocked Spark selects a valid subset; rationale is used ---
  console.log("\n[(b) Spark valid subset + rationale]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_pl_b" });
    cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_b1" });
    cat.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_share_b2" });
    cat.addPiece({ category: "scarf", attributes: {}, source_share_id: "SYNTH_share_b3" });
    const active = cat.getActivePieces();
    const dressId = active[0].piece_id;
    const cardiId = active[1].piece_id;
    let seenPieces = null;
    const mc = {
      assemble: async function (pieces) {
        seenPieces = pieces;
        return { looks: [{ pieceIds: [dressId, cardiId], rationale: "Moonlight drapes long over lilac." }] };
      },
      preview: async function () { throw new Error("no proxy in unit test"); }
    };
    const r = await Handler.handle({ catalog: cat, metaClient: mc });
    assert.strictEqual(r.meta.source, "spark", "valid Spark output used, got " + r.meta.source);
    assert.strictEqual(r.meta.selectedCount, 2, "two pieces selected");
    assert.ok(Array.isArray(seenPieces) && seenPieces.length === 3,
      "assemble called with the actual catalog pieces (id/category only)");
    assert.deepStrictEqual(Object.keys(seenPieces[0]).sort(), ["category", "id"],
      "prompt carries id/category only, no tokens or platform IDs");
    assert.ok(r.text.indexOf("Moonlight drapes long over lilac.") !== -1,
      "Spark rationale used verbatim in reply: " + r.text.slice(0, 160));
    noIds(r.text, "spark reply");
    console.log("  pass: assemble invoked with catalog pieces, rationale in reply");
  }

  // --- (c) invalid Spark output rejected -> fallback ---
  console.log("\n[(c) invalid Spark output]");
  {
    async function rejectedCase(name, looks, expectReason) {
      const cat = Wardrobe.createCatalog({ userKey: "SYNTH_pl_c_" + name });
      cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_c1" });
      cat.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_share_c2" });
      cat.addPiece({ category: "bag", attributes: {}, source_share_id: "SYNTH_share_c3" });
      const mc = { assemble: async function () { return { looks: looks }; } };
      const r = await Handler.handle({ catalog: cat, metaClient: mc });
      assert.strictEqual(r.meta.source, "fallback", name + " -> fallback, got " + r.meta.source);
      assert.ok((r.meta.rejectedReason || "").indexOf(expectReason) !== -1,
        name + " reason recorded, got " + r.meta.rejectedReason);
      noIds(r.text, name);
      noFakeUrl(r.text, name);
      return r;
    }
    const active = Wardrobe.createCatalog({ userKey: "SYNTH_pl_c_probe" });
    active.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_p1" });
    const realId = active.getActivePieces()[0].piece_id;
    await rejectedCase("unknown", [{ pieceIds: ["SYNTH_piece_999", realId], rationale: "nope" }], "unknown_piece");
    await rejectedCase("repeated", [{ pieceIds: [realId, realId], rationale: "nope" }], "repeated_piece");
    // Impossible combination: dress + cardigan + blazer = two stacked layers
    const cat3 = Wardrobe.createCatalog({ userKey: "SYNTH_pl_c_imp" });
    cat3.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_i1" });
    cat3.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_share_i2" });
    cat3.addPiece({ category: "layer/blazer", attributes: {}, source_share_id: "SYNTH_share_i3" });
    const ids3 = cat3.getActivePieces().map(function (p) { return p.piece_id; });
    const rImp = await Handler.handle({
      catalog: cat3,
      metaClient: { assemble: async function () { return { looks: [{ pieceIds: ids3, rationale: "all at once" }] }; } }
    });
    assert.strictEqual(rImp.meta.source, "fallback", "impossible combo -> fallback");
    assert.ok(/two_layers/.test(rImp.meta.rejectedReason || ""),
      "impossible combo reason, got " + rImp.meta.rejectedReason);
    console.log("  pass: unknown / repeated / impossible all rejected with reasons");
  }

  // --- (d) Spark outage -> deterministic local fallback ---
  console.log("\n[(d) Spark outage]");
  {
    const cat = seedSix();
    const mc = {
      assemble: async function () { throw new Error("proxy unreachable"); }
    };
    const r1 = await Handler.handle({ catalog: cat, metaClient: mc });
    const r2 = await Handler.handle({ catalog: cat, metaClient: mc });
    assert.strictEqual(r1.meta.source, "fallback", "outage -> fallback");
    assert.strictEqual(r1.meta.rejectedReason, "assemble_failed", "outage reason, got " + r1.meta.rejectedReason);
    assert.strictEqual(r1.text, r2.text, "fallback is deterministic across calls");
    assert.ok(r1.meta.selectedCount < cat.getActivePieces().length, "fallback is a subset, not all pieces");
    noIds(r1.text, "outage reply");
    console.log("  pass: outage -> deterministic fallback subset (" + r1.meta.selectedCount + " pieces)");
  }

  // --- (e) natural request through the real agentic loop invokes assemble ---
  console.log("\n[(e) agentic loop -> propose_look -> assemble]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_pl_e" });
    cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_e1" });
    cat.addPiece({ category: "scarf", attributes: {}, source_share_id: "SYNTH_share_e2" });
    cat.addPiece({ category: "bag", attributes: {}, source_share_id: "SYNTH_share_e3" });
    const active = cat.getActivePieces();
    const calls = [];
    const mc = {
      assemble: async function (pieces) {
        calls.push(pieces);
        return {
          looks: [{
            pieceIds: active.map(function (p) { return p.piece_id; }).slice(0, 3),
            rationale: "Scarf high, shine at the hip."
          }]
        };
      }
    };
    const loop2 = AgenticLoop.createAgenticLoop({
      catalog: cat, userRef: cat.userKey, router: Router, summariser: Summariser,
      metaClient: mc, maxSteps: 20
    });
    const res = await loop2.handleTurn({
      message: "cook up a look for me", hasImage: false,
      wardrobeSummary: "", preferences: "", lastTurns: []
    });
    assert.strictEqual(res.skill, "propose_look", "natural request -> propose_look, got " + res.skill);
    assert.ok(calls.length >= 1, "assemble invoked through the loop");
    assert.ok(calls[0].length === 3, "assemble saw all three catalog pieces");
    assert.ok(res.handlerResult && res.handlerResult.meta &&
      res.handlerResult.meta.source === "spark", "Spark choice used end to end");
    noIds(res.text, "loop reply");
    noFakeUrl(res.text, "loop reply");
    assert.ok(res.totalSteps <= 20, "20-step cap");
    console.log("  pass: 'cook up a look for me' -> propose_look, assemble called, rationale kept");
  }

  // --- (f) preview dataURL shape + truthful delivery status ---
  console.log("\n[(f) preview dataURL + delivery truth]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_pl_f" });
    cat.addPiece({ category: "base/top", attributes: {}, source_share_id: "SYNTH_share_f1" });
    cat.addPiece({ category: "base/bottom", attributes: {}, source_share_id: "SYNTH_share_f2" });
    cat.addPiece({ category: "layer/blazer", attributes: {}, source_share_id: "SYNTH_share_f3" });
    const active = cat.getActivePieces();
    // Success: proxy's real shape {dataURL}
    const okMC = {
      assemble: async function () {
        return { looks: [{ pieceIds: active.map(function (p) { return p.piece_id; }), rationale: "Sharp frame, soft shine." }] };
      },
      preview: async function () { return { dataURL: "data:image/webp;base64,SYNTHAAA", source: "muse-image-1.0" }; }
    };
    const ok = await Handler.handle({ catalog: cat, metaClient: okMC });
    assert.ok(ok.image && ok.image.dataURL === "data:image/webp;base64,SYNTHAAA",
      "proxy dataURL shape passed through (not url)");
    assert.deepStrictEqual(
      [ok.meta.imageDelivery.requested, ok.meta.imageDelivery.generated, ok.meta.imageDelivery.delivered],
      [true, true, false], "generated but not delivered: " + JSON.stringify(ok.meta.imageDelivery));
    assert.ok(!/example\.invalid/.test(ok.text) && !/https?:\/\//.test(ok.text),
      "no fake URL in live reply");
    assert.ok(!/SYNTHAAA/.test(ok.text), "no dataURL bytes in reply text");
    // Failure: preview throws -> honest result, text-only, no fake URL
    const badMC = {
      assemble: async function () {
        return { looks: [{ pieceIds: active.map(function (p) { return p.piece_id; }), rationale: "Sharp frame." }] };
      },
      preview: async function () { throw new Error("proxy down"); }
    };
    const bad = await Handler.handle({ catalog: cat, metaClient: badMC });
    assert.strictEqual(bad.image, null, "failed preview -> no image");
    assert.strictEqual(bad.meta.imageDelivery.generated, false, "generated false");
    assert.strictEqual(bad.meta.imageDelivery.delivered, false, "delivered false");
    assert.ok(/preview_failed/.test(bad.meta.imageDelivery.reason),
      "truthful reason, got " + bad.meta.imageDelivery.reason);
    noFakeUrl(bad.text, "preview-failed reply");
    // Wrong shape ({url} instead of {dataURL}) is treated as unparseable, not passed through
    const wrongMC = {
      assemble: async function () {
        return { looks: [{ pieceIds: active.map(function (p) { return p.piece_id; }), rationale: "Sharp." }] };
      },
      preview: async function () { return { url: "https://example.invalid/x.png" }; }
    };
    const wrong = await Handler.handle({ catalog: cat, metaClient: wrongMC });
    assert.strictEqual(wrong.image, null, "url-shaped preview not passed through");
    assert.strictEqual(wrong.meta.imageDelivery.reason, "preview_unparseable", "unparseable labelled");
    noFakeUrl(wrong.text, "unparseable reply");
    console.log("  pass: dataURL handled, delivery truthful, no example.invalid anywhere");
  }

  console.log("\nAll propose-look Spark tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
