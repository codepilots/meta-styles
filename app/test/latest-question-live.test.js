"use strict";
/* meta-styles — latest-question-live regression tests (2026-11-03 stale-hijack fix).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Rule under test: only the question in the bot's LATEST reply is live.
 * (a) catalog.askQuestion resolves every older unresolved question as
 *     superseded; (b) the agentic loop consults the NEWEST live question,
 *     never an older one; (c) a reply that asks no new question resolves
 *     older unresolved questions too. Durable mid-flow state with its own
 *     store/TTL (held purchase pieces, pending-deletion/clear-all
 *     snapshots, detect bags, list cursors, the profile record) is never
 *     question state and keeps its documented behaviour — pinned below.
 *
 * Live bug (2026-11-03): a stale revise_look CLARIFY text question stayed
 * unresolved; the loop satisfied the OLDEST pending first, so "yes" meant
 * for a newer consent question was consumed as the CLARIFY answer and the
 * headshot was never requested.
 *
 * All ids synthetic (SYNTH_ prefix) — never real data. No network: the
 * heuristic router runs with metaClient null throughout.
 *
 * Run: node app/test/latest-question-live.test.js
 */
const assert = require("node:assert");
const AgenticLoop = require("../agentic-loop.js");
const Router = require("../router.js");
const Wardrobe = require("../wardrobe-catalog.js");
const ProposeLook = require("../skills/propose_look/handler.js");
const DeleteItem = require("../skills/delete_wardrobe_item/handler.js");

const CLARIFY_TEXT = "Tell me a little more, loveling \u2014 which piece would you like to swap, skip, or add back? \u2728";
// Representative valid-look closer (the bot's latest reply in the bug
// setup). The live assertion is routing + supersede, not this wording.
const TWEAK_TEXT = "That is a look, darling \u2728 Want me to tweak anything?";

function freshLoop(catalog) {
  return AgenticLoop.createAgenticLoop({ catalog: catalog, router: Router, summariser: null });
}

// dress + scarf + bag: a validated look (base + scarf+bag finish), so
// propose turns exercise the real validated path.
function seedLook(cat, tag) {
  cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_" + tag + "_1" });
  cat.addPiece({ category: "scarf", attributes: {}, source_share_id: "SYNTH_share_" + tag + "_2" });
  cat.addPiece({ category: "bag", attributes: {}, source_share_id: "SYNTH_share_" + tag + "_3" });
}

function seedDresses(cat, n, tag) {
  for (let i = 0; i < n; i++) {
    cat.addPiece({ category: "dress", attributes: { color: "pink" }, source_share_id: "SYNTH_share_" + tag + "_" + i });
  }
}

function noSynthLeak(text, label) {
  assert.ok(!/SYNTH_/.test(text), label + " must not leak SYNTH_ ids: " + String(text).slice(0, 200));
}

function pendingIds(cat) {
  return cat.getPendingQuestions().map(function (q) { return q.id; });
}

async function run() {
  console.log("latest-question-live.test.js");
  if (Router.clearLog) Router.clearLog();

  // --- (0) catalog unit: a new question supersedes older unresolved ones ---
  console.log("\n[(0) askQuestion supersedes older unresolved questions]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_lql_0" });
    const stale = cat.askQuestion({ text: CLARIFY_TEXT, skill: "revise_look", expects: "text" });
    const latest = cat.askQuestion({ text: TWEAK_TEXT, skill: "revise_look", expects: "yes_no" });
    const pend = cat.getPendingQuestions();
    assert.strictEqual(pend.length, 1, "exactly one live question, got " + pend.length);
    assert.strictEqual(pend[0].id, latest.id, "the live one is the newest");
    assert.ok(pendedResolved(cat, stale.id), "stale question resolved as superseded");
    // Bare-string questions supersede too (they are still questions).
    const plain = cat.askQuestion("What should I style around first?");
    assert.strictEqual(cat.getPendingQuestions().length, 1, "plain question is the only live one");
    assert.ok(pendedResolved(cat, latest.id), "previous newest superseded by the plain one");
    assert.strictEqual(plain.expects, null, "bare-string contract kept (no expects)");
    console.log("  pass: newest only live, older resolved, bare-string kept");
  }

  // --- (1) exact live bug: stale CLARIFY must not eat the consent "yes" ---
  console.log("\n[(1) stale CLARIFY + tweak -> render asks consent, yes grants it]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_lql_1" });
    seedLook(cat, "lql1");
    // Stale question from an earlier revise attempt, never answered.
    const stale = cat.askQuestion({ text: CLARIFY_TEXT, skill: "revise_look", expects: "text" });
    // The valid look: same handler the loop invokes, recording its real
    // turn + "Want me to tweak anything?" closer. Runs past the pending
    // gate exactly as the routed skill call would — the point under test
    // is what the LATER turns do with the two questions on record.
    const look = await ProposeLook.handle({ catalog: cat, text: "show me a look", metaClient: null });
    assert.ok(/Want me to tweak anything\?/.test(look.text), "valid look records its tweak closer");
    assert.ok(pendedResolved(cat, stale.id), "recording the newer question superseded the stale CLARIFY");
    assert.strictEqual(cat.getPendingQuestions().length, 1, "only the tweak question is live");

    // "can you show it on me?" — the stale text question must NOT divert
    // this turn; the tweak yes_no is not satisfied by it, so the router
    // sends it down the render-on-wearer path, which asks consent.
    const tRender = await freshLoop(cat).handleTurn({ message: "can you show it on me?", hasImage: false });
    assert.strictEqual(tRender.skill, "revise_look", "render turn routes to revise_look, got " + tRender.skill);
    assert.strictEqual(tRender.text, ProposeLook.PROFILE_CONSENT_TEXT, "consent asked (not a CLARIFY re-ask)");
    noSynthLeak(tRender.text, "consent reply");

    // "yes" satisfies the NEWEST (consent) question — consent is recorded
    // and the headshot request goes out, never the CLARIFY fallback.
    const tYes = await freshLoop(cat).handleTurn({ message: "yes", hasImage: false });
    assert.strictEqual(tYes.skill, "revise_look", "consent yes routes to revise_look, got " + tYes.skill);
    assert.ok(/pending expectation satisfied/.test(tYes.decision.reason),
      "decision names the pending path: " + tYes.decision.reason);
    assert.strictEqual(cat.getProfileReferences().consent, true, "consent recorded");
    assert.ok(/headshot/.test(tYes.text), "profile-photo request sent, got: " + tYes.text.slice(0, 120));
    assert.ok(!/which piece would you like to swap/.test(tYes.text), "not the CLARIFY fallback");
    const pend = cat.getPendingQuestions();
    assert.strictEqual(pend.length, 1, "one live question after consent");
    assert.strictEqual(pend[0].expects, "profile_image", "live question awaits the profile photo");
    noSynthLeak(tYes.text, "headshot-request reply");
    console.log("  pass: consent recorded, headshot requested, stale CLARIFY never consulted");
  }

  // --- (2) stale CLARIFY text must not hijack a fresh look request ---
  console.log("\n[(2) stale CLARIFY + make-a-look -> propose_look]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_lql_2" });
    seedLook(cat, "lql2");
    const stale = cat.askQuestion({ text: CLARIFY_TEXT, skill: "revise_look", expects: "text" });
    // The bot's latest reply asked something newer (the tweak closer).
    cat.askQuestion({ text: TWEAK_TEXT, skill: "revise_look", expects: "yes_no" });
    assert.ok(pendedResolved(cat, stale.id), "stale CLARIFY superseded by the newer question");
    const t = await freshLoop(cat).handleTurn({ message: "can you make me a look?", hasImage: false });
    assert.strictEqual(t.skill, "propose_look", "fresh look request reaches propose_look, got " + t.skill);
    assert.ok(!/pending expectation satisfied/.test(t.decision.reason),
      "router decided, no stale pending consumed: " + t.decision.reason);
    assert.ok(pendingIds(cat).indexOf(stale.id) === -1, "stale CLARIFY never resurrected");
    noSynthLeak(t.text, "look reply");
    console.log("  pass: newest-only check, stale text never consulted");
  }

  // --- (3) keep: answering the just-asked CLARIFY still continues revise ---
  console.log("\n[(3) CLARIFY then 'the scarf' still continues revise_look]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_lql_3" });
    seedLook(cat, "lql3");
    cat.askQuestion({ text: CLARIFY_TEXT, skill: "revise_look", expects: "text" });
    const oldId = pendingIds(cat)[0];
    const t = await freshLoop(cat).handleTurn({ message: "the scarf", hasImage: false });
    assert.strictEqual(t.skill, "revise_look", "piece-name answer routes to revise_look, got " + t.skill);
    assert.ok(/pending expectation satisfied/.test(t.decision.reason),
      "decision names the pending path: " + t.decision.reason);
    assert.ok(/which piece would you like to swap/.test(t.text), "CLARIFY re-asked for the bare noun");
    const after = cat.getPendingQuestions();
    assert.ok(after.every(function (q) { return q.id !== oldId; }), "old question consumed");
    assert.strictEqual(after.length, 1, "one fresh question stands");
    console.log("  pass: just-asked question still answered on the next turn");
  }

  // --- (4) keep: delete list -> pick -> yes deletes; clear-all yes clears ---
  console.log("\n[(4) delete + clear-all confirms still work through the loop]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_lql_4" });
    seedDresses(cat, 6, "lql4");
    const t1 = await freshLoop(cat).handleTurn({ message: "delete the dresses", hasImage: false });
    assert.strictEqual(t1.skill, "delete_wardrobe_item", "list routes, got " + t1.skill);
    const t2 = await freshLoop(cat).handleTurn({ message: "2", hasImage: false });
    assert.strictEqual(t2.skill, "delete_wardrobe_item", "pick routes back, got " + t2.skill);
    assert.ok(/are you sure/.test(t2.text), "confirm asked");
    assert.ok(cat.getPendingDeletion(), "pending-deletion live (durable state, not a question)");
    const t3 = await freshLoop(cat).handleTurn({ message: "yes", hasImage: false });
    assert.strictEqual(t3.skill, "delete_wardrobe_item", "yes routes back, got " + t3.skill);
    assert.strictEqual(cat.getPiece("SYNTH_piece_002").status, "rejected", "picked piece deleted");
    assert.strictEqual(cat.getPendingDeletion(), null, "pending-deletion cleared after acting");
    console.log("  pass: list -> 2 -> yes deletes");
  }
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_lql_4b" });
    seedDresses(cat, 3, "lql4b");
    const t1 = await freshLoop(cat).handleTurn({ message: "clear my wardrobe", hasImage: false });
    assert.strictEqual(t1.skill, "delete_wardrobe_item", "clear-all ask routes, got " + t1.skill);
    assert.ok(/Say yes to clear it all/.test(t1.text), "clear-all confirm asked");
    const t3 = await freshLoop(cat).handleTurn({ message: "yes", hasImage: false });
    assert.strictEqual(t3.skill, "delete_wardrobe_item", "clear-all yes routes back, got " + t3.skill);
    assert.strictEqual(cat.getActivePieces().length, 0, "wardrobe cleared");
    noSynthLeak(t3.text, "clear-all done reply");
    console.log("  pass: clear-all confirm still works");
  }

  // --- (5) keep: purchase hold outlives a dead question ("I bought it") ---
  console.log("\n[(5) purchase hold confirms after its question died]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_lql_5" });
    seedLook(cat, "lql5");
    const tEval = await freshLoop(cat).handleTurn({ message: "should i buy this scarf?", hasImage: true });
    assert.strictEqual(tEval.skill, "Evaluate_prospective_purchase", "eval routes, got " + tEval.skill);
    assert.strictEqual(cat.getPieces({ status: "held" }).length, 1, "hold stored (durable piece state)");
    // A newer turn supersedes the purchase question: "show me a look
    // please" is not affirmative, so the purchase question is cleared and
    // the look closer becomes the only live question.
    const tLook = await freshLoop(cat).handleTurn({ message: "show me a look please", hasImage: false });
    assert.strictEqual(tLook.skill, "propose_look", "look routes, got " + tLook.skill);
    // The exact confirmation phrase routes via the router (not the dead
    // question) and double-gates on the still-live hold.
    const tBuy = await freshLoop(cat).handleTurn({ message: "I bought it", hasImage: false });
    assert.strictEqual(tBuy.skill, "Evaluate_prospective_purchase", "confirmation routes, got " + tBuy.skill);
    assert.strictEqual(cat.getPieces({ status: "held" }).length, 0, "hold consumed");
    assert.strictEqual(cat.getActivePieces().length, 4, "confirmed piece joins the wardrobe");
    noSynthLeak(tBuy.text, "confirmation reply");
    console.log("  pass: hold (not the question) carries the confirmation");
  }

  // --- (6) a reply with no question clears older questions ---
  console.log("\n[(6) no-question reply clears older questions]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_lql_6" });
    cat.askQuestion({ text: TWEAK_TEXT, skill: "revise_look", expects: "yes_no" });
    const t = await freshLoop(cat).handleTurn({ message: "thanks", hasImage: false });
    assert.strictEqual(t.skill, "clarification", "small-talk clarifies, got " + t.skill);
    assert.strictEqual(cat.getPendingQuestions().length, 0, "older question cleared by the question-less reply");
    // The next "yes" goes to normal routing (stateless yes clarifies),
    // never to the dead tweak question.
    const tYes = await freshLoop(cat).handleTurn({ message: "yes", hasImage: false });
    assert.notStrictEqual(tYes.skill, "revise_look", "dead question never resurrected, got " + tYes.skill);
    assert.strictEqual(cat.getPendingQuestions().length, 0, "nothing pending after normal routing");
    console.log("  pass: stale cleared, next yes routes normally");
  }

  console.log("\nAll latest-question-live tests passed.");
}

function pendedResolved(cat, id) {
  const all = (cat.toJSON && cat.toJSON().pending_questions) || [];
  return all.some(function (q) { return q && q.id === id && q.resolved === true; });
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
