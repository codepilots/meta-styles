"use strict";
/* meta-styles Opus finding #7 — revise_look re-selection tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves a same-turn revision ("no bag") NEVER destroys wardrobe data
 * (no catalog.rejectPiece — the old handler terminally rejected every
 * piece of the named category) and re-selects one real 2-4 piece look
 * via propose_look's own selection stack over the reduced set:
 *   (a) multi-look wardrobe + "no bag": bag still active, reply names a
 *       valid 2-4 piece subset with no bag, no oversized/invalid claim;
 *   (b) category-not-present + ambiguous/no-category clarification paths
 *       behave as before (honest copy, pending text expectation, nothing
 *       destroyed);
 *   (c) exclusion leaving no valid look: honest no-look reply (never a
 *       fabricated "looking darling together"), nothing destroyed;
 *   (d) meta.imageDelivery stays nested under meta in every shape.
 * All catalogs/ids synthetic (SYNTH_ prefix) — never real data. No network.
 *
 * Run: node app/test/revise-look-reselect.test.js
 */
const assert = require("node:assert");
const Wardrobe = require("../wardrobe-catalog.js");
const ReviseLook = require("../skills/revise_look/handler.js");

function seed(cat, cats, tag) {
  cats.forEach(function (c, i) {
    cat.addPiece({ category: c, attributes: {}, source_share_id: "SYNTH_share_" + tag + "_" + i });
  });
}

function noFabrication(result, label) {
  const dumped = JSON.stringify(result);
  assert.ok(!/example\.invalid/.test(dumped), label + " must contain no example.invalid");
  assert.ok(!/SYNTH_piece_/.test(result.text), label + " reply names no piece ids: " + result.text.slice(0, 160));
}

function assertMetaContract(r, label) {
  assert.ok(r.meta && r.meta.imageDelivery, label + ": imageDelivery nested under meta");
  assert.ok(!("imageDelivery" in r), label + ": no top-level imageDelivery");
}

async function run() {
  console.log("Opus finding #7 — revise-look-reselect.test.js");

  // --- (a) multi-look wardrobe: revision never destroys, look is real ---
  console.log("\n[(a) no bag -> bag survives, valid 2-4 piece look]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_r7_a" });
    seed(cat, ["dress", "layer/cardigan", "base/top", "base/bottom", "scarf", "bag"], "a");
    const before = cat.getActivePieces().map(function (p) { return p.piece_id; }).sort();
    const r = await ReviseLook.handle({ catalog: cat, text: "no bag please", metaClient: null });
    assert.strictEqual(r.skill, "revise_look");
    const after = cat.getActivePieces();
    assert.deepStrictEqual(
      after.map(function (p) { return p.piece_id; }).sort(), before,
      "same-turn revision must not destroy any piece");
    assert.ok(after.some(function (p) { return p.category === "bag"; }), "bag still active");
    const turns = cat.getTurns();
    assert.strictEqual(turns.length, 1, "one turn recorded");
    assert.strictEqual(turns[0].verdict, true, "revised look validates: " + r.text);
    const pieces = turns[0].proposal.pieces;
    assert.ok(pieces.length >= 2 && pieces.length <= 4,
      "look is 2-4 pieces, got " + pieces.length);
    const byId = {};
    after.forEach(function (p) { byId[p.piece_id] = p; });
    pieces.forEach(function (id) {
      assert.ok(byId[id], "chosen piece still in wardrobe: " + id);
      assert.notStrictEqual(byId[id].category, "bag", "chosen look excludes the bag");
    });
    assert.ok(/looking darling together/.test(r.text), "re-woven reply kept");
    assert.ok(!/bag/.test(r.text.split("set aside your")[1] || "") || /set aside your bag/.test(r.text),
      "reply does not smuggle the bag back into the look");
    assert.ok(/Fit check: valid/.test(r.text), "fit check claimed only for a validated look");
    assertMetaContract(r, "revised look");
    noFabrication(r, "revised look");
    console.log("  pass: 6 pieces intact, look=" + pieces.map(function (id) { return byId[id].category; }).join("+"));
  }

  // --- (b) clarification paths unchanged, nothing destroyed ---
  console.log("\n[(b) not-present + ambiguous clarification unchanged]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_r7_b" });
    seed(cat, ["dress", "layer/cardigan"], "b");
    const r = await ReviseLook.handle({ catalog: cat, text: "drop the bag please", metaClient: null });
    assert.ok(/No bag in the mix right now/.test(r.text), "not-present copy kept: " + r.text.slice(0, 80));
    assert.ok(/Fit check: valid/.test(r.text), "re-checked look still validates");
    assert.strictEqual(cat.getActivePieces().length, 2, "nothing destroyed");
    const turns = cat.getTurns();
    assert.strictEqual(turns[0].verdict, true, "re-check validates");
    assert.ok(turns[0].reasons.indexOf("category_not_present") !== -1, "reason kept");
    assertMetaContract(r, "not-present");

    const cat2 = Wardrobe.createCatalog({ userKey: "SYNTH_r7_b2" });
    seed(cat2, ["dress", "layer/cardigan"], "b2");
    const r2 = await ReviseLook.handle({ catalog: cat2, text: "hmm, maybe change something", metaClient: null });
    assert.ok(/which piece would you like to swap or skip/.test(r2.text), "clarification copy kept");
    const pend = cat2.getPendingQuestions();
    assert.strictEqual(pend.length, 1, "one pending question");
    assert.strictEqual(pend[0].skill, "revise_look", "pending skill kept");
    assert.strictEqual(pend[0].expects, "text", "pending expects text");
    assert.strictEqual(cat2.getTurns()[0].verdict, false, "clarification verdict false");
    assert.strictEqual(cat2.getTurns()[0].proposal, null, "clarification has no proposal");
    assert.strictEqual(cat2.getActivePieces().length, 2, "nothing destroyed");
    assertMetaContract(r2, "clarification");
    console.log("  pass: not-present + ambiguous paths unchanged");
  }

  // --- (c) exclusion leaves no valid look: honest, nothing destroyed ---
  console.log("\n[(c) no valid look left -> honest no-look reply]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_r7_c" });
    seed(cat, ["dress", "scarf", "bag"], "c"); // only finish is scarf+bag
    const r = await ReviseLook.handle({ catalog: cat, text: "skip the bag please", metaClient: null });
    assert.strictEqual(r.skill, "revise_look");
    assert.strictEqual(cat.getActivePieces().length, 3, "nothing destroyed");
    assert.ok(cat.getActivePieces().some(function (p) { return p.category === "bag"; }),
      "bag still active even though excluded this turn");
    assert.ok(!/looking darling together/.test(r.text), "no fabricated look claim: " + r.text.slice(0, 160));
    assert.ok(!/Fit check: valid/.test(r.text), "no false fit-check claim");
    assert.ok(/lamplight/.test(r.text), "honest no-look copy kept");
    assert.strictEqual(r.image, null, "no image without a look");
    const turns = cat.getTurns();
    assert.strictEqual(turns[0].verdict, false, "verdict false");
    assert.strictEqual(turns[0].proposal, null, "no proposal on honest no-look");
    assertMetaContract(r, "honest no-look");
    assert.strictEqual(r.meta.imageDelivery.reason, "no_valid_look", "truthful delivery reason");
    noFabrication(r, "honest no-look");
    console.log("  pass: honest no-look, wardrobe intact");
  }

  console.log("\nAll revise-look re-selection tests passed.");
}

run().catch((e) => { console.error(e.stack || e); process.exit(1); });
