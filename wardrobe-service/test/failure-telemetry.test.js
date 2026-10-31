"use strict";
/* failure telemetry — service activity honesty + agentic_recent. SYNTH fixtures */
const assert = require("assert");
const http = require("http");
const TOKEN="SYNTH_mock_token";
const PROXY_BASE="http://127.0.0.1:59999";

function tinyDataUrl(){ return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="; }

async function startFakeBot(shares){
  return new Promise((resolve,reject)=>{
    const server=http.createServer((req,res)=>{
      const url=new URL(req.url,"http://127.0.0.1");
      const auth=req.headers.authorization||"";
      if(auth!=="Bearer "+TOKEN){ res.writeHead(401); res.end("{}"); return; }
      if(req.method==="GET"&&url.pathname.startsWith("/ig/deletion-status/")){ res.writeHead(200,{"Content-Type":"application/json"}); res.end(JSON.stringify({scrubbed:false})); return; }
      if(req.method==="GET"&&url.pathname.startsWith("/ig/catalog/")){ res.writeHead(200,{"Content-Type":"application/json"}); res.end(JSON.stringify({pieces:[]})); return; }
      if(req.method==="PUT"&&url.pathname.startsWith("/ig/catalog/")){ res.writeHead(200,{"Content-Type":"application/json"}); res.end(JSON.stringify({})); return; }
      if(req.method==="GET"&&url.pathname==="/ig/shares"){ res.writeHead(200,{"Content-Type":"application/json"}); res.end(JSON.stringify({ items: shares, next_cursor: null })); return; }
      if(req.method==="POST"&&url.pathname==="/ig/send"){ res.writeHead(200,{"Content-Type":"application/json"}); res.end(JSON.stringify({ message_id:"SYNTH_mid_001" })); return; }
      if(req.method==="POST"&&(url.pathname.startsWith("/mock/stage-outbound-image/")||url.pathname.startsWith("/ig/outbound-stage/"))){ res.writeHead(200,{"Content-Type":"application/json"}); res.end(JSON.stringify({})); return; }
      if(req.method==="GET"&&url.pathname.startsWith("/ig/media/")){ res.writeHead(200,{"Content-Type":"image/jpeg"}); res.end(Buffer.from("fake")); return; }
      res.writeHead(404); res.end("{}");
    });
    server.listen(0,"127.0.0.1",()=>resolve(server));
  });
}

async function run(){
  console.log("failure-telemetry.test.js (service)");
  const realFetch=global.fetch;
  const now=new Date().toISOString();
  // Make agentic loop route to catalogue_piece and exercise failure path:
  // We stub global.fetch for proxy to force fallback classification but also need to force addPiece to throw.
  // Instead we directly test the service activity line via a controlled handler mock:
  // Patch catalogue_piece handler to throw, then run processOne via agentic loop.
  // Simpler: we inject a failing catalog by patching wardrobe-catalog createCatalog.

  // Approach: start fake bot with one photo share, then monkey-patch Wardrobe.createCatalog to return throwing catalog
  const shares=[{ id:"SYNTH_share_svc_fail_1", received_at: now, attachment:{ type:"image", payload:{} }, media_id:"SYNTH_media_1", user_ref: "u_"+"a".repeat(32) }];
  const bot=await startFakeBot(shares);
  const botBase="http://127.0.0.1:"+bot.address().port;

  // Patch Wardrobe.createCatalog to throw on addPiece
  const Wardrobe=require("../../app/wardrobe-catalog.js");
  const origCreate=Wardrobe.createCatalog;
  Wardrobe.createCatalog=function(opts){
    const cat=origCreate(opts);
    const origAdd=cat.addPiece.bind(cat);
    cat.addPiece=function(input){
      // force category failure
      throw new Error("wardrobe-catalog: category must be a fixed taxonomy term (base/top, base/bottom, dress, layer/cardigan, layer/blazer, scarf, bag)");
    };
    return cat;
  };
  // Also need to handle proxy unreachable
  global.fetch=function(url,opts){
    const u=String(url);
    if(u.indexOf(PROXY_BASE)===0) return Promise.reject(new Error("proxy unreachable"));
    return realFetch(url,opts);
  };

  delete require.cache[require.resolve("../server.js")];
  const Service=require("../server.js");
  const svc=Service.createService({ botBase, proxyBase: PROXY_BASE, readToken:TOKEN, catalogToken:TOKEN, sendToken:TOKEN, port:0, nowMs: Date.now, mode:"mock" });

  // Process the failing share
  const item=shares[0];
  const outcome=await svc.processOne(item);
  assert.ok(outcome.startsWith("terminal:"), "outcome terminal "+outcome);

  const status=svc.status();
  // activity contains failure line
  const acts=status.activity.join("\n");
  assert.ok(acts.includes("Couldn't catalogue that photo"), "activity honest failure line, got "+acts);
  assert.ok(!acts.includes("Catalogued a piece from your photo."), "must NOT contain success line, got "+acts);
  console.log("  pass: activity honest on failure");

  // agentic_recent
  assert.ok(Array.isArray(status.agentic_recent), "agentic_recent array");
  assert.ok(status.agentic_recent.length>=1 && status.agentic_recent.length<=10, "agentic_recent length 1..10");
  for(const e of status.agentic_recent){
    assert.ok(typeof e.skill==="string", "skill string");
    assert.ok(typeof e.steps==="number", "steps number");
    assert.ok(Array.isArray(e.tools), "tools array");
    assert.ok(typeof e.outcome==="string", "outcome string");
    // tools only names, no id-like fragments
    const j=JSON.stringify(e);
    assert.ok(!/SYNTH_/i.test(j), "no SYNTH leak "+j);
    // also assert no long id fragments (share/mid)
    assert.ok(!/SYNTH_share/i.test(j), "no share id");
    assert.ok(!/mid/i.test(j) || e.skill==="catalogue_piece", "no mid fragment"); // allow mid substring in skill names? just check SYNTH
  }
  console.log("  pass: agentic_recent shape no-leak");

  // restore
  Wardrobe.createCatalog=origCreate;
  global.fetch=realFetch;
  await new Promise(r=>bot.close(r));
  console.log("\nAll failure-telemetry service tests passed.");
}
run().catch(e=>{ console.error(e.stack||e); process.exit(1); });
