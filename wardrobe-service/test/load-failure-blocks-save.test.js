"use strict";
/* meta-styles — failed first load never wipes the stored wardrobe (Opus finding #5).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves, with synthetic fixtures only and a REAL mock bot (genuine
 * catalog/send/media semantics, not stubs), that a catalog load failure
 * at first contact cannot cause the next save to overwrite the user's
 * whole stored wardrobe with whatever is in memory:
 *  - (unit) a store-backed catalog whose load() failed (fail-closed
 *    schema rejection) refuses save() with load_not_confirmed, and the
 *    stored bytes are untouched; a later successful load() unblocks
 *    save() normally; a brand-new ref whose load() returns ok/[] saves
 *    immediately (empty load is NOT a failure); memory-only catalogs
 *    still resolve honest no_store exactly as before.
 *  - (service) a text turn whose first load fails still replies, but the
 *    refused save is LOUD through the existing M20 path (activity line +
 *    counts.catalog_save_failed, same wording/count as every other
 *    save failure) and the stored wardrobe is byte-identical afterwards.
 *  - (service) after the stored data is repaired, the NEXT turn on the
 *    same service instance retries the load (no restart, no pinned
 *    memory-only mode) and save() proceeds normally again.
 *
 * No real network traffic: the mock bot runs on loopback; only the
 * configured PROXY_BASE stub rejects (forcing the labelled keyless
 * fallbacks, exactly like the other service suites).
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
const Catalog = require("../../app/wardrobe-catalog.js");

const TOKEN = "SYNTH_mock_token";
const DEMO_REF = "u_deadbeefdeadbeefdeadbeefdeadbeef";
const REF_NEW = "u_" + "1".repeat(32);
const REF_BAD = "u_" + "2".repeat(32);
const PROXY_BASE = "http://127.0.0.1:59999";

const CORRUPT = [{ bogus: "SYNTH_nope" }];

function synthDressPiece(tag) {
  return {
    piece_id: "SYNTH_piece_" + tag,
    category: "dress",
    attributes: { color: "sage", silhouette: "wrap midi", layer_role: "base" },
    source_share_id: "SYNTH_share_" + tag,
    added_at: "2026-10-29T12:00:00.000Z",
    copy_preview_keys: { copy: null, preview: null },
    status: "active",
  };
}

async function run() {
  console.log("load-failure-blocks-save.test.js");

  const realFetch = global.fetch;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-styles-loadfail-"));
  const { server: botServer } = await MockBot.startServer({
    port: 0, token: TOKEN, catalogDir: tmpDir, catalogSecret: "SYNTH_test_catalog_secret",
  });
  const botBase = "http://127.0.0.1:" + botServer.address().port;

  function botUrl(p) { return botBase + p; }

  async function botJson(method, urlPath, body) {
    const res = await realFetch(botUrl(urlPath), {
      method: method,
      headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = null; }
    return { status: res.status, body: parsed };
  }

  async function getCatalog(ref) {
    const res = await botJson("GET", "/ig/catalog/" + ref);
    assert.strictEqual(res.status, 200, "catalog readable, got " + res.status);
    return res.body;
  }

  async function shares() {
    const res = await realFetch(botUrl("/ig/shares?limit=50"), {
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

  // Proxy stub rejects; everything else passes through to the real mock bot.
  global.fetch = function (url, opts) {
    if (String(url).indexOf(PROXY_BASE) === 0) {
      return Promise.reject(new Error("proxy unreachable (stub)"));
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
    // --- Unit: save refused until a load succeeds; empty load confirms ---
    console.log("\n[unit: store-backed save() gated on a succeeded load()]");
    {
      const store = Catalog.createCatalogStore({ base: botBase, token: TOKEN, userRef: REF_NEW });
      const cat = Catalog.createCatalog({ userKey: "SYNTH_user_loadfail_new", store: store });
      const early = await cat.save();
      assert.strictEqual(early.ok, false, "save before any load is refused");
      assert.strictEqual(early.error, "load_not_confirmed", "honest error, got " + early.error);
      assert.deepStrictEqual(await getCatalog(REF_NEW), [],
        "refused save PUT nothing — stored ref still empty");
      const first = await cat.load();
      assert.ok(first.ok === true && first.count === 0,
        "brand-new ref load succeeds with count 0, got " + JSON.stringify(first));
      cat.addPiece({
        category: "scarf",
        attributes: { color: "opal", silhouette: "neck wrap", layer_role: "finish" },
        source_share_id: "SYNTH_share_new",
      });
      const saved = await cat.save();
      assert.ok(saved.ok === true, "save after an empty-but-ok load proceeds, got " + saved.error);
      assert.strictEqual((await getCatalog(REF_NEW)).length, 1, "piece persisted");
      console.log("  pass: save-before-load refused; empty load confirms; save proceeds");
    }

    // --- Unit: fail-closed load keeps memory; save stays refused; later load unblocks ---
    console.log("\n[unit: corrupt stored array -> load fails closed, save refused, retry unblocks]");
    {
      const put = await botJson("PUT", "/ig/catalog/" + REF_BAD, CORRUPT);
      assert.ok(put.status === 200 || put.status === 204, "corrupt seed PUT, got " + put.status);
      const store = Catalog.createCatalogStore({ base: botBase, token: TOKEN, userRef: REF_BAD });
      const cat = Catalog.createCatalog({ userKey: "SYNTH_user_loadfail_bad", store: store });
      cat.addPiece({
        category: "dress",
        attributes: { color: "sage", silhouette: "wrap midi", layer_role: "base" },
        source_share_id: "SYNTH_share_bad1",
      });
      const bad = await cat.load();
      assert.strictEqual(bad.ok, false, "corrupt load fails, got " + JSON.stringify(bad));
      assert.strictEqual(cat.getPieces().length, 1, "memory untouched by the bad load");
      const refused = await cat.save();
      assert.strictEqual(refused.ok, false, "save after failed load refused");
      assert.strictEqual(refused.error, "load_not_confirmed", "honest error, got " + refused.error);
      assert.deepStrictEqual(await getCatalog(REF_BAD), CORRUPT,
        "refused save left the stored bytes identical");
      // Repair the stored data; the next load succeeds and unblocks save.
      const fix = await botJson("PUT", "/ig/catalog/" + REF_BAD, [synthDressPiece("ok")]);
      assert.ok(fix.status === 200 || fix.status === 204, "repair PUT, got " + fix.status);
      const retry = await cat.load();
      assert.ok(retry.ok === true && retry.count === 1,
        "retry load succeeds, got " + JSON.stringify(retry));
      const saved = await cat.save();
      assert.ok(saved.ok === true, "save after a good retry proceeds, got " + saved.error);
      assert.strictEqual((await getCatalog(REF_BAD)).length, 1, "stored wardrobe intact");
      console.log("  pass: failed load blocks save; repaired load unblocks it");
    }

    // --- Unit: memory-only catalogs behave exactly as before ---
    console.log("\n[unit: no store attached -> honest no_store, unchanged]");
    {
      const mem = Catalog.createCatalog({ userKey: "SYNTH_user_loadfail_mem" });
      mem.addPiece({
        category: "bag",
        attributes: { color: "silver", silhouette: "mini shoulder", layer_role: "finish" },
        source_share_id: "SYNTH_share_mem",
      });
      const s = await mem.save();
      const l = await mem.load();
      assert.ok(s.ok === false && s.error === "no_store", "memory-only save no_store");
      assert.ok(l.ok === false && l.error === "no_store", "memory-only load no_store");
      assert.strictEqual(mem.getPieces().length, 1, "memory kept");
      console.log("  pass: memory-only save()/load() unchanged");
    }

    // --- Service: first-contact load failure -> reply goes out, save refused LOUDLY ---
    console.log("\n[service: failed first load -> no destructive PUT, loud save failure]");
    let svc;
    {
      const put = await botJson("PUT", "/ig/catalog/" + DEMO_REF, CORRUPT);
      assert.ok(put.status === 200 || put.status === 204, "corrupt seed PUT, got " + put.status);
      const inc = await botJson("POST", "/mock/incoming-text", { text: "show me a look" });
      assert.strictEqual(inc.status, 200, "incoming-text accepted");
      const items = await shares();
      assert.strictEqual(items.length, 1, "one share present");
      svc = freshService();
      const out = await svc.processOne(items[0]);
      assert.ok(typeof out === "string" && out.indexOf("terminal:") === 0,
        "turn still terminates (reply best-effort), got " + out);
      assert.strictEqual((await outbound()).length, 1, "reply still went out");
      assert.deepStrictEqual(await getCatalog(DEMO_REF), CORRUPT,
        "stored wardrobe byte-identical — no whole-array PUT of memory happened");
      const st = svc.status();
      assert.ok(st.counts.catalog_save_failed >= 1,
        "refused save counted like any save failure, got " + st.counts.catalog_save_failed);
      assert.ok(st.activity.some(function (l) { return /Couldn't save the wardrobe/.test(l); }),
        "refused save logged with the M20 wording, activity=" + JSON.stringify(st.activity));
      console.log("  pass: reply sent, nothing PUT, failure loud + counted");
    }

    // --- Service: repaired data -> next turn retries the load, save unblocked ---
    console.log("\n[service: next turn retries load, save proceeds normally]");
    {
      const fix = await botJson("PUT", "/ig/catalog/" + DEMO_REF, [synthDressPiece("kept")]);
      assert.ok(fix.status === 200 || fix.status === 204, "repair PUT, got " + fix.status);
      const failedBefore = svc.status().counts.catalog_save_failed;
      const inc = await botJson("POST", "/mock/incoming-photo", { caption: "SYNTH scarf" });
      assert.strictEqual(inc.status, 200, "incoming-photo accepted");
      const photoId = inc.body && inc.body.share && inc.body.share.id;
      assert.ok(typeof photoId === "string" && photoId, "photo share id returned");
      const items = await shares();
      const photo = items.filter(function (s) { return s && s.id === photoId; })[0];
      assert.ok(photo && photo.media_available === true, "photo share present with media");
      const out = await svc.processOne(photo);
      assert.ok(typeof out === "string" && out.indexOf("terminal:") === 0,
        "photo turn terminates, got " + out);
      const stored = await getCatalog(DEMO_REF);
      assert.strictEqual(stored.length, 2,
        "memory (repaired piece + new piece) saved, got " + JSON.stringify(stored).slice(0, 160));
      assert.ok(stored.some(function (p) { return !!p && p.source_share_id === photo.id; }),
        "new piece catalogued for this share");
      assert.ok(stored.some(function (p) { return !!p && p.piece_id === "SYNTH_piece_kept"; }),
        "previously stored piece survived the save");
      assert.strictEqual(svc.status().counts.catalog_save_failed, failedBefore,
        "no new save failure once the load succeeds");
      console.log("  pass: retry loaded, save unblocked, old + new pieces stored");
    }
  } finally {
    global.fetch = realFetch;
    await new Promise(function (resolve) { botServer.close(resolve); });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("\nAll load-failure-blocks-save tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
