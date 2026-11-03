"use strict";
/* meta-styles — /api/interpret proxy tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Covers: valid closed-choice request -> Spark's option id passes
 * through as {choice, confidence, source, placeholder:false}; an
 * invented id (not among the supplied options) fails closed to
 * choice null; "none" -> choice null; bad shapes -> 400; repeat
 * request served from cache (cached:true). Upstream fetch is mocked —
 * no network.
 *
 * Run: node meta-api-proxy/test/interpret.test.js
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

const OPTS = [
  { id: "dress", description: "the dresses in the wardrobe" },
  { id: "bag", description: "the bags in the wardrobe" },
  { id: "none", description: "no listed option fits" },
];

function stubFor(choiceText) {
  return function fake(url, opts) {
    return Promise.resolve({
      ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({
        output: [{ content: [{ type: "output_text", text: choiceText }] }]
      }))
    });
  };
}

async function main() {
  const { server } = await proxy.startServer({
    port: 0, apiKey: "test-key",
    fetchImpl: stubFor('{"choice":"dress","confidence":88}'),
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (p, b) => fetch(base + p, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

  try {
    const ok = await post("/api/interpret", { text: "the frocky one", options: OPTS });
    assert(ok.status === 200, "interpret: 200 on valid request", "got " + ok.status);
    assert(ok.json.choice === "dress", "interpret: valid option id passes through");
    assert(ok.json.confidence === 88, "interpret: confidence passes through");
    assert(ok.json.placeholder === false && ok.json.source === proxy.SPARK_MODEL,
      "interpret: placeholder false, spark source");
    assert(ok.json.cached === false, "interpret: first reply not cached");

    const again = await post("/api/interpret", { text: "the frocky one", options: OPTS });
    assert(again.status === 200 && again.json.choice === "dress" && again.json.cached === true,
      "interpret: repeat served from cache");

    const q = await post("/api/interpret", {
      text: "the frocky one", options: OPTS,
      question: "Which category did the user name?", context: "2 dresses, 1 bag",
    });
    assert(q.status === 200 && q.json.choice === "dress",
      "interpret: optional question/context accepted");

    const badText = await post("/api/interpret", { text: "", options: OPTS });
    assert(badText.status === 400, "interpret: empty text -> 400");
    const longText = await post("/api/interpret", { text: "x".repeat(301), options: OPTS });
    assert(longText.status === 400, "interpret: >300 char text -> 400");
    const noOpts = await post("/api/interpret", { text: "hello" });
    assert(noOpts.status === 400, "interpret: missing options -> 400");
    const manyOpts = await post("/api/interpret", {
      text: "hello",
      options: Array.from({ length: 25 }, (_, i) => ({ id: "opt_" + i, description: "option " + i })),
    });
    assert(manyOpts.status === 400, "interpret: >24 options -> 400");
    const badId = await post("/api/interpret", {
      text: "hello", options: [{ id: "DRESS!", description: "bad id shape" }],
    });
    assert(badId.status === 400, "interpret: option id outside [a-z0-9_:/-] -> 400");
    const badDesc = await post("/api/interpret", {
      text: "hello", options: [{ id: "dress", description: "y".repeat(121) }],
    });
    assert(badDesc.status === 400, "interpret: >120 char description -> 400");
  } finally {
    server.close();
  }

  // Invented id + explicit "none" both fail closed to choice null.
  const { server: s2 } = await proxy.startServer({
    port: 0, apiKey: "test-key",
    fetchImpl: stubFor('{"choice":"shoes","confidence":91}'),
  });
  try {
    const r = await fetch("http://127.0.0.1:" + s2.address().port + "/api/interpret", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "the strappy thing", options: OPTS }),
    });
    const json = await r.json().catch(() => ({}));
    assert(r.status === 200 && json.choice === null,
      "interpret: invented id (not in options) -> choice null");
    assert(json.placeholder === false, "interpret: invented id still placeholder false");
  } finally {
    s2.close();
  }

  const { server: s3 } = await proxy.startServer({
    port: 0, apiKey: "test-key",
    fetchImpl: stubFor('{"choice":"none","confidence":40}'),
  });
  try {
    const r = await fetch("http://127.0.0.1:" + s3.address().port + "/api/interpret", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "something else entirely", options: OPTS }),
    });
    const json = await r.json().catch(() => ({}));
    assert(r.status === 200 && json.choice === null && json.confidence === 40,
      "interpret: explicit none -> choice null");
  } finally {
    s3.close();
  }

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
