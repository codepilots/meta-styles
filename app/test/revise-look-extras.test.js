"use strict";
/* meta-styles — revise_look user-chosen extras tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Automatic looks stay fully fit-governed (at most 4 pieces, strictShape);
 * the USER may explicitly add further pieces on top. Those additions are
 * "extras": user-chosen, never fit-checked, recorded on proposal.extras,
 * and the reply never claims they passed the fit check.
 *   (a) dress+scarf+bag look + "add my cardigan" -> core kept, cardigan
 *       is an extra (layer+scarf/bag fails strictShape); reply scopes the
 *       fit check to the core only;
 *   (b) dress+cardigan + "add my bag" -> extra bag; then "add my shoes"
 *       (a real catalogued shoes piece) -> two extras; then
 *       "show me wearing it" (consented profile stub) -> preview stub
 *       gets headshot, full-body and ONE composite sheet; the prompt
 *       names headshot, full-body, dress, cardigan, bag, shoes and the
 *       full look including shoes;
 *   (c) dress+cardigan core (top/bottom-free wardrobe) + "add my scarf"
 *       -> extra; "remove the scarf" -> scarf dropped, core unchanged,
 *       no re-weave (reasons prove the extra-drop path);
 *   (d) an ADD that yields a valid core (seeded base/top+scarf look +
 *       "add my bag") becomes core with "Fit check: valid";
 *   (e) shoes vocabulary: router sends "add my shoes" style text to
 *       revise_look; matchAdd/matchRevise name the shoes category;
 *   (f) proposal.extras validation: bogus keys throw, pieceless
 *       (null piece_id) and off-taxonomy entries throw, real-piece
 *       extras record fine, extras-less proposals still record;
 *   (g) propose_look still caps at 4 pieces and can never include shoes
 *       (fallback skips shoes; a stubbed Spark assemble that wrongly
 *       includes the shoes id is rejected and the fallback ships
 *       instead);
 *   (h) with no shoes piece catalogued, "add my shoes" answers honestly
 *       (no shoes in the wardrobe yet, share a photo), records no
 *       extra, and never claims the shoes were added;
 *   (i) removing shoes from a look drops just the extra;
 *   (j) view/delete wardrobe item can list a shoes piece like any
 *       other category.
 * All catalogs/ids/images synthetic (SYNTH_ ids, locally generated 1x1
 * PNGs via the repo's own encoder) — never real data. No network.
 *
 * Run: node app/test/revise-look-extras.test.js
 */
const assert = require("node:assert");
const PhotoThumb = require("../photo-thumb.js");
const Wardrobe = require("../wardrobe-catalog.js");
const Revise = require("../skills/revise_look/handler.js");
const Propose = require("../skills/propose_look/handler.js");
const ViewItem = require("../skills/view_wardrobe_item/handler.js");
const DeleteItem = require("../skills/delete_wardrobe_item/handler.js");
const Router = require("../router.js");

// Locally generated 1x1 PNGs (solid colours, distinct bytes). Synthetic.
function png1(r, g, b) {
  return "data:image/png;base64," +
    Buffer.from(PhotoThumb.encodePng(1, 1, new Uint8Array([r, g, b]))).toString("base64");
}
const HS = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const FB = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMINAAAABJRU5ErkJggg==";
const PREVIEW_DURL = png1(7, 7, 7);

function seed(tag, cats, thumbs) {
  const cat = Wardrobe.createCatalog({ userKey: "SYNTH_extra_" + tag });
  cats.forEach(function (c, i) {
    const input = { category: c, attributes: {}, source_share_id: "SYNTH_share_extra_" + tag + "_" + i };
    if (thumbs) input.photo_thumb = png1((i * 60) % 256, (i * 90 + 40) % 256, (i * 30 + 120) % 256);
    cat.addPiece(input);
  });
  return cat;
}

function idsByCat(cat) {
  const map = {};
  cat.getActivePieces().forEach(function (p) { map[p.category] = p.piece_id; });
  return map;
}

function catsOf(cat, ids) {
  const byId = {};
  cat.getActivePieces().forEach(function (p) { byId[p.piece_id] = p; });
  return ids.map(function (id) { return byId[id] ? byId[id].category : "?"; });
}

function noFabrication(result, label) {
  const dumped = JSON.stringify(result);
  assert.ok(!/example\.invalid/.test(dumped), label + " must contain no example.invalid");
  assert.ok(!/SYNTH_piece_/.test(result.text), label + " reply names no piece ids: " + result.text.slice(0, 160));
}

function assertMetaContract(r, label) {
  assert.ok(r.meta && r.meta.imageDelivery, label + ": imageDelivery nested under meta");
  assert.ok(!("imageDelivery" in r), label + ": no top-level imageDelivery");
}

async function run() {
  console.log("revise-look-extras.test.js");

  // --- (a) dress+scarf+bag + add cardigan -> extra, honest reply ---
  console.log("\n[(a) current look keeps core, cardigan rides on top]");
  {
    const cat = seed("a", ["dress", "scarf", "bag", "layer/cardigan"]);
    const ids = idsByCat(cat);
    cat.recordTurn({ userText: "seed", proposal: { pieces: [ids["dress"], ids["scarf"], ids["bag"]] }, verdict: true, reasons: [] });
    const r = await Revise.handle({ catalog: cat, text: "add my cardigan", metaClient: null });
    const t = cat.getTurns()[1];
    assert.strictEqual(t.verdict, true, "extra turn keeps a valid verdict: " + r.text.slice(0, 120));
    assert.deepStrictEqual(t.proposal.pieces, [ids["dress"], ids["scarf"], ids["bag"]],
      "core unchanged: " + catsOf(cat, t.proposal.pieces).join("+"));
    assert.strictEqual(t.proposal.extras.length, 1, "one extra recorded");
    assert.strictEqual(t.proposal.extras[0].category, "layer/cardigan", "cardigan is the extra");
    assert.strictEqual(t.proposal.extras[0].piece_id, ids["layer/cardigan"], "extra names the piece");
    assert.ok(t.reasons.indexOf("added:layer/cardigan") !== -1, "add reason kept");
    assert.ok(t.reasons.indexOf("extra:layer/cardigan") !== -1, "extra reason kept");
    assert.ok(/Added your cardigan on top/.test(r.text), "honest extra copy: " + r.text.slice(0, 100));
    assert.ok(!/Fit check: valid/.test(r.text), "no fit-check claim over the extra");
    assert.ok(/fit check covers your dress \+ scarf \+ bag only/.test(r.text),
      "fit check scoped to the core: " + r.text.slice(0, 160));
    assertMetaContract(r, "extra add");
    noFabrication(r, "extra add");
    console.log("  pass: core kept, cardigan extra, reply honest");
  }

  // --- (b) bag extra, then real-piece shoes extra, then render on user ---
  console.log("\n[(b) two extras ride the render: headshot + full-body + one sheet]");
  {
    const cat = seed("b", ["dress", "layer/cardigan", "bag", "shoes"], true);
    const ids = idsByCat(cat);
    const r0 = await Propose.handle({ catalog: cat, text: "show me a look", metaClient: null });
    const t0 = cat.getTurns()[0];
    assert.deepStrictEqual(catsOf(cat, t0.proposal.pieces), ["dress", "layer/cardigan"],
      "setup core is dress+cardigan: " + r0.text.slice(0, 100));
    const r1 = await Revise.handle({ catalog: cat, text: "add my bag", metaClient: null });
    const t1 = cat.getTurns()[1];
    assert.deepStrictEqual(catsOf(cat, t1.proposal.pieces), ["dress", "layer/cardigan"], "core kept after bag add");
    assert.strictEqual(t1.proposal.extras.length, 1, "bag recorded as extra");
    assert.strictEqual(t1.proposal.extras[0].category, "bag", "extra is the bag");
    assert.ok(/Added your bag on top/.test(r1.text), "bag extra copy: " + r1.text.slice(0, 100));
    assert.ok(!/Fit check: valid/.test(r1.text), "no fit-check claim over the bag");
    const r2 = await Revise.handle({ catalog: cat, text: "add my shoes", metaClient: null });
    const t2 = cat.getTurns()[2];
    assert.deepStrictEqual(catsOf(cat, t2.proposal.pieces), ["dress", "layer/cardigan"], "core kept after shoes add");
    assert.strictEqual(t2.proposal.extras.length, 2, "two extras now");
    assert.strictEqual(t2.proposal.extras[0].category, "bag", "bag still first");
    assert.strictEqual(t2.proposal.extras[1].category, "shoes", "shoes second");
    assert.strictEqual(t2.proposal.extras[1].piece_id, ids["shoes"], "shoes extra names the real piece");
    assert.ok(/Added your shoes on top/.test(r2.text), "shoes extra copy: " + r2.text.slice(0, 100));

    cat.setProfileConsent(true);
    cat.setProfileReference("headshot", HS);
    cat.setProfileReference("full_body", FB);
    const seen = [];
    const mc = {
      preview: async function (prompt, images) {
        seen.push({ prompt: prompt, images: Array.isArray(images) ? images.slice() : images });
        return { dataURL: PREVIEW_DURL };
      }
    };
    const r3 = await Revise.handle({ catalog: cat, metaClient: mc, text: "show me wearing it", preferences: "" });
    assert.strictEqual(seen.length, 1, "preview called once, got " + seen.length);
    const sent = seen[0].images;
    assert.ok(Array.isArray(sent) && sent.length === 3,
      "headshot + full-body + ONE composite sheet, got " + (Array.isArray(sent) ? sent.length : typeof sent));
    assert.ok(sent.every(function (u) { return /^data:image\//.test(u); }), "all three are data URLs");
    const prompt = seen[0].prompt;
    assert.ok(/Image 3 is a reference sheet of the 4 selected garments/.test(prompt),
      "sheet covers all 4 pictured garments: " + prompt.slice(0, 200));
    ["headshot", "full-body", "dress", "cardigan", "bag", "shoes"].forEach(function (word) {
      assert.ok(new RegExp(word).test(prompt), "prompt names " + word);
    });
    assert.ok(!/Only \d+ of \d+/.test(prompt), "no shortfall: every garment has a ref");
    assert.ok(/Plus your bag \+ shoes styled on top/.test(r3.text),
      "reply names extras on top: " + r3.text.slice(0, 200));
    assert.strictEqual(r3.meta && r3.meta.renderOnUser, true, "renders on the wearer");
    assert.strictEqual(r3.meta.referenceGarmentTotal, 4, "meta total counts core+extras");
    assert.strictEqual(r3.meta.referencePieces, 4, "meta pieces counts all pictured garments");
    assert.strictEqual(r3.meta.referenceMode, "composite", "meta names composite mode");
    const t3 = cat.getTurns()[3];
    assert.deepStrictEqual(catsOf(cat, t3.proposal.pieces), ["dress", "layer/cardigan"], "render turn keeps the core");
    assert.strictEqual(t3.proposal.extras.length, 2, "render turn keeps both extras");
    assertMetaContract(r3, "render with extras");
    noFabrication(r3, "render with extras");
    console.log("  pass: 3 images, full-look prompt, core+extras recorded");
  }

  // --- (c) extra-drop removal: no re-weave ---
  console.log("\n[(c) removing an extra-only category drops just the extra]");
  {
    const cat = seed("c", ["dress", "layer/cardigan", "scarf"]);
    const ids = idsByCat(cat);
    cat.recordTurn({ userText: "seed", proposal: { pieces: [ids["dress"], ids["layer/cardigan"]] }, verdict: true, reasons: [] });
    const ra = await Revise.handle({ catalog: cat, text: "add my scarf", metaClient: null });
    const ta = cat.getTurns()[1];
    assert.strictEqual(ta.proposal.extras.length, 1, "scarf recorded as extra");
    assert.strictEqual(ta.proposal.extras[0].category, "scarf", "extra is the scarf");
    assert.ok(/Added your scarf on top/.test(ra.text), "scarf extra copy");
    const rr = await Revise.handle({ catalog: cat, text: "remove the scarf", metaClient: null });
    const tr = cat.getTurns()[2];
    assert.strictEqual(tr.verdict, true, "drop keeps a valid verdict");
    assert.deepStrictEqual(tr.proposal.pieces, [ids["dress"], ids["layer/cardigan"]],
      "core unchanged (no re-weave)");
    assert.deepStrictEqual(tr.proposal.extras, [], "extra dropped");
    assert.deepStrictEqual(tr.reasons, ["removed_extra:scarf"],
      "reasons prove the extra-drop path: " + JSON.stringify(tr.reasons));
    assert.ok(/Set aside your scarf/.test(rr.text), "drop copy: " + rr.text.slice(0, 100));
    assert.ok(/still stand/.test(rr.text), "core-stands copy");
    assertMetaContract(rr, "extra drop");
    noFabrication(rr, "extra drop");
    console.log("  pass: scarf dropped, dress+cardigan untouched");
  }

  // --- (d) an ADD that yields a valid core becomes core ---
  console.log("\n[(d) valid addition joins the core with a fit check]");
  {
    const cat = seed("d", ["base/top", "scarf", "bag"]);
    const ids = idsByCat(cat);
    cat.recordTurn({ userText: "seed", proposal: { pieces: [ids["base/top"], ids["scarf"]] }, verdict: true, reasons: [] });
    const r = await Revise.handle({ catalog: cat, text: "add my bag", metaClient: null });
    const t = cat.getTurns()[1];
    assert.deepStrictEqual(catsOf(cat, t.proposal.pieces), ["base/top", "scarf", "bag"],
      "bag joins the core: " + catsOf(cat, t.proposal.pieces).join("+"));
    assert.deepStrictEqual(t.proposal.extras, [], "no extras on a valid add");
    assert.ok(/Fit check: valid/.test(r.text), "fit check claimed for the valid core");
    assert.ok(t.reasons.indexOf("added:bag") !== -1, "add reason kept");
    assert.ok(!t.reasons.some(function (x) { return /^extra:/.test(x); }), "no extra reasons");
    assert.strictEqual(r.persist.preferencesDelta, "Prefers with bag.", "preferences delta kept");
    assertMetaContract(r, "valid add");
    noFabrication(r, "valid add");
    console.log("  pass: top+scarf+bag core, fit check valid");
  }

  // --- (e) shoes vocabulary: router + matchers ---
  console.log("\n[(e) shoes reach revise_look]");
  {
    assert.strictEqual(Router.heuristicSkill({ text: "add my shoes" }).skill, "revise_look", "add-my-shoes routes");
    assert.strictEqual(Router.heuristicSkill({ text: "remove my boots" }).skill, "revise_look", "remove-my-boots routes");
    assert.strictEqual(Router.heuristicSkill({ text: "i'll wear my heels too" }).skill, "revise_look", "wear-heels-too routes");
    assert.strictEqual(Router.heuristicSkill({ text: "no cardigan this time" }).skill, "revise_look", "existing revise routing kept");
    assert.strictEqual(Revise.matchAdd("add my shoes"), "shoes", "matchAdd names shoes");
    assert.strictEqual(Revise.matchAdd("swap the scarf for the boots"), "shoes", "swap-for names shoes");
    assert.strictEqual(Revise.matchAdd("add my cardigan"), "layer/cardigan", "existing matchAdd kept");
    assert.strictEqual(Revise.matchRevise("remove my boots"), "shoes", "matchRevise names shoes");
    assert.strictEqual(Revise.matchRevise("add my shoes"), null, "pure add is no removal target");
    console.log("  pass: router + matchers name shoes");
  }

  // --- (f) proposal.extras validation is fail-closed: real pieces only ---
  console.log("\n[(f) extras validation]");
  {
    const cat = seed("f", ["dress", "shoes"]);
    const ids = idsByCat(cat);
    assert.throws(function () {
      cat.recordTurn({ userText: "x", proposal: { pieces: [], extras: [{ piece_id: "a", category: "bag", bogus: 1 }] }, verdict: true, reasons: [] });
    }, /rejected key/, "unknown extra key throws");
    assert.throws(function () {
      cat.recordTurn({ userText: "x", proposal: { pieces: [], extras: "bag" }, verdict: true, reasons: [] });
    }, /must be an array/, "non-array extras throws");
    assert.throws(function () {
      cat.recordTurn({ userText: "x", proposal: { pieces: [], extras: [{ piece_id: null, category: "shoes" }] }, verdict: true, reasons: [] });
    }, /non-empty string/, "pieceless (null piece_id) shoes extra throws");
    assert.throws(function () {
      cat.recordTurn({ userText: "x", proposal: { pieces: [], extras: [{ piece_id: ids["shoes"], category: "hat" }] }, verdict: true, reasons: [] });
    }, /fixed taxonomy term/, "off-taxonomy extra category throws");
    const ok1 = cat.recordTurn({ userText: "x", proposal: { pieces: [], extras: [{ piece_id: ids["shoes"], category: "shoes" }] }, verdict: true, reasons: [] });
    assert.strictEqual(ok1.proposal.extras[0].piece_id, ids["shoes"], "real-piece shoes extra records");
    const ok2 = cat.recordTurn({ userText: "y", proposal: { pieces: [], title: null, note: null }, verdict: false, reasons: ["x"] });
    assert.strictEqual(ok2.proposal.extras, undefined, "extras-less proposals still record");
    console.log("  pass: fail-closed extras, real pieces only");
  }

  // --- (g) propose_look still caps at 4 pieces and can never include shoes ---
  console.log("\n[(g) automatic looks stay capped and shoeless]");
  {
    const cat = seed("g", ["dress", "base/top", "base/bottom", "layer/cardigan", "layer/blazer", "scarf", "bag", "shoes"]);
    await Propose.handle({ catalog: cat, text: "show me a look", metaClient: null });
    const t = cat.getTurns()[0];
    assert.strictEqual(t.verdict, true, "a look validates even with shoes nearby");
    assert.ok(t.proposal.pieces.length <= 4, "at most 4 pieces, got " + t.proposal.pieces.length);
    const cats = catsOf(cat, t.proposal.pieces);
    assert.ok(cats.indexOf("shoes") === -1, "never shoes: " + cats.join("+"));
    console.log("  pass: " + cats.join("+") + " (" + cats.length + " pieces, no shoes)");
  }
  {
    const cat = seed("g2", ["dress", "layer/cardigan", "scarf", "bag", "shoes"], true);
    const ids = idsByCat(cat);
    let sparkSaw = null;
    const badSpark = {
      assemble: async function (pieces) {
        sparkSaw = pieces;
        return { looks: [{ pieceIds: [ids["dress"], ids["layer/cardigan"], ids["shoes"]], rationale: "SYNTH bad spark pick" }] };
      }
    };
    const r = await Propose.handle({ catalog: cat, text: "show me a look", metaClient: badSpark });
    const t = cat.getTurns()[0];
    assert.ok(Array.isArray(sparkSaw) && sparkSaw.every(function (p) { return p.category !== "shoes"; }),
      "Spark pool skips shoes: " + JSON.stringify((sparkSaw || []).map(function (p) { return p.category; })));
    assert.strictEqual(t.verdict, true, "fallback still weaves a look: " + r.text.slice(0, 120));
    assert.ok(t.proposal.pieces.indexOf(ids["shoes"]) === -1, "shoes id rejected, never shipped");
    assert.ok(t.proposal.pieces.length <= 4, "capped at 4, got " + t.proposal.pieces.length);
    assert.ok(t.reasons.some(function (x) { return /^spark_rejected:/.test(x); }),
      "spark rejection on record: " + JSON.stringify(t.reasons));
    assert.ok(!/SYNTH_bad/.test(r.text), "no trace of the bad pick in the reply");
    console.log("  pass: stubbed Spark shoes pick rejected, fallback shipped");
  }

  // --- (h) no shoes piece: honest no-shoes reply, no extra, no claim ---
  console.log("\n[(h) no shoes catalogued: honest reply, nothing recorded]");
  {
    const cat = seed("h", ["dress", "layer/cardigan"]);
    const ids = idsByCat(cat);
    cat.recordTurn({ userText: "seed", proposal: { pieces: [ids["dress"], ids["layer/cardigan"]] }, verdict: true, reasons: [] });
    const before = cat.getTurns().length;
    const r = await Revise.handle({ catalog: cat, text: "add my shoes", metaClient: null });
    const t = cat.getTurns()[cat.getTurns().length - 1];
    assert.strictEqual(t.verdict, false, "honest no-add is not a valid turn");
    assert.strictEqual(t.proposal, null, "record no extra");
    assert.ok(/no shoes in your wardrobe yet/i.test(r.text), "honest no-shoes reply: " + r.text.slice(0, 140));
    assert.ok(r.text.indexOf("\\") === -1, "no literal backslash escapes in reply: " + r.text.slice(0, 140));
    assert.ok(r.text.indexOf("✨") !== -1, "reply contains the sparkle character");
    assert.ok(/share a photo/i.test(r.text), "invites a photo");
    assert.ok(!/Added your shoes/.test(r.text), "never claims the shoes were added");
    assert.strictEqual(cat.getTurns().length, before + 1, "one honest turn recorded");
    assertMetaContract(r, "honest no-shoes");
    noFabrication(r, "honest no-shoes");
    console.log("  pass: honest no-shoes, no extra, no claim");
  }
  {
    const cat = seed("h2", ["dress", "shoes"]);
    const r = await Revise.handle({ catalog: cat, text: "add my shoes", metaClient: null });
    assert.ok(/no look woven yet/i.test(r.text), "piece but no look: weave-first copy: " + r.text.slice(0, 140));
    console.log("  pass: shoes piece with no look asks for a look first");
  }

  // --- (i) removing shoes drops just the extra ---
  console.log("\n[(i) removing shoes drops the extra, core stands]");
  {
    const cat = seed("i", ["dress", "layer/cardigan", "shoes"]);
    const ids = idsByCat(cat);
    cat.recordTurn({ userText: "seed", proposal: { pieces: [ids["dress"], ids["layer/cardigan"]] }, verdict: true, reasons: [] });
    const ra = await Revise.handle({ catalog: cat, text: "add my shoes", metaClient: null });
    const ta = cat.getTurns()[1];
    assert.strictEqual(ta.proposal.extras.length, 1, "shoes recorded as extra");
    assert.strictEqual(ta.proposal.extras[0].piece_id, ids["shoes"], "extra names the real shoes piece");
    assert.ok(/Added your shoes on top/.test(ra.text), "shoes extra copy");
    const rr = await Revise.handle({ catalog: cat, text: "remove my shoes", metaClient: null });
    const tr = cat.getTurns()[2];
    assert.strictEqual(tr.verdict, true, "drop keeps a valid verdict");
    assert.deepStrictEqual(tr.proposal.pieces, [ids["dress"], ids["layer/cardigan"]],
      "core unchanged (no re-weave)");
    assert.deepStrictEqual(tr.proposal.extras, [], "shoes extra dropped");
    assert.deepStrictEqual(tr.reasons, ["removed_extra:shoes"],
      "reasons prove the extra-drop path: " + JSON.stringify(tr.reasons));
    assert.ok(/Set aside your shoes/.test(rr.text), "drop copy: " + rr.text.slice(0, 100));
    assert.ok(/still stand/.test(rr.text), "core-stands copy");
    assertMetaContract(rr, "shoes extra drop");
    noFabrication(rr, "shoes extra drop");
    console.log("  pass: shoes dropped, dress+cardigan untouched");
  }

  // --- (j) view/delete list a shoes piece like any other category ---
  console.log("\n[(j) shoes listable, viewable, deletable]");
  {
    const cat = seed("j", ["dress", "shoes"]);
    const rv = await ViewItem.handle({ catalog: cat, text: "show my shoes" });
    assert.ok(/shoes/i.test(rv.text), "view names shoes: " + rv.text.slice(0, 120));
    assert.ok(!/shoess/.test(rv.text), "no shoess mis-plural: " + rv.text.slice(0, 120));
    const rd = await DeleteItem.handle({ catalog: cat, text: "delete my shoes" });
    assert.ok(/shoes/i.test(rd.text), "delete names shoes: " + rd.text.slice(0, 160));
    assert.ok(!/shoess/.test(rd.text), "no shoess mis-plural in delete");
    console.log("  pass: shoes list like any other piece");
  }

  console.log("\nAll revise-look extras tests passed.");
}

run().catch((e) => { console.error(e.stack || e); process.exit(1); });
