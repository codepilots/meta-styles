"use strict";
/* meta-styles Opus finding #6 — look turn-recording tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves propose_look and revise_look actually record turns via
 * catalog.recordTurn (production never did — getTurns() was always []
 * outside the dead turn-loop.js), so explain_fit's catalog fallback and
 * the live Spark router prompt have real data:
 *   (a) propose_look success records verdict:true + proposal pieces/note;
 *   (b) propose_look with nothing valid records verdict:false, null
 *       proposal, non-empty reasons;
 *   (c) propose_look records Spark rejection reasons when candidates were
 *       turned down (even on an eventual valid pick);
 *   (d) revise_look success records verdict:true + proposal;
 *   (e) revise_look clarification records verdict:false + null proposal.
 * All catalogs/ids synthetic (SYNTH_ prefix) — never real data. No network.
 *
 * Run: node app/test/look-turn-recording.test.js
 */
const assert = require("node:assert");
const ProposeLook = require("../skills/propose_look/handler.js");
const ReviseLook = require("../skills/revise_look/handler.js");
const Wardrobe = require("../wardrobe-catalog.js");

function seed(cat, cats) {
  cats.forEach(function (c, i) {
    cat.addPiece({ category: c, attributes: {}, source_share_id: "SYNTH_share_tr_" + i });
  });
}

async function run() {
  console.log("Opus finding #6 — look-turn-recording.test.js");

  // --- (a) propose_look success records a valid turn ---
  console.log("\n[(a) propose_look success -> verdict:true + proposal]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_tr_a" });
    seed(cat, ["dress", "scarf", "bag"]);
    const r = await ProposeLook.handle({ catalog: cat, text: "show me a look" });
    assert.strictEqual(r.skill, "propose_look");
    const turns = cat.getTurns();
    assert.strictEqual(turns.length, 1, "one turn recorded, got " + turns.length);
    assert.strictEqual(turns[0].verdict, true, "verdict true on valid look");
    assert.strictEqual(turns[0].userText, "show me a look", "user text kept");
    assert.ok(turns[0].proposal && Array.isArray(turns[0].proposal.pieces), "proposal present");
    assert.strictEqual(turns[0].proposal.pieces.length, 3, "all three pieces: " + JSON.stringify(turns[0].proposal));
    assert.strictEqual(turns[0].proposal.note, "valid:scarf+bag", "note names finish, got " + turns[0].proposal.note);
    assert.ok(Array.isArray(turns[0].reasons), "reasons array present");
    console.log("  pass: success turn recorded with proposal + note=" + turns[0].proposal.note);
  }

  // --- (b) propose_look with nothing valid records verdict:false ---
  console.log("\n[(b) propose_look no-valid-look -> verdict:false, null proposal]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_tr_b" });
    seed(cat, ["base/top"]); // base but no finish -> nothing validates
    const r = await ProposeLook.handle({ catalog: cat, text: "show me a look" });
    assert.strictEqual(r.skill, "propose_look");
    const turns = cat.getTurns();
    assert.strictEqual(turns.length, 1, "rejected turn still recorded, got " + turns.length);
    assert.strictEqual(turns[0].verdict, false, "verdict false when no look");
    assert.strictEqual(turns[0].proposal, null, "no proposal on failure");
    assert.ok(turns[0].reasons.length > 0, "reasons populated: " + JSON.stringify(turns[0].reasons));
    console.log("  pass: rejected turn recorded, reasons=" + JSON.stringify(turns[0].reasons));
  }

  // --- (c) Spark rejections are kept even on an eventual valid pick ---
  console.log("\n[(c) spark rejections kept as reasons on valid pick]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_tr_c" });
    seed(cat, ["dress", "layer/cardigan"]);
    const badThenGood = {
      assemble: function () {
        return Promise.resolve({
          looks: [
            { pieceIds: ["SYNTH_piece_nope"], rationale: "SYNTH bad pick" },
            { pieceIds: null, rationale: "SYNTH empty pick" },
          ],
        });
      },
    };
    const r = await ProposeLook.handle({ catalog: cat, text: "show me a look", metaClient: badThenGood });
    assert.strictEqual(r.skill, "propose_look");
    const turns = cat.getTurns();
    assert.strictEqual(turns.length, 1, "turn recorded");
    assert.strictEqual(turns[0].verdict, true, "fallback still found dress+cardigan");
    assert.ok(turns[0].reasons.length > 0, "spark rejections kept: " + JSON.stringify(turns[0].reasons));
    assert.ok(turns[0].reasons.some(function (x) { return /^spark_rejected:/.test(x); }),
      "reasons name the spark rejection: " + JSON.stringify(turns[0].reasons));
    console.log("  pass: reasons=" + JSON.stringify(turns[0].reasons));
  }

  // --- (d) revise_look success records a valid turn ---
  console.log("\n[(d) revise_look success -> verdict:true + proposal]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_tr_d" });
    seed(cat, ["dress", "layer/cardigan", "scarf", "bag"]);
    const r = await ReviseLook.handle({ catalog: cat, text: "drop the scarf please" });
    assert.strictEqual(r.skill, "revise_look");
    const turns = cat.getTurns();
    assert.strictEqual(turns.length, 1, "one turn recorded, got " + turns.length);
    assert.strictEqual(turns[0].verdict, true, "verdict true, remaining look valid: " + r.text.slice(0, 120));
    assert.ok(turns[0].proposal && Array.isArray(turns[0].proposal.pieces), "proposal present");
    assert.strictEqual(turns[0].proposal.pieces.length, 3, "three remaining pieces: " + JSON.stringify(turns[0].proposal));
    assert.strictEqual(turns[0].proposal.note, "valid:layer", "note names finish, got " + turns[0].proposal.note);
    console.log("  pass: revise turn recorded with proposal + note=" + turns[0].proposal.note);
  }

  // --- (e) revise_look clarification records verdict:false ---
  console.log("\n[(e) revise_look clarification -> verdict:false, null proposal]");
  {
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_tr_e" });
    seed(cat, ["dress", "layer/cardigan"]);
    const r = await ReviseLook.handle({ catalog: cat, text: "hello there" });
    assert.strictEqual(r.skill, "revise_look");
    const turns = cat.getTurns();
    assert.strictEqual(turns.length, 1, "clarification turn still recorded, got " + turns.length);
    assert.strictEqual(turns[0].verdict, false, "verdict false on clarification");
    assert.strictEqual(turns[0].proposal, null, "no proposal on clarification");
    assert.ok(turns[0].reasons.length > 0, "reasons populated: " + JSON.stringify(turns[0].reasons));
    console.log("  pass: clarification turn recorded, reasons=" + JSON.stringify(turns[0].reasons));
  }

  console.log("\nAll look-turn-recording tests passed.");
}

run().catch((e) => { console.error(e.stack || e); process.exit(1); });
