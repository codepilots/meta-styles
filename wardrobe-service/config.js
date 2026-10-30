"use strict";
/* meta-styles Milestone 20 — wardrobe-service config (NEW hackathon work,
 * building period Oct 27 – Nov 4, 2026).
 *
 * Dual-mode base/token resolution for the persistent wardrobe service,
 * same flag semantics as start.sh: mock bot 127.0.0.1:8904 by default,
 * real local bot 127.0.0.1:8903 when LIVE_IG=1.
 *
 * Secrets arrive via the process environment ONLY (exported by start.sh,
 * which parses .env/secrets without printing — same pattern as the
 * meta-api-proxy launcher). This module never reads .env/secrets itself,
 * never prints a value, and never writes one anywhere. It is pure and
 * require-able so tests can assert the dual-mode selection without
 * starting any server.
 *
 * Env contract (all optional):
 *   LIVE_IG=1               -> live mode (real bot); unset/empty -> mock
 *   WARDROBE_PORT           -> status endpoint port (default 8906)
 *   WARDROBE_BOT_BASE       -> explicit bot base (wins over the mode
 *                              default; LIVE_BOT_BASE also honored in live
 *                              mode, mirroring start.sh)
 *   WARDROBE_PROXY_BASE     -> Meta API proxy base (default 8905 address)
 *   WARDROBE_READ_TOKEN     -> bot read Bearer [REDACTED] (live). Falls back to
 *                              IG_API_TOKEN. Mock default is the documented
 *                              non-secret demo value below.
 *   WARDROBE_CATALOG_TOKEN  -> catalog Bearer [REDACTED] (live). Falls back to
 *                              IG_API_STORAGE_TOKEN, then to the read token.
 *   WARDROBE_SEND_TOKEN     -> send Bearer [REDACTED] (live). Falls back to
 *                              IG_API_SEND_TOKEN, then to the read token.
 *
 * In mock mode every route uses one demo token (the mock bot enforces a
 * single token for all routes) — read/catalog/send all resolve to it.
 */

var MOCK_BOT_BASE = "http://127.0.0.1:8904";
var LIVE_BOT_BASE = "http://127.0.0.1:8903";
var PROXY_BASE = "http://127.0.0.1:8905";
var DEFAULT_PORT = 8906;
var MOCK_TOKEN = "SYNTH_mock_token";

// Single fixed demo identity for mock mode: the mock bot has no sender
// identity model (its shares carry no user_ref), so every mock share is
// processed into one demo wardrobe. Matches the convention the M19 test
// suite established for the judged path. LIVE mode never uses these —
// every share is keyed by its real per-sender item.user_ref instead.
var DEMO_USER_KEY = "SYNTH_demo_user";
var DEMO_USER_REF = "u_deadbeefdeadbeefdeadbeefdeadbeef";

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0 ? value : "";
}

function resolveConfig(env) {
  var e = env || {};
  var live = nonEmpty(e.LIVE_IG) !== "";
  var port = Number(nonEmpty(e.WARDROBE_PORT)) || DEFAULT_PORT;
  var botBase = nonEmpty(e.WARDROBE_BOT_BASE) ||
    (live ? (nonEmpty(e.LIVE_BOT_BASE) || LIVE_BOT_BASE) : MOCK_BOT_BASE);
  var proxyBase = nonEmpty(e.WARDROBE_PROXY_BASE) ||
    (nonEmpty(e.PROXY_PORT) ? "http://127.0.0.1:" + e.PROXY_PORT : PROXY_BASE);

  var readToken;
  var catalogToken;
  var sendToken;
  if (live) {
    readToken = nonEmpty(e.WARDROBE_READ_TOKEN) || nonEmpty(e.IG_API_TOKEN);
    catalogToken = nonEmpty(e.WARDROBE_CATALOG_TOKEN) ||
      nonEmpty(e.IG_API_STORAGE_TOKEN) || readToken;
    sendToken = nonEmpty(e.WARDROBE_SEND_TOKEN) ||
      nonEmpty(e.IG_API_SEND_TOKEN) || readToken;
  } else {
    readToken = nonEmpty(e.WARDROBE_READ_TOKEN) ||
      nonEmpty(e.MOCK_TOKEN) || MOCK_TOKEN;
    catalogToken = nonEmpty(e.WARDROBE_CATALOG_TOKEN) || readToken;
    sendToken = nonEmpty(e.WARDROBE_SEND_TOKEN) || readToken;
  }

  return {
    mode: live ? "live" : "mock",
    botBase: botBase,
    proxyBase: proxyBase,
    readToken: readToken,
    catalogToken: catalogToken,
    sendToken: sendToken,
    port: port,
    demoUserKey: DEMO_USER_KEY,
    demoUserRef: DEMO_USER_REF,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    resolveConfig: resolveConfig,
    MOCK_BOT_BASE: MOCK_BOT_BASE,
    LIVE_BOT_BASE: LIVE_BOT_BASE,
    PROXY_BASE: PROXY_BASE,
    DEFAULT_PORT: DEFAULT_PORT,
    MOCK_TOKEN: MOCK_TOKEN,
    DEMO_USER_KEY: DEMO_USER_KEY,
    DEMO_USER_REF: DEMO_USER_REF,
  };
}
