"use strict";
/* meta-styles Milestone 23 item 1 — explain_fit context tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves explain_fit tailors its reply to the real look context instead
 * of returning one fixed paragraph:
 *   (a) a layer-finish look in context names the layer + "worn open";
 *   (b) a scarf+bag-finish look in context names scarf + bag + "tied high";
 *   (c) recent user text steers the explanation when the catalog alone
 *       is ambiguous (lastTurns is actually read);
 *   (d) with no look/catalog data the reply says so honestly, names no
 *       pieces, and never throws (even with missing opts).
 * All catalogs/ids synthetic (SYNTH_ prefix) — never real data. No network.
 *
 * Run: node app/test/explain-fit-context.test.js
 */
const assert = require("node:assert");
const Handler = require("../skills/explain_fit/handler.js");
const Wardrobe = require("../wardrobe-catalog.js");

function layerCatalog() {
  const cat = Wardrobe.createCatalog({ userKey: "SYNTH_explain_layer" });
  const dress = cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_301" });
  const cardi = cat.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_share_302" });
  cat.recordTurn({
    userText: "SYNTH show me a look",
    proposal: { pieces: [dress.piece_id, cardi.piece_id], title: "SYNTH look v1", note: "valid:layer" },
    verdict: true,
    reasons: [],
  });
  return cat;
}

function scarfBagCatalog() {
  const cat = Wardrobe.createCatalog({ userKey: "SYNTH_explain_scarfbag" });
  const top = cat.addPiece({ category: "base/top", attributes: {}, source_share_id: "SYNTH_share_311" });
  const scarf = cat.addPiece({ category: "scarf", attributes: {}, source_share_id: "SYNTH_share_312" });
  const bag = cat.addPiece({ category: "bag", attributes: {}, source_share_id: "SYNTH_share_313" });
  cat.recordTurn({
    userText: "SYNTH show me a look",
    proposal: { pieces: [top.piece_id, scarf.piece_id, bag.piece_id], title: "SYNTH look v1", note: "valid:scarf+bag" },
    verdict: true,
    reasons: [],
  });
  return cat;
}

function noSynthLeak(r, label) {
  assert.ok(!/SYNTH_/.test(r.text), label + " must not leak SYNTH_ ids: " + r.text.slice(0, 200));
}

async function run() {
  console.log("Milestone 23 item 1 — explain-fit-context.test.js");

  // --- (a) layer-finish look in context ---
  console.log("\n[(a) layer look names layer + worn open]");
  {
    const r = await Handler.handle({ catalog: layerCatalog(), text: "why does this work?", lastTurns: [] });
    assert.strictEqual(r.skill, "explain_fit", "skill tag");
    assert.ok(/cardigan/.test(r.text), "names the real layer: " + r.text.slice(0, 160));
    assert.ok(/worn open/.test(r.text), "layer mechanic: " + r.text.slice(0, 160));
    assert.ok(!/tied high/.test(r.text), "no scarf mechanic for a layer look");
    assert.ok(!/\bcardigan\b.*\bscarf\b|\bscarf\b.*\bcardigan\b/.test(r.text), "single finish only");
    noSynthLeak(r, "layer reply");
    console.log("  pass: layer context -> cardigan + worn open");
  }

  // --- (b) scarf+bag-finish look in context ---
  console.log("\n[(b) scarf+bag look names scarf + bag + tied high]");
  {
    const r = await Handler.handle({ catalog: scarfBagCatalog(), text: "why does this work?", lastTurns: [] });
    assert.ok(/scarf/.test(r.text) && /bag/.test(r.text), "names the real finish pair: " + r.text.slice(0, 160));
    assert.ok(/tied high/.test(r.text), "scarf+bag mechanic: " + r.text.slice(0, 160));
    assert.ok(!/worn open/.test(r.text), "no layer mechanic for a scarf+bag look");
    noSynthLeak(r, "scarf+bag reply");
    console.log("  pass: scarf+bag context -> scarf + bag + tied high");
  }

  // --- (c) lastTurns user text steers an ambiguous catalog ---
  console.log("\n[(c) lastTurns hint disambiguates]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_explain_hint" });
    cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_321" });
    cat.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_share_322" });
    cat.addPiece({ category: "scarf", attributes: {}, source_share_id: "SYNTH_share_323" });
    cat.addPiece({ category: "bag", attributes: {}, source_share_id: "SYNTH_share_324" });
    // No recorded turns: catalog alone would prefer the layer look.
    const hinted = await Handler.handle({
      catalog: cat, text: "why does this work?",
      lastTurns: ["SYNTH why does this work for my scarf and bag look?"],
    });
    assert.ok(/tied high/.test(hinted.text), "hint steers to scarf+bag: " + hinted.text.slice(0, 160));
    const unhinted = await Handler.handle({ catalog: cat, text: "why does this work?", lastTurns: [] });
    assert.ok(/worn open/.test(unhinted.text), "without hint, catalog fallback explains the layer look");
    assert.notStrictEqual(hinted.text, unhinted.text, "lastTurns changes the reply");
    noSynthLeak(hinted, "hinted reply");
    console.log("  pass: lastTurns hint read, reply differs");
  }

  // --- (d) no context: honest fallback, no fabrication, no crash ---
  console.log("\n[(d) no context -> honest fallback]");
  {
    const empty = Wardrobe.createCatalog({ userKey: "SYNTH_explain_empty" });
    const r = await Handler.handle({ catalog: empty, text: "why does this work?", lastTurns: [] });
    assert.ok(/don't have a look|no look/i.test(r.text), "says it has no look: " + r.text.slice(0, 160));
    assert.ok(!/cardigan|blazer|scarf|bag|worn open|tied high/.test(r.text), "names no pieces or finish");
    noSynthLeak(r, "empty reply");
    // Missing opts entirely must not throw.
    const r2 = await Handler.handle();
    assert.ok(typeof r2.text === "string" && r2.text.length > 0, "handle() with no opts returns text");
    // A turn pointing at unknown piece ids resolves to nothing -> honest fallback, not a crash.
    const bad = Wardrobe.createCatalog({ userKey: "SYNTH_explain_bad" });
    bad.recordTurn({
      userText: "SYNTH show me a look",
      proposal: { pieces: ["SYNTH_piece_999"], title: "SYNTH stale", note: "valid:layer" },
      verdict: true,
      reasons: [],
    });
    const r3 = await Handler.handle({ catalog: bad, text: "why?", lastTurns: [] });
    assert.ok(/don't have a look|no look/i.test(r3.text), "stale ids fall back honestly, no fabrication");
    console.log("  pass: honest no-guess fallback, never throws");
  }

  console.log("\nAll explain-fit-context tests passed.");
}

run().catch((e) => { console.error(e.stack || e); process.exit(1); });
