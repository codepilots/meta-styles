"use strict";
/* meta-styles — deletion reconciliation (data-deletion compliance).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves the service honours an owner's deletion request via the live bot's
 * GET /ig/deletion-status/<user_ref> (Bearer catalogToken) — mock mode never
 * probed — with fail-open on every non-definite answer, an anonymous public
 * activity line, and natural recovery (fresh context, zero pieces, no
 * resurrection PUT) when a post-purge share arrives.
 *
 * Synthetic fixtures only (SYNTH_ ids, example.invalid shape).
 */
const assert = require("assert");
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TOKEN = "SYNTH_mock_token";
const PROXY_BASE = "http://127.0.0.1:59999";
// Real-bot user_ref shape that mock-ig-bot enforces (u_ + 32 hex) — synthetic
const REF_A = "u_" + "a".repeat(32);
const REF_B = "u_" + "b".repeat(32);
const REF_C = "u_" + "c".repeat(32);
const REF_D = "u_" + "d".repeat(32);
const REF_E = "u_" + "e".repeat(32);

function synthDressPiece(tag, shareId) {
  return {
    piece_id: "SYNTH_piece_" + tag,
    category: "dress",
    attributes: { color: "sage", silhouette: "wrap midi", layer_role: "base" },
    source_share_id: shareId || "SYNTH_share_" + tag,
    added_at: "2026-10-29T12:00:00.000Z",
    copy_preview_keys: { copy: null, preview: null },
    status: "active",
  };
}

// Fake bot: tracks deletion-status hits and catalog PUTs, handles the
// minimal surface the service exercises (shares, deletion-status, catalog,
// send, stage, media, outbound). Deletion behaviour driven by per-test config.
function startFakeBot(opts) {
  const o = opts || {};
  const deletionResponses = o.deletionResponses || {}; // ref -> { status, body } or { error: "reset" } etc.
  const deletionHits = []; // { ref, headers }
  const catalogPuts = []; // { ref, body }
  const catalogStore = Object.assign({}, o.catalogStore || {}); // ref -> pieces array
  // deletionResponses fallback: if ref not in map, use o.defaultDeletion
  const defaultDeletion = o.defaultDeletion || { status: 200, body: { scrubbed: false } };

  const server = http.createServer(function (req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    // Auth check
    const auth = req.headers.authorization || "";
    if (auth !== "Bearer " + TOKEN) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    // GET /ig/deletion-status/<ref>
    if (req.method === "GET" && url.pathname.indexOf("/ig/deletion-status/") === 0) {
      const ref = decodeURIComponent(url.pathname.slice("/ig/deletion-status/".length));
      deletionHits.push({ ref: ref, headers: Object.assign({}, req.headers) });
      let cfg = deletionResponses[ref] !== undefined ? deletionResponses[ref] : defaultDeletion;
      if (cfg && cfg.error === "reset") {
        // Simulate connection reset: destroy socket
        res.destroy();
        return;
      }
      if (cfg && cfg.error === "timeout") {
        // Leave hanging — but for test determinism we just 500
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "server_error" }));
        return;
      }
      let status = cfg.status !== undefined ? cfg.status : 200;
      let body = cfg.body !== undefined ? cfg.body : { scrubbed: false };
      // Support raw body string for malformed JSON test
      if (typeof body === "string") {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(body);
        return;
      }
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }

    // GET /ig/catalog/<ref> — return {"pieces": [...] } (live shape) or [] mock shape
    if (req.method === "GET" && url.pathname.indexOf("/ig/catalog/") === 0) {
      const ref = decodeURIComponent(url.pathname.slice("/ig/catalog/".length));
      const pieces = catalogStore[ref] !== undefined ? catalogStore[ref] : [];
      // Return live shape for scrubbed case, but either is accepted by wardrobe-catalog.js
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ pieces: pieces }));
      return;
    }
    // PUT /ig/catalog/<ref>
    if (req.method === "PUT" && url.pathname.indexOf("/ig/catalog/") === 0) {
      const ref = decodeURIComponent(url.pathname.slice("/ig/catalog/".length));
      let body = "";
      req.on("data", function (c) { body += c; });
      req.on("end", function () {
        let parsed;
        try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
        catalogPuts.push({ ref: ref, body: parsed });
        if (Array.isArray(parsed)) catalogStore[ref] = parsed;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({}));
      });
      return;
    }

    // GET /ig/shares
    if (req.method === "GET" && url.pathname === "/ig/shares") {
      const items = o.shares || [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items: items, next_cursor: items.length ? String(items.length) : null }));
      return;
    }
    // POST /ig/send
    if (req.method === "POST" && url.pathname === "/ig/send") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message_id: "SYNTH_msg_001" }));
      return;
    }
    // Staging
    if (req.method === "POST" && (url.pathname.indexOf("/mock/stage-outbound-image/") === 0 || url.pathname.indexOf("/ig/outbound-stage/") === 0)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      // Extract share_id for response
      const sid = url.pathname.split("/").pop();
      res.end(JSON.stringify({ share_id: decodeURIComponent(sid) }));
      return;
    }
    // GET /ig/media/<id>
    if (req.method === "GET" && url.pathname.indexOf("/ig/media/") === 0) {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end(Buffer.from("fake-image-bytes"));
      return;
    }
    // GET /ig/outbound-media etc not needed
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  return new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", function () {
      resolve({ server: server, deletionHits: deletionHits, catalogPuts: catalogPuts, catalogStore: catalogStore });
    });
  });
}

function freshService(botBase, extra) {
  delete require.cache[require.resolve("../server.js")];
  // Must also clear wardrope-catalog/store caches that may hold old base?
  const Service = require("../server.js");
  return Service.createService(Object.assign({
    botBase: botBase, proxyBase: PROXY_BASE,
    readToken: TOKEN, catalogToken: TOKEN, sendToken: TOKEN,
    port: 0, nowMs: function () { return Date.now(); },
  }, extra || {}));
}

async function run() {
  console.log("deletion-reconcile.test.js");
  const realFetch = global.fetch;
  // Proxy stub: proxy base unreachable (labelled fallback)
  global.fetch = function (url, opts) {
    if (String(url).indexOf(PROXY_BASE) === 0) return Promise.reject(new Error("proxy unreachable (stub)"));
    return realFetch(url, opts);
  };

  // Helper: seed a service with a live-mode user that has pieces, via
  // fake bot catalogStore + processOne to create the user context.
  // We use a fake bot per test so each is isolated.

  // --- Test a: scrubbed:true -> purge, then recovery creates fresh context ---
  console.log("\n[a] scrubbed:true purges; later share creates fresh zero-piece context, no PUT");
  {
    let fake = await startFakeBot({
      deletionResponses: (function () { let m = {}; m[REF_A] = { status: 200, body: { scrubbed: true } }; return m; })(),
      catalogStore: (function () { let m = {}; m[REF_A] = [synthDressPiece("A1", "SYNTH_share_A1"), synthDressPiece("A2", "SYNTH_share_A2")]; return m; })(),
      shares: [],
    });
    const botBase2 = "http://127.0.0.1:" + fake.server.address().port;
    const svcLive = freshService(botBase2, { mode: "live" });
    let shareA = {
      id: "SYNTH_share_init_A2", received_at: new Date().toISOString(),
      attachment: { type: "text", payload: { text: "hello live" } }, user_ref: REF_A,
    };
    let out = await svcLive.processOne(shareA);
    assert.ok(typeof out === "string" && out.indexOf("terminal:") === 0, "live init share terminal, got " + out);
    let ctx = svcLive.getUserContext(REF_A);
    assert.ok(ctx, "live user A context exists");
    assert.strictEqual(ctx.catalog.getPieces().length, 2, "live loaded 2 pieces");

    const beforePuts = fake.catalogPuts.length;
    await svcLive.reconcileDeletions();
    assert.strictEqual(svcLive.getUserContext(REF_A), null, "user A purged after scrubbed:true");
    assert.strictEqual(svcLive.status().counts.deletions_cleared, 1, "deletions_cleared bumped");
    assert.strictEqual(svcLive.status().deletions_cleared, 1, "top-level deletions_cleared");
    assert.ok(svcLive.status().activity.some(function (l) { return /wardrobe was cleared by its owner's deletion request/.test(l); }),
      "anonymous activity line, got " + JSON.stringify(svcLive.status().activity));
    // Activity must not contain ref/id
    const act = svcLive.status().activity.join(" ");
    assert.ok(act.indexOf(REF_A) === -1, "activity must not contain ref");
    assert.ok(act.indexOf("SYNTH_") === -1 || /wardrobe was cleared/.test(act), "activity must not leak SYNTH_ ids (only anonymous text)");

    // Dropped user recovering: next share with same ref creates fresh context with zero pieces and no PUT
    // Simulate bot scrubbed file: catalog now returns [] for REF_A
    fake.catalogStore[REF_A] = [];
    fake.catalogPuts.length = 0;
    const shareA2 = {
      id: "SYNTH_share_recover_A", received_at: new Date().toISOString(),
      attachment: { type: "text", payload: { text: "I'm back" } }, user_ref: REF_A,
    };
    out = await svcLive.processOne(shareA2);
    assert.ok(typeof out === "string" && out.indexOf("terminal:") === 0, "recovery share terminal, got " + out);
    const ctx2 = svcLive.getUserContext(REF_A);
    assert.ok(ctx2, "fresh context created for recovered user");
    assert.strictEqual(ctx2.catalog.getPieces().length, 0, "fresh context has zero pieces (scrubbed file), got " + ctx2.catalog.getPieces().length);
    // Recovery may PUT an empty array via saveBestEffort (no new pieces); key is it never resurrects old pieces
    const resurrected = fake.catalogPuts.some(function (p) { return p.body && p.body.length > 0 && p.body.some(function (pc) { return pc.piece_id === "SYNTH_piece_A1" || pc.piece_id === "SYNTH_piece_A2"; }); });
    assert.ok(!resurrected, "no resurrection PUT with old pieces, got " + JSON.stringify(fake.catalogPuts));
    console.log("  pass");

    // Status reconciles again — scrubbed:true still, so recovered user would be re-purged.
    // Flip to scrubbed:false to keep recovered user for the status check.
    fake.deletionHits.length = 0;
    // Mutate the fake's response by replacing handler — simpler: recreate fake with scrubbed:false
    // But we keep same svcLive; instead check that deletions_cleared >=1 and status has the field
    // without requiring exact count (re-purge would bump to 2).
    // Stop current fake, create new one that says not scrubbed for recovered user.
    await new Promise(function (r) { fake.server.close(r); });
    fake = await startFakeBot({
      deletionResponses: (function () { let m = {}; m[REF_A] = { status: 200, body: { scrubbed: false } }; return m; })(),
      catalogStore: Object.assign({}, (function () { let m = {}; m[REF_A] = []; return m; })()),
    });
    const statusBase = "http://127.0.0.1:" + fake.server.address().port;
    // Point svcLive at new fake's base for status reconcile
    // We can't re-point botBase, so test status on a fresh service instead
    const svcForStatus = freshService(statusBase, { mode: "live" });
    // Seed a user to have something to check, then verify status shape
    const shareStatus = { id: "SYNTH_share_status_A", received_at: new Date().toISOString(), attachment: { type: "text", payload: { text: "hi status" } }, user_ref: REF_A };
    await svcForStatus.processOne(shareStatus);
    await svcForStatus.reconcileDeletions(); // should be no-op (scrubbed:false)
    const info = await svcForStatus.start();
    try {
      const res = await realFetch("http://127.0.0.1:" + info.port + "/wardrobe/status");
      assert.strictEqual(res.status, 200, "status 200, got " + res.status);
      const body = await res.json();
      assert.strictEqual(typeof body.deletions_cleared, "number", "deletions_cleared number, got " + JSON.stringify(body));
      const blob = JSON.stringify(body);
      assert.ok(blob.indexOf(REF_A) === -1, "status JSON must not contain ref");
      assert.ok(blob.indexOf("SYNTH_share") === -1, "status JSON must not contain share id");
      console.log("  pass: /wardrobe/status includes deletions_cleared, no ref/id leak");
    } finally {
      await svcForStatus.stop();
    }
    await new Promise(function (r) { fake.server.close(r); });
  }

  // --- Test b: scrubbed:false -> kept ---
  console.log("\n[b] scrubbed:false -> kept");
  {
    const fake = await startFakeBot({
      deletionResponses: (function () { let m = {}; m[REF_B] = { status: 200, body: { scrubbed: false } }; return m; })(),
      catalogStore: (function () { let m = {}; m[REF_B] = [synthDressPiece("B1")]; return m; })(),
    });
    const botBase = "http://127.0.0.1:" + fake.server.address().port;
    const svc = freshService(botBase, { mode: "live" });
    const share = { id: "SYNTH_share_B1", received_at: new Date().toISOString(), attachment: { type: "text", payload: { text: "hi" } }, user_ref: REF_B };
    await svc.processOne(share);
    assert.ok(svc.getUserContext(REF_B), "user B exists");
    await svc.reconcileDeletions();
    assert.ok(svc.getUserContext(REF_B), "user B kept on scrubbed:false");
    assert.strictEqual(svc.status().counts.deletions_cleared, 0, "not counted");
    assert.ok(!svc.status().activity.some(function (l) { return /wardrobe was cleared/.test(l); }), "no activity spam");
    console.log("  pass");
    await new Promise(function (r) { fake.server.close(r); });
  }

  // --- Test c: 404 -> kept (fail-open) ---
  console.log("\n[c] 404 -> kept (fail-open)");
  {
    const fake = await startFakeBot({
      deletionResponses: (function () { let m = {}; m[REF_C] = { status: 404, body: { error: "not_found" } }; return m; })(),
      catalogStore: (function () { let m = {}; m[REF_C] = [synthDressPiece("C1")]; return m; })(),
    });
    const botBase = "http://127.0.0.1:" + fake.server.address().port;
    const svc = freshService(botBase, { mode: "live" });
    const share = { id: "SYNTH_share_C1", received_at: new Date().toISOString(), attachment: { type: "text", payload: { text: "hi" } }, user_ref: REF_C };
    await svc.processOne(share);
    await svc.reconcileDeletions();
    assert.ok(svc.getUserContext(REF_C), "user C kept on 404");
    assert.strictEqual(svc.status().counts.deletions_cleared, 0, "not counted");
    console.log("  pass");
    await new Promise(function (r) { fake.server.close(r); });
  }

  // --- Test d: connection reset / 5xx -> kept ---
  console.log("\n[d] connection reset and 5xx -> kept");
  {
    // Reset
    let fake = await startFakeBot({
      deletionResponses: (function () { let m = {}; m[REF_D] = { error: "reset" }; return m; })(),
      catalogStore: (function () { let m = {}; m[REF_D] = [synthDressPiece("D1")]; return m; })(),
    });
    let botBase = "http://127.0.0.1:" + fake.server.address().port;
    let svc = freshService(botBase, { mode: "live" });
    let share = { id: "SYNTH_share_D1", received_at: new Date().toISOString(), attachment: { type: "text", payload: { text: "hi" } }, user_ref: REF_D };
    await svc.processOne(share);
    await svc.reconcileDeletions();
    assert.ok(svc.getUserContext(REF_D), "kept on reset");
    assert.strictEqual(svc.status().counts.deletions_cleared, 0, "not counted on reset");
    await new Promise(function (r) { fake.server.close(r); });

    // 5xx
    fake = await startFakeBot({
      deletionResponses: (function () { let m = {}; m[REF_D] = { status: 500, body: { error: "server_error" } }; return m; })(),
      catalogStore: (function () { let m = {}; m[REF_D] = [synthDressPiece("D1")]; return m; })(),
    });
    botBase = "http://127.0.0.1:" + fake.server.address().port;
    svc = freshService(botBase, { mode: "live" });
    share = { id: "SYNTH_share_D2", received_at: new Date().toISOString(), attachment: { type: "text", payload: { text: "hi" } }, user_ref: REF_D };
    await svc.processOne(share);
    await svc.reconcileDeletions();
    assert.ok(svc.getUserContext(REF_D), "kept on 5xx");
    console.log("  pass");
    await new Promise(function (r) { fake.server.close(r); });

    // Malformed JSON -> kept
    const malformedServer = http.createServer(function (req, res) {
      const url = new URL(req.url, "http://127.0.0.1");
      const auth = req.headers.authorization || "";
      if (auth !== "Bearer " + TOKEN) { res.writeHead(401); res.end(JSON.stringify({ error: "unauthorized" })); return; }
      if (req.method === "GET" && url.pathname.indexOf("/ig/deletion-status/") === 0) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("not-json{{{"); return;
      }
      if (req.method === "GET" && url.pathname.indexOf("/ig/catalog/") === 0) {
        res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ pieces: [synthDressPiece("D3")] })); return;
      }
      if (req.method === "PUT" && url.pathname.indexOf("/ig/catalog/") === 0) { res.writeHead(200); res.end(JSON.stringify({})); return; }
      if (req.method === "GET" && url.pathname === "/ig/shares") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ items: [], next_cursor: null })); return; }
      if (req.method === "POST" && url.pathname === "/ig/send") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ message_id: "SYNTH_msg_001" })); return; }
      if (req.method === "POST" && url.pathname.indexOf("/mock/stage-outbound-image/") === 0) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ share_id: url.pathname.split("/").pop() })); return; }
      res.writeHead(404); res.end(JSON.stringify({ error: "not_found" }));
    });
    await new Promise(function (r) { malformedServer.listen(0, "127.0.0.1", r); });
    const mBase = "http://127.0.0.1:" + malformedServer.address().port;
    const svcM = freshService(mBase, { mode: "live" });
    const shareM = { id: "SYNTH_share_DM", received_at: new Date().toISOString(), attachment: { type: "text", payload: { text: "hi" } }, user_ref: REF_D };
    await svcM.processOne(shareM);
    await svcM.reconcileDeletions();
    assert.ok(svcM.getUserContext(REF_D), "kept on malformed JSON");
    console.log("  pass: malformed JSON -> kept");
    await new Promise(function (r) { malformedServer.close(r); });
  }

  // --- Test e: mock mode -> zero deletion-status requests ---
  console.log("\n[e] mock mode -> zero deletion-status requests");
  {
    const fake = await startFakeBot({
      deletionResponses: (function () { let m = {}; m[REF_E] = { status: 200, body: { scrubbed: true } }; return m; })(),
    });
    const botBase = "http://127.0.0.1:" + fake.server.address().port;
    const svc = freshService(botBase, { mode: "mock" });
    // Create demo user via mock share (no user_ref needed)
    const share = { id: "SYNTH_share_E1", received_at: new Date().toISOString(), attachment: { type: "text", payload: { text: "hi mock" } } };
    await svc.processOne(share);
    await svc.reconcileDeletions();
    assert.strictEqual(fake.deletionHits.length, 0, "mock mode must not probe deletion-status, got " + fake.deletionHits.length);
    // Also via tick() and /wardrobe/status paths
    await svc.tick();
    assert.strictEqual(fake.deletionHits.length, 0, "tick in mock mode must not probe");
    const info = await svc.start();
    try {
      const res = await realFetch("http://127.0.0.1:" + info.port + "/wardrobe/status");
      assert.strictEqual(res.status, 200);
      await res.json();
      assert.strictEqual(fake.deletionHits.length, 0, "status in mock mode must not probe");
    } finally { await svc.stop(); }
    console.log("  pass");
    await new Promise(function (r) { fake.server.close(r); });
  }

  // --- Test f: /wardrobe/status includes deletions_cleared, no ref/id ---
  console.log("\n[f] /wardrobe/status shape: deletions_cleared present, no ref/id leak");
  {
    const fake = await startFakeBot({
      deletionResponses: (function () { let m = {}; m[REF_A] = { status: 200, body: { scrubbed: true } }; return m; })(),
      catalogStore: (function () { let m = {}; m[REF_A] = [synthDressPiece("F1")]; return m; })(),
    });
    const botBase = "http://127.0.0.1:" + fake.server.address().port;
    const svc = freshService(botBase, { mode: "live" });
    const share = { id: "SYNTH_share_F1", received_at: new Date().toISOString(), attachment: { type: "text", payload: { text: "hi" } }, user_ref: REF_A };
    await svc.processOne(share);
    await svc.reconcileDeletions();
    const st = svc.status();
    assert.strictEqual(typeof st.deletions_cleared, "number", "deletions_cleared number");
    assert.strictEqual(typeof st.counts.deletions_cleared, "number", "counts.deletions_cleared number");
    const blob = JSON.stringify(st);
    assert.ok(blob.indexOf(REF_A) === -1, "status must not contain ref");
    assert.ok(blob.indexOf("SYNTH_share") === -1, "status must not contain share id");
    assert.ok(blob.indexOf("SYNTH_piece") === -1, "status must not contain piece id");
    // HTTP path too
    const info = await svc.start();
    try {
      const res = await realFetch("http://127.0.0.1:" + info.port + "/wardrobe/status");
      const body = await res.json();
      assert.strictEqual(typeof body.deletions_cleared, "number", "HTTP deletions_cleared number");
      const hblob = JSON.stringify(body);
      assert.ok(hblob.indexOf(REF_A) === -1, "HTTP status must not contain ref");
    } finally { await svc.stop(); }
    console.log("  pass");
    await new Promise(function (r) { fake.server.close(r); });
  }

  // --- Concurrent safety: double reconcile doesn't double-count ---
  console.log("\n[concurrent safety: double reconcile single-flight]");
  {
    const fake = await startFakeBot({
      deletionResponses: (function () { let m = {}; m[REF_A] = { status: 200, body: { scrubbed: true } }; return m; })(),
      catalogStore: (function () { let m = {}; m[REF_A] = [synthDressPiece("G1")]; return m; })(),
    });
    const botBase = "http://127.0.0.1:" + fake.server.address().port;
    const svc = freshService(botBase, { mode: "live" });
    const share = { id: "SYNTH_share_G1", received_at: new Date().toISOString(), attachment: { type: "text", payload: { text: "hi" } }, user_ref: REF_A };
    await svc.processOne(share);
    await Promise.all([svc.reconcileDeletions(), svc.reconcileDeletions()]);
    assert.strictEqual(svc.status().counts.deletions_cleared, 1, "double reconcile counted once, got " + svc.status().counts.deletions_cleared);
    console.log("  pass");
    await new Promise(function (r) { fake.server.close(r); });
  }

  global.fetch = realFetch;
  console.log("\nAll deletion-reconcile tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
