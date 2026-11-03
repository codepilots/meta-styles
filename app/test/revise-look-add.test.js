"use strict";
/* meta-styles — revise_look ADD/INCLUDE support tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves the pool-shaping mechanism works symmetrically in both
 * directions (exclusion removes a family, ADD requires one) via
 * propose_look's own fallbackChoose over the shaped pool — the fit
 * rules are never relaxed:
 *   (a) two-turn round-trip: "no cardigan" drops it, "add the cardigan
 *       back" brings it into the re-woven look;
 *   (b) "add my blazer" with no blazer in the catalog is an honest
 *       failure (no crash, no fabricated piece, truthful delivery);
 *   (c) "swap the cardigan for the blazer" excludes cardigan AND
 *       requires blazer — the look uses the blazer, never the cardigan;
 *   (d) exclude-only ("no cardigan this time") is unchanged;
 *   (e) fresh add-only phrasing reaches revise_look via the router
 *       heuristic (no pending expectation needed).
 * All catalogs/ids synthetic (SYNTH_ prefix) — never real data. No network.
 *
 * Run: node app/test/revise-look-add.test.js
 */
const assert = require("node:assert");
const Wardrobe = require("../wardrobe-catalog.js");
const ReviseLook = require("../skills/revise_look/handler.js");
const Router = require("../router.js");

function seed(tag, cats) {
  const cat = Wardrobe.createCatalog({ userKey: "SYNTH_add_" + tag });
  cats.forEach(function (c, i) {
    cat.addPiece({ category: c, attributes: {}, source_share_id: "SYNTH_share_add_" + tag + "_" + i });
  });
  return cat;
}

function lookCats(cat, proposal) {
  const byId = {};
  cat.getActivePieces().forEach(function (p) { byId[p.piece_id] = p; });
  return proposal.pieces.map(function (id) { return byId[id].category; });
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
  console.log("revise-look-add.test.js");

  // --- (a) two-turn round-trip: exclude, then add back onto the look ---
  // The re-woven look after "no cardigan" is dress+blazer; adding the
  // cardigan back cannot join that core (two layers never stack), so it
  // rides on top as a user-chosen extra: the core stays dress+blazer and
  // the reply never claims the cardigan passed the fit check.
  console.log("\n[(a) no cardigan -> add the cardigan back lands as an extra]");
  {
    const cat = seed("a", ["dress", "layer/cardigan", "layer/blazer", "scarf", "bag"]);
    const r1 = await ReviseLook.handle({ catalog: cat, text: "no cardigan this time", metaClient: null });
    const t1 = cat.getTurns()[0];
    assert.strictEqual(t1.verdict, true, "exclusion turn validates: " + r1.text);
    assert.ok(lookCats(cat, t1.proposal).indexOf("layer/cardigan") === -1,
      "excluded look has no cardigan: " + lookCats(cat, t1.proposal).join("+"));
    const r2 = await ReviseLook.handle({ catalog: cat, text: "add the cardigan back", metaClient: null });
    const t2 = cat.getTurns()[1];
    assert.strictEqual(t2.verdict, true, "add-back turn validates: " + r2.text);
    assert.ok(lookCats(cat, t2.proposal).indexOf("layer/cardigan") === -1,
      "core still has no cardigan (two layers never stack): " + lookCats(cat, t2.proposal).join("+"));
    assert.ok(Array.isArray(t2.proposal.extras) && t2.proposal.extras.length === 1 &&
      t2.proposal.extras[0].category === "layer/cardigan",
      "cardigan recorded as an extra: " + JSON.stringify(t2.proposal.extras));
    assert.ok(t2.reasons.indexOf("added:layer/cardigan") !== -1 &&
      t2.reasons.indexOf("extra:layer/cardigan") !== -1,
      "turn reasons record the add and the extra: " + JSON.stringify(t2.reasons));
    assert.ok(/Added your cardigan on top/.test(r2.text), "extra reply kept: " + r2.text.slice(0, 120));
    assert.ok(!/Fit check: valid/.test(r2.text), "no fit-check claim over the extra: " + r2.text.slice(0, 160));
    assert.ok(/fit check covers your dress \+ blazer only/.test(r2.text),
      "reply scopes the fit check to the core: " + r2.text.slice(0, 160));
    assert.strictEqual(r2.persist.preferencesDelta, "Prefers with cardigan.",
      "preferences delta records the add: " + r2.persist.preferencesDelta);
    assertMetaContract(r2, "add-back");
    noFabrication(r2, "add-back");
    console.log("  pass: round-trip, core=" + lookCats(cat, t2.proposal).join("+") + " + cardigan extra");
  }

  // --- (b) required-but-not-present: honest failure ---
  console.log("\n[(b) add my blazer with no blazer -> honest failure]");
  {
    const cat = seed("b", ["dress", "scarf", "bag"]);
    const before = cat.getActivePieces().length;
    const r = await ReviseLook.handle({ catalog: cat, text: "add my blazer", metaClient: null });
    assert.strictEqual(r.skill, "revise_look");
    assert.strictEqual(r.image, null, "no image without a look");
    assert.ok(/no blazer in your wardrobe yet/.test(r.text),
      "plain honest failure, no fabrication: " + r.text.slice(0, 120));
    assert.ok(!/looking darling together/.test(r.text), "no fabricated look claim");
    assert.ok(!/Fit check: valid/.test(r.text), "no false fit-check claim");
    assert.strictEqual(cat.getActivePieces().length, before, "nothing destroyed");
    const t = cat.getTurns()[0];
    assert.strictEqual(t.verdict, false, "verdict false");
    assert.strictEqual(t.proposal, null, "no proposal on honest failure");
    assert.ok(t.reasons.indexOf("required_not_present") !== -1,
      "reasons record the missing requirement: " + JSON.stringify(t.reasons));
    assert.strictEqual(r.meta.imageDelivery.reason, "no_valid_look", "truthful delivery reason");
    assertMetaContract(r, "honest failure");
    noFabrication(r, "honest failure");
    console.log("  pass: honest failure, wardrobe intact");
  }

  // --- (c) swap-for: exclude one, require the other ---
  console.log("\n[(c) swap the cardigan for the blazer]");
  {
    const cat = seed("c", ["dress", "layer/cardigan", "layer/blazer", "scarf", "bag"]);
    const r = await ReviseLook.handle({ catalog: cat, text: "swap the cardigan for the blazer", metaClient: null });
    const t = cat.getTurns()[0];
    assert.strictEqual(t.verdict, true, "swap turn validates: " + r.text);
    const cats = lookCats(cat, t.proposal);
    assert.ok(cats.indexOf("layer/blazer") !== -1,
      "look uses the blazer as the finish: " + cats.join("+"));
    assert.ok(cats.indexOf("layer/cardigan") === -1,
      "look never uses the cardigan: " + cats.join("+"));
    assert.ok(t.reasons.indexOf("excluded:layer/cardigan") !== -1 &&
      t.reasons.indexOf("required:layer/blazer") !== -1,
      "reasons record both sides: " + JSON.stringify(t.reasons));
    assert.ok(/set aside your cardigan and brought back your blazer/.test(r.text),
      "swap reply names both: " + r.text.slice(0, 120));
    assertMetaContract(r, "swap");
    noFabrication(r, "swap");
    console.log("  pass: look=" + cats.join("+"));
  }

  // --- (d) exclude-only unchanged ---
  console.log("\n[(d) no cardigan this time unchanged]");
  {
    const cat = seed("d", ["dress", "layer/cardigan", "base/top", "base/bottom", "scarf", "bag"]);
    const before = cat.getActivePieces().map(function (p) { return p.piece_id; }).sort();
    const r = await ReviseLook.handle({ catalog: cat, text: "no cardigan this time", metaClient: null });
    const after = cat.getActivePieces();
    assert.deepStrictEqual(
      after.map(function (p) { return p.piece_id; }).sort(), before,
      "exclusion still destroys nothing");
    const t = cat.getTurns()[0];
    assert.strictEqual(t.verdict, true, "revised look validates");
    const cats = lookCats(cat, t.proposal);
    assert.ok(cats.indexOf("layer/cardigan") === -1, "cardigan excluded: " + cats.join("+"));
    assert.ok(/set aside your cardigan for now/.test(r.text), "exclude reply kept");
    assert.strictEqual(r.persist.preferencesDelta, "Prefers without cardigan.",
      "exclude preferences delta kept");
    assertMetaContract(r, "exclude-only");
    noFabrication(r, "exclude-only");
    console.log("  pass: look=" + cats.join("+"));
  }

  // --- (e) router reaches revise_look on fresh add-only phrasing ---
  console.log("\n[(e) router heuristic catches add-only phrasing]");
  {
    const r1 = Router.heuristicSkill({ text: "add the cardigan back" });
    assert.strictEqual(r1.skill, "revise_look", "add-back routes to revise_look: " + JSON.stringify(r1));
    const r2 = Router.heuristicSkill({ text: "can you add my blazer" });
    assert.strictEqual(r2.skill, "revise_look", "add-my routes to revise_look: " + JSON.stringify(r2));
    const r3 = Router.heuristicSkill({ text: "no cardigan this time" });
    assert.strictEqual(r3.skill, "revise_look", "exclude-only still routes there");
    const r4 = Router.heuristicSkill({ text: "can you make me a fairycore look for a wet day" });
    assert.strictEqual(r4.skill, "propose_look", "occasion propose still routes to propose_look");
    console.log("  pass: add-only -> revise_look, occasion -> propose_look");
  }

  console.log("\nAll revise-look ADD tests passed.");
}

run().catch((e) => { console.error(e.stack || e); process.exit(1); });
