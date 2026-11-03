"use strict";
/* meta-styles — first-tick-after-restart combined-ask regression (2026-11-03).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * LIVE BUG (2026-11-03): right after a wardrobe-service restart, the user's
 * FIRST message — a photo with 2 garments — ran the agentic turn (trace
 * catalogue_piece guard:pass, detect:2-usable, regions:2, ask:recorded,
 * return:ask; outcome terminal pending_ask) but NO combined ask was ever
 * sent (counts processed 1, sent 0, no activity line, no error). Root cause
 * in wardrobe-service/server.js: the tick loop initialised its per-tick
 * flags (_tickLastShare, _tickHadAnyDetect, _tickHadMulti, _tickPendingBags)
 * only for users that exist at tick start, so a user ctx created mid-tick
 * (first message after restart) never got them; processAgenticShare then
 * skipped recording the last share, and the post-processing branch hit
 * "no last share recorded" and returned silently while the share was
 * already terminal (never retried).
 *
 * Proves, with synthetic fixtures only and a REAL mock bot (genuine
 * shares/send/outbound semantics, not stubs), that a FRESH service whose
 * very first polled share(s) carry detections sends exactly one combined
 * ask (or the single-region auto-add reply) on that same first tick:
 *
 *  Case 1 — first share is a 2-region photo -> exactly one combined ask
 *  ("Found 2 pieces ... Shall I add all of them?"), sent 1, errors 0.
 *  Case 2 — first share is a 1-region photo -> exactly one auto-add reply
 *  ("tucked safely"), one piece catalogued, no pending ask left behind.
 *  Case 3 — first tick carries a mixed batch (1-region + 2-region photos,
 *  still no pre-existing user ctx) -> exactly one combined ask covering
 *  all 3 regions, sent under the LAST share's stable idempotency key.
 *
 * All ids are SYNTH_-prefixed; photo bytes are a 1x1 PNG. No real network
 * traffic: the mock bot runs on loopback and only the configured
 * PROXY_BASE stub answers (/api/detect); every other proxy call rejects.
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

// Distinct valid rects ([x, y, w, h]) so regions hash distinctly.
const BOXES = [
  [0.05, 0.05, 0.25, 0.25],
  [0.05, 0.45, 0.25, 0.25],
  [0.40, 0.10, 0.25, 0.30],
  [0.65, 0.55, 0.20, 0.20],
  [0.40, 0.55, 0.20, 0.20],
  [0.65, 0.10, 0.20, 0.25],
];
const CATS = ["base/top", "base/bottom", "dress", "bag", "scarf", "layer/blazer"];

function detectPayload(specs) {
  return {
    pieces: specs.map(function (spec) {
      return { category: CATS[spec[0]], bbox: BOXES[spec[1]] };
    }),
  };
}

async function run() {
  console.log("first-tick-combined-ask.test.js");

  const realFetch = global.fetch;

  async function withStack(photoCount, detectQueue, fn) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-styles-first-tick-"));
    const started = await MockBot.startServer({
      port: 0, token: TOKEN, catalogDir: tmpDir, catalogSecret: "SYNTH_test_catalog_secret",
    });
    const botServer = started.server;
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
    try {
      const put = await botJson("PUT", "/ig/catalog/" + DEMO_REF, []);
      assert.ok(put.status === 200 || put.status === 204, "catalog seed PUT, got " + put.status);
      for (let i = 0; i < photoCount; i += 1) {
        const inc = await botJson("POST", "/mock/incoming-photo", { caption: "SYNTH first-tick photo " + (i + 1) });
        assert.strictEqual(inc.status, 200, "incoming-photo accepted");
      }
      const sharesRes = await realFetch(botBase + "/ig/shares?limit=50", {
        headers: { Authorization: "Bearer " + TOKEN },
      });
      assert.strictEqual(sharesRes.status, 200, "shares readable");
      const items = (await sharesRes.json()).items;
      assert.strictEqual(items.length, photoCount, "seeded shares present, got " + items.length);

      const sendBodies = [];
      global.fetch = function (url, opts) {
        const u = String(url);
        if (u.indexOf(PROXY_BASE) === 0) {
          if (u.indexOf("/api/detect") !== -1) {
            const payload = detectQueue.length ? detectQueue.shift() : detectPayload([[0, 0]]);
            return Promise.resolve({
              ok: true, status: 200,
              json: function () { return Promise.resolve(payload); },
              text: function () { return Promise.resolve(JSON.stringify(payload)); },
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
      // FRESH service = simulated restart: no user ctx exists yet, so the
      // tick-start flag init sees zero users — the mid-tick ctx path must
      // still record the share and send the ask on this same tick.
      const svc = Service.createService({
        botBase: botBase, proxyBase: PROXY_BASE,
        readToken: TOKEN, catalogToken: TOKEN, sendToken: TOKEN,
        port: 0, nowMs: function () { return Date.now(); },
      });
      assert.strictEqual(svc.getUserContext(DEMO_REF), null, "no user ctx before first tick (restart state)");

      const tickRes = await svc.tick();
      assert.strictEqual(tickRes.tick, "ok", "tick ok, got " + JSON.stringify(tickRes));
      assert.strictEqual(tickRes.items, photoCount, "tick saw all shares, got " + tickRes.items);

      await fn({ svc: svc, items: items, sendBodies: sendBodies, botJson: botJson });
    } finally {
      global.fetch = realFetch;
      await new Promise(function (resolve) { botServer.close(resolve); });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  async function outboundOf(botJson) {
    const res = await botJson("GET", "/mock/outbound");
    assert.strictEqual(res.status, 200, "outbound readable");
    return res.body.outbound;
  }

  // --- Case 1: first share ever is a 2-region photo -> one combined ask ---
  console.log("\n[first tick: 2-region photo -> exactly one combined ask]");
  await withStack(1, [detectPayload([[0, 0], [1, 1]])], async function (ctx) {
    const st = ctx.svc.status();
    assert.strictEqual(ctx.sendBodies.length, 1,
      "exactly one send on the first tick, got " + ctx.sendBodies.length);
    const body = ctx.sendBodies[0];
    assert.ok(/Found 2 pieces/.test(body.text), "combined ask names 2 pieces, got " + body.text);
    assert.ok(/Shall I add all of them\?/.test(body.text), "combined ask asks to add, got " + body.text);
    assert.ok(!/SYNTH_/.test(body.text), "no ids leak into the ask");
    assert.strictEqual(body.idempotency_key, "wardrobe-send-v1:" + ctx.items[0].id,
      "stable per-share key on the first share, got " + body.idempotency_key);
    const log = await outboundOf(ctx.botJson);
    assert.strictEqual(log.length, 1, "exactly one outbound message, got " + log.length);
    assert.strictEqual(st.counts.sent, 1, "sent counted once, got " + st.counts.sent);
    assert.strictEqual(st.counts.errors, 0, "no errors, got " + st.counts.errors);
    assert.ok(st.activity.some(function (line) {
      return /Your photo stays with me until its pieces land/.test(line);
    }), "retained-media activity line present, got " + JSON.stringify(st.activity));
    const userCtx = ctx.svc.getUserContext(DEMO_REF);
    assert.ok(userCtx && userCtx.detectBag && userCtx.detectBag.regions.length === 2,
      "pending bag holds 2 regions awaiting yes");
    console.log("  pass: first-tick 2-region photo sends one combined ask");
  });

  // --- Case 2: first share ever is a 1-region photo -> one auto-add reply ---
  console.log("\n[first tick: 1-region photo -> exactly one auto-add reply]");
  await withStack(1, [detectPayload([[2, 2]])], async function (ctx) {
    const st = ctx.svc.status();
    assert.strictEqual(ctx.sendBodies.length, 1,
      "exactly one send on the first tick, got " + ctx.sendBodies.length);
    const body = ctx.sendBodies[0];
    assert.ok(/tucked safely/.test(body.text), "auto-add reply sent, got " + body.text);
    assert.ok(!/SYNTH_/.test(body.text), "no ids leak into the reply");
    assert.strictEqual(body.idempotency_key, "wardrobe-send-v1:" + ctx.items[0].id,
      "stable per-share key on the first share, got " + body.idempotency_key);
    const log = await outboundOf(ctx.botJson);
    assert.strictEqual(log.length, 1, "exactly one outbound message, got " + log.length);
    assert.strictEqual(st.counts.sent, 1, "sent counted once, got " + st.counts.sent);
    assert.strictEqual(st.counts.errors, 0, "no errors, got " + st.counts.errors);
    const catRes = await ctx.botJson("GET", "/ig/catalog/" + DEMO_REF);
    assert.strictEqual(catRes.status, 200, "catalog readable");
    assert.strictEqual(catRes.body.length, 1, "one piece catalogued, got " + catRes.body.length);
    const userCtx = ctx.svc.getUserContext(DEMO_REF);
    assert.ok(!userCtx.detectBag, "no pending bag left after auto-add");
    console.log("  pass: first-tick 1-region photo auto-adds with one reply");
  });

  // --- Case 3: first tick carries a mixed batch, still no pre-existing ctx ---
  console.log("\n[first tick: 1-region + 2-region batch -> one combined ask for all 3]");
  await withStack(2, [detectPayload([[0, 0]]), detectPayload([[2, 2], [3, 3]])], async function (ctx) {
    const st = ctx.svc.status();
    assert.strictEqual(ctx.sendBodies.length, 1,
      "mixed batch sends exactly one ask, got " + ctx.sendBodies.length);
    const body = ctx.sendBodies[0];
    assert.ok(/Found 3 pieces/.test(body.text), "ask covers all 3 regions, got " + body.text);
    assert.ok(/across those photos/.test(body.text), "multi-photo ask wording, got " + body.text);
    assert.ok(/Shall I add all of them\?/.test(body.text), "ask asks to add, got " + body.text);
    assert.strictEqual(body.idempotency_key, "wardrobe-send-v1:" + ctx.items[ctx.items.length - 1].id,
      "ask sent under the LAST share's key, got " + body.idempotency_key);
    const log = await outboundOf(ctx.botJson);
    assert.strictEqual(log.length, 1, "exactly one outbound message, got " + log.length);
    assert.strictEqual(st.counts.sent, 1, "sent counted once, got " + st.counts.sent);
    assert.strictEqual(st.counts.errors, 0, "no errors, got " + st.counts.errors);
    console.log("  pass: first-tick mixed batch sends one combined ask");
  });

  console.log("\nAll first-tick combined-ask tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
