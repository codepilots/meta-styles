"use strict";
/* meta-styles — two-photo wardrobe arc tests (Opus finding #2).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * The live M21 agentic flow used to answer every photo with a
 * classifier-only acknowledgement ("Got your dress ... Want me to put a
 * look together?") and never ran the scripted two-photo arc in the same
 * turn. These tests exercise the REAL production entry point
 * (app/agentic-loop.js handleTurn, the same call wardrobe-service
 * runAgenticTurn makes — router -> skill -> same-turn propose_look
 * selection/validation stack), never isolated handlers alone:
 *  (a) photo 1 (base only): no false full-look claim, honest
 *      missing-finish rule (one layer, or a scarf plus a bag), and the
 *      M24 yes/no expectation toward propose_look is still recorded.
 *  (b) photo 2 (makes a look possible): one valid cross-piece look via
 *      the existing propose_look -> strictShape/assembleLook stack —
 *      names both pieces/categories plus a visible fit-rule result, no
 *      raw IDs, and no duplicate/stale pending expectation (only
 *      propose_look's own revise_look closer stands).
 *  (c) Spark invalid candidates + local fallback: one short truthful
 *      rejection line is user-visible (not only console.log), no IDs or
 *      stack traces, fallback stays honest, reasons[]/turn recording
 *      intact.
 * All fixtures synthetic (SYNTH_ prefix); fake meta clients only — never
 * api.meta.ai or a real bot.
 *
 * Run: node app/test/two-photo-wardrobe-arc.test.js
 */
const assert = require("node:assert");
const AgenticLoop = require("../agentic-loop.js");
const Router = require("../router.js");
const Wardrobe = require("../wardrobe-catalog.js");

const DRESS_URL = "data:image/png;base64,SYNTH_arc_dress_bytes";
const CARDI_URL = "data:image/png;base64,SYNTH_arc_cardi_bytes";

function freshLoop(catalog, metaClient) {
  return AgenticLoop.createAgenticLoop({
    catalog: catalog, router: Router, summariser: null,
    metaClient: metaClient || null, maxSteps: 20,
  });
}

function noSynthLeak(text, label) {
  assert.ok(!/SYNTH_/.test(text), label + " must not leak SYNTH_ ids: " + String(text).slice(0, 220));
}

function noStackLeak(text, label) {
  assert.ok(!/\.js:\d+|\n\s*at\s|Traceback|SparkError|wardrobe-catalog:/.test(text),
    label + " must not leak internals: " + String(text).slice(0, 220));
}

async function run() {
  console.log("two-photo-wardrobe-arc.test.js");

  // --- (a) photo 1, base only: honest gap, never a full-look claim ---
  console.log("\n[(a) photo 1 base-only -> honest missing-finish gap]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_arc_a" });
    const t1 = await freshLoop(cat).handleTurn({
      message: "", hasImage: true, imageDataUrl: DRESS_URL,
      shareId: "SYNTH_share_arc_a1",
    });
    assert.strictEqual(t1.skill, "catalogue_piece", "photo 1 routes to catalogue_piece, got " + t1.skill);
    assert.ok(/tucked safely in your wardrobe/.test(t1.text), "catalogue ack kept: " + t1.text.slice(0, 160));
    assert.ok(/isn't a full look yet/.test(t1.text), "base alone is not framed as a look: " + t1.text.slice(0, 220));
    assert.ok(/one layer, or a scarf plus a bag/.test(t1.text), "exact missing-finish rule: " + t1.text.slice(0, 260));
    assert.ok(!/Fit check: valid/.test(t1.text), "no false valid fit claim on photo 1");
    noSynthLeak(t1.text, "photo-1 reply");
    // M24 preserved: the gap closer still offers the yes/no look question.
    const pend = cat.getPendingQuestions();
    assert.strictEqual(pend.length, 1, "exactly one pending expectation, got " + pend.length);
    assert.strictEqual(pend[0].skill, "propose_look", "pending skill");
    assert.strictEqual(pend[0].expects, "yes_no", "pending expects yes_no");
    console.log("  pass: honest gap + exact finish rule + propose_look yes_no pending");
  }

  // --- (b) photo 2 completes the arc: cross-piece look + fit result ---
  console.log("\n[(b) photo 2 -> same-turn cross-piece look with fit verdict]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_arc_b" });
    const loop = freshLoop(cat);
    const t1 = await loop.handleTurn({
      message: "", hasImage: true, imageDataUrl: DRESS_URL,
      shareId: "SYNTH_share_arc_b1",
    });
    assert.ok(/isn't a full look yet/.test(t1.text), "photo 1 is the honest gap");
    // Photo 2: the "cardigan" hint classifies the layer; the wardrobe now
    // holds dress (photo 1) + cardigan (photo 2).
    const t2 = await loop.handleTurn({
      message: "my cardigan", hasImage: true, imageDataUrl: CARDI_URL,
      shareId: "SYNTH_share_arc_b2",
    });
    assert.strictEqual(t2.skill, "catalogue_piece", "photo 2 routes to catalogue_piece, got " + t2.skill);
    assert.ok(/tucked safely in your wardrobe/.test(t2.text), "catalogue ack kept on photo 2");
    assert.ok(/dress \+ cardigan together/.test(t2.text),
      "cross-piece combination names both pieces: " + t2.text.slice(0, 280));
    assert.ok(/Fit check: valid/.test(t2.text), "fit-rule result is user-visible");
    assert.ok(!/isn't a full look yet/.test(t2.text), "photo 2 is framed as a look, not a gap");
    noSynthLeak(t2.text, "photo-2 reply");
    noStackLeak(t2.text, "photo-2 reply");
    // No duplicate/stale expectation: propose_look's own revise_look
    // closer is the ONLY pending question — catalogue_piece must not
    // have stacked a second propose_look one on top.
    const pend = cat.getPendingQuestions();
    assert.strictEqual(pend.length, 1, "exactly one pending expectation, got " + JSON.stringify(pend));
    assert.strictEqual(pend[0].skill, "revise_look", "fresh pending points at revise_look");
    assert.strictEqual(pend[0].expects, "yes_no", "fresh pending expects yes_no");
    // The validated look was recorded for explain_fit / the router.
    const turns = cat.getTurns();
    assert.ok(turns.some(function (t) { return t.verdict === true && t.proposal && Array.isArray(t.proposal.pieces) && t.proposal.pieces.length === 2; }),
      "a valid two-piece look turn was recorded: " + JSON.stringify(turns).slice(0, 200));
    console.log("  pass: dress + cardigan look, fit verdict, single revise_look pending");
  }

  // --- (c) Spark invalid candidates -> fallback + visible reason line ---
  console.log("\n[(c) Spark invalid -> fallback with user-facing rejection line]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_arc_c" });
    const badSpark = {
      assemble: async function () {
        return { looks: [{ pieceIds: ["SYNTH_piece_NOT_REAL"], rationale: "SYNTH bogus rationale" }] };
      },
    };
    const loop = freshLoop(cat, badSpark);
    const t1 = await loop.handleTurn({
      message: "", hasImage: true, imageDataUrl: DRESS_URL,
      shareId: "SYNTH_share_arc_c1",
    });
    assert.ok(/isn't a full look yet/.test(t1.text), "photo 1 still the honest gap");
    const t2 = await loop.handleTurn({
      message: "my cardigan", hasImage: true, imageDataUrl: CARDI_URL,
      shareId: "SYNTH_share_arc_c2",
    });
    assert.ok(/dress \+ cardigan together/.test(t2.text), "fallback still wove the valid look");
    assert.ok(/Fit check: valid/.test(t2.text), "fallback look carries the fit verdict");
    assert.ok(/didn\u2019t pass the fit check/.test(t2.text),
      "one short rejection line is user-visible: " + t2.text.slice(0, 400));
    assert.ok(!/SYNTH_piece_NOT_REAL/.test(t2.text), "rejected IDs never reach the reply");
    noSynthLeak(t2.text, "fallback reply");
    noStackLeak(t2.text, "fallback reply");
    assert.ok(t2.handlerResult && t2.handlerResult.meta &&
      /spark_rejected:unknown_piece/.test(t2.handlerResult.meta.rejectedReason || ""),
      "machine rejectedReason intact, got " +
      JSON.stringify(t2.handlerResult && t2.handlerResult.meta));
    const turns = cat.getTurns();
    assert.ok(turns.some(function (t) {
      return t.verdict === true && Array.isArray(t.reasons) &&
        t.reasons.some(function (r) { return /spark_rejected:unknown_piece/.test(r); });
    }), "rejection travels on the recorded turn: " + JSON.stringify(turns).slice(0, 220));
    console.log("  pass: visible rejection line, honest fallback, reasons[] intact");
  }

  console.log("\nAll two-photo wardrobe arc tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
