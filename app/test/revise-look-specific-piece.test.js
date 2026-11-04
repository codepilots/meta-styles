"use strict";
/* meta-styles Milestone 36 — revise_look targets a SPECIFIC piece.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Two-scarf wardrobe (pink catalogued first, multicolor second) with a
 * dress+cardigan current look:
 *   (a) "add my multicolored scarf" adds the MULTICOLOR piece via the
 *       local colour match (no Spark call — metaClient is null);
 *   (b) "add my striped scarf" with a Spark stub returning "none" adds
 *       nothing and replies listing the pink + multicolor scarves;
 *   (c) an ambiguous descriptor ("pink" with two pink scarves) resolved
 *       by the Spark stub to a real piece_id adds THAT piece; a stub
 *       returning an invented id is rejected (nothing added);
 *   (d) with pink on as an extra, "add the multicolor scarf" REPLACES
 *       pink (one scarf in the result, never two);
 *   (e) "swap the scarf" with pink on swaps to multicolor, while
 *       "remove the scarf" still removes;
 *   (f) with a view list question pending, "can you add the multicolor
 *       scarf to my look?" breaks out to revise_look and adds
 *       multicolor; "the second one" still goes to view_wardrobe_item;
 *   (g) after view shows the multicolor piece, "can you add it to my
 *       look" adds multicolor (last-shown pronoun);
 *   (h) "add my scarf" with no descriptor keeps the old
 *       first-not-in-look behaviour (pink);
 *   (i) "can you add it to my look" with nothing shown keeps the
 *       current clarification.
 * All catalogs/ids synthetic (SYNTH_ prefix) — never real data. No
 * network: the only "Spark" is a stubbed metaClient.interpret.
 *
 * Run: node app/test/revise-look-specific-piece.test.js
 */
const assert = require("node:assert");
const Wardrobe = require("../wardrobe-catalog.js");
const ReviseLook = require("../skills/revise_look/handler.js");
const AgenticLoop = require("../agentic-loop.js");
const Router = require("../router.js");

function seedTwoScarves(tag) {
  const cat = Wardrobe.createCatalog({ userKey: "SYNTH_m36_" + tag });
  cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_m36_" + tag + "_d" });
  cat.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_share_m36_" + tag + "_c" });
  cat.addPiece({ category: "scarf", attributes: { color: "pink" }, source_share_id: "SYNTH_share_m36_" + tag + "_p" });
  cat.addPiece({ category: "scarf", attributes: { color: "multicolor" }, source_share_id: "SYNTH_share_m36_" + tag + "_m" });
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

function noFabrication(result, label) {
  const dumped = JSON.stringify(result);
  assert.ok(!/example\.invalid/.test(dumped), label + " must contain no example.invalid");
  assert.ok(!/SYNTH_piece_/.test(result.text), label + " reply names no piece ids: " + result.text.slice(0, 160));
}

function assertMetaContract(r, label) {
  assert.ok(r.meta && r.meta.imageDelivery, label + ": imageDelivery nested under meta");
  assert.ok(!("imageDelivery" in r), label + ": no top-level imageDelivery");
}

function freshLoop(catalog) {
  return AgenticLoop.createAgenticLoop({ catalog: catalog, router: Router, summariser: null });
}

async function run() {
  console.log("revise-look-specific-piece.test.js");

  // --- (a) local colour match, no Spark call ---
  console.log("\n[(a) add my multicolored scarf -> multicolor, no Spark]");
  {
    const s = seedTwoScarves("a");
    const r = await ReviseLook.handle({ catalog: s.cat, text: "add my multicolored scarf", metaClient: null });
    const t = s.cat.getTurns()[1];
    assert.strictEqual(t.verdict, true, "add validates: " + r.text.slice(0, 120));
    assert.deepStrictEqual(scarvesInResult(s.cat, t), [s.multi],
      "multicolor added, pink untouched: " + JSON.stringify(scarvesInResult(s.cat, t)));
    assert.ok(/multicolor scarf/.test(r.text), "reply names the actual piece: " + r.text.slice(0, 120));
    assert.ok(t.reasons.indexOf("added:scarf") !== -1, "add reason kept: " + JSON.stringify(t.reasons));
    assertMetaContract(r, "specific add");
    noFabrication(r, "specific add");
    console.log("  pass: multicolor extra, reply names it");
  }

  // --- (b) descriptor matches nothing + Spark none -> honest no-add ---
  console.log("\n[(b) add my striped scarf (Spark: none) -> nothing, honest list]");
  {
    const s = seedTwoScarves("b");
    const stub = { interpret: async function () { return { choice: "none" }; } };
    const before = s.cat.getActivePieces().length;
    const r = await ReviseLook.handle({ catalog: s.cat, text: "add my striped scarf", metaClient: stub });
    const t = s.cat.getTurns()[1];
    assert.strictEqual(t.verdict, false, "no silent add: verdict false");
    assert.strictEqual(t.proposal, null, "no proposal recorded");
    assert.strictEqual(s.cat.getActivePieces().length, before, "wardrobe intact");
    assert.ok(/don't see a striped scarf/.test(r.text), "honest miss: " + r.text.slice(0, 140));
    assert.ok(/pink scarf/.test(r.text) && /multicolor scarf/.test(r.text),
      "lists the ones they have: " + r.text.slice(0, 160));
    assert.ok(Array.isArray(r.trace) && r.trace.indexOf("interpret:spark:none") !== -1,
      "Spark miss on the audit trail: " + JSON.stringify(r.trace));
    assertMetaContract(r, "honest miss");
    noFabrication(r, "honest miss");
    console.log("  pass: nothing added, pink + multicolor listed");
  }

  // --- (c) ambiguous descriptor -> Spark real id adds it; invented id rejected ---
  console.log("\n[(c) ambiguous pink -> Spark picks the second pink; invented id rejected]");
  {
    function seedTwoPinks(tag) {
      const cat = Wardrobe.createCatalog({ userKey: "SYNTH_m36_" + tag });
      cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_m36_" + tag + "_d" });
      cat.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_share_m36_" + tag + "_c" });
      const a = cat.addPiece({ category: "scarf", attributes: { color: "pink" }, source_share_id: "SYNTH_share_m36_" + tag + "_a" });
      const b = cat.addPiece({ category: "scarf", attributes: { color: "pink" }, source_share_id: "SYNTH_share_m36_" + tag + "_b" });
      let dress = null, card = null;
      cat.getActivePieces().forEach(function (p) {
        if (p.category === "dress") dress = p.piece_id;
        if (p.category === "layer/cardigan") card = p.piece_id;
      });
      cat.recordTurn({ userText: "seed", proposal: { pieces: [dress, card] }, verdict: true, reasons: [] });
      return { cat: cat, pinkA: a.piece_id, pinkB: b.piece_id };
    }
    const s = seedTwoPinks("c1");
    let seenOpts = null;
    const stub = {
      interpret: async function (text, options) {
        seenOpts = options;
        return { choice: s.pinkB };
      }
    };
    const r = await ReviseLook.handle({ catalog: s.cat, text: "add my pink scarf", metaClient: stub });
    const t = s.cat.getTurns()[1];
    assert.ok(seenOpts && seenOpts.length === 3, "closed choice over 2 real pieces + none, got " + JSON.stringify(seenOpts));
    assert.deepStrictEqual(
      seenOpts.map(function (o) { return o.id; }).sort(),
      ["none", s.pinkA, s.pinkB].sort(),
      "options are real piece ids plus none");
    assert.strictEqual(t.verdict, true, "add validates: " + r.text.slice(0, 120));
    assert.deepStrictEqual(scarvesInResult(s.cat, t), [s.pinkB],
      "the Spark-picked piece added: " + JSON.stringify(scarvesInResult(s.cat, t)));
    assert.ok(/pink scarf/.test(r.text), "reply names it: " + r.text.slice(0, 120));
    noFabrication(r, "spark pick");

    const s2 = seedTwoPinks("c2");
    const badStub = { interpret: async function () { return { choice: "SYNTH_piece_999" }; } };
    const r2 = await ReviseLook.handle({ catalog: s2.cat, text: "add my pink scarf", metaClient: badStub });
    const t2 = s2.cat.getTurns()[1];
    assert.strictEqual(t2.verdict, false, "invented id rejected: verdict false");
    assert.strictEqual(t2.proposal, null, "invented id rejected: no proposal");
    assert.deepStrictEqual(scarvesInResult(s2.cat, s2.cat.getTurns()[0]), [],
      "seed look untouched, nothing added");
    assert.ok(/pink scarf/.test(r2.text), "honest reply still lists: " + r2.text.slice(0, 160));
    noFabrication(r2, "invented id");
    console.log("  pass: real id added, invented id rejected");
  }

  // --- (d) specific add replaces the same-family extra ---
  console.log("\n[(d) pink on, add multicolor -> replaces (one scarf)]");
  {
    const s = seedTwoScarves("d");
    s.cat.recordTurn({
      userText: "add my pink scarf",
      proposal: { pieces: [s.dress, s.cardigan], extras: [{ piece_id: s.pink, category: "scarf" }] },
      verdict: true, reasons: ["added:scarf", "extra:scarf"]
    });
    const r = await ReviseLook.handle({ catalog: s.cat, text: "add the multicolor scarf", metaClient: null });
    const t = s.cat.getTurns()[2];
    assert.strictEqual(t.verdict, true, "replace validates: " + r.text.slice(0, 120));
    assert.deepStrictEqual(t.proposal.pieces, [s.dress, s.cardigan], "core unchanged");
    assert.deepStrictEqual(scarvesInResult(s.cat, t), [s.multi], "one scarf: multicolor only");
    assert.ok(/multicolor scarf/.test(r.text), "reply names the new piece: " + r.text.slice(0, 120));
    assertMetaContract(r, "replace");
    noFabrication(r, "replace");
    console.log("  pass: pink replaced by multicolor, core kept");
  }

  // --- (e) swap within the family; remove still removes ---
  console.log("\n[(e) swap the scarf -> multicolor; remove the scarf -> gone]");
  {
    const s = seedTwoScarves("e1");
    s.cat.recordTurn({
      userText: "add my pink scarf",
      proposal: { pieces: [s.dress, s.cardigan], extras: [{ piece_id: s.pink, category: "scarf" }] },
      verdict: true, reasons: ["added:scarf", "extra:scarf"]
    });
    const r = await ReviseLook.handle({ catalog: s.cat, text: "swap the scarf", metaClient: null });
    const t = s.cat.getTurns()[2];
    assert.strictEqual(t.verdict, true, "swap validates: " + r.text.slice(0, 140));
    assert.deepStrictEqual(scarvesInResult(s.cat, t), [s.multi], "swapped to multicolor");
    assert.ok(/wapped your pink scarf for your multicolor scarf/.test(r.text),
      "swap reply names both: " + r.text.slice(0, 140));
    assert.ok(t.reasons.indexOf("swapped:scarf") !== -1, "swap reason: " + JSON.stringify(t.reasons));
    assertMetaContract(r, "swap");
    noFabrication(r, "swap");

    const s2 = seedTwoScarves("e2");
    s2.cat.recordTurn({
      userText: "add my pink scarf",
      proposal: { pieces: [s2.dress, s2.cardigan], extras: [{ piece_id: s2.pink, category: "scarf" }] },
      verdict: true, reasons: ["added:scarf", "extra:scarf"]
    });
    const r2 = await ReviseLook.handle({ catalog: s2.cat, text: "remove the scarf", metaClient: null });
    const t2 = s2.cat.getTurns()[2];
    assert.strictEqual(t2.verdict, true, "drop validates");
    assert.deepStrictEqual(t2.proposal.pieces, [s2.dress, s2.cardigan], "core unchanged");
    assert.deepStrictEqual(t2.proposal.extras, [], "extra dropped");
    assert.ok(/Set aside your scarf/.test(r2.text), "drop copy kept: " + r2.text.slice(0, 100));
    console.log("  pass: swap swaps, remove removes");
  }

  // --- (f) pending list question: add breaks out, plain pick stays ---
  console.log("\n[(f) view list pending: add-to-look -> revise_look; 'the second one' -> view]");
  {
    const s = seedTwoScarves("f1");
    const loop = freshLoop(s.cat);
    const t1 = await loop.handleTurn({ message: "show me the scarves", hasImage: false });
    assert.strictEqual(t1.skill, "view_wardrobe_item", "list routes to view, got " + t1.skill);
    assert.ok(/1\. pink scarf/.test(t1.text) && /2\. multicolor scarf/.test(t1.text),
      "numbered list shown: " + t1.text.slice(0, 120));
    const t2 = await loop.handleTurn({ message: "can you add the multicolor scarf to my look?", hasImage: false });
    assert.strictEqual(t2.skill, "revise_look", "add breaks out to revise_look, got " + t2.skill);
    assert.ok(!/pending expectation satisfied/.test(t2.decision.reason),
      "router decided (no stale capture): " + t2.decision.reason);
    const last = s.cat.getTurns()[s.cat.getTurns().length - 1];
    assert.deepStrictEqual(scarvesInResult(s.cat, last), [s.multi], "multicolor added");
    assert.ok(/multicolor scarf/.test(t2.text), "reply names it: " + t2.text.slice(0, 120));
    assert.strictEqual(s.cat.getPendingQuestions().length, 0, "stale list question resolved");

    const s2 = seedTwoScarves("f2");
    const loop2 = freshLoop(s2.cat);
    await loop2.handleTurn({ message: "show me the scarves", hasImage: false });
    const turnsBefore = s2.cat.getTurns().length;
    const t3 = await loop2.handleTurn({ message: "the second one", hasImage: false });
    assert.strictEqual(t3.skill, "view_wardrobe_item", "plain pick stays in view, got " + t3.skill);
    assert.strictEqual(s2.cat.getTurns().length, turnsBefore, "no look turn recorded by a pick");
    console.log("  pass: breakout routes to revise, plain pick stays in view");
  }

  // --- (g) pronoun: the piece just shown ---
  console.log("\n[(g) view shows multicolor, then 'add it to my look' adds it]");
  {
    const s = seedTwoScarves("g");
    const loop = freshLoop(s.cat);
    const t1 = await loop.handleTurn({ message: "show me the scarves", hasImage: false });
    assert.strictEqual(t1.skill, "view_wardrobe_item");
    const t2 = await loop.handleTurn({ message: "2", hasImage: false });
    assert.strictEqual(t2.skill, "view_wardrobe_item", "pick stays in view, got " + t2.skill);
    assert.ok(/multicolor scarf/.test(t2.text), "multicolor shown: " + t2.text.slice(0, 120));
    const t3 = await loop.handleTurn({ message: "can you add it to my look", hasImage: false });
    assert.strictEqual(t3.skill, "revise_look", "pronoun add routes to revise_look, got " + t3.skill);
    const last = s.cat.getTurns()[s.cat.getTurns().length - 1];
    assert.deepStrictEqual(scarvesInResult(s.cat, last), [s.multi], "'it' resolved to multicolor");
    assert.ok(/multicolor scarf/.test(t3.text), "reply names it: " + t3.text.slice(0, 120));
    noFabrication(t3, "pronoun add");
    console.log("  pass: 'it' resolved to the just-shown piece");
  }

  // --- (h) no descriptor keeps the old first-not-in-look pick ---
  console.log("\n[(h) add my scarf -> first-not-in-look (pink), old copy]");
  {
    const s = seedTwoScarves("h");
    const r = await ReviseLook.handle({ catalog: s.cat, text: "add my scarf", metaClient: null });
    const t = s.cat.getTurns()[1];
    assert.strictEqual(t.verdict, true, "add validates: " + r.text.slice(0, 120));
    assert.deepStrictEqual(scarvesInResult(s.cat, t), [s.pink], "deterministic first pick: pink");
    assert.ok(/Added your scarf on top/.test(r.text), "old extra copy kept: " + r.text.slice(0, 100));
    console.log("  pass: pink added with the old wording");
  }

  // --- (i) pronoun with nothing shown keeps the clarification ---
  console.log("\n[(i) add it with nothing shown -> clarification]");
  {
    const s = seedTwoScarves("i");
    const r = await ReviseLook.handle({ catalog: s.cat, text: "can you add it to my look", metaClient: null });
    assert.ok(/which piece would you like to swap, skip, or add back/.test(r.text),
      "clarification kept: " + r.text.slice(0, 120));
    console.log("  pass: clarification kept");
  }

  console.log("\nAll revise-look specific-piece tests passed.");
}

run().catch((e) => { console.error(e.stack || e); process.exit(1); });
