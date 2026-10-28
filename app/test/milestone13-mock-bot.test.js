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
let store;
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
  ({ server, store } = await startServer({ port: 0, token: TOKEN, allowOrigin: ORIGIN }));
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

  // --- Task 2: shares paging + media routes ---------------------------------
  function seedShare(i, type) {
    const id = `SYNTH_mid_${String(i).padStart(3, "0")}`;
    const media_id = `SYNTH_media_${String(i).padStart(3, "0")}`;
    const attachment = type === "ig_post"
      ? { type: "ig_post", payload: { ig_post_media_id: `SYNTH_1000000000000${i}`, title: `SYNTH post ${i}`, url: "https://example.invalid/synth-media/SYNTH_live.jpg" } }
      : { type: "image", payload: { url: "https://example.invalid/synth-media/SYNTH_live.png" } };
    store.shares.push({
      id,
      received_at: `2026-10-28T12:0${i}:00Z`,
      attachment,
      media_id,
      media_available: true,
    });
    store.media.set(media_id, { bytes: PNG_1PX, contentType: "image/png" });
    return { id, media_id };
  }
  const s1 = seedShare(1, "image");
  const s2 = seedShare(2, "ig_post");
  const s3 = seedShare(3, "image");

  {
    const res = await fetch(`${base}/ig/shares`, { headers: authHeaders() });
    const body = await res.json();
    check("task2: GET /ig/shares lists seeded items with cursor",
      res.status === 200 && body.items.length === 3 && body.next_cursor === "3",
      JSON.stringify(body).slice(0, 160));
    const item = body.items[0];
    check("task2: share item has the contract shape",
      item.id === s1.id && typeof item.received_at === "string" &&
      item.attachment && item.media_id === s1.media_id && item.media_available === true,
      JSON.stringify(item).slice(0, 200));
  }
  {
    const p1 = await (await fetch(`${base}/ig/shares?limit=2`, { headers: authHeaders() })).json();
    check("task2: limit=2 returns first page + next_cursor 2",
      p1.items.length === 2 && p1.next_cursor === "2" && p1.items[0].id === s1.id,
      JSON.stringify(p1).slice(0, 160));
    const res2 = await fetch(`${base}/ig/shares?since=2&limit=2`, { headers: authHeaders() });
    const p2 = await res2.json();
    check("task2: since=2 walks to the last item",
      res2.status === 200 && p2.items.length === 1 && p2.items[0].id === s3.id && p2.next_cursor === "3",
      JSON.stringify(p2).slice(0, 160));
    const res3 = await fetch(`${base}/ig/shares?since=3`, { headers: authHeaders() });
    const p3 = await res3.json();
    check("task2: since=cursor returns empty page, same cursor echoed",
      res3.status === 200 && p3.items.length === 0 && p3.next_cursor === "3",
      JSON.stringify(p3).slice(0, 160));
  }
  for (const bad of ["limit=0", "limit=51", "limit=abc", "since=abc", "since=-1", "since=1.5"]) {
    const res = await fetch(`${base}/ig/shares?${bad}`, { headers: authHeaders() });
    check(`task2: GET /ig/shares?${bad} -> 400`, res.status === 400, `got ${res.status}`);
  }
  {
    const res = await fetch(`${base}/ig/media/${s1.media_id}`, { headers: authHeaders() });
    check("task2: GET /ig/media/<id> -> 200 image bytes",
      res.status === 200 && (res.headers.get("content-type") || "").includes("image/png"),
      `${res.status} ${res.headers.get("content-type")}`);
    check("task2: media route sends Cache-Control: private, no-store",
      (res.headers.get("cache-control") || "") === "private, no-store",
      res.headers.get("cache-control"));
    const buf = Buffer.from(await res.arrayBuffer());
    check("task2: media bytes round-trip intact", buf.equals(PNG_1PX), `got ${buf.length} bytes`);
    const missing = await fetch(`${base}/ig/media/SYNTH_media_missing`, { headers: authHeaders() });
    check("task2: GET /ig/media/<unknown> -> 404", missing.status === 404, `got ${missing.status}`);
  }

  // --- Task 3: auth + CORS parity -------------------------------------------
  const CHALLENGE = 'Bearer realm="ig"';
  {
    const noAuth = await fetch(`${base}/ig/shares`);
    check("task3: missing token -> 401 + WWW-Authenticate challenge",
      noAuth.status === 401 && noAuth.headers.get("www-authenticate") === CHALLENGE,
      `${noAuth.status} ${noAuth.headers.get("www-authenticate")}`);
    const wrong = await fetch(`${base}/ig/shares`, { headers: { Authorization: "Bearer SYNTH_wrong_token" } });
    check("task3: wrong token -> 401 + same challenge",
      wrong.status === 401 && wrong.headers.get("www-authenticate") === CHALLENGE,
      `${wrong.status} ${wrong.headers.get("www-authenticate")}`);
    const ok = await fetch(`${base}/ig/shares`, { headers: authHeaders() });
    check("task3: correct token passes auth", ok.status === 200, `got ${ok.status}`);
    const mediaNoAuth = await fetch(`${base}/ig/media/${s1.media_id}`);
    check("task3: media route also requires auth", mediaNoAuth.status === 401, `got ${mediaNoAuth.status}`);
  }
  {
    const same = await fetch(`${base}/ig/shares`, { headers: { ...authHeaders(), Origin: ORIGIN } });
    check("task3: allowed origin passes + ACAO echoed",
      same.status === 200 && same.headers.get("access-control-allow-origin") === ORIGIN,
      `${same.status} ${same.headers.get("access-control-allow-origin")}`);
    const evil = await fetch(`${base}/ig/shares`, { headers: { ...authHeaders(), Origin: "https://evil.example.invalid" } });
    check("task3: other origins -> 403", evil.status === 403, `got ${evil.status}`);
  }
  async function preflight(path, method) {
    return fetch(`${base}${path}`, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "Authorization, Content-Type",
      },
    });
  }
  {
    const send = await preflight("/ig/send", "POST");
    const allowMethods = send.headers.get("access-control-allow-methods") || "";
    const allowHeaders = (send.headers.get("access-control-allow-headers") || "").toLowerCase();
    check("task3: preflight on /ig/send -> 204 allowing POST + auth headers",
      send.status === 204 && allowMethods.includes("POST") &&
      allowHeaders.includes("authorization") && allowHeaders.includes("content-type"),
      `${send.status} methods=${allowMethods} headers=${allowHeaders}`);
    const del = await preflight(`/ig/media/${s1.media_id}`, "DELETE");
    check("task3: preflight allows DELETE",
      del.status === 204 && (del.headers.get("access-control-allow-methods") || "").includes("DELETE"),
      `${del.status}`);
    const evilPre = await fetch(`${base}/ig/send`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example.invalid", "Access-Control-Request-Method": "POST" },
    });
    check("task3: preflight from other origin -> 403", evilPre.status === 403, `got ${evilPre.status}`);
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
