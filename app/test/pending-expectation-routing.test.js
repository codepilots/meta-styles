"use strict";
/* meta-styles Milestone 24 — pending-expectation routing tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Covers the confirmed live bug: What_suits asks its consent question
 * ("would you like to share a headshot and a full-body photo?"), the user
 * replies with a bare photo (no text), and stateless routing must NOT send
 * that photo to catalogue_piece — it is the answer to the question just
 * asked.
 *
 *   (a) exact scenario: What_suits consent prompt records a pending
 *       expectation; the next bare-photo turn routes to What_suits (not
 *       catalogue_piece) and the pending question is resolved afterward.
 *       Also proves the pre-fix shape: the bare photo alone classifies
 *       as catalogue_piece, so only the pending state diverts it.
 *   (b) non-matching reply: pending expectation exists, next turn is
 *       "no thanks" (no image) — routes normally (NOT back into
 *       What_suits) and the stale pending state is cleared either way.
 *   (c) expiry: a pending expectation older than the TTL does not hijack
 *       a later bare-photo turn — normal classification applies and the
 *       expired entry is cleared.
 *   (d) catalog unit: bare-string askQuestion stays backward compatible;
 *       object form records skill/expects/expires_at (~24h default);
 *       unknown keys, bad expects, and bad expires_at all throw
 *       (fail-closed).
 *   (e) What_suits consent text is unchanged and records the expectation
 *       through the handler's catalog opt (no catalog -> no crash).
 *
 * Real in-memory catalog + real heuristic router throughout (metaClient is
 * always null, so the live-Spark path is never attempted) — no network,
 * no sends. All ids synthetic (SYNTH_ prefix) — never real data.
 *
 * Run: node app/test/pending-expectation-routing.test.js
 */
const assert = require("node:assert");
const AgenticLoop = require("../agentic-loop.js");
const Router = require("../router.js");
const Wardrobe = require("../wardrobe-catalog.js");
const WhatSuits = require("../skills/What_suits/handler.js");

// EXACT consent text (must stay word-for-word; see what-suits-vision.test.js).
const CONSENT_TEXT = "Oh, I\u2019d love to help with that, darling \u2728 If you\u2019d like personalised colour advice, you can share a head shot and a full-body photo \u2014 I\u2019ll keep them encrypted and you can say \u201Cdelete my photos\u201D anytime. Would you like to share them? (Only with your consent, loveling)";

function pastIso() { return new Date(Date.now() - 60 * 60 * 1000).toISOString(); }

function freshLoop(catalog) {
  return AgenticLoop.createAgenticLoop({ catalog: catalog, router: Router, summariser: null });
}

function noSynthLeak(text, label) {
  assert.ok(!/SYNTH_/.test(text), label + " must not leak SYNTH_ ids: " + String(text).slice(0, 200));
}

async function run() {
  console.log("Milestone 24 — pending-expectation-routing.test.js");
  if (Router.clearLog) Router.clearLog();

  // --- (a) exact Autumn scenario: consent -> bare photo reply ---
  console.log("\n[(a) consent question then bare photo reply]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_m24_a" });
    const loop = freshLoop(cat);

    // Turn 1: explicit What_suits trigger, no photo -> consent prompt.
    const t1 = await loop.handleTurn({ message: "what suits me?", hasImage: false });
    assert.strictEqual(t1.skill, "What_suits", "turn 1 routes to What_suits, got " + t1.skill);
    assert.strictEqual(t1.text, CONSENT_TEXT, "consent text unchanged");
    const pendings = cat.getPendingQuestions();
    assert.strictEqual(pendings.length, 1, "consent records exactly one pending question");
    assert.strictEqual(pendings[0].skill, "What_suits", "pending skill recorded");
    assert.strictEqual(pendings[0].expects, "image", "pending expects image");
    noSynthLeak(t1.text, "consent reply");

    // The bug shape, proved in isolation: this bare photo alone would go
    // to catalogue_piece without the pending state to divert it.
    const stateless = Router.classifySync({ text: "", imagePresent: true });
    assert.strictEqual(stateless.skill, "catalogue_piece",
      "bare photo alone still classifies catalogue_piece, got " + stateless.skill);

    // Turn 2: bare photo, no text -> straight back to What_suits.
    const t2 = await loop.handleTurn({ message: "", hasImage: true });
    assert.strictEqual(t2.skill, "What_suits", "photo reply routes to What_suits, got " + t2.skill);
    assert.ok(/pending expectation satisfied/.test(t2.decision.reason),
      "decision names the pending path: " + t2.decision.reason);
    assert.strictEqual(cat.getPendingQuestions().length, 0, "pending question resolved afterward");
    assert.strictEqual(t2.decision.confidence, 96, "deterministic pending confidence");
    noSynthLeak(t2.text, "photo-answer reply");
    console.log("  pass: bare photo answered What_suits, pending resolved");
  }

  // --- (b) declining reply falls through, pending cleared ---
  console.log("\n[(b) non-matching reply falls through to router]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_m24_b" });
    cat.askQuestion({ text: CONSENT_TEXT, skill: "What_suits", expects: "image" });
    const loop = freshLoop(cat);
    const t = await loop.handleTurn({ message: "no thanks", hasImage: false });
    assert.notStrictEqual(t.skill, "What_suits", "decline must NOT route back into What_suits, got " + t.skill);
    assert.strictEqual(cat.getPendingQuestions().length, 0, "stale pending cleared either way");
    noSynthLeak(t.text, "decline reply");
    console.log("  pass: decline routed normally (" + t.skill + "), pending cleared");
  }

  // --- (c) expired expectation does not hijack a later photo ---
  console.log("\n[(c) expired pending expectation falls through]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_m24_c" });
    cat.askQuestion({ text: CONSENT_TEXT, skill: "What_suits", expects: "image", expires_at: pastIso() });
    const loop = freshLoop(cat);
    const t = await loop.handleTurn({ message: "", hasImage: true });
    assert.strictEqual(t.skill, "catalogue_piece",
      "expired pending must not divert the photo, got " + t.skill);
    assert.strictEqual(cat.getPendingQuestions().length, 0, "expired entry cleared");
    console.log("  pass: expired expectation ignored, photo went to catalogue_piece");
  }

  // --- (d) catalog askQuestion contract ---
  console.log("\n[(d) askQuestion fail-closed contract]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_m24_d" });

    // Bare string: backward compatible (turn-loop.js still calls it so).
    const plain = cat.askQuestion("What should I style around first?");
    assert.strictEqual(plain.skill, null, "bare string has no skill");
    assert.strictEqual(plain.expects, null, "bare string has no expects");
    assert.strictEqual(plain.expires_at, null, "plain question never expires");
    assert.ok(/^SYNTH_q_\d+$/.test(plain.id), "id shape kept");

    // Object form: expectation fields recorded, ~24h default expiry.
    const exp = cat.askQuestion({ text: CONSENT_TEXT, skill: "What_suits", expects: "image" });
    assert.strictEqual(exp.skill, "What_suits", "skill stored");
    assert.strictEqual(exp.expects, "image", "expects stored");
    const deltaMs = Date.parse(exp.expires_at) - Date.now();
    assert.ok(deltaMs > 23 * 3600 * 1000 && deltaMs <= 24 * 3600 * 1000 + 60 * 1000,
      "expires_at roughly 24h out, got +" + Math.round(deltaMs / 3600000) + "h");

    // Fail-closed: unknown keys, unknown expects, bad timestamp all throw.
    assert.throws(function () {
      cat.askQuestion({ text: "x", skill: "What_suits", expects: "image", bogus: 1 });
    }, /rejected key/, "unknown key rejected");
    assert.throws(function () {
      cat.askQuestion({ text: "x", skill: "What_suits", expects: "video" });
    }, /expects/, "unknown expects rejected");
    assert.throws(function () {
      cat.askQuestion({ text: "x", skill: "What_suits", expects: "image", expires_at: "soon" });
    }, /expires_at/, "non-ISO expires_at rejected");
    assert.throws(function () {
      cat.askQuestion({ text: "x", skill: "", expects: "image" });
    }, /skill/, "empty skill rejected");

    // getPendingQuestions only returns unresolved entries.
    cat.resolveQuestion(plain.id);
    const pend = cat.getPendingQuestions();
    assert.ok(pend.every(function (q) { return !q.resolved; }), "only unresolved listed");
    assert.strictEqual(pend.length, 1, "resolved entry filtered out");
    console.log("  pass: backward compat + fail-closed rejects + resolve filtering");
  }

  // --- (e) handler records expectation, safe without catalog ---
  console.log("\n[(e) consent records expectation via handler]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_m24_e" });
    const r = await WhatSuits.handle({ catalog: cat, imagePresent: false });
    assert.strictEqual(r.text, CONSENT_TEXT, "consent text unchanged");
    const pend = cat.getPendingQuestions();
    assert.strictEqual(pend.length, 1, "handler recorded the expectation");
    assert.strictEqual(pend[0].skill, "What_suits", "skill tagged");
    assert.strictEqual(pend[0].expects, "image", "expects image");

    // No catalog attached (existing vision-test call shape) -> same reply, no crash.
    const r2 = await WhatSuits.handle({ imagePresent: false });
    assert.strictEqual(r2.text, CONSENT_TEXT, "catalog-free consent unchanged");
    console.log("  pass: expectation recorded through handler, catalog-free safe");
  }

  console.log("\nAll pending-expectation-routing tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
