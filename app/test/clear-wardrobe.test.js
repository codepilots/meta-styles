"use strict";
/* meta-styles — clear-wardrobe tests. NEW hackathon work (building period
 * Oct 27 – Nov 4, 2026).
 *
 * Whole-wardrobe clear inside delete_wardrobe_item (reused Step C/D
 * machinery, no new skill):
 *
 *   (1) routing: whole-wardrobe phrasing reaches delete_wardrobe_item;
 *       "delete my photos", bare "delete"/"DELETE" and "forget me" keep
 *       routing exactly as before (never the delete skill).
 *   (2) ask turn: count (active + separately-held) + short category
 *       breakdown + saved-profile-photos-untouched wording, a yes_no
 *       question recorded, a clear-all pending-deletion snapshot, and
 *       nothing removed yet. Empty wardrobe -> honest nothing-to-clear,
 *       no question.
 *   (3) confirm turn: every snapshot id still active/held is rejected,
 *       the catalog saves exactly ONCE, a piece added between ask and
 *       confirm survives, pending + list context clear, and the saved
 *       profile record is untouched. "no" never reaches the skill.
 *   (4) after a clear, revise_look's "show me wearing it" and "add my
 *       bag" never render or list removed pieces (this already held via
 *       lastValidLook's all-core-live rule — pinned here either way).
 *   (5) re-sharing the identical synthetic photo after a clear catalogues
 *       a NEW active piece (dedupe is live-pieces-only); replaying the
 *       same share id still does not double-add.
 *   (5b) replaying a share id catalogued BEFORE a clear stays idempotent
 *       after the clear (per-share guard matches any status, rejected
 *       included); a NEW share id with the same photo catalogues 1 piece.
 *   (5c) a 1-piece clear asks/confirm without "all 1 piece"/"1 piece are".
 *   (6) "delete my shoes" routes to delete_wardrobe_item and lists the
 *       shoes piece; "show my shoes" views it.
 *
 * Real in-memory catalog + real heuristic router throughout (metaClient
 * only where catalogue_piece needs one — stubbed, synthetic). All ids
 * synthetic (SYNTH_ prefix) — never real data.
 *
 * Run: node app/test/clear-wardrobe.test.js
 */
const assert = require("node:assert");
const AgenticLoop = require("../agentic-loop.js");
const Router = require("../router.js");
const Wardrobe = require("../wardrobe-catalog.js");
const DeleteItem = require("../skills/delete_wardrobe_item/handler.js");
const Catalogue = require("../skills/catalogue_piece/handler.js");
const Revise = require("../skills/revise_look/handler.js");

function tinyPngDataUrl() {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
}

function multiDetectClient() {
  return {
    detectGarments: async function () {
      return {
        placeholder: false, pieces: [
          { category: "base/top", attributes: { color: "sage" }, bbox: [0.1, 0.1, 0.3, 0.3] },
          { category: "base/bottom", attributes: { color: "black" }, bbox: [0.1, 0.45, 0.3, 0.3] },
          { category: "bag", attributes: { color: "brown" }, bbox: [0.6, 0.6, 0.2, 0.2] }
        ]
      };
    },
    classify: async function () { return { category: "dress" }; },
    segment: async function () { return { boxes: [] }; }
  };
}

function seedWardrobe(cat) {
  const plan = [
    ["dress", "pink"], ["dress", "cream"],
    ["base/top", "red"], ["base/top", "blue"], ["base/top", "gold"],
    ["bag", "brown"], ["bag", "black"],
    ["scarf", "teal"],
    ["shoes", "white"],
  ];
  plan.forEach(function (entry, i) {
    cat.addPiece({
      category: entry[0],
      attributes: { color: entry[1] },
      source_share_id: "SYNTH_clear_seed_" + i,
      photo_thumb: "data:image/png;base64,SYNTH_clear_thumb_" + i,
    });
  });
  // One "held" prospective-purchase piece (M22 hold): counted separately
  // in the ask wording and cleared along with everything else.
  cat.addPiece({
    category: "base/top",
    attributes: { color: "lilac" },
    source_share_id: "SYNTH_clear_held",
    photo_thumb: "data:image/png;base64,SYNTH_clear_thumb_h",
    status: "held",
    held_until: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  });
}

function noSynthLeak(text, label) {
  assert.ok(!/SYNTH_/.test(text), label + " must not leak SYNTH_ ids: " + String(text).slice(0, 200));
}

function freshLoop(catalog) {
  return AgenticLoop.createAgenticLoop({ catalog: catalog, router: Router, summariser: null });
}

function resolveQuestions(cat) {
  cat.getPendingQuestions().forEach((q) => cat.resolveQuestion(q.id));
}

async function run() {
  console.log("clear-wardrobe.test.js");

  // --- (1) routing: clear-all phrases -> delete; photos/bare/forget-me untouched ---
  console.log("\n[(1) clear-all routing]");
  {
    const clearPhrases = [
      "clear my wardrobe", "empty my wardrobe", "reset my wardrobe",
      "start my wardrobe fresh", "start my wardrobe over",
      "delete everything in my wardrobe", "remove everything in my wardrobe",
      "delete all my clothes", "remove all my pieces", "delete all my wardrobe",
      "CLEAR MY WARDROBE",
    ];
    for (const msg of clearPhrases) {
      const d = Router.classifySync({ text: msg });
      assert.strictEqual(d.skill, "delete_wardrobe_item", JSON.stringify(msg) + " -> " + d.skill);
    }
    // Untouched neighbours: saved-profile-photo deletion, bare deletes,
    // account-deletion phrasing — none may route to the delete skill.
    assert.strictEqual(Router.classifySync({ text: "delete my photos" }).skill,
      "propose_look", "saved profile-photo deletion kept");
    assert.strictEqual(Router.classifySync({ text: "forget my profile photos" }).skill,
      "propose_look", "forget-profile-photos kept");
    for (const msg of ["delete", "DELETE", "forget me"]) {
      const d = Router.classifySync({ text: msg });
      assert.notStrictEqual(d.skill, "delete_wardrobe_item",
        JSON.stringify(msg) + " must never reach the delete skill, got " + d.skill);
    }
    // Category deletes still route per-category, not clear-all.
    assert.strictEqual(Router.classifySync({ text: "delete the dresses" }).skill,
      "delete_wardrobe_item", "category delete kept");
    console.log("  pass: " + clearPhrases.length + " clear phrases route; photos/bare/forget-me untouched");
  }

  // --- (2) ask turn: count + breakdown + profile wording, yes_no, nothing removed ---
  console.log("\n[(2) ask turn]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_clear_2" });
    seedWardrobe(cat);
    const r = await DeleteItem.handle({ catalog: cat, text: "clear my wardrobe" });
    assert.strictEqual(r.skill, "delete_wardrobe_item", "skill tagged");
    assert.ok(/all 10 pieces/.test(r.text), "total count (9 active + 1 held), got: " + r.text);
    assert.ok(/2 dresses/.test(r.text), "breakdown dresses, got: " + r.text);
    assert.ok(/4 tops/.test(r.text), "breakdown tops (3 active + 1 held), got: " + r.text);
    assert.ok(/2 bags/.test(r.text), "breakdown bags, got: " + r.text);
    assert.ok(/1 scarf/.test(r.text), "breakdown scarf, got: " + r.text);
    assert.ok(/1 pair of shoes/.test(r.text), "breakdown shoes, got: " + r.text);
    assert.ok(/including 1 held/.test(r.text), "held named separately, got: " + r.text);
    assert.ok(/profile photos stay exactly as they are/i.test(r.text),
      "profile photos untouched wording, got: " + r.text);
    assert.ok(/Say yes to clear it all/i.test(r.text), "yes/no asked, got: " + r.text);
    assert.strictEqual(r.image, null, "text-only");
    const pend = cat.getPendingQuestions();
    assert.strictEqual(pend.length, 1, "one pending question recorded");
    assert.strictEqual(pend[0].skill, "delete_wardrobe_item", "pending skill");
    assert.strictEqual(pend[0].expects, "yes_no", "pending expects yes_no");
    const pd = cat.getPendingDeletion();
    assert.ok(pd, "clear-all pending-deletion recorded");
    assert.strictEqual(pd.skill, "delete_wardrobe_item", "pending scoped to THIS skill");
    assert.strictEqual(pd.piece_id, "clear-all", "clear-all marker");
    const snap = JSON.parse(pd.description);
    assert.ok(Array.isArray(snap.piece_ids), "snapshot of piece_ids");
    assert.strictEqual(snap.piece_ids.length, 10, "snapshot covers all 10");
    assert.strictEqual(cat.getActivePieces().length, 9, "nothing removed at ask time");
    assert.strictEqual(cat.getPieces({ status: "held" }).length, 1, "held untouched at ask time");
    noSynthLeak(r.text, "ask reply");
    console.log("  pass: count + breakdown + profile wording, yes_no + snapshot recorded, nothing removed");
  }

  // --- (2b) empty wardrobe -> honest nothing-to-clear, no question ---
  console.log("\n[(2b) empty wardrobe]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_clear_2b" });
    const r = await DeleteItem.handle({ catalog: cat, text: "empty my wardrobe" });
    assert.ok(/Nothing to clear/i.test(r.text), "honest empty reply, got: " + r.text);
    assert.strictEqual(r.image, null, "text-only");
    assert.strictEqual(cat.getPendingQuestions().length, 0, "no question recorded");
    assert.strictEqual(cat.getPendingDeletion(), null, "no pending-deletion recorded");
    noSynthLeak(r.text, "empty reply");
    console.log("  pass: honest nothing-to-clear, no question");
  }

  // --- (3) confirm: snapshot rejected, saved once, newcomer survives, profile kept ---
  console.log("\n[(3) confirm turn]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_clear_3" });
    seedWardrobe(cat);
    // Saved profile record that the clear must never touch.
    cat.setProfileConsent(true);
    cat.setProfileReference("headshot", tinyPngDataUrl());
    cat.setProfileReference("full_body", tinyPngDataUrl());
    const beforeProfile = cat.getProfileReferences();
    const ask = await DeleteItem.handle({ catalog: cat, text: "delete everything in my wardrobe" });
    assert.ok(/all 10 pieces/.test(ask.text), "ask names all 10, got: " + ask.text);
    // A piece catalogued AFTER the ask is absent from the snapshot.
    const newcomer = cat.addPiece({
      category: "scarf", attributes: { color: "amber" },
      source_share_id: "SYNTH_clear_newcomer",
      photo_thumb: "data:image/png;base64,SYNTH_clear_thumb_new",
    });
    let saves = 0;
    const realSave = cat.save.bind(cat);
    cat.save = function () { saves += 1; return realSave(); };
    resolveQuestions(cat);
    const r = await DeleteItem.handle({ catalog: cat, text: "yes" });
    assert.ok(/all 10 pieces are out/i.test(r.text), "warm count reply, got: " + r.text);
    assert.ok(/profile photos are untouched/i.test(r.text), "profile reassurance, got: " + r.text);
    assert.ok(/fresh photo/i.test(r.text), "invites new photos, got: " + r.text);
    assert.strictEqual(r.image, null, "text-only");
    assert.strictEqual(saves, 1, "catalog saved exactly once, got " + saves);
    const remaining = cat.getActivePieces();
    assert.strictEqual(remaining.length, 1, "only the newcomer stays active, got " + remaining.length);
    assert.strictEqual(remaining[0].piece_id, newcomer.piece_id, "newcomer survives");
    const heldNow = cat.getPieces({ status: "held" });
    assert.strictEqual(heldNow.length, 0, "held piece cleared too");
    assert.strictEqual(cat.getPendingDeletion(), null, "pending cleared after acting");
    assert.strictEqual(cat.getListContext(), null, "no list context left");
    assert.strictEqual(cat.getPendingQuestions().length, 0, "no question left");
    assert.deepStrictEqual(cat.getProfileReferences(), beforeProfile, "profile record untouched");
    noSynthLeak(r.text, "done reply");
    console.log("  pass: 10 rejected, saved once, newcomer survives, profile kept");
  }

  // --- (3b) "no" never reaches the skill ---
  console.log("\n[(3b) no declines without reaching the skill]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_clear_3b" });
    seedWardrobe(cat);
    const loop = freshLoop(cat);
    const t1 = await loop.handleTurn({ message: "clear my wardrobe", hasImage: false });
    assert.strictEqual(t1.skill, "delete_wardrobe_item", "ask routes, got " + t1.skill);
    assert.ok(/Say yes to clear it all/i.test(t1.text), "ask through the loop");
    const loop3 = AgenticLoop.createAgenticLoop({ catalog: cat, router: Router, summariser: null });
    const t3 = await loop3.handleTurn({ message: "no", hasImage: false });
    assert.notStrictEqual(t3.skill, "delete_wardrobe_item",
      "a decline never routes back to the skill, got " + t3.skill);
    assert.strictEqual(cat.getActivePieces().length, 9, "nothing deleted on decline");
    assert.strictEqual(cat.getPieces({ status: "held" }).length, 1, "held kept on decline");
    console.log("  pass: 'no' falls through, wardrobe untouched");
  }

  // --- (4) after a clear, revise_look never references removed pieces ---
  // (revise_look's lastValidLook already requires every core id to still
  // resolve to an ACTIVE piece, so a cleared core reads as no current
  // look — pinned here either way, per spec.)
  console.log("\n[(4) revise after clear]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_clear_4" });
    seedWardrobe(cat);
    const ids = cat.getActivePieces().map((p) => p.piece_id);
    // A woven look on record over pieces the clear is about to remove
    // (their colours must never resurface in revise replies afterwards).
    cat.recordTurn({
      userText: "make me a look",
      proposal: { pieces: ids.slice(0, 3), extras: [], title: null, note: "valid:layer" },
      verdict: true, reasons: ["look:woven"],
    });
    await DeleteItem.handle({ catalog: cat, text: "clear my wardrobe" });
    resolveQuestions(cat);
    const done = await DeleteItem.handle({ catalog: cat, text: "yes" });
    assert.ok(/all 10 pieces are out/i.test(done.text), "clear done, got: " + done.text);
    assert.strictEqual(cat.getActivePieces().length, 0, "wardrobe fully cleared");
    const wearing = await Revise.handle({ catalog: cat, text: "show me wearing it" });
    assert.ok(/No saved look to render just yet/i.test(wearing.text),
      "honest no-current-look, got: " + wearing.text);
    for (const colour of ["pink", "cream", "red", "blue", "gold", "brown", "black", "teal", "white", "lilac"]) {
      assert.ok(!new RegExp(colour).test(wearing.text),
        "removed " + colour + " never listed, got: " + wearing.text);
    }
    const addBag = await Revise.handle({ catalog: cat, text: "add my bag" });
    assert.ok(/no bag in your wardrobe yet/i.test(addBag.text),
      "honest no-bag, got: " + addBag.text);
    assert.ok(!/brown|black/.test(addBag.text), "removed bags never listed, got: " + addBag.text);
    noSynthLeak(wearing.text, "render follow-up");
    noSynthLeak(addBag.text, "add-bag follow-up");
    console.log("  pass: wearing + add-bag honest, removed pieces never surface");
  }

  // --- (5) re-sharing after a clear catalogues anew; same-share replay idempotent ---
  console.log("\n[(5) reshare after clear]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_clear_5" });
    const img = tinyPngDataUrl();
    const client = multiDetectClient();
    const r1 = await Catalogue.handle({
      catalog: cat, text: "", imageDataUrl: img,
      shareId: "SYNTH_share_resplash_1", metaClient: client, pendingBag: {},
    });
    assert.ok(r1.pendingBag && r1.pendingBag.regions.length === 3, "bag held");
    await Catalogue.handle({
      catalog: cat, text: "yes", imageDataUrl: null,
      metaClient: client, pendingBag: r1.pendingBag,
    });
    assert.strictEqual(cat.getActivePieces().length, 3, "3 pieces catalogued");
    const firstIds = cat.getActivePieces().map((p) => p.piece_id).sort();
    await DeleteItem.handle({ catalog: cat, text: "clear my wardrobe" });
    resolveQuestions(cat);
    await DeleteItem.handle({ catalog: cat, text: "yes" });
    assert.strictEqual(cat.getActivePieces().length, 0, "cleared");
    // Re-share the IDENTICAL photo under a NEW share id: the rejected
    // pieces' crop_hashes must not dedupe it away.
    const r2 = await Catalogue.handle({
      catalog: cat, text: "", imageDataUrl: img,
      shareId: "SYNTH_share_resplash_2", metaClient: client, pendingBag: {},
    });
    assert.ok(r2.pendingBag && r2.pendingBag.regions.length === 3,
      "same photo re-asked, got: " + r2.text.slice(0, 120));
    const rYes = await Catalogue.handle({
      catalog: cat, text: "yes", imageDataUrl: null,
      metaClient: client, pendingBag: r2.pendingBag,
    });
    assert.ok(/pieces in/i.test(rYes.text), "new pieces added, got: " + rYes.text.slice(0, 120));
    const secondIds = cat.getActivePieces().map((p) => p.piece_id).sort();
    assert.strictEqual(secondIds.length, 3, "3 NEW active pieces, got " + secondIds.length);
    for (const id of secondIds) {
      assert.ok(firstIds.indexOf(id) === -1, id + " is a new piece, not a rejected revival");
    }
    // Replaying the SAME share id still does not double-add (per-share
    // idempotency intact: the live piece with that share id guards it).
    const rDup = await Catalogue.handle({
      catalog: cat, text: "", imageDataUrl: img,
      shareId: "SYNTH_share_resplash_2", metaClient: client, pendingBag: {},
    });
    assert.ok(/already in your wardrobe/i.test(rDup.text),
      "same-share replay idempotent, got: " + rDup.text.slice(0, 120));
    assert.strictEqual(cat.getActivePieces().length, 3, "still exactly 3, no double-add");
    console.log("  pass: reshare catalogues anew; same-share replay idempotent");
  }

  // --- (5b) cleared share-id replay stays idempotent; new share id re-catalogues ---
  console.log("\n[(5b) cleared share replay]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_clear_5b" });
    const img = tinyPngDataUrl();
    const singleClient = {
      detectGarments: async function () {
        return {
          placeholder: false, pieces: [
            { category: "dress", attributes: { color: "red" }, bbox: [0.1, 0.1, 0.3, 0.3] }
          ]
        };
      },
      classify: async function () { return { category: "dress" }; },
      segment: async function () { return { boxes: [] }; }
    };
    const rA = await Catalogue.handle({
      catalog: cat, text: "", imageDataUrl: img,
      shareId: "SYNTH_share_replay_A", metaClient: singleClient, pendingBag: {},
    });
    assert.ok(rA.pendingBag && rA.pendingBag.regions.length === 1,
      "share A asked, got: " + String(rA.text).slice(0, 120));
    await Catalogue.handle({
      catalog: cat, text: "yes", imageDataUrl: null,
      metaClient: singleClient, pendingBag: rA.pendingBag,
    });
    assert.strictEqual(cat.getActivePieces().length, 1, "share A catalogued 1 piece");
    const firstId = cat.getActivePieces()[0].piece_id;
    await DeleteItem.handle({ catalog: cat, text: "clear my wardrobe" });
    resolveQuestions(cat);
    await DeleteItem.handle({ catalog: cat, text: "yes" });
    assert.strictEqual(cat.getActivePieces().length, 0, "cleared");
    // Replaying share A (e.g. service restart walking share history)
    // must not resurrect the rejected piece.
    const rReplay = await Catalogue.handle({
      catalog: cat, text: "", imageDataUrl: img,
      shareId: "SYNTH_share_replay_A", metaClient: singleClient, pendingBag: {},
    });
    assert.ok(/already in your wardrobe/i.test(rReplay.text),
      "replayed share A idempotent, got: " + String(rReplay.text).slice(0, 120));
    assert.ok(!rReplay.pendingBag, "no new bag on replay");
    assert.strictEqual(cat.getActivePieces().length, 0, "replay resurrects nothing");
    // The SAME photo under a NEW share id catalogues 1 fresh piece.
    const rB = await Catalogue.handle({
      catalog: cat, text: "", imageDataUrl: img,
      shareId: "SYNTH_share_replay_B", metaClient: singleClient, pendingBag: {},
    });
    assert.ok(rB.pendingBag && rB.pendingBag.regions.length === 1,
      "new share B re-asked, got: " + String(rB.text).slice(0, 120));
    await Catalogue.handle({
      catalog: cat, text: "yes", imageDataUrl: null,
      metaClient: singleClient, pendingBag: rB.pendingBag,
    });
    const after = cat.getActivePieces();
    assert.strictEqual(after.length, 1, "new share catalogued 1 active piece, got " + after.length);
    assert.notStrictEqual(after[0].piece_id, firstId, "fresh piece, not a rejected revival");
    noSynthLeak(rReplay.text, "replay reply");
    console.log("  pass: cleared share replay idempotent; new share id catalogues 1 piece");
  }

  // --- (5c) singular clear-all wording: no "all 1 piece" / "1 piece are" ---
  console.log("\n[(5c) singular clear wording]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_clear_5c" });
    cat.addPiece({
      category: "dress", attributes: { color: "red" },
      source_share_id: "SYNTH_clear_single",
      photo_thumb: "data:image/png;base64,SYNTH_clear_thumb_1",
    });
    const ask = await DeleteItem.handle({ catalog: cat, text: "clear my wardrobe" });
    assert.ok(!/all 1 piece/.test(ask.text), "ask avoids 'all 1 piece', got: " + ask.text);
    assert.ok(!/1 piece are/.test(ask.text), "ask avoids '1 piece are', got: " + ask.text);
    assert.ok(/your 1 piece \(1 dress\)/.test(ask.text),
      "ask names your 1 piece (1 dress), got: " + ask.text);
    noSynthLeak(ask.text, "singular ask reply");
    resolveQuestions(cat);
    const done = await DeleteItem.handle({ catalog: cat, text: "yes" });
    assert.ok(!/all 1 piece/.test(done.text), "done avoids 'all 1 piece', got: " + done.text);
    assert.ok(!/1 piece are/.test(done.text), "done avoids '1 piece are', got: " + done.text);
    assert.ok(/1 piece is out/.test(done.text),
      "done reads '1 piece is out', got: " + done.text);
    assert.strictEqual(cat.getActivePieces().length, 0, "wardrobe cleared");
    noSynthLeak(done.text, "singular done reply");
    console.log("  pass: singular ask/done grammatical, plural untouched");
  }

  // --- (6) shoes: delete routes + lists, show views ---
  console.log("\n[(6) shoes]");
  {
    assert.strictEqual(Router.classifySync({ text: "delete my shoes" }).skill,
      "delete_wardrobe_item", "delete my shoes routes to the delete skill");
    assert.strictEqual(Router.classifySync({ text: "show my shoes" }).skill,
      "view_wardrobe_item", "show my shoes routes to the view skill");
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_clear_6" });
    cat.addPiece({
      category: "shoes", attributes: { color: "white" },
      source_share_id: "SYNTH_clear_shoes",
      photo_thumb: "data:image/png;base64,SYNTH_clear_thumb_sh",
    });
    const r = await DeleteItem.handle({ catalog: cat, text: "delete my shoes" });
    assert.ok(/white shoes/.test(r.text), "shoes piece listed, got: " + r.text);
    assert.strictEqual(r.image, null, "text-only");
    noSynthLeak(r.text, "shoes list reply");
    console.log("  pass: delete/show my shoes route and list like other categories");
  }

  console.log("\nAll clear-wardrobe tests passed.");
}

if (require.main === module) {
  run().then(
    () => {},
    (e) => { console.error("FAIL:", e && e.message ? e.message : e); process.exit(1); }
  );
}

module.exports = { run };
