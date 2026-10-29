"use strict";
/* meta-styles Milestone 19b — NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Send-client module for the chat-first turn loop
 * (docs/milestone-19-chat-first-pivot.md §7 task 2, §4 Gap 2). One
 * `POST /ig/send` per assistant turn against the MOCK bot only
 * (default http://127.0.0.1:8904) — never a real Instagram endpoint.
 * The request shape is byte-identical to the M13 operator panel's
 * `doSend` in app/mock-dm.html (lines 342-352):
 *   {share_id, text, idempotency_key, confirm:true, image:bool}
 * with `Authorization: Bearer <token>`.
 *
 * Rules (mirroring mock-ig-bot/server.js `doSend`):
 *   - per-turn fresh `idempotency_key` (SYNTH_-prefixed, unique per call);
 *   - retries are REPLAYS (same key + same payload -> stored `message_id`),
 *     never rewrites (a new key + same text -> 409 `duplicate_send`);
 *   - `confirm:true` on every send; 409/422/401 are returned, never
 *     swallowed, with `describeForThread()` rendering them in-thread;
 *   - `is_echo` items are skipped on poll (the bot's own echoed-back
 *     message is never re-processed or re-displayed).
 *
 * All ids/keys/text in tests are synthetic (SYNTH_ prefix,
 * example.invalid URLs) — never real Instagram data.
 */

(function (root) {
  var SEND_BASE = "http://127.0.0.1:8904";

  var keyCounter = 0;

  // Fresh idempotency key per deliberate turn. SYNTH_-prefixed like the
  // operator panel's newKey(); counter + timestamp + random so two turns
  // can never share a key, even within the same millisecond.
  function newKey() {
    keyCounter += 1;
    var rand = "";
    try {
      if (root.crypto && typeof root.crypto.randomUUID === "function") {
        return "SYNTH_" + root.crypto.randomUUID();
      }
      if (root.crypto && typeof root.crypto.getRandomValues === "function") {
        rand = String(root.crypto.getRandomValues(new Uint32Array(1))[0]);
      } else {
        rand = String(Math.floor(Math.random() * 1e9));
      }
    } catch (err) {
      rand = String(Math.floor(Math.random() * 1e9));
    }
    return "SYNTH_key_" + Date.now() + "_" + keyCounter + "_" + rand;
  }

  // Byte-identical payload to mock-dm.html doSend(): the same five keys
  // in the same order, `image` always an explicit bool.
  function buildPayload(shareId, text, key, withImage) {
    return {
      share_id: shareId,
      text: text,
      idempotency_key: key,
      confirm: true,
      image: withImage === true,
    };
  }

  // True when a polled item is the bot's own echoed-back send, which the
  // receiver must skip (send-api spec §"Echo handling"; roadmap M7 note).
  // Never throws.
  function isEcho(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    return item.is_echo === true;
  }

  // Poll filter: an item is worth processing only when it is not an echo.
  // Never throws.
  function shouldProcess(item) {
    return !isEcho(item);
  }

  // In-thread rendering of a send result — errors surface as honest turn
  // text (409/422/401 named), never swallowed. Never throws.
  function describeForThread(result) {
    if (!result || typeof result !== "object") return "Not sent: empty result.";
    if (result.ok) {
      var mid = (result.body && result.body.message_id) || "unknown";
      return "Sent: message_id " + mid + ".";
    }
    var err = result.error || ((result.body && result.body.error) || "send_failed");
    if (result.status === 409 && err === "duplicate_send") {
      return "Not sent (HTTP 409 duplicate_send): this turn's text already " +
        "went out — keeping the earlier send, not duplicating it.";
    }
    if (result.status === 409 && err === "idempotency_key_reused") {
      return "Not sent (HTTP 409 idempotency_key_reused): key already used " +
        "for different text — this looks like a bug, not a retry.";
    }
    if (result.status === 422) {
      return "Not sent (HTTP 422 reply_window_expired): the 24h reply " +
        "window for this conversation has closed.";
    }
    if (result.status === 401) {
      return "Not sent (HTTP 401 unauthorized): check the mock bot token.";
    }
    if (result.status === 0) {
      return "Not sent: mock bot unreachable — keeping this turn as an " +
        "unsent draft, never queued blindly.";
    }
    return "Not sent (HTTP " + result.status + " " + err + ").";
  }

  function normalizeResult(status, body, key) {
    var error = body && typeof body.error === "string" ? body.error : null;
    return {
      ok: status === 200,
      status: status,
      body: body || {},
      error: status === 200 ? null : (error || ("http_" + status)),
      key: key,
    };
  }

  // One client per turn loop; holds the last turn for replay-on-retry.
  function createSendClient(opts) {
    var o = opts || {};
    var base = o.base || SEND_BASE;
    var token = o.token || "";
    var lastTurn = null; // {key, payload} of the most recent sendTurn

    function authed(path, body) {
      return root.fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(body),
      });
    }

    // One assistant turn -> one POST /ig/send with a fresh key (unless
    // opts.key is given, which is the explicit replay path). Always
    // confirm:true. HTTP error statuses resolve (surfaced), they never
    // reject; only a network failure resolves as status 0
    // `bot_unreachable` with the turn kept as lastTurn (unsent draft).
    function sendTurn(turn) {
      var t = turn || {};
      var key = typeof t.key === "string" && t.key ? t.key : newKey();
      var payload = buildPayload(t.shareId, t.text, key, t.withImage);
      lastTurn = { key: key, payload: payload };
      return authed("/ig/send", payload).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          var out = normalizeResult(res.status, body, key);
          out.replayed = false;
          return out;
        });
      }, function () {
        return { ok: false, status: 0, body: {}, error: "bot_unreachable", key: key, replayed: false };
      });
    }

    // Retry the last turn by REPLAYING its key + payload, so the mock
    // returns the stored message_id instead of sending again.
    function replayLast() {
      if (!lastTurn) {
        return root.Promise
          ? root.Promise.resolve({ ok: false, status: 0, body: {}, error: "no_last_turn", key: null, replayed: true })
          : null;
      }
      var payload = lastTurn.payload;
      var key = lastTurn.key;
      return authed("/ig/send", payload).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          var out = normalizeResult(res.status, body, key);
          out.replayed = true;
          return out;
        });
      }, function () {
        return { ok: false, status: 0, body: {}, error: "bot_unreachable", key: key, replayed: true };
      });
    }

    function lastKey() {
      return lastTurn ? lastTurn.key : null;
    }

    return {
      base: base,
      sendTurn: sendTurn,
      replayLast: replayLast,
      lastKey: lastKey,
      describeForThread: describeForThread,
    };
  }

  var api = {
    SEND_BASE: SEND_BASE,
    newKey: newKey,
    buildPayload: buildPayload,
    isEcho: isEcho,
    shouldProcess: shouldProcess,
    describeForThread: describeForThread,
    createSendClient: createSendClient,
  };

  if (root.MetaStyles === undefined) root.MetaStyles = {};
  root.MetaStyles.sendClient = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
