"use strict";
/* meta-styles — catalogue idempotent guard regression test.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Guards 2026-10-31 idempotent defect: while a photo share's reply send
 * failed at the bot, the wardrobe retried the share on later polls and
 * every retry re-ran addPiece → duplicate garments (8 → 40 pieces).
 *
 * Proves: catalogue once per share id, reply as often as legitimately
 * needed. Covers:
 *   A) handler-level: same shareId re-processed with media still available
 *      (fake bot serves bytes again) → pieces +0, reply still out, turn
 *      recorded honestly; different shareId with same bytes still adds.
 *   B) service-level: failed send → retry re-offers same id → no duplicate
 *      piece, but send attempt still happens.
 * SYNTH ids only, stdlib only, no secrets.
 */
const assert = require("assert");

const PROXY_BASE = "http://127.0.0.1:59998";
const TOKEN = "SYNTH_mock_token";
const SHARE_A = "SYNTH_share_idempotent_A";
const SHARE_B = "SYNTH_share_idempotent_B";

function tinyPngDataUrl(){
  // 1x1 transparent PNG — synthetic, no real photo.
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
}

async function testHandlerGuard(){
  console.log("\n[handler guard: same share idempotent, different share adds]");
  const Wardrobe = require("../../app/wardrobe-catalog.js");
  const handler = require("../../app/skills/catalogue_piece/handler.js");
  const catalog = Wardrobe.createCatalog({ userKey: "SYNTH_user_idempotent" });

  const img = tinyPngDataUrl();
  // First process: new share A
  const r1 = await handler.handle({ catalog, text:"", imageDataUrl: img, shareId: SHARE_A });
  assert.ok(r1 && typeof r1.text==="string" && r1.text.length>0, "first reply text");
  assert.strictEqual(catalog.getPieces().length, 1, "first share adds 1 piece");
  // Must claim catalogued, not idempotent
  assert.ok(/Got your|tucked safely/i.test(r1.text), "first reply claims new addition: "+r1.text.slice(0,120));
  assert.ok(r1.text.indexOf("already in your wardrobe")===-1, "first reply must not claim idempotent");

  // Second process: SAME share id, media still available (fake bot serves bytes again)
  const before = catalog.getPieces().length;
  const r2 = await handler.handle({ catalog, text:"", imageDataUrl: img, shareId: SHARE_A });
  assert.strictEqual(catalog.getPieces().length, before, "same share re-process must not add piece, got "+catalog.getPieces().length);
  assert.ok(typeof r2.text==="string" && r2.text.length>0, "second reply still goes out");
  assert.ok(/already in your wardrobe/i.test(r2.text) && /keeping one copy/i.test(r2.text),
    "idempotent reply must say already in wardrobe — keeping one copy, got: "+r2.text.slice(0,200));
  assert.ok(r2.text.indexOf("SYNTH_share")===-1, "no id leak in reply");
  // Turn recorded honestly (either via handler's recordTurn or via catalog turns growth)
  // handler's idempotent path records a turn; check turns grew
  const turnsAfterDup = catalog.getTurns().length;
  assert.ok(turnsAfterDup >= 1, "turn must be recorded even on idempotent replay, got "+turnsAfterDup);

  // Third: DIFFERENT share id with SAME media bytes must still add its own piece (per-photo preserved)
  const r3 = await handler.handle({ catalog, text:"", imageDataUrl: img, shareId: SHARE_B });
  assert.strictEqual(catalog.getPieces().length, 2, "different share id must add its own piece, got "+catalog.getPieces().length);
  assert.ok(/Got your|tucked safely/i.test(r3.text), "different share reply claims new addition");
  assert.ok(r3.text.indexOf("already in your wardrobe")===-1, "different share must not be idempotent");
  // Pieces have distinct source_share_ids
  const ids = catalog.getPieces().map(p=>p.source_share_id);
  assert.ok(ids.indexOf(SHARE_A)!==-1 && ids.indexOf(SHARE_B)!==-1, "both share ids present, got "+JSON.stringify(ids));

  console.log("  pass: handler idempotent guard");
}

async function testServiceRetry(){
  console.log("\n[service retry after failed send: no duplicate piece, send still attempted]");
  const origFetch = global.fetch;
  const sent = [];
  let sendCalls = 0;
  const seed = [];

  global.fetch = function(url, opts){
    const u = String(url);
    if(u.indexOf("/ig/send")!==-1){
      sendCalls++;
      // First send fails (bot 502), second succeeds — retry scenario
      if(sendCalls===1){
        sent.push({ fail:true, body: opts && opts.body ? JSON.parse(String(opts.body)) : {} });
        return Promise.resolve({
          ok:false, status:502,
          json:()=>Promise.resolve({ error:"image_send_failed" }),
          text:()=>Promise.resolve(JSON.stringify({ error:"image_send_failed" })),
        });
      }
      const body = opts && opts.body ? JSON.parse(String(opts.body)) : {};
      sent.push(body);
      return Promise.resolve({
        ok:true, status:200,
        json:()=>Promise.resolve({ message_id:"SYNTH_msg_001" }),
        text:()=>Promise.resolve(JSON.stringify({ message_id:"SYNTH_msg_001" })),
      });
    }
    if(u.indexOf("/ig/media/")!==-1){
      return Promise.resolve({
        ok:true, status:200,
        headers:{ get:()=> "image/jpeg" },
        arrayBuffer:()=>Promise.resolve(new ArrayBuffer(8)),
      });
    }
    if(u.indexOf("/ig/catalog")!==-1){
      return Promise.resolve({
        ok:true, status:200,
        text:()=>Promise.resolve(JSON.stringify(seed)),
        json:()=>Promise.resolve(seed),
      });
    }
    if(u.indexOf("/mock/stage-outbound-image/")!==-1 || u.indexOf("/ig/outbound-stage/")!==-1){
      return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve({ share_id: u.split("/").pop() }), text:()=>Promise.resolve("{}") });
    }
    if(u.indexOf(PROXY_BASE)!==-1){ return Promise.reject(new Error("proxy unreachable (stub)")); }
    return Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve("{}"), json:()=>Promise.resolve({}) });
  };

  try{
    delete require.cache[require.resolve("../server.js")];
    const Service = require("../server.js");
    const svc = Service.createService({
      botBase:"http://127.0.0.1:59997", proxyBase: PROXY_BASE,
      readToken:TOKEN, catalogToken:TOKEN, sendToken:TOKEN, port:0, nowMs:()=>Date.now()
    });

    function imageItem(id){
      return { id, received_at:new Date().toISOString(), attachment:{ type:"image", payload:{ url:"mock-local:image" } }, media_id:"SYNTH_media_idempotent", media_available:true };
    }

    // First attempt: send fails → retry, but piece already catalogued once
    const out1 = await svc.processOne(imageItem(SHARE_A));
    assert.ok(out1==="retry", "first attempt after failed send must be retry, got "+out1);
    // Piece was catalogued even though send failed (catalog guard will protect next attempt)
    // pieces_count is via getActivePieces through catalog — check via status
    const piecesAfterFirst = svc.status().pieces_count;
    assert.strictEqual(piecesAfterFirst, 1, "first attempt must have catalogued 1 piece, got "+piecesAfterFirst);
    assert.strictEqual(sendCalls, 1, "first send attempted");

    // Second attempt: SAME share id, media still available (fake bot serves bytes again)
    const out2 = await svc.processOne(imageItem(SHARE_A));
    assert.ok(out2.indexOf("terminal:")==0, "second attempt terminal, got "+out2);
    assert.strictEqual(svc.status().pieces_count, 1, "retry must not add duplicate piece, got "+svc.status().pieces_count);
    assert.strictEqual(sendCalls, 2, "retry must still attempt send");
    assert.strictEqual(sent.length>=1?sent.filter(s=>!s.fail).length:0, 1, "one successful send on retry");

    // Different share id with same media bytes still adds its own piece
    const out3 = await svc.processOne(imageItem(SHARE_B));
    assert.ok(out3.indexOf("terminal:")==0, "different share terminal, got "+out3);
    assert.strictEqual(svc.status().pieces_count, 2, "different share must add second piece, got "+svc.status().pieces_count);
    console.log("  pass: service retry no duplicate, per-photo preserved");
  } finally { global.fetch = origFetch; }
}

async function run(){
  console.log("catalogue-idempotent.test.js (2026-10-31 idempotent catalogue guard)");
  await testHandlerGuard();
  await testServiceRetry();
  console.log("\nAll catalogue idempotent tests passed.");
}
run().catch(e=>{ console.error(e.stack||e); process.exit(1); });
