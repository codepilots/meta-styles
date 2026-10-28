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

  // --- Task 4: collect-then-delete --------------------------------------------
  {
    // GET alone deletes nothing: still listed available after a fetch.
    await fetch(`${base}/ig/media/${s2.media_id}`, { headers: authHeaders() });
    const listed = await (await fetch(`${base}/ig/shares`, { headers: authHeaders() })).json();
    check("task4: GET /ig/media deletes nothing (still media_available:true)",
      listed.items.find((i) => i.id === s2.id).media_available === true);
    const del = await fetch(`${base}/ig/media/${s2.media_id}`, { method: "DELETE", headers: authHeaders() });
    check("task4: DELETE /ig/media/<id> -> 204", del.status === 204, `got ${del.status}`);
    const gone = await fetch(`${base}/ig/media/${s2.media_id}`, { headers: authHeaders() });
    check("task4: bytes are gone after DELETE (GET -> 404)", gone.status === 404, `got ${gone.status}`);
    const relisted = await (await fetch(`${base}/ig/shares`, { headers: authHeaders() })).json();
    check("task4: item flips to media_available:false after DELETE",
      relisted.items.find((i) => i.id === s2.id).media_available === false);
    const unknown = await fetch(`${base}/ig/media/SYNTH_media_missing`, { method: "DELETE", headers: authHeaders() });
    check("task4: DELETE unknown id -> 404", unknown.status === 404, `got ${unknown.status}`);
    const noAuth = await fetch(`${base}/ig/media/${s1.media_id}`, { method: "DELETE" });
    check("task4: DELETE requires auth", noAuth.status === 401, `got ${noAuth.status}`);
  }

  // --- Task 5a: send route validation -------------------------------------------
  async function postSend(payload, key) {
    return fetch(`${base}/ig/send`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
  }
  function outboundCount() { return store.outbound.length; }
  const FRESH_SHARE = s1.id; // received_at 2026-10-28T12:01 — tests run same week? no: use fresh below
  {
    // NOTE: seeded shares carry fixed 2026-10-28 timestamps, so the 24h
    // window tests below use freshly injected shares instead (see task 5b).
    const basePayload = { share_id: "SYNTH_mid_001", text: "SYNTH hello", idempotency_key: "SYNTH_key_val_001", confirm: true };
    for (const [label, tweak] of [
      ["missing confirm", { confirm: undefined }],
      ["confirm:false", { confirm: false }],
      ["confirm string", { confirm: "true" }],
      ["missing share_id", { share_id: undefined }],
      ["missing text", { text: undefined }],
      ["missing key", { idempotency_key: undefined }],
      ["empty text", { text: "" }],
    ]) {
      const p = { ...basePayload };
      if (tweak.confirm === undefined && "confirm" in tweak) delete p.confirm;
      else if (tweak.share_id === undefined && "share_id" in tweak) delete p.share_id;
      else if (tweak.text === undefined && "text" in tweak) delete p.text;
      else if (tweak.idempotency_key === undefined && "idempotency_key" in tweak) delete p.idempotency_key;
      else Object.assign(p, tweak);
      const before = outboundCount();
      const res = await postSend(p);
      check(`task5: send ${label} -> 400, nothing sent`,
        res.status === 400 && outboundCount() === before, `got ${res.status}`);
    }
    const unknown = await postSend({ share_id: "SYNTH_mid_nope", text: "SYNTH hi", idempotency_key: "SYNTH_key_val_002", confirm: true });
    check("task5: send unknown share_id -> 404", unknown.status === 404, `got ${unknown.status}`);
    const noImage = await postSend({ share_id: "SYNTH_mid_001", text: "SYNTH hi", idempotency_key: "SYNTH_key_val_003", confirm: true, image: true });
    check("task5: send image:true with no staged file -> 400", noImage.status === 400, `got ${noImage.status}`);
    const noAuth = await fetch(`${base}/ig/send`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ share_id: "SYNTH_mid_001", text: "x", idempotency_key: "k", confirm: true }),
    });
    check("task5: send requires auth", noAuth.status === 401, `got ${noAuth.status}`);
    const big = await postSend({ share_id: "SYNTH_mid_001", text: "SYNTH_" + "x".repeat(1024 * 1024), idempotency_key: "SYNTH_key_val_004", confirm: true });
    check("task5: send body > 1MB -> 413", big.status === 413, `got ${big.status}`);
    const malformed = await postSend("{not json");
    check("task5: send malformed JSON -> 400", malformed.status === 400, `got ${malformed.status}`);
  }
  // Fresh share (wall-clock now) so window checks stay green any day.
  const freshId = "SYNTH_mid_fresh_001";
  const freshMedia = "SYNTH_media_fresh_001";
  store.shares.push({
    id: freshId,
    received_at: new Date().toISOString(),
    attachment: { type: "image", payload: { url: "https://example.invalid/synth-media/SYNTH_fresh.png" } },
    media_id: freshMedia,
    media_available: true,
  });
  store.media.set(freshMedia, { bytes: PNG_1PX, contentType: "image/png" });
  {
    const before = outboundCount();
    const res = await postSend({ share_id: freshId, text: "SYNTH look card copy", idempotency_key: "SYNTH_key_ok_001", confirm: true });
    const body = await res.json();
    check("task5: valid send -> 200 {message_id, recipient_ref}",
      res.status === 200 && typeof body.message_id === "string" && body.recipient_ref === freshId &&
      !("image_message_id" in body),
      `${res.status} ${JSON.stringify(body).slice(0, 160)}`);
    check("task5: valid send appended to the outbound log",
      outboundCount() === before + 1 && store.outbound[store.outbound.length - 1].share_id === freshId,
      `outbound=${outboundCount()} before=${before}`);
    // Image path: stage bytes directly, then send with image:true.
    store.outboundStaged.set(freshId, { bytes: PNG_1PX, contentType: "image/png" });
    const imgRes = await postSend({ share_id: freshId, text: "SYNTH card + photo", idempotency_key: "SYNTH_key_ok_002", confirm: true, image: true });
    const imgBody = await imgRes.json();
    check("task5: image send -> 200 + image_message_id",
      imgRes.status === 200 && typeof imgBody.image_message_id === "string",
      `${imgRes.status} ${JSON.stringify(imgBody).slice(0, 160)}`);
  }

  // --- Task 5b: idempotency trio, 24h window, serialised sends ------------------
  {
    // Same key + same payload replays the stored result; nothing re-sent.
    const before = outboundCount();
    const replay = await postSend({ share_id: freshId, text: "SYNTH look card copy", idempotency_key: "SYNTH_key_ok_001", confirm: true });
    const replayBody = await replay.json();
    const replay2Body = await (await postSend({ share_id: freshId, text: "SYNTH look card copy", idempotency_key: "SYNTH_key_ok_001", confirm: true })).json();
    check("task5: same key + same payload replays stored result",
      replay.status === 200 && typeof replayBody.message_id === "string" &&
      replayBody.message_id === replay2Body.message_id && outboundCount() === before,
      `${replay.status} ${JSON.stringify(replayBody).slice(0, 120)}`);
    // Same key + different payload -> 409 idempotency_key_reused.
    const reused = await postSend({ share_id: freshId, text: "SYNTH different text", idempotency_key: "SYNTH_key_ok_001", confirm: true });
    const reusedBody = await reused.json();
    check("task5: same key + different payload -> 409 idempotency_key_reused",
      reused.status === 409 && reusedBody.error === "idempotency_key_reused" && outboundCount() === before,
      `${reused.status} ${JSON.stringify(reusedBody).slice(0, 120)}`);
    // Same share + same whitespace-normalised text, different key -> 409 duplicate.
    const dup = await postSend({ share_id: freshId, text: "SYNTH  look  card\ncopy ", idempotency_key: "SYNTH_key_dup_001", confirm: true });
    const dupBody = await dup.json();
    check("task5: same share + same normalised text, new key -> 409 duplicate_send",
      dup.status === 409 && dupBody.error === "duplicate_send" && outboundCount() === before,
      `${dup.status} ${JSON.stringify(dupBody).slice(0, 120)}`);
    // Same share + genuinely different text, new key -> 200.
    const fresh2 = await postSend({ share_id: freshId, text: "SYNTH second card", idempotency_key: "SYNTH_key_ok_003", confirm: true });
    check("task5: same share + different text, new key -> 200",
      fresh2.status === 200 && outboundCount() === before + 1, `got ${fresh2.status}`);
    // Failed attempts are not stored: a 400 under key K, then a valid send
    // under the same key K, must succeed (not 409 key-reused).
    const badFirst = await postSend({ share_id: freshId, text: "SYNTH retry me", idempotency_key: "SYNTH_key_retry_001", confirm: false });
    const goodRetry = await postSend({ share_id: freshId, text: "SYNTH retry me", idempotency_key: "SYNTH_key_retry_001", confirm: true });
    check("task5: error attempts are not stored (retry same key -> 200)",
      badFirst.status === 400 && goodRetry.status === 200, `${badFirst.status}/${goodRetry.status}`);
  }
  {
    // Stale share (older than 24h) -> 422 with the share id, nothing sent.
    const staleId = "SYNTH_mid_stale_001";
    store.shares.push({
      id: staleId,
      received_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
      attachment: { type: "image", payload: { url: "https://example.invalid/synth-media/SYNTH_stale.png" } },
      media_id: "SYNTH_media_stale_001",
      media_available: true,
    });
    const before = outboundCount();
    const res = await postSend({ share_id: staleId, text: "SYNTH too late", idempotency_key: "SYNTH_key_stale_001", confirm: true });
    const body = await res.json();
    check("task5: stale share -> 422 reply_window_expired + share_id",
      res.status === 422 && body.error === "reply_window_expired" && body.share_id === staleId &&
      outboundCount() === before,
      `${res.status} ${JSON.stringify(body).slice(0, 120)}`);
  }
  {
    // Serialised sends: three concurrent sends each land exactly once.
    const before = outboundCount();
    const results = await Promise.all([1, 2, 3].map((n) =>
      postSend({ share_id: freshId, text: `SYNTH burst ${n}`, idempotency_key: `SYNTH_key_burst_00${n}`, confirm: true })
    ));
    const bodies = await Promise.all(results.map((r) => r.json()));
    const ids = bodies.map((b) => b.message_id);
    check("task5: concurrent sends all succeed with distinct message_ids",
      results.every((r) => r.status === 200) && new Set(ids).size === 3 &&
      outboundCount() === before + 3,
      `${results.map((r) => r.status).join(",")} ids=${ids.join(",")}`);
  }

  // --- Task 6: outbound-media token route ---------------------------------------
  {
    // The round-A image send minted exactly one token; read it white-box.
    const tokens = [...store.outboundTokens.keys()];
    check("task6: image send minted an outbound token", tokens.length === 1, `got ${tokens.length}`);
    const token = tokens[0];
    // No Authorization header on purpose: the token IS the credential.
    const first = await fetch(`${base}/ig/outbound-media/${token}`);
    check("task6: token fetch -> 200 image bytes, no auth needed",
      first.status === 200 && (first.headers.get("content-type") || "").includes("image/png"),
      `${first.status} ${first.headers.get("content-type")}`);
    check("task6: token bytes match the staged image",
      Buffer.from(await first.arrayBuffer()).equals(PNG_1PX));
    const second = await fetch(`${base}/ig/outbound-media/${token}`);
    check("task6: token is single-use (second fetch -> bare 404)",
      second.status === 404 && (await second.text()) === "",
      `${second.status}`);
    const junk = await fetch(`${base}/ig/outbound-media/SYNTH_outbound_999`);
    check("task6: unknown token -> bare 404",
      junk.status === 404 && (await junk.text()) === "", `${junk.status}`);
    store.outboundTokens.set("SYNTH_outbound_expired", {
      share_id: freshId, bytes: PNG_1PX, contentType: "image/png",
      expiresAt: Date.now() - 1000, used: false,
    });
    const expired = await fetch(`${base}/ig/outbound-media/SYNTH_outbound_expired`);
    check("task6: expired token -> 404", expired.status === 404, `got ${expired.status}`);
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
