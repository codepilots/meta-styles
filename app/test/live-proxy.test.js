"use strict";
/* meta-styles — same-origin live proxy tests (LIVE_IG=1).
 *
 * Verifies the fix that lets the browser page work both from
 * http://localhost:8000 and through the Tailscale https link:
 *   - the browser only ever talks to its OWN origin (relative "/ig" and
 *     "/api" bases from the generated runtime config), and
 *   - live-proxy-server.js serves app/ statically and hops server-to-server
 *     to the real bot (127.0.0.1:8903) and the Meta API proxy (127.0.0.1:8905),
 *     so no browser CORS preflight or mixed-content fetch can occur.
 * Mock mode (no runtime config) is unaffected: 8904/8905 absolute defaults.
 *
 * All ids/tokens below are synthetic — never real credentials.
 * Run: node app/test/live-proxy.test.js
 */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

// Sandboxed runners export *_proxy without a localhost exception, which
// transparently reroutes even 127.0.0.1 (same reason start.sh curls with
// --noproxy '*'). Best-effort cleanup here; Node snapshots proxy config at
// startup, so under such a shell launch the test itself with a localhost
// exception (NO_PROXY=127.0.0.1,localhost or env -u ..._PROXY).
for (const k of [
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy",
  "all_proxy", "NODE_USE_ENV_PROXY",
]) delete process.env[k];

let failures = 0;
let passes = 0;
function check(name, cond, detail) {
  if (cond) { passes++; console.log(`PASS: ${name}`); }
  else { failures++; console.log(`FAIL: ${name}${detail ? " — " + detail : ""}`); }
}

const APP_DIR = path.resolve(__dirname, "..");
const REPO_DIR = path.resolve(__dirname, "..", "..");
function readApp(f) { return fs.readFileSync(path.join(APP_DIR, f), "utf8"); }
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^\S\n])\/\/[^\n]*/g, "$1");
}
function freshRequire(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}

// --- joinBase: relative bases dedupe, absolute bases concatenate --------
{
  const WC = freshRequire(path.join(APP_DIR, "wardrobe-catalog.js"));
  const SC = freshRequire(path.join(APP_DIR, "send-client.js"));
  const MC = freshRequire(path.join(APP_DIR, "meta-client.js"));
  const IB = freshRequire(path.join(APP_DIR, "inbox-bridge.js"));
  const fns = { "wardrobe-catalog": WC.joinBase, "send-client": SC.joinBase, "meta-client": MC.joinBase, "inbox-bridge": IB.joinBase };
  for (const [label, fn] of Object.entries(fns)) {
    check(`live-proxy: ${label} exports joinBase`, typeof fn === "function");
    if (typeof fn !== "function") continue;
    check(`live-proxy: ${label} joinBase dedupes /ig prefix`,
      fn("/ig", "/ig/shares?limit=1") === "/ig/shares?limit=1" &&
      fn("/ig", "/ig/send") === "/ig/send" &&
      fn("/ig", "/ig/catalog/SYNTH_u") === "/ig/catalog/SYNTH_u");
    check(`live-proxy: ${label} joinBase dedupes /api prefix`,
      fn("/api", "/api/segment") === "/api/segment" &&
      fn("/api", "/health") === "/api/health");
    check(`live-proxy: ${label} joinBase concatenates absolute bases`,
      fn("http://127.0.0.1:8904", "/ig/shares") === "http://127.0.0.1:8904/ig/shares" &&
      fn("http://127.0.0.1:8905", "/api/segment") === "http://127.0.0.1:8905/api/segment");
  }
}

// --- Live runtime shape: relative bases, mock defaults untouched ---------
{
  global.__IG_RUNTIME__ = {
    mode: "live",
    botBase: "/ig", catalogBase: "/ig", sendBase: "/ig", proxyBase: "/api",
    readToken: "SYNTH_live_read", catalogToken: "SYNTH_live_cat", sendToken: "SYNTH_live_send",
  };
  const WC = freshRequire(path.join(APP_DIR, "wardrobe-catalog.js"));
  const SC = freshRequire(path.join(APP_DIR, "send-client.js"));
  const MC = freshRequire(path.join(APP_DIR, "meta-client.js"));
  check("live-proxy: catalog base is relative /ig in live mode", WC.CATALOG_BASE === "/ig", `got ${WC.CATALOG_BASE}`);
  check("live-proxy: send base is relative /ig in live mode", SC.SEND_BASE === "/ig", `got ${SC.SEND_BASE}`);
  check("live-proxy: meta proxy base is relative /api in live mode", MC.PROXY_BASE === "/api", `got ${MC.PROXY_BASE}`);
  check("live-proxy: live catalog URL is same-origin",
    WC.joinBase(WC.CATALOG_BASE, "/ig/catalog/SYNTH_u") === "/ig/catalog/SYNTH_u");
  check("live-proxy: live send URL is same-origin",
    SC.joinBase(SC.SEND_BASE, "/ig/send") === "/ig/send");
  check("live-proxy: live meta health URL is same-origin",
    MC.joinBase(MC.PROXY_BASE, "/health") === "/api/health");
  check("live-proxy: live meta segment URL is same-origin",
    MC.joinBase(MC.PROXY_BASE, "/api/segment") === "/api/segment");
  delete global.__IG_RUNTIME__;

  const WC2 = freshRequire(path.join(APP_DIR, "wardrobe-catalog.js"));
  const SC2 = freshRequire(path.join(APP_DIR, "send-client.js"));
  const MC2 = freshRequire(path.join(APP_DIR, "meta-client.js"));
  check("live-proxy: catalog base still mock 8904 without runtime",
    WC2.CATALOG_BASE === "http://127.0.0.1:8904", `got ${WC2.CATALOG_BASE}`);
  check("live-proxy: send base still mock 8904 without runtime",
    SC2.SEND_BASE === "http://127.0.0.1:8904", `got ${SC2.SEND_BASE}`);
  check("live-proxy: meta proxy base still 8905 without runtime",
    MC2.PROXY_BASE === "http://127.0.0.1:8905", `got ${MC2.PROXY_BASE}`);
}

// --- start.sh: live uses the proxy, mock keeps python http.server --------
{
  const sh = fs.readFileSync(path.join(REPO_DIR, "start.sh"), "utf8");
  check("live-proxy: start.sh launches live-proxy-server.js in live mode",
    /node live-proxy-server\.js --port "\$STATIC_PORT" --bot "\$LIVE_BOT_BASE" --proxy /.test(sh));
  check("live-proxy: start.sh mock mode still uses python http.server",
    /python3 -m http\.server "\$STATIC_PORT" --directory app/.test(sh));
  check("live-proxy: start.sh runtime config uses relative /ig base",
    /live_base = "\/ig"/.test(sh));
  check("live-proxy: start.sh runtime config uses relative /api proxy base",
    /proxy_base = "\/api"/.test(sh) && /"proxyBase": proxy_base/.test(sh));
  check("live-proxy: start.sh python config block emits no absolute bot URL",
    !/live_base = "http/.test(sh));
}

// --- No absolute live-bot URLs left in executable browser code ------------
{
  for (const f of ["inbox-bridge.js", "wardrobe-catalog.js", "send-client.js", "meta-client.js"]) {
    const code = strip(readApp(f));
    check(`live-proxy: no 8903 literal in ${f} code (comments only)`, !/8903/.test(code));
  }
  const page = strip(readApp("mock-dm.html"));
  check("live-proxy: no 8903 literal in mock-dm.html code", !/8903/.test(page));
  check("live-proxy: page joins base + path without doubling",
    /joinBase\(base\(\), path\)/.test(page));
  check("live-proxy: stale remote-link-cannot-work message is gone",
    !/not the remote link|only trusts that one local address|wrong page address/.test(page));
}

// --- Proxy round-trip against fake upstreams ------------------------------
(async () => {
  const seen = { bot: [], meta: [] };
  const bot = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      seen.bot.push({
        method: req.method, url: req.url,
        auth: req.headers.authorization, body: raw.toString("utf8"),
      });
      if (req.headers.authorization !== "Bearer SYNTH_live_read") {
        res.writeHead(401, { "Content-Type": "application/json", "X-SYNTH-Echo": "auth-check" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json", "X-SYNTH-Echo": "bot-ok" });
      res.end(JSON.stringify({ items: [{ id: "SYNTH_share_001" }], next_cursor: null }));
    });
  });
  const meta = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.meta.push({ method: req.method, url: req.url, len: Buffer.concat(chunks).length });
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, keyPresent: false }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json", "X-SYNTH-Echo": "meta-ok" });
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
  });
  await new Promise((r) => bot.listen(0, "127.0.0.1", r));
  await new Promise((r) => meta.listen(0, "127.0.0.1", r));
  const botPort = bot.address().port;
  const metaPort = meta.address().port;
  const { startServer } = freshRequire(path.join(REPO_DIR, "live-proxy-server.js"));
  // Capture proxy stdout to prove bearer tokens are never logged. Tee
  // process.stdout.write (not console.log) so check() lines still print.
  const logged = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, enc, cb) => {
    logged.push(String(chunk));
    return origWrite(chunk, enc, cb);
  };
  let proxy = null;
  try {
    const started = await startServer({
      port: 0,
      bot: "http://127.0.0.1:" + botPort,
      proxy: "http://127.0.0.1:" + metaPort,
      dir: APP_DIR,
    });
    proxy = started.server;
    const base = "http://127.0.0.1:" + started.port;
    const get = (p, headers) => new Promise((resolve, reject) => {
      http.get(base + p, { headers: headers || {} }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({
          status: res.statusCode, headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      }).on("error", reject);
    });
    const post = (p, obj, headers) => new Promise((resolve, reject) => {
      const data = JSON.stringify(obj);
      const req = http.request(base + p, {
        method: "POST",
        headers: Object.assign(
          { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
          headers || {}
        ),
      }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({
          status: res.statusCode, headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      });
      req.on("error", reject);
      req.end(data);
    });

    const page = await get("/mock-dm.html");
    check("live-proxy: static /mock-dm.html served 200",
      page.status === 200 && page.body.includes("Milestone 19a"), `got ${page.status}`);

    const shares = await get("/ig/shares?limit=1", { Authorization: "Bearer SYNTH_live_read" });
    check("live-proxy: /ig/shares round-trips bot data",
      shares.status === 200 && shares.body.includes("SYNTH_share_001"),
      `got ${shares.status} ${shares.body.slice(0, 80)}`);
    check("live-proxy: Authorization forwarded, custom header survives",
      seen.bot.length > 0 && seen.bot[0].auth === "Bearer SYNTH_live_read" &&
      shares.headers["x-synth-echo"] === "bot-ok");

    const denied = await get("/ig/shares", { Authorization: "Bearer SYNTH_wrong" });
    check("live-proxy: upstream 401 status passes through",
      denied.status === 401 && denied.body.includes("unauthorized"), `got ${denied.status}`);

    const payload = {
      share_id: "SYNTH_s1", text: "SYNTH hello",
      idempotency_key: "SYNTH_k1", confirm: true, image: false,
    };
    const sent = await post("/ig/send", payload, { Authorization: "Bearer SYNTH_live_read" });
    const last = seen.bot[seen.bot.length - 1];
    check("live-proxy: POST body forwarded byte-identical",
      sent.status === 200 && last.url === "/ig/send" && last.body === JSON.stringify(payload),
      `got ${last && last.body}`);

    const h = await get("/api/health");
    const hSeen = seen.meta.find((r) => r.url === "/health");
    check("live-proxy: /api/health reaches upstream /health",
      h.status === 200 && h.body.includes('"ok":true') && !!hSeen,
      `got ${h.status} ${h.body.slice(0, 80)}`);

    const seg = await post("/api/segment", { image: "data:image/jpeg;base64,SYNTH" });
    const segSeen = seen.meta.find((r) => r.url === "/api/segment");
    check("live-proxy: /api/segment keeps /api prefix upstream",
      seg.status === 200 && !!segSeen && seg.headers["x-synth-echo"] === "meta-ok");

    const trav = await get("/..%2f..%2fetc%2fpasswd");
    check("live-proxy: path traversal blocked",
      trav.status === 400 || trav.status === 404, `got ${trav.status}`);
    const missing = await get("/no-such-file-xyz.html");
    check("live-proxy: missing static file 404s", missing.status === 404, `got ${missing.status}`);

    check("live-proxy: bearer token never appears in proxy logs",
      !logged.join("\n").includes("SYNTH_live_read"), logged.join("\n").slice(0, 200));
  } finally {
    process.stdout.write = origWrite;
    if (proxy) proxy.close();
    bot.close();
    meta.close();
  }
  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error("live-proxy round-trip crashed: " + (err && err.message));
  process.exit(1);
});
