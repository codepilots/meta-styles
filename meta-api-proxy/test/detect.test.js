"use strict";
/* meta-styles multi-detect — proxy /api/detect tests. NEW hackathon work.
 * Covers: valid multi-piece parse; junk -> fallback with placeholder; cap at 6;
 * cache hit on repeat; auth/timeout behave like classify.
 * Stdlib only, fake upstream, SYNTH_ ids, example.invalid not needed here.
 */
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";
const path = require("path");
const assert = require("assert");
const proxy = require(path.resolve(__dirname, "../server.js"));

let passes=0, failures=0;
function ok(cond, name, detail){
  if(cond){ passes++; console.log("PASS: "+name); }
  else{ failures++; console.log("FAIL: "+name+(detail?" — "+detail:"")); }
}

function synthDataUrl(tag){
  return "data:image/png;base64,SYNTH_detect_"+tag;
}

async function main(){
  console.log("detect.test.js");

  // Fake upstream: returns Spark detect JSON for known image tags, classify fallback for others
  let classifyCalls=0, detectCalls=0;
  function fakeUpstream(url, opts){
    const body = JSON.parse(opts.body);
    const text = (body.input && body.input[0] && body.input[0].content && body.input[0].content[0] && body.input[0].content[0].text) || "";
    const hasImage = body.input && body.input[0] && body.input[0].content && body.input[0].content.some(c=>c.type==="input_image");
    // Detect prompt contains "detect every garment"
    if(text.indexOf("detect every garment")!==-1){
      detectCalls++;
      // Multi-piece for SYNTH_multi, 8 pieces for SYNTH_eight
      const allImages = JSON.stringify(body.input);
      if(allImages.indexOf("multi")!==-1 && allImages.indexOf("junk")===-1 && allImages.indexOf("eight")===-1 && allImages.indexOf("invalid")==-1){
        // Valid multi-piece parse: 3 pieces
        const payload={ output:[{ content:[{ type:"output_text", text: JSON.stringify({ pieces:[
          { category:"base/top", layer_role:null, attributes:{ color:"sage" }, bbox:[0.1,0.1,0.3,0.3] },
          { category:"base/bottom", layer_role:null, attributes:{ color:"black" }, bbox:[0.1,0.4,0.3,0.3] },
          { category:"bag", layer_role:null, attributes:{ color:"brown" }, bbox:[0.6,0.6,0.2,0.2] }
        ]}) }] }] };
        return Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(JSON.stringify(payload)) });
      }
      if(allImages.indexOf("eight")!==-1){
        // 8 pieces -> proxy must cap at 6
        const pieces=[];
        for(let i=0;i<8;i++) pieces.push({ category:"base/top", attributes:{ color:"c"+i }, bbox:[0.05*i,0.05*i,0.1,0.1] });
        const payload={ output:[{ content:[{ type:"output_text", text: JSON.stringify({ pieces }) }] }] };
        return Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(JSON.stringify(payload)) });
      }
      if(allImages.indexOf("junk")!==-1){
        const payload={ output:[{ content:[{ type:"output_text", text: "not json at all {{{" }] }] };
        return Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(JSON.stringify(payload)) });
      }
      if(allImages.indexOf("invalid")!==-1){
        const payload={ output:[{ content:[{ type:"output_text", text: JSON.stringify({ pieces:[
          { category:"shoes", attributes:{}, bbox:[0.1,0.1,0.2,0.2] },
          { category:"hat", attributes:{}, bbox:[0.3,0.3,0.2,0.2] }
        ]}) }] }] };
        return Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(JSON.stringify(payload)) });
      }
      // default single
      const payload={ output:[{ content:[{ type:"output_text", text: JSON.stringify({ pieces:[
        { category:"dress", attributes:{ color:"red" }, bbox:[0.1,0.1,0.5,0.5] }
      ]}) }] }] };
      return Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(JSON.stringify(payload)) });
    }
    // Classify path (fallback)
    if(text.indexOf("classify one garment")!==-1){
      classifyCalls++;
      const allImages = JSON.stringify(body.input);
      if(allImages.indexOf("junk")!==-1){
        const payload={ output:[{ content:[{ type:"output_text", text: JSON.stringify({ category:"dress", confidence:0.9 }) }] }] };
        return Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(JSON.stringify(payload)) });
      }
      if(allImages.indexOf("invalid")!==-1){
        const payload={ output:[{ content:[{ type:"output_text", text: JSON.stringify({ category:"dress", confidence:0.9 }) }] }] };
        return Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(JSON.stringify(payload)) });
      }
      const payload={ output:[{ content:[{ type:"output_text", text: JSON.stringify({ category:"dress", confidence:0.9 }) }] }] };
      return Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(JSON.stringify(payload)) });
    }
    return Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(JSON.stringify({ output:[{ content:[{ type:"output_text", text:"{}" }] }] })) });
  }

  // 1. Valid multi-piece parse
  {
    detectCalls=0; classifyCalls=0;
    const { server } = await proxy.startServer({ port:0, apiKey:"test-key", fetchImpl: fakeUpstream });
    const base="http://127.0.0.1:"+server.address().port;
    try{
      const r=await fetch(base+"/api/detect",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ image: synthDataUrl("multi_1") }) });
      const j=await r.json();
      ok(r.status===200, "detect valid multi-piece 200");
      ok(j.placeholder===false, "not placeholder");
      ok(Array.isArray(j.pieces)&&j.pieces.length===3, "3 pieces, got "+(j.pieces&&j.pieces.length));
      ok(j.pieces[0].category==="base/top"&&j.pieces[1].category==="base/bottom"&&j.pieces[2].category==="bag", "categories correct");
      ok(Array.isArray(j.pieces[0].bbox)&&j.pieces[0].bbox.length===4, "bbox present");
    } finally{ server.close(); }
  }

  // 2. Junk -> fallback with placeholder
  {
    const { server } = await proxy.startServer({ port:0, apiKey:"test-key", fetchImpl: fakeUpstream });
    const base="http://127.0.0.1:"+server.address().port;
    try{
      const r=await fetch(base+"/api/detect",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ image: synthDataUrl("junk_1") }) });
      const j=await r.json();
      ok(r.status===200, "junk fallback 200");
      ok(j.placeholder===true, "placeholder true on junk");
      ok(Array.isArray(j.pieces)&&j.pieces.length===1&&j.pieces[0].category==="dress", "fallback single piece from classify, got "+JSON.stringify(j.pieces));
    } finally{ server.close(); }
  }

  // 3. Cap at 6
  {
    const { server } = await proxy.startServer({ port:0, apiKey:"test-key", fetchImpl: fakeUpstream });
    const base="http://127.0.0.1:"+server.address().port;
    try{
      const r=await fetch(base+"/api/detect",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ image: synthDataUrl("eight_1") }) });
      const j=await r.json();
      ok(r.status===200, "cap 200");
      ok(j.pieces.length===6, "capped at 6, got "+j.pieces.length);
    } finally{ server.close(); }
  }

  // 4. Invalid categories refused -> fallback or filtered
  {
    const { server } = await proxy.startServer({ port:0, apiKey:"test-key", fetchImpl: fakeUpstream });
    const base="http://127.0.0.1:"+server.address().port;
    try{
      const r=await fetch(base+"/api/detect",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ image: synthDataUrl("invalid_cat_1") }) });
      const j=await r.json();
      ok(r.status===200, "invalid cat 200");
      // All pieces invalid -> fallback placeholder
      ok(j.placeholder===true, "invalid categories -> placeholder fallback");
    } finally{ server.close(); }
  }

  // 5. Cache hit on repeat
  {
    detectCalls=0; classifyCalls=0;
    const { server } = await proxy.startServer({ port:0, apiKey:"test-key", fetchImpl: fakeUpstream });
    const base="http://127.0.0.1:"+server.address().port;
    try{
      const img=synthDataUrl("multi_cache");
      await fetch(base+"/api/detect",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ image: img }) });
      const d1=detectCalls;
      const r2=await fetch(base+"/api/detect",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ image: img }) });
      const j2=await r2.json();
      ok(j2.cached===true, "cache hit on repeat");
      ok(detectCalls===d1, "no extra upstream on cache hit, got "+detectCalls+" vs "+d1);
    } finally{ server.close(); }
  }

  // 6. Auth/timeout behave like classify: no key -> 503, missing image -> 400
  {
    const { server } = await proxy.startServer({ port:0, apiKey:"", fetchImpl: fakeUpstream });
    const base="http://127.0.0.1:"+server.address().port;
    try{
      const r=await fetch(base+"/api/detect",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ image: synthDataUrl("multi_auth") }) });
      ok(r.status===503||r.status===502, "no key -> 503/502, got "+r.status);
    } finally{ server.close(); }
  }
  {
    const { server } = await proxy.startServer({ port:0, apiKey:"test-key", fetchImpl: fakeUpstream });
    const base="http://127.0.0.1:"+server.address().port;
    try{
      const r=await fetch(base+"/api/detect",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ image: "not-a-data-url" }) });
      ok(r.status===400, "bad image -> 400, got "+r.status);
    } finally{ server.close(); }
  }
  // timeout
  {
    let seenSignal=null;
    function hang(url,opts){ seenSignal=opts&&opts.signal; return new Promise(()=>{}); }
    const { server } = await proxy.startServer({ port:0, apiKey:"test-key", fetchImpl: hang, timeoutMs:50 });
    const base="http://127.0.0.1:"+server.address().port;
    try{
      const t0=Date.now();
      const r=await fetch(base+"/api/detect",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ image: synthDataUrl("multi_timeout") }) });
      const j=await r.json();
      ok(r.status===502&&j.error==="upstream_timeout", "hang -> 502 upstream_timeout");
      ok(Date.now()-t0<5000, "bounded");
    } finally{ server.close(); }
  }

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures?1:0);
}
main().catch(e=>{ console.error(e); process.exit(1); });
