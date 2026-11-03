"use strict";
/* meta-styles — propose_look lone-accessory finish tests (2026-11-03 product decision).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * A valid look is a base plus exactly one finish, where a finish is one
 * layer, a scarf alone, a bag alone, or a scarf + bag pair:
 *   (a) fallbackChoose prefers richer finishes: with dress, cardigan,
 *       scarf and bag available it still picks dress+cardigan — the same
 *       look as before the rule change;
 *   (b) a wardrobe of only dress+scarf now yields a valid look
 *       (previously: honest no-valid-look);
 *   (c) top+bottom+bag validates with finish "bag" and the bag-only reply
 *       wording; dress+scarf carries the scarf-only wording;
 *   (d) dress alone is still invalid (missing finish, honest reply).
 * All fixtures synthetic (SYNTH_ prefix) — never real data. No network.
 *
 * Run: node app/test/propose-look-lone-finish.test.js
 */
const assert = require("node:assert");
const Wardrobe = require("../wardrobe-catalog.js");
const Handler = require("../skills/propose_look/handler.js");
const Assembler = require("../assembler.js");

function seed(tag, cats) {
  const cat = Wardrobe.createCatalog({ userKey: "SYNTH_lf_" + tag });
  cats.forEach(function (c, i) {
    cat.addPiece({ category: c, attributes: {}, source_share_id: "SYNTH_share_lf_" + tag + "_" + i });
  });
  return cat;
}

function catsOf(cat, ids) {
  const byId = {};
  cat.getActivePieces().forEach(function (p) { byId[p.piece_id] = p; });
  return ids.map(function (id) { return byId[id] ? byId[id].category : "?"; });
}

async function run() {
  console.log("propose-look-lone-finish.test.js");

  // --- (a) richer finishes first: dress+cardigan wins over lone accessories ---
  console.log("\n[(a) fallback prefers the layer]");
  {
    const cat = seed("a", ["dress", "layer/cardigan", "scarf", "bag"]);
    const fb = Handler.fallbackChoose(cat.getActivePieces(), Assembler.assembleLook);
    assert.ok(fb.items, "fallback finds a look");
    assert.deepStrictEqual(
      catsOf(cat, fb.items.map(function (it) { return it.id; })).sort(),
      ["dress", "layer/cardigan"], "same look as before: dress+cardigan");
    assert.strictEqual(fb.card.finish, "layer", "finish layer");
    console.log("  pass: dress+cardigan picked, lone finishes skipped");
  }

  // --- (b) dress+scarf wardrobe: valid look, scarf wording ---
  console.log("\n[(b) dress+scarf proposes a valid look]");
  {
    const cat = seed("b", ["dress", "scarf"]);
    const r = await Handler.handle({ catalog: cat, metaClient: null });
    const t = cat.getTurns()[0];
    assert.strictEqual(t.verdict, true, "valid turn recorded: " + r.text.slice(0, 160));
    assert.deepStrictEqual(catsOf(cat, t.proposal.pieces).sort(), ["dress", "scarf"], "dress+scarf proposed");
    assert.ok(/Fit check: valid/.test(r.text), "fit check claimed");
    assert.ok(/a base finished with a scarf\./.test(r.text), "scarf-only wording: " + r.text.slice(0, 240));
    assert.ok(!/SYNTH_/.test(r.text), "no IDs leak");
    console.log("  pass: dress+scarf valid with scarf wording");
  }

  // --- (c) top+bottom+bag: finish bag, bag wording ---
  console.log("\n[(c) top+bottom+bag proposes a valid look]");
  {
    const cat = seed("c", ["base/top", "base/bottom", "bag"]);
    const r = await Handler.handle({ catalog: cat, metaClient: null });
    const t = cat.getTurns()[0];
    assert.strictEqual(t.verdict, true, "valid turn recorded: " + r.text.slice(0, 160));
    assert.deepStrictEqual(catsOf(cat, t.proposal.pieces).sort(),
      ["bag", "base/bottom", "base/top"], "top+bottom+bag proposed");
    assert.ok(/Fit check: valid/.test(r.text), "fit check claimed");
    assert.ok(/a base finished with a bag\./.test(r.text), "bag-only wording: " + r.text.slice(0, 240));
    console.log("  pass: top+bottom+bag valid with bag wording");
  }

  // --- (d) dress alone: still no valid look ---
  console.log("\n[(d) lone base still invalid]");
  {
    const cat = seed("d", ["dress"]);
    const r = await Handler.handle({ catalog: cat, metaClient: null });
    const t = cat.getTurns()[0];
    assert.strictEqual(t.verdict, false, "no valid turn");
    assert.strictEqual(t.proposal, null, "no proposal recorded");
    assert.ok(!/Fit check: valid/.test(r.text), "no false fit claim");
    assert.ok(/share one more piece \(a layer, a scarf or a bag\)/.test(r.text),
      "new no-valid-look wording: " + r.text.slice(0, 200));
    console.log("  pass: dress alone still asks for a finish");
  }

  console.log("\nAll propose-look lone-finish tests passed.");
}

run().catch((e) => { console.error(e.stack || e); process.exit(1); });
