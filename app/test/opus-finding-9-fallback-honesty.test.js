"use strict";
/* meta-styles Opus finding #9 — fallback honesty tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Covers: (a) What_suits fallback (no metaClient, or palette() rejects)
 * never claims "from what I can see" and never makes the storage/deletion
 * promise; (b) What_suits success path still uses the real returned palette
 * words but no longer makes the storage/deletion promise; (c) Match_look
 * fallback (classify() throws) never claims an "I see" vision read.
 * All clients mocked — no network. All ids synthetic (SYNTH_ prefix).
 */
const assert = require("node:assert");
const WhatSuits = require("../skills/What_suits/handler.js");
const MatchLook = require("../skills/Match_look/handler.js");
const Wardrobe = require("../wardrobe-catalog.js");

const IMG = "data:image/png;base64,SYNTH_finding9_photo_bytes";

function noVisionClaim(text, label) {
  assert.ok(!/from what i can see/i.test(text), label + " must not claim a vision read: " + text.slice(0, 160));
}

function noStoragePromise(text, label) {
  assert.ok(!/stored encrypted/i.test(text), label + " must not promise encrypted storage: " + text.slice(0, 160));
  assert.ok(!/delete my photos/i.test(text), label + " must not promise photo deletion: " + text.slice(0, 160));
}

function noSynthLeak(result, label) {
  const dumped = JSON.stringify(result);
  assert.ok(!/SYNTH_/.test(dumped), label + " must not leak SYNTH_ ids: " + dumped.slice(0, 200));
}

async function run() {
  console.log("opus-finding-9-fallback-honesty.test.js");

  // --- (a1) What_suits, no metaClient -> honest general-guidance fallback ---
  console.log("\n[(a1) What_suits fallback, no metaClient]");
  {
    const r = await WhatSuits.handle({ imagePresent: true, imageDataUrl: IMG });
    noVisionClaim(r.text, "What_suits fallback");
    noStoragePromise(r.text, "What_suits fallback");
    assert.ok(/general colour guidance|couldn\u2019t quite read/i.test(r.text),
      "fallback frames itself as general guidance: " + r.text.slice(0, 160));
    assert.ok(/isn\u2019t kept/.test(r.text), "fallback states the photo is not kept");
    assert.strictEqual(r.image, null, "image null");
    assert.strictEqual(r.skill, "What_suits", "skill tag");
    assert.strictEqual(r.persist.preferencesDelta, "Warm lilac/sage palette.", "fallback prefs kept");
    noSynthLeak(r, "What_suits no-client fallback");
    console.log("  pass: no vision claim, no storage promise, honest framing");
  }

  // --- (a2) What_suits, palette() rejects -> same honest fallback ---
  console.log("\n[(a2) What_suits fallback, palette rejects]");
  {
    const metaClient = { palette: async function () { throw new Error("SYNTH_proxy_down"); } };
    const r = await WhatSuits.handle({ imagePresent: true, imageDataUrl: IMG, metaClient: metaClient });
    noVisionClaim(r.text, "What_suits reject fallback");
    noStoragePromise(r.text, "What_suits reject fallback");
    assert.strictEqual(r.image, null, "image null");
    assert.strictEqual(r.skill, "What_suits", "skill tag");
    noSynthLeak(r, "What_suits reject fallback");
    console.log("  pass: no vision claim, no storage promise on palette failure");
  }

  // --- (b) What_suits success path -> real words, kept "from what I can see", no storage promise ---
  console.log("\n[(b) What_suits success path]");
  {
    const metaClient = {
      palette: async function (durl) {
        assert.ok(/^data:image\//.test(durl), "palette called with the photo data URL");
        return { palette: ["rose", "moss", "honey"], note: "Your warm undertones glow against earthy rose tones" };
      }
    };
    const r = await WhatSuits.handle({ imagePresent: true, imageDataUrl: IMG, metaClient: metaClient });
    assert.ok(/rose/.test(r.text) && /moss/.test(r.text) && /honey/.test(r.text),
      "reply uses the real returned palette words: " + r.text.slice(0, 160));
    assert.ok(/from what i can see/i.test(r.text), "backed vision claim kept on the success path");
    noStoragePromise(r.text, "What_suits success path");
    assert.strictEqual(r.image, null, "image null");
    assert.strictEqual(r.skill, "What_suits", "skill tag");
    noSynthLeak(r, "What_suits success result");
    console.log("  pass: real palette words kept, storage promise gone");
  }

  // --- (c) Match_look, classify() throws -> no "I see" vision claim ---
  console.log("\n[(c) Match_look fallback, classify throws]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_finding9_" + Math.floor(Math.random() * 1e9) });
    cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_f9_1" });
    cat.addPiece({ category: "layer/cardigan", attributes: {}, source_share_id: "SYNTH_share_f9_2" });
    const metaClient = { classify: async function () { throw new Error("SYNTH_proxy_down"); } };
    const r = await MatchLook.handle({
      catalog: cat, imageDataUrl: IMG, metaClient: metaClient
    });
    assert.ok(!/\bi see\b/i.test(r.text), "Match_look fallback must not claim a vision read: " + r.text.slice(0, 160));
    assert.ok(/general inspiration|direction to dream on/i.test(r.text),
      "fallback uses honest generic framing: " + r.text.slice(0, 160));
    assert.strictEqual(r.skill, "Match_look", "skill tag");
    noSynthLeak(r, "Match_look fallback result");
    console.log("  pass: no vision claim, honest generic framing");
  }

  // --- (c2) Match_look classify success wording unchanged ---
  console.log("\n[(c2) Match_look success path unchanged]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_finding9_" + Math.floor(Math.random() * 1e9) });
    cat.addPiece({ category: "dress", attributes: {}, source_share_id: "SYNTH_share_f9_3" });
    const metaClient = { classify: async function () { return { category: "dress" }; } };
    const r = await MatchLook.handle({
      catalog: cat, imageDataUrl: IMG, metaClient: metaClient
    });
    assert.ok(/I see a beautiful dress moment/.test(r.text),
      "classify-success wording unchanged: " + r.text.slice(0, 120));
    noSynthLeak(r, "Match_look success result");
    console.log("  pass: success-path wording unchanged");
  }

  console.log("\nAll Opus finding #9 fallback-honesty tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
