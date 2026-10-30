"use strict";
/* meta-styles — restart duplicate-send + image-delivery regression test.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves, with synthetic fixtures only and a REAL mock bot (genuine
 * duplicate_send / idempotency_key_reused semantics, not stubs):
 *
 *  Bug 1 — exactly one real send per share across restarts even though
 *  Spark is nondeterministic: the first attempt sends text A; a simulated
 *  restart (fresh service state, same share still present) recomposes a
 *  DIFFERENT text B; the second attempt must still not create a second
 *  outbound message. The mechanism under test is the stable per-share
 *  idempotency key: both attempts carry wardrobe-send-v1:<share_id>, so
 *  the bot replays-or-409s instead of sending twice. No new local
 *  store is involved — the key is derived, and the catalog PUT/GET
 *  contract is untouched (pieces only, as before).
 *
 *  Bug 2 — mock mode delivers the preview image end-to-end: the staged
 *  send carries image:true, the bot confirms an image_message_id, and the
 *  reply omits the "can't tuck pictures" caveat. Live mode now mirrors
 *  the same stage-then-send flow against the real bot's
 *  POST /ig/outbound-stage route (mocked-contract stubs below, never the
 *  real bot): staged + image_message_id on success; honest text-only
 *  fallback with caveat when staging itself fails; retry with a distinct
 *  activity line when staging succeeds but the bot's Graph step refuses
 *  (502/503) — never a false delivery claim.
 *
 *  Guard — two different share_ids are still replied to independently
 *  (no over-suppression from the dedupe).
 *
 *  All ids are SYNTH_-prefixed; the preview bytes are a 1x1 PNG.
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
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function seedPieces() {
  const now = new Date().toISOString();
  return [
    {
      piece_id: "SYNTH_piece_901", category: "dress", attributes: {},
      source_share_id: "SYNTH_share_seed_901", added_at: now,
      copy_preview_keys: { copy: null, preview: null }, status: "active",
    },
    {
      piece_id: "SYNTH_piece_902", category: "scarf", attributes: {},
      source_share_id: "SYNTH_share_seed_902", added_at: now,
      copy_preview_keys: { copy: null, preview: null }, status: "active",
    },
    {
      piece_id: "SYNTH_piece_903", category: "bag", attributes: {},
      source_share_id: "SYNTH_share_seed_903", added_at: now,
      copy_preview_keys: { copy: null, preview: null }, status: "active",
    },
  ];
}

async function run() {
  console.log("restart-dedupe-image.test.js");

  const realFetch = global.fetch;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-styles-restart-"));
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

  try {
    // Seed the demo wardrobe through the EXISTING catalog PUT contract.
    const put = await botJson("PUT", "/ig/catalog/" + DEMO_REF, seedPieces());
    assert.ok(put.status === 200 || put.status === 204, "catalog seed PUT, got " + put.status);

    // Two genuine inbox shares (as the operator route would create them).
    await botJson("POST", "/mock/incoming-text", { text: "show me a look" });
    await botJson("POST", "/mock/incoming-text", { text: "show me a look" });
    const items = await shares();
    assert.strictEqual(items.length, 2, "two shares present");
    const share1 = items[0];
    const share2 = items[1];
    assert.ok(share1.id !== share2.id, "distinct share ids");

    // Proxy stub: /api/assemble returns a DIFFERENT rationale on every
    // call (simulating Spark nondeterminism across restarts); /api/preview
    // returns a valid dataURL; everything else rejects (router + classify
    // fall back to their local heuristics, assemble/preview go "live").
    let assembleCalls = 0;
    const sendBodies = [];
    global.fetch = function (url, opts) {
      const u = String(url);
      if (u.indexOf(PROXY_BASE) === 0) {
        if (u.indexOf("/api/assemble") !== -1) {
          assembleCalls += 1;
          const n = assembleCalls;
          const pieces = (opts && opts.body && JSON.parse(String(opts.body)).pieces) || [];
          const ids = pieces.map(function (p) { return p.id; });
          return Promise.resolve({
            ok: true, status: 200,
            json: function () {
              return Promise.resolve({
                looks: [{ pieceIds: ids, rationale: "Moonlight draft number " + n + " drapes long." }],
              });
            },
            text: function () { return Promise.resolve("{}"); },
          });
        }
        if (u.indexOf("/api/preview") !== -1) {
          return Promise.resolve({
            ok: true, status: 200,
            json: function () {
              return Promise.resolve({ dataURL: "data:image/png;base64," + TINY_PNG_B64 });
            },
            text: function () { return Promise.resolve("{}"); },
          });
        }
        return Promise.reject(new Error("proxy unreachable (stub)"));
      }
      if (u.indexOf("/ig/send") !== -1 && opts && opts.body) {
        try { sendBodies.push(JSON.parse(String(opts.body))); } catch (e) { /* record nothing */ }
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

    // --- Attempt 1 (pre-restart): sends text A with the staged image ---
    console.log("\n[attempt 1 sends with image]");
    const svc1 = freshService();
    const out1 = await svc1.processOne(share1);
    assert.ok(typeof out1 === "string" && out1.indexOf("terminal:") === 0,
      "attempt 1 terminal, got " + out1);
    let log = await outbound();
    assert.strictEqual(log.length, 1, "exactly one outbound send, got " + log.length);
    assert.ok(log[0].image_message_id, "bot confirmed an image_message_id");
    assert.strictEqual(sendBodies.length, 1, "one send call");
    assert.strictEqual(sendBodies[0].image, true, "send carried image:true");
    assert.strictEqual(sendBodies[0].idempotency_key, "wardrobe-send-v1:" + share1.id,
      "stable per-share key, got " + sendBodies[0].idempotency_key);
    assert.ok(!/tuck pictures|tuck preview pictures/.test(sendBodies[0].text),
      "no can't-send-pictures caveat when the image went out");
    assert.ok(!/SYNTH_/.test(sendBodies[0].text), "no ids in reply");
    assert.strictEqual(svc1.status().counts.images_delivered, 1, "image counted on bot proof");
    assert.strictEqual(svc1.status().image_delivery.preview_delivery, "staged",
      "status reports staged after a confirmed image send");
    const textA = sendBodies[0].text;

    // --- Simulated restart: fresh in-memory state, same share present ---
    console.log("\n[restart: same share recomposed with different wording]");
    const svc2 = freshService();
    const out2 = await svc2.processOne(share1);
    assert.ok(typeof out2 === "string" && out2.indexOf("terminal:") === 0,
      "attempt 2 terminal, got " + out2);
    assert.strictEqual(sendBodies.length, 2, "second attempt reached the bot");
    assert.strictEqual(sendBodies[1].idempotency_key, "wardrobe-send-v1:" + share1.id,
      "restart reuses the SAME idempotency key, got " + sendBodies[1].idempotency_key);
    const textB = sendBodies[1].text;
    assert.ok(textB !== textA, "Spark wording really did change across the restart");
    log = await outbound();
    assert.strictEqual(log.length, 1, "STILL exactly one outbound send after restart, got " + log.length);
    assert.strictEqual(svc2.status().counts.sent, 0, "no second send counted");
    assert.strictEqual(svc2.status().counts.duplicates, 1, "restart replay counted as duplicate");

    // --- A different share is still replied to independently ---
    console.log("\n[second share sends independently]");
    const out3 = await svc2.processOne(share2);
    assert.ok(typeof out3 === "string" && out3.indexOf("terminal:") === 0,
      "share2 terminal, got " + out3);
    log = await outbound();
    assert.strictEqual(log.length, 2, "second share sent, outbound=" + log.length);
    assert.strictEqual(sendBodies.length, 3, "third send call");
    assert.strictEqual(sendBodies[2].idempotency_key, "wardrobe-send-v1:" + share2.id,
      "different share -> different key, got " + sendBodies[2].idempotency_key);
    assert.ok(log[1].image_message_id, "second share also delivered its image");

    // --- Reprocessing the first share again still sends nothing new ---
    console.log("\n[reprocess share1 again: still no new send]");
    const out4 = await svc2.processOne(share1);
    assert.ok(typeof out4 === "string" && out4.indexOf("terminal:") === 0,
      "share1 reprocess terminal, got " + out4);
    log = await outbound();
    assert.strictEqual(log.length, 2, "outbound still 2, got " + log.length);

    console.log("  pass: one send per share across restart; images delivered; no over-suppression");
  } finally {
    global.fetch = realFetch;
    await new Promise(function (resolve) { botServer.close(resolve); });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // --- Live mode mirrors the mock stage-then-send flow via the real
  // bot's POST /ig/outbound-stage route — all three outcomes below run
  // against fetch stubs implementing the documented contract shapes, never
  // the real bot (no 8903/8905 traffic from this suite).
  console.log("\n[live mode: stage-then-send, honest on every outcome]");
  {
    const seed = seedPieces();
    const realFetch2 = global.fetch;
    const liveCfg = { stageUnreachable: false, graphFail: false };
    const liveSend = [];
    const liveStaged = new Set();
    global.fetch = function (url, opts) {
      const u = String(url);
      if (u.indexOf("/ig/outbound-stage/") !== -1) {
        if (liveCfg.stageUnreachable) {
          return Promise.reject(new Error("unreachable (live stub)"));
        }
        const sid = decodeURIComponent(u.split("/ig/outbound-stage/")[1].split("?")[0]);
        liveStaged.add(sid);
        const stageBody = { share_id: sid, bytes: 68 };
        return Promise.resolve({
          ok: true, status: 200,
          json: function () { return Promise.resolve(stageBody); },
          text: function () { return Promise.resolve(JSON.stringify(stageBody)); },
        });
      }
      if (u.indexOf("/api/assemble") !== -1) {
        const pieces = (opts && opts.body && JSON.parse(String(opts.body)).pieces) || [];
        const ids = pieces.map(function (p) { return p.id; });
        return Promise.resolve({
          ok: true, status: 200,
          json: function () {
            return Promise.resolve({
              looks: [{ pieceIds: ids, rationale: "Moonlight live draft drapes long." }],
            });
          },
          text: function () { return Promise.resolve("{}"); },
        });
      }
      if (u.indexOf("/api/preview") !== -1) {
        return Promise.resolve({
          ok: true, status: 200,
          json: function () {
            return Promise.resolve({ dataURL: "data:image/png;base64," + TINY_PNG_B64 });
          },
          text: function () { return Promise.resolve("{}"); },
        });
      }
      if (u.indexOf("/ig/send") !== -1) {
        const body = opts && opts.body ? JSON.parse(String(opts.body)) : {};
        liveSend.push(body);
        if (body.image === true && !liveStaged.has(body.share_id)) {
          return Promise.resolve({
            ok: true, status: 400,
            json: function () { return Promise.resolve({ error: "image_not_staged" }); },
            text: function () { return Promise.resolve("{}"); },
          });
        }
        if (body.image === true && liveCfg.graphFail) {
          const split = {
            error: "image_send_failed", message_id: "SYNTH_mid_live_split",
            recipient_ref: body.share_id,
          };
          return Promise.resolve({
            ok: true, status: 502,
            json: function () { return Promise.resolve(split); },
            text: function () { return Promise.resolve(JSON.stringify(split)); },
          });
        }
        const sendBody = { message_id: "SYNTH_mid_live_" + liveSend.length, recipient_ref: body.share_id };
        if (body.image === true) sendBody.image_message_id = "SYNTH_imgmsg_live_" + liveSend.length;
        return Promise.resolve({
          ok: true, status: 200,
          json: function () { return Promise.resolve(sendBody); },
          text: function () { return Promise.resolve(JSON.stringify(sendBody)); },
        });
      }
      if (u.indexOf("/ig/catalog") !== -1) {
        return Promise.resolve({
          ok: true, status: 200,
          text: function () { return Promise.resolve(JSON.stringify(seed)); },
          json: function () { return Promise.resolve(seed); },
        });
      }
      return Promise.reject(new Error("unreachable (live stub)"));
    };
    function liveService() {
      delete require.cache[require.resolve("../server.js")];
      const ServiceLive = require("../server.js");
      return ServiceLive.createService({
        mode: "live", botBase: "http://127.0.0.1:59997", proxyBase: "http://127.0.0.1:59998",
        readToken: TOKEN, catalogToken: TOKEN, sendToken: TOKEN,
        port: 0, nowMs: function () { return Date.now(); },
      });
    }
    function liveItem(id) {
      return {
        id: id, received_at: new Date().toISOString(),
        user_ref: "u_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        attachment: { type: "text", payload: { text: "show me a look" } },
      };
    }
    try {
      // Case A: staged + Graph ok -> image:true, no caveat, counted.
      liveCfg.stageUnreachable = false;
      liveCfg.graphFail = false;
      const svcA = liveService();
      assert.strictEqual(svcA.status().image_delivery.sends, "text+image",
        "live status declares staged image sends");
      const outA = await svcA.processOne(liveItem("SYNTH_share_live_001"));
      assert.ok(typeof outA === "string" && outA.indexOf("terminal:") === 0,
        "live staged processOne terminal, got " + outA);
      assert.strictEqual(liveSend.length, 1, "one live send attempted");
      assert.strictEqual(liveSend[0].image, true, "live send carries image:true");
      assert.ok(!/tuck preview pictures/.test(liveSend[0].text),
        "no can't-send-pictures caveat when the image went out");
      assert.strictEqual(svcA.status().counts.images_delivered, 1,
        "live image counted only on the bot's image_message_id");
      assert.strictEqual(svcA.status().image_delivery.preview_delivery, "staged",
        "live status reports staged after a confirmed image send");
      console.log("  pass: live staged image send end-to-end");

      // Case B: staging itself fails -> honest text-only fallback + caveat.
      liveCfg.stageUnreachable = true;
      liveCfg.graphFail = false;
      liveSend.length = 0;
      const svcB = liveService();
      const outB = await svcB.processOne(liveItem("SYNTH_share_live_002"));
      assert.ok(typeof outB === "string" && outB.indexOf("terminal:") === 0,
        "live fallback processOne terminal, got " + outB);
      assert.strictEqual(liveSend.length, 1, "one live send attempted");
      assert.strictEqual(liveSend[0].image, false, "staging failure falls back to image:false");
      assert.ok(/can\u2019t tuck preview pictures/.test(liveSend[0].text),
        "fallback reply keeps the honest caveat");
      assert.strictEqual(svcB.status().counts.images_delivered, 0, "nothing counted as delivered");
      assert.strictEqual(svcB.status().image_delivery.preview_delivery, "not-staged",
        "status stays not-staged when staging failed");
      console.log("  pass: live staging failure falls back to honest text-only");

      // Case C: staged but the Graph step refuses -> retry, distinct line,
      // never claimed delivered.
      liveCfg.stageUnreachable = false;
      liveCfg.graphFail = true;
      liveSend.length = 0;
      const svcC = liveService();
      const outC = await svcC.processOne(liveItem("SYNTH_share_live_003"));
      assert.strictEqual(outC, "retry", "Graph refusal retries, got " + outC);
      assert.strictEqual(liveSend.length, 1, "one live send attempted");
      assert.strictEqual(liveSend[0].image, true, "retry keeps image:true (staging worked)");
      assert.strictEqual(svcC.status().counts.images_delivered, 0,
        "a 502 without image_message_id is never counted as delivered");
      assert.strictEqual(svcC.status().image_delivery.preview_delivery, "not-staged",
        "status stays not-staged without bot confirmation");
      assert.ok(svcC.status().activity.some(function (line) {
        return /photo service didn't accept it/.test(line);
      }), "distinct staged-but-Graph-failed activity line, got " +
        JSON.stringify(svcC.status().activity));
      console.log("  pass: live staged-but-Graph-failed retries with its own honest line");
    } finally {
      global.fetch = realFetch2;
    }
    console.log("  pass: live mode stage-then-send with honest reporting on every outcome");
  }

  console.log("\nAll restart-dedupe + image-delivery tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
