"use strict";
/* meta-styles Opus finding #11 — stray-accessory rejection tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * The assembler header (app/assembler.js:9-10) and docs/decisions.md agree:
 * a look is a base plus exactly one finish — either one layer OR a
 * scarf+bag pair, never combined. A layer finish alongside a lone scarf or
 * a lone bag must be flagged, not silently accepted. Covers both copies of
 * the rule: assembleLook() and propose_look's strictShape().
 * No network. All fixtures synthetic (SYNTH_ prefix).
 *
 * Run: node app/test/assembler-stray-accessory.test.js
 */
const path = require("path");
const assert = require("node:assert");

require(path.resolve(__dirname, "../assembler.js"));
const MS = globalThis.MetaStyles;
const Handler = require("../skills/propose_look/handler.js");

function cardFor(pairs) {
  return MS.assembleLook(pairs.map(([id, category]) => ({
    id, category, copy: { text: "SYNTH copy for " + category, placeholder: true },
  })));
}

function shapeFor(pairs) {
  return Handler.strictShape(
    pairs.map(([id, category]) => ({ id, category })),
    10
  );
}

async function run() {
  console.log("Opus finding #11 — assembler-stray-accessory.test.js");

  // --- (a) base + layer + lone scarf -> invalid, stray flagged ---
  console.log("\n[(a) layer + lone scarf]");
  {
    const card = cardFor([["SYNTH_a", "dress"], ["SYNTH_b", "layer/cardigan"], ["SYNTH_c", "scarf"]]);
    assert.strictEqual(card.valid, false, "layer + lone scarf is invalid");
    assert.strictEqual(card.finish, null, "no finish assigned");
    assert.ok(card.reasons.some((r) => /stray/i.test(r)),
      "a reason names the stray accessory, got: " + JSON.stringify(card.reasons));
    assert.strictEqual(shapeFor([["a", "dress"], ["b", "layer/cardigan"], ["c", "scarf"]]),
      "stray_accessory_with_layer", "strictShape rejects layer + lone scarf");
    console.log("  pass: flagged on both paths");
  }

  // --- (b) base + layer + lone bag -> invalid, stray flagged ---
  console.log("\n[(b) layer + lone bag]");
  {
    const card = cardFor([["SYNTH_a", "dress"], ["SYNTH_b", "layer/cardigan"], ["SYNTH_c", "bag"]]);
    assert.strictEqual(card.valid, false, "layer + lone bag is invalid");
    assert.strictEqual(card.finish, null, "no finish assigned");
    assert.ok(card.reasons.some((r) => /stray/i.test(r)),
      "a reason names the stray accessory, got: " + JSON.stringify(card.reasons));
    assert.strictEqual(shapeFor([["a", "dress"], ["b", "layer/cardigan"], ["c", "bag"]]),
      "stray_accessory_with_layer", "strictShape rejects layer + lone bag");
    console.log("  pass: flagged on both paths");
  }

  // --- (c) base + layer + full scarf+bag pair -> still invalid (two finishes) ---
  console.log("\n[(c) layer + full pair]");
  {
    const card = cardFor([["SYNTH_a", "dress"], ["SYNTH_b", "layer/cardigan"], ["SYNTH_c", "scarf"], ["SYNTH_d", "bag"]]);
    assert.strictEqual(card.valid, false, "layer + pair is invalid");
    assert.ok(card.reasons.some((r) => /Two finishes at once/.test(r)),
      "keeps the two-finishes reason, got: " + JSON.stringify(card.reasons));
    assert.strictEqual(shapeFor([["a", "dress"], ["b", "layer/cardigan"], ["c", "scarf"], ["d", "bag"]]),
      "two_finishes", "strictShape still returns two_finishes");
    console.log("  pass: two-finishes behaviour unchanged");
  }

  // --- (d) base + layer alone -> still valid (regression guard) ---
  console.log("\n[(d) layer alone]");
  {
    const card = cardFor([["SYNTH_a", "dress"], ["SYNTH_b", "layer/cardigan"]]);
    assert.strictEqual(card.valid, true, "layer alone stays valid");
    assert.strictEqual(card.finish, "layer", "finish layer");
    assert.strictEqual(shapeFor([["a", "dress"], ["b", "layer/cardigan"]]),
      null, "strictShape accepts layer alone");
    console.log("  pass: unaffected");
  }

  // --- (e) base + scarf + bag alone -> still valid (regression guard) ---
  console.log("\n[(e) scarf+bag alone]");
  {
    const card = cardFor([["SYNTH_a", "base/top"], ["SYNTH_b", "scarf"], ["SYNTH_c", "bag"]]);
    assert.strictEqual(card.valid, true, "scarf+bag alone stays valid");
    assert.strictEqual(card.finish, "scarf+bag", "finish scarf+bag");
    assert.strictEqual(shapeFor([["a", "base/top"], ["b", "scarf"], ["c", "bag"]]),
      null, "strictShape accepts scarf+bag alone");
    console.log("  pass: unaffected");
  }

  console.log("\nAll assembler-stray-accessory tests passed.");
}

run().catch((e) => { console.error(e.stack || e); process.exit(1); });
