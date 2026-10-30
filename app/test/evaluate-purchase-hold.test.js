"use strict";
/* meta-styles Milestone 22 item 3 — real 24-hour hold tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Covers Evaluate_prospective_purchase hold/confirm behaviour:
 *   (a) new evaluation stores a "held" piece (~24h expiry) and the
 *       reply promises the hold;
 *   (b) "I bought it" with a live hold flips it to "active", confirms,
 *       and saves;
 *   (c) "I bought it" with an EXPIRED hold catalogues nothing and says
 *       the hold lapsed;
 *   (d) "I bought it" with nothing held mutates nothing and says so;
 *   (e) addPiece throwing falls back to no-hold-promise copy;
 *   (f) router routes confirmation phrasing to the skill (>= 70);
 *   (g) end-to-end against the real catalog: hold invisible to
 *       getActivePieces() until confirmed.
 * All catalogs mocked except (g); no network. All ids synthetic
 * (SYNTH_ prefix) — never real data.
 *
 * Run: node app/test/evaluate-purchase-hold.test.js
 */
const assert = require("node:assert");
const Handler = require("../skills/Evaluate_prospective_purchase/handler.js");
const Router = require("../router.js");
const Wardrobe = require("../wardrobe-catalog.js");

function futureIso() { return new Date(Date.now() + 12 * 3600 * 1000).toISOString(); }
function pastIso() { return new Date(Date.now() - 25 * 3600 * 1000).toISOString(); }

// Plain-object mock catalog recording the calls the handler makes.
function mockCatalog(heldPieces, opts) {
  const o = opts || {};
  const calls = { addPiece: [], activatePiece: [], save: 0 };
  return {
    calls: calls,
    getActivePieces: function () { return o.active || []; },
    getPieces: function (filter) {
      if (filter && filter.status === "held") return heldPieces.slice();
      return heldPieces.slice().concat(o.active || []);
    },
    addPiece: function (input) {
      calls.addPiece.push(input);
      if (o.throwOnAdd) throw new Error("SYNTH mock catalog failure");
      return Object.assign({ piece_id: "SYNTH_piece_900" }, input);
    },
    activatePiece: function (id) {
      calls.activatePiece.push(id);
      return { piece_id: id, status: "active", held_until: null };
    },
    save: function () { calls.save += 1; return Promise.resolve({ ok: true }); },
  };
}

function noSynthLeak(r, label) {
  const dumped = r.text;
  assert.ok(!/SYNTH_/.test(dumped), label + " must not leak SYNTH_ ids: " + dumped.slice(0, 200));
}

async function run() {
  console.log("Milestone 22 item 3 — evaluate-purchase-hold.test.js");

  // --- (a) new evaluation creates a stored hold ---
  console.log("\n[(a) new evaluation stores hold]");
  {
    const cat = mockCatalog([], { active: [] });
    const r = await Handler.handle({ catalog: cat, text: "should I get this dress?", shareId: "SYNTH_share_101" });
    assert.strictEqual(cat.calls.addPiece.length, 1, "addPiece called once");
    const input = cat.calls.addPiece[0];
    assert.strictEqual(input.status, "held", "status held");
    const deltaMs = Date.parse(input.held_until) - Date.now();
    assert.ok(deltaMs > 23 * 3600 * 1000 && deltaMs <= 24 * 3600 * 1000 + 60 * 1000,
      "held_until roughly 24h out, got +" + Math.round(deltaMs / 3600000) + "h");
    assert.strictEqual(input.category, "dress", "text sniff keeps dress");
    assert.ok(/hold this one just for 24 hours|held for 24 hours|24hr hold/.test(r.text), "reply promises the hold");
    noSynthLeak(r, "new-evaluation reply");
    console.log("  pass: hold stored, expiry ~24h, reply promises hold");
  }

  // --- (b) confirmation with a live hold ---
  console.log("\n[(b) confirmation activates live hold]");
  {
    const held = [{ piece_id: "SYNTH_piece_001", status: "held", held_until: futureIso() }];
    const cat = mockCatalog(held, { active: [{ piece_id: "SYNTH_piece_002", category: "scarf" }] });
    const r = await Handler.handle({ catalog: cat, text: "I bought it!" });
    assert.deepStrictEqual(cat.calls.activatePiece, ["SYNTH_piece_001"], "held piece activated");
    assert.strictEqual(cat.calls.addPiece.length, 0, "no new piece fabricated");
    assert.strictEqual(cat.calls.save, 1, "catalog saved");
    assert.ok(/officially yours/.test(r.text), "reply confirms cataloguing: " + r.text.slice(0, 100));
    noSynthLeak(r, "confirmation reply");
    console.log("  pass: status flips to active, reply confirms, saved");
  }

  // --- (c) confirmation with an expired hold ---
  console.log("\n[(c) expired hold stays uncatalogued]");
  {
    const held = [{ piece_id: "SYNTH_piece_003", status: "held", held_until: pastIso() }];
    const cat = mockCatalog(held, { active: [] });
    const r = await Handler.handle({ catalog: cat, text: "I bought it" });
    assert.strictEqual(cat.calls.activatePiece.length, 0, "expired hold not activated");
    assert.strictEqual(cat.calls.addPiece.length, 0, "nothing fabricated");
    assert.strictEqual(cat.calls.save, 0, "no save-as-active");
    assert.ok(/lapsed/.test(r.text), "reply honest about lapse: " + r.text.slice(0, 120));
    noSynthLeak(r, "lapsed reply");
    console.log("  pass: expired hold untouched, honest lapse reply");
  }

  // --- (d) confirmation with nothing held ---
  console.log("\n[(d) nothing held]");
  {
    const cat = mockCatalog([], { active: [] });
    const r = await Handler.handle({ catalog: cat, text: "I got it" });
    assert.strictEqual(cat.calls.activatePiece.length, 0, "no activation");
    assert.strictEqual(cat.calls.addPiece.length, 0, "no catalogue mutation");
    assert.ok(/nothing on hold/.test(r.text), "honest nothing-held reply: " + r.text.slice(0, 120));
    noSynthLeak(r, "nothing-held reply");
    console.log("  pass: honest nothing-held reply, no mutation");
  }

  // --- (e) addPiece throws -> no hold promised ---
  console.log("\n[(e) catalog error falls back]");
  {
    const cat = mockCatalog([], { active: [], throwOnAdd: true });
    const r = await Handler.handle({ catalog: cat, text: "should I get this bag?", shareId: "SYNTH_share_102" });
    assert.ok(/no promises on the hold/.test(r.text), "fallback copy: " + r.text.slice(0, 120));
    assert.ok(!/hold this one just for 24 hours/.test(r.text) && !/held for 24 hours/.test(r.text) && !/24hr hold/.test(r.text),
      "fallback never claims a hold exists");
    noSynthLeak(r, "fallback reply");
    console.log("  pass: fallback copy, no false hold promise");
  }

  // --- (f) router confirmation trigger ---
  console.log("\n[(f) router confirmation trigger]");
  {
    const phrases = ["I bought it", "i got it!", "I bought that", "bought it", "I picked it up"];
    for (const text of phrases) {
      const r = Router.classifySync({ text: text });
      assert.strictEqual(r.skill, "Evaluate_prospective_purchase", "routes '" + text + "' -> " + r.skill);
      assert.ok(r.confidence >= 70, "confidence >= 70 for '" + text + "', got " + r.confidence);
    }
    const still = Router.classifySync({ text: "should i get this?" });
    assert.strictEqual(still.skill, "Evaluate_prospective_purchase", "generic trigger intact");
    console.log("  pass: confirmation phrases route at >= 70, generic trigger intact");
  }

  // --- (g) end-to-end against the real catalog ---
  console.log("\n[(g) real-catalog hold lifecycle]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_hold_e2e" });
    cat.addPiece({ category: "scarf", attributes: {}, source_share_id: "SYNTH_share_201" });
    const r1 = await Handler.handle({ catalog: cat, text: "should I get this dress?", shareId: "SYNTH_share_202" });
    assert.ok(/24 hours/.test(r1.text) || /24hr/.test(r1.text), "hold promised");
    assert.strictEqual(cat.getActivePieces().length, 1, "held piece hidden from getActivePieces()");
    const held = cat.getPieces({ status: "held" });
    assert.strictEqual(held.length, 1, "one held piece stored");
    assert.ok(Date.parse(held[0].held_until) - Date.now() > 23 * 3600 * 1000, "held_until ~24h out");
    const r2 = await Handler.handle({ catalog: cat, text: "I bought it", shareId: "SYNTH_share_203" });
    assert.ok(/officially yours/.test(r2.text), "confirmation reply");
    assert.strictEqual(cat.getActivePieces().length, 2, "confirmed piece now active");
    assert.strictEqual(cat.getPieces({ status: "held" }).length, 0, "no held pieces remain");
    assert.strictEqual(cat.getPiece(held[0].piece_id).held_until, null, "held_until cleared to null");
    noSynthLeak(r1, "e2e evaluation"); noSynthLeak(r2, "e2e confirmation");
    console.log("  pass: hold hidden until bought, then active with held_until null");
  }

  console.log("\nAll evaluate-purchase-hold tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
