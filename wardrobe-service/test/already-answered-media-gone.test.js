"use strict";
/* meta-styles — already-answered media-gone + loud save-failure regression test.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves, with synthetic fixtures only and a REAL mock bot (genuine
 * idempotency/window semantics, not stubs):
 *
 *  Bug — zombie retry loop: a photo share that was answered and collected
 *  (media deleted after the reply, the inbox-bridge rule) replays
 *  media_available:false after every restart, with no catalogued piece
 *  only when the save failed. Two read-only guards now resolve it:
 *  (1) a catalogued piece with source_share_id === share id resolves
 *  terminal as already-answered — no second send, no retry; (2) a
 *  media-gone share whose own timestamp is already outside the 24h window
 *  resolves terminal window_closed at once (the send gate would refuse it
 *  anyway). The check is deliberately NOT an idempotent-send probe: with
 *  no prior send a probe would itself deliver a message, and for shares
 *  first answered before the stable per-share key existed it would
 *  duplicate-send instead of 409ing.
 *
 *  Guard — a genuinely new share with media not yet available (no prior
 *  send, open window) still retries normally and eventually gives up, and
 *  no reply goes out for a photo the service never saw.
 *
 *  Loud saves — a failed catalog.save() logs an activity line and bumps
 *  counts.catalog_save_failed instead of vanishing, without blocking the
 *  already-composed reply.
 *
 *  All ids are SYNTH_-prefixed; no real account/media ids anywhere.
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
  console.log("already-answered-media-gone.test.js");

  const realFetch = global.fetch;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-styles-answered-"));
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

  // Proxy stub: everything under the fake proxy base rejects (forces the
  // labelled local fallbacks deterministically); the bot stays reachable.
  global.fetch = function (url, opts) {
    if (String(url).indexOf(PROXY_BASE) === 0) {
      return Promise.reject(new Error("proxy unreachable (stub)"));
    }
    return realFetch(url, opts);
  };

  function freshService(extra) {
    delete require.cache[require.resolve("../server.js")];
    const Service = require("../server.js");
    return Service.createService(Object.assign({
      botBase: botBase, proxyBase: PROXY_BASE,
      readToken: TOKEN, catalogToken: TOKEN, sendToken: TOKEN,
      port: 0, nowMs: function () { return Date.now(); },
    }, extra || {}));
  }

  try {
    // Seed the demo wardrobe through the EXISTING catalog PUT contract.
    const put = await botJson("PUT", "/ig/catalog/" + DEMO_REF, seedPieces());
    assert.ok(put.status === 200 || put.status === 204, "catalog seed PUT, got " + put.status);

    // --- A photo share arrives with its media available ---
    console.log("\n[photo share answered, media collected on send]");
    const inc = await botJson("POST", "/mock/incoming-photo", { caption: "SYNTH dress" });
    assert.strictEqual(inc.status, 200, "incoming-photo accepted");
    let items = await shares();
    assert.strictEqual(items.length, 1, "one share present");
    const photo = items[0];
    assert.strictEqual(photo.media_available, true, "media available at first");
    assert.ok(typeof photo.media_id === "string" && photo.media_id, "media_id present");

    const svc1 = freshService();
    const out1 = await svc1.processOne(photo);
    assert.ok(typeof out1 === "string" && out1.indexOf("terminal:") === 0,
      "photo processOne terminal, got " + out1);
    let log = await outbound();
    assert.strictEqual(log.length, 1, "exactly one outbound send, got " + log.length);

    // The catalogue skill must record the REAL share id as provenance —
    // otherwise no restart replay could ever match it back to this share.
    let pieces = await catalog();
    assert.strictEqual(pieces.length, 4, "seed 3 + 1 catalogued, got " + pieces.length);
    assert.ok(pieces.some(function (p) { return p.source_share_id === photo.id; }),
      "one piece carries the real share id");

    // The send path acknowledges collection, so the bot deleted the media:
    // re-polling now shows media_available:false with the media_id kept.
    items = await shares();
    const replayed = items.filter(function (s) { return s.id === photo.id; })[0];
    assert.strictEqual(replayed.media_available, false, "media gone after collect");

    // --- Simulated restart: the same share replays, media gone ---
    console.log("\n[restart: collected share resolves already-answered, no resend]");
    const svc2 = freshService();
    const out2 = await svc2.processOne(replayed);
    assert.ok(typeof out2 === "string" && out2.indexOf("terminal:") === 0,
      "replay terminal, got " + out2);
    assert.ok(out2.indexOf("retry") === -1, "replay is NOT a retry, got " + out2);
    const st2 = svc2.status();
    assert.ok(st2.activity.some(function (l) { return /already answered earlier/.test(l); }),
      "honest already-answered line, activity=" + JSON.stringify(st2.activity));
    log = await outbound();
    assert.strictEqual(log.length, 1, "STILL one outbound send, got " + log.length);
    assert.strictEqual(st2.counts.sent, 0, "no send counted");
    assert.strictEqual(st2.counts.duplicates, 1, "suppressed resend counted as duplicate");
    assert.strictEqual(st2.counts.processed, 1, "processed counted");
    assert.strictEqual(st2.counts.gave_up, 0, "never gave up");
    assert.strictEqual(st2.counts.errors, 0, "no error retries");
    pieces = await catalog();
    assert.strictEqual(pieces.length, 4, "no duplicate piece catalogued");
    // Cursor replay safety: re-offering the same share stays terminal.
    const out2b = await svc2.processOne(replayed);
    assert.ok(out2b.indexOf("terminal:") === 0, "second replay terminal, got " + out2b);
    assert.strictEqual((await outbound()).length, 1, "still one outbound send");

    // --- A genuinely new share with media not yet available: retry, then give up ---
    console.log("\n[fresh pending share retries normally, never sends]");
    const pend = await realFetch(botBase + "/mock/incoming-photo?pending=1", {
      method: "POST", headers: { Authorization: "Bearer " + TOKEN },
    });
    assert.strictEqual(pend.status, 200, "pending incoming-photo accepted");
    items = await shares();
    const fresh = items.filter(function (s) { return s.id !== photo.id; })[0];
    assert.strictEqual(fresh.media_available, false, "fresh share media pending");
    const outcomes = [];
    for (let i = 0; i < 5; i++) outcomes.push(await svc2.processOne(fresh));
    assert.deepStrictEqual(outcomes.slice(0, 4), ["retry", "retry", "retry", "retry"],
      "four retries, got " + JSON.stringify(outcomes));
    assert.ok(outcomes[4].indexOf("terminal:gave_up") === 0,
      "fifth attempt gives up, got " + outcomes[4]);
    log = await outbound();
    assert.strictEqual(log.length, 1, "no reply went out for the unseen photo, got " + log.length);
    const st3 = svc2.status();
    assert.strictEqual(st3.counts.gave_up, 1, "give-up counted");

    // --- A media-gone share past the 24h window: terminal at once, no retries ---
    console.log("\n[old media-gone share resolves window_closed immediately]");
    const old = await realFetch(botBase + "/mock/incoming-photo?pending=1&age_hours=30", {
      method: "POST", headers: { Authorization: "Bearer " + TOKEN },
    });
    assert.strictEqual(old.status, 200, "old pending incoming-photo accepted");
    items = await shares();
    const stale = items.filter(function (s) { return s.id !== photo.id && s.id !== fresh.id; })[0];
    const errorsBefore = svc2.status().counts.errors;
    const gaveUpBefore = svc2.status().counts.gave_up;
    const outOld = await svc2.processOne(stale);
    assert.ok(outOld.indexOf("terminal:window_closed") === 0,
      "stale share terminal window_closed at once, got " + outOld);
    assert.strictEqual(svc2.status().counts.gave_up, gaveUpBefore, "no new give-up");
    assert.strictEqual(svc2.status().counts.errors, errorsBefore, "no retry errors");
    assert.strictEqual((await outbound()).length, 1, "still one outbound send");

    console.log("  pass: already-answered terminal; fresh retries then gives up; stale window-closed");
  } finally {
    global.fetch = realFetch;
    await new Promise(function (resolve) { botServer.close(resolve); });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // --- Save failures are loud but never block the reply ---
  console.log("\n[failed save logs + counts, reply still goes out]");
  {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "meta-styles-savefail-"));
    const started = await MockBot.startServer({
      port: 0, token: TOKEN, catalogDir: tmpDir2, catalogSecret: "SYNTH_test_catalog_secret",
    });
    const botBase2 = "http://127.0.0.1:" + started.server.address().port;
    const realFetch2 = global.fetch;
    global.fetch = function (url, opts) {
      if (String(url).indexOf(PROXY_BASE) === 0) {
        return Promise.reject(new Error("proxy unreachable (stub)"));
      }
      return realFetch2(url, opts);
    };
    try {
      await realFetch2(botBase2 + "/mock/incoming-text", {
        method: "POST",
        headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "show me a look" }),
      });
      const res = await realFetch2(botBase2 + "/ig/shares?limit=50", {
        headers: { Authorization: "Bearer " + TOKEN },
      });
      const textItem = (await res.json()).items[0];
      // Wrong catalog token: every PUT/GET /ig/catalog 401s, while sends
      // (correct send token) still succeed.
      const svc = freshService({
        botBase: botBase2, readToken: TOKEN, sendToken: TOKEN, catalogToken: "SYNTH_wrong_token",
      });
      const outcome = await svc.processOne(textItem);
      assert.ok(typeof outcome === "string" && outcome.indexOf("terminal:") === 0,
        "text share terminal despite save failure, got " + outcome);
      const st = svc.status();
      assert.ok(st.counts.catalog_save_failed >= 1,
        "save failure counted, got " + st.counts.catalog_save_failed);
      assert.ok(st.activity.some(function (l) { return /Couldn't save the wardrobe/.test(l); }),
        "save failure logged, activity=" + JSON.stringify(st.activity));
      const sentLog = await realFetch2(botBase2 + "/mock/outbound", {
        headers: { Authorization: "Bearer " + TOKEN },
      }).then(function (r) { return r.json(); });
      assert.strictEqual(sentLog.outbound.length, 1, "reply still went out");
    } finally {
      global.fetch = realFetch2;
      await new Promise(function (resolve) { started.server.close(resolve); });
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
    console.log("  pass: save failure loud + counted, reply unblocked");
  }

  console.log("\nAll already-answered media-gone tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
