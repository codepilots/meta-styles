"use strict";
/* meta-styles — render-on-user profile flow tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Covers app/skills/propose_look + revise_look render-on-user paths and the
 * agentic-loop profile_image routing, end to end at handler level:
 *  (a) fresh render intent with missing refs asks (consent first) and never
 *      calls preview;
 *  (b) consent "yes" -> headshot upload -> full-body upload completes the
 *      set and renders on the wearer (preview gets both profile refs plus
 *      an on-user prompt, never a flat-lay);
 *  (c) only-one-missing asks for just that photo, no preview;
 *  (d) ordinary look (no render words) with a full profile stays flat-lay:
 *      preview sees garment refs only, never profile bytes, and
 *      meta.renderOnUser is falsy;
 *  (e) a photo arriving while a profile_image expectation pends routes back
 *      to the asking skill via the agentic loop — never to catalogue_piece
 *      (no new piece, photo filed as the headshot reference);
 *  (f) delete then render asks consent again (record removed, no preview);
 *  (g) revise follow-up ("show me wearing this") renders the most recent
 *      valid proposal on the wearer.
 * Consent persistence is proven with an in-memory profileStore stub:
 * granting consent PUTs through saveProfile (load-confirmed), and deleting
 * removes it. All fixtures synthetic (SYNTH_ ids, locally generated 1px
 * PNGs) — no network, no real photos.
 *
 * Run: node app/test/profile-render-on-user.test.js
 */
const assert = require("node:assert/strict");

// Localhost must bypass any env HTTP proxy (sandbox sets one for external traffic).
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const Wardrobe = require("../wardrobe-catalog.js");
const Propose = require("../skills/propose_look/handler.js");
const Revise = require("../skills/revise_look/handler.js");
const AgenticLoop = require("../agentic-loop.js");

// Locally generated 1x1 PNGs (distinct tail bytes so headshot/full-body
// stay distinguishable in assertions). Tiny fixtures only.
const HS = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const FB = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMINAAAABJRU5ErkJggg==";
const PREVIEW_DURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIPAAAABJRU5ErkJggg==";

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log("PASS: " + name);
  } else {
    failures++;
    console.log("FAIL: " + name + (detail ? " — " + detail : ""));
  }
}

function seedPieces(cat) {
  cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_pr_1", image_original: HS });
  cat.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_share_pr_2", image_original: FB });
  cat.addPiece({ category: "scarf", attributes: {}, source_share_id: "SYNTH_share_pr_3" });
  cat.addPiece({ category: "bag", attributes: {}, source_share_id: "SYNTH_share_pr_4" });
  return cat;
}

function newCatalog() {
  const cat = Wardrobe.createCatalog({ userKey: "SYNTH_pr_" + Math.floor(Math.random() * 1e9) });
  return seedPieces(cat);
}

// In-memory profileStore stub proving the save/load/del contract the
// handlers drive (load-confirmed PUT, whole-record replace, delete).
function stubProfileStore() {
  const stub = {
    saved: null,
    deleted: 0,
    save: function (record) {
      stub.saved = JSON.parse(JSON.stringify(record));
      return Promise.resolve({ ok: true, status: 204, body: {}, error: null, op: "save" });
    },
    load: function () {
      const profile = stub.saved
        ? JSON.parse(JSON.stringify(stub.saved))
        : { headshot: null, full_body: null, consent: false, updated_at: null };
      return Promise.resolve({ ok: true, status: 200, body: {}, error: null, op: "load", profile: profile });
    },
    del: function () {
      stub.deleted++;
      stub.saved = null;
      return Promise.resolve({ ok: true, status: 204, body: {}, error: null, op: "delete" });
    },
  };
  return stub;
}

function previewStub(seen) {
  return async function (prompt, images) {
    seen.calls.push({ prompt: prompt, images: Array.isArray(images) ? images.slice() : images });
    return { dataURL: PREVIEW_DURL };
  };
}

function assembleStub(cat) {
  const active = cat.getActivePieces();
  return async function () {
    return { looks: [{ pieceIds: [active[0].piece_id, active[1].piece_id], rationale: "SYNTH drape." }] };
  };
}

async function run() {
  console.log("profile-render-on-user.test.js");

  // --- (a) fresh render intent, nothing stored: asks consent, never previews ---
  console.log("\n[(a) fresh render intent asks, never previews]");
  {
    const cat = newCatalog();
    const seen = { calls: [] };
    const mc = { assemble: assembleStub(cat), preview: previewStub(seen) };
    const r = await Propose.handle({
      catalog: cat, metaClient: mc,
      text: "make me a look and show me wearing it", preferences: "",
    });
    check("asks the exact consent copy", r.text === Propose.PROFILE_CONSENT_TEXT, r.text.slice(0, 80));
    check("no image until refs exist", r.image === null, JSON.stringify(r.image));
    check("preview never called", seen.calls.length === 0, "calls=" + seen.calls.length);
    check("reason names consent pending",
      r.meta && r.meta.imageDelivery && r.meta.imageDelivery.reason === "profile_consent_pending",
      JSON.stringify(r.meta && r.meta.imageDelivery));
    check("no preview bytes in meta", !JSON.stringify(r.meta).includes("data:image"), "meta carries bytes");
    const pend = cat.getPendingQuestions();
    check("yes_no expectation recorded",
      pend.length === 1 && pend[0].expects === "yes_no" && pend[0].skill === "propose_look",
      JSON.stringify(pend));
  }

  // --- (b) consent + sequential uploads render on the wearer ---
  console.log("\n[(b) consent -> headshot -> full-body renders on wearer]");
  {
    const store = stubProfileStore();
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_pr_seq", profileStore: store });
    seedPieces(cat);
    const seen = { calls: [] };
    const mc = { assemble: assembleStub(cat), preview: previewStub(seen) };

    // (b1) consent "yes" routed back via the pending yes_no.
    const y = await Propose.handle({
      catalog: cat, metaClient: mc, text: "yes",
      pendingSatisfied: { expects: "yes_no", text: Propose.PROFILE_CONSENT_TEXT },
    });
    check("consent granted in memory", cat.getProfileReferences().consent === true, "consent not set");
    check("consent persisted through the profile store",
      !!(store.saved && store.saved.consent === true), JSON.stringify(store.saved));
    check("asks for the headshot next", /headshot/.test(y.text), y.text.slice(0, 120));
    check("no preview after consent alone", seen.calls.length === 0 && y.image === null, "calls=" + seen.calls.length);
    const pend1 = cat.getPendingQuestions().filter(function (q) { return q.expects === "profile_image"; });
    check("profile_image expectation recorded", pend1.length === 1, JSON.stringify(cat.getPendingQuestions()));

    // (b2) headshot upload: stored, full-body asked, still no preview.
    const h = await Propose.handle({
      catalog: cat, metaClient: mc, text: "here is my headshot",
      imageDataUrl: HS, pendingSatisfied: { expects: "profile_image", text: pend1[0].text },
    });
    check("headshot filed as profile ref", cat.getProfileReferences().headshot === HS, "headshot missing");
    check("no new wardrobe piece from the headshot",
      cat.getPieces().length === 4, "pieces=" + cat.getPieces().length);
    check("asks for full-body only", /full-body/.test(h.text) && !/share.*headshot to begin/i.test(h.text), h.text.slice(0, 140));
    check("missing names only full_body",
      h.meta && Array.isArray(h.meta.profileMissing) && h.meta.profileMissing.join() === "full_body",
      JSON.stringify(h.meta && h.meta.profileMissing));
    check("still no preview", seen.calls.length === 0 && h.image === null, "calls=" + seen.calls.length);
    check("headshot persisted", !!(store.saved && store.saved.headshot === HS), "store lacks headshot");

    // (b3) full-body upload completes the set: renders in the same turn.
    const pend2 = cat.getPendingQuestions().filter(function (q) { return q.expects === "profile_image"; });
    const f = await Propose.handle({
      catalog: cat, metaClient: mc, text: "and my full body photo",
      imageDataUrl: FB, pendingSatisfied: { expects: "profile_image", text: pend2[0].text },
    });
    check("preview called exactly once", seen.calls.length === 1, "calls=" + seen.calls.length);
    const call = seen.calls[0];
    check("preview gets profile refs first (both data URLs)",
      Array.isArray(call.images) && call.images.length >= 2 &&
      /^data:image\//.test(call.images[0]) && /^data:image\//.test(call.images[1]),
      "images=" + JSON.stringify(call.images).slice(0, 120));
    check("prompt is on-user wording (headshot + full-body refs named)",
      /Image 1 is the wearer's headshot and image 2 is their full-body reference/.test(call.prompt),
      call.prompt.slice(0, 160));
    check("prompt is not a flat-lay", /not a flat-lay/.test(call.prompt), call.prompt.slice(0, 160));
    check("rendered image returned", !!(f.image && f.image.dataURL === PREVIEW_DURL), JSON.stringify(f.image));
    check("meta.renderOnUser true with 2 profile refs",
      f.meta && f.meta.renderOnUser === true && f.meta.profileRefs === 2,
      JSON.stringify(f.meta && { renderOnUser: f.meta.renderOnUser, profileRefs: f.meta.profileRefs }));
    check("on-user prompt travels in meta without bytes",
      typeof (f.meta && f.meta.previewPrompt) === "string" &&
      /Image 1 is the wearer's headshot/.test(f.meta.previewPrompt) &&
      !f.meta.previewPrompt.includes("data:image"),
      String(f.meta && f.meta.previewPrompt).slice(0, 120));
    check("reply says rendered on you", /Rendered on you/.test(f.text), f.text.slice(0, 120));
    check("both refs persisted", !!(store.saved && store.saved.headshot && store.saved.full_body), "store incomplete");
  }

  // --- (c) only-one-missing asks for just that photo ---
  console.log("\n[(c) only-one-missing asks for just that photo]");
  {
    const cat = newCatalog();
    cat.setProfileConsent(true);
    cat.setProfileReference("headshot", HS);
    const seen = { calls: [] };
    const mc = { assemble: assembleStub(cat), preview: previewStub(seen) };
    const r = await Propose.handle({
      catalog: cat, metaClient: mc, text: "render this look on me", preferences: "",
    });
    check("asks for the full-body photo", /full-body/.test(r.text), r.text.slice(0, 140));
    check("does not re-ask for the headshot", !/share your headshot to begin/i.test(r.text), r.text.slice(0, 140));
    check("no image and no preview", r.image === null && seen.calls.length === 0, "calls=" + seen.calls.length);
    check("missing names only full_body",
      r.meta && Array.isArray(r.meta.profileMissing) && r.meta.profileMissing.join() === "full_body",
      JSON.stringify(r.meta && r.meta.profileMissing));
  }

  // --- (d) ordinary look stays flat-lay even with a full profile ---
  console.log("\n[(d) ordinary look remains flat-lay]");
  {
    const cat = newCatalog();
    cat.setProfileConsent(true);
    cat.setProfileReference("headshot", HS);
    cat.setProfileReference("full_body", FB);
    const seen = { calls: [] };
    const mc = { assemble: assembleStub(cat), preview: previewStub(seen) };
    const r = await Propose.handle({
      catalog: cat, metaClient: mc, text: "show me a look", preferences: "",
    });
    check("ordinary request still proposes", r.meta && typeof r.meta.selectedCount === "number" && r.meta.selectedCount > 0,
      JSON.stringify(r.meta && r.meta.selectedCount));
    check("not flagged as render-on-user", !(r.meta && r.meta.renderOnUser), JSON.stringify(r.meta && r.meta.renderOnUser));
    check("flat-lay preview ran", seen.calls.length === 1, "calls=" + seen.calls.length);
    const imgs = seen.calls[0].images;
    check("preview sees garment refs only, never profile bytes",
      Array.isArray(imgs) && imgs.indexOf(HS) === -1 && imgs.indexOf(FB) === -1,
      JSON.stringify(imgs).slice(0, 160));
    check("prompt is flat-lay wording, not on-user",
      !/worn by the same user/.test(seen.calls[0].prompt), seen.calls[0].prompt.slice(0, 160));
  }

  // --- (e) pending profile photo never reaches catalogue_piece ---
  console.log("\n[(e) pending profile photo avoids catalogue_piece]");
  {
    const cat = newCatalog();
    cat.setProfileConsent(true);
    cat.askQuestion({ text: "Share your headshot to begin?", skill: "propose_look", expects: "profile_image" });
    const before = cat.getPieces().length;
    const loop = AgenticLoop.createAgenticLoop({
      catalog: cat,
      router: { classifySync: function () { throw new Error("SYNTH router must not be consulted while a profile photo pends"); } },
      metaClient: null, maxSteps: 20,
    });
    const r = await loop.handleTurn({ message: "here is my headshot", hasImage: true, imageDataUrl: HS });
    check("routes back to the asking skill", r && r.skill === "propose_look", JSON.stringify(r && r.skill));
    check("headshot filed as profile ref, not a piece",
      cat.getProfileReferences().headshot === HS && cat.getPieces().length === before,
      "pieces=" + cat.getPieces().length + " headshot=" + String(cat.getProfileReferences().headshot).slice(0, 30));
  }

  // --- (f) delete then render asks consent again ---
  console.log("\n[(f) delete then render asks again]");
  {
    const store = stubProfileStore();
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_pr_del", profileStore: store });
    seedPieces(cat);
    cat.setProfileConsent(true);
    cat.setProfileReference("headshot", HS);
    cat.setProfileReference("full_body", FB);
    await Propose.handle({ catalog: cat, text: "delete my photos" });
    check("record cleared from memory",
      cat.getProfileReferences().headshot === null && cat.getProfileReferences().consent === false,
      JSON.stringify(cat.getProfileReferences()));
    check("delete reached the encrypted store", store.deleted === 1 && store.saved === null,
      "deleted=" + store.deleted);
    const seen = { calls: [] };
    const mc = { assemble: assembleStub(cat), preview: previewStub(seen) };
    const r = await Propose.handle({
      catalog: cat, metaClient: mc, text: "show me wearing it", preferences: "",
    });
    check("asks consent again after delete", r.text === Propose.PROFILE_CONSENT_TEXT, r.text.slice(0, 80));
    check("no preview after delete", seen.calls.length === 0 && r.image === null, "calls=" + seen.calls.length);
  }

  // --- (g) revise follow-up renders the saved look on the wearer ---
  console.log("\n[(g) revise follow-up renders saved look on wearer]");
  {
    const cat = newCatalog();
    cat.setProfileConsent(true);
    cat.setProfileReference("headshot", HS);
    cat.setProfileReference("full_body", FB);
    const seen = { calls: [] };
    const mc = { assemble: assembleStub(cat), preview: previewStub(seen) };
    // Record a valid look first (ordinary propose records a verdict:true turn).
    const first = await Propose.handle({ catalog: cat, metaClient: mc, text: "show me a look", preferences: "" });
    check("setup look proposed", first.meta && first.meta.selectedCount > 0, "no setup look");
    seen.calls.length = 0;
    const r = await Revise.handle({
      catalog: cat, metaClient: mc, text: "show me wearing this", preferences: "",
    });
    check("follow-up renders on user", r.meta && r.meta.renderOnUser === true, JSON.stringify(r.meta && r.meta.renderOnUser));
    check("preview called once with profile refs first",
      seen.calls.length === 1 && /^data:image\//.test(seen.calls[0].images[0]) &&
      /^data:image\//.test(seen.calls[0].images[1]),
      "calls=" + seen.calls.length);
    check("on-user prompt names the refs",
      /Image 1 is the wearer's headshot/.test(seen.calls[0].prompt), seen.calls[0].prompt.slice(0, 120));
    check("rendered image returned", !!(r.image && r.image.dataURL === PREVIEW_DURL), JSON.stringify(r.image));
    check("no profile bytes leak into meta JSON besides the prompt",
      !JSON.stringify(Object.assign({}, r.meta, { previewPrompt: "" })).includes("data:image"),
      "meta carries bytes");
  }

  // --- (h) revise + render in one turn revises first, then renders on wearer ---
  console.log("\n[(h) revise with render intent renders the revised look]");
  {
    const cat = newCatalog();
    cat.setProfileConsent(true);
    cat.setProfileReference("headshot", HS);
    cat.setProfileReference("full_body", FB);
    const seen = { calls: [] };
    const mc = { assemble: assembleStub(cat), preview: previewStub(seen) };
    const first = await Propose.handle({ catalog: cat, metaClient: mc, text: "show me a look", preferences: "" });
    check("setup look proposed", first.meta && first.meta.selectedCount > 0, "no setup look");
    seen.calls.length = 0;
    const r = await Revise.handle({
      catalog: cat, metaClient: mc, text: "drop the bag and show me wearing it", preferences: "",
    });
    check("revised + rendered on user", r.meta && r.meta.renderOnUser === true, JSON.stringify(r.meta && r.meta.renderOnUser));
    check("preview called once with profile refs first",
      seen.calls.length === 1 && /^data:image\//.test(seen.calls[0].images[0]) &&
      /^data:image\//.test(seen.calls[0].images[1]),
      "calls=" + seen.calls.length);
    check("rendered image returned", !!(r.image && r.image.dataURL === PREVIEW_DURL), JSON.stringify(r.image));
    check("no flat-lay ran alongside", seen.calls.length === 1 && /not a flat-lay/.test(seen.calls[0].prompt),
      seen.calls.length === 1 ? seen.calls[0].prompt.slice(0, 120) : "calls=" + seen.calls.length);
  }

  console.log(failures === 0 ? "\nAll profile-render-on-user tests passed." : "\n" + failures + " FAILURES");
  if (failures > 0) process.exitCode = 1;
}

run().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
