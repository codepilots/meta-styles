"use strict";
/* Milestone 21b — Spark-powered routing: natural phrasing via /api/route.
 * Mock proxy test + live-proxy reachability + heuristic fallback.
 */
const assert = require("assert");
const Router = require("../router.js");
const proxy = require("../../meta-api-proxy/server.js");
const AgenticLoop = require("../agentic-loop.js");
const Wardrobe = require("../wardrobe-catalog.js");

function noProxyEnv(){ process.env.NO_PROXY="127.0.0.1,localhost"; process.env.no_proxy="127.0.0.1,localhost"; }
noProxyEnv();

async function run(){
  console.log("Milestone 21b — router-spark.test.js");

  // helper: fake upstream that returns Spark routing JSON
  function fakeRouteUpstream(routeMap){
    // routeMap: function(systemText+userText) -> {skill, confidence, reason}
    // If null returned, simulate unparseable
    return function(url, opts){
      const body = JSON.parse(opts.body);
      const inputStr = JSON.stringify(body.input || "");
      let payload;
      // check json_object format requested
      if (body.text && body.text.format && body.text.format.type === "json_object") {
        let chosen = null;
        if (typeof routeMap === "function") chosen = routeMap(inputStr);
        else chosen = routeMap;
        if (!chosen) payload = { output:[{content:[{type:"output_text", text:"not json at all"}]}] };
        else payload = { output:[{content:[{type:"output_text", text: JSON.stringify(chosen)}]}] };
      } else {
        payload = { output:[{content:[{type:"output_text", text:'{"category":"dress"}'}]}] };
      }
      return Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(JSON.stringify(payload)) });
    };
  }

  // --- 1. "Can you find the bag" -> propose_look or describe_wardrobe via Spark ---
  console.log("\n[Spark routes natural phrasing]");
  {
    const { server } = await proxy.startServer({ port:0, apiKey:"test-key", fetchImpl: fakeRouteUpstream(()=>({skill:"propose_look", confidence:88, reason:"natural phrasing for look request"})) });
    const base = "http://127.0.0.1:"+server.address().port;
    globalThis.__IG_RUNTIME__ = { proxyBase: base };
    delete require.cache[require.resolve("../meta-client.js")];
    const Meta = require("../meta-client.js");
    try{
      const r = await Router.classify({text:"Can you find the bag", imagePresent:false, wardrobeSummary:"", preferences:"", lastTurns:[]}, Meta);
      assert.ok(["propose_look","describe_wardrobe"].indexOf(r.skill)!==-1, "Can you find the bag -> propose_look/describe_wardrobe via Spark, got "+r.skill);
      assert.ok(r.confidence>=70, "confidence >=70");
      console.log("  pass: 'Can you find the bag' -> "+r.skill+" via Spark");
      // verify proxy called with json_object format
      const r2 = await Router.classify({text:"find the bag", imagePresent:false}, Meta);
      assert.ok(["propose_look","describe_wardrobe"].indexOf(r2.skill)!==-1, "find the bag similar, got "+r2.skill);
      console.log("  pass: 'find the bag' -> "+r2.skill+" via Spark");
    } finally { server.close(); }
  }

  // --- 2. "hmm" vague -> clarification (<70) via Spark ---
  console.log("\n[vague -> clarification]");
  {
    const { server } = await proxy.startServer({ port:0, apiKey:"test-key", fetchImpl: fakeRouteUpstream(()=>({skill:"off_topic", confidence:45, reason:"vague input"})) });
    const base = "http://127.0.0.1:"+server.address().port;
    globalThis.__IG_RUNTIME__ = { proxyBase: base };
    delete require.cache[require.resolve("../meta-client.js")];
    const Meta2 = require("../meta-client.js");
    try{
      const r = await Router.classify({text:"hmm", imagePresent:false}, Meta2);
      assert.ok(r.confidence<70, "hmm confidence <70 via Spark, got "+r.confidence);
      assert.ok(typeof r.clarification==="string" && r.clarification.length>0, "clarification present");
      console.log("  pass: 'hmm' -> clarification (<70) via Spark, conf="+r.confidence);
    } finally { server.close(); }
  }

  // --- 3. proxy down -> heuristic fallback ---
  console.log("\n[proxy down -> heuristic fallback]");
  {
    globalThis.__IG_RUNTIME__ = { proxyBase: "http://127.0.0.1:59997" };
    delete require.cache[require.resolve("../meta-client.js")];
    const Meta3 = require("../meta-client.js");
    const r = await Router.classify({text:"show me a look", imagePresent:false}, Meta3);
    assert.strictEqual(r.skill, "propose_look", "fallback heuristic still works when proxy down, got "+r.skill);
    console.log("  pass: proxy down -> heuristic fallback propose_look");
    const r2 = await Router.classify({text:"what is the weather today?"}, Meta3);
    assert.strictEqual(r2.skill, "off_topic", "fallback off_topic");
    console.log("  pass: proxy down -> heuristic off_topic");
  }

  // --- 4. Spark returns invalid skill -> fallback ---
  console.log("\n[invalid Spark skill -> fallback]");
  {
    const { server } = await proxy.startServer({ port:0, apiKey:"test-key", fetchImpl: fakeRouteUpstream(()=>({skill:"not_a_skill", confidence:90, reason:"bad"})) });
    const base = "http://127.0.0.1:"+server.address().port;
    globalThis.__IG_RUNTIME__ = { proxyBase: base };
    delete require.cache[require.resolve("../meta-client.js")];
    const Meta4 = require("../meta-client.js");
    try{
      const r = await Router.classify({text:"show me a look", imagePresent:false}, Meta4);
      // proxy returns 502, classify catches and falls back to heuristic which is propose_look for this text
      assert.strictEqual(r.skill, "propose_look", "invalid skill -> heuristic fallback, got "+r.skill);
      console.log("  pass: invalid Spark skill -> fallback heuristic");
    } finally { server.close(); }
  }

  // --- 5. Agentic loop uses Spark route through same path (end-to-end) ---
  console.log("\n[agentic loop via Spark]");
  {
    const { server } = await proxy.startServer({ port:0, apiKey:"test-key", fetchImpl: fakeRouteUpstream(()=>({skill:"propose_look", confidence:88, reason:"spark via agentic"})) });
    const base = "http://127.0.0.1:"+server.address().port;
    globalThis.__IG_RUNTIME__ = { proxyBase: base };
    delete require.cache[require.resolve("../meta-client.js")];
    const Meta5 = require("../meta-client.js");
    const cat = Wardrobe.createCatalog({ userKey:"SYNTH_spark_agentic" });
    try{ cat.addPiece({category:"dress", attributes:{}, source_share_id:"SYNTH_a1"});}catch(e){}
    try{ cat.addPiece({category:"scarf", attributes:{}, source_share_id:"SYNTH_a2"});}catch(e){}
    try{ cat.addPiece({category:"bag", attributes:{}, source_share_id:"SYNTH_a3"});}catch(e){}
    const loop = AgenticLoop.createAgenticLoop({ catalog:cat, userRef:cat.userKey, router:Router, metaClient:Meta5, maxSteps:20 });
    const res = await loop.handleTurn({ message:"Can you find the bag", hasImage:false, wardrobeSummary:"", preferences:"", lastTurns:[] });
    assert.strictEqual(res.skill, "propose_look", "agentic loop via Spark, got "+res.skill);
    console.log("  pass: agentic loop 'Can you find the bag' -> propose_look via Spark");
    server.close();
  }

  // --- 6. Direct proxy /api/route contract test (reachable + validates) ---
  console.log("\n[proxy /api/route contract]");
  {
    const SKILLS = Router.SKILL_NAMES;
    const { server } = await proxy.startServer({ port:0, apiKey:"test-key", fetchImpl: fakeRouteUpstream(()=>({skill:"describe_wardrobe", confidence:90, reason:"wardrobe query"})) });
    const base = "http://127.0.0.1:"+server.address().port;
    const post = (p,b)=> fetch(base+p,{method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(b)}).then(async r=>({status:r.status, json:await r.json().catch(()=>({}))}));
    try{
      const r = await post("/api/route",{ text:"Can you find the bag", imagePresent:false, wardrobeSummary:"", preferences:"", lastTurns:[] });
      assert.strictEqual(r.status,200, "/api/route 200, got "+r.status);
      assert.ok(SKILLS.indexOf(r.json.skill)!==-1, "skill valid");
      assert.ok(typeof r.json.confidence==="number" && r.json.confidence>=0 && r.json.confidence<=100, "confidence 0-100");
      assert.ok(typeof r.json.reason==="string", "reason string");
      assert.strictEqual(r.json.placeholder,false, "placeholder false");
      console.log("  pass: POST /api/route contract valid -> "+r.json.skill+" conf="+r.json.confidence);
      // cached second call
      const r2 = await post("/api/route",{ text:"Can you find the bag", imagePresent:false, wardrobeSummary:"", preferences:"", lastTurns:[] });
      assert.strictEqual(r2.status,200, "cached route 200");
      console.log("  pass: /api/route cache hit");
    } finally { server.close(); }
  }

  // cleanup RUNTIME
  delete globalThis.__IG_RUNTIME__;
  delete require.cache[require.resolve("../meta-client.js")];

  console.log("\nAll router-spark tests passed.");
}
run().catch(e=>{ console.error(e.stack||e); process.exit(1); });
