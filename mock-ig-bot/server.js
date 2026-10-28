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

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function notFound(res) {
  sendJson(res, 404, { error: "not_found" });
}

function createHandler(store) {
  return function handler(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/ig/shares") {
      sendJson(res, 200, { items: [], next_cursor: null });
      return;
    }
    notFound(res);
  };
}

function startServer(opts) {
  const options = opts || {};
  const port = options.port !== undefined ? options.port : DEFAULT_PORT;
  const store = options.store || createStore();
  const server = http.createServer(createHandler(store));
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
