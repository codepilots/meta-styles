"use strict";
/* meta-styles — media-fetch failure retries the agentic turn (Opus finding #4, part 1).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves, with synthetic fixtures only and a REAL mock bot (genuine
 * send/media semantics, not stubs), that a photo share whose media fetch
 * fails (GET /ig/media/<id> answers non-OK) does NOT proceed as a textless
 * turn through catalogue_piece or any other skill. Instead
 * runAgenticTurn rejects with media_unavailable, the existing errHandler in
 * processAgenticShare catches it, and the share retries:
 *  - processOne resolves "retry" (share stays pending, retried next tick);
 *  - the media is NOT acknowledged (media_available:true afterwards);
 *  - nothing is sent (outbound log empty) and nothing is catalogued
 *    (no piece carries the share id);
 *  - the user-visible activity line matches the existing "Your photo isn't
 *    ready yet" wording;
 *  - a second attempt still retries with no send (no false terminal, no
 *    "already answered earlier" line).
 *
 * No real network traffic: the mock bot runs on loopback; only the
 * configured PROXY_BASE stub and the /ig/media/<id> route reject/fail.
 */
const assert = require("assert");
// Loopback fetch must bypass the sandbox proxy (same pattern as
// milestone13-mock-bot.test.js) — otherwise the real mock bot below is
// unreachable and every bot call fails as a proxy 502.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;
const fs = require("fs");
const os = require("os");
const path = require("path");

const MockBot = require("../../mock-ig-bot/server.js");

const TOKEN = "SYNTH_mock_token";
const DEMO_REF = "u_deadbeefdeadbeefdeadbeefdeadbeef";
const PROXY_BASE = "http://127.0.0.1:59999";

async function run() {
  console.log("media-fetch-failure-retry.test.js");

  const realFetch = global.fetch;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-styles-media-fail-"));
  const { server: botServer } = await MockBot.startServer({
    port: 0, token: TOKEN, catalogDir: tmpDir, catalogSecret: "SYNTH_test_catalog_secret",
  });
  const botBase = "http://127.0.0.1:" + botServer.address().port;

  async function botJson(method, urlPath, body) {
    const res = await realFetch(botBase + urlPath, {
      method: method,
      headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = null; }
    return { status: res.status, body: parsed };
  }

  async function outbound() {
    const res = await botJson("GET", "/mock/outbound");
    assert.strictEqual(res.status, 200, "outbound readable");
    return res.body.outbound;
  }

  async function shares() {
    const res = await realFetch(botBase + "/ig/shares?limit=50", {
      headers: { Authorization: "Bearer " + TOKEN },
    });
    assert.strictEqual(res.status, 200, "shares readable");
    return (await res.json()).items;
  }

  async function catalog() {
    const res = await realFetch(botBase + "/ig/catalog/" + DEMO_REF, {
      headers: { Authorization: "Bearer " + TOKEN },
    });
    assert.strictEqual(res.status, 200, "catalog readable");
    return await res.json();
  }

  // Media fetch fails (non-OK on GET /ig/media/<id>); proxy stub rejects;
  // everything else passes through to the real mock bot.
  global.fetch = function (url, opts) {
    const u = String(url);
    if (u.indexOf(PROXY_BASE) === 0) {
      return Promise.reject(new Error("proxy unreachable (stub)"));
    }
    if (u.indexOf("/ig/media/") !== -1) {
      return Promise.resolve({ ok: false, status: 500 });
    }
    return realFetch(url, opts);
  };

  delete require.cache[require.resolve("../server.js")];
  const Service = require("../server.js");
  function freshService() {
    return Service.createService({
      botBase: botBase, proxyBase: PROXY_BASE,
      readToken: TOKEN, catalogToken: TOKEN, sendToken: TOKEN,
      port: 0, nowMs: function () { return Date.now(); },
    });
  }

  try {
    const put = await botJson("PUT", "/ig/catalog/" + DEMO_REF, []);
    assert.ok(put.status === 200 || put.status === 204, "catalog seed PUT, got " + put.status);

    const inc = await botJson("POST", "/mock/incoming-photo", { caption: "SYNTH dress" });
    assert.strictEqual(inc.status, 200, "incoming-photo accepted");
    let items = await shares();
    assert.strictEqual(items.length, 1, "one share present");
    const photo = items[0];
    assert.strictEqual(photo.media_available, true, "media available at first");
    assert.ok(typeof photo.media_id === "string" && photo.media_id, "media_id present");

    // --- Attempt 1: media fetch fails -> retry, media kept, nothing sent ---
    console.log("\n[media fetch fails -> retry, media kept, no send, no catalogue]");
    const svc = freshService();
    const out1 = await svc.processOne(photo);
    assert.strictEqual(out1, "retry", "failed media fetch retries, got " + out1);
    assert.strictEqual((await outbound()).length, 0, "nothing sent on a failed media fetch");
    items = await shares();
    const replayed = items.filter(function (s) { return s.id === photo.id; })[0];
    assert.strictEqual(replayed.media_available, true,
      "media NOT acknowledged on retry, got media_available=" + replayed.media_available);
    const pieces = await catalog();
    assert.ok(!pieces.some(function (p) { return !!p && p.source_share_id === photo.id; }),
      "no piece catalogued for the unseen photo");
    const st1 = svc.status();
    assert.ok(st1.activity.some(function (l) { return /Your photo isn't ready yet/.test(l); }),
      "existing not-ready activity line, activity=" + JSON.stringify(st1.activity));
    assert.ok(!st1.activity.some(function (l) { return /tucked safely|Catalogued a piece/.test(l); }),
      "no success/catalogued line, activity=" + JSON.stringify(st1.activity));

    // --- Attempt 2: still failing -> still retry, still nothing sent ---
    console.log("\n[second tick -> still retry, still no send, no false duplicate]");
    const out2 = await svc.processOne(replayed);
    assert.strictEqual(out2, "retry", "second attempt still retries, got " + out2);
    assert.strictEqual((await outbound()).length, 0, "still nothing sent");
    const st2 = svc.status();
    assert.ok(!st2.activity.some(function (l) { return /already answered earlier/.test(l); }),
      "no false already-answered line, activity=" + JSON.stringify(st2.activity));

    console.log("  pass: media failure retries with media kept, no send, no catalogue, honest line");
  } finally {
    global.fetch = realFetch;
    await new Promise(function (resolve) { botServer.close(resolve); });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("\nAll media-fetch-failure-retry tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
