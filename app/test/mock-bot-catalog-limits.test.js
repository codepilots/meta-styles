"use strict";
/* meta-styles — mock-bot catalog PUT body cap (12 MB) vs send cap (1 MB).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves, against mock-ig-bot/server.js started in-process on an
 * ephemeral port with an isolated temp data dir (same harness style as
 * milestone19h-catalog-persistence.test.js), with synthetic fixtures only:
 *  (a) a ~2 MB catalog PUT succeeds (204) and round-trips via GET;
 *  (b) a >12 MB catalog PUT is rejected with 413;
 *  (c) POST /ig/send still rejects a >1 MB body with 413 (the send cap
 *      is unchanged — only the catalog route moved to 12 MB, mirroring
 *      the real bot's catalog PUT ceiling per docs/decisions.md row 11).
 *
 * Run: node app/test/mock-bot-catalog-limits.test.js
 */
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const assert = require("assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { startServer } = require("../../mock-ig-bot/server.js");

const TOKEN = "SYNTH_mock_token";
const ORIGIN = "http://localhost:8000";
const SECRET = "SYNTH_test_secret_limits (non-secret test value)";
const REF = "u_" + "e".repeat(32);

function authHeaders() {
  return { Authorization: "Bearer " + TOKEN };
}

async function run() {
  console.log("mock-bot-catalog-limits.test.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-catalog-limits-"));
  const { server } = await startServer({
    port: 0, token: TOKEN, allowOrigin: ORIGIN, catalogDir: dir, catalogSecret: SECRET,
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // --- (a) ~2 MB catalog PUT succeeds + round-trips ---
    console.log("\n[(a) 2 MB catalog PUT -> 204, GET round-trip]");
    {
      const pad = "x".repeat(2 * 1024 * 1024);
      const pieces = [{ piece_id: "SYNTH_piece_lim_2mb", pad: pad }];
      const body = JSON.stringify(pieces);
      assert.ok(body.length > 2 * 1024 * 1024 && body.length < 12 * 1024 * 1024,
        "fixture is ~2 MB, got " + body.length);
      const res = await fetch(`${base}/ig/catalog/${REF}`, {
        method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: body,
      });
      assert.strictEqual(res.status, 204, "~2 MB catalog PUT succeeds, got " + res.status);
      const got = await (await fetch(`${base}/ig/catalog/${REF}`, { headers: authHeaders() })).json();
      assert.ok(Array.isArray(got) && got.length === 1 && got[0].piece_id === "SYNTH_piece_lim_2mb",
        "2 MB payload stored and readable back");
      console.log(`  pass: PUT 204, GET round-trip (${body.length} bytes)`);
    }

    // --- (b) >12 MB catalog PUT -> 413 ---
    console.log("\n[(b) 13 MB catalog PUT -> 413]");
    {
      const pad = "y".repeat(13 * 1024 * 1024);
      const body = JSON.stringify([{ piece_id: "SYNTH_piece_lim_big", pad: pad }]);
      assert.ok(body.length > 12 * 1024 * 1024, "fixture exceeds 12 MB, got " + body.length);
      const res = await fetch(`${base}/ig/catalog/${REF}`, {
        method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: body,
      });
      assert.strictEqual(res.status, 413, ">12 MB catalog PUT rejected, got " + res.status);
      const errBody = await res.json();
      assert.strictEqual(errBody.error, "body_too_large", "honest error, got " + JSON.stringify(errBody));
      console.log("  pass: PUT 413 body_too_large");
    }

    // --- (c) /ig/send still rejects >1 MB ---
    console.log("\n[(c) 2 MB /ig/send -> 413 (send cap unchanged)]");
    {
      const pad = "z".repeat(2 * 1024 * 1024);
      const body = JSON.stringify({ share_id: "SYNTH_mid_lim", text: "hi", idempotency_key: "SYNTH_idem_lim", confirm: true, pad: pad });
      assert.ok(body.length > 1024 * 1024, "send fixture exceeds 1 MB, got " + body.length);
      const res = await fetch(`${base}/ig/send`, {
        method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: body,
      });
      assert.strictEqual(res.status, 413, ">1 MB send still rejected, got " + res.status);
      console.log("  pass: /ig/send 413 for >1 MB (send cap unchanged)");
    }
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log("\nAll mock-bot catalog-limit tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
