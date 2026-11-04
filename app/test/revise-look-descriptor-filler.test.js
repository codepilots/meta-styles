"use strict";
/* meta-styles follow-up fix — revise_look filler words are NOT descriptors.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Regression: descriptorOf() treated ANY non-stop word as a descriptor, so
 * "maybe add my scarf" / "add my scarf hun" /
 * "could you also add my scarf thanks" / "lets try adding my scarf" all
 * resolved to an honest no-add ("I don't see a maybe scarf…") instead of
 * the default first-not-in-look pick. Descriptor words are now split into
 * attribute words (fixed colour/pattern/material vocabulary) and other
 * words (filler, names, typos): only attribute words can trigger an
 * honest no-add, and the honest reply quotes only them ("striped scarf",
 * never "also thanks scarf"), with "an" before a vowel sound.
 *
 * Two-scarf wardrobe (pink catalogued first, multicolor second) with a
 * dress+cardigan current look:
 *   (a) the four filler regressions add the default (pink) scarf, with
 *       metaClient=null AND with a Spark stub answering "any";
 *   (b) "add my striped scarf" with metaClient=null -> honest no-add,
 *       reply says "striped scarf", nothing added;
 *   (c) "add the colourful scarf" with a Spark stub picking the
 *       multicolor id -> multicolor added;
 *   (d) "add my orange scarf" (no orange piece), no client -> honest
 *       no-add, reply says "an orange scarf", nothing added.
 * All catalogs/ids synthetic (SYNTH_ prefix) — never real data. No
 * network: the only "Spark" is a stubbed metaClient.interpret.
 *
 * Run: node app/test/revise-look-descriptor-filler.test.js
 */
const assert = require("node:assert");
const Wardrobe = require("../wardrobe-catalog.js");
const ReviseLook = require("../skills/revise_look/handler.js");

function seedTwoScarves(tag) {
  const cat = Wardrobe.createCatalog({ userKey: "SYNTH_m36f_" + tag });
  cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_m36f_" + tag + "_d" });
  cat.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_share_m36f_" + tag + "_c" });
  cat.addPiece({ category: "scarf", attributes: { color: "pink" }, source_share_id: "SYNTH_share_m36f_" + tag + "_p" });
  cat.addPiece({ category: "scarf", attributes: { color: "multicolor" }, source_share_id: "SYNTH_share_m36f_" + tag + "_m" });
  const byColor = {};
  const ids = {};
  cat.getActivePieces().forEach(function (p) {
    ids[p.category + ":" + (p.attributes.color || "")] = p.piece_id;
    if (p.category === "scarf") byColor[p.attributes.color] = p.piece_id;
    if (p.category === "dress") ids.dress = p.piece_id;
    if (p.category === "layer/cardigan") ids.cardigan = p.piece_id;
  });
  cat.recordTurn({ userText: "seed", proposal: { pieces: [ids.dress, ids.cardigan] }, verdict: true, reasons: [] });
  return { cat: cat, dress: ids.dress, cardigan: ids.cardigan, pink: byColor.pink, multi: byColor.multicolor };
}

function scarvesInResult(cat, turn) {
  const live = {};
  cat.getActivePieces().forEach(function (p) { live[p.piece_id] = p; });
  const out = [];
  (turn.proposal.pieces || []).forEach(function (id) {
    if (live[id] && live[id].category === "scarf") out.push(id);
  });
  (turn.proposal.extras || []).forEach(function (ex) {
    if (ex && ex.category === "scarf") out.push(ex.piece_id);
  });
  return out;
}

const FILLER_CASES = [
  "maybe add my scarf",
  "add my scarf hun",
  "could you also add my scarf thanks",
  "lets try adding my scarf"
];

async function run() {
  console.log("revise-look-descriptor-filler.test.js");

  // --- (a1) filler regressions, no client -> default (pink) scarf ---
  console.log("\n[(a1) filler words, no Spark -> default pink scarf]");
  for (const text of FILLER_CASES) {
    const s = seedTwoScarves("a1_" + text.length + "_" + text.charCodeAt(0));
    const r = await ReviseLook.handle({ catalog: s.cat, text: text, metaClient: null });
    const t = s.cat.getTurns()[1];
    assert.strictEqual(t.verdict, true, JSON.stringify(text) + " adds: " + r.text.slice(0, 120));
    assert.deepStrictEqual(scarvesInResult(s.cat, t), [s.pink],
      JSON.stringify(text) + " picks the default pink: " + JSON.stringify(scarvesInResult(s.cat, t)));
    assert.ok(!/don't see/.test(r.text), JSON.stringify(text) + " is not a no-add: " + r.text.slice(0, 120));
    console.log("  pass (no client): " + JSON.stringify(text));
  }

  // --- (a2) filler regressions, Spark stub answering "any" -> default (pink) scarf ---
  console.log("\n[(a2) filler words, Spark says 'any' -> default pink scarf]");
  for (const text of FILLER_CASES) {
    const s = seedTwoScarves("a2_" + text.length + "_" + text.charCodeAt(0));
    const seen = {};
    const stub = {
      interpret: async function (said, options) {
        seen.options = options;
        return { choice: "any" };
      }
    };
    const r = await ReviseLook.handle({ catalog: s.cat, text: text, metaClient: stub });
    const t = s.cat.getTurns()[1];
    assert.strictEqual(t.verdict, true, JSON.stringify(text) + " adds: " + r.text.slice(0, 120));
    assert.deepStrictEqual(scarvesInResult(s.cat, t), [s.pink],
      JSON.stringify(text) + " picks the default pink: " + JSON.stringify(scarvesInResult(s.cat, t)));
    assert.ok(!/don't see/.test(r.text), JSON.stringify(text) + " is not a no-add: " + r.text.slice(0, 120));
    assert.ok(Array.isArray(r.trace) && r.trace.indexOf("interpret:spark:any") !== -1,
      JSON.stringify(text) + " consulted Spark: " + JSON.stringify(r.trace));
    assert.ok(seen.options && seen.options.some(function (o) { return o.id === "any"; }) &&
      seen.options.some(function (o) { return o.id === "none"; }),
      JSON.stringify(text) + " offered any + none: " + JSON.stringify(seen.options));
    console.log("  pass (Spark any): " + JSON.stringify(text));
  }

  // --- (b) attribute word, no client -> honest no-add quoting only it ---
  console.log("\n[(b) add my striped scarf, no Spark -> honest no-add]");
  {
    const s = seedTwoScarves("b");
    const before = s.cat.getActivePieces().length;
    const r = await ReviseLook.handle({ catalog: s.cat, text: "add my striped scarf", metaClient: null });
    const t = s.cat.getTurns()[1];
    assert.strictEqual(t.verdict, false, "no silent add");
    assert.strictEqual(t.proposal, null, "no proposal recorded");
    assert.strictEqual(s.cat.getActivePieces().length, before, "wardrobe intact");
    assert.ok(/don't see a striped scarf/.test(r.text), "quotes the attribute only: " + r.text.slice(0, 140));
    assert.ok(/pink scarf/.test(r.text) && /multicolor scarf/.test(r.text),
      "lists the ones they have: " + r.text.slice(0, 160));
    console.log("  pass: nothing added, striped scarf quoted");
  }

  // --- (c) colourful via Spark pick -> multicolor added ---
  console.log("\n[(c) add the colourful scarf, Spark picks multicolor -> multicolor]");
  {
    const s = seedTwoScarves("c");
    const stub = { interpret: async function () { return { choice: s.multi }; } };
    const r = await ReviseLook.handle({ catalog: s.cat, text: "add the colourful scarf", metaClient: stub });
    const t = s.cat.getTurns()[1];
    assert.strictEqual(t.verdict, true, "add validates: " + r.text.slice(0, 120));
    assert.deepStrictEqual(scarvesInResult(s.cat, t), [s.multi],
      "multicolor added: " + JSON.stringify(scarvesInResult(s.cat, t)));
    assert.ok(/multicolor scarf/.test(r.text), "reply names it: " + r.text.slice(0, 120));
    console.log("  pass: multicolor added via Spark pick");
  }

  // --- (d) orange (vowel sound), no client -> "an orange scarf" ---
  console.log("\n[(d) add my orange scarf, no Spark -> honest 'an orange scarf']");
  {
    const s = seedTwoScarves("d");
    const before = s.cat.getActivePieces().length;
    const r = await ReviseLook.handle({ catalog: s.cat, text: "add my orange scarf", metaClient: null });
    const t = s.cat.getTurns()[1];
    assert.strictEqual(t.verdict, false, "no silent add");
    assert.strictEqual(t.proposal, null, "no proposal recorded");
    assert.strictEqual(s.cat.getActivePieces().length, before, "wardrobe intact");
    assert.ok(/an orange scarf/.test(r.text), "vowel article: " + r.text.slice(0, 140));
    console.log("  pass: nothing added, 'an orange scarf' quoted");
  }

  console.log("\nAll revise-look descriptor-filler tests passed.");
}

run().catch((e) => { console.error(e.stack || e); process.exit(1); });
