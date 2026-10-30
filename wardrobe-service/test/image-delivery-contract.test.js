"use strict";
/* meta-styles — image-delivery contract regression test.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Guards the result contract between look skills and wardrobe-service:
 * the service sends withImage:true only when
 * handlerResult.meta.imageDelivery.delivered === true. revise_look,
 * Match_look and Complete_the_look previously returned imageDelivery at
 * the TOP LEVEL of their result (no `meta`), so the gate never fired:
 * a Muse Image preview was paid for and staged, then silently dropped,
 * and the handler's own honest caveat (written for the failure path)
 * never appeared either — the user got a plain text reply with no
 * image and no explanation.
 *
 * Each case runs end-to-end through the service (processOne + a REAL
 * mock bot, genuine stage/send semantics): when the handler reports
 * delivered:true, the outbound log must show an image send; when
 * delivery fails, the reply must stay text-only AND keep its caveat.
 * Handler-only assertions cannot catch this — the M22 tests passed
 * while the service dropped every image.
 *
 * All ids are SYNTH_-prefixed; the preview bytes are a 1x1 PNG.
 * No real network: the proxy is a fetch stub, the bot is local.
 */
const assert = require("assert");
// Loopback fetch must bypass the sandbox proxy (same pattern as
// restart-dedupe-image.test.js) — otherwise the real mock bot below is
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
const APOS = "can’t tuck preview pictures";

function seedPieces() {
  const now = new Date().toISOString();
  return [
    {
      piece_id: "SYNTH_piece_701", category: "dress", attributes: {},
      source_share_id: "SYNTH_share_seed_701", added_at: now,
      copy_preview_keys: { copy: null, preview: null }, status: "active",
    },
    {
      piece_id: "SYNTH_piece_702", category: "scarf", attributes: {},
      source_share_id: "SYNTH_share_seed_702", added_at: now,
      copy_preview_keys: { copy: null, preview: null }, status: "active",
    },
    {
      piece_id: "SYNTH_piece_703", category: "bag", attributes: {},
      source_share_id: "SYNTH_share_seed_703", added_at: now,
      copy_preview_keys: { copy: null, preview: null }, status: "active",
    },
  ];
}

async function run() {
  console.log("image-delivery-contract.test.js");

  const realFetch = global.fetch;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-styles-imgcontract-"));
  const { server: botServer } = await MockBot.startServer({
    port: 0, token: TOKEN, catalogDir: tmpDir, catalogSecret: "SYNTH_test_catalog_secret",
  });
  const botBase = "http://127.0.0.1:" + botServer.address().port;

  // Preview stub flag: when false, /api/preview rejects and every skill
  // must fall back to honest text-only (fail-closed path).
  const proxyCfg = { previewOk: true };
  const sendBodies = [];
  global.fetch = function (url, opts) {
    const u = String(url);
    if (u.indexOf(PROXY_BASE) === 0) {
      if (u.indexOf("/api/preview") !== -1 && proxyCfg.previewOk) {
        return Promise.resolve({
          ok: true, status: 200,
          json: function () {
            return Promise.resolve({ dataURL: "data:image/png;base64," + TINY_PNG_B64 });
          },
          text: function () { return Promise.resolve("{}"); },
        });
      }
      // Router + classify + (on failure) preview all fall back to
      // their local heuristics — genuine offline behavior, no network.
      return Promise.reject(new Error("proxy unreachable (stub)"));
    }
    if (u.indexOf("/ig/send") !== -1 && opts && opts.body) {
      try { sendBodies.push(JSON.parse(String(opts.body))); } catch (e) { /* record nothing */ }
    }
    return realFetch(url, opts);
  };

  async function botJson(method, urlPath, body, rawBody, contentType) {
    const headers = { Authorization: "Bearer " + TOKEN };
    let payload;
    if (rawBody !== undefined) {
      headers["Content-Type"] = contentType || "image/png";
      payload = rawBody;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await realFetch(botBase + urlPath, { method: method, headers: headers, body: payload });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = null; }
    return { status: res.status, body: parsed };
  }

  async function shares() {
    const res = await realFetch(botBase + "/ig/shares?limit=50", {
      headers: { Authorization: "Bearer " + TOKEN },
    });
    assert.strictEqual(res.status, 200, "shares readable");
    return (await res.json()).items;
  }

  async function outbound() {
    const res = await botJson("GET", "/mock/outbound");
    assert.strictEqual(res.status, 200, "outbound readable");
    return res.body.outbound;
  }

  function freshService() {
    // Fresh preview cache per case: app/meta-client.js memoises previews
    // by prompt, so without this the fail-closed case would inherit the
    // earlier success case's cached dataURL instead of exercising a
    // genuine preview failure.
    delete require.cache[require.resolve("../../app/meta-client.js")];
    delete require.cache[require.resolve("../server.js")];
    const Service = require("../server.js");
    return Service.createService({
      botBase: botBase, proxyBase: PROXY_BASE,
      readToken: TOKEN, catalogToken: TOKEN, sendToken: TOKEN,
      port: 0, nowMs: function () { return Date.now(); },
    });
  }

  // delivered:true MUST reach the bot as image:true — the contract the
  // top-level imageDelivery shape was silently breaking.
  async function expectImageSent(label, item, skill) {
    sendBodies.length = 0;
    const svc = freshService();
    const out = await svc.processOne(item);
    assert.ok(typeof out === "string" && out.indexOf("terminal:") === 0,
      label + " terminal, got " + out);
    const log = svc.getAgenticLog();
    assert.ok(log.length >= 1 && log[log.length - 1].skill === skill,
      label + " routed to " + skill + ", got " + JSON.stringify(log.map(function (e) { return e.skill; })));
    assert.strictEqual(sendBodies.length, 1, label + ": one send, got " + sendBodies.length);
    assert.strictEqual(sendBodies[0].image, true, label + ": send carried image:true");
    assert.ok(!new RegExp(APOS).test(sendBodies[0].text),
      label + ": no can't-send-pictures caveat when the image went out");
    assert.ok(!/SYNTH_/.test(sendBodies[0].text), label + ": no ids leak into reply");
    const ob = await outbound();
    const last = ob[ob.length - 1];
    assert.ok(last && last.image_message_id, label + ": bot confirmed an image_message_id");
    assert.strictEqual(svc.status().counts.images_delivered, 1,
      label + ": image counted only on bot proof");
    console.log("  pass: " + label + " staged image sent with image:true, no caveat");
  }

  try {
    const put = await botJson("PUT", "/ig/catalog/" + DEMO_REF, seedPieces());
    assert.ok(put.status === 200 || put.status === 204, "catalog seed PUT, got " + put.status);

    // --- Match_look: photo + inspiration caption routes via heuristic ---
    console.log("\n[Match_look delivers its preview end-to-end]");
    {
      const posted = await botJson("POST",
        "/mock/incoming-photo?kind=post&caption=" + encodeURIComponent("pinterest inspiration, recreate this look"),
        undefined, Buffer.from(TINY_PNG_B64, "base64"), "image/png");
      assert.strictEqual(posted.status, 200, "photo share accepted, got " + posted.status);
      const items = await shares();
      const item = items.filter(function (s) { return s.id === posted.body.share.id; })[0];
      assert.ok(item && item.media_id, "photo share carries media_id");
      await expectImageSent("Match_look", item, "Match_look");
    }

    // --- Complete_the_look: text trigger, preview staged and sent ---
    console.log("\n[Complete_the_look delivers its preview end-to-end]");
    {
      const posted = await botJson("POST", "/mock/incoming-text", { text: "complete the look, what could i buy" });
      assert.strictEqual(posted.status, 200, "text share accepted");
      const items = await shares();
      const item = items.filter(function (s) { return s.id === posted.body.share.id; })[0];
      await expectImageSent("Complete_the_look", item, "Complete_the_look");
    }

    // --- Fail-closed: preview down -> text-only WITH the honest caveat ---
    console.log("\n[preview failure stays text-only with caveat]");
    {
      proxyCfg.previewOk = false;
      sendBodies.length = 0;
      try {
        const posted = await botJson("POST", "/mock/incoming-text", { text: "complete the look, what could i buy" });
        const items = await shares();
        const item = items.filter(function (s) { return s.id === posted.body.share.id; })[0];
        const svc = freshService();
        const out = await svc.processOne(item);
        assert.ok(typeof out === "string" && out.indexOf("terminal:") === 0,
          "fallback terminal, got " + out);
        assert.strictEqual(sendBodies.length, 1, "one send attempted");
        assert.ok(!sendBodies[0].image, "staging failure falls back to text-only");
        assert.ok(new RegExp(APOS).test(sendBodies[0].text),
          "fallback reply keeps the honest caveat");
        assert.strictEqual(svc.status().counts.images_delivered, 0, "nothing counted as delivered");
        console.log("  pass: preview failure falls back to honest text-only");
      } finally {
        proxyCfg.previewOk = true;
      }
    }

    // --- revise_look LAST: exclusion is per-turn (never persisted, Opus
    // finding #7), so later cases would see the same wardrobe. The extra
    // cardigan keeps a valid look available once the bag is set aside
    // (dress+scarf alone is an incomplete finish, honestly no valid look).
    console.log("\n[revise_look delivers its preview end-to-end]");
    {
      const withLayer = seedPieces().concat([{
        piece_id: "SYNTH_piece_704", category: "layer/cardigan", attributes: {},
        source_share_id: "SYNTH_share_seed_704", added_at: new Date().toISOString(),
        copy_preview_keys: { copy: null, preview: null }, status: "active",
      }]);
      const reSeed = await botJson("PUT", "/ig/catalog/" + DEMO_REF, withLayer);
      assert.ok(reSeed.status === 200 || reSeed.status === 204, "catalog re-seed PUT, got " + reSeed.status);
      const posted = await botJson("POST", "/mock/incoming-text", { text: "drop the bag please" });
      assert.strictEqual(posted.status, 200, "text share accepted");
      const items = await shares();
      const item = items.filter(function (s) { return s.id === posted.body.share.id; })[0];
      await expectImageSent("revise_look", item, "revise_look");
    }

    console.log("\nAll image-delivery contract tests passed.");
  } finally {
    global.fetch = realFetch;
    await new Promise(function (resolve) { botServer.close(resolve); });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
