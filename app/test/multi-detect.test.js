"use strict";
const assert = require("assert");
const Wardrobe = require("../wardrobe-catalog.js");
const Handler = require("../skills/catalogue_piece/handler.js");

function tinyPngDataUrl(){
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
}
function multiDetectClient(){
  return {
    detectGarments: async function(){ return { placeholder:false, pieces:[
      { category:"base/top", attributes:{ color:"sage" }, bbox:[0.1,0.1,0.3,0.3] },
      { category:"base/bottom", attributes:{ color:"black" }, bbox:[0.1,0.45,0.3,0.3] },
      { category:"bag", attributes:{ color:"brown" }, bbox:[0.6,0.6,0.2,0.2] }
    ]}; },
    classify: async function(){ return { category:"dress" }; },
    segment: async function(){ return { boxes:[] }; }
  };
}
function singleDetectClient(){
  return { detectGarments: async function(){ return { placeholder:false, pieces:[{ category:"dress", attributes:{}, bbox:[0,0,1,1] }] }; }, classify: async function(){ return { category:"dress" }; }, segment: async function(){ return { boxes:[] }; } };
}
function throwingDetectClient(){
  return { detectGarments: async function(){ throw new Error("SYNTH detect unavailable"); }, classify: async function(){ return { category:"dress" }; }, segment: async function(){ return { boxes:[] }; } };
}

async function run(){
  console.log("multi-detect.test.js");

  console.log("\n[multi-piece -> asked, nothing added]");
  {
    const cat=Wardrobe.createCatalog({ userKey:"SYNTH_user_multi_1_"+Date.now() });
    const r=await Handler.handle({ catalog:cat, text:"", imageDataUrl:tinyPngDataUrl(), shareId:"SYNTH_share_multi_1", metaClient: multiDetectClient(), pendingBag: {} });
    assert.ok(/Found 3 pieces/.test(r.text), "ask text, got "+r.text);
    assert.ok(/Shall I add all of them/.test(r.text));
    assert.ok(r.pendingBag && r.pendingBag.regions.length===3);
    assert.strictEqual(cat.getActivePieces().length,0);
    assert.ok(cat.getPendingQuestions().some(q=>q.skill==="catalogue_piece"&&q.expects==="yes_no"));
    for(const reg of r.pendingBag.regions){ assert.ok(/^[0-9a-f]{16}$/.test(reg.crop_hash), "crop_hash "+reg.crop_hash); }
    console.log("  pass");
  }

  console.log("\n[yes -> pieces added, crop_hash, look hook]");
  {
    const cat=Wardrobe.createCatalog({ userKey:"SYNTH_user_multi_yes_"+Date.now() });
    const img=tinyPngDataUrl();
    const r1=await Handler.handle({ catalog:cat, text:"", imageDataUrl:img, shareId:"SYNTH_share_multi_yes", metaClient: multiDetectClient(), pendingBag: {} });
    assert.ok(r1.pendingBag, "has bag");
    const rYes=await Handler.handle({ catalog:cat, text:"yes", imageDataUrl:null, metaClient: multiDetectClient(), pendingBag: r1.pendingBag });
    assert.ok(rYes.text, "yes reply");
    const pieces=cat.getActivePieces();
    assert.strictEqual(pieces.length,3, "3 pieces added, got "+pieces.length+" text="+rYes.text.slice(0,200));
    for(const p of pieces){ assert.ok(p.crop_hash&&/^[0-9a-f]{16}$/.test(p.crop_hash), "piece crop_hash "+p.crop_hash); }
    console.log("  pass");
  }

  console.log("\n[no -> nothing added]");
  {
    const cat=Wardrobe.createCatalog({ userKey:"SYNTH_user_multi_no_"+Date.now() });
    const r1=await Handler.handle({ catalog:cat, text:"", imageDataUrl:tinyPngDataUrl(), shareId:"SYNTH_share_multi_no", metaClient: multiDetectClient(), pendingBag: {} });
    const rNo=await Handler.handle({ catalog:cat, text:"no", imageDataUrl:null, metaClient: multiDetectClient(), pendingBag: r1.pendingBag });
    assert.ok(/No worries|left those out/i.test(rNo.text), "discard reply, got "+rNo.text);
    assert.strictEqual(cat.getActivePieces().length,0);
    console.log("  pass");
  }

  console.log("\n[duplicate re-offer -> asked again, dedupe on yes]");
  {
    const cat=Wardrobe.createCatalog({ userKey:"SYNTH_user_multi_dedupe_"+Date.now() });
    const img=tinyPngDataUrl();
    const r1=await Handler.handle({ catalog:cat, text:"", imageDataUrl:img, shareId:"SYNTH_share_dedupe_1", metaClient: multiDetectClient(), pendingBag: {} });
    await Handler.handle({ catalog:cat, text:"yes", imageDataUrl:null, metaClient: multiDetectClient(), pendingBag: r1.pendingBag });
    assert.strictEqual(cat.getActivePieces().length,3);
    const r2=await Handler.handle({ catalog:cat, text:"", imageDataUrl:img, shareId:"SYNTH_share_dedupe_2", metaClient: multiDetectClient(), pendingBag: {} });
    assert.ok(/Found 3 pieces/.test(r2.text), "asked again on re-offer");
    const rYes2=await Handler.handle({ catalog:cat, text:"yes", imageDataUrl:null, metaClient: multiDetectClient(), pendingBag: r2.pendingBag });
    assert.strictEqual(cat.getActivePieces().length,3, "dedupe: still 3, got "+cat.getActivePieces().length);
    assert.ok(/already in your wardrobe|keeping one copy/i.test(rYes2.text), "dedupe reply, got "+rYes2.text.slice(0,200));
    console.log("  pass");
  }

  console.log("\n[fallback: no metaClient -> single-piece path]");
  {
    const cat=Wardrobe.createCatalog({ userKey:"SYNTH_user_fallback_"+Date.now() });
    const r=await Handler.handle({ catalog:cat, text:"", imageDataUrl:tinyPngDataUrl(), shareId:"SYNTH_share_fallback_1", metaClient: null });
    assert.ok(/Got your|tucked safely/i.test(r.text), "single fallback success, got "+r.text.slice(0,100));
    assert.strictEqual(cat.getActivePieces().length,1);
    assert.ok(/^[0-9a-f]{16}$/.test(cat.getActivePieces()[0].crop_hash), "single also has crop_hash");
    console.log("  pass fallback null client");
  }
  {
    const cat=Wardrobe.createCatalog({ userKey:"SYNTH_user_fallback2_"+Date.now() });
    const r=await Handler.handle({ catalog:cat, text:"", imageDataUrl:tinyPngDataUrl(), shareId:"SYNTH_share_fallback_2", metaClient: throwingDetectClient() });
    assert.ok(/Got your|tucked safely/i.test(r.text), "throw detect fallback");
    assert.strictEqual(cat.getActivePieces().length,1);
    console.log("  pass fallback throw");
  }
  {
    const cat=Wardrobe.createCatalog({ userKey:"SYNTH_user_fallback3_"+Date.now() });
    // Contract since the combined-ask flow (decisions #12 addendum): the handler
    // defers even single-region detections to a pending bag; the SERVICE
    // auto-adds them immediately when the whole tick was single-region
    // (covered at service level in multi-detect-service.test.js + e2e).
    const r=await Handler.handle({ catalog:cat, text:"", imageDataUrl:tinyPngDataUrl(), shareId:"SYNTH_share_fallback_3", metaClient: singleDetectClient() });
    assert.ok(r.pendingBag && Array.isArray(r.pendingBag.regions) && r.pendingBag.regions.length===1, "single detect deferred to a 1-region bag");
    assert.strictEqual(cat.getActivePieces().length,0,"handler does not auto-add; service does");
    assert.ok(/Found \d+ piece/i.test(r.text), "ask text for the deferred region");
    console.log("  pass fallback single (deferred to service)");
  }

  console.log("\n[crop_hash schema]");
  {
    const cat=Wardrobe.createCatalog({ userKey:"SYNTH_user_schema_"+Date.now() });
    const p=cat.addPiece({ category:"dress", attributes:{}, source_share_id:"SYNTH_share_schema_1", crop_hash:"abcdef1234567890" });
    assert.strictEqual(p.crop_hash,"abcdef1234567890");
    assert.throws(()=>cat.addPiece({ category:"dress", attributes:{}, source_share_id:"SYNTH_share_schema_2", crop_hash:"bad" }), /crop_hash/);
    assert.throws(()=>cat.addPiece({ category:"dress", attributes:{}, source_share_id:"SYNTH_share_schema_3", crop_hash:"ZZZZZZZZZZZZZZZZ" }), /crop_hash/);
    console.log("  pass");
  }

  console.log("\nAll multi-detect handler tests passed.");
}
run().catch(e=>{ console.error(e.stack||e); process.exit(1); });
