"use strict";
/* meta-styles Milestone 13 — mock IG bot contract tests (TDD, tasks 1–7 + 10).
 *
 * Spins up mock-ig-bot/server.js in-process on an ephemeral port (same code
 * path as the standalone `node mock-ig-bot/server.js` process) and asserts
 * the replicated contract from docs/instagram-bot-api.md ("As implemented")
 * and docs/instagram-bot-send-api.md ("As implemented"/"Applied") route by
 * route, plus the mock-local /mock/... operator routes.
 *
 * All ids/tokens/bytes below are synthetic (SYNTH_ prefix, example.invalid
 * URLs, locally generated PNGs) — never real Instagram data.
 *
 * Run: node app/test/milestone13-mock-bot.test.js
 */

const assert = require("node:assert/strict");

// Sandbox sets an HTTP proxy; the mock is local-only, so bypass it here.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const { startServer } = require("../../mock-ig-bot/server.js");

const TOKEN = "SYNTH_mock_token";
const ORIGIN = "http://localhost:8000";

let server;
let base;
let failures = 0;
let passes = 0;

function check(name, cond, detail) {
  if (cond) {
    passes++;
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

function authHeaders(extra) {
  return { Authorization: "Bearer " + TOKEN, ...(extra || {}) };
}

// 1x1 transparent PNG, generated locally — synthetic fixture bytes.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function main() {
  ({ server } = await startServer({ port: 0, token: TOKEN, allowOrigin: ORIGIN }));
  const addr = server.address();
  base = `http://127.0.0.1:${addr.port}`;

  // --- Task 1: empty store ------------------------------------------------
  {
    const res = await fetch(`${base}/ig/shares`, { headers: authHeaders() });
    check("task1: GET /ig/shares -> 200 on empty store", res.status === 200, `got ${res.status}`);
    const body = await res.json();
    check("task1: empty store -> {items: [], next_cursor: null}",
      Array.isArray(body.items) && body.items.length === 0 && body.next_cursor === null,
      JSON.stringify(body).slice(0, 200));
    check("task1: JSON routes send Cache-Control: no-store",
      (res.headers.get("cache-control") || "").includes("no-store"),
      res.headers.get("cache-control"));
  }

  console.log(`\n${passes} passed, ${failures} failed.`);
  server.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  if (server) server.close();
  process.exit(1);
});
