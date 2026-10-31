"use strict";
/* failure telemetry — handler addFailure classification. SYNTH fixtures, stdlib only */
const assert = require("assert");
const Handler = require("../skills/catalogue_piece/handler.js");

const DURL = "data:image/png;base64,SYNTH_failure_telemetry_bytes";

function throwingCatalog(msg) {
  return {
    addPiece: function () { throw new Error(msg); },
    save: async function () { return { ok: true }; },
  };
}

async function run(){
  console.log("failure-telemetry.test.js (handler)");

  // category kind
  {
    const cat = throwingCatalog("wardrobe-catalog: category must be a fixed taxonomy term (base/top, base/bottom, dress, layer/cardigan, layer/blazer, scarf, bag)");
    const r = await Handler.handle({ catalog: cat, text: "SYNTH dress", imageDataUrl: DURL, shareId: "SYNTH_share_ft_cat" });
    assert.ok(r.meta && r.meta.addFailure, "meta.addFailure present");
    assert.strictEqual(r.meta.addFailure.kind, "category", "kind category got "+r.meta.addFailure.kind);
    assert.ok(typeof r.meta.addFailure.detail==="string" && r.meta.addFailure.detail.length>0, "detail present");
    assert.ok(r.text.includes("couldn't get that piece tucked"), "failText unchanged, got "+r.text);
    assert.ok(!/SYNTH_/.test(r.meta.addFailure.detail), "detail sanitized no SYNTH");
    console.log("  pass: category kind");
  }

  // original kind
  {
    const cat = throwingCatalog("wardrobe-catalog: image_original must be a PNG/JPEG data URL");
    const r = await Handler.handle({ catalog: cat, text: "", imageDataUrl: DURL, shareId: "SYNTH_share_ft_orig" });
    assert.ok(r.meta && r.meta.addFailure, "meta.addFailure present");
    assert.strictEqual(r.meta.addFailure.kind, "original", "kind original got "+r.meta.addFailure.kind);
    assert.ok(r.text.includes("couldn't get that piece tucked"), "failText unchanged");
    console.log("  pass: original kind");
  }

  // also test thumb, hash, shape, duplicate classification via direct stub (single-piece path covers all)
  const cases = [
    ["wardrobe-catalog: photo_thumb must be a small PNG/JPEG data URL", "thumb"],
    ["wardrobe-catalog: crop_hash must be a 16-hex-char string", "hash"],
    ["wardrobe-catalog: field names must be known", "shape"],
    ["wardrobe-catalog: duplicate piece_id 'SYNTH_piece_001'", "duplicate"],
  ];
  for(const [msg, expected] of cases){
    const cat = throwingCatalog(msg);
    const r = await Handler.handle({ catalog: cat, text: "", imageDataUrl: DURL, shareId: "SYNTH_share_ft_"+expected });
    assert.strictEqual(r.meta.addFailure.kind, expected, expected+" got "+r.meta.addFailure.kind);
  }
  console.log("  pass: thumb/hash/shape/duplicate kinds");

  // handleAddDetected path
  {
    const cat2 = throwingCatalog("wardrobe-catalog: category must be a fixed taxonomy term");
    // need getPieces and getPendingQuestions for handleAddDetected
    cat2.getPieces = function(){ return []; };
    cat2.getPendingQuestions = function(){ return [{ id:"SYNTH_q_001", skill:"catalogue_piece", expects:"yes_no"}]; };
    cat2.resolveQuestion=function(){};
    cat2.save=async function(){ return {ok:true}; };
    const bag={ at: Date.now(), regions:[{ category:"dress", attributes:{}, bbox:[0.1,0.1,0.3,0.3], cropRect:[0.1,0.1,0.3,0.3], thumb:null, original:null, crop_hash:"aabbccddeeff0011", source_share_id:"SYNTH_share_ft_bag" }], source_share_id:"SYNTH_share_ft_bag" };
    const r2 = await Handler.handleAddDetected({ catalog: cat2, pendingBag: bag, shareId:"SYNTH_share_ft_bag", text:"yes" });
    assert.ok(r2.meta && r2.meta.addFailure, "handleAddDetected meta.addFailure");
    assert.strictEqual(r2.meta.addFailure.kind, "category");
    console.log("  pass: handleAddDetected category");
  }

  console.log("\nAll failure-telemetry handler tests passed.");
}
run().catch(function(e){ console.error(e.stack||e); process.exit(1); });
