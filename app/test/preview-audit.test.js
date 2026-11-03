"use strict";
/* meta-styles — Muse Image preview audit ring tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves, with synthetic fixtures only:
 *  (a) a propose_look flat-lay preview call logs one ring entry naming
 *      each sent reference (piece_id, category, ref_source, ref_bytes,
 *      downgraded) in send order, with no image bytes anywhere;
 *  (b) a render-on-user preview call's entry shows profileRefs 2 plus the
 *      same per-garment array shape, again with no image bytes;
 *  (c) revise_look logs through the same shared ring on both its flat-lay
 *      branch and its render-follow-up path (skill "revise_look");
 *  (d) the ring is bounded (25 records keep the newest 20, newest last).
 *
 * Run: node app/test/preview-audit.test.js
 */
const assert = require("node:assert/strict");

// Localhost must bypass any env HTTP proxy (sandbox sets one for external traffic).
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const Wardrobe = require("../wardrobe-catalog.js");
const Propose = require("../skills/propose_look/handler.js");
const Revise = require("../skills/revise_look/handler.js");

// Locally generated 1x1 PNGs (distinct tail bytes so fixtures stay
// distinguishable). Synthetic only — no real photos.
const ORIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const THUMB = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMINAAAABJRU5ErkJggg==";
const HS = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIPAAAABJRU5ErkJggg==";
const FB = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIRAAAABJRU5ErkJggg==";
const PREVIEW_DURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMISAAAABJRU5ErkJggg==";

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log("PASS: " + name);
  } else {
    failures++;
    console.log("FAIL: " + name + (detail ? " — " + detail : ""));
  }
}

// Dress carries an original only (-> 384px ref, source image_original);
// cardigan carries a thumb only (-> fallback ref, source photo_thumb).
// Scarf + bag round out the wardrobe so the look shape stays open.
function newCatalog() {
  const cat = Wardrobe.createCatalog({ userKey: "SYNTH_pa_" + Math.floor(Math.random() * 1e9) });
  cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_pa_1", image_original: ORIG });
  cat.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_share_pa_2", photo_thumb: THUMB });
  cat.addPiece({ category: "scarf", attributes: {}, source_share_id: "SYNTH_share_pa_3" });
  cat.addPiece({ category: "bag", attributes: {}, source_share_id: "SYNTH_share_pa_4" });
  return cat;
}

function pieceIds(cat) {
  const active = cat.getActivePieces();
  const byCat = {};
  active.forEach(function (p) { byCat[p.category] = p.piece_id; });
  return byCat;
}

function previewStub(seen) {
  return async function (prompt, images) {
    seen.calls.push({ prompt: prompt, images: Array.isArray(images) ? images.slice() : images });
    return { dataURL: PREVIEW_DURL };
  };
}

function assembleStub(ids) {
  return async function () {
    return { looks: [{ pieceIds: ids, rationale: "SYNTH drape." }] };
  };
}

function entryJsonClean(entry) {
  const s = JSON.stringify(entry);
  return s.indexOf("data:image") === -1 && s.indexOf("base64") === -1;
}

async function run() {
  console.log("preview-audit.test.js");
  Propose.clearPreviewAudit();

  // --- (a) propose_look flat-lay logs each sent reference ---
  console.log("\n[(a) flat-lay audit entry]");
  {
    const cat = newCatalog();
    const ids = pieceIds(cat);
    const seen = { calls: [] };
    const mc = { assemble: assembleStub([ids["dress"], ids["layer/cardigan"]]), preview: previewStub(seen) };
    const before = Propose.getPreviewAudit().length;
    const r = await Propose.handle({ catalog: cat, metaClient: mc, text: "show me a look", preferences: "" });
    check("look proposed", r.meta && r.meta.selectedCount === 2, JSON.stringify(r.meta && r.meta.selectedCount));
    check("flat-lay preview ran", seen.calls.length === 1, "calls=" + seen.calls.length);
    const after = Propose.getPreviewAudit();
    check("exactly one entry logged", after.length === before + 1,
      "before=" + before + " after=" + after.length);
    const e = after[after.length - 1];
    check("skill propose_look, flat-lay", e.skill === "propose_look" && e.renderOnUser === false,
      JSON.stringify({ skill: e.skill, renderOnUser: e.renderOnUser }));
    check("timestamp is ISO", typeof e.timestamp === "string" && !isNaN(Date.parse(e.timestamp)), String(e.timestamp));
    check("two garment refs in selection order",
      Array.isArray(e.refs) && e.refs.length === 2 &&
      e.refs[0].piece_id === ids["dress"] && e.refs[1].piece_id === ids["layer/cardigan"],
      JSON.stringify(e.refs));
    check("dress ref names original source",
      e.refs[0].category === "dress" && e.refs[0].ref_source === "image_original" && e.refs[0].downgraded === false,
      JSON.stringify(e.refs[0]));
    check("cardigan ref names thumb fallback",
      e.refs[1].category === "layer/cardigan" && e.refs[1].ref_source === "photo_thumb" && e.refs[1].downgraded === true,
      JSON.stringify(e.refs[1]));
    check("ref_bytes are numbers > 0",
      typeof e.refs[0].ref_bytes === "number" && e.refs[0].ref_bytes > 0 &&
      typeof e.refs[1].ref_bytes === "number" && e.refs[1].ref_bytes > 0,
      JSON.stringify([e.refs[0].ref_bytes, e.refs[1].ref_bytes]));
    check("totals match what was sent",
      e.totalRefs === seen.calls[0].images.length &&
      e.totalPayloadBytes === e.refs[0].ref_bytes + e.refs[1].ref_bytes &&
      typeof e.totalPayloadBytes === "number",
      JSON.stringify({ totalRefs: e.totalRefs, sent: seen.calls[0].images.length, totalPayloadBytes: e.totalPayloadBytes }));
    check("prompt preview is text-only, ~200 chars",
      typeof e.previewPromptPreview === "string" && e.previewPromptPreview.length <= 200 &&
      e.previewPromptPreview.indexOf("flat-lay") !== -1,
      "len=" + e.previewPromptPreview.length);
    check("entry carries no image bytes", entryJsonClean(e), JSON.stringify(e).slice(0, 200));
  }

  // --- (b) render-on-user entry: profileRefs + garment entries ---
  console.log("\n[(b) render-on-user audit entry]");
  {
    const cat = newCatalog();
    const ids = pieceIds(cat);
    cat.setProfileConsent(true);
    cat.setProfileReference("headshot", HS);
    cat.setProfileReference("full_body", FB);
    const seen = { calls: [] };
    const mc = { assemble: assembleStub([ids["dress"], ids["layer/cardigan"]]), preview: previewStub(seen) };
    const before = Propose.getPreviewAudit().length;
    const r = await Propose.handle({
      catalog: cat, metaClient: mc, text: "show me a look and show me wearing it", preferences: "",
    });
    check("rendered on user", r.meta && r.meta.renderOnUser === true, JSON.stringify(r.meta && r.meta.renderOnUser));
    check("on-user preview ran once", seen.calls.length === 1, "calls=" + seen.calls.length);
    const after = Propose.getPreviewAudit();
    check("exactly one entry logged", after.length === before + 1,
      "before=" + before + " after=" + after.length);
    const e = after[after.length - 1];
    check("renderOnUser true, profileRefs 2",
      e.renderOnUser === true && e.profileRefs === 2, JSON.stringify({ renderOnUser: e.renderOnUser, profileRefs: e.profileRefs }));
    check("garment entries name the sent pieces",
      Array.isArray(e.refs) && e.refs.length === 2 &&
      e.refs[0].piece_id === ids["dress"] && e.refs[0].ref_source === "image_original" &&
      e.refs[1].piece_id === ids["layer/cardigan"] && e.refs[1].ref_source === "photo_thumb",
      JSON.stringify(e.refs));
    check("garment ref_bytes are numbers > 0",
      typeof e.refs[0].ref_bytes === "number" && e.refs[0].ref_bytes > 0 &&
      typeof e.refs[1].ref_bytes === "number" && e.refs[1].ref_bytes > 0,
      JSON.stringify([e.refs[0].ref_bytes, e.refs[1].ref_bytes]));
    check("totalRefs counts profile + garments",
      e.totalRefs === seen.calls[0].images.length && e.totalRefs === 2 + e.refs.length,
      JSON.stringify({ totalRefs: e.totalRefs, sent: seen.calls[0].images.length }));
    check("totalPayloadBytes is a number > 0", typeof e.totalPayloadBytes === "number" && e.totalPayloadBytes > 0,
      String(e.totalPayloadBytes));
    check("prompt preview is text-only, ~200 chars",
      typeof e.previewPromptPreview === "string" && e.previewPromptPreview.length <= 200,
      "len=" + (e.previewPromptPreview && e.previewPromptPreview.length));
    check("entry carries no image bytes", entryJsonClean(e), JSON.stringify(e).slice(0, 200));
  }

  // --- (c) revise_look logs through the shared ring ---
  console.log("\n[(c) revise_look entries]");
  {
    const cat = newCatalog();
    const ids = pieceIds(cat);
    const seen = { calls: [] };
    const mc = { assemble: assembleStub([ids["dress"], ids["layer/cardigan"]]), preview: previewStub(seen) };
    // Seed a valid look first (ordinary propose records a verdict:true turn).
    await Propose.handle({ catalog: cat, metaClient: mc, text: "show me a look", preferences: "" });
    // Flat-lay revision: no render words, so the flat-lay branch runs.
    const beforeFlat = Propose.getPreviewAudit().length;
    seen.calls.length = 0;
    const rev = await Revise.handle({ catalog: cat, metaClient: mc, text: "drop the bag", preferences: "" });
    check("revision proposed", rev.meta && rev.text && seen.calls.length === 1, "calls=" + seen.calls.length);
    const afterFlat = Propose.getPreviewAudit();
    const eFlat = afterFlat[afterFlat.length - 1];
    check("revise flat-lay logged one entry", afterFlat.length === beforeFlat + 1,
      "before=" + beforeFlat + " after=" + afterFlat.length);
    check("revise flat-lay names skill + piece",
      eFlat.skill === "revise_look" && eFlat.renderOnUser === false &&
      Array.isArray(eFlat.refs) && eFlat.refs.length >= 1 &&
      typeof eFlat.refs[0].piece_id === "string",
      JSON.stringify(eFlat).slice(0, 300));
    check("revise flat-lay entry has no image bytes", entryJsonClean(eFlat), JSON.stringify(eFlat).slice(0, 200));
    // Render follow-up: profile set, "show me wearing this" renders the
    // saved look through the shared on-user path.
    cat.setProfileConsent(true);
    cat.setProfileReference("headshot", HS);
    cat.setProfileReference("full_body", FB);
    const beforeOnUser = Propose.getPreviewAudit().length;
    seen.calls.length = 0;
    const r2 = await Revise.handle({ catalog: cat, metaClient: mc, text: "show me wearing this", preferences: "" });
    check("revise follow-up renders on user", r2.meta && r2.meta.renderOnUser === true,
      JSON.stringify(r2.meta && r2.meta.renderOnUser));
    const afterOnUser = Propose.getPreviewAudit();
    const eOnUser = afterOnUser[afterOnUser.length - 1];
    check("revise render logged one entry", afterOnUser.length === beforeOnUser + 1,
      "before=" + beforeOnUser + " after=" + afterOnUser.length);
    check("revise render entry: profileRefs 2 + garments",
      eOnUser.skill === "revise_look" && eOnUser.renderOnUser === true && eOnUser.profileRefs === 2 &&
      Array.isArray(eOnUser.refs) && eOnUser.refs.length >= 1 &&
      eOnUser.refs.every(function (g) { return typeof g.piece_id === "string" && typeof g.ref_bytes === "number"; }),
      JSON.stringify(eOnUser).slice(0, 400));
    check("revise render entry has no image bytes", entryJsonClean(eOnUser), JSON.stringify(eOnUser).slice(0, 200));
  }

  // --- (d) ring bound: 25 records keep the newest 20, newest last ---
  console.log("\n[(d) ring bound]");
  {
    Propose.clearPreviewAudit();
    for (let i = 1; i <= 25; i++) {
      Propose.recordPreviewAudit({
        skill: "propose_look", renderOnUser: false,
        refs: [{ piece_id: "SYNTH_piece_" + i, category: "dress", ref_source: "photo_thumb", ref_bytes: i, downgraded: true }],
        previewPromptPreview: "SYNTH prompt " + i,
        totalRefs: 1, totalPayloadBytes: i,
      });
    }
    const entries = Propose.getPreviewAudit();
    check("ring holds exactly 20", entries.length === 20, "len=" + entries.length);
    check("oldest five evicted", entries[0].refs[0].piece_id === "SYNTH_piece_6",
      JSON.stringify(entries[0].refs));
    check("newest last", entries[19].refs[0].piece_id === "SYNTH_piece_25",
      JSON.stringify(entries[19].refs));
    check("bounded ring has no image bytes", entryJsonClean(entries), "ring carries bytes");
    Propose.clearPreviewAudit();
    check("ring clears", Propose.getPreviewAudit().length === 0, "len=" + Propose.getPreviewAudit().length);
  }

  console.log(failures === 0 ? "\nAll preview-audit tests passed." : "\n" + failures + " FAILURES");
  if (failures > 0) process.exitCode = 1;
}

run().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
