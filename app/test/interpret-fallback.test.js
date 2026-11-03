"use strict";
/* meta-styles — Spark closed-choice fallback tests (interpret.js seam).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Any user message local parsing misses is run through Muse Spark,
 * constrained to a CLOSED set of options built from real state — the
 * server validates the choice and anything outside the options is
 * treated as no match. Covers:
 *
 *   (1) local-first: "delete my dress", "show me my jacket",
 *       "bin my heels" resolve with NO Spark call (throwing stub).
 *   (2) Step A miss: a phrase only Spark resolves (stub returns a real
 *       category id) lists that category; a stub id NOT in the options
 *       keeps the honest reply and deletes nothing.
 *   (3) Step B: "the pink one" with stub picking entry 2 asks the
 *       confirm question for entry 2 (delete) / shows entry 2 (view).
 *   (4) revise CLARIFY: "lose the strappy thing" with stub
 *       "remove:bag" removes the bag via the normal re-weave; stub
 *       "none" keeps the existing CLARIFY_TEXT.
 *   (5) yes_no: pending clear-all + "yeah go on, bin the lot" with stub
 *       "yes" clears the wardrobe; stub "unclear" clears nothing;
 *       fixed-list "yes" never calls Spark.
 *   (6) no metaClient / interpret throws: every path behaves exactly as
 *       before (honest replies, no trace field, nothing removed).
 *   (7) router offline heuristic: singular phrases route correctly;
 *       "delete my photos", bare "DELETE", "forget me" unchanged.
 *
 * Real in-memory catalog + real heuristic router throughout; Spark is a
 * stubbed metaClient.interpret — no network, no sends. All ids synthetic
 * (SYNTH_ prefix) — never real data.
 *
 * Run: node app/test/interpret-fallback.test.js
 */
const assert = require("node:assert");
const AgenticLoop = require("../agentic-loop.js");
const Router = require("../router.js");
const Wardrobe = require("../wardrobe-catalog.js");
const Interpret = require("../interpret.js");
const ViewItem = require("../skills/view_wardrobe_item/handler.js");
const DeleteItem = require("../skills/delete_wardrobe_item/handler.js");
const ReviseLook = require("../skills/revise_look/handler.js");

const REAL_CATS = [
  "base/top", "base/bottom", "dress",
  "layer/cardigan", "layer/blazer", "scarf", "bag", "shoes",
];

function noSynthLeak(text, label) {
  assert.ok(!/SYNTH_/.test(text), label + " must not leak SYNTH_ ids: " + String(text).slice(0, 200));
}

// A metaClient whose interpret throws if ever called: proves the
// local-first paths make no Spark call.
function throwingClient() {
  return { interpret: async () => { throw new Error("interpret must not be called"); } };
}

function stubClient(choice) {
  const calls = [];
  return {
    calls,
    interpret: async (text, options, question, context) => {
      calls.push({ text, options, question, context });
      return { choice, confidence: 90, source: "muse-spark-1.3", placeholder: false, cached: false };
    },
  };
}

function seedDresses(cat, tag) {
  const colors = ["pink", "cream", "red"];
  for (let i = 0; i < 3; i++) {
    cat.addPiece({
      category: "dress",
      attributes: { color: colors[i] },
      source_share_id: "SYNTH_if_d_" + tag + "_" + i,
      photo_thumb: "data:image/png;base64,SYNTH_if_t_" + tag + "_" + i,
      image_original: "data:image/png;base64,SYNTH_if_o_" + tag + "_" + i,
    });
  }
}

function seedLook(cat, tag) {
  const d = cat.addPiece({ category: "dress", attributes: { color: "red" }, source_share_id: "SYNTH_if_rd_" + tag, photo_thumb: "data:image/png;base64,SYNTH_t" });
  const s = cat.addPiece({ category: "scarf", attributes: { color: "teal" }, source_share_id: "SYNTH_if_rs_" + tag, photo_thumb: "data:image/png;base64,SYNTH_t" });
  const b = cat.addPiece({ category: "bag", attributes: { color: "brown" }, source_share_id: "SYNTH_if_rb_" + tag, photo_thumb: "data:image/png;base64,SYNTH_t" });
  cat.addPiece({ category: "layer/cardigan", attributes: { color: "cream" }, source_share_id: "SYNTH_if_rc_" + tag, photo_thumb: "data:image/png;base64,SYNTH_t" });
  cat.recordTurn({
    userText: "make me a look",
    proposal: { pieces: [d.piece_id, s.piece_id, b.piece_id], extras: [], title: null, note: "valid:scarf+bag" },
    verdict: true, reasons: ["seed"],
  });
  return cat;
}

async function run() {
  console.log("interpret-fallback.test.js");

  // --- (0) shared table sanity ---
  console.log("\n[(0) shared category table]");
  {
    assert.strictEqual(Interpret.categoryOf("delete my dress"), "dress", "singular dress");
    assert.strictEqual(Interpret.categoryOf("show me my jacket"), "layer/blazer", "jacket synonym");
    assert.strictEqual(Interpret.categoryOf("bin my heels"), "shoes", "heels synonym");
    assert.strictEqual(Interpret.categoryOf("get rid of my t-shirt"), "base/top", "t-shirt");
    assert.strictEqual(Interpret.categoryOf("throw out the scarves"), "scarf", "scarves");
    assert.strictEqual(Interpret.categoryOf("hello there"), null, "no garment -> null");
    for (const c of Object.values(Interpret.CATEGORY_WORDS)) {
      assert.ok(REAL_CATS.indexOf(c) !== -1, "table value is a real taxonomy category: " + c);
    }
    const none = await Interpret.sparkPick(null, "hi", [{ id: "a", description: "a" }]);
    assert.strictEqual(none, null, "sparkPick with no client -> null, never throws");
    const evil = await Interpret.sparkPick(
      { interpret: async () => ({ choice: "cape" }) },
      "hi", [{ id: "a", description: "a" }]);
    assert.strictEqual(evil, null, "sparkPick with invented id -> null");
    console.log("  pass: table + sparkPick closed-choice validation");
  }

  // --- (1) local-first: singulars resolve with NO Spark call ---
  console.log("\n[(1) singular phrases work locally, no Spark call]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_if_1" });
    seedDresses(cat, "1");
    const d = await DeleteItem.handle({ catalog: cat, text: "delete my dress", metaClient: throwingClient() });
    assert.ok(/Which one shall we let go/.test(d.text), "delete my dress lists, got: " + d.text);
    assert.strictEqual(d.trace, undefined, "no trace on local hit");
    noSynthLeak(d.text, "delete list");

    const cat2 = Wardrobe.createCatalog({ userKey: "SYNTH_if_1b" });
    seedDresses(cat2, "1b");
    const v = await ViewItem.handle({ catalog: cat2, text: "show me my jacket", metaClient: throwingClient() });
    // No jacket catalogued: local parse names layer/blazer, which is empty.
    assert.ok(/No blazers tucked in/.test(v.text), "jacket parses to blazer (empty), got: " + v.text);

    const cat3 = Wardrobe.createCatalog({ userKey: "SYNTH_if_1c" });
    cat3.addPiece({ category: "shoes", attributes: { color: "white" }, source_share_id: "SYNTH_if_sh_1c", photo_thumb: "data:image/png;base64,SYNTH_t" });
    const h = await DeleteItem.handle({ catalog: cat3, text: "bin my heels", metaClient: throwingClient() });
    assert.ok(/Which one shall we let go/.test(h.text), "bin my heels lists shoes, got: " + h.text);
    console.log("  pass: local singulars resolve, Spark never called");
  }

  // --- (2) Step A miss: Spark-only phrase + invented id ---
  console.log("\n[(2) Step A Spark fallback + invented-id fail-closed]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_if_2" });
    seedDresses(cat, "2");
    cat.addPiece({ category: "bag", attributes: { color: "brown" }, source_share_id: "SYNTH_if_2b", photo_thumb: "data:image/png;base64,SYNTH_t" });
    const stub = stubClient("bag");
    const r = await DeleteItem.handle({ catalog: cat, text: "the carryall thing", metaClient: stub });
    assert.ok(/Which one shall we let go/.test(r.text) && /bag/.test(r.text),
      "Spark bag choice lists bags, got: " + r.text);
    assert.deepStrictEqual(r.trace, ["interpret:spark:bag"], "trace names the choice, not raw text");
    assert.ok(stub.calls.length === 1, "one Spark call on a miss");
    for (const o of stub.calls[0].options) {
      assert.ok(REAL_CATS.indexOf(o.id) !== -1 || o.id === "clear_all",
        "Step A option is a real category or clear_all: " + o.id);
    }
    noSynthLeak(r.text, "spark list");

    const cat2 = Wardrobe.createCatalog({ userKey: "SYNTH_if_2b" });
    seedDresses(cat2, "2b");
    const evil = stubClient("cape");
    const r2 = await DeleteItem.handle({ catalog: cat2, text: "the caped thing", metaClient: evil });
    assert.ok(/which bit of your wardrobe to tidy/i.test(r2.text),
      "invented id keeps the honest reply, got: " + r2.text);
    assert.deepStrictEqual(r2.trace, ["interpret:spark:none"]);
    assert.strictEqual(cat2.getActivePieces().length, 3, "nothing deleted on invented id");
    console.log("  pass: Spark-only phrase lists; invented id fails closed");
  }

  // --- (3) Step B: "the pink one" picks entry 2 ---
  console.log("\n[(3) Step B Spark pick]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_if_3" });
    seedDresses(cat, "3");
    await DeleteItem.handle({ catalog: cat, text: "delete the dresses" });
    const stub = stubClient("2");
    const r = await DeleteItem.handle({ catalog: cat, text: "the pink one", metaClient: stub });
    assert.ok(/Remove your cream dress/.test(r.text),
      "stub entry 2 asks the confirm for entry 2, got: " + r.text);
    assert.deepStrictEqual(r.trace, ["interpret:spark:2"]);
    assert.strictEqual(cat.getActivePieces().length, 3, "pick never deletes directly");
    const ids = stub.calls[0].options.map((o) => o.id);
    assert.ok(ids.indexOf("1") !== -1 && ids.indexOf("show_more") !== -1 && ids.indexOf("none") !== -1,
      "Step B options are entries + show_more + none, got: " + ids.join(","));

    const catV = Wardrobe.createCatalog({ userKey: "SYNTH_if_3v" });
    seedDresses(catV, "3v");
    await ViewItem.handle({ catalog: catV, text: "show me the dresses" });
    const stubV = stubClient("2");
    const rv = await ViewItem.handle({ catalog: catV, text: "the pink one", metaClient: stubV });
    assert.ok(/cream dress/.test(rv.text), "view resolves entry 2, got: " + rv.text);
    console.log("  pass: Step B Spark pick resolves the stubbed entry");
  }

  // --- (4) revise CLARIFY ---
  console.log("\n[(4) revise CLARIFY Spark fallback]");
  {
    const cat = seedLook(Wardrobe.createCatalog({ userKey: "SYNTH_if_4" }), "4");
    const stub = stubClient("remove:bag");
    const r = await ReviseLook.handle({ catalog: cat, text: "lose the strappy thing", metaClient: stub });
    assert.ok(/set aside your bag/i.test(r.text), "bag removed via the normal re-weave, got: " + r.text);
    assert.deepStrictEqual(r.trace, ["interpret:spark:remove:bag"]);

    const cat2 = seedLook(Wardrobe.createCatalog({ userKey: "SYNTH_if_4b" }), "4b");
    const stubNone = stubClient(null);
    const r2 = await ReviseLook.handle({ catalog: cat2, text: "hmm not sure", metaClient: stubNone });
    assert.ok(/which piece would you like to swap/i.test(r2.text),
      "stub none keeps CLARIFY_TEXT, got: " + r2.text);
    assert.deepStrictEqual(r2.trace, ["interpret:spark:none"]);
    console.log("  pass: revise CLARIFY maps Spark choice onto the normal flow");
  }

  // --- (5) yes_no spark-affirmative ---
  console.log("\n[(5) pending yes_no spark-affirmative]");
  {
    async function clearSetup(tag) {
      const cat = Wardrobe.createCatalog({ userKey: "SYNTH_if_5" + tag });
      cat.addPiece({ category: "dress", attributes: { color: "pink" }, source_share_id: "SYNTH_if_5d_" + tag, photo_thumb: "data:image/png;base64,SYNTH_t" });
      cat.addPiece({ category: "bag", attributes: { color: "brown" }, source_share_id: "SYNTH_if_5b_" + tag, photo_thumb: "data:image/png;base64,SYNTH_t" });
      await DeleteItem.handle({ catalog: cat, text: "clear my wardrobe" });
      return cat;
    }
    const cat = await clearSetup("a");
    const stubYes = stubClient("yes");
    const loop = AgenticLoop.createAgenticLoop({ catalog: cat, router: Router, summariser: null, metaClient: stubYes });
    const r = await loop.handleTurn({ message: "yeah go on, bin the lot" });
    assert.strictEqual(cat.getActivePieces().length, 0, "stub yes clears the wardrobe");
    assert.ok(/spark-affirmative/.test(r.decision.reason), "decision reason logged, got: " + r.decision.reason);

    const cat2 = await clearSetup("b");
    const stubUnclear = stubClient("unclear");
    const loop2 = AgenticLoop.createAgenticLoop({ catalog: cat2, router: Router, summariser: null, metaClient: stubUnclear });
    await loop2.handleTurn({ message: "yeah go on, bin the lot" });
    assert.strictEqual(cat2.getActivePieces().length, 2, "stub unclear clears nothing");

    const cat3 = await clearSetup("c");
    const spy = stubClient("yes");
    const loop3 = AgenticLoop.createAgenticLoop({ catalog: cat3, router: Router, summariser: null, metaClient: spy });
    await loop3.handleTurn({ message: "yes" });
    assert.strictEqual(spy.calls.length, 0, "fixed-list yes never calls Spark");
    assert.strictEqual(cat3.getActivePieces().length, 0, "fixed yes still clears");
    console.log("  pass: spark yes clears; unclear keeps; fixed yes skips Spark");
  }

  // --- (6) no client / throwing client: exactly as before ---
  console.log("\n[(6) unavailable Spark behaves exactly as before]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_if_6" });
    seedDresses(cat, "6");
    const r = await DeleteItem.handle({ catalog: cat, text: "the carryall thing" });
    assert.ok(/which bit of your wardrobe to tidy/i.test(r.text), "honest Step A reply, got: " + r.text);
    assert.strictEqual(r.trace, undefined, "no trace without a client");
    assert.strictEqual(cat.getActivePieces().length, 3, "nothing removed");

    const cat2 = Wardrobe.createCatalog({ userKey: "SYNTH_if_6b" });
    seedDresses(cat2, "6b");
    const r2 = await DeleteItem.handle({ catalog: cat2, text: "the carryall thing", metaClient: throwingClient() });
    assert.ok(/which bit of your wardrobe to tidy/i.test(r2.text), "throwing client keeps honest reply");
    // The call was attempted (then threw): recorded as a none match.
    assert.deepStrictEqual(r2.trace, ["interpret:spark:none"], "attempted-but-failed call audits as none");
    assert.strictEqual(cat2.getActivePieces().length, 3, "nothing removed");

    const cat3 = Wardrobe.createCatalog({ userKey: "SYNTH_if_6c" });
    seedDresses(cat3, "6c");
    await DeleteItem.handle({ catalog: cat3, text: "delete the dresses" });
    const r3 = await DeleteItem.handle({ catalog: cat3, text: "the pink one", metaClient: throwingClient() });
    assert.ok(/didn.t catch a number/i.test(r3.text), "honest Step B reply, got: " + r3.text);
    assert.deepStrictEqual(r3.trace, ["interpret:spark:none"], "attempted-but-failed Step B call audits as none");

    const cat4 = seedLook(Wardrobe.createCatalog({ userKey: "SYNTH_if_6d" }), "6d");
    const r4 = await ReviseLook.handle({ catalog: cat4, text: "hmm not sure", metaClient: throwingClient() });
    assert.ok(/which piece would you like to swap/i.test(r4.text), "honest CLARIFY reply");
    assert.deepStrictEqual(r4.trace, ["interpret:spark:none"], "attempted-but-failed CLARIFY call audits as none");

    const cat5 = Wardrobe.createCatalog({ userKey: "SYNTH_if_6e" });
    cat5.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_if_6e_d", photo_thumb: "data:image/png;base64,SYNTH_t" });
    await DeleteItem.handle({ catalog: cat5, text: "clear my wardrobe" });
    const loop = AgenticLoop.createAgenticLoop({ catalog: cat5, router: Router, summariser: null });
    await loop.handleTurn({ message: "yeah go on, bin the lot" });
    assert.strictEqual(cat5.getActivePieces().length, 1, "no client: nothing cleared");
    console.log("  pass: every path degrades to the honest pre-existing reply");
  }

  // --- (7) router offline heuristic ---
  console.log("\n[(7) router offline heuristic]");
  {
    assert.strictEqual(Router.classifySync({ text: "delete my dress" }).skill,
      "delete_wardrobe_item", "singular delete routes");
    assert.strictEqual(Router.classifySync({ text: "show me my jacket" }).skill,
      "view_wardrobe_item", "synonym view routes");
    assert.strictEqual(Router.classifySync({ text: "bin my heels" }).skill,
      "delete_wardrobe_item", "bin + synonym routes");
    assert.strictEqual(Router.classifySync({ text: "delete my photos" }).skill,
      "propose_look", "saved-photo deletion kept");
    assert.notStrictEqual(Router.classifySync({ text: "DELETE" }).skill,
      "delete_wardrobe_item", "bare DELETE never reaches delete");
    assert.notStrictEqual(Router.classifySync({ text: "forget me" }).skill,
      "delete_wardrobe_item", "forget me never reaches delete");
    console.log("  pass: singulars route; photos/bare/forget-me unchanged");
  }

  console.log("\nAll interpret-fallback tests passed.");
}

run().catch((err) => { console.error(err); process.exit(1); });
