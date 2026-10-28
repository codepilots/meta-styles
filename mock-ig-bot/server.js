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
