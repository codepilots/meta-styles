"use strict";
/* meta-styles multi-reference grounding — proxy preview regression test.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Covers the multi-reference grounding implementation in
 * meta-api-proxy/server.js POST /api/preview:
 *   (1) two distinct data:image/png;base64 refs -> 200 and upstream gets
 *       both images entries in order (images/edits);
 *   (2) same prompt with different ordered/reference set is not served
 *       from cache and calls upstream again;
 *   (3) legacy single `image` still sends one edit reference;
 *   (4) malformed / empty / over-four `images` -> 400.
 * No network, no credentials — upstream fetch is injected.
 *
 * Run: node meta-api-proxy/test/multi-reference-preview.test.js
 */

// Localhost must bypass any env HTTP proxy (sandbox sets one for external traffic).
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";

const path = require("path");
const assert = (cond, name, detail) => {
  if (cond) { passes++; console.log("PASS: " + name); }
  else { failures++; console.log("FAIL: " + name + (detail ? " — " + detail : "")); }
};
let passes = 0;
let failures = 0;

const proxy = require(path.resolve(__dirname, "../server.js"));

const REF_A = "data:image/png;base64,SYNTH_multi_a_" + "A".repeat(64);
const REF_B = "data:image/png;base64,SYNTH_multi_b_" + "B".repeat(64);
const REF_C = "data:image/png;base64,SYNTH_multi_c_" + "C".repeat(64);
const PROMPT = "Y2K fairycore flat-lay look card, soft pastel background — SYNTH test";

async function main() {
  // Fake upstream that records every call and returns a synthetic image.
  const upstreamCalls = [];
  function fakeUpstream(url, opts) {
    let body = null;
    try { body = JSON.parse(opts.body); } catch { body = opts.body; }
    upstreamCalls.push({ url, body, headers: opts.headers });
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        data: [{ b64_json: Buffer.from("SYNTH_preview").toString("base64") }],
        output_format: "png",
      })),
    });
  }

  const { server } = await proxy.startServer({ port: 0, apiKey: "test-key", fetchImpl: fakeUpstream });
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (p, b) => fetch(base + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

  try {
    // (1) Two distinct refs -> 200 and upstream receives both in order.
    upstreamCalls.length = 0;
    const r1 = await post("/api/preview", { prompt: PROMPT, images: [REF_A, REF_B] });
    assert(r1.status === 200, "preview multi: two refs -> 200", "got " + r1.status + " " + JSON.stringify(r1.json));
    assert(typeof r1.json.dataURL === "string" && r1.json.dataURL.startsWith("data:image/png;base64,"),
      "preview multi: returns dataURL");
    assert(r1.json.placeholder === false, "preview multi: placeholder false");
    assert(upstreamCalls.length === 1, "preview multi: one upstream call", "got " + upstreamCalls.length);
    if (upstreamCalls.length === 1) {
      const call = upstreamCalls[0];
      assert(call.url.endsWith("/images/edits"), "preview multi: upstream is images/edits", call.url);
      assert(call.body && call.body.model === proxy.IMAGE_MODEL, "preview multi: correct model");
      assert(call.body && call.body.prompt === PROMPT, "preview multi: prompt forwarded");
      assert(Array.isArray(call.body.images) && call.body.images.length === 2,
        "preview multi: upstream receives 2 images", JSON.stringify(call.body && call.body.images));
      if (Array.isArray(call.body.images) && call.body.images.length === 2) {
        assert(call.body.images[0].image_url === REF_A && call.body.images[1].image_url === REF_B,
          "preview multi: upstream images in order");
      }
    }

    // (2) Same prompt with different ordered / reference set is NOT served from cache.
    upstreamCalls.length = 0;
    const r2a = await post("/api/preview", { prompt: PROMPT, images: [REF_B, REF_A] });
    assert(r2a.status === 200, "preview multi: reordered refs -> 200", "got " + r2a.status);
    assert(upstreamCalls.length === 1, "preview multi: reordered refs not from cache (upstream called again)", "got " + upstreamCalls.length);
    assert(!r2a.json.cached, "preview multi: reordered refs not marked cached");
    if (upstreamCalls.length === 1) {
      assert(upstreamCalls[0].body.images[0].image_url === REF_B && upstreamCalls[0].body.images[1].image_url === REF_A,
        "preview multi: reordered upstream in new order");
    }

    // Same prompt with different reference set (A,C) also misses cache.
    upstreamCalls.length = 0;
    const r2b = await post("/api/preview", { prompt: PROMPT, images: [REF_A, REF_C] });
    assert(r2b.status === 200, "preview multi: different ref set -> 200", "got " + r2b.status);
    assert(upstreamCalls.length === 1, "preview multi: different ref set not from cache", "got " + upstreamCalls.length);
    if (upstreamCalls.length === 1) {
      assert(upstreamCalls[0].body.images[0].image_url === REF_A && upstreamCalls[0].body.images[1].image_url === REF_C,
        "preview multi: different ref set forwarded correctly");
    }

    // Exact repeat should be cached (verifies cache key is order-sensitive, not just proof of caching).
    upstreamCalls.length = 0;
    const r2c = await post("/api/preview", { prompt: PROMPT, images: [REF_A, REF_B] });
    assert(r2c.status === 200, "preview multi: exact repeat -> 200", "got " + r2c.status);
    assert(r2c.json.cached === true, "preview multi: exact repeat served from cache");
    assert(upstreamCalls.length === 0, "preview multi: exact repeat not calling upstream", "got " + upstreamCalls.length);

    // (3) Legacy single `image` still sends one edit reference.
    upstreamCalls.length = 0;
    const r3 = await post("/api/preview", { prompt: PROMPT + " legacy", image: REF_A });
    assert(r3.status === 200, "preview legacy: single image -> 200", "got " + r3.status + " " + JSON.stringify(r3.json));
    assert(typeof r3.json.dataURL === "string" && r3.json.dataURL.startsWith("data:image/"),
      "preview legacy: returns dataURL");
    assert(upstreamCalls.length === 1, "preview legacy: one upstream call", "got " + upstreamCalls.length);
    if (upstreamCalls.length === 1) {
      const call = upstreamCalls[0];
      assert(call.url.endsWith("/images/edits"), "preview legacy: upstream is images/edits", call.url);
      assert(Array.isArray(call.body.images) && call.body.images.length === 1,
        "preview legacy: upstream receives 1 image", JSON.stringify(call.body && call.body.images));
      if (Array.isArray(call.body.images) && call.body.images.length === 1) {
        assert(call.body.images[0].image_url === REF_A, "preview legacy: image_url matches");
      }
    }

    // (4) Malformed / empty / over-four `images` -> 400.
    const badCases = [
      ["empty array", { prompt: PROMPT, images: [] }],
      ["over four", { prompt: PROMPT, images: [REF_A, REF_B, REF_C, REF_A, REF_B] }],
      ["non-data URL entry", { prompt: PROMPT, images: [REF_A, "http://example.invalid/foo.png"] }],
      ["bare string entry", { prompt: PROMPT, images: [REF_A, "not-a-data-url"] }],
      ["null entry", { prompt: PROMPT, images: [REF_A, null] }],
      ["empty string entry", { prompt: PROMPT, images: [REF_A, ""] }],
      ["not an array", { prompt: PROMPT, images: "data:image/png;base64,SYNTH_not_array" }],
      ["object not array", { prompt: PROMPT, images: { "0": REF_A } }],
      ["number entry", { prompt: PROMPT, images: [REF_A, 123] }],
      ["mixed valid + http", { prompt: PROMPT, images: ["data:image/jpeg;base64,SYNTH_ok", "https://example.invalid/img.jpg"] }],
    ];
    for (const [label, body] of badCases) {
      upstreamCalls.length = 0;
      const br = await post("/api/preview", body);
      assert(br.status === 400 && br.json.error === "image_data_url_required",
        "preview 400: " + label + " -> 400 image_data_url_required", "got " + br.status + " " + JSON.stringify(br.json));
      assert(upstreamCalls.length === 0, "preview 400: " + label + " does not call upstream", "got " + upstreamCalls.length);
    }

    // Over-four with exactly 4 should succeed (boundary check).
    upstreamCalls.length = 0;
    const r4ok = await post("/api/preview", { prompt: PROMPT + " four", images: [REF_A, REF_B, REF_C, REF_A] });
    assert(r4ok.status === 200, "preview multi: exactly four refs -> 200", "got " + r4ok.status);
    assert(upstreamCalls.length === 1 && upstreamCalls[0].body.images.length === 4,
      "preview multi: four refs forwarded");

    // Malformed legacy single image also 400.
    upstreamCalls.length = 0;
    const rBadLegacy = await post("/api/preview", { prompt: PROMPT, image: "not-a-data-url" });
    assert(rBadLegacy.status === 400 && rBadLegacy.json.error === "image_data_url_required",
      "preview 400: legacy malformed image -> 400", "got " + rBadLegacy.status);
    assert(upstreamCalls.length === 0, "preview 400: legacy malformed does not call upstream");

  } finally {
    server.close();
  }

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
