"use strict";
/* meta-styles regression: coerceCategory in proxy classify + detect.
 * NEW hackathon work (building period Oct 27 - Nov 4, 2026).
 * Stdlib only, fake upstream, SYNTH_ fixtures, no network.
 * Covers opencode-category-coerce.md step 3 proxy side:
 *  - classify upstream "jacket" -> coerced layer/blazer, placeholder false
 *  - classify upstream "heels" -> placeholder true contract shape
 *  - detect with "jumper" + "heels" -> jumper keeps layer/cardigan, heels dropped
 *  - cache stores coerced values on repeat
 */
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";
const path = require("path");
const proxy = require(path.resolve(__dirname, "../server.js"));

let passes = 0, failures = 0;
function ok(cond, name, detail) {
  if (cond) { passes++; console.log("PASS: " + name); }
  else { failures++; console.log("FAIL: " + name + (detail ? " - " + detail : "")); }
}

function synthDataUrl(tag) {
  return "data:image/png;base64,SYNTH_coerce_" + tag;
}

function fakeUpstream(url, opts) {
  const body = JSON.parse(opts.body);
  const text = (body.input && body.input[0] && body.input[0].content && body.input[0].content[0] && body.input[0].content[0].text) || "";
  const allImages = JSON.stringify(body.input || {});
  const isDetect = text.indexOf("detect every garment") !== -1;
  const isClassify = text.indexOf("classify one garment") !== -1;

  if (isClassify) {
    // Route by image tag to return synonym / shoe categories
    if (allImages.indexOf("SYNTH_coerce_jacket") !== -1) {
      const payload = { output: [{ content: [{ type: "output_text", text: JSON.stringify({ category: "jacket", confidence: 0.92 }) }] }] };
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) });
    }
    if (allImages.indexOf("SYNTH_coerce_jacket_cache") !== -1) {
      const payload = { output: [{ content: [{ type: "output_text", text: JSON.stringify({ category: "jacket", confidence: 0.92 }) }] }] };
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) });
    }
    if (allImages.indexOf("SYNTH_coerce_heels") !== -1) {
      const payload = { output: [{ content: [{ type: "output_text", text: JSON.stringify({ category: "heels", confidence: 0.88 }) }] }] };
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) });
    }
    if (allImages.indexOf("SYNTH_coerce_jumper_mix") !== -1) {
      // classify fallback for detect's classify call with this tag
      const payload = { output: [{ content: [{ type: "output_text", text: JSON.stringify({ category: "dress", confidence: 0.7 }) }] }] };
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) });
    }
    if (allImages.indexOf("SYNTH_coerce_jumper_mix_cache") !== -1) {
      const payload = { output: [{ content: [{ type: "output_text", text: JSON.stringify({ category: "dress", confidence: 0.7 }) }] }] };
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) });
    }
    const payload = { output: [{ content: [{ type: "output_text", text: JSON.stringify({ category: "dress", confidence: 0.9 }) }] }] };
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) });
  }

  if (isDetect) {
    if (allImages.indexOf("SYNTH_coerce_jumper_mix") !== -1 || allImages.indexOf("SYNTH_coerce_jumper_mix_cache") !== -1) {
      const payload = { output: [{ content: [{ type: "output_text", text: JSON.stringify({ pieces: [
        { category: "jumper", layer_role: null, attributes: { color: "sage" }, bbox: [0.1, 0.1, 0.3, 0.3] },
        { category: "heels", layer_role: null, attributes: { color: "black" }, bbox: [0.1, 0.6, 0.2, 0.2] }
      ]}) }] }] };
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) });
    }
    const payload = { output: [{ content: [{ type: "output_text", text: JSON.stringify({ pieces: [{ category: "dress", attributes: {}, bbox: [0, 0, 1, 1] }] }) }] }] };
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) });
  }

  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ output: [{ content: [{ type: "output_text", text: "{}" }] }] })) });
}

async function main() {
  console.log("category-coerce.test.js");

  // 1. classify upstream "jacket" -> coerced layer/blazer, placeholder false
  {
    const { server } = await proxy.startServer({ port: 0, apiKey: "test-key", fetchImpl: fakeUpstream });
    const base = "http://127.0.0.1:" + server.address().port;
    try {
      const r = await fetch(base + "/api/classify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: synthDataUrl("jacket_1") }) });
      const j = await r.json();
      ok(r.status === 200, "classify jacket 200");
      ok(j.category === "layer/blazer", "jacket coerced to layer/blazer, got " + j.category);
      ok(j.placeholder === false, "not placeholder on coerced jacket");
      ok(j.method === "spark-vision", "method spark-vision");
      // direct helper check
      ok(proxy.coerceCategory("jacket") === "layer/blazer", "coerceCategory jacket direct");
      ok(proxy.coerceCategory("JACKET") === "layer/blazer", "coerceCategory case-insensitive");
    } finally { server.close(); }
  }

  // 2. classify upstream "heels" -> placeholder true contract
  {
    const { server } = await proxy.startServer({ port: 0, apiKey: "test-key", fetchImpl: fakeUpstream });
    const base = "http://127.0.0.1:" + server.address().port;
    try {
      const r = await fetch(base + "/api/classify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: synthDataUrl("heels_1") }) });
      const j = await r.json();
      ok(r.status === 200, "classify heels 200");
      ok(j.placeholder === true, "heels -> placeholder true");
      ok(j.category === "dress", "fallback category dress, got " + j.category);
      ok(j.confidence === 0, "fallback confidence 0, got " + j.confidence);
      ok(j.method === "spark-vision", "fallback method spark-vision");
      ok(proxy.coerceCategory("heels") === null, "coerceCategory heels null");
      ok(proxy.coerceCategory("shoe") === null, "coerceCategory shoe null");
    } finally { server.close(); }
  }

  // 3. detect with one region "jumper" + one "heels" -> jumper keeps layer/cardigan, heels dropped
  {
    const { server } = await proxy.startServer({ port: 0, apiKey: "test-key", fetchImpl: fakeUpstream });
    const base = "http://127.0.0.1:" + server.address().port;
    try {
      const r = await fetch(base + "/api/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: synthDataUrl("jumper_mix_1") }) });
      const j = await r.json();
      ok(r.status === 200, "detect jumper+heels 200");
      ok(j.placeholder === false, "detect not placeholder when one valid piece remains");
      ok(Array.isArray(j.pieces) && j.pieces.length === 1, "heels dropped, 1 piece left, got " + (j.pieces && j.pieces.length));
      ok(j.pieces[0].category === "layer/cardigan", "jumper coerced to layer/cardigan, got " + j.pieces[0].category);
      ok(proxy.coerceCategory("jumper") === "layer/cardigan", "coerceCategory jumper direct");
    } finally { server.close(); }
  }

  // 4. cache stores coerced values on repeat (classify + detect)
  {
    let classifyCalls = 0;
    let detectCalls = 0;
    function countingUpstream(url, opts) {
      const body = JSON.parse(opts.body);
      const text = (body.input && body.input[0] && body.input[0].content && body.input[0].content[0] && body.input[0].content[0].text) || "";
      if (text.indexOf("classify one garment") !== -1) classifyCalls++;
      if (text.indexOf("detect every garment") !== -1) detectCalls++;
      return fakeUpstream(url, opts);
    }
    const { server } = await proxy.startServer({ port: 0, apiKey: "test-key", fetchImpl: countingUpstream });
    const base = "http://127.0.0.1:" + server.address().port;
    try {
      // classify cache
      const img = synthDataUrl("jacket_cache_1");
      const r1 = await fetch(base + "/api/classify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: img }) });
      const j1 = await r1.json();
      ok(j1.category === "layer/blazer" && j1.cached !== true, "first classify not cached, coerced");
      const c1 = classifyCalls;
      const r2 = await fetch(base + "/api/classify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: img }) });
      const j2 = await r2.json();
      ok(j2.cached === true, "second classify cached");
      ok(j2.category === "layer/blazer", "cached classify still coerced layer/blazer, got " + j2.category);
      ok(classifyCalls === c1, "no extra upstream on classify cache hit, got " + classifyCalls + " vs " + c1);

      // detect cache
      const img2 = synthDataUrl("jumper_mix_cache_1");
      const d1 = await fetch(base + "/api/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: img2 }) });
      const dj1 = await d1.json();
      ok(dj1.pieces.length === 1 && dj1.pieces[0].category === "layer/cardigan", "first detect coerced");
      const dc1 = detectCalls;
      const d2 = await fetch(base + "/api/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: img2 }) });
      const dj2 = await d2.json();
      ok(dj2.cached === true, "second detect cached");
      ok(dj2.pieces[0].category === "layer/cardigan", "cached detect still coerced layer/cardigan");
      ok(detectCalls === dc1, "no extra upstream on detect cache hit, got " + detectCalls + " vs " + dc1);
    } finally { server.close(); }
  }

  console.log("\n" + passes + " passed, " + failures + " failed.");
  process.exit(failures ? 1 : 0);
}
main().catch(function (e) { console.error(e); process.exit(1); });
