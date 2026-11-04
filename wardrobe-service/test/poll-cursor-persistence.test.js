"use strict";
/* meta-styles — wardrobe-service opaque poll-cursor persistence.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * The in-memory poll cursor used to reset on every service restart, so a
 * new process re-read the bot's whole share history and re-ran an agentic
 * turn for every old share (sends stayed deduped by the stable per-share
 * idempotency key, but the re-runs still mutated state and cost Spark
 * calls). The service now persists ONLY the opaque cursor to a small
 * local JSON file — { mode, bot_base, cursor, updated_at } — no user
 * data, no share ids, no text.
 *
 * Proves, with synthetic fixtures only and a REAL mock bot (genuine
 * paging/idempotency semantics, not stubs):
 *   1. A tick that ends fully terminal writes the cursor file; a NEW
 *      service instance with the same file and bot resumes from the
 *      cursor — Router.classify/classifySync (the agentic-turn entry)
 *      runs only for the share added after the restart, old shares are
 *      never re-offered (polled count proves it), and no old reply is
 *      re-sent. The file carries exactly the four paging keys.
 *   2. A cursor file with a different bot_base or mode is ignored
 *      (replay from the start, as today).
 *   3. A corrupt or unwritable cursor file never crashes and behaves as
 *      today (replay from the start), with an honest activity line.
 *   4. Mock-bot contract lock: `since` greater than the share count is a
 *      400; the service then replays from the start exactly once (one
 *      stale-cursor line) and processes shares added after the simulated
 *      mock-bot restart.
 *
 * All ids are SYNTH_-prefixed; media bytes are tiny synthetic PNGs; no
 * real network, no secrets, stdlib only. No user ref/id string leaks
 * into any activity line or the cursor file.
 */
const assert = require("assert");
// Loopback fetch must bypass the sandbox proxy — otherwise the real mock
// bot below is unreachable and every bot call fails as a proxy 502.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;
const fs = require("fs");
const os = require("os");
const path = require("path");

const MockBot = require("../../mock-ig-bot/server.js");

const TOKEN = "SYNTH_mock_token";
const DEMO_REF = "u_deadbeefdeadbeefdeadbeefdeadbeef";
const PROXY_BASE = "http://127.0.0.1:59999";

// 1x1 PNG (synthetic bytes for mock-local photo shares).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

function assertNoLeak(lines, label) {
  const blob = lines.join("\n");
  assert.ok(blob.indexOf("SYNTH_") === -1,
    label + " must not leak SYNTH_ ids, got " + JSON.stringify(lines));
}

async function run() {
  console.log("poll-cursor-persistence.test.js");

  const realFetch = global.fetch;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-styles-cursor-"));
  const cursorFile = path.join(tmpDir, "cursor", "poll-cursor.json");

  // Proxy stub: everything under the fake proxy base rejects (forces the
  // labelled local fallbacks deterministically); the bot stays reachable.
  // Counts proxy calls so the tests can tell agentic work apart.
  let proxyCalls = 0;
  global.fetch = function (url, opts) {
    if (String(url).indexOf(PROXY_BASE) === 0) {
      proxyCalls += 1;
      return Promise.reject(new Error("proxy unreachable (stub)"));
    }
    return realFetch(url, opts);
  };

  // Router spy: counts agentic-turn entries (the service re-requires
  // server.js per fresh service, but app/router.js stays the same module
  // object, so wrapping its methods observes every instance).
  const Router = require("../../app/router.js");
  const origClassify = Router.classify;
  const origClassifySync = Router.classifySync;
  let routerCalls = 0;
  if (typeof origClassify === "function") {
    Router.classify = function () {
      routerCalls += 1;
      return origClassify.apply(this, arguments);
    };
  }
  if (typeof origClassifySync === "function") {
    Router.classifySync = function () {
      routerCalls += 1;
      return origClassifySync.apply(this, arguments);
    };
  }

  function freshService(extra) {
    delete require.cache[require.resolve("../server.js")];
    const Service = require("../server.js");
    return Service.createService(Object.assign({
      botBase: botBase, proxyBase: PROXY_BASE,
      readToken: TOKEN, catalogToken: TOKEN, sendToken: TOKEN,
      port: 0, nowMs: function () { return Date.now(); },
      cursorFile: cursorFile,
    }, extra || {}));
  }

  let botServer = null;
  let botBase = null;
  async function startBot() {
    const started = await MockBot.startServer({
      port: 0, token: TOKEN, catalogDir: tmpDir, catalogSecret: "SYNTH_test_catalog_secret",
    });
    botServer = started.server;
    botBase = "http://127.0.0.1:" + botServer.address().port;
  }
  async function stopBot() {
    if (botServer) {
      await new Promise(function (resolve) { botServer.close(resolve); });
      botServer = null;
    }
  }

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

  try {
    await startBot();

    // --- 1. Cursor file written on a terminal page; resume skips old shares ---
    console.log("\n[cursor written; new instance resumes from it]");
    await botJson("POST", "/mock/incoming-text", { text: "show me a look" });
    const svcA = freshService();
    const tickA = await svcA.tick();
    assert.strictEqual(tickA.tick, "ok", "tick ok, got " + JSON.stringify(tickA));
    assert.strictEqual(tickA.items, 1, "one share processed");
    assert.strictEqual((await outbound()).length, 1, "one send went out");

    assert.ok(fs.existsSync(cursorFile), "cursor file written at " + cursorFile);
    const raw = fs.readFileSync(cursorFile, "utf8");
    assert.ok(raw.indexOf("SYNTH_") === -1, "cursor file holds no synthetic ids, got " + raw);
    const saved = JSON.parse(raw);
    assert.deepStrictEqual(Object.keys(saved).sort(),
      ["bot_base", "cursor", "mode", "updated_at"],
      "cursor file holds exactly the four paging keys");
    assert.strictEqual(saved.mode, "mock", "mode persisted");
    assert.strictEqual(saved.bot_base, botBase, "bot_base persisted");
    assert.strictEqual(saved.cursor, "1", "cursor advanced past the terminal page");
    assert.ok(!isNaN(Date.parse(saved.updated_at)), "updated_at is a timestamp");

    // A share added after the "restart", then a NEW service instance with
    // the same file and bot resumes from the cursor.
    await realFetch(botBase + "/mock/incoming-photo", {
      method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "image/png" }, body: PNG,
    });
    routerCalls = 0;
    proxyCalls = 0;
    const svcB = freshService();
    const tickB = await svcB.tick();
    assert.strictEqual(tickB.tick, "ok", "resume tick ok, got " + JSON.stringify(tickB));
    assert.strictEqual(tickB.items, 1, "only the new share re-offered, got " + tickB.items);
    assert.ok(tickB.outcomes.every(function (o) { return o.indexOf("terminal:") === 0; }),
      "new share terminal, got " + JSON.stringify(tickB.outcomes));
    assert.strictEqual((await outbound()).length, 2, "exactly one new send, no resend of the old share");
    assert.strictEqual(routerCalls, 1, "agentic turn ran only for the new share, got " + routerCalls);
    assert.strictEqual(svcB.status().counts.polled, 1, "polled count proves old shares were never re-offered");
    // The terminal page advanced the persisted cursor again.
    assert.strictEqual(JSON.parse(fs.readFileSync(cursorFile, "utf8")).cursor, "2",
      "cursor file advanced past the new share");
    assertNoLeak(svcB.status().activity, "resume activity");
    console.log("  pass: cursor file written, resume skips old shares, new share processed");

    // --- 2. Foreign cursor file (bot_base or mode) is ignored ---
    console.log("\n[foreign cursor file ignored]");
    fs.writeFileSync(cursorFile, JSON.stringify({
      mode: "mock", bot_base: "http://127.0.0.1:1", cursor: "99",
      updated_at: new Date().toISOString(),
    }));
    const svcForeignBase = freshService();
    const tickForeign = await svcForeignBase.tick();
    assert.strictEqual(tickForeign.items, 2, "different bot_base replays from the start, got " + tickForeign.items);
    fs.writeFileSync(cursorFile, JSON.stringify({
      mode: "live", bot_base: botBase, cursor: "99",
      updated_at: new Date().toISOString(),
    }));
    const svcForeignMode = freshService();
    const tickForeignMode = await svcForeignMode.tick();
    assert.strictEqual(tickForeignMode.items, 2, "different mode replays from the start, got " + tickForeignMode.items);
    // Neither foreign file was clobbered into a matching cursor... the
    // ticks above WERE fully terminal, so the file now legitimately
    // tracks this bot again — restore the true cursor for the next step.
    assert.strictEqual(JSON.parse(fs.readFileSync(cursorFile, "utf8")).bot_base, botBase,
      "terminal replay re-anchors the cursor file to this bot");
    console.log("  pass: foreign mode/bot_base ignored, replay from start");

    // --- 3. Corrupt / unwritable cursor file: fail-soft, behaves as today ---
    console.log("\n[corrupt cursor file ignored, no crash]");
    fs.writeFileSync(cursorFile, "not-json{{{");
    const svcCorrupt = freshService();
    const tickCorrupt = await svcCorrupt.tick();
    assert.strictEqual(tickCorrupt.tick, "ok", "tick ok despite corrupt file");
    assert.strictEqual(tickCorrupt.items, 2, "replay from the start, got " + tickCorrupt.items);
    assert.ok(svcCorrupt.status().activity.some(function (l) { return /saved poll cursor/.test(l); }),
      "corrupt file logged, activity=" + JSON.stringify(svcCorrupt.status().activity));
    console.log("  pass: corrupt file ignored with an honest line");

    console.log("\n[unwritable cursor path ignored, no crash]");
    const notADir = path.join(tmpDir, "a-file-not-a-dir");
    fs.writeFileSync(notADir, "x");
    const svcUnwritable = freshService({ cursorFile: path.join(notADir, "cursor.json") });
    const tickUnwritable = await svcUnwritable.tick();
    assert.strictEqual(tickUnwritable.tick, "ok", "tick ok despite unwritable path");
    assert.strictEqual(tickUnwritable.items, 2, "replay from the start, got " + tickUnwritable.items);
    assert.ok(svcUnwritable.status().activity.some(function (l) { return /poll cursor/.test(l); }),
      "unwritable path logged, activity=" + JSON.stringify(svcUnwritable.status().activity));
    assert.strictEqual((await outbound()).length, 2, "no duplicate sends from replayed shares");
    console.log("  pass: unwritable path fail-soft, no duplicate sends");

    // --- 4. Mock 400 on bad since; service replays from the start once ---
    console.log("\n[since beyond history is a 400; service recovers once]");
    const bad = await realFetch(botBase + "/ig/shares?limit=50&since=9999", {
      headers: { Authorization: "Bearer " + TOKEN },
    });
    assert.strictEqual(bad.status, 400, "since > length is a 400, got " + bad.status);
    const empty = await realFetch(botBase + "/ig/shares?limit=50&since=2", {
      headers: { Authorization: "Bearer " + TOKEN },
    });
    assert.strictEqual(empty.status, 200, "since == length is an empty 200, got " + empty.status);

    // Simulate a mock-bot restart: a fresh empty store. It listens on a
    // fresh port (same-port re-listen trips the test process's shared
    // undici keep-alive pool — a harness artifact; a real service restart
    // gets a fresh pool too), and the anchored cursor file is re-pointed
    // at the new base, so mode+base still match a cursor beyond history.
    await stopBot();
    await startBot();
    fs.writeFileSync(cursorFile, JSON.stringify({
      mode: "mock", bot_base: botBase, cursor: "2",
      updated_at: new Date().toISOString(),
    }));
    await botJson("POST", "/mock/incoming-text", { text: "hello after restart" });
    const before = (await outbound()).length;

    const svcC = freshService();
    const errTick = await svcC.tick();
    assert.strictEqual(errTick.tick, "error", "stale cursor surfaces one error tick, got " + JSON.stringify(errTick));
    const okTick = await svcC.tick();
    assert.strictEqual(okTick.tick, "ok", "replay tick ok, got " + JSON.stringify(okTick));
    assert.strictEqual(okTick.items, 1, "replay processes the post-restart share, got " + okTick.items);
    assert.ok(okTick.outcomes.every(function (o) { return o.indexOf("terminal:") === 0; }),
      "post-restart share terminal, got " + JSON.stringify(okTick.outcomes));
    const staleLines = svcC.status().activity.filter(function (l) { return /went stale/.test(l); });
    assert.strictEqual(staleLines.length, 1, "exactly one stale-cursor recovery, got " + JSON.stringify(svcC.status().activity));
    assert.strictEqual((await outbound()).length, before + 1, "exactly one new send after the restart");
    assert.strictEqual(JSON.parse(fs.readFileSync(cursorFile, "utf8")).cursor, "1",
      "cursor file re-anchored after recovery");
    console.log("  pass: 400 on bad since, one stale recovery, new share processed");

    console.log("\nAll poll-cursor persistence tests passed.");
  } finally {
    if (typeof origClassify === "function") Router.classify = origClassify;
    if (typeof origClassifySync === "function") Router.classifySync = origClassifySync;
    global.fetch = realFetch;
    await stopBot();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
