"use strict";
/* meta-styles Milestone 22 item 2 — /api/palette proxy tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Covers: valid image -> parsed {palette, note} success shape;
 * missing/invalid image -> 400; unparseable model output -> 502
 * unparseable_palette. Upstream fetch is mocked — no network.
 *
 * Run: node meta-api-proxy/test/palette.test.js
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

function fakeGood(url, opts) {
  const body = JSON.parse(opts.body);
  let payload;
  if (url.endsWith("/responses")) {
    payload = {
      output: [{ content: [{ type: "output_text", text: '{"palette":["rose","moss","honey"],"note":"Warm undertones glow against earthy tones."}' }] }]
    };
  } else {
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("{}") });
  }
  assert(
    String(JSON.stringify(body.input)).includes("Never invent facts"),
    "palette: system prompt demands honesty"
  );
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) });
}

function fakeJunk() {
  return Promise.resolve({
    ok: true, status: 200,
    text: () => Promise.resolve(JSON.stringify({
      output: [{ content: [{ type: "output_text", text: "lovely colours!" }] }]
    }))
  });
}

async function main() {
  const { server } = await proxy.startServer({ port: 0, apiKey: "test-key", fetchImpl: fakeGood });
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (p, b) => fetch(base + p, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

  try {
    const ok = await post("/api/palette", { image: "data:image/jpeg;base64,SYNTH_apal_1" });
    assert(ok.status === 200, "palette: 200 on valid image", "got " + ok.status);
    assert(Array.isArray(ok.json.palette) && ok.json.palette.length === 3 &&
      ok.json.palette[0] === "rose" && ok.json.note === "Warm undertones glow against earthy tones.",
      "palette: returns parsed palette + note");
    assert(ok.json.method === "spark-vision" && ok.json.placeholder === false &&
      ok.json.source === proxy.SPARK_MODEL,
      "palette: spark-vision method, placeholder false, spark source");

    const missing = await post("/api/palette", {});
    assert(missing.status === 400 && missing.json.error === "image_data_url_required",
      "palette: missing image -> 400");

    const bad = await post("/api/palette", { image: "not-a-data-url" });
    assert(bad.status === 400 && bad.json.error === "image_data_url_required",
      "palette: non-data-URL image -> 400");

    const health = await fetch(base + "/health").then((r) => r.json());
    assert(health.ok && health.models.spark === proxy.SPARK_MODEL,
      "palette: no new health field needed (uses spark key)");
  } finally {
    server.close();
  }

  const { server: junk } = await proxy.startServer({ port: 0, apiKey: "test-key", fetchImpl: fakeJunk });
  const base2 = "http://127.0.0.1:" + junk.address().port;
  try {
    const r = await fetch(base2 + "/api/palette", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: "data:image/jpeg;base64,SYNTH_apal_2" }),
    });
    const json = await r.json().catch(() => ({}));
    assert(r.status === 502 && json.error === "unparseable_palette",
      "palette: junk model output -> 502 unparseable_palette", "got " + r.status);
  } finally {
    junk.close();
  }

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
