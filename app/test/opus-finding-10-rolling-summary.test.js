"use strict";
/* Opus finding #10 — rolling summary/preferences window + persistence honesty.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Covers, with synthetic fixtures only (SYNTH_ ids, no network, no real
 * user data):
 *  1. truncateTokens keeps the TAIL (latest turns), not the head.
 *  2. A bounded summary window changes when later turns arrive after the
 *     old limit (not frozen at the first turns) — for summary AND prefs.
 *  3. persistViaStore is explicitly honest: { ok:false, error:"not_persisted" }
 *     with a working store, { ok:false, error:"no_store" } without one —
 *     and it NEVER calls store.save (a metadata PUT would be rejected by
 *     the pieces-array-only contract and must never clobber pieces).
 *  4. The agentic loop rolls the window across turns in-memory, stays
 *     bounded, and reports summaryPersisted:false.
 *  5. Piece persistence through the same mock contract is untouched.
 */
const assert = require("assert");
const Summariser = require("../summariser.js");
const AgenticLoop = require("../agentic-loop.js");
const Router = require("../router.js");
const Wardrobe = require("../wardrobe-catalog.js");

const WORDS = ["alpha", "bravo", "cello", "delta", "echo", "foxtrot",
  "golf", "hotel", "india", "juliet", "kilo", "lima"];

async function run() {
  console.log("Opus finding #10 — rolling-summary.test.js");

  // --- 1. truncateTokens keeps the tail ---
  console.log("\n[truncate keeps tail]");
  {
    const head = "HEADMARKER " + "old ".repeat(60);
    const tail = "new ".repeat(60) + "TAILMARKER";
    const out = Summariser.truncateTokens(head + " " + tail, 100);
    assert.ok(out.length <= 400, "bounded ~400 chars, got " + out.length);
    assert.ok(out.includes("TAILMARKER"), "latest content survives truncation");
    assert.ok(!out.includes("HEADMARKER"), "oldest content is pushed out, not frozen");
    console.log("  pass: tail retained, head evicted, len=" + out.length);
  }

  // --- 2a. summary window rolls across many turns ---
  console.log("\n[summary rolls, not frozen]");
  {
    let summary = "";
    const seen = [];
    for (let i = 0; i < 12; i++) {
      const userText = "wardrobe probe turn MARK_" + WORDS[i] + " asking for a look";
      summary = Summariser.buildSummary({
        previousSummary: summary, lastUserText: userText,
        skill: "propose_look", replyText: "reply for MARK_" + WORDS[i], piecesCount: i,
      });
      seen.push(summary);
      assert.ok(summary.length <= 400, "turn " + i + " bounded, got " + summary.length);
    }
    assert.ok(summary.includes("MARK_lima"), "latest turn present in window");
    assert.ok(!summary.includes("MARK_alpha"), "earliest turn evicted from window");
    assert.notStrictEqual(seen[seen.length - 1], seen[2], "window changed after the old limit (not frozen)");
    console.log("  pass: 12-turn summary bounded, latest kept, earliest evicted");
  }

  // --- 2b. preferences window rolls too ---
  console.log("\n[preferences roll, not frozen]");
  {
    let prefs = "";
    for (let i = 0; i < 12; i++) {
      prefs = Summariser.buildPreferences({
        previousPreferences: prefs,
        preferencesDelta: "PREF_" + WORDS[i] + " loves soft lilac layers and warm evening tones.",
      });
      assert.ok(prefs.length <= 400, "prefs turn " + i + " bounded");
    }
    assert.ok(prefs.includes("PREF_lima"), "latest preference present");
    assert.ok(!prefs.includes("PREF_alpha"), "earliest preference evicted");
    console.log("  pass: 12-delta preferences bounded, latest kept, earliest evicted");
  }

  // --- 3. persistence honesty: no fake ok:true, store.save never touched ---
  console.log("\n[persistViaStore honesty]");
  {
    let saveCalls = 0;
    const workingStore = {
      base: "http://127.0.0.1:8904",
      userRef: "u_dddddddddddddddddddddddddddddddd",
      save: (pieces) => { saveCalls += 1; return Promise.resolve({ ok: true }); },
      load: () => Promise.resolve({ ok: true, pieces: [] }),
    };
    const r = await Summariser.persistViaStore(workingStore, "some summary", "some prefs");
    assert.strictEqual(r.ok, false, "must not report success for a no-op");
    assert.strictEqual(r.error, "not_persisted", "explicit not_persisted error");
    assert.strictEqual(saveCalls, 0, "store.save must NOT be called (pieces-array contract cannot hold metadata)");
    const r2 = await Summariser.persistViaStore(null, "s", "p");
    assert.strictEqual(r2.ok, false, "no store -> not ok");
    assert.strictEqual(r2.error, "no_store", "no-store error stays distinct");
    const st = await Summariser.summariseTurn({
      previousSummary: "", previousPreferences: "", lastUserText: "hello",
      skill: "propose_look", replyText: "lovely", piecesCount: 0,
      preferencesDelta: "PREF_x.", store: workingStore,
    });
    assert.ok(st.persistResult && st.persistResult.ok === false, "summariseTurn carries the honest result");
    assert.strictEqual(st.persistResult.error, "not_persisted", "summariseTurn error is not_persisted");
    assert.strictEqual(saveCalls, 0, "summariseTurn also never PUTs metadata");
    console.log("  pass: not_persisted reported, store.save untouched");
  }

  // --- 4. agentic loop rolls the window across turns, honestly flagged ---
  console.log("\n[agentic loop rolls window across turns]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_f10_loop" });
    const loop = AgenticLoop.createAgenticLoop({
      catalog: cat, userRef: cat.userKey, router: Router, summariser: Summariser, maxSteps: 20,
    });
    let summary = "";
    let preferences = "";
    let firstSummary = null;
    for (let i = 0; i < 12; i++) {
      const res = await loop.handleTurn({
        message: "wardrobe probe turn MARK_" + WORDS[i] + " asking for a look",
        hasImage: false, wardrobeSummary: summary, preferences: preferences, lastTurns: [],
      });
      assert.ok(typeof res.summary === "string" && res.summary.length > 0, "turn " + i + " summary present");
      assert.ok(res.summary.length <= 400, "turn " + i + " summary bounded");
      assert.strictEqual(res.summaryPersisted, false, "turn " + i + " honestly reports memory-only");
      if (i === 2) firstSummary = res.summary;
      summary = res.summary;
      preferences = res.preferences || "";
    }
    assert.ok(summary.includes("MARK_lima"), "final window holds the latest turn");
    assert.ok(!summary.includes("MARK_alpha"), "final window evicted the earliest turn");
    assert.notStrictEqual(summary, firstSummary, "window changed across turns (not frozen)");
    console.log("  pass: 12-turn loop rolls window, bounded, summaryPersisted=false");
  }

  // --- 5. piece persistence contract untouched ---
  console.log("\n[piece persistence intact]");
  {
    let saved = null;
    const memStore = {
      save: (pieces) => { saved = JSON.parse(JSON.stringify(pieces)); return Promise.resolve({ ok: true, status: 200, body: {}, error: null, op: "save" }); },
      load: () => Promise.resolve({ ok: true, status: 200, body: {}, error: null, op: "load", pieces: saved === null ? [] : saved }),
    };
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_f10_pieces", store: memStore });
    const l0 = await cat.load();
    assert.ok(l0.ok, "initial load ok (empty store confirms catalog)");
    cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_f10_001" });
    const s = await cat.save();
    assert.ok(s.ok, "piece save ok through the same contract");
    const cat2 = Wardrobe.createCatalog({ userKey: "SYNTH_f10_pieces", store: memStore });
    const l2 = await cat2.load();
    assert.ok(l2.ok && l2.count === 1, "piece survives a fresh catalog context (restart parity)");
    assert.strictEqual(cat2.getActivePieces()[0].category, "dress", "piece content intact");
    console.log("  pass: pieces save/load across fresh contexts via the array contract");
  }

  // --- 6. documented limitation: preferences do not drive propose_look ---
  console.log("\n[preferences limitation documented]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_f10_lim" });
    cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_f10_010" });
    cat.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_share_f10_011" });
    const h = require("../skills/propose_look/handler.js");
    const r = await h.handle({
      catalog: cat, text: "show me a look", imagePresent: false,
      preferences: "Prefers without cardigan.",
    });
    // Honest-behaviour assertion: the reply must not CLAIM preferences
    // drove it or were saved — the handler documents this gap in code.
    assert.ok(!/prefer/i.test(r.text), "no false claim that a preference shaped the look");
    assert.ok(!/saved|persist|remember/i.test(r.text), "no false persistence claim in reply");
    console.log("  pass: propose_look makes no false preference/persistence claim (gap stays documented, see handler comment)");
  }

  console.log("\nAll Opus finding #10 tests passed.");
}

run().catch(e => { console.error(e.stack || e); process.exit(1); });
