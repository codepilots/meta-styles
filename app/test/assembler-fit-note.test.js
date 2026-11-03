"use strict";
/* meta-styles Milestone 23 item 2 — per-finish fit-note tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves assembleLook returns the fitNote variant matching the look's own
 * computed finish:
 *   (a) a valid layer-finish look gets the layer note ("worn open");
 *   (b) a valid scarf+bag-finish look gets the scarf+bag note ("tied
 *       high", waist mechanic) and never claims layers "worn open";
 *   (c) all four variants keep the real confirmed specs (tall/curvy 6'2",
 *       18 top / 12 bottom) and the Y2K x fairycore line, with the stale
 *       "(placeholder)" label gone;
 *   (d) the old single FIT_NOTE export stays a sane default string
 *       (backward compatibility — the only in-repo importer, explain_fit,
 *       now picks per-finish via FIT_NOTES with FIT_NOTE as fallback);
 *   (f) a valid scarf-only look gets the scarf note ("tied high", never
 *       "worn open");
 *   (g) a valid bag-only look gets the bag note ("waist", never
 *       "worn open");
 *   (e) per-piece resale-listing copy stays honestly placeholder-marked
 *       (untouched by this fix).
 * No network. Fixture items match milestone14's valid-look shape.
 *
 * Run: node app/test/assembler-fit-note.test.js
 */
const path = require("path");
const assert = require("node:assert");

require(path.resolve(__dirname, "../assembler.js"));
const MS = globalThis.MetaStyles;

function look(items) {
  return MS.assembleLook(items.map(([id, category]) => ({
    id, category, copy: { text: "SYNTH copy for " + category, placeholder: true },
  })));
}

async function run() {
  console.log("Milestone 23 item 2 — assembler-fit-note.test.js");

  // --- (a) layer finish ---
  console.log("\n[(a) layer look -> layer note]");
  {
    const card = look([["SYNTH_a", "dress"], ["SYNTH_b", "layer/cardigan"]]);
    assert.strictEqual(card.valid, true, "layer look valid");
    assert.strictEqual(card.finish, "layer", "finish layer");
    assert.strictEqual(card.fitNote, MS.FIT_NOTE_LAYER, "fitNote is the layer variant");
    assert.ok(/worn open/.test(card.fitNote), "layer mechanic present");
    assert.ok(!/\(placeholder\)/i.test(card.fitNote), "stale placeholder label gone");
    console.log("  pass: layer variant attached");
  }

  // --- (b) scarf+bag finish ---
  console.log("\n[(b) scarf+bag look -> scarf+bag note]");
  {
    const card = look([["SYNTH_a", "base/top"], ["SYNTH_b", "scarf"], ["SYNTH_c", "bag"]]);
    assert.strictEqual(card.valid, true, "scarf+bag look valid");
    assert.strictEqual(card.finish, "scarf+bag", "finish scarf+bag");
    assert.strictEqual(card.fitNote, MS.FIT_NOTE_SCARF_BAG, "fitNote is the scarf+bag variant");
    assert.ok(/tied high/.test(card.fitNote), "scarf mechanic present");
    assert.ok(/waist/.test(card.fitNote), "waist mechanic present");
    assert.ok(!/worn open/.test(card.fitNote), "never claims layers worn open for scarf+bag");
    assert.ok(!/\(placeholder\)/i.test(card.fitNote), "stale placeholder label gone");
    assert.notStrictEqual(card.fitNote, MS.FIT_NOTE_LAYER, "variants differ");
    console.log("  pass: scarf+bag variant attached, no false layer claim");
  }

  // --- (c) shared real specs in all variants ---
  console.log("\n[(c) real specs + aesthetic in all]");
  {
    for (const [label, note] of [["layer", MS.FIT_NOTE_LAYER], ["scarf+bag", MS.FIT_NOTE_SCARF_BAG], ["scarf", MS.FIT_NOTE_SCARF], ["bag", MS.FIT_NOTE_BAG]]) {
      assert.ok(/6'2"/.test(note), label + ": tall/curvy 6'2\" kept");
      assert.ok(/18 top \/ 12 bottom/.test(note), label + ": 18 top / 12 bottom kept");
      assert.ok(/fairycore/.test(note), label + ": Y2K x fairycore kept");
    }
    console.log("  pass: specs + fairycore in all variants");
  }

  // --- (d) backward compatibility ---
  console.log("\n[(d) FIT_NOTE default export intact]");
  {
    assert.strictEqual(typeof MS.FIT_NOTE, "string", "FIT_NOTE still a string");
    assert.strictEqual(MS.FIT_NOTE, MS.FIT_NOTE_LAYER, "default is the layer variant (closest to old text)");
    assert.ok(MS.FIT_NOTES && MS.FIT_NOTES.layer === MS.FIT_NOTE_LAYER &&
      MS.FIT_NOTES["scarf+bag"] === MS.FIT_NOTE_SCARF_BAG &&
      MS.FIT_NOTES.scarf === MS.FIT_NOTE_SCARF &&
      MS.FIT_NOTES.bag === MS.FIT_NOTE_BAG, "FIT_NOTES map covers all four finishes");
    assert.strictEqual(typeof MS.fitNoteFor, "function", "fitNoteFor exported");
    assert.strictEqual(MS.fitNoteFor("scarf+bag"), MS.FIT_NOTE_SCARF_BAG, "fitNoteFor scarf+bag");
    assert.strictEqual(MS.fitNoteFor("scarf"), MS.FIT_NOTE_SCARF, "fitNoteFor scarf");
    assert.strictEqual(MS.fitNoteFor("bag"), MS.FIT_NOTE_BAG, "fitNoteFor bag");
    assert.strictEqual(MS.fitNoteFor("layer"), MS.FIT_NOTE_LAYER, "fitNoteFor layer");
    assert.strictEqual(MS.fitNoteFor(null), MS.FIT_NOTE_LAYER, "unknown finish falls back to default");
    console.log("  pass: FIT_NOTE string default + FIT_NOTES map");
  }

  // --- (f) scarf-only finish ---
  console.log("\n[(f) scarf look -> scarf note]");
  {
    const card = look([["SYNTH_a", "dress"], ["SYNTH_b", "scarf"]]);
    assert.strictEqual(card.valid, true, "scarf look valid");
    assert.strictEqual(card.finish, "scarf", "finish scarf");
    assert.strictEqual(card.fitNote, MS.FIT_NOTE_SCARF, "fitNote is the scarf variant");
    assert.ok(/tied high/.test(card.fitNote), "scarf mechanic present");
    assert.ok(!/worn open/.test(card.fitNote), "never claims layers worn open for scarf");
    assert.ok(!/\(placeholder\)/i.test(card.fitNote), "stale placeholder label gone");
    assert.notStrictEqual(card.fitNote, MS.FIT_NOTE_LAYER, "variants differ");
    console.log("  pass: scarf variant attached, no false layer claim");
  }

  // --- (g) bag-only finish ---
  console.log("\n[(g) bag look -> bag note]");
  {
    const card = look([["SYNTH_a", "base/top"], ["SYNTH_b", "base/bottom"], ["SYNTH_c", "bag"]]);
    assert.strictEqual(card.valid, true, "bag look valid");
    assert.strictEqual(card.finish, "bag", "finish bag");
    assert.strictEqual(card.fitNote, MS.FIT_NOTE_BAG, "fitNote is the bag variant");
    assert.ok(/waist/.test(card.fitNote), "waist mechanic present");
    assert.ok(!/worn open/.test(card.fitNote), "never claims layers worn open for bag");
    assert.ok(!/tied high/.test(card.fitNote), "no scarf mechanic for a bag look");
    assert.ok(!/\(placeholder\)/i.test(card.fitNote), "stale placeholder label gone");
    assert.notStrictEqual(card.fitNote, MS.FIT_NOTE_LAYER, "variants differ");
    console.log("  pass: bag variant attached, no false layer or scarf claim");
  }

  // --- (e) per-piece placeholder provenance untouched ---
  console.log("\n[(e) per-piece copy still placeholder-marked]");
  {
    const card = look([["SYNTH_a", "dress"], ["SYNTH_b", "layer/cardigan"]]);
    assert.strictEqual(card.placeholder, true, "card stays placeholder");
    assert.ok(/invented/.test(card.placeholderNote), "placeholderNote still says invented");
    assert.ok(card.wordCount <= MS.MAX_WORDS, "card within word budget, got " + card.wordCount);
    console.log("  pass: resale-copy placeholder flags unchanged");
  }

  console.log("\nAll assembler-fit-note tests passed.");
}

run().catch((e) => { console.error(e.stack || e); process.exit(1); });
