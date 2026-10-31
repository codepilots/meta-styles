"use strict";
/* meta-styles Opus finding #15 — proxy upstream timeout tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Covers: a hung upstream (mock fetchImpl that never settles) is aborted
 * and surfaces as the SAME 502 shape other upstream failures use
 * ({ error: "upstream_timeout" }), so callers hit the existing
 * skill-fallback path; the AbortSignal is actually passed to fetchImpl;
 * a signal-abiding mock (rejects with AbortError on abort, like real
 * fetch) yields the same 502 shape; a fast upstream still succeeds.
 * No network. cfg.timeoutMs injects a tiny bound so tests never wait
 * the real per-route timeouts.
 *
 * Run: node meta-api-proxy/test/upstream-timeout.test.js
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

// Never settles: simulates a hung Meta call, ignoring the abort signal
// entirely (worst case — the race must still bound it).
let seenSignal = null;
function fakeHang(url, opts) {
  seenSignal = opts && opts.signal;
  return new Promise(() => {});
}

// Behaves like real fetch: rejects with an abort-named error on abort.
function fakeAbortAware(url, opts) {
  const signal = opts && opts.signal;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const e = new Error("This operation was aborted");
      e.name = "AbortError";
      reject(e);
    };
    if (!signal) { resolve({ ok: true, status: 200, text: () => Promise.resolve("{}") }); return; }
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener("abort", onAbort);
  });
}

function fakeFast(url, opts) {
  assert(opts && opts.signal, "timeout: fetchImpl receives an AbortSignal");
  const payload = {
    output: [{ content: [{ type: "output_text", text: '{"category":"dress","confidence":0.9}' }] }]
  };
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) });
}

async function main() {
  // Per-route bounds stay shorter than the matching app/meta-client.js
  // timeouts (classify/palette/copy/assemble 60s, route 30s, preview
  // 120s, segment 180s whole-op over <=8 phrases).
  assert(proxy.DEFAULT_UPSTREAM_TIMEOUT_MS < 60000,
    "timeout: default bound < 60s client (classify/palette/copy/assemble)");
  assert(proxy.ROUTE_UPSTREAM_TIMEOUT_MS < 30000,
    "timeout: route bound < 30s client");
  assert(proxy.PREVIEW_UPSTREAM_TIMEOUT_MS < 120000,
    "timeout: preview bound < 120s client");
  assert(proxy.SEGMENT_PHRASE_TIMEOUT_MS * 8 < 180000,
    "timeout: segment whole-op worst case < 180s client");

  // 1. Hung upstream -> bounded 502 upstream_timeout, signal aborted.
  {
    seenSignal = null;
    const { server } = await proxy.startServer({ port: 0, apiKey: "test-key", fetchImpl: fakeHang, timeoutMs: 50 });
    const base = "http://127.0.0.1:" + server.address().port;
    try {
      const t0 = Date.now();
      const r = await fetch(base + "/api/classify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: "data:image/jpeg;base64,SYNTH_ahng_1" }),
      });
      const json = await r.json().catch(() => ({}));
      const elapsed = Date.now() - t0;
      assert(r.status === 502 && json.error === "upstream_timeout",
        "timeout: hung classify -> 502 upstream_timeout", "got " + r.status + " " + JSON.stringify(json));
      assert(typeof json.message === "string" && json.message.includes("50ms"),
        "timeout: message names the bound");
      assert(json.upstream && typeof json.upstream.raw === "string" && json.upstream.raw.includes("timeout"),
        "timeout: upstream.raw describes the timeout (502 fallback shape)");
      assert(elapsed < 5000,
        "timeout: hung call bounded far below the real timeout", elapsed + "ms");
      assert(seenSignal && seenSignal.aborted === true,
        "timeout: abort signal fired on the hung fetch");
    } finally {
      server.close();
    }
  }

  // 2. Signal-abiding upstream (AbortError like real fetch) -> same shape.
  {
    const { server } = await proxy.startServer({ port: 0, apiKey: "test-key", fetchImpl: fakeAbortAware, timeoutMs: 50 });
    const base = "http://127.0.0.1:" + server.address().port;
    try {
      const r = await fetch(base + "/api/palette", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: "data:image/jpeg;base64,SYNTH_ahng_2" }),
      });
      const json = await r.json().catch(() => ({}));
      assert(r.status === 502 && json.error === "upstream_timeout",
        "timeout: abort-rejecting fetch -> 502 upstream_timeout", "got " + r.status);
    } finally {
      server.close();
    }
  }

  // 3. Fast upstream still succeeds (the race must not break the hot path).
  {
    const { server } = await proxy.startServer({ port: 0, apiKey: "test-key", fetchImpl: fakeFast, timeoutMs: 1000 });
    const base = "http://127.0.0.1:" + server.address().port;
    try {
      const r = await fetch(base + "/api/classify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: "data:image/jpeg;base64,SYNTH_fast_1" }),
      });
      const json = await r.json().catch(() => ({}));
      assert(r.status === 200 && json.category === "dress" && json.placeholder === false,
        "timeout: fast upstream unaffected", "got " + r.status);
    } finally {
      server.close();
    }
  }

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
