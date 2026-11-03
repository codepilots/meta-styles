"use strict";
/* meta-styles — view_wardrobe_item regression tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Two-step wardrobe viewing: Step A lists up to 5 numbered pieces of a
 * named category (ACTIVE only); Step B resolves a bare number to that
 * piece's own STORED photo, paginates on "show more", or re-prompts
 * honestly on anything else while keeping the list context alive.
 *
 *   (1) >5 dresses lists exactly 5, numbered, with the "show more" invite.
 *   (2) <=5 dresses lists them all with NO "show more" invite.
 *   (3) bare "1" resolves the first piece, returns its image_original,
 *       imageDelivery.delivered true, caption = list description.
 *   (4) a piece with no image_original falls back to photo_thumb.
 *   (5) "show more" returns the NEXT 5, not the same 5 again.
 *   (6) out-of-range "9" with 5 shown re-prompts honestly, no crash/pick.
 *   (7) garbled reply re-prompts and keeps the list context alive.
 *   (8) only ACTIVE pieces (never held/pending) are ever listed or sent.
 *   Plus: router triggers, fail-closed list-context contract, expiry, and
 *   the full pending-expectation loop ("1" routes back to the skill).
 *
 * Real in-memory catalog + real heuristic router throughout (metaClient
 * is always null, so the live-Spark path is never attempted) — no
 * network, no sends. All ids synthetic (SYNTH_ prefix) — never real data.
 *
 * Run: node app/test/view-wardrobe-item.test.js
 */
const assert = require("node:assert");
const AgenticLoop = require("../agentic-loop.js");
const Router = require("../router.js");
const Wardrobe = require("../wardrobe-catalog.js");
const ViewItem = require("../skills/view_wardrobe_item/handler.js");

function thumb(n) { return "data:image/png;base64,SYNTH_view_thumb_" + n; }
function orig(n) { return "data:image/png;base64,SYNTH_view_orig_" + n; }

function seedDresses(cat, count, opts) {
  const o = opts || {};
  const colors = ["pink", "cream", "red", "blue", "green", "black", "white", "gold"];
  for (let i = 0; i < count; i++) {
    const piece = { category: "dress", attributes: { color: colors[i % colors.length] }, source_share_id: "SYNTH_share_view_" + i };
    if (!o.noImages) {
      piece.photo_thumb = thumb(i);
      if (!o.thumbOnly || i !== (o.thumbOnlyIndex || 0)) piece.image_original = orig(i);
    }
    if (o.thumbOnly && i === (o.thumbOnlyIndex || 0)) piece.photo_thumb = thumb(i);
    cat.addPiece(piece);
  }
}

function noSynthLeak(text, label) {
  assert.ok(!/SYNTH_/.test(text), label + " must not leak SYNTH_ ids: " + String(text).slice(0, 200));
}

function freshLoop(catalog) {
  return AgenticLoop.createAgenticLoop({ catalog: catalog, router: Router, summariser: null });
}

async function run() {
  console.log("view-wardrobe-item.test.js");

  // --- (1) >5 dresses: exactly 5, numbered, "show more" invite ---
  console.log("\n[(1) category list pages at 5 with invitation]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_view_1" });
    seedDresses(cat, 7);
    const r = await ViewItem.handle({ catalog: cat, text: "show me the dresses" });
    assert.strictEqual(r.skill, "view_wardrobe_item", "skill tagged");
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
    assert.strictEqual(ctx.category, "dress", "context category");
    assert.deepStrictEqual(ctx.piece_ids,
      ["SYNTH_piece_001", "SYNTH_piece_002", "SYNTH_piece_003", "SYNTH_piece_004", "SYNTH_piece_005"]);
    assert.strictEqual(ctx.offset, 0, "first-page offset");
    const pend = cat.getPendingQuestions();
    assert.strictEqual(pend.length, 1, "one pending question recorded");
    assert.strictEqual(pend[0].skill, "view_wardrobe_item", "pending skill");
    assert.strictEqual(pend[0].expects, "text", "pending expects text");
    noSynthLeak(r.text, "list reply");
    console.log("  pass: 5 numbered dresses + invite, context + expectation recorded");
  }

  // --- (2) <=5 dresses: no "show more" invite ---
  console.log("\n[(2) short list ends naturally]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_view_2" });
    seedDresses(cat, 3);
    const r = await ViewItem.handle({ catalog: cat, text: "see my dresses" });
    assert.ok(!/show more/i.test(r.text), "no 'show more' invite for 3 dresses: " + r.text);
    assert.ok(/^1\. pink dress$/m.test(r.text), "numbered entries present");
    assert.ok(/^3\. red dress$/m.test(r.text), "third entry present");
    noSynthLeak(r.text, "short list reply");
    console.log("  pass: 3 dresses listed, no invite");
  }

  // --- (3) bare "1" sends image_original with delivered:true + caption ---
  console.log("\n[(3) bare number sends the stored original]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_view_3" });
    seedDresses(cat, 7);
    await ViewItem.handle({ catalog: cat, text: "show me the dresses" });
    let stagedWith = null;
    const r = await ViewItem.handle({
      catalog: cat, text: "1",
      shareId: "SYNTH_share_view_pick", stageImage: async (sid, durl) => { stagedWith = [sid, durl]; return { ok: true }; },
    });
    assert.ok(r.image, "image returned");
    assert.strictEqual(r.image.dataURL, orig(0), "image_original sent as-is");
    assert.strictEqual(stagedWith[0], "SYNTH_share_view_pick", "staged under the share id");
    assert.strictEqual(stagedWith[1], orig(0), "staged bytes are the stored original");
    assert.strictEqual(r.image.caption, "pink dress", "caption matches the list description");
    assert.ok(/pink dress/.test(r.text), "reply names the piece");
    assert.deepStrictEqual(r.meta.imageDelivery,
      { requested: true, generated: false, delivered: true, reason: "staged for send with image" });
    assert.ok(!/SYNTH_/.test(r.image.caption), "caption leaks no ids");
    assert.strictEqual(cat.getListContext(), null, "successful pick clears the list context");
    noSynthLeak(r.text, "pick reply");
    console.log("  pass: image_original staged + delivered, caption correct, context cleared");
  }

  // --- (4) no image_original falls back to photo_thumb ---
  console.log("\n[(4) thumb fallback]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_view_4" });
    seedDresses(cat, 2, { thumbOnly: true, thumbOnlyIndex: 0 });
    await ViewItem.handle({ catalog: cat, text: "show me the dresses" });
    const r = await ViewItem.handle({
      catalog: cat, text: "1",
      shareId: "SYNTH_share_view_thumb", stageImage: async () => ({ ok: true }),
    });
    assert.ok(r.image, "image returned");
    assert.strictEqual(r.image.dataURL, thumb(0), "photo_thumb sent when no original stored");
    assert.strictEqual(r.meta.imageDelivery.delivered, true, "delivered true");
    assert.strictEqual(r.meta.imageDelivery.generated, false, "nothing generated");
    console.log("  pass: photo_thumb fallback staged + delivered");
  }

  // --- (5) "show more" returns the NEXT 5 ---
  console.log("\n[(5) pagination]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_view_5" });
    seedDresses(cat, 7);
    const first = await ViewItem.handle({ catalog: cat, text: "show me the dresses" });
    const second = await ViewItem.handle({ catalog: cat, text: "show more" });
    assert.ok(!/pink dress/.test(second.text), "next page is not the same 5 again");
    assert.ok(/black dress/.test(second.text), "sixth dress shown, got: " + second.text);
    assert.ok(/white dress/.test(second.text), "seventh dress shown");
    assert.ok(/^1\. black dress$/m.test(second.text), "next page renumbered from 1");
    const ctx = cat.getListContext();
    assert.strictEqual(ctx.offset, 5, "cursor advanced");
    assert.deepStrictEqual(ctx.piece_ids, ["SYNTH_piece_006", "SYNTH_piece_007"]);
    noSynthLeak(second.text, "second page");
    assert.ok(/show more/i.test(first.text), "first page invited more");
    assert.ok(!/show more/i.test(second.text), "last page ends naturally");
    console.log("  pass: next page shown, cursor advanced, last page ends naturally");
  }

  // --- (6) out-of-range number: honest re-prompt, no crash, no pick ---
  console.log("\n[(6) out-of-range number]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_view_6" });
    seedDresses(cat, 7);
    await ViewItem.handle({ catalog: cat, text: "show me the dresses" });
    // The loop consumes the pending question before routing back; mimic that.
    cat.getPendingQuestions().forEach((q) => cat.resolveQuestion(q.id));
    const r = await ViewItem.handle({ catalog: cat, text: "9" });
    assert.strictEqual(r.image, null, "no image on a bad pick");
    assert.ok(/only showed 5/i.test(r.text) || /1 to 5/.test(r.text),
      "honest range re-prompt, got: " + r.text);
    assert.ok(/pink dress/.test(r.text), "current page restated");
    assert.ok(cat.getListContext(), "context kept alive after a bad pick");
    assert.strictEqual(cat.getPendingQuestions().length, 1, "expectation re-recorded");
    noSynthLeak(r.text, "range re-prompt");
    console.log("  pass: honest re-prompt, context alive");
  }

  // --- (7) garbled reply: re-prompts, keeps context alive ---
  console.log("\n[(7) garbled reply stays in flow]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_view_7" });
    seedDresses(cat, 7);
    await ViewItem.handle({ catalog: cat, text: "show me the dresses" });
    // The loop consumes the pending question before routing back; mimic that.
    cat.getPendingQuestions().forEach((q) => cat.resolveQuestion(q.id));
    const before = cat.getListContext();
    const r = await ViewItem.handle({ catalog: cat, text: "hmm, lovely weather today" });
    assert.ok(/didn.t catch a number/i.test(r.text), "honest miss re-prompt, got: " + r.text);
    assert.ok(/pink dress/.test(r.text), "live list restated");
    const after = cat.getListContext();
    assert.ok(after, "list context still live");
    assert.deepStrictEqual(after.piece_ids, before.piece_ids, "same page still live");
    assert.strictEqual(cat.getPendingQuestions().length, 1, "expectation re-recorded, not dropped");
    noSynthLeak(r.text, "garbled re-prompt");
    console.log("  pass: garbled reply re-prompts, same page live");
  }

  // --- (8) only ACTIVE pieces listed or sent (held stays hidden) ---
  console.log("\n[(8) held pieces never listed or sent]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_view_8" });
    seedDresses(cat, 2);
    cat.addPiece({
      category: "dress", attributes: { color: "held-purple" },
      source_share_id: "SYNTH_share_view_held",
      photo_thumb: thumb("held"), image_original: orig("held"),
      status: "held", held_until: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
    const r = await ViewItem.handle({ catalog: cat, text: "show me the dresses" });
    assert.ok(!/held-purple/.test(r.text), "held piece never listed: " + r.text);
    const ctx = cat.getListContext();
    assert.ok(ctx.piece_ids.every((id) => {
      const p = cat.getPiece(id);
      return p && p.status === "active";
    }), "context holds active ids only");
    // Only the two active dresses exist: picking "2" resolves the second
    // active dress, never the held one.
    const pick = await ViewItem.handle({
      catalog: cat, text: "2",
      shareId: "SYNTH_share_view_8", stageImage: async () => ({ ok: true }),
    });
    assert.ok(/cream dress/.test(pick.text), "picks the active piece, got: " + pick.text);
    assert.strictEqual(pick.image.dataURL, orig(1), "sends the active piece photo");
    console.log("  pass: held piece invisible to list and pick");
  }

  // --- router: category triggers hit view_wardrobe_item; bare "1" clarifies stateless ---
  console.log("\n[(router) triggers]");
  {
    for (const msg of ["show me the dresses", "show the cardigans", "see my tops",
        "show me my bags", "see my scarves", "show me the blazers", "show my bottoms"]) {
      const d = Router.classifySync({ text: msg });
      assert.strictEqual(d.skill, "view_wardrobe_item", JSON.stringify(msg) + " -> " + d.skill);
    }
    // No regression on neighbours.
    assert.strictEqual(Router.classifySync({ text: "what do I have in my wardrobe?" }).skill,
      "describe_wardrobe", "describe_wardrobe trigger kept");
    assert.strictEqual(Router.classifySync({ text: "show me a look please" }).skill,
      "propose_look", "propose_look trigger kept");
    console.log("  pass: 7 plurals route, neighbours kept");
  }

  // --- catalog unit: fail-closed list context + expiry ---
  console.log("\n[(catalog) list-context contract]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_view_9" });
    assert.strictEqual(cat.getListContext(), null, "no context initially");
    assert.throws(() => cat.setListContext({
      skill: "view_wardrobe_item", category: "dress",
      piece_ids: ["SYNTH_piece_001"], offset: 0,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(), bogus: 1,
    }), /rejected key/, "unknown key rejected");
    assert.throws(() => cat.setListContext({
      skill: "view_wardrobe_item", category: "hat",
      piece_ids: [], offset: 0,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    }), /category/, "non-taxonomy category rejected");
    assert.throws(() => cat.setListContext({
      skill: "view_wardrobe_item", category: "dress",
      piece_ids: [], offset: -1,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    }), /offset/, "negative offset rejected");
    assert.throws(() => cat.setListContext({
      skill: "view_wardrobe_item", category: "dress",
      piece_ids: [], offset: 0, expires_at: "soon",
    }), /expires_at/, "non-ISO expiry rejected");
    // Expired context reads as none and clears.
    cat.setListContext({
      skill: "view_wardrobe_item", category: "dress",
      piece_ids: ["SYNTH_piece_001"], offset: 0,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    assert.strictEqual(cat.getListContext(), null, "expired context reads as none");
    console.log("  pass: fail-closed rejects + expiry clears");
  }

  // --- full loop: list, then bare "1" routes back via the pending expectation ---
  console.log("\n[(loop) bare number routes back to the skill]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_view_10" });
    seedDresses(cat, 6);
    const loop = freshLoop(cat);
    const t1 = await loop.handleTurn({ message: "show me the dresses", hasImage: false });
    assert.strictEqual(t1.skill, "view_wardrobe_item", "list routes, got " + t1.skill);
    assert.strictEqual(cat.getPendingQuestions().length, 1, "expectation stands after the list");
    const oldId = cat.getPendingQuestions()[0].id;
    // Stateless, a bare "1" is too short to classify — only the pending
    // state diverts it back into the skill.
    assert.ok(Router.classifySync({ text: "1" }).confidence < 70,
      "bare digit alone never classifies");
    let staged = null;
    const loop2 = AgenticLoop.createAgenticLoop({
      catalog: cat, router: Router, summariser: null,
      stageImage: async (sid, durl) => { staged = durl; return { ok: true }; },
    });
    const t2 = await loop2.handleTurn({
      message: "1", hasImage: false, shareId: "SYNTH_share_view_10",
    });
    assert.strictEqual(t2.skill, "view_wardrobe_item", "bare 1 routes back, got " + t2.skill);
    assert.ok(/pending expectation satisfied/.test(t2.decision.reason),
      "decision names the pending path: " + t2.decision.reason);
    assert.ok(cat.getPendingQuestions().every((q) => q.id !== oldId), "old pending consumed");
    assert.strictEqual(t2.handlerResult.image.dataURL, orig(0), "stored original returned through the loop");
    assert.strictEqual(t2.handlerResult.meta.imageDelivery.delivered, true, "delivered true through the loop");
    assert.strictEqual(staged, orig(0), "staged bytes are the stored original");
    assert.strictEqual(cat.getListContext(), null, "context cleared after the pick");
    noSynthLeak(t2.text, "loop pick reply");
    console.log("  pass: bare 1 answered with the stored photo, flow closed");
  }

  console.log("\nAll view-wardrobe-item tests passed.");
}

if (require.main === module) {
  run().then(
    () => {},
    (e) => { console.error("FAIL:", e && e.message ? e.message : e); process.exit(1); }
  );
}

module.exports = { run };
