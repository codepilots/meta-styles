"use strict";
/* meta-styles — photo routing guard tests (2026-11-03 live bug).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Live bug: wardrobe had 2 pieces; propose_look asked for "one more
 * piece"; the user's follow-up PHOTO was sent by live Spark /api/route
 * to propose_look (confidence 90, "bare photo fulfills assistant's
 * pending request"), which cannot catalogue a photo — it ignored the
 * bytes and repeated its no-valid-look reply, and the service then
 * deleted the unprocessed media.
 *
 * Guard (app/router.js): when imagePresent is true, the chosen skill
 * must be one that consumes a shared photo as a turn input
 * (catalogue_piece, What_suits, Match_look,
 * Evaluate_prospective_purchase — each verified to read imageDataUrl
 * in its handler). Anything else is overridden to catalogue_piece.
 * Pending expectations decided BEFORE the router (agentic-loop.js:
 * expects image / profile_image) bypass the router and keep working
 * unchanged — the guard never applies to them.
 *
 *   (a) imagePresent + live stub returning propose_look -> catalogue_piece
 *       with reason "photo routed to catalogue_piece (was propose_look)".
 *   (b) imagePresent + live stub returning Match_look -> unchanged.
 *   (c) text-only live propose_look -> unchanged (guard is photo-only).
 *   (d) heuristic: "delete my photos" + photo -> catalogue_piece (the
 *       delete-photos rule would otherwise claim the photo for a skill
 *       that never touches the bytes); "hi" + photo -> confident
 *       catalogue_piece, never a clarification detour that leaves the
 *       bytes unused.
 *   (e) agentic loop: pending profile_image expectation + photo still
 *       reaches propose_look's profile intake (guard not applied) — the
 *       headshot is filed and the result reports imageConsumed.
 *
 * All fixtures synthetic (SYNTH_ ids, locally generated 1px PNGs) — no
 * network, no real photos.
 *
 * Run: node app/test/photo-routing-guard.test.js
 */
const assert = require("node:assert/strict");
const Router = require("../router.js");
const AgenticLoop = require("../agentic-loop.js");
const Wardrobe = require("../wardrobe-catalog.js");

// Locally generated 1x1 PNG (same family as profile-render-on-user.test.js).
const HS = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function run() {
  console.log("photo-routing-guard.test.js");

  // --- (a) live Spark propose_look + photo -> catalogue_piece ---
  console.log("\n[(a) live propose_look + photo is overridden]");
  {
    const livePropose = {
      route: async function () {
        return {
          skill: "propose_look",
          confidence: 90,
          reason: "bare photo fulfills assistant's pending request for extra piece",
        };
      },
    };
    const r = await Router.classify(
      { text: "", imagePresent: true, wardrobeSummary: "", preferences: "", lastTurns: ["want a look?", "yes", "nothing in there pairs into a full look yet"] },
      livePropose
    );
    assert.strictEqual(r.skill, "catalogue_piece", "photo + live propose_look must become catalogue_piece, got " + r.skill);
    assert.strictEqual(r.reason, "photo routed to catalogue_piece (was propose_look)", "override reason names the from-skill, got " + r.reason);
    assert.ok(r.confidence >= 70, "override stays confident (no clarification detour), got " + r.confidence);
    assert.ok(!r.clarification, "override carries no clarification");
    console.log("  pass: live propose_look + photo -> catalogue_piece (" + r.reason + ")");
  }

  // --- (b) live Match_look + photo unchanged ---
  console.log("\n[(b) live Match_look + photo is untouched]");
  {
    const liveMatch = {
      route: async function () {
        return { skill: "Match_look", confidence: 92, reason: "image + inspiration phrasing" };
      },
    };
    const r = await Router.classify(
      { text: "do this look", imagePresent: true, wardrobeSummary: "", preferences: "", lastTurns: [] },
      liveMatch
    );
    assert.strictEqual(r.skill, "Match_look", "image-consuming skill must pass through, got " + r.skill);
    assert.strictEqual(r.reason, "image + inspiration phrasing", "reason untouched");
    console.log("  pass: live Match_look + photo unchanged");
  }

  // --- (c) text-only live propose_look unchanged ---
  console.log("\n[(c) text-only live propose_look is untouched]");
  {
    const livePropose = {
      route: async function () {
        return { skill: "propose_look", confidence: 91, reason: "propose-look trigger" };
      },
    };
    const r = await Router.classify(
      { text: "show me a look", imagePresent: false, wardrobeSummary: "", preferences: "", lastTurns: [] },
      livePropose
    );
    assert.strictEqual(r.skill, "propose_look", "text-only routing must not be guarded, got " + r.skill);
    console.log("  pass: text-only propose_look unchanged");
  }

  // --- (d) heuristic photo cases hit the same guard ---
  console.log("\n[(d) heuristic photo routing is guarded too]");
  {
    const del = Router.classifySync({ text: "delete my photos", imagePresent: true });
    assert.strictEqual(del.skill, "catalogue_piece",
      "'delete my photos' + photo must not reach propose_look, got " + del.skill);
    assert.strictEqual(del.reason, "photo routed to catalogue_piece (was propose_look)");
    console.log("  pass: 'delete my photos' + photo -> catalogue_piece");

    const hi = Router.classifySync({ text: "hi", imagePresent: true });
    assert.strictEqual(hi.skill, "catalogue_piece",
      "greeting + photo must catalogue, not clarify, got " + hi.skill);
    assert.ok(!hi.clarification, "no clarification detour for a photo turn");
    console.log("  pass: 'hi' + photo -> catalogue_piece, no clarification");

    const bare = Router.classifySync({ text: "", imagePresent: true });
    assert.strictEqual(bare.skill, "catalogue_piece", "bare photo stays catalogue_piece");
    console.log("  pass: bare photo stays catalogue_piece");

    const textOnly = Router.classifySync({ text: "show me a look please" });
    assert.strictEqual(textOnly.skill, "propose_look", "text-only propose_look unchanged");
    console.log("  pass: text-only propose_look unchanged (heuristic)");
  }

  // --- (e) pending profile_image + photo bypasses the guard ---
  console.log("\n[(e) pending profile_image expectation keeps working]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_guard_e" });
    cat.setProfileConsent(true);
    cat.askQuestion({ text: "SYNTH share your headshot", skill: "propose_look", expects: "profile_image" });
    // A live router consulted here would say catalogue_piece for a bare
    // photo — prove the pending path never consults it.
    let routeCalls = 0;
    const nosyLive = {
      route: async function () { routeCalls += 1; return { skill: "catalogue_piece", confidence: 94, reason: "photo" }; },
    };
    const loop = AgenticLoop.createAgenticLoop({ catalog: cat, router: Router, summariser: null, metaClient: nosyLive });
    const t = await loop.handleTurn({ message: "", hasImage: true, imageDataUrl: HS });
    assert.strictEqual(t.skill, "propose_look", "pending photo must reach propose_look, got " + t.skill);
    assert.ok(/pending expectation satisfied/.test(t.decision.reason),
      "decision names the pending path: " + t.decision.reason);
    assert.strictEqual(routeCalls, 0, "router (live or heuristic) never consulted on a satisfied pending turn");
    const hr = t.handlerResult;
    assert.ok(hr && hr.meta && hr.meta.profileAction === "stored",
      "photo filed as headshot reference, got " + JSON.stringify(hr && hr.meta));
    assert.strictEqual(hr.meta.imageConsumed, true, "profile intake reports the image consumed");
    // The headshot landed; exactly one pending remains — the follow-up
    // ask for the still-missing full-body photo, not the answered one.
    const after = cat.getPendingQuestions();
    assert.strictEqual(after.length, 1, "one follow-up pending remains, got " + after.length);
    assert.strictEqual(after[0].expects, "profile_image", "follow-up still expects a profile photo");
    assert.strictEqual(after[0].skill, "propose_look", "follow-up still belongs to propose_look");
    console.log("  pass: profile photo reaches propose_look intake, filed + imageConsumed");
  }

  console.log("\nAll photo-routing-guard tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
