"use strict";
/* meta-styles — stage colon regression (2026-10-31 bot commit 691bd8d/f8fbb49).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Bot-side repro: outbound-stage share=- status=400 when colon sent as %3A.
 * Fix: stageOutboundImage builds stage path with RAW share id verbatim.
 * Proves: fake stage server sees raw colon, no %3A, and staging succeeds
 * for composite ids <mid>:<media_id>.
 * SYNTH ids only, stdlib only, no secrets.
 */
const assert = require("assert");
const http = require("http");
const SendClient = require("../../app/send-client.js");

const TOKEN = "SYNTH_stage_colon_token";
const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const TINY_PNG = Buffer.from(TINY_PNG_B64, "base64");

function startFakeStageBot(){
  const seen = [];
  const staged = new Map();
  const shares = new Set(["SYNTH_mid_001:SYNTH_media_001", "SYNTH_mid_002:SYNTH_media_002"]);
  function sendJson(res, status, obj){
    const body = JSON.stringify(obj);
    res.writeHead(status, {"Content-Type":"application/json","Content-Length": Buffer.byteLength(body)});
    res.end(body);
  }
  const server = http.createServer((req,res)=>{
    seen.push(req.method+" "+req.url);
    if(req.headers.authorization !== "Bearer "+TOKEN){ req.resume(); sendJson(res,401,{error:"unauthorized"}); return; }
    // Bot extracts sid verbatim: path[len(prefix)+1:] — no decode
    const prefix = "/ig/outbound-stage/";
    if(req.method==="POST" && req.url.indexOf(prefix)===0){
      const rawPath = req.url.split("?")[0];
      const sid = rawPath.slice(prefix.length);
      // If client encoded colon, sid would contain %3A — bot would not find share
      if(sid.indexOf("%3A")!==-1 || sid.indexOf("%3a")!==-1){
        req.resume(); sendJson(res,400,{error:"unknown share_id"}); return;
      }
      if(!shares.has(sid)){ req.resume(); sendJson(res,404,{error:"unknown share_id"}); return; }
      const chunks=[]; req.on("data",c=>chunks.push(c)); req.on("end",()=>{
        const bytes=Buffer.concat(chunks);
        staged.set(sid,bytes);
        sendJson(res,200,{share_id:sid, bytes:bytes.length});
      });
      return;
    }
    req.resume(); sendJson(res,404,{error:"not_found"});
  });
  return new Promise(resolve=>{ server.listen(0,"127.0.0.1",()=>resolve({server, base:"http://127.0.0.1:"+server.address().port, seen, staged, shares})); });
}

async function run(){
  console.log("stage-colon-regression.test.js (fake stage bot colon check)");
  const fake = await startFakeStageBot();
  const client = SendClient.createSendClient({ base: fake.base, token: TOKEN, mode:"live" });
  const pngURL = "data:image/png;base64,"+TINY_PNG_B64;

  const composite = "SYNTH_mid_001:SYNTH_media_001";
  const r = await client.stageOutboundImage(composite, pngURL);
  assert.strictEqual(r.ok, true, "staging composite id must succeed, got "+JSON.stringify(r));
  assert.strictEqual(r.staged, true);
  // Posted URL path must contain raw colon and no %3A
  const hit = fake.seen.find(s=>s.indexOf("/ig/outbound-stage/")!==-1);
  assert.ok(hit, "stage path seen, got "+JSON.stringify(fake.seen));
  assert.ok(hit.indexOf(composite)!==-1, "path must contain raw colon composite id, got "+hit);
  assert.ok(hit.indexOf("%3A")===-1 && hit.indexOf("%3a")===-1, "path must NOT contain percent-encoded colon, got "+hit);
  assert.ok(fake.staged.get(composite).equals(TINY_PNG), "stored bytes match");

  // Second composite id also succeeds
  const composite2 = "SYNTH_mid_002:SYNTH_media_002";
  const r2 = await client.stageOutboundImage(composite2, pngURL);
  assert.strictEqual(r2.ok, true, "second composite staging must succeed");
  const hit2 = fake.seen.filter(s=>s.indexOf(composite2)!==-1)[0];
  assert.ok(hit2 && hit2.indexOf(":")!==-1 && hit2.indexOf("%3A")===-1, "second path raw colon too, got "+hit2);

  console.log("  pass: stage path raw colon, no %3A, composite ids succeed");
  fake.server.close();
}
run().catch(e=>{ console.error(e.stack||e); process.exit(1); });
