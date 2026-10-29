"use strict";
/* meta-styles — LIVE_IG=1 same-origin proxy (NEW hackathon work, building period Oct 27 – Nov 4, 2026).
 *
 * Why this exists: the browser page must only ever talk to its OWN origin —
 * whichever address it was loaded from (http://localhost:8000 locally, or the
 * Tailscale https://<tailnet-host>:8446 link remotely, which `tailscale serve`
 * already proxies to 127.0.0.1:8000). Two browser restrictions made the old
 * direct-to-bot wiring fail remotely, and neither may be "fixed" on the bot:
 *   1. The real bot's CORS allowlist only trusts the exact local origin, so a
 *      Tailscale-origin preflight is rejected (correctly — loosening it to
 *      `*` or a tunnel origin would be a real security regression).
 *   2. An https page fetching plain-http 127.0.0.1:8903 is blocked by the
 *      browser's mixed-content policy regardless of CORS.
 * A server-to-server hop has neither restriction — only browser-initiated
 * cross-origin fetches do — so this process serves app/ statically AND
 * reverse-proxies the API prefixes below. The browser uses RELATIVE bases
 * (botBase "/ig", proxyBase "/api" from app/ig-runtime-config.js), so the
 * exact same page works from localhost:8000 and through Tailscale with zero
 * `tailscale serve` reconfiguration. Nothing about the real bot's
 * CORS/mixed-content safety is changed or weakened — the browser simply no
 * longer makes a cross-origin or mixed-content request at all.
 *
 * Routes (all on 127.0.0.1 only):
 *   /ig/*        -> http://127.0.0.1:8903 + full path (bot read/send/catalog)
 *   /api/*       -> http://127.0.0.1:8905 + full path (Meta API proxy)
 *   /api/health  -> http://127.0.0.1:8905/health (the proxy's health route
 *                   lives at /health, not /api/health — single documented
 *                   exception so the browser health check stays same-origin)
 *   anything else -> static file from app/ (same directory/files the judged
 *                   mock path serves via `python3 -m http.server`)
 *
 * Method, request headers (notably Authorization), and body are forwarded;
 * upstream status code and headers (minus hop-by-hop ones) stream back.
 * Request logging is method + pathname + target + status ONLY — header
 * values (never mind Authorization) and bodies are never logged.
 *
 * Usage: node live-proxy-server.js [--port 8000]
 *          [--bot http://127.0.0.1:8903] [--proxy http://127.0.0.1:8905]
 *          [--dir app]
 * Mock mode is untouched: `sh start.sh` without LIVE_IG=1 still uses the
 * python static server exactly as before.
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const DEFAULT_PORT = 8000;
const DEFAULT_BOT = "http://127.0.0.1:8903";
const DEFAULT_PROXY = "http://127.0.0.1:8905";

// Upstream targets are always loopback by construction, so an ambient
// HTTP(S)_PROXY must never route these server-to-server hops anywhere
// else. Best-effort only: Node snapshots proxy config at startup, so
// launchers must sanitize the environment BEFORE node starts — start.sh
// exports its NO_PROXY localhost exception up front for exactly this
// reason. (Direct `node live-proxy-server.js` runs under a proxy shell
// need NO_PROXY=127.0.0.1,localhost in the launching shell.)
delete process.env.NODE_USE_ENV_PROXY;
const DEFAULT_DIR = path.join(__dirname, "app");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

// Hop-by-hop headers are connection-scoped and must never be forwarded
// in either direction (RFC 9110 §7.6.1).
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function parseArgs(argv) {
  const opts = {};
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) opts.port = Number(args[++i]);
    else if (args[i] === "--bot" && args[i + 1]) opts.bot = args[++i];
    else if (args[i] === "--proxy" && args[i + 1]) opts.proxy = args[++i];
    else if (args[i] === "--dir" && args[i + 1]) opts.dir = args[++i];
  }
  return opts;
}

function serveStatic(rootDir, pathname, req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 404, { error: "not_found" });
    return;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (err) {
    sendJson(res, 400, { error: "bad_path" });
    return;
  }
  const joined = path.normalize(path.join(rootDir, decoded === "/" ? "/" : decoded));
  if (joined !== rootDir && !joined.startsWith(rootDir + path.sep)) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }
  let filePath = joined;
  try {
    const st = fs.statSync(filePath);
    if (st.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch (err) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }
  fs.readFile(filePath, (err, bytes) => {
    if (err) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "Content-Length": bytes.length,
    });
    if (req.method === "HEAD") res.end();
    else res.end(bytes);
  });
}

// Reverse-proxy one request to a same-machine upstream. Forwards the
// method, headers (minus hop-by-hop/host), and body; streams the upstream
// status, headers (minus hop-by-hop), and body back. `label` appears in
// logs and 502 bodies only — never any header value.
function proxyTo(target, upstreamPath, label, req, res) {
  let targetUrl;
  try {
    targetUrl = new URL(upstreamPath, target);
  } catch (err) {
    sendJson(res, 400, { error: "bad_path" });
    return;
  }
  const mod = targetUrl.protocol === "https:" ? https : http;
  const headers = {};
  for (const key of Object.keys(req.headers)) {
    const lower = key.toLowerCase();
    if (lower === "host" || HOP_BY_HOP.has(lower)) continue;
    headers[lower] = req.headers[key];
  }
  const up = mod.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: headers,
    },
    (upRes) => {
      const outHeaders = {};
      for (const key of Object.keys(upRes.headers)) {
        if (HOP_BY_HOP.has(key.toLowerCase())) continue;
        outHeaders[key] = upRes.headers[key];
      }
      res.writeHead(upRes.statusCode, outHeaders);
      upRes.pipe(res);
      // Log routing only: method + our pathname + target label + status.
      // Header values and bodies are never logged (Authorization lives in
      // the headers this deliberately skips).
      console.log(
        "live-proxy " + req.method + " " + req.url.split("?")[0] +
        " -> " + label + " " + upRes.statusCode
      );
    }
  );
  up.on("error", () => {
    sendJson(res, 502, { error: label + "_unreachable" });
  });
  req.pipe(up);
}

function createHandler(opts) {
  const rootDir = path.resolve((opts && opts.dir) || DEFAULT_DIR);
  const bot = (opts && opts.bot) || DEFAULT_BOT;
  const proxy = (opts && opts.proxy) || DEFAULT_PROXY;
  return function handler(req, res) {
    const rawPath = (req.url || "/").split("?")[0];
    let pathname = rawPath;
    try {
      pathname = decodeURIComponent(rawPath);
    } catch (err) {
      sendJson(res, 400, { error: "bad_path" });
      return;
    }
    if (pathname === "/ig" || pathname.startsWith("/ig/")) {
      proxyTo(bot, req.url, "bot", req, res);
      return;
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      // The Meta API proxy's own health route is GET /health; everything
      // else keeps its /api/* path upstream.
      const upstream = pathname === "/api/health" ? "/health" : req.url;
      proxyTo(proxy, upstream, "proxy", req, res);
      return;
    }
    serveStatic(rootDir, rawPath, req, res);
  };
}

function startServer(opts) {
  const options = opts || {};
  const port = options.port !== undefined ? options.port : DEFAULT_PORT;
  const server = http.createServer(createHandler(options));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  startServer(opts).then(({ server, port }) => {
    console.log(
      "live-proxy listening on 127.0.0.1:" + port +
      " (static dir served; /ig/* and /api/* proxied same-origin)"
    );
  }).catch((err) => {
    console.error("live-proxy failed to start: " + err.message);
    process.exit(1);
  });
}

module.exports = {
  createHandler,
  startServer,
  parseArgs,
  DEFAULT_PORT,
  DEFAULT_BOT,
  DEFAULT_PROXY,
};
