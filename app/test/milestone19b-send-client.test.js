"use strict";
/* meta-styles Milestone 19b — send-client module tests.
 *
 * Second step of the M19 chat-first pivot (docs/milestone-19-chat-first-pivot.md
 * §7 task 2): the new app/send-client.js must issue byte-identical
 * POST /ig/send requests per turn against the MOCK bot only, with
 * per-turn fresh idempotency keys, replay-on-retry, 409/422/401
 * surfaced in-thread (never swallowed), and an is_echo skip on poll.
 * Mirrors the M13 send task batch (app/test/milestone13-mock-bot.test.js
 * tasks 5/5b) through the new module instead of raw fetch.
 *
 * All ids/keys/text below are synthetic (SYNTH_ prefix, example.invalid
 * URLs) — never real Instagram data.
 *
 * Run: node app/test/milestone19b-send-client.test.js
 */

const assert = require("node:assert/strict");

// Sandbox sets an HTTP proxy; the mock is local-only, so bypass it here.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const { startServer } = require("../../mock-ig-bot/server.js");
const SendClient = require("../send-client.js");

const TOKEN = "SYNTH_mock_token";

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

function freshShare(id) {
  const share = {
    id,
    received_at: new Date().toISOString(),
    attachment: { type: "image", payload: { url: "https://example.invalid/synth-media/SYNTH_19b.png" } },
    media_id: "SYNTH_media_19b_" + id,
    media_available: true,
  };
  store.shares.push(share);
  return share;
}

async function main() {
  check("19b: send-client module exposes the M19b contract",
    !!(SendClient && typeof SendClient.createSendClient === "function" &&
      typeof SendClient.newKey === "function" &&
      typeof SendClient.buildPayload === "function" &&
      typeof SendClient.isEcho === "function" &&
      typeof SendClient.shouldProcess === "function" &&
      typeof SendClient.describeForThread === "function"));

  // --- Payload shape: byte-identical to the M13 operator doSend ----------
  {
    const p = SendClient.buildPayload("SYNTH_mid_shape_001", "SYNTH hello", "SYNTH_key_shape_001", false);
    check("19b: buildPayload carries the operator doSend keys in order",
      JSON.stringify(p) === JSON.stringify({
        share_id: "SYNTH_mid_shape_001",
        text: "SYNTH hello",
        idempotency_key: "SYNTH_key_shape_001",
        confirm: true,
        image: false,
      }), JSON.stringify(p));
    check("19b: confirm is exactly true per turn (never omitted/false)",
      p.confirm === true);
    const pImg = SendClient.buildPayload("SYNTH_mid_shape_001", "SYNTH hi", "SYNTH_key_shape_002", true);
    check("19b: image flag passes through as an explicit bool",
      pImg.image === true && p.image === false);
  }

  // --- Fresh keys: unique per turn ----------------------------------------
  {
    const k1 = SendClient.newKey();
    const k2 = SendClient.newKey();
    check("19b: newKey mints a fresh SYNTH_ key per turn",
      typeof k1 === "string" && k1.indexOf("SYNTH_") === 0 &&
      typeof k2 === "string" && k2.indexOf("SYNTH_") === 0 && k1 !== k2,
      `${k1} vs ${k2}`);
  }

  ({ server, store } = await startServer({ port: 0, token: TOKEN }));
  base = `http://127.0.0.1:${server.address().port}`;
  const outboundCount = () => store.outbound.length;

  const shareA = freshShare("SYNTH_mid_19b_A");
  const client = SendClient.createSendClient({ base, token: TOKEN });

  // --- One send per turn: fresh key, 200, confirm:true --------------------
  let first;
  {
    const before = outboundCount();
    first = await client.sendTurn({ shareId: shareA.id, text: "SYNTH first turn copy" });
    check("19b: sendTurn -> 200 {message_id, recipient_ref} with confirm:true",
      first.ok === true && first.status === 200 &&
      typeof first.body.message_id === "string" &&
      first.body.recipient_ref === shareA.id &&
      outboundCount() === before + 1,
      `${first.status} ${JSON.stringify(first.body).slice(0, 120)}`);
  }

  // --- Fresh key per turn: second turn uses a different key ---------------
  let second;
  {
    const before = outboundCount();
    second = await client.sendTurn({ shareId: shareA.id, text: "SYNTH second turn copy" });
    check("19b: second turn mints a fresh key (no key reuse across turns)",
      second.ok === true && second.key !== first.key &&
      second.body.message_id !== first.body.message_id &&
      outboundCount() === before + 1,
      `keys ${String(first.key).slice(0, 24)} vs ${String(second.key).slice(0, 24)}`);
  }

  // --- Replay-on-retry: same key returns the STORED message_id ------------
  {
    const before = outboundCount();
    const replay = await client.replayLast();
    check("19b: replay (same idempotency key) returns the stored message_id, nothing re-sent",
      replay.ok === true && replay.replayed === true &&
      replay.body.message_id === second.body.message_id &&
      outboundCount() === before,
      `${replay.status} ${JSON.stringify(replay.body).slice(0, 120)}`);
  }

  // --- Duplicate-text re-send with a NEW key -> 409, surfaced -------------
  {
    const before = outboundCount();
    const dup = await client.sendTurn({ shareId: shareA.id, text: "SYNTH  second  turn\ncopy " });
    check("19b: duplicate-text re-send with a fresh key -> 409 duplicate_send (surfaced, not swallowed)",
      dup.ok === false && dup.status === 409 && dup.error === "duplicate_send" &&
      outboundCount() === before,
      `${dup.status} ${JSON.stringify(dup.body).slice(0, 120)}`);
    check("19b: 409 duplicate text surfaced in-thread by name",
      /409 duplicate_send/.test(client.describeForThread(dup)),
      client.describeForThread(dup));
  }

  // --- Same key + different payload -> 409 idempotency_key_reused ---------
  {
    const before = outboundCount();
    const raw = await fetch(`${base}/ig/send`, {
      method: "POST",
      headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({
        share_id: shareA.id, text: "SYNTH different payload",
        idempotency_key: first.key, confirm: true, image: false,
      }),
    });
    const body = await raw.json();
    check("19b: same key + different payload -> 409 idempotency_key_reused",
      raw.status === 409 && body.error === "idempotency_key_reused" &&
      outboundCount() === before,
      `${raw.status} ${JSON.stringify(body).slice(0, 120)}`);
    const described = client.describeForThread({ ok: false, status: 409, body, error: body.error });
    check("19b: 409 key-reuse surfaced in-thread by name",
      /409 idempotency_key_reused/.test(described), described);
  }

  // --- Stale share -> 422, surfaced ---------------------------------------
  {
    const staleId = "SYNTH_mid_19b_stale";
    store.shares.push({
      id: staleId,
      received_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
      attachment: { type: "image", payload: { url: "https://example.invalid/synth-media/SYNTH_19b_stale.png" } },
      media_id: "SYNTH_media_19b_stale",
      media_available: true,
    });
    const before = outboundCount();
    const stale = await client.sendTurn({ shareId: staleId, text: "SYNTH too late" });
    check("19b: stale share -> 422 reply_window_expired (surfaced, nothing sent)",
      stale.ok === false && stale.status === 422 &&
      stale.error === "reply_window_expired" && stale.body.share_id === staleId &&
      outboundCount() === before,
      `${stale.status} ${JSON.stringify(stale.body).slice(0, 120)}`);
    check("19b: 422 surfaced in-thread by name",
      /422 reply_window_expired/.test(client.describeForThread(stale)),
      client.describeForThread(stale));
  }

  // --- Bad token -> 401, surfaced -----------------------------------------
  {
    const badClient = SendClient.createSendClient({ base, token: "SYNTH_wrong_token" });
    const denied = await badClient.sendTurn({ shareId: shareA.id, text: "SYNTH no auth" });
    check("19b: wrong token -> 401 unauthorized (surfaced, not swallowed)",
      denied.ok === false && denied.status === 401 && denied.error === "unauthorized",
      `${denied.status} ${JSON.stringify(denied.body).slice(0, 120)}`);
    check("19b: 401 surfaced in-thread by name",
      /401 unauthorized/.test(badClient.describeForThread(denied)),
      badClient.describeForThread(denied));
  }

  // --- is_echo skip on poll ------------------------------------------------
  {
    const echo = { id: "SYNTH_mid_echo_001", is_echo: true, attachment: { type: "text", payload: { text: "SYNTH own send" } } };
    check("19b: is_echo item detected (bot's own echoed-back message)",
      SendClient.isEcho(echo) === true);
    check("19b: is_echo item skipped on poll (not re-processed/re-displayed)",
      SendClient.shouldProcess(echo) === false);
    const inbound = { id: "SYNTH_mid_in_001", attachment: { type: "text", payload: { text: "SYNTH no bag" } } };
    check("19b: genuine inbound item still processed",
      SendClient.isEcho(inbound) === false && SendClient.shouldProcess(inbound) === true);
    check("19b: is_echo helpers never throw on malformed input",
      SendClient.isEcho(null) === false && SendClient.shouldProcess(null) === true &&
      SendClient.isEcho([]) === false && SendClient.shouldProcess("SYNTH x") === true);
  }

  // --- Success path renders in-thread --------------------------------------
  check("19b: 200 result renders its message_id in-thread",
    /Sent: message_id SYNTH_/.test(client.describeForThread(first)),
    client.describeForThread(first));

  console.log(`\n${passes} passed, ${failures} failed.`);
  server.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  if (server) server.close();
  process.exit(1);
});
