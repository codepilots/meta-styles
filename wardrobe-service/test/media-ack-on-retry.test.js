"use strict";
/* meta-styles — media-ack gated on terminal outcome (Opus finding #3).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves, with synthetic fixtures only and a REAL mock bot (genuine
 * send/media semantics, not stubs), that the LIVE agentic path in
 * wardrobe-service/server.js only acknowledges (DELETEs) inbound photo
 * media when the send outcome is terminal ("terminal:*"), never on
 * "retry":
 *
 *  Case 1 (no media loss on retry): a photo share whose first send fails
 *  with a transport failure (outcome "retry") must still have its media
 *  in the mock store afterwards (media_available:true) — before the fix
 *  the unconditional ack deleted it.
 *
 *  Case 2 (no regression on success): the same share re-offered with the
 *  send succeeding (outcome "terminal:sent") must have its media
 *  acknowledged exactly as before (media_available:false).
 *
 *  Case 3 (no silent reply loss): the full fail-then-succeed sequence
 *  produces exactly one outbound send and never resolves terminal via the
 *  "already answered earlier" false-duplicate branch — that branch only
 *  fires for media-gone shares, so keeping media on retry keeps it shut.
 *
 * All ids are SYNTH_-prefixed; no real account/media ids anywhere. No
 * real network traffic: the mock bot runs on loopback and only the
 * configured PROXY_BASE stub rejects.
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
  console.log("media-ack-on-retry.test.js");

  const realFetch = global.fetch;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-styles-media-ack-"));
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

  // Fail the FIRST POST /ig/send with a transport failure (sendComposed
  // sees bot_unreachable/status 0 -> noteRetry -> "retry"); every later
  // send passes through to the real mock bot. Proxy stays stubbed.
  let sendCalls = 0;
  global.fetch = function (url, opts) {
    const u = String(url);
    if (u.indexOf(PROXY_BASE) === 0) {
      return Promise.reject(new Error("proxy unreachable (stub)"));
    }
    if (u.indexOf("/ig/send") !== -1 && opts && opts.body) {
      sendCalls += 1;
      if (sendCalls === 1) {
        return Promise.reject(new Error("SYNTH transport failure (first send)"));
      }
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

    const inc = await botJson("POST", "/mock/incoming-photo", { caption: "SYNTH jacket" });
    assert.strictEqual(inc.status, 200, "incoming-photo accepted");
    let items = await shares();
    assert.strictEqual(items.length, 1, "one share present");
    const photo = items[0];
    assert.strictEqual(photo.media_available, true, "media available at first");
    assert.ok(typeof photo.media_id === "string" && photo.media_id, "media_id present");

    // --- Case 1: failed send retries AND keeps the media ---
    console.log("\n[failed send -> retry, media NOT acknowledged]");
    const svc = freshService();
    const out1 = await svc.processOne(photo);
    assert.strictEqual(out1, "retry", "failed send retries, got " + out1);
    assert.strictEqual(sendCalls, 1, "exactly one send attempt so far");
    assert.strictEqual((await outbound()).length, 0, "nothing went out on the failed attempt");
    items = await shares();
    const replayed = items.filter(function (s) { return s.id === photo.id; })[0];
    assert.strictEqual(replayed.media_available, true,
      "media still available after a retry (ack skipped), got media_available=" + replayed.media_available);

    // --- Case 2: successful re-offer sends terminal AND acks the media ---
    console.log("\n[successful retry -> terminal:sent, media acknowledged]");
    const out2 = await svc.processOne(replayed);
    assert.ok(typeof out2 === "string" && out2.indexOf("terminal:") === 0,
      "retry succeeds terminal, got " + out2);
    assert.ok(out2.indexOf("terminal:sent") === 0, "successful send, got " + out2);
    assert.strictEqual((await outbound()).length, 1, "exactly one outbound send, got " + (await outbound()).length);
    items = await shares();
    const collected = items.filter(function (s) { return s.id === photo.id; })[0];
    assert.strictEqual(collected.media_available, false,
      "media acknowledged after a terminal send, got media_available=" + collected.media_available);

    // --- Case 3: no silent reply loss across the sequence ---
    console.log("\n[no already-answered false-terminal, piece provenance intact]");
    const st = svc.status();
    assert.ok(!st.activity.some(function (l) { return /already answered earlier/.test(l); }),
      "no false already-answered line, activity=" + JSON.stringify(st.activity));
    const pieces = await catalog();
    assert.ok(pieces.some(function (p) { return p && p.source_share_id === photo.id; }),
      "catalogued piece keeps the real share id as provenance");
    assert.strictEqual((await outbound()).length, 1, "still exactly one outbound send");

    console.log("  pass: retry keeps media; terminal:sent acks media; one send, no false duplicate");
  } finally {
    global.fetch = realFetch;
    await new Promise(function (resolve) { botServer.close(resolve); });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("\nAll media-ack-on-retry tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
