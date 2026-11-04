"use strict";
/* meta-styles — already-answered multi-detect + per-attachment provenance + gone-media backstop.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Locks the 2026-11-03 stuck-photo fix with synthetic fixtures only:
 *
 *   A. Multi-detect photo -> combined ask -> "yes" adds pieces under the
 *      photo's per-region share id AND acks the retained media
 *      (collect-then-delete). A NEW service instance with NO cursor file
 *      then replays the photo (media_available:false) and resolves it
 *      terminal as already-answered on the first pass: no "isn't ready
 *      yet", no retries, no second send, no media re-fetch, no second
 *      detect call. Uses a REAL mock bot; only /api/detect is stubbed
 *      (every other proxy route rejects, forcing labelled fallbacks).
 *   B. Per-attachment provenance bridge (unit-style, stubbed fetch): a
 *      piece catalogued under the full per-attachment id
 *      <mid>:<media_id> matches a replay surfacing the bare mid — and
 *      vice versa — as already-answered. Two distinct FULL
 *      per-attachment ids under one mid never match (attachments stay
 *      distinct): the uncatalogued sibling with confirmed-gone media
 *      goes terminal:media_gone instead, never a false duplicate.
 *   C. Gone-media backstop (unit-style): a media-gone share matching
 *      nothing whose GET /ig/media 404s goes terminal:media_gone at once
 *      with an honest line (no retries, no send, no give-up). A non-404
 *      probe outcome (bytes present, flag lag, transient error) keeps
 *      the retry for genuinely not-yet-downloaded media.
 *
 * All ids are SYNTH_-prefixed; no real account/media ids anywhere. No
 * user ref/id string leaks into any activity line (asserted).
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
  console.log("already-answered-multidetect.test.js");

  // --- A. Multi-detect ask/yes/ack, then restart replay without cursor ---
  console.log("\n[multi-detect yes-add acks media; replay is terminal-duplicate]");
  {
    const realFetch = global.fetch;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-styles-multidetect-"));
    const { server: botServer } = await MockBot.startServer({
      port: 0, token: TOKEN, catalogDir: tmpDir, catalogSecret: "SYNTH_test_catalog_secret",
    });
    const botBase = "http://127.0.0.1:" + botServer.address().port;

    let detectCalls = 0;
    let mediaGets = 0;
    global.fetch = function (url, opts) {
      const u = String(url);
      if (u.indexOf(PROXY_BASE + "/api/detect") === 0) {
        detectCalls += 1;
        return Promise.resolve({
          ok: true, status: 200,
          json: function () {
            return Promise.resolve({
              placeholder: false,
              pieces: [
                { category: "base/top", bbox: [0.1, 0.1, 0.3, 0.3] },
                { category: "bag", bbox: [0.6, 0.6, 0.2, 0.2] },
              ],
            });
          },
        });
      }
      if (u.indexOf(PROXY_BASE) === 0) {
        return Promise.reject(new Error("proxy unreachable (stub)"));
      }
      if (u.indexOf("/ig/media/") !== -1 && (!opts || opts.method !== "DELETE")) {
        mediaGets += 1;
      }
      return realFetch(url, opts);
    };

    function freshService() {
      delete require.cache[require.resolve("../server.js")];
      const Service = require("../server.js");
      return Service.createService({
        botBase: botBase, proxyBase: PROXY_BASE,
        readToken: TOKEN, catalogToken: TOKEN, sendToken: TOKEN,
        port: 0, nowMs: function () { return Date.now(); },
        cursorFile: null,
      });
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
    async function shares() {
      const res = await realFetch(botBase + "/ig/shares?limit=50", {
        headers: { Authorization: "Bearer " + TOKEN },
      });
      assert.strictEqual(res.status, 200, "shares readable");
      return (await res.json()).items;
    }

    try {
      // One multi-garment photo: the ask turn sends the combined question
      // and retains the media (nothing catalogued yet).
      await realFetch(botBase + "/mock/incoming-photo", {
        method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "image/png" }, body: PNG,
      });
      const svc1 = freshService();
      const askTick = await svc1.tick();
      assert.strictEqual(askTick.tick, "ok", "ask tick ok, got " + JSON.stringify(askTick));
      assert.deepStrictEqual(askTick.items, 1, "ask tick saw the photo");
      let items = await shares();
      const photoId = items[0].id;
      assert.strictEqual(items[0].media_available, true, "ask turn retains the media");

      // "yes" adds both pieces under the photo's share id and acks the media.
      await botJson("POST", "/mock/incoming-text", { text: "yes" });
      const yesTick = await svc1.tick();
      assert.strictEqual(yesTick.tick, "ok", "yes tick ok, got " + JSON.stringify(yesTick));
      const pieces = await botJson("GET", "/ig/catalog/" + DEMO_REF);
      assert.strictEqual(pieces.body.length, 2, "yes added two pieces, got " + JSON.stringify(pieces.body));
      assert.ok(pieces.body.every(function (p) { return p.source_share_id === photoId; }),
        "pieces carry the photo's per-region share id");
      items = await shares();
      assert.strictEqual(items.filter(function (s) { return s.id === photoId; })[0].media_available,
        false, "yes-add acknowledged (deleted) the retained media");
      assert.strictEqual((await outbound()).length, 2, "ask + yes reply sent");

      // Simulated restart with NO cursor file: the whole history replays.
      detectCalls = 0;
      mediaGets = 0;
      const svc2 = freshService();
      const replay = await svc2.tick();
      assert.strictEqual(replay.tick, "ok", "replay tick ok, got " + JSON.stringify(replay));
      assert.strictEqual(replay.items, 2, "full history replayed without a cursor");
      assert.ok(replay.outcomes[0].indexOf("terminal:duplicate") === 0,
        "photo terminal-duplicate on the first pass, got " + JSON.stringify(replay.outcomes));
      assert.ok(replay.outcomes.every(function (o) { return o.indexOf("terminal:") === 0 && o !== "retry"; }),
        "no retries anywhere, got " + JSON.stringify(replay.outcomes));
      const act = svc2.status().activity;
      assert.ok(act.some(function (l) { return /already answered earlier/.test(l); }),
        "honest already-answered line, activity=" + JSON.stringify(act));
      assert.ok(!act.some(function (l) { return /isn't ready yet/.test(l); }),
        "no futile not-ready retry line, activity=" + JSON.stringify(act));
      assert.strictEqual(detectCalls, 0, "the answered photo was never re-detected");
      assert.strictEqual(mediaGets, 0, "the collected media was never re-fetched");
      assert.strictEqual((await outbound()).length, 2, "no second send on replay");
      assert.strictEqual(svc2.status().counts.gave_up, 0, "never gave up");
      assert.strictEqual(svc2.status().counts.errors, 0, "no error retries");
      assert.strictEqual((await botJson("GET", "/ig/catalog/" + DEMO_REF)).body.length, 2,
        "no duplicate pieces catalogued");
      assertNoLeak(act, "replay activity");
      console.log("  pass: photo terminal-duplicate first pass, no retry, no resend, no refetch");
    } finally {
      global.fetch = realFetch;
      await new Promise(function (resolve) { botServer.close(resolve); });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // --- B + C. Unit-style: stubbed fetch, no bot process ---
  console.log("\n[bare-mid vs per-attachment provenance, gone-media backstop]");
  {
    const realFetch = global.fetch;
    const sent = [];
    // Per-case knobs: which piece ids the catalog holds, and what the
    // media probe returns (404 gone / 200 present).
    let seedPieces = [];
    let mediaStatus = 404;

    global.fetch = function (url, opts) {
      const u = String(url);
      if (u.indexOf("/ig/catalog") !== -1) {
        return Promise.resolve({
          ok: true, status: 200,
          json: function () { return Promise.resolve(seedPieces); },
          text: function () { return Promise.resolve(JSON.stringify(seedPieces)); },
        });
      }
      if (u.indexOf("/ig/media/") !== -1) {
        return Promise.resolve({
          ok: mediaStatus !== 404, status: mediaStatus,
          headers: { get: function () { return "image/jpeg"; } },
          arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(8)); },
        });
      }
      if (u.indexOf("/ig/send") !== -1) {
        const body = opts && opts.body ? JSON.parse(String(opts.body)) : {};
        sent.push(body);
        return Promise.resolve({
          ok: true, status: 200,
          json: function () { return Promise.resolve({ message_id: "SYNTH_msg_stub" }); },
          text: function () { return Promise.resolve("{\"message_id\":\"SYNTH_msg_stub\"}"); },
        });
      }
      if (u.indexOf("/mock/stage-outbound-image/") !== -1 || u.indexOf("/ig/outbound-stage/") !== -1) {
        return Promise.resolve({
          ok: true, status: 200,
          json: function () { return Promise.resolve({}); },
          text: function () { return Promise.resolve("{}"); },
        });
      }
      if (u.indexOf(PROXY_BASE) !== -1 || u.indexOf("/api/") !== -1) {
        return Promise.reject(new Error("proxy unreachable (stub)"));
      }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
    };

    function piece(src) {
      return {
        piece_id: "SYNTH_piece_" + src.length, category: "dress", attributes: {},
        source_share_id: src, added_at: new Date().toISOString(),
        copy_preview_keys: { copy: null, preview: null }, status: "active",
      };
    }
    function photoItem(id, mediaId) {
      return {
        id: id,
        received_at: new Date().toISOString(),
        attachment: { type: "image", payload: { url: "mock-local:image" } },
        media_id: mediaId,
        media_available: false,
      };
    }
    function freshUnitService() {
      delete require.cache[require.resolve("../server.js")];
      const Service = require("../server.js");
      return Service.createService({
        botBase: "http://127.0.0.1:59997", proxyBase: PROXY_BASE,
        readToken: TOKEN, catalogToken: TOKEN, sendToken: TOKEN,
        port: 0, nowMs: function () { return Date.now(); },
        cursorFile: null,
      });
    }

    try {
      // Full per-attachment piece id, replay surfacing the bare mid.
      seedPieces = [piece("SYNTH_mid_live:SYNTH_media_9")];
      mediaStatus = 404;
      sent.length = 0;
      let svc = freshUnitService();
      let out = await svc.processOne(photoItem("SYNTH_mid_live", "SYNTH_media_9"));
      assert.ok(out.indexOf("terminal:duplicate") === 0, "bare-mid replay of full-id piece is duplicate, got " + out);
      assert.strictEqual(sent.length, 0, "no send on bare-mid match");

      // Bare-mid piece id, replay surfacing the full per-attachment id.
      seedPieces = [piece("SYNTH_mid_live")];
      svc = freshUnitService();
      out = await svc.processOne(photoItem("SYNTH_mid_live:SYNTH_media_9", "SYNTH_media_9"));
      assert.ok(out.indexOf("terminal:duplicate") === 0, "full-id replay of bare-mid piece is duplicate, got " + out);
      assert.strictEqual(sent.length, 0, "no send on full-id match");

      // Exact match still works.
      seedPieces = [piece("SYNTH_mid_live:SYNTH_media_9")];
      svc = freshUnitService();
      out = await svc.processOne(photoItem("SYNTH_mid_live:SYNTH_media_9", "SYNTH_media_9"));
      assert.ok(out.indexOf("terminal:duplicate") === 0, "exact match is duplicate, got " + out);

      // Distinct sibling attachments never conflate: same mid, different
      // media, media confirmed gone -> media_gone, not duplicate.
      seedPieces = [piece("SYNTH_mid_live:SYNTH_media_9")];
      svc = freshUnitService();
      out = await svc.processOne(photoItem("SYNTH_mid_live:SYNTH_media_8", "SYNTH_media_8"));
      assert.ok(out.indexOf("terminal:media_gone") === 0,
        "distinct sibling with gone media is media_gone, got " + out);
      assert.strictEqual(sent.length, 0, "no send on media_gone");
      assert.ok(svc.status().activity.some(function (l) { return /gone and I couldn't find its pieces/.test(l); }),
        "honest media-gone line");

      // Confirmed-gone media with no match at all -> terminal at once.
      seedPieces = [piece("SYNTH_share_other")];
      svc = freshUnitService();
      const before = svc.status().counts;
      out = await svc.processOne(photoItem("SYNTH_mid_gone", "SYNTH_media_gone"));
      assert.ok(out.indexOf("terminal:media_gone") === 0, "gone media terminal at once, got " + out);
      assert.strictEqual(sent.length, 0, "no send for gone media");
      assert.strictEqual(svc.status().counts.gave_up, before.gave_up, "no give-up for gone media");
      assert.strictEqual(svc.status().counts.errors, before.errors, "no error retries for gone media");

      // Non-404 probe (bytes present / flag lag / transient error) keeps
      // the retry for genuinely not-yet-downloaded media.
      mediaStatus = 200;
      seedPieces = [piece("SYNTH_share_other")];
      svc = freshUnitService();
      out = await svc.processOne(photoItem("SYNTH_mid_pending", "SYNTH_media_pending"));
      assert.strictEqual(out, "retry", "non-404 probe keeps the retry, got " + out);
      assert.strictEqual(sent.length, 0, "no send on retry");
      console.log("  pass: provenance bridged both ways, siblings distinct, gone terminal, pending retries");
    } finally {
      global.fetch = realFetch;
    }
  }

  console.log("\nAll already-answered multi-detect tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
