"use strict";
/* meta-styles Milestone 18 — live isolation proof (NEW hackathon work,
 * building period Oct 27 – Nov 4, 2026).
 *
 * Replaces the old manual "hosts-block + browser console + network tab"
 * walk (docs/milestone-13-mock-dm-plan.md section 11) with something
 * CI-runnable: an automated regression test proving the judged chat flow
 * (wardrobe-service + mock-ig-bot + meta-api-proxy) makes ZERO outbound
 * network calls to anything other than 127.0.0.1 during a representative
 * multi-turn conversation.
 *
 * How it works:
 *  - Wraps global fetch (the ONLY fetch implementation anything in this
 *    repo calls — verified 2026-10-31: no require("node-fetch") anywhere
 *    under app/, wardrobe-service/, mock-ig-bot/, meta-api-proxy/; every
 *    caller uses the global fetch, including app/meta-client.js,
 *    app/inbox-bridge.js, app/send-client.js via root.fetch, and
 *    app/wardrobe-catalog.js) plus http.request/https.request as
 *    defense-in-depth. Every outbound attempt records its target
 *    host:port. Anything NOT on 127.0.0.1 is recorded AND blocked (the
 *    wrapper throws before any socket is opened, so no DNS lookup or
 *    connection for a non-loopback host can ever happen — the test
 *    itself is the most isolated thing in the repo).
 *  - Starts the REAL mock-ig-bot/server.js and meta-api-proxy/server.js
 *    in-process on ephemeral loopback ports (same startServer pattern as
 *    app/test/milestone13-mock-bot.test.js). The proxy runs with
 *    apiKey:"" (no MODEL_API_KEY), so every upstream call it would make
 *    takes its existing documented fallback path (503 key_missing in
 *    meta-api-proxy/server.js upstream(), caught by the same
 *    skill-fallback path as any other proxy failure) — no new fallback
 *    behavior invented here.
 *  - Drives a representative multi-turn conversation through the mock
 *    bot's real operator routes over real HTTP: inject photo 1 ->
 *    processOne -> inject photo 2 -> processOne -> inject "show me a
 *    look" text -> processOne -> inject a purchase question ->
 *    processOne, all through wardrobe-service/server.js processOne (the
 *    same entry point the production poll loop calls).
 *  - Asserts EVERY recorded outbound target was 127.0.0.1 (fail loudly,
 *    naming the offending host:port), AND that the conversation actually
 *    completed (bot replies recorded in /mock/outbound) — a pass on a
 *    silently-failed flow would prove nothing.
 *
 * All ids/tokens/bytes below are synthetic (SYNTH_ prefix,
 * example.invalid URLs, locally generated PNGs) — never real data.
 *
 * Run: node wardrobe-service/test/network-isolation-e2e.test.js
 */
const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

// Sandbox sets an HTTP proxy; everything here is local-only, bypass it.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const TOKEN = "SYNTH_mock_token";

// 1x1 transparent PNG, generated locally — synthetic fixture bytes.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const targets = []; // every outbound attempt: "host:port"
const violations = []; // non-loopback attempts (also blocked, never sent)

function hostOf(input, init) {
  try {
    if (typeof input === "string" || input instanceof URL) {
      const u = new URL(String(input));
      return { host: u.hostname, port: u.port || (u.protocol === "https:" ? "443" : "80") };
    }
    if (input && typeof input === "object") {
      const host = input.hostname || input.host || "localhost";
      const port = String(input.port || (input.protocol === "https:" ? "443" : "80"));
      return { host: String(host).split(":")[0], port: port };
    }
  } catch (e) { /* fall through */ }
  return { host: "unparseable", port: "?" };
}

function checkTarget(host, port) {
  const label = host + ":" + port;
  targets.push(label);
  if (host !== "127.0.0.1") {
    violations.push(label);
    const err = new Error("network-isolation violation: blocked outbound call to " + label);
    err.code = "ISOLATION_VIOLATION";
    throw err;
  }
}

const realFetch = global.fetch;
global.fetch = function (input, init) {
  const t = hostOf(input, init);
  checkTarget(t.host, t.port);
  return realFetch.call(this, input, init);
};

function wrapRequest(mod) {
  const orig = mod.request;
  mod.request = function (a, b, c) {
    const opts = typeof a === "string" || a instanceof URL ? (b || {}) : (a || {});
    const t = hostOf(typeof a === "string" || a instanceof URL ? a : opts, b);
    checkTarget(t.host, t.port);
    return orig.apply(this, arguments);
  };
  const origGet = mod.get;
  mod.get = function (a, b, c) {
    const opts = typeof a === "string" || a instanceof URL ? (b || {}) : (a || {});
    const t = hostOf(typeof a === "string" || a instanceof URL ? a : opts, b);
    checkTarget(t.host, t.port);
    return origGet.apply(this, arguments);
  };
}
wrapRequest(http);
wrapRequest(https);

function authHeaders(extra) {
  return Object.assign({ Authorization: "Bearer " + TOKEN }, extra || {});
}

async function run() {
  console.log("network-isolation-e2e.test.js (Milestone 18)");

  const { startServer: startMock } = require("../../mock-ig-bot/server.js");
  const { startServer: startProxy } = require("../../meta-api-proxy/server.js");

  const catalogDir = fs.mkdtempSync(path.join(os.tmpdir(), "m18-isolation-catalog-"));
  const mock = await startMock({ port: 0, token: TOKEN, catalogDir: catalogDir });
  const mockPort = mock.server.address().port;
  const mockBase = "http://127.0.0.1:" + mockPort;

  // Keyless proxy: every upstream Meta API call takes the existing
  // documented 503 key_missing fallback path (see upstream() in
  // meta-api-proxy/server.js) — never a real external call.
  const proxy = await startProxy({ port: 0, apiKey: "" });
  const proxyPort = proxy.server.address().port;
  assert.ok(!(process.env.MODEL_API_KEY || ""), "proxy must run keyless for this test");
  const health = await (await fetch("http://127.0.0.1:" + proxyPort + "/health")).json();
  assert.strictEqual(health.keyPresent, false, "proxy is keyless, got " + JSON.stringify(health));

  const Service = require("../server.js");
  const svc = Service.createService({
    botBase: mockBase,
    proxyBase: "http://127.0.0.1:" + proxyPort,
    readToken: TOKEN, catalogToken: TOKEN, sendToken: TOKEN,
    port: 0, nowMs: function () { return Date.now(); }
  });

  async function injectPhoto(caption) {
    const res = await fetch(mockBase + "/mock/incoming-photo?caption=" + encodeURIComponent(caption), {
      method: "POST", headers: authHeaders({ "Content-Type": "image/png" }), body: PNG_1PX,
    });
    assert.strictEqual(res.status, 200, "inject photo -> 200, got " + res.status);
    return (await res.json()).share;
  }

  async function injectText(text) {
    const res = await fetch(mockBase + "/mock/incoming-text", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text: text }),
    });
    assert.strictEqual(res.status, 200, "inject text -> 200, got " + res.status);
    return (await res.json()).share;
  }

  async function processNewShares() {
    const res = await fetch(mockBase + "/ig/shares?limit=50", { headers: authHeaders() });
    assert.strictEqual(res.status, 200, "poll shares -> 200, got " + res.status);
    const body = await res.json();
    const outcomes = [];
    for (const item of body.items) {
      outcomes.push(await svc.processOne(item));
    }
    return outcomes;
  }

  async function outboundCount() {
    const res = await fetch(mockBase + "/mock/outbound", { headers: authHeaders() });
    return (await res.json()).outbound.length;
  }

  // --- Turn 1: photo share -> catalogue_piece reply ---
  console.log("\n[turn 1: photo -> catalogue_piece]");
  await injectPhoto("SYNTH dress");
  let outcomes = await processNewShares();
  assert.ok(outcomes.some(function (o) { return typeof o === "string" && o.indexOf("terminal:") === 0; }),
    "turn 1 reaches a terminal outcome, got " + JSON.stringify(outcomes));
  let sent = await outboundCount();
  assert.ok(sent >= 1, "turn 1 produced a real bot reply, outbound=" + sent);
  console.log("  pass: photo processed, bot replied (outbound=" + sent + ")");

  // --- Turn 2: second photo share -> reply (completes the two-photo arc) ---
  console.log("\n[turn 2: second photo -> reply]");
  await injectPhoto("my cardigan");
  outcomes = await processNewShares();
  assert.ok(outcomes.some(function (o) { return typeof o === "string" && o.indexOf("terminal:") === 0; }),
    "turn 2 reaches a terminal outcome, got " + JSON.stringify(outcomes));
  const sent2 = await outboundCount();
  assert.ok(sent2 > sent, "turn 2 produced another real bot reply, outbound=" + sent2);
  sent = sent2;
  console.log("  pass: second photo processed, bot replied (outbound=" + sent + ")");

  // --- Turn 3: "show me a look" -> propose_look reply ---
  console.log("\n[turn 3: 'show me a look' -> propose_look]");
  await injectText("show me a look");
  outcomes = await processNewShares();
  assert.ok(outcomes.some(function (o) { return typeof o === "string" && o.indexOf("terminal:") === 0; }),
    "turn 3 reaches a terminal outcome, got " + JSON.stringify(outcomes));
  const log = svc.getAgenticLog();
  assert.ok(log.some(function (e) { return e.skill === "propose_look"; }),
    "propose_look ran, got skills " + JSON.stringify(log.map(function (e) { return e.skill; })));
  const sent3 = await outboundCount();
  assert.ok(sent3 > sent, "turn 3 produced another real bot reply, outbound=" + sent3);
  sent = sent3;
  console.log("  pass: propose_look ran and bot replied (outbound=" + sent + ")");

  // --- Turn 4: purchase question -> revise/purchase-suggestion reply ---
  console.log("\n[turn 4: purchase question -> reply]");
  await injectText("should I buy this top to go with my wardrobe?");
  outcomes = await processNewShares();
  assert.ok(outcomes.some(function (o) { return typeof o === "string" && o.indexOf("terminal:") === 0; }),
    "turn 4 reaches a terminal outcome, got " + JSON.stringify(outcomes));
  const sent4 = await outboundCount();
  assert.ok(sent4 > sent, "turn 4 produced another real bot reply, outbound=" + sent4);
  console.log("  pass: purchase question processed, bot replied (outbound=" + sent4 + ")");

  // --- Isolation verdict: EVERY recorded target was 127.0.0.1 ---
  console.log("\n[isolation verdict: " + targets.length + " outbound attempts recorded]");
  const nonLoop = targets.filter(function (t) { return t.split(":")[0] !== "127.0.0.1"; });
  assert.strictEqual(nonLoop.length, 0,
    "non-loopback outbound calls attempted: " + JSON.stringify(nonLoop));
  assert.strictEqual(violations.length, 0,
    "blocked violations: " + JSON.stringify(violations));
  assert.ok(targets.length > 10,
    "the flow must have made real loopback calls (not passed vacuously), got " + targets.length);
  const sawMock = targets.some(function (t) { return t === "127.0.0.1:" + mockPort; });
  const sawProxy = targets.some(function (t) { return t === "127.0.0.1:" + proxyPort; });
  assert.ok(sawMock, "real traffic reached the mock bot (:" + mockPort + ")");
  assert.ok(sawProxy, "real traffic reached the keyless proxy (:" + proxyPort + ")");
  console.log("  pass: all " + targets.length + " outbound attempts were 127.0.0.1");
  console.log("  pass: traffic reached mock bot (:" + mockPort + ") and proxy (:" + proxyPort + ")");

  mock.server.close();
  proxy.server.close();
  console.log("\nAll network isolation e2e tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
