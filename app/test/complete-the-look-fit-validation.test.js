"use strict";
/* meta-styles Opus finding #12 — Complete_the_look fit-validation tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves the gap suggestion is derived from the project's own fit engine
 * (app/assembler.js), never from ad-hoc hasScarf/hasBag booleans:
 *   (a) an active set that already assembles valid:true gets an honest
 *       already-complete reply — never a redundant gap suggestion;
 *   (a2) a wardrobe that is invalid as a whole but holds a valid subset
 *       names that subset as the already-complete look;
 *   (b) an incomplete set (lone scarf) gets the piece that answers the
 *       engine's own diagnosis (the bag partner), and the suggested fix
 *       independently validates via assembleLook;
 *   (b2) a bare base still gets the cheapest layer + the generic Vinted
 *       search link (router-skills + image-honesty compat);
 *   (c) a set no single addition can fix gets an honest no-single-fix
 *       reply quoting the engine's reasons — never an invented gap.
 * No network (no metaClient passed except where noted — same convention
 * as complete-the-look-image-honesty.test.js). All ids synthetic.
 */
const assert = require("assert");
const Wardrobe = require("../wardrobe-catalog.js");
const Handler = require("../skills/Complete_the_look/handler.js");
const Assembler = require("../assembler.js");

function catWith(cats, key) {
  const cat = Wardrobe.createCatalog({ userKey: key });
  cats.forEach(function (c, i) {
    cat.addPiece({ category: c, attributes: {}, source_share_id: "SYNTH_share_fit_" + key + "_" + i });
  });
  return cat;
}

function engineItems(active) {
  return active.map(function (p) {
    return { id: p.piece_id, category: p.category, copy: { text: "SYNTH " + p.category, placeholder: true, note: "test probe" } };
  });
}

function noLeak(r, label) {
  const dumped = JSON.stringify(r);
  assert.ok(!/SYNTH_/.test(r.text), label + " must not leak SYNTH_ ids: " + r.text.slice(0, 200));
  assert.ok(!/example\.invalid/.test(dumped), label + " must contain no example.invalid");
}

async function run() {
  console.log("complete-the-look-fit-validation.test.js");

  // --- (a) already-valid actives: honest complete reply, no gap ---
  console.log("\n[(a) valid actives get already-complete]");
  {
    const cat = catWith(["dress", "scarf", "bag"], "SYNTH_a");
    const r = await Handler.handle({ catalog: cat });
    assert.ok(/already make a complete look/.test(r.text), "honest complete copy: " + r.text.slice(0, 160));
    assert.ok(/different.*style direction/.test(r.text), "offers a different direction instead: " + r.text.slice(0, 220));
    assert.ok(!/vinted\.co\.uk\/search/.test(r.text), "no browse link when there is nothing to browse for");
    assert.ok(!/mini bag|pointelle|cropped blazer|ribbed cami|satin midi|slip dress|light-catching scarf/.test(r.text),
      "no gap-piece advice on a complete look: " + r.text.slice(0, 220));
    const card = Assembler.assembleLook(engineItems(cat.getActivePieces()));
    assert.strictEqual(card.valid, true, "engine independently agrees the set is valid");
    noLeak(r, "complete reply");
    console.log("  pass: honest complete copy, no redundant gap, engine agrees");
  }

  // --- (a2) invalid whole, valid subset: name the subset ---
  console.log("\n[(a2) valid subset named as the complete look]");
  {
    const cat = catWith(["dress", "scarf", "bag", "layer/cardigan"], "SYNTH_a2");
    const whole = Assembler.assembleLook(engineItems(cat.getActivePieces()));
    assert.strictEqual(whole.valid, false, "engine agrees the whole wardrobe is invalid (two finishes)");
    const r = await Handler.handle({ catalog: cat });
    assert.ok(/already make a complete look/.test(r.text), "honest complete copy: " + r.text.slice(0, 180));
    assert.ok(/dress \+ cardigan/.test(r.text), "names the actual valid subset: " + r.text.slice(0, 180));
    assert.ok(!/vinted\.co\.uk\/search/.test(r.text), "no browse link when no purchase is needed");
    noLeak(r, "subset reply");
    console.log("  pass: valid subset named, no purchase suggested");
  }

  // --- (b) real gap: lone scarf wants its bag partner ---
  console.log("\n[(b) lone scarf suggests the bag]");
  {
    const cat = catWith(["base/top", "base/bottom", "scarf"], "SYNTH_b");
    const before = Assembler.assembleLook(engineItems(cat.getActivePieces()));
    assert.strictEqual(before.valid, false, "engine agrees the set starts invalid");
    assert.ok(/scarf needs its bag partner/.test(before.reasons.join(" ")), "engine diagnoses the lone scarf");
    const r = await Handler.handle({ catalog: cat });
    assert.ok(/little silver bag/.test(r.text), "suggests the bag partner: " + r.text.slice(0, 120));
    assert.ok(/vinted\.co\.uk\/search\?q=silver%20metallic%20mini%20bag/.test(r.text), "generic Vinted search link kept");
    const fixed = Assembler.assembleLook(engineItems(cat.getActivePieces()).concat([{
      id: "SYNTH_hypo_bag", category: "bag",
      copy: { text: "SYNTH bag", placeholder: true, note: "test probe" }
    }]));
    assert.strictEqual(fixed.valid, true, "suggested addition independently turns the set valid:true");
    noLeak(r, "gap reply");
    console.log("  pass: bag suggested, Vinted link kept, fix validates");
  }

  // --- (b2) bare base: cheapest layer + Vinted link ---
  console.log("\n[(b2) bare dress suggests a cardigan]");
  {
    const cat = catWith(["dress"], "SYNTH_b2");
    const r = await Handler.handle({ catalog: cat });
    assert.ok(/cardigan/.test(r.text), "cheapest layer suggested: " + r.text.slice(0, 100));
    assert.ok(/vinted\.co\.uk\/search\?q=/.test(r.text), "generic Vinted search link kept");
    noLeak(r, "bare-base reply");
    console.log("  pass: cardigan gap + Vinted link");
  }

  // --- (c) no single addition fixes it: honest, engine-grounded ---
  console.log("\n[(c) unfixable set gets honest no-single-fix]");
  {
    const cat = catWith(["scarf"], "SYNTH_c");
    const r = await Handler.handle({ catalog: cat });
    assert.ok(/alone wouldn\u2019t finish this look/.test(r.text), "honest no-single-fix copy: " + r.text.slice(0, 160));
    assert.ok(/Missing base/.test(r.text), "quotes the engine's own reason");
    assert.ok(!/mini bag|pointelle|cropped blazer|ribbed cami|satin midi|slip dress|light-catching scarf/.test(r.text),
      "never invents a gap piece: " + r.text.slice(0, 240));
    noLeak(r, "no-fix reply");
    console.log("  pass: honest no-single-fix with engine reason");
  }

  console.log("\nAll Complete_the_look fit-validation tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
