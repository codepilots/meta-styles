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
  var _RT = (typeof globalThis !== "undefined" && globalThis.__IG_RUNTIME__) || {};
  var SEND_BASE = _RT.sendBase || _RT.botBase || "http://127.0.0.1:8904";
  var RUNTIME_SEND_TOKEN = _RT.sendToken || "";

  // Join a configured base with a "/ig/..." path without doubling the
  // prefix: joinBase("/ig", "/ig/send") === "/ig/send", while absolute
  // bases concatenate as before. (Same tiny helper is duplicated in
  // inbox-bridge.js, wardrobe-catalog.js, and meta-client.js — this static
  // app has no shared module, so each file stays standalone for Node tests.)
  function joinBase(base, path) {
    var b = String(base === undefined || base === null ? "" : base);
    if (b.length > 1) b = b.replace(/\/+$/, "");
    else if (b === "/") b = "";
    if (b && path.indexOf(b + "/") === 0) return path;
    return b + path;
  }

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
  // opts.mode selects the staging route used by stageOutboundImage:
  // "live" -> POST /ig/outbound-stage/<share_id> (real bot, NEW
  // hackathon work Oct-Nov 2026); anything else (including omitted, the
  // pre-existing default) -> POST /mock/stage-outbound-image/<share_id>.
  // The default path is byte-for-byte the old behavior.
  function createSendClient(opts) {
    var o = opts || {};
    var base = o.base || SEND_BASE;
    var token = o.token || RUNTIME_SEND_TOKEN || "";
    var stageMode = o.mode === "live" ? "live" : "mock";
    var lastTurn = null; // {key, payload} of the most recent sendTurn

    function authed(path, body) {
      return root.fetch(joinBase(base, path), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(body),
      });
    }

    // One assistant turn -> one POST /ig/send with opts.key when given
    // (the service passes a stable per-share key so retries reuse it), else
    // a fresh random key. Always confirm:true. HTTP error statuses resolve
    // (surfaced), they never reject; only a network failure resolves as
    // status 0 `bot_unreachable` with the turn kept as lastTurn (unsent draft).
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

    // Stage preview bytes for an image send: POSTs the raw bytes to the
    // mode's staging route, so a later sendTurn with withImage:true can
    // attach them. Mock mode uses the mock bot's operator route
    // /mock/stage-outbound-image/<share_id>; live mode uses the real
    // bot's POST /ig/outbound-stage/<share_id> (same Bearer [REDACTED] as
    // /ig/send, raw image bytes, image Content-Type from the dataURL).
    // Any non-200 (unknown share, over-cap, non-image body, bad auth)
    // resolves {ok:false} — the caller then falls back to an honest
    // text-only send, never a fake claim.
    // Accepts a data: URL string; decodes base64 without assuming Node
    // (Buffer when present, atob otherwise). Never throws for transport
    // outcomes; only a network failure resolves bot_unreachable.
    function stageOutboundImage(shareId, dataURL) {
      function fail(error) {
        return { ok: false, status: 0, body: {}, error: error, staged: false };
      }
      var m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(String(dataURL || ""));
      if (!m) return root.Promise ? root.Promise.resolve(fail("bad_data_url")) : null;
      var contentType = m[1] || "application/octet-stream";
      var bytes = null;
      try {
        if (typeof Buffer !== "undefined") {
          bytes = Buffer.from(m[3], "base64");
        } else if (typeof atob === "function") {
          var bin = atob(m[3]);
          var arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          bytes = arr;
        } else {
          return root.Promise ? root.Promise.resolve(fail("no_decoder")) : null;
        }
      } catch (err) {
        return root.Promise ? root.Promise.resolve(fail("bad_data_url")) : null;
      }
      if (!bytes || bytes.length === 0) {
        return root.Promise ? root.Promise.resolve(fail("empty_image")) : null;
      }
      var stagePath = stageMode === "live"
        ? "/ig/outbound-stage/" + String(shareId)
        : "/mock/stage-outbound-image/" + String(shareId);
      var url = joinBase(base, stagePath);
      return root.fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          Authorization: "Bearer " + token,
        },
        body: bytes,
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          var ok = res.status === 200 && body && body.share_id === String(shareId);
          return {
            ok: ok, status: res.status, body: body || {},
            error: ok ? null : ((body && body.error) || ("http_" + res.status)),
            staged: ok,
          };
        });
      }, function () {
        return { ok: false, status: 0, body: {}, error: "bot_unreachable", staged: false };
      });
    }

    return {
      base: base,
      sendTurn: sendTurn,
      replayLast: replayLast,
      lastKey: lastKey,
      stageOutboundImage: stageOutboundImage,
      describeForThread: describeForThread,
    };
  }

  var api = {
    SEND_BASE: SEND_BASE,
    joinBase: joinBase,
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
