"use strict";
/* meta-styles — delete_wardrobe_item regression tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Three-step wardrobe deletion, mirroring view_wardrobe_item's Step A/B
 * conventions plus a yes/no confirm before anything is removed:
 *
 *   (1) "delete the dresses" with >5 active dresses lists exactly 5,
 *       numbered, with the "show more" invite.
 *   (2) a bare number after that list moves to the Step C confirm
 *       question (NOT an immediate delete).
 *   (3) the confirm-turn call-path (a direct handle() call while a live
 *       pending-deletion exists — exactly how the loop's own yes_no gate
 *       invokes the skill after a verified affirmative) flips the target
 *       piece's status via rejectPiece; it no longer appears in
 *       getActivePieces() afterward.
 *   (4) an out-of-range number re-prompts honestly without deleting.
 *   (5) a garbled Step-B reply re-prompts and keeps the same page's
 *       list-context alive.
 *   (6) deleting one piece never affects a different same-category piece.
 *   (7) pending-deletion state is scoped to THIS skill's name and expires
 *       — a stale/expired pending-deletion is never acted on.
 * Plus: router triggers (both paths), fail-closed pending-deletion
 * contract, and the full pending-expectation loop ("yes" routes back and
 * deletes; "no" never reaches the skill).
 *
 * Real in-memory catalog + real heuristic router throughout (metaClient
 * is always null, so the live-Spark path is never attempted) — no
 * network, no sends. All ids synthetic (SYNTH_ prefix) — never real data.
 *
 * Run: node app/test/delete-wardrobe-item.test.js
 */
const assert = require("node:assert");
const AgenticLoop = require("../agentic-loop.js");
const Router = require("../router.js");
const Wardrobe = require("../wardrobe-catalog.js");
const DeleteItem = require("../skills/delete_wardrobe_item/handler.js");

function thumb(n) { return "data:image/png;base64,SYNTH_del_thumb_" + n; }
function orig(n) { return "data:image/png;base64,SYNTH_del_orig_" + n; }

function seedDresses(cat, count) {
  const colors = ["pink", "cream", "red", "blue", "green", "black", "white", "gold"];
  for (let i = 0; i < count; i++) {
    cat.addPiece({
      category: "dress",
      attributes: { color: colors[i % colors.length] },
      source_share_id: "SYNTH_share_del_" + i,
      photo_thumb: thumb(i),
      image_original: orig(i),
    });
  }
}

function noSynthLeak(text, label) {
  assert.ok(!/SYNTH_/.test(text), label + " must not leak SYNTH_ ids: " + String(text).slice(0, 200));
}

function freshLoop(catalog) {
  return AgenticLoop.createAgenticLoop({ catalog: catalog, router: Router, summariser: null });
}

async function run() {
  console.log("delete-wardrobe-item.test.js");

  // --- (1) >5 dresses: exactly 5, numbered, "show more" invite ---
  console.log("\n[(1) category list pages at 5 with invitation]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_del_1" });
    seedDresses(cat, 7);
    const r = await DeleteItem.handle({ catalog: cat, text: "delete the dresses" });
    assert.strictEqual(r.skill, "delete_wardrobe_item", "skill tagged");
    const lines = r.text.split("\n");
    assert.ok(/^1\. pink dress$/.test(lines[1]), "first line numbered + described, got: " + lines[1]);
    assert.ok(/^5\. green dress$/.test(lines[5]), "fifth line numbered, got: " + lines[5]);
    assert.strictEqual(lines.length, 7, "header + 5 entries + invite, got " + lines.length);
    assert.ok(/show more/i.test(r.text), "invites 'show more'");
    assert.strictEqual(r.image, null, "list carries no image");
    assert.deepStrictEqual(r.meta.imageDelivery,
      { requested: false, generated: false, delivered: false, reason: "list_no_image" });
    const ctx = cat.getListContext();
    assert.ok(ctx, "list context recorded");
    assert.strictEqual(ctx.skill, "delete_wardrobe_item", "context keyed to THIS skill");
    assert.strictEqual(ctx.category, "dress", "context category");
    assert.deepStrictEqual(ctx.piece_ids,
      ["SYNTH_piece_001", "SYNTH_piece_002", "SYNTH_piece_003", "SYNTH_piece_004", "SYNTH_piece_005"]);
    assert.strictEqual(ctx.offset, 0, "first-page offset");
    const pend = cat.getPendingQuestions();
    assert.strictEqual(pend.length, 1, "one pending question recorded");
    assert.strictEqual(pend[0].skill, "delete_wardrobe_item", "pending skill");
    assert.strictEqual(pend[0].expects, "text", "Step B expects text");
    assert.strictEqual(cat.getActivePieces().length, 7, "listing deletes nothing");
    noSynthLeak(r.text, "list reply");
    console.log("  pass: 5 numbered dresses + invite, context + expectation recorded, nothing deleted");
  }

  // --- (2) bare number -> Step C confirm question, NOT an immediate delete ---
  console.log("\n[(2) bare number asks to confirm, never deletes yet]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_del_2" });
    seedDresses(cat, 7);
    await DeleteItem.handle({ catalog: cat, text: "delete the dresses" });
    // The loop consumes the pending question before routing back; mimic that.
    cat.getPendingQuestions().forEach((q) => cat.resolveQuestion(q.id));
    const r = await DeleteItem.handle({ catalog: cat, text: "1" });
    assert.strictEqual(r.skill, "delete_wardrobe_item", "skill tagged");
    assert.ok(/Remove your pink dress/.test(r.text), "confirm names the exact piece, got: " + r.text);
    assert.ok(/are you sure/i.test(r.text), "confirm asks explicitly");
    assert.strictEqual(r.image, null, "confirm carries no image");
    // Still all active — picking a number must not delete.
    assert.strictEqual(cat.getActivePieces().length, 7, "nothing deleted at confirm time");
    assert.strictEqual(cat.getPiece("SYNTH_piece_001").status, "active", "picked piece still active");
    // Picking phase is done: list context cleared, pending-deletion live.
    assert.strictEqual(cat.getListContext(), null, "list context cleared at Step C");
    const pd = cat.getPendingDeletion();
    assert.ok(pd, "pending deletion recorded");
    assert.strictEqual(pd.skill, "delete_wardrobe_item", "pending scoped to THIS skill");
    assert.strictEqual(pd.piece_id, "SYNTH_piece_001", "pending identifies the picked piece");
    assert.strictEqual(pd.description, "pink dress", "pending carries the shown description");
    const pend = cat.getPendingQuestions();
    assert.strictEqual(pend.length, 1, "one fresh pending question recorded");
    assert.strictEqual(pend[0].skill, "delete_wardrobe_item", "confirm pending skill");
    assert.strictEqual(pend[0].expects, "yes_no", "confirm expects yes_no");
    noSynthLeak(r.text, "confirm reply");
    console.log("  pass: confirm question asked, piece still active, pending-deletion + yes_no recorded");
  }

  // --- (3) confirm-turn call-path: live pending deletion -> rejectPiece ---
  console.log("\n[(3) confirmed call flips status via rejectPiece]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_del_3" });
    seedDresses(cat, 3);
    await DeleteItem.handle({ catalog: cat, text: "delete the dresses" });
    cat.getPendingQuestions().forEach((q) => cat.resolveQuestion(q.id));
    await DeleteItem.handle({ catalog: cat, text: "2" });
    // Simulate the loop's own gate: it consumes the yes_no question and
    // only invokes the skill on a verified affirmative — so call handle()
    // directly while the pending-deletion is live.
    cat.getPendingQuestions().forEach((q) => cat.resolveQuestion(q.id));
    const r = await DeleteItem.handle({ catalog: cat, text: "yes" });
    assert.ok(/out of the wardrobe/i.test(r.text), "removal confirmed warmly, got: " + r.text);
    assert.ok(/cream dress/.test(r.text), "names the removed piece");
    assert.strictEqual(r.image, null, "done reply is text-only");
    assert.strictEqual(cat.getPiece("SYNTH_piece_002").status, "rejected", "status flipped via rejectPiece");
    const ids = cat.getActivePieces().map((p) => p.piece_id);
    assert.ok(ids.indexOf("SYNTH_piece_002") === -1, "removed piece gone from getActivePieces()");
    assert.strictEqual(cat.getPendingDeletion(), null, "pending deletion cleared after acting");
    noSynthLeak(r.text, "done reply");
    console.log("  pass: cream dress rejected, absent from actives, pending cleared");
  }

  // --- (4) out-of-range number: honest re-prompt, nothing deleted ---
  console.log("\n[(4) out-of-range number]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_del_4" });
    seedDresses(cat, 7);
    await DeleteItem.handle({ catalog: cat, text: "delete the dresses" });
    cat.getPendingQuestions().forEach((q) => cat.resolveQuestion(q.id));
    const r = await DeleteItem.handle({ catalog: cat, text: "9" });
    assert.strictEqual(r.image, null, "no image on a bad pick");
    assert.ok(/only showed 5/i.test(r.text) || /1 to 5/.test(r.text),
      "honest range re-prompt, got: " + r.text);
    assert.ok(/pink dress/.test(r.text), "current page restated");
    assert.ok(cat.getListContext(), "context kept alive after a bad pick");
    assert.strictEqual(cat.getPendingQuestions().length, 1, "expectation re-recorded");
    assert.strictEqual(cat.getPendingDeletion(), null, "no pending deletion on a bad pick");
    assert.strictEqual(cat.getActivePieces().length, 7, "nothing deleted");
    noSynthLeak(r.text, "range re-prompt");
    console.log("  pass: honest re-prompt, context alive, nothing deleted");
  }

  // --- (5) garbled Step-B reply: re-prompts, keeps the same page alive ---
  console.log("\n[(5) garbled reply stays in flow]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_del_5" });
    seedDresses(cat, 7);
    await DeleteItem.handle({ catalog: cat, text: "delete the dresses" });
    cat.getPendingQuestions().forEach((q) => cat.resolveQuestion(q.id));
    const before = cat.getListContext();
    const r = await DeleteItem.handle({ catalog: cat, text: "hmm, lovely weather today" });
    assert.ok(/didn.t catch a number/i.test(r.text), "honest miss re-prompt, got: " + r.text);
    assert.ok(/pink dress/.test(r.text), "live list restated");
    const after = cat.getListContext();
    assert.ok(after, "list context still live");
    assert.deepStrictEqual(after.piece_ids, before.piece_ids, "same page still live");
    assert.strictEqual(cat.getPendingQuestions().length, 1, "expectation re-recorded, not dropped");
    assert.strictEqual(cat.getActivePieces().length, 7, "nothing deleted");
    noSynthLeak(r.text, "garbled re-prompt");
    console.log("  pass: garbled reply re-prompts, same page live, nothing deleted");
  }

  // --- (6) deleting one piece never affects a same-category sibling ---
  console.log("\n[(6) siblings untouched]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_del_6" });
    seedDresses(cat, 3);
    await DeleteItem.handle({ catalog: cat, text: "remove my dresses" });
    cat.getPendingQuestions().forEach((q) => cat.resolveQuestion(q.id));
    await DeleteItem.handle({ catalog: cat, text: "1" });
    cat.getPendingQuestions().forEach((q) => cat.resolveQuestion(q.id));
    await DeleteItem.handle({ catalog: cat, text: "yes" });
    assert.strictEqual(cat.getPiece("SYNTH_piece_001").status, "rejected", "target rejected");
    assert.strictEqual(cat.getPiece("SYNTH_piece_002").status, "active", "sibling still active");
    assert.strictEqual(cat.getPiece("SYNTH_piece_003").status, "active", "sibling still active");
    const r = await DeleteItem.handle({ catalog: cat, text: "delete the dresses" });
    assert.ok(/cream dress/.test(r.text), "sibling listed after, got: " + r.text);
    assert.ok(!/pink dress/.test(r.text), "removed piece never listed again");
    console.log("  pass: only the confirmed piece flipped; siblings listable");
  }

  // --- (7) pending-deletion scoped to THIS skill + expires ---
  console.log("\n[(7) pending-deletion scoping + expiry]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_del_7" });
    seedDresses(cat, 2);
    // A pending deletion recorded under ANOTHER skill name is never ours.
    cat.setPendingDeletion({
      skill: "view_wardrobe_item", piece_id: "SYNTH_piece_001",
      description: "pink dress",
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    const r = await DeleteItem.handle({ catalog: cat, text: "delete the dresses" });
    assert.ok(/Which one shall we let go/.test(r.text), "foreign pending ignored, fresh list served");
    assert.strictEqual(cat.getPiece("SYNTH_piece_001").status, "active", "foreign pending acted on nothing");
    // An EXPIRED pending under our own name reads as none and clears.
    cat.setPendingDeletion({
      skill: "delete_wardrobe_item", piece_id: "SYNTH_piece_002",
      description: "cream dress",
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    assert.strictEqual(cat.getPendingDeletion(), null, "expired pending reads as none");
    cat.getPendingQuestions().forEach((q) => cat.resolveQuestion(q.id));
    const r2 = await DeleteItem.handle({ catalog: cat, text: "yes" });
    assert.ok(!/out of the wardrobe/i.test(r2.text), "stale pending never deletes, got: " + r2.text);
    assert.strictEqual(cat.getPiece("SYNTH_piece_002").status, "active", "stale pending deleted nothing");
    console.log("  pass: foreign skill ignored, expired pending never acted on");
  }

  // --- catalog unit: fail-closed pending-deletion contract ---
  console.log("\n[(catalog) pending-deletion contract]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_del_8" });
    assert.strictEqual(cat.getPendingDeletion(), null, "no pending initially");
    assert.throws(() => cat.setPendingDeletion({
      skill: "delete_wardrobe_item", piece_id: "SYNTH_piece_001",
      description: "pink dress",
      expires_at: new Date(Date.now() + 600 * 1000).toISOString(), bogus: 1,
    }), /rejected key/, "unknown key rejected");
    assert.throws(() => cat.setPendingDeletion({
      skill: "delete_wardrobe_item", piece_id: "",
      description: "pink dress",
      expires_at: new Date(Date.now() + 600 * 1000).toISOString(),
    }), /piece_id/, "empty piece_id rejected");
    assert.throws(() => cat.setPendingDeletion({
      skill: "delete_wardrobe_item", piece_id: "SYNTH_piece_001",
      description: "",
      expires_at: new Date(Date.now() + 600 * 1000).toISOString(),
    }), /description/, "empty description rejected");
    assert.throws(() => cat.setPendingDeletion({
      skill: "delete_wardrobe_item", piece_id: "SYNTH_piece_001",
      description: "pink dress", expires_at: "soon",
    }), /expires_at/, "non-ISO expiry rejected");
    assert.throws(() => cat.setPendingDeletion(null), /must be an object/, "non-object rejected");
    console.log("  pass: fail-closed rejects");
  }

  // --- router: delete/remove triggers hit delete_wardrobe_item; view kept ---
  console.log("\n[(router) triggers]");
  {
    for (const msg of ["delete the dresses", "remove my cardigans", "delete my tops",
        "remove the blazers", "delete my scarves", "remove my bags", "delete my bottoms"]) {
      const d = Router.classifySync({ text: msg });
      assert.strictEqual(d.skill, "delete_wardrobe_item", JSON.stringify(msg) + " -> " + d.skill);
    }
    // No regression on the mirrored neighbour: show/see still views.
    for (const msg of ["show me the dresses", "see my cardigans", "show my tops"]) {
      const d = Router.classifySync({ text: msg });
      assert.strictEqual(d.skill, "view_wardrobe_item", JSON.stringify(msg) + " -> " + d.skill);
    }
    // No regression on other neighbours.
    assert.strictEqual(Router.classifySync({ text: "what do I have in my wardrobe?" }).skill,
      "describe_wardrobe", "describe_wardrobe trigger kept");
    assert.strictEqual(Router.classifySync({ text: "show me a look please" }).skill,
      "propose_look", "propose_look trigger kept");
    console.log("  pass: 7 delete plurals route, view + neighbours kept");
  }

  // --- full loop: list -> pick -> "yes" deletes via the yes_no gate ---
  console.log("\n[(loop) yes confirms through the pending gate; no never reaches the skill]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_del_9" });
    seedDresses(cat, 6);
    const loop = freshLoop(cat);
    const t1 = await loop.handleTurn({ message: "delete the dresses", hasImage: false });
    assert.strictEqual(t1.skill, "delete_wardrobe_item", "list routes, got " + t1.skill);
    assert.ok(/Which one shall we let go/.test(t1.text), "list reply through the loop");
    const loop2 = AgenticLoop.createAgenticLoop({ catalog: cat, router: Router, summariser: null });
    const t2 = await loop2.handleTurn({ message: "1", hasImage: false });
    assert.strictEqual(t2.skill, "delete_wardrobe_item", "bare 1 routes back, got " + t2.skill);
    assert.ok(/pending expectation satisfied/.test(t2.decision.reason),
      "decision names the pending path: " + t2.decision.reason);
    assert.ok(/Remove your pink dress/.test(t2.text), "confirm question through the loop");
    assert.strictEqual(cat.getListContext(), null, "picking phase closed");
    assert.ok(cat.getPendingDeletion(), "pending deletion live after Step C");
    // "yes" satisfies the yes_no gate and routes back — the skill deletes.
    const loop3 = AgenticLoop.createAgenticLoop({ catalog: cat, router: Router, summariser: null });
    const t3 = await loop3.handleTurn({ message: "yes", hasImage: false });
    assert.strictEqual(t3.skill, "delete_wardrobe_item", "yes routes back, got " + t3.skill);
    assert.ok(/pending expectation satisfied/.test(t3.decision.reason),
      "yes_no gate named: " + t3.decision.reason);
    assert.ok(/out of the wardrobe/i.test(t3.text), "done reply through the loop");
    assert.strictEqual(cat.getPiece("SYNTH_piece_001").status, "rejected", "loop yes deleted the piece");
    noSynthLeak(t3.text, "loop done reply");
    console.log("  pass: list -> 1 -> yes deletes through the loop");
  }

  // --- full loop: "no" declines through normal routing, deletes nothing ---
  console.log("\n[(loop) no declines without reaching the skill]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_del_10" });
    seedDresses(cat, 2);
    const loop = freshLoop(cat);
    await loop.handleTurn({ message: "delete the dresses", hasImage: false });
    const loop2 = AgenticLoop.createAgenticLoop({ catalog: cat, router: Router, summariser: null });
    await loop2.handleTurn({ message: "2", hasImage: false });
    assert.ok(cat.getPendingDeletion(), "pending deletion live after Step C");
    const oldId = cat.getPendingDeletion().piece_id;
    const loop3 = AgenticLoop.createAgenticLoop({ catalog: cat, router: Router, summariser: null });
    const t3 = await loop3.handleTurn({ message: "no", hasImage: false });
    assert.notStrictEqual(t3.skill, "delete_wardrobe_item",
      "a decline never routes back to the skill, got " + t3.skill);
    assert.strictEqual(cat.getPiece(oldId).status, "active", "declined piece stays active");
    assert.strictEqual(cat.getActivePieces().length, 2, "nothing deleted on decline");
    console.log("  pass: 'no' falls through to normal routing, wardrobe untouched");
  }

  // --- empty category: honest nothing-to-delete ---
  console.log("\n[(empty) zero active pieces reads honestly]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_del_11" });
    seedDresses(cat, 1);
    const r = await DeleteItem.handle({ catalog: cat, text: "delete the scarves" });
    assert.ok(/Nothing to delete/i.test(r.text), "honest empty reply, got: " + r.text);
    assert.strictEqual(r.image, null, "text-only");
    assert.strictEqual(cat.getListContext(), null, "no cursor on empty");
    noSynthLeak(r.text, "empty reply");
    console.log("  pass: empty category reads honestly");
  }

  console.log("\nAll delete-wardrobe-item tests passed.");
}

if (require.main === module) {
  run().then(
    () => {},
    (e) => { console.error("FAIL:", e && e.message ? e.message : e); process.exit(1); }
  );
}

module.exports = { run };
