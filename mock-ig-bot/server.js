"use strict";
/* meta-styles Milestone 13 — mock Instagram bot (standalone demo harness).
 *
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026). Genuinely new,
 * synthetic, offline code: never touches real Instagram, Meta's Graph API,
 * the SecondBloom `igwebhook` deployment, or any prior-work code or data.
 * All ids/tokens/bytes it handles are SYNTH_-prefixed demo values.
 *
 * What this is: a separate server process (stdlib `http` only, zero
 * dependencies) implementing the EXACT API contract of the real local bot
 * (`docs/instagram-bot-api.md` + `docs/instagram-bot-send-api.md`,
 * "As implemented" sections — same routes, shapes, status codes, auth and
 * CORS behavior) so `app/inbox-bridge.js` runs unchanged against it.
 *
 * Run: node mock-ig-bot/server.js [--port 8904] [--token SYNTH_mock_token]
 *        [--origin http://localhost:8000]
 *   or:  MOCK_PORT=8904 MOCK_TOKEN=... MOCK_ALLOW_ORIGIN=... node mock-ig-bot/server.js
 *
 * Defaults: port 8904 (one off the real bot's 8903 so both can run side by
 * side), token SYNTH_mock_token (documented NON-SECRET demo value — never
 * the real ig-bot-token), origin http://localhost:8000.
 *
 * Known deliberate divergences from the real bot (see the M13 plan §3):
 *   - no 502 graph_* family: with no Graph backend the mock records sends
 *     locally instead of calling Graph, so sends never fail downstream;
 *   - outbound-media tokens are mock-local opaque ids (same 24h TTL +
 *     single-use semantics, different format);
 *   - no fail2ban/nginx/TLS/proxy-header hardening: local demo only.
 */

const http = require("http");

const DEFAULT_PORT = 8904;
const DEFAULT_TOKEN = "SYNTH_mock_token";
const DEFAULT_ORIGIN = "http://localhost:8000";

function createStore() {
  return {
    shares: [], // {id, received_at, attachment, media_id, media_available}
    media: new Map(), // media_id -> {bytes: Buffer, contentType: string}
    outbound: [], // {message_id, share_id, text, image_message_id?, sent_at}
    outboundStaged: new Map(), // share_id -> {bytes, contentType}
    sendChain: Promise.resolve(), // serialised sends (no double-click race)
    outboundTokens: new Map(), // token -> {share_id, expiresAt, used}
    idempotency: new Map(), // key -> {payloadHash, result, at}
    counters: { share: 0, message: 0, token: 0 },
  };
}

function sendJson(res, status, obj, corsOrigin) {
  const body = JSON.stringify(obj);
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  };
  if (corsOrigin) headers["Access-Control-Allow-Origin"] = corsOrigin;
  res.writeHead(status, headers);
  res.end(body);
}

function notFound(res, corsOrigin) {
  sendJson(res, 404, { error: "not_found" }, corsOrigin);
}

function parsePaging(url) {
  const rawSince = url.searchParams.get("since");
  const rawLimit = url.searchParams.get("limit");
  let start = 0;
  if (rawSince !== null) {
    if (!/^\d+$/.test(rawSince)) return { error: "bad since" };
    start = Number(rawSince);
  }
  let limit = 20;
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit)) return { error: "bad limit" };
    limit = Number(rawLimit);
    if (limit < 1 || limit > 50) return { error: "bad limit" };
  }
  return { start, limit };
}

function publicShare(item) {
  return {
    id: item.id,
    received_at: item.received_at,
    attachment: item.attachment,
    media_id: item.media_id,
    media_available: item.media_available,
  };
}

const MAX_SEND_BODY = 1024 * 1024; // 1 MB, per the send spec
const WINDOW_MS = 24 * 3600 * 1000; // IG reply window: 24h from the share

function normalizeText(t) {
  return t.trim().replace(/\s+/g, " ");
}

function readBody(req, cap) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > cap) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(tooLarge ? { tooLarge: true } : { bytes: Buffer.concat(chunks) }));
    req.on("error", () => resolve({ bytes: Buffer.alloc(0) }));
  });
}

function pruneSendState(store, now) {
  for (const [key, entry] of store.idempotency) {
    if (now - entry.at > WINDOW_MS) store.idempotency.delete(key);
  }
  for (const [token, entry] of store.outboundTokens) {
    if (entry.expiresAt <= now) store.outboundTokens.delete(token);
  }
}

// Synchronous send core. The HTTP layer serialises calls through
// store.sendChain so a double-click cannot race (same guarantee as the bot).
function doSend(store, payload) {
  const now = Date.now();
  pruneSendState(store, now);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { status: 400, body: { error: "bad_request" } };
  }
  const { share_id, text, idempotency_key, confirm, image } = payload;
  if (confirm !== true ||
      typeof share_id !== "string" || !share_id ||
      typeof text !== "string" || !text ||
      typeof idempotency_key !== "string" || !idempotency_key ||
      (image !== undefined && image !== false && image !== true)) {
    return { status: 400, body: { error: "bad_request" } };
  }
  const share = store.shares.find((s) => s.id === share_id);
  if (!share) {
    return { status: 404, body: { error: "unknown_share" } };
  }
  if (image === true && !store.outboundStaged.has(share_id)) {
    return { status: 400, body: { error: "image_not_staged" } };
  }
  if (now - Date.parse(share.received_at) > WINDOW_MS) {
    return { status: 422, body: { error: "reply_window_expired", share_id } };
  }
  const payloadHash = share_id + "\n" + text + "\n" + (image === true ? "1" : "0");
  const seen = store.idempotency.get(idempotency_key);
  if (seen) {
    if (seen.payloadHash === payloadHash) {
      return { status: 200, body: seen.result };
    }
    return { status: 409, body: { error: "idempotency_key_reused" } };
  }
  const normText = normalizeText(text);
  for (const entry of store.idempotency.values()) {
    if (entry.share_id === share_id && entry.normText === normText) {
      return { status: 409, body: { error: "duplicate_send" } };
    }
  }
  store.counters.message += 1;
  const result = {
    message_id: "SYNTH_msg_" + String(store.counters.message).padStart(3, "0"),
    recipient_ref: share_id,
  };
  const logEntry = { message_id: result.message_id, share_id, text, sent_at: new Date(now).toISOString() };
  if (image === true) {
    store.counters.message += 1;
    result.image_message_id = "SYNTH_imgmsg_" + String(store.counters.message).padStart(3, "0");
    logEntry.image_message_id = result.image_message_id;
    const staged = store.outboundStaged.get(share_id);
    store.counters.token += 1;
    const token = "SYNTH_outbound_" + String(store.counters.token).padStart(3, "0");
    store.outboundTokens.set(token, {
      share_id,
      bytes: staged.bytes,
      contentType: staged.contentType,
      expiresAt: now + WINDOW_MS,
      used: false,
    });
  }
  store.outbound.push(logEntry);
  store.idempotency.set(idempotency_key, {
    payloadHash, share_id, normText, result, at: now,
  });
  return { status: 200, body: result };
}

function createHandler(store, config) {
  const expectedToken = (config && config.token) || DEFAULT_TOKEN;
  const allowOrigin = (config && config.allowOrigin) || DEFAULT_ORIGIN;
  return function handler(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const origin = req.headers.origin || null;
    const corsOrigin = origin === allowOrigin ? allowOrigin : null;

    // CORS preflight (browsers never attach auth here): 204 or 403.
    if (req.method === "OPTIONS" && origin && req.headers["access-control-request-method"]) {
      if (!corsOrigin) {
        sendJson(res, 403, { error: "forbidden_origin" });
        return;
      }
      res.writeHead(204, {
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }
    // Single-origin policy for real requests carrying an Origin header.
    if (origin && !corsOrigin) {
      sendJson(res, 403, { error: "forbidden_origin" });
      return;
    }

    // Bearer [REDACTED] on every route except the outbound-media token URL.
    const isOutboundMedia = req.method === "GET" && url.pathname.indexOf("/ig/outbound-media/") === 0;
    if (!isOutboundMedia) {
      const header = req.headers.authorization || "";
      if (header !== "Bearer " + expectedToken) {
        res.writeHead(401, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "WWW-Authenticate": 'Bearer realm="ig"',
          ...(corsOrigin ? { "Access-Control-Allow-Origin": corsOrigin } : {}),
        });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/ig/shares") {
      const paging = parsePaging(url);
      if (paging.error || paging.start > store.shares.length) {
        sendJson(res, 400, { error: "bad_paging" }, corsOrigin);
        return;
      }
      const page = store.shares.slice(paging.start, paging.start + paging.limit);
      const nextCursor = page.length > 0
        ? String(paging.start + page.length)
        : (url.searchParams.get("since") !== null
          ? url.searchParams.get("since")
          : (store.shares.length > 0 ? "0" : null));
      sendJson(res, 200, { items: page.map(publicShare), next_cursor: nextCursor }, corsOrigin);
      return;
    }
    if (req.method === "GET" && url.pathname.indexOf("/ig/outbound-media/") === 0) {
      pruneSendState(store, Date.now());
      const token = decodeURIComponent(url.pathname.slice("/ig/outbound-media/".length));
      const entry = store.outboundTokens.get(token);
      // Every refusal is the same bare 404 (reason never leaks to the fetcher).
      if (!entry || entry.used) {
        res.writeHead(404);
        res.end();
        return;
      }
      entry.used = true;
      res.writeHead(200, {
        "Content-Type": entry.contentType,
        "Cache-Control": "private, no-store",
        "Content-Length": entry.bytes.length,
      });
      res.end(entry.bytes);
      return;
    }
    const mediaMatch = req.method === "GET" && /^\/ig\/media\/([^/]+)$/.exec(url.pathname);
    if (mediaMatch) {
      const entry = store.media.get(decodeURIComponent(mediaMatch[1]));
      if (!entry) {
        sendJson(res, 404, { error: "media_not_found" }, corsOrigin);
        return;
      }
      res.writeHead(200, {
        "Content-Type": entry.contentType,
        "Cache-Control": "private, no-store",
        "Content-Length": entry.bytes.length,
        ...(corsOrigin ? { "Access-Control-Allow-Origin": corsOrigin } : {}),
      });
      res.end(entry.bytes);
      return;
    }
    if (req.method === "POST" && url.pathname === "/ig/send") {
      readBody(req, MAX_SEND_BODY).then((parsed) => {
        if (parsed.tooLarge) {
          sendJson(res, 413, { error: "body_too_large" }, corsOrigin);
          return;
        }
        let payload = null;
        try {
          payload = JSON.parse(parsed.bytes.toString("utf8"));
        } catch (err) {
          payload = null;
        }
        const run = store.sendChain.then(() => doSend(store, payload));
        store.sendChain = run.catch(() => {});
        run.then(({ status, body }) => sendJson(res, status, body, corsOrigin));
      });
      return;
    }
    if (req.method === "DELETE") {
      const delMatch = /^\/ig\/media\/([^/]+)$/.exec(url.pathname);
      if (delMatch) {
        const mediaId = decodeURIComponent(delMatch[1]);
        if (!store.media.has(mediaId)) {
          sendJson(res, 404, { error: "media_not_found" }, corsOrigin);
          return;
        }
        store.media.delete(mediaId);
        for (const item of store.shares) {
          if (item.media_id === mediaId) item.media_available = false;
        }
        res.writeHead(204, {
          "Cache-Control": "no-store",
          ...(corsOrigin ? { "Access-Control-Allow-Origin": corsOrigin } : {}),
        });
        res.end();
        return;
      }
    }
    notFound(res, corsOrigin);
  };
}

function startServer(opts) {
  const options = opts || {};
  const port = options.port !== undefined ? options.port : DEFAULT_PORT;
  const store = options.store || createStore();
  const server = http.createServer(createHandler(store, {
    token: options.token,
    allowOrigin: options.allowOrigin,
  }));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, store }));
  });
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  function flag(name) {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : null;
  }
  const port = Number(flag("--port") || process.env.MOCK_PORT || DEFAULT_PORT);
  const token = flag("--token") || process.env.MOCK_TOKEN || DEFAULT_TOKEN;
  const origin = flag("--origin") || process.env.MOCK_ALLOW_ORIGIN || DEFAULT_ORIGIN;
  startServer({ port, token, allowOrigin: origin }).then(({ server }) => {
    console.log(`mock-ig-bot listening on 127.0.0.1:${server.address().port}`);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { startServer, createStore, DEFAULT_PORT, DEFAULT_TOKEN, DEFAULT_ORIGIN };
