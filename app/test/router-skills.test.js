"use strict";
/* Milestone 21 — router + skills + summariser tests (SYNTH only, example.invalid only). */
const assert = require("assert");
const Router = require("../router.js");
const Summariser = require("../summariser.js");
const Wardrobe = require("../wardrobe-catalog.js");

async function run() {
  console.log("Milestone 21 — router-skills.test.js");

// -- Router classifies all 11 + off_topic via synthetic messages
  console.log("\n[router]");
  {
    const cases = [
      [{text:"", imagePresent:true}, "catalogue_piece"],
      [{text:"show me a look please"}, "propose_look"],
      [{text:"without the blazer please"}, "revise_look"],
      [{text:"what do I have in my wardrobe?"}, "describe_wardrobe"],
      [{text:"why does this work?"}, "explain_fit"],
      [{text:"what fabric is this?"}, "answer_no_data"],
      [{text:"what is the weather today?"}, "off_topic"],
      [{text:"do this look inspiration", imagePresent:true}, "Match_look"],
      [{text:"what could i buy to complete the look"}, "Complete_the_look"],
      [{text:"what would suit me?"}, "What_suits"],
      [{text:"should i buy this?", imagePresent:true}, "Evaluate_prospective_purchase"],
    ];
    for (const [input, expected] of cases) {
      const r = Router.classifySync(input);
      assert.strictEqual(r.skill, expected, "classify " + JSON.stringify(input) + " -> " + r.skill + " != " + expected);
      console.log("  pass: " + expected + " from '" + (input.text||"(image)") + "'");
    }
    // Logging via logDecision
    Router.clearLog();
    Router.logDecision({ skill:"test", confidence:90, reason:"test" });
    assert.strictEqual(Router.getLog().length, 1, "logDecision/getLog");
    Router.clearLog();
    assert.strictEqual(Router.getLog().length, 0, "clearLog");
    console.log("  pass: router logging (logDecision/getLog/clearLog)");
  }

  // <70 triggers clarification
  console.log("\n[clarification]");
  {
    // Very short ambiguous message triggers clarification (<70)
    const r = Router.classifySync({text:"x"});
    // heuristic returns off_topic 82 for unknown text, but "x" is length 1 (<4) => 45
    assert.ok(r.confidence < 70, "short ambiguous confidence <70, got " + r.confidence);
    assert.ok(typeof r.clarification === "string" && r.clarification.length>0, "clarification text present");
    console.log("  pass: <70 -> clarification: " + r.clarification.slice(0,50));

    const r2 = Router.classifySync({text:"hi"});
    assert.ok(r2.confidence < 70 && r2.clarification, "greeting -> clarification");
    console.log("  pass: greeting -> clarification");

    const r3 = Router.classifySync({text:"look"});
    assert.ok(r3.confidence < 70 && r3.clarification, "ambiguous single word -> clarification");
    console.log("  pass: ambiguous single word -> clarification");
  }

  // Each handler returns correct shape, no long IDs, no invented listings
  console.log("\n[handlers]");
  function noLongIds(text){
    assert.ok(!/SYNTH_/.test(text), "handler text must not leak SYNTH_ ids: " + text.slice(0,120));
  }
  function noInventedListing(text){
    if (/vinted\.co\.uk/.test(text)) assert.ok(/vinted\.co\.uk\/search\?q=/.test(text), "only generic Vinted search allowed");
    assert.ok(!/ebay\.|etsy\.|depop\./i.test(text), "no other marketplace links");
  }

  const handlerNames = Router.SKILL_NAMES;
  for (const name of handlerNames) {
    const mod = require("../skills/" + name + "/handler.js");
    assert.ok(mod && typeof mod.handle === "function", name + " has handle");
    const cat = Wardrobe.createCatalog({ userKey: "SYNTH_test_" + name.replace(/[^a-zA-Z0-9]/g,"_") });
    try { cat.addPiece({ category:"dress", attributes:{}, source_share_id:"SYNTH_share_001" }); } catch(e){}
    try { cat.addPiece({ category:"scarf", attributes:{}, source_share_id:"SYNTH_share_002" }); } catch(e){}
    try { cat.addPiece({ category:"bag", attributes:{}, source_share_id:"SYNTH_share_003" }); } catch(e){}
    const opts = { catalog: cat, text: "hello test for " + name, imageDataUrl: null, imagePresent: false, history: [], summary:"", preferences:"" };
    if (name==="catalogue_piece"||name==="Match_look"||name==="Evaluate_prospective_purchase"||name==="What_suits") opts.imageDataUrl = "data:image/png;base64,SYNTH_fake";
    const res = await mod.handle(opts);
    assert.ok(res && typeof res.text === "string" && res.text.length>0, name + " returns text");
    noLongIds(res.text);
    noInventedListing(res.text);
    console.log("  pass: " + name + " shape + no IDs/listings");
  }

  // Specific invariants
  console.log("\n[invariants]");
  {
    const cat = Wardrobe.createCatalog({ userKey:"SYNTH_match_no_catalog" });
    cat.addPiece({ category:"dress", attributes:{}, source_share_id:"SYNTH_share_001" });
    const before = cat.getActivePieces().length;
    const h = require("../skills/Match_look/handler.js");
    await h.handle({ catalog: cat, text:"help me do this look", imageDataUrl:"data:image/png;base64,SYNTH_inspo", imagePresent:true });
    assert.strictEqual(cat.getActivePieces().length, before, "Match_look must not add pieces");
    console.log("  pass: Match_look doesn't catalogue");
  }
  {
    const cat = Wardrobe.createCatalog({ userKey:"SYNTH_vinted" });
    cat.addPiece({ category:"dress", attributes:{}, source_share_id:"SYNTH_share_001" });
    const h = require("../skills/Complete_the_look/handler.js");
    const r = await h.handle({ catalog: cat, text:"complete the look", imagePresent:false });
    assert.ok(r.text.includes("https://www.vinted.co.uk/search?q="), "Vinted search URL present: " + r.text.slice(0,200));
    console.log("  pass: Complete_the_look generic Vinted URL");
  }
  {
    const h = require("../skills/off_topic/handler.js");
    const r = await h.handle({ catalog: Wardrobe.createCatalog({userKey:"SYNTH_off"}), text:"weather", imagePresent:false });
    assert.ok(r.text.includes("https://codepilots.co.uk/secondbloom/guide.html"), "guide link present");
    console.log("  pass: off_topic guide link");
  }
  {
    const cat = Wardrobe.createCatalog({ userKey:"SYNTH_cat_piece" });
    const h = require("../skills/catalogue_piece/handler.js");
    const r = await h.handle({ catalog: cat, text:"", imageDataUrl:"data:image/png;base64,SYNTH_img", imagePresent:true });
    assert.ok(/Got your/i.test(r.text), "catalogue_piece Got your: " + r.text.slice(0,80));
    assert.ok(!/SYNTH_/.test(r.text), "no SYNTH_ leak");
    console.log("  pass: catalogue_piece Got your + no IDs");
  }
  {
    const cat = Wardrobe.createCatalog({ userKey:"SYNTH_eval" });
    cat.addPiece({ category:"dress", attributes:{}, source_share_id:"SYNTH_share_001" });
    cat.addPiece({ category:"scarf", attributes:{}, source_share_id:"SYNTH_share_002" });
    const h = require("../skills/Evaluate_prospective_purchase/handler.js");
    const r = await h.handle({ catalog: cat, imagePresent:true, imageDataUrl:"data:image/png;base64,SYNTH_prospective" });
    assert.ok(/1\./.test(r.text) && /2\./.test(r.text), "2-3 outfits listed");
    assert.ok(/24/.test(r.text), "24hr hold note");
    assert.strictEqual(r.image, null, "preview null (text-first)");
    console.log("  pass: Evaluate_prospective_purchase text-first + 24hr");
  }
  {
    const h = require("../skills/What_suits/handler.js");
    const r1 = await h.handle({ catalog: Wardrobe.createCatalog({userKey:"SYNTH_suits1"}), imagePresent:false });
    assert.ok(/consent/i.test(r1.text) || /share/i.test(r1.text), "consent gate");
    const r2 = await h.handle({ catalog: Wardrobe.createCatalog({userKey:"SYNTH_suits2"}), imagePresent:true, imageDataUrl:"data:image/png;base64,SYNTH_head" });
    assert.ok(!/fat|overweight|ugly|shame/i.test(r2.text), "never body-shaming");
    console.log("  pass: What_suits consent + not shaming");
  }

  // Summariser truncates to 100 tokens
  console.log("\n[summariser]");
  {
    const long = Array(150).fill("word").join(" ");
    const truncated = Summariser.truncateTokens(long, 100);
    // truncateTokens uses char-based (100*4=400 chars), so check it's shorter than input
    assert.ok(truncated.length < long.length, "truncate reduces long text");
    assert.ok(truncated.length <= 400, "truncate <=400 chars (100 tokens *4)");
    console.log("  pass: summariser truncates to 100 tokens (~400 chars)");

    const s = Summariser.buildSummary({ previousSummary:"", lastUserText: long, skill:"propose_look", replyText: long, piecesCount: 3 });
    assert.ok(s.length <= 400, "buildSummary <=400 chars");
    console.log("  pass: buildSummary <=100 tokens");

    const p = Summariser.buildPreferences({ previousPreferences:"", preferencesDelta:"loves lilac" });
    assert.ok(p.includes("lilac"), "preferences delta");
    console.log("  pass: buildPreferences");

    // persist via injected store: honest non-persisted result (Opus finding
    // #10 — the catalog contract is pieces-array-only, so a metadata PUT
    // is impossible without changing its documented shape)
    const fakeStore = { base:"http://127.0.0.1:8904", userRef:"u_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", save: (pieces)=> Promise.resolve({ok:true}) };
    const pr = await Summariser.persistViaStore(fakeStore, "hello summary", "lilac");
    assert.strictEqual(pr.ok, false, "persistViaStore must not report success for a no-op");
    assert.strictEqual(pr.error, "not_persisted", "explicit not_persisted error");
    const prNoStore = await Summariser.persistViaStore(null, "hello summary", "lilac");
    assert.strictEqual(prNoStore.ok, false, "no store -> not ok");
    assert.strictEqual(prNoStore.error, "no_store", "no-store error stays distinct");
    console.log("  pass: summariser honestly reports not_persisted (memory-only)");

    const tr = await Summariser.summariseTurn({ previousSummary:"", previousPreferences:"", lastUserText:"hello", skill:"propose_look", replyText:"lovely look", piecesCount:2, preferencesDelta:"loves green" });
    assert.ok(typeof tr.summary === "string" && tr.summary.length>0, "summariseTurn summary");
    assert.ok(typeof tr.preferences === "string", "summariseTurn preferences");
    console.log("  pass: summariseTurn");
  }

  // Check prompt.md and persona.md exist
  console.log("\n[prompt files]");
  {
    const fs = require("fs");
    for (const name of handlerNames) {
      const p = "app/skills/" + name + "/prompt.md";
      assert.ok(fs.existsSync(p), p + " exists");
    }
    assert.ok(fs.existsSync("app/skills/persona.md"), "persona.md exists");
    // off_topic prompt must contain guide URL
    assert.ok(fs.readFileSync("app/skills/off_topic/prompt.md","utf8").includes("https://codepilots.co.uk/secondbloom/guide.html"), "off_topic prompt has guide link");
    console.log("  pass: all 11 prompt.md + persona.md exist, off_topic has guide link");
  }

  console.log("\nAll Milestone 21 tests passed.");
}

run().catch(e => { console.error(e.stack||e); process.exit(1); });
