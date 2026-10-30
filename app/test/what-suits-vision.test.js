"use strict";
/* meta-styles Milestone 22 item 2 — What_suits vision honesty tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Updated for Opus finding #9: the fallback no longer claims a vision read
 * ("from what I can see" is success-path only) and neither reply promises
 * photo storage/deletion (photos are not kept after the reply).
 *
 * Covers: (a) no image -> unchanged consent-gate reply, no vision call
 * attempted; (b) image + metaClient.palette succeeds -> reply uses the REAL
 * returned palette words + note, persist.preferencesDelta reflects them;
 * (c) image + palette throws -> EXACT honest-fallback text, no crash;
 * (d) image + no metaClient -> EXACT honest-fallback text, no crash;
 * (e) reply text never leaks SYNTH_-prefixed fixture ids.
 * All clients mocked — no network. All ids synthetic (SYNTH_ prefix).
 */
const assert = require("node:assert");
const Handler = require("../skills/What_suits/handler.js");

// EXACT original hardcoded strings (must stay word-for-word in fallback).
const CONSENT_TEXT = "Oh, I\u2019d love to help with that, darling \u2728 If you\u2019d like personalised colour advice, you can share a head shot and a full-body photo \u2014 I\u2019ll keep them encrypted and you can say \u201Cdelete my photos\u201D anytime. Would you like to share them? (Only with your consent, loveling)";
const FALLBACK_TEXT = "Lovely, thank you for trusting me, darling \u2728 I couldn\u2019t quite read the photo just now, so here\u2019s some general colour guidance, loveling \u2014 soft lilac, sage and warm cream flatter most Y2K x fairycore looks and lift your natural glow. A touch of silver shimmer near the face will catch the light just so \u2728 Your photo isn\u2019t kept once I\u2019ve replied, loveling \u2014 it\u2019s just for this read.";
const FALLBACK_PREFS = "Warm lilac/sage palette.";

const IMG = "data:image/png;base64,SYNTH_whatsuits_photo_bytes";

function noSynthLeak(result, label) {
  const dumped = JSON.stringify(result);
  assert.ok(!/SYNTH_/.test(dumped), label + " must not leak SYNTH_ ids: " + dumped.slice(0, 200));
}

async function run() {
  console.log("what-suits-vision.test.js");

  // --- (a) no image -> consent gate, no vision call attempted ---
  console.log("\n[(a) consent gate]");
  {
    let called = false;
    const metaClient = {
      palette: async function () { called = true; return { palette: ["rose"], note: "x" }; }
    };
    const r = await Handler.handle({ imagePresent: false, metaClient: metaClient });
    assert.strictEqual(r.text, CONSENT_TEXT, "consent text unchanged");
    assert.strictEqual(called, false, "no vision call without an image");
    assert.strictEqual(r.image, null, "image null");
    assert.strictEqual(r.skill, "What_suits", "skill tag");
    noSynthLeak(r, "consent result");
    console.log("  pass: consent unchanged, no vision call");
  }

  // --- (b) image + palette success -> real words used ---
  console.log("\n[(b) live palette]");
  {
    const metaClient = {
      palette: async function (durl) {
        assert.ok(/^data:image\//.test(durl), "palette called with the photo data URL");
        return { palette: ["rose", "moss", "honey"], note: "Your warm undertones glow against earthy rose tones" };
      }
    };
    const r = await Handler.handle({ imagePresent: true, imageDataUrl: IMG, metaClient: metaClient });
    assert.ok(/rose/.test(r.text), "reply uses returned word rose: " + r.text.slice(0, 120));
    assert.ok(/moss/.test(r.text), "reply uses returned word moss");
    assert.ok(/honey/.test(r.text), "reply uses returned word honey");
    assert.ok(!/lilac, sage and warm cream/.test(r.text), "old hardcoded palette gone when live call succeeds");
    assert.ok(/warm undertones glow/.test(r.text), "reply uses the real returned note");
    assert.ok(/From what I can see/.test(r.text), "persona voice kept");
    assert.ok(!/SYNTH_/.test(r.text), "no fixture id in reply text");
    const prefs = (r.persist && r.persist.preferencesDelta) || "";
    assert.ok(/rose/.test(prefs) && /moss/.test(prefs) && /honey/.test(prefs),
      "preferencesDelta reflects real palette: " + prefs);
    assert.notStrictEqual(prefs, FALLBACK_PREFS, "preferencesDelta not the old hardcoded value");
    noSynthLeak(r, "live result");
    console.log("  pass: real palette words + note used, prefs honest");
  }

  // --- (c) image + palette throws -> exact fallback ---
  console.log("\n[(c) palette throws]");
  {
    const metaClient = {
      palette: async function () { throw new Error("proxy down"); }
    };
    const r = await Handler.handle({ imagePresent: true, imageDataUrl: IMG, metaClient: metaClient });
    assert.strictEqual(r.text, FALLBACK_TEXT, "word-for-word fallback on throw");
    assert.strictEqual(r.persist.preferencesDelta, FALLBACK_PREFS, "fallback prefs kept");
    assert.strictEqual(r.image, null, "image null");
    noSynthLeak(r, "throw result");
    console.log("  pass: exact fallback, no crash");
  }

  // --- (d) image + no metaClient -> exact fallback ---
  console.log("\n[(d) no metaClient]");
  {
    const r = await Handler.handle({ imagePresent: true, imageDataUrl: IMG });
    assert.strictEqual(r.text, FALLBACK_TEXT, "word-for-word fallback without client");
    assert.strictEqual(r.persist.preferencesDelta, FALLBACK_PREFS, "fallback prefs kept");
    noSynthLeak(r, "no-client result");
    console.log("  pass: exact fallback, no crash");
  }

  // --- (e) unparseable palette result -> exact fallback ---
  console.log("\n[(e) unparseable result]");
  {
    const metaClient = {
      palette: async function () { return { nonsense: true }; }
    };
    const r = await Handler.handle({ imagePresent: true, imageDataUrl: IMG, metaClient: metaClient });
    assert.strictEqual(r.text, FALLBACK_TEXT, "word-for-word fallback on unparseable result");
    noSynthLeak(r, "unparseable result");
    console.log("  pass: exact fallback on unparseable result");
  }

  console.log("\nAll What_suits vision tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
