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
 *   (f) revise_look's "which piece?" fallback records expects:"text"; a
 *       bare piece-name reply ("the scarf") routes back to revise_look
 *       (stateless it is off_topic); any non-empty text continues the
 *       flow (even a decline — the skill re-asks); an empty turn and
 *       expiry fall through.
 *   (g) catalogue_piece's "want a look?" closer records expects:"yes_no";
 *       "yes" routes to propose_look (stateless it never fires
 *       propose_look); decline and expiry fall through.
 *   (h) describe_wardrobe's "beauties" closer records expects:"yes_no"
 *       (empty-wardrobe prompt records nothing); "sure" routes to
 *       propose_look.
 *   (i) propose_look's "tweak anything?" records expects:"yes_no" toward
 *       revise_look (honest no-valid-look fallback records nothing);
 *       "yes" routes to revise_look; decline and expiry fall through.
 *   (j) Evaluate_prospective_purchase's hold prompt records
 *       expects:"yes_no"; "yes"/"done"/"sure" confirm the purchase
 *       (hold consumed, piece active); decline, expiry, and ambiguous
 *       replies ("maybe", "I'll think about it") do NOT confirm.
 *   (k) askQuestion accepts "text" and "yes_no" with the same ~24h
 *       default expiry as "image".
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
const ReviseLook = require("../skills/revise_look/handler.js");
const CataloguePiece = require("../skills/catalogue_piece/handler.js");
const DescribeWardrobe = require("../skills/describe_wardrobe/handler.js");
const ProposeLook = require("../skills/propose_look/handler.js");
const EvaluatePurchase = require("../skills/Evaluate_prospective_purchase/handler.js");

// EXACT consent text (must stay word-for-word; see what-suits-vision.test.js).
const CONSENT_TEXT = "Oh, I\u2019d love to help with that, darling \u2728 If you\u2019d like personalised colour advice, you can share a head shot and a full-body photo \u2014 I\u2019ll keep them encrypted and you can say \u201Cdelete my photos\u201D anytime. Would you like to share them? (Only with your consent, loveling)";

function pastIso() { return new Date(Date.now() - 60 * 60 * 1000).toISOString(); }

function freshLoop(catalog) {
  return AgenticLoop.createAgenticLoop({ catalog: catalog, router: Router, summariser: null });
}

// dress + scarf + bag: a validated local-assembler look (base + scarf+bag
// finish), so propose_look turns in these tests exercise the real
// validated path rather than the honest no-valid-look fallback.
function seedLook(cat, tag) {
  cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_" + tag + "_1" });
  cat.addPiece({ category: "scarf", attributes: {}, source_share_id: "SYNTH_share_" + tag + "_2" });
  cat.addPiece({ category: "bag", attributes: {}, source_share_id: "SYNTH_share_" + tag + "_3" });
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
    const expiredId = cat.getPendingQuestions()[0].id;
    const loop = freshLoop(cat);
    const t = await loop.handleTurn({ message: "", hasImage: true });
    assert.strictEqual(t.skill, "catalogue_piece",
      "expired pending must not divert the photo, got " + t.skill);
    // The expired entry itself is gone. (The catalogue_piece turn records
    // its own fresh yes_no expectation toward propose_look — fall-through
    // means the skill behaves normally, including its own recording.)
    assert.ok(cat.getPendingQuestions().every(function (q) { return q.id !== expiredId; }),
      "expired entry cleared");
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

  // --- (f) revise_look: bare piece-name answer continues the revision ---
  console.log("\n[(f) revise_look text expectation]");
  {
    // Pre-fix shape: a bare piece name (no verb) matches no trigger.
    const stateless = Router.classifySync({ text: "the scarf" });
    assert.strictEqual(stateless.skill, "off_topic",
      "bare piece name alone still classifies off_topic, got " + stateless.skill);

    // Handler records the expectation on its fallback question.
    const catH = Wardrobe.createCatalog({ userKey: "SYNTH_m24_f_h" });
    const hr = await ReviseLook.handle({ catalog: catH, text: "hmm" });
    assert.ok(/which piece would you like to swap or skip/.test(hr.text), "fallback question unchanged");
    const hpend = catH.getPendingQuestions();
    assert.strictEqual(hpend.length, 1, "fallback records one pending question");
    assert.strictEqual(hpend[0].skill, "revise_look", "pending skill recorded");
    assert.strictEqual(hpend[0].expects, "text", "pending expects text");

    // Catalog-free (existing image-honesty call shape) -> same reply, no crash.
    const hr2 = await ReviseLook.handle({ text: "hmm" });
    assert.ok(/which piece would you like to swap or skip/.test(hr2.text), "catalog-free fallback unchanged");

    // (a) satisfying reply routes back to revise_look. The skill cannot
    // parse a bare noun, so it re-asks its fallback question — which
    // records a FRESH text expectation. Assert by id: the old one is
    // consumed, exactly one new one stands.
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_m24_f" });
    cat.askQuestion({ text: "which piece?", skill: "revise_look", expects: "text" });
    const oldId = cat.getPendingQuestions()[0].id;
    const loop = freshLoop(cat);
    const t = await loop.handleTurn({ message: "the scarf", hasImage: false });
    assert.strictEqual(t.skill, "revise_look", "piece-name reply routes to revise_look, got " + t.skill);
    assert.ok(/pending expectation satisfied/.test(t.decision.reason),
      "decision names the pending path: " + t.decision.reason);
    const afterA = cat.getPendingQuestions();
    assert.ok(afterA.every(function (q) { return q.id !== oldId; }), "old pending consumed");
    assert.strictEqual(afterA.length, 1, "skill re-asked: one fresh pending stands");
    assert.strictEqual(afterA[0].skill, "revise_look", "fresh pending still revise_look");
    assert.strictEqual(afterA[0].expects, "text", "fresh pending still text");
    noSynthLeak(t.text, "revise reply");

    // Text semantics are any-non-empty: even a decline ("no thanks") is
    // a text reply, so the skill re-asks rather than routing away.
    {
      const catW = Wardrobe.createCatalog({ userKey: "SYNTH_m24_f_w" });
      catW.askQuestion({ text: "which piece?", skill: "revise_look", expects: "text" });
      const tW = await freshLoop(catW).handleTurn({ message: "no thanks", hasImage: false });
      assert.strictEqual(tW.skill, "revise_look", "any non-empty text continues revise_look, got " + tW.skill);
    }

    // (b) an unsatisfied turn (empty, no photo) falls through to normal
    // routing and the stale pending is cleared.
    const catB = Wardrobe.createCatalog({ userKey: "SYNTH_m24_f_b" });
    catB.askQuestion({ text: "which piece?", skill: "revise_look", expects: "text" });
    const tB = await freshLoop(catB).handleTurn({ message: "", hasImage: false });
    assert.strictEqual(tB.skill, "off_topic", "empty turn falls through, got " + tB.skill);
    assert.strictEqual(catB.getPendingQuestions().length, 0, "stale pending cleared");

    // (c) expired expectation falls through.
    const catC = Wardrobe.createCatalog({ userKey: "SYNTH_m24_f_c" });
    catC.askQuestion({ text: "which piece?", skill: "revise_look", expects: "text", expires_at: pastIso() });
    const tC = await freshLoop(catC).handleTurn({ message: "the scarf", hasImage: false });
    assert.strictEqual(tC.skill, "off_topic", "expired pending must not divert, got " + tC.skill);
    assert.strictEqual(catC.getPendingQuestions().length, 0, "expired entry cleared");
    console.log("  pass: the scarf continues revise_look; decline/expiry fall through");
  }

  // --- (g) catalogue_piece "want a look?" -> yes routes to propose_look ---
  console.log("\n[(g) catalogue_piece yes_no expectation]");
  {
    // Pre-fix shape: a plain yes fires no propose_look trigger.
    const stateless = Router.classifySync({ text: "yes" });
    assert.notStrictEqual(stateless.skill, "propose_look", "plain yes alone never fires propose_look");

    // Handler records the expectation on its closer.
    const catH = Wardrobe.createCatalog({ userKey: "SYNTH_m24_g_h" });
    const hr = await CataloguePiece.handle({ catalog: catH, text: "", imageDataUrl: null });
    assert.ok(/Want me to put a look together from what you've got\?/.test(hr.text), "closer unchanged");
    const hpend = catH.getPendingQuestions();
    assert.strictEqual(hpend.length, 1, "closer records one pending question");
    assert.strictEqual(hpend[0].skill, "propose_look", "pending skill recorded");
    assert.strictEqual(hpend[0].expects, "yes_no", "pending expects yes_no");

    // (a) satisfying reply routes to propose_look (seeded valid look).
    // propose_look's own "tweak anything?" closer records a FRESH
    // yes_no expectation toward revise_look — assert by id that the old
    // one is consumed and the fresh one stands.
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_m24_g" });
    seedLook(cat, "g");
    cat.askQuestion({ text: "want a look?", skill: "propose_look", expects: "yes_no" });
    const oldId = cat.getPendingQuestions()[0].id;
    const t = await freshLoop(cat).handleTurn({ message: "yes", hasImage: false });
    assert.strictEqual(t.skill, "propose_look", "yes routes to propose_look, got " + t.skill);
    assert.ok(/pending expectation satisfied/.test(t.decision.reason),
      "decision names the pending path: " + t.decision.reason);
    const afterA = cat.getPendingQuestions();
    assert.ok(afterA.every(function (q) { return q.id !== oldId; }), "old pending consumed");
    assert.strictEqual(afterA.length, 1, "tweak closer recorded one fresh pending");
    assert.strictEqual(afterA[0].skill, "revise_look", "fresh pending points at revise_look");
    assert.strictEqual(afterA[0].expects, "yes_no", "fresh pending expects yes_no");

    // (b) declining reply falls through, pending cleared.
    const catB = Wardrobe.createCatalog({ userKey: "SYNTH_m24_g_b" });
    seedLook(catB, "gb");
    catB.askQuestion({ text: "want a look?", skill: "propose_look", expects: "yes_no" });
    const tB = await freshLoop(catB).handleTurn({ message: "no thanks", hasImage: false });
    assert.notStrictEqual(tB.skill, "propose_look", "decline must NOT force propose_look, got " + tB.skill);
    assert.strictEqual(catB.getPendingQuestions().length, 0, "stale pending cleared");

    // (c) expired expectation falls through ("yes" alone is clarification).
    const catC = Wardrobe.createCatalog({ userKey: "SYNTH_m24_g_c" });
    seedLook(catC, "gc");
    catC.askQuestion({ text: "want a look?", skill: "propose_look", expects: "yes_no", expires_at: pastIso() });
    const tC = await freshLoop(catC).handleTurn({ message: "yes", hasImage: false });
    assert.strictEqual(tC.skill, "clarification", "expired pending must not divert, got " + tC.skill);
    assert.strictEqual(catC.getPendingQuestions().length, 0, "expired entry cleared");
    console.log("  pass: yes fires propose_look; decline/expiry fall through");
  }

  // --- (h) describe_wardrobe "beauties" closer records yes_no -> propose_look ---
  console.log("\n[(h) describe_wardrobe yes_no expectation]");
  {
    // Non-empty wardrobe: closer records the expectation.
    const catH = Wardrobe.createCatalog({ userKey: "SYNTH_m24_h_h" });
    catH.addPiece({ category: "scarf", attributes: {}, source_share_id: "SYNTH_share_h1" });
    const hr = await DescribeWardrobe.handle({ catalog: catH });
    assert.ok(/Want me to put a look together from these beauties\?/.test(hr.text), "closer unchanged");
    const hpend = catH.getPendingQuestions();
    assert.strictEqual(hpend.length, 1, "closer records one pending question");
    assert.strictEqual(hpend[0].skill, "propose_look", "pending skill recorded");
    assert.strictEqual(hpend[0].expects, "yes_no", "pending expects yes_no");
    noSynthLeak(hr.text, "describe reply");

    // Empty wardrobe: the "share a photo" prompt correctly wants a photo
    // routed to catalogue_piece already — no expectation recorded.
    const catE = Wardrobe.createCatalog({ userKey: "SYNTH_m24_h_e" });
    await DescribeWardrobe.handle({ catalog: catE });
    assert.strictEqual(catE.getPendingQuestions().length, 0, "empty-wardrobe prompt records nothing");

    // (a) satisfying reply ("sure") routes to propose_look. As in (g),
    // the tweak closer leaves one fresh revise_look pending behind.
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_m24_h" });
    seedLook(cat, "h");
    cat.askQuestion({ text: "beauties?", skill: "propose_look", expects: "yes_no" });
    const oldId = cat.getPendingQuestions()[0].id;
    const t = await freshLoop(cat).handleTurn({ message: "sure", hasImage: false });
    assert.strictEqual(t.skill, "propose_look", "sure routes to propose_look, got " + t.skill);
    assert.ok(/pending expectation satisfied/.test(t.decision.reason),
      "decision names the pending path: " + t.decision.reason);
    const afterA = cat.getPendingQuestions();
    assert.ok(afterA.every(function (q) { return q.id !== oldId; }), "old pending consumed");
    assert.strictEqual(afterA.length, 1, "tweak closer recorded one fresh pending");
    assert.strictEqual(afterA[0].skill, "revise_look", "fresh pending points at revise_look");
    console.log("  pass: beauties closer recorded; sure fires propose_look");
  }

  // --- (i) propose_look "tweak anything?" -> yes routes to revise_look ---
  console.log("\n[(i) propose_look yes_no expectation]");
  {
    // Validated path: closer records the expectation toward revise_look.
    const catH = Wardrobe.createCatalog({ userKey: "SYNTH_m24_i_h" });
    seedLook(catH, "ih");
    const hr = await ProposeLook.handle({ catalog: catH });
    assert.ok(/Want me to tweak anything\?/.test(hr.text), "tweak closer unchanged");
    const hpend = catH.getPendingQuestions();
    assert.strictEqual(hpend.length, 1, "tweak closer records one pending question");
    assert.strictEqual(hpend[0].skill, "revise_look", "pending skill recorded");
    assert.strictEqual(hpend[0].expects, "yes_no", "pending expects yes_no");

    // Honest fallbacks ask for another photo (which routes to
    // catalogue_piece already) — they record nothing: empty wardrobe,
    // and a lone scarf (incomplete finish, no valid look).
    const catF = Wardrobe.createCatalog({ userKey: "SYNTH_m24_i_f" });
    const fr = await ProposeLook.handle({ catalog: catF });
    assert.ok(/feeling a little empty/.test(fr.text), "empty reply unchanged");
    assert.strictEqual(catF.getPendingQuestions().length, 0, "empty fallback records nothing");
    const catF2 = Wardrobe.createCatalog({ userKey: "SYNTH_m24_i_f2" });
    catF2.addPiece({ category: "scarf", attributes: {}, source_share_id: "SYNTH_share_f2" });
    const fr2 = await ProposeLook.handle({ catalog: catF2 });
    assert.ok(/share one more piece/.test(fr2.text), "no-valid-look reply unchanged");
    assert.strictEqual(catF2.getPendingQuestions().length, 0, "no-valid-look records nothing");

    // (a) "yes" means "yes, tweak it" -> revise_look's own question flow.
    // revise_look cannot parse "yes", so it re-asks its "which piece?"
    // fallback — one fresh text pending stands, the old one consumed.
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_m24_i" });
    cat.askQuestion({ text: "tweak?", skill: "revise_look", expects: "yes_no" });
    const oldId = cat.getPendingQuestions()[0].id;
    const t = await freshLoop(cat).handleTurn({ message: "yes", hasImage: false });
    assert.strictEqual(t.skill, "revise_look", "yes routes to revise_look, got " + t.skill);
    assert.ok(/pending expectation satisfied/.test(t.decision.reason),
      "decision names the pending path: " + t.decision.reason);
    const afterA = cat.getPendingQuestions();
    assert.ok(afterA.every(function (q) { return q.id !== oldId; }), "old pending consumed");
    assert.strictEqual(afterA.length, 1, "which-piece fallback recorded one fresh pending");
    assert.strictEqual(afterA[0].skill, "revise_look", "fresh pending still revise_look");
    assert.strictEqual(afterA[0].expects, "text", "fresh pending expects text");

    // (b) declining reply falls through, pending cleared.
    const catB = Wardrobe.createCatalog({ userKey: "SYNTH_m24_i_b" });
    catB.askQuestion({ text: "tweak?", skill: "revise_look", expects: "yes_no" });
    const tB = await freshLoop(catB).handleTurn({ message: "no thanks", hasImage: false });
    assert.notStrictEqual(tB.skill, "revise_look", "decline must NOT force revise_look, got " + tB.skill);
    assert.strictEqual(catB.getPendingQuestions().length, 0, "stale pending cleared");

    // (c) expired expectation falls through ("yes" alone is clarification).
    const catC = Wardrobe.createCatalog({ userKey: "SYNTH_m24_i_c" });
    catC.askQuestion({ text: "tweak?", skill: "revise_look", expects: "yes_no", expires_at: pastIso() });
    const tC = await freshLoop(catC).handleTurn({ message: "yes", hasImage: false });
    assert.strictEqual(tC.skill, "clarification", "expired pending must not divert, got " + tC.skill);
    assert.strictEqual(catC.getPendingQuestions().length, 0, "expired entry cleared");
    console.log("  pass: yes continues to revise_look; decline/expiry fall through");
  }

  // --- (j) Evaluate_prospective_purchase: short "yes" confirms the hold ---
  console.log("\n[(j) purchase yes_no expectation (conservative)]");
  {
    // Start an evaluation through the real loop: stores a 24h hold and
    // records the yes_no expectation in the same turn.
    async function startEval(userKey) {
      const cat = Wardrobe.createCatalog({ userKey: userKey });
      const t1 = await freshLoop(cat).handleTurn({ message: "should i buy this scarf?", hasImage: true });
      assert.strictEqual(t1.skill, "Evaluate_prospective_purchase",
        "eval trigger routes to Evaluate_prospective_purchase, got " + t1.skill);
      assert.strictEqual(cat.getPieces({ status: "held" }).length, 1, "hold stored");
      const pend = cat.getPendingQuestions();
      assert.strictEqual(pend.length, 1, "eval records one pending question");
      assert.strictEqual(pend[0].skill, "Evaluate_prospective_purchase", "pending skill recorded");
      assert.strictEqual(pend[0].expects, "yes_no", "pending expects yes_no");
      noSynthLeak(t1.text, "eval reply");
      return cat;
    }
    function holdCounts(cat) {
      return { held: cat.getPieces({ status: "held" }).length, active: cat.getActivePieces().length };
    }

    // (a) satisfying replies ("yes", "done", "sure") confirm the purchase.
    for (const word of ["yes", "done", "sure"]) {
      const cat = await startEval("SYNTH_m24_j_a_" + word);
      const t = await freshLoop(cat).handleTurn({ message: word, hasImage: false });
      assert.strictEqual(t.skill, "Evaluate_prospective_purchase",
        JSON.stringify(word) + " routes to Evaluate_prospective_purchase, got " + t.skill);
      assert.ok(/pending expectation satisfied/.test(t.decision.reason),
        "decision names the pending path: " + t.decision.reason);
      assert.deepStrictEqual(holdCounts(cat), { held: 0, active: 1 },
        JSON.stringify(word) + " consumes the hold into the wardrobe");
      assert.strictEqual(cat.getPendingQuestions().length, 0, "pending resolved afterward");
      noSynthLeak(t.text, "confirmation reply");
    }
    console.log("  pass: yes/done/sure each confirm the purchase");

    // (b) a declining reply falls through and the hold stays held.
    {
      const cat = await startEval("SYNTH_m24_j_b");
      const t = await freshLoop(cat).handleTurn({ message: "no thanks", hasImage: false });
      assert.notStrictEqual(t.skill, "Evaluate_prospective_purchase",
        "decline must NOT confirm, got " + t.skill);
      assert.deepStrictEqual(holdCounts(cat), { held: 1, active: 0 }, "hold untouched by decline");
      assert.strictEqual(cat.getPendingQuestions().length, 0, "stale pending cleared");
      console.log("  pass: decline falls through, hold stays held");
    }

    // (c) an expired expectation does not confirm ("yes" alone clarifies).
    {
      const cat = Wardrobe.createCatalog({ userKey: "SYNTH_m24_j_c" });
      cat.addPiece({ category: "scarf", attributes: {}, source_share_id: "SYNTH_share_jc",
        status: "held", held_until: new Date(Date.now() + 3600 * 1000).toISOString() });
      cat.askQuestion({ text: "say i bought it", skill: "Evaluate_prospective_purchase",
        expects: "yes_no", expires_at: pastIso() });
      const t = await freshLoop(cat).handleTurn({ message: "yes", hasImage: false });
      assert.strictEqual(t.skill, "clarification", "expired pending must not divert, got " + t.skill);
      assert.deepStrictEqual(holdCounts(cat), { held: 1, active: 0 }, "hold untouched by expiry");
      assert.strictEqual(cat.getPendingQuestions().length, 0, "expired entry cleared");
      console.log("  pass: expiry falls through, hold stays held");
    }

    // (d) ambiguous replies NEVER confirm — the high-stakes guard.
    for (const word of ["maybe", "I'll think about it"]) {
      const cat = await startEval("SYNTH_m24_j_d_" + word.length);
      const t = await freshLoop(cat).handleTurn({ message: word, hasImage: false });
      assert.notStrictEqual(t.skill, "Evaluate_prospective_purchase",
        JSON.stringify(word) + " must NOT confirm, got " + t.skill);
      assert.deepStrictEqual(holdCounts(cat), { held: 1, active: 0 },
        JSON.stringify(word) + " leaves the hold untouched");
      console.log("  pass: " + JSON.stringify(word) + " does NOT confirm");
    }

    // The shared matcher itself: clearly affirmative shorts match, hedged
    // and declining inputs do not.
    const isAff = AgenticLoop.isAffirmativeReply;
    ["yes", "Yes!", "done", "sure", "yeah", "yep", "please", "yes, please", "go ahead", "do it"]
      .forEach(function (w) { assert.strictEqual(isAff(w), true, JSON.stringify(w) + " counts as affirmative"); });
    ["maybe", "I'll think about it", "no", "no thanks", "not now", "nah", "yes, but not yet", ""]
      .forEach(function (w) { assert.strictEqual(isAff(w), false, JSON.stringify(w) + " must NOT count as affirmative"); });
    console.log("  pass: affirmative matcher conservative by construction");
  }

  // --- (k) askQuestion vocabulary: "text" and "yes_no" join "image" ---
  console.log("\n[(k) askQuestion text/yes_no contract]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_m24_k" });
    ["text", "yes_no"].forEach(function (exp) {
      const q = cat.askQuestion({ text: "q?", skill: "revise_look", expects: exp });
      assert.strictEqual(q.expects, exp, "expects stored: " + exp);
      const deltaMs = Date.parse(q.expires_at) - Date.now();
      assert.ok(deltaMs > 23 * 3600 * 1000 && deltaMs <= 24 * 3600 * 1000 + 60 * 1000,
        exp + " expires roughly 24h out, got +" + Math.round(deltaMs / 3600000) + "h");
    });
    console.log("  pass: text + yes_no accepted with ~24h default expiry");
  }

  console.log("\nAll pending-expectation-routing tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
