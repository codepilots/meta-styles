"use strict";
/* meta-styles Opus finding #13 — heuristic router gaps on the keyless judge path.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Covers:
 *   (a) photo + "should I get this?" / "is this worth it?" routes to
 *       Evaluate_prospective_purchase, never catalogue_piece (an item only
 *       being considered must not be catalogued as owned);
 *   (b) a photo alone (no purchase-consideration text) still routes to
 *       catalogue_piece exactly as before;
 *   (c) sub-fix 2 is a NO-OP with regression proof: agentic-loop.js checks
 *       pendingExpectation BEFORE ever calling the router (a satisfied
 *       pending expectation short-circuits to the skill, confidence 96),
 *       so router.js's length/greeting guards are unreachable on that path
 *       and were deliberately NOT changed. Proved end-to-end below: "yes"
 *       after propose_look's "tweak anything?" routes to revise_look via the
 *       pending path, while the same "yes" with no pending state hits the
 *       router guards and clarifies. "ok" is conservatively NOT affirmative
 *       (not in the yes_no list), so it still falls through to the guards.
 *   (d) the live Spark router system prompt lists "find the bag" exactly
 *       once — under describe_wardrobe (locating a wardrobe item), not
 *       under propose_look.
 *
 * All mocks/local fixtures only — never a real Meta Model API call. All
 * ids synthetic (SYNTH_ prefix) — never real data.
 *
 * Run: node app/test/opus-finding-13-router-gaps.test.js
 */

// Localhost must bypass any env HTTP proxy (sandbox sets one for external traffic).
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";

const assert = require("node:assert");
const path = require("node:path");
const Router = require("../router.js");
const AgenticLoop = require("../agentic-loop.js");
const Wardrobe = require("../wardrobe-catalog.js");
const proxy = require(path.resolve(__dirname, "../../meta-api-proxy/server.js"));

function freshLoop(catalog) {
  return AgenticLoop.createAgenticLoop({ catalog: catalog, router: Router, summariser: null });
}

async function run() {
  console.log("Opus finding #13 — router gaps on the keyless judge path");
  if (Router.clearLog) Router.clearLog();

  // --- (a) photo + purchase-consideration text -> Evaluate, not catalogue ---
  console.log("\n[(a) photo + should-i-get-this phrasing]");
  {
    const photoCases = [
      "should I get this?",
      "is this worth it?",
      "found this dress, should I get it?",
      "thinking of buying this, what do you think?",
    ];
    for (const text of photoCases) {
      const r = Router.classifySync({ text: text, imagePresent: true });
      assert.strictEqual(r.skill, "Evaluate_prospective_purchase",
        JSON.stringify(text) + " + photo must route Evaluate, got " + r.skill);
      assert.ok(r.confidence >= 70, "must clear the clarification threshold, got " + r.confidence);
      console.log("  pass: photo + " + JSON.stringify(text) + " -> Evaluate_prospective_purchase");
    }
    // Text-only behaviour unchanged: generic trigger still fires without a photo.
    const t = Router.classifySync({ text: "should i get this?", imagePresent: false });
    assert.strictEqual(t.skill, "Evaluate_prospective_purchase", "text-only trigger unchanged");
    // Purchase-confirmation priority preserved: "I bought it" still wins
    // via its own trigger, checked first.
    const c = Router.classifySync({ text: "i bought it", imagePresent: true });
    assert.strictEqual(c.skill, "Evaluate_prospective_purchase", "photo + I-bought-it -> Evaluate");
    assert.strictEqual(c.reason, "purchase confirmation trigger", "confirmation trigger wins, got: " + c.reason);
    console.log("  pass: text-only trigger + purchase-confirmation priority preserved");
  }

  // --- (b) photo alone still catalogues ---
  console.log("\n[(b) photo alone still -> catalogue_piece]");
  {
    const bare = Router.classifySync({ text: "", imagePresent: true });
    assert.strictEqual(bare.skill, "catalogue_piece", "bare photo catalogues, got " + bare.skill);
    const plain = Router.classifySync({ text: "look at this new piece", imagePresent: true });
    assert.strictEqual(plain.skill, "catalogue_piece", "photo without purchase text catalogues, got " + plain.skill);
    console.log("  pass: bare photo + plain photo text -> catalogue_piece");
  }

  // --- (c) sub-fix 2 no-op proof: pending short-circuit lives in agentic-loop ---
  console.log("\n[(c) short reply + open pending expectation handled by agentic-loop, not router guards]");
  {
    // End-to-end: propose_look asked "want me to tweak anything?"
    // (expects yes_no toward revise_look); "yes" satisfies it and the
    // router is never consulted for that turn.
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_m13_c" });
    cat.askQuestion({ text: "Want me to tweak anything?", skill: "revise_look", expects: "yes_no" });
    const t = await freshLoop(cat).handleTurn({ message: "yes", hasImage: false });
    assert.strictEqual(t.skill, "revise_look", "'yes' routes to revise_look, got " + t.skill);
    assert.ok(/pending expectation satisfied/.test(t.decision.reason),
      "decision names the pending path: " + t.decision.reason);
    assert.strictEqual(t.decision.confidence, 96, "deterministic pending confidence");
    console.log("  pass: 'yes' after tweak question -> revise_look via pending path");

    // Stateless contrast: the SAME "yes" with no pending state hits the
    // router guards and clarifies — proving the guards are only reachable
    // when no expectation is satisfied (hence no router.js change needed).
    const stateless = Router.classifySync({ text: "yes" });
    assert.ok(stateless.confidence < 70 && stateless.clarification,
      "'yes' alone must clarify via router guards, got " + JSON.stringify(stateless));
    console.log("  pass: stateless 'yes' -> clarification (router guards intact)");

    // "ok" is conservatively NOT in the affirmative list: with an open
    // yes_no expectation it falls through to the guards (clarification)
    // and the stale pending is cleared — never a false purchase confirm.
    const catOk = Wardrobe.createCatalog({ userKey: "SYNTH_m13_c_ok" });
    catOk.askQuestion({ text: "Want me to tweak anything?", skill: "revise_look", expects: "yes_no" });
    const tOk = await freshLoop(catOk).handleTurn({ message: "ok", hasImage: false });
    assert.notStrictEqual(tOk.skill, "revise_look", "'ok' must NOT satisfy yes_no, got " + tOk.skill);
    assert.strictEqual(catOk.getPendingQuestions().length, 0, "stale pending cleared");
    console.log("  pass: 'ok' after yes_no question falls through, pending cleared");
  }

  // --- (d) live router prompt: "find the bag" exactly once ---
  console.log("\n[(d) Spark router prompt de-duplicated]");
  {
    let capturedInput = null;
    function fakeRoute(url, opts) {
      const body = JSON.parse(opts.body);
      capturedInput = JSON.stringify(body.input);
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({
          output: [{ content: [{ type: "output_text", text: '{"skill":"describe_wardrobe","confidence":90,"reason":"test"}' }] }],
        })),
      });
    }
    const { server } = await proxy.startServer({ port: 0, apiKey: "test-key", fetchImpl: fakeRoute });
    try {
      const base = "http://127.0.0.1:" + server.address().port;
      const res = await fetch(base + "/api/route", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "SYNTH neutral wardrobe probe", imagePresent: false }),
      });
      assert.strictEqual(res.status, 200, "/api/route 200, got " + res.status);
      assert.ok(capturedInput, "upstream prompt captured");
      const hits = capturedInput.match(/find the bag/g) || [];
      assert.strictEqual(hits.length, 1, "'find the bag' must appear exactly once, got " + hits.length);
      const proposeLine = capturedInput.split("\\n").filter(function (l) { return l.indexOf("propose_look:") !== -1; }).join(" ");
      const describeLine = capturedInput.split("\\n").filter(function (l) { return l.indexOf("describe_wardrobe:") !== -1; }).join(" ");
      assert.ok(proposeLine && !proposeLine.includes("find the bag"), "propose_look example no longer lists it");
      assert.ok(describeLine && describeLine.includes("find the bag"), "describe_wardrobe keeps it");
      console.log("  pass: 'find the bag' appears exactly once (describe_wardrobe)");
    } finally {
      server.close();
    }
  }

  console.log("\nAll Opus finding #13 tests passed.");
}

run().catch((e) => { console.error(e.stack || e); process.exit(1); });
