"use strict";
/* meta-styles Milestone 19f — polling/window discipline tests.
 *
 * Sixth step of the M19 chat-first pivot (docs/milestone-19-chat-first-pivot.md
 * §4 Gap 3, §7 task 6): app/poll-scheduler.js owns the DESIGNED cadence
 * (5s active -> 30s after 10 min idle -> stop after 30 min idle or while
 * document.hidden, resume on visibility/focus/operator action) plus the
 * pre-send user-anchored 24h reply-window check with honest 422 surfacing.
 * app/mock-dm.html loads the module and drives its poll timer + send
 * guards off it.
 *
 * Covers every acceptance criterion:
 *   1. cadence state-machine transitions (active -> backoff -> stop ->
 *      resume) on a FAKE clock — no real wall-clock waits;
 *   2. a stale-user turn (synthetic fixture, received_at > 24h ago)
 *      surfaces the lapsed-window case as readable 422 text in-thread —
 *      no silent failure, no thrown exception, no fabricated listing;
 *   3. isolation walk: no new external network dependency beyond the
 *      bot/proxy endpoints 19a-19e already use.
 *
 * All ids/text synthetic (SYNTH_ prefix, example.invalid URLs) — never
 * real Instagram data.
 *
 * Run: node app/test/milestone19f-polling-window.test.js
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Sandbox sets an HTTP proxy; the mock is local-only, so bypass it here.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const Scheduler = require("../poll-scheduler.js");
const Catalog = require("../wardrobe-catalog.js");
const SendClient = require("../send-client.js");
const { startServer } = require("../../mock-ig-bot/server.js");

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

// Fake clock: t is the only "now" the scheduler under test ever sees.
const T0 = Date.parse("2026-10-29T12:00:00.000Z");
let t = T0;
function freshScheduler() {
  t = T0;
  return Scheduler.createPollScheduler({ nowMs: () => t });
}
function at(minutes) {
  return T0 + minutes * 60 * 1000;
}

// IG-specific + descoped-inventory keys must never appear in the module
// (same banned lists as the 19c/19d suites — interface-agnostic rule).
const BANNED_KEYS = [
  "igsid", "sender_igsid", "ig_id", "ig_user_id", "recipient_ref",
  "graph_api", "ig_webhook_id",
  "fabric", "price", "vendor", "vendor_id", "listing", "listing_id", "cost",
];

async function main() {
  check("19f: poll-scheduler module exposes the M19f contract",
    !!(Scheduler && typeof Scheduler.createPollScheduler === "function" &&
      typeof Scheduler.checkSendWindow === "function" &&
      typeof Scheduler.isWindowOpen === "function" &&
      typeof Scheduler.lapsedWindowText === "function"));

  // --- Designed cadence constants (§4 Gap 3) -------------------------------
  check("19f: cadence is 5s active / 30s backoff / 10min idle / 30min stop / 24h window",
    Scheduler.ACTIVE_POLL_MS === 5000 &&
    Scheduler.BACKOFF_POLL_MS === 30000 &&
    Scheduler.IDLE_TO_BACKOFF_MS === 10 * 60 * 1000 &&
    Scheduler.IDLE_TO_STOP_MS === 30 * 60 * 1000 &&
    Scheduler.REPLY_WINDOW_MS === 24 * 3600 * 1000,
    JSON.stringify({
      active: Scheduler.ACTIVE_POLL_MS, backoff: Scheduler.BACKOFF_POLL_MS,
      toBackoff: Scheduler.IDLE_TO_BACKOFF_MS, toStop: Scheduler.IDLE_TO_STOP_MS,
      window: Scheduler.REPLY_WINDOW_MS,
    }));

  // --- active -> backoff -> stop on the fake clock --------------------------
  {
    const s = freshScheduler();
    check("19f: fresh scheduler polls at the 5s cadence",
      s.phaseAt(t, false) === "active" && s.intervalAt(t, false) === 5000,
      JSON.stringify(s.snapshot(t, false)));
    t = at(9) + 59 * 1000; // 9:59 idle
    check("19f: still active just under 10 min idle",
      s.phaseAt(t, false) === "active" && s.intervalAt(t, false) === 5000);
    t = at(10); // exactly 10 min idle
    check("19f: backs off to 30s after 10 min with no inbound and no pending turn",
      s.phaseAt(t, false) === "backoff" && s.intervalAt(t, false) === 30000,
      JSON.stringify(s.snapshot(t, false)));
    t = at(29) + 59 * 1000; // 29:59 idle
    check("19f: still backing off (not stopped) just under 30 min idle",
      s.phaseAt(t, false) === "backoff" && s.intervalAt(t, false) === 30000);
    t = at(30); // exactly 30 min idle
    check("19f: stops polling entirely after 30 min idle",
      s.phaseAt(t, false) === "stopped" && s.intervalAt(t, false) === null,
      JSON.stringify(s.snapshot(t, false)));
  }

  // --- document.hidden stops immediately; resume restarts at 5s ------------
  {
    const s = freshScheduler();
    check("19f: hidden tab stops polling even while otherwise active",
      s.phaseAt(t, true) === "stopped" && s.intervalAt(t, true) === null);
    t = at(45); // long idle, tab visible again but nothing acted yet
    check("19f: stayed stopped after 30 min idle until something resumes it",
      s.phaseAt(t, false) === "stopped");
    s.noteOperatorAction(t); // visibility/focus/operator action
    check("19f: operator/user action resumes the 5s cadence",
      s.phaseAt(t, false) === "active" && s.intervalAt(t, false) === 5000);
  }

  // --- new inbound items keep the conversation active -----------------------
  {
    const s = freshScheduler();
    t = at(9);
    s.noteInboundPoll(2, t); // two fresh items at 9 min
    t = at(18); // 9 min after the activity — still active, not backoff
    check("19f: fresh inbound items reset the idle clock (active, 5s)",
      s.phaseAt(t, false) === "active" && s.intervalAt(t, false) === 5000,
      JSON.stringify(s.snapshot(t, false)));
    t = at(19); // 10 min after the last activity
    check("19f: backoff measured from the last inbound, not from start",
      s.phaseAt(t, false) === "backoff" && s.intervalAt(t, false) === 30000);
    const before = JSON.stringify(s.snapshot(t, false));
    s.noteInboundPoll(0, t); // an empty poll is not activity
    check("19f: an empty poll (0 new items) does not reset the idle clock",
      JSON.stringify(s.snapshot(t, false)) === before);
  }

  // --- a pending assistant turn holds the active cadence -------------------
  {
    const s = freshScheduler();
    t = at(9);
    s.setPendingTurn(true, t);
    t = at(25); // 16 min idle but a turn is still pending
    check("19f: pending assistant turn keeps the 5s cadence past 10 min idle",
      s.phaseAt(t, false) === "active" && s.intervalAt(t, false) === 5000,
      JSON.stringify(s.snapshot(t, false)));
    s.setPendingTurn(false, t);
    check("19f: clearing the pending turn lets the idle clock back off",
      s.phaseAt(t, false) === "backoff" && s.intervalAt(t, false) === 30000);
  }

  // --- checkbox kill-switch -------------------------------------------------
  {
    const s = freshScheduler();
    s.setEnabled(false);
    check("19f: disabling (auto-refresh unchecked) stops polling",
      s.phaseAt(t, false) === "stopped" && s.intervalAt(t, false) === null);
    s.setEnabled(true);
    check("19f: re-enabling resumes the 5s cadence",
      s.phaseAt(t, false) === "active" && s.intervalAt(t, false) === 5000);
  }

  // --- isWindowOpen: user-anchored 24h pure check ---------------------------
  {
    const now = T0;
    const hourAgo = new Date(T0 - 3600 * 1000).toISOString();
    const dayAgo = new Date(T0 - 25 * 3600 * 1000).toISOString();
    check("19f: window open for a user active 1h ago",
      Scheduler.isWindowOpen(hourAgo, now) === true);
    check("19f: window closed for a user idle 25h (stale)",
      Scheduler.isWindowOpen(dayAgo, now) === false);
    check("19f: window closed with no anchor / garbage / future timestamps",
      Scheduler.isWindowOpen(null, now) === false &&
      Scheduler.isWindowOpen("not-a-time", now) === false &&
      Scheduler.isWindowOpen(new Date(T0 + 3600 * 1000).toISOString(), now) === false);
  }

  // --- checkSendWindow against the REAL 19c catalog (user-keyed anchor) -----
  {
    const nowIso = new Date(T0).toISOString();
    const freshCat = Catalog.createCatalog({ userKey: "SYNTH_user_19f_fresh" });
    freshCat.noteInboundShare({
      shareId: "SYNTH_mid_19f_fresh",
      receivedAt: new Date(T0 - 3600 * 1000).toISOString(),
    });
    const freshGate = Scheduler.checkSendWindow(freshCat, nowIso);
    check("19f: pre-send gate allows a turn inside the user-anchored window",
      freshGate.allowed === true && freshGate.threadText === null,
      JSON.stringify(freshGate));

    // Stale user: latest inbound 30h ago (synthetic fixture, > 24h).
    const staleCat = Catalog.createCatalog({ userKey: "SYNTH_user_19f_stale" });
    staleCat.noteInboundShare({
      shareId: "SYNTH_mid_19f_stale_old",
      receivedAt: new Date(T0 - 30 * 3600 * 1000).toISOString(),
    });
    let staleGate = null;
    let threw = false;
    try {
      staleGate = Scheduler.checkSendWindow(staleCat, nowIso);
    } catch (err) {
      threw = true;
    }
    check("19f: stale-user turn never throws",
      threw === false && staleGate !== null);
    check("19f: stale-user turn returns the 422 path (not a silent drop)",
      staleGate && staleGate.allowed === false && staleGate.status === 422,
      JSON.stringify(staleGate));
    check("19f: stale-user text says plainly the window has lapsed (honest 422)",
      typeof staleGate.threadText === "string" &&
      staleGate.threadText.indexOf("422") !== -1 &&
      /window.*(lapsed|closed|expired)|(lapsed|closed|expired).*window/i.test(staleGate.threadText),
      (staleGate.threadText || "").slice(0, 160));
    check("19f: pre-send 422 wording matches the send-client's server-422 wording",
      staleGate.threadText === SendClient.describeForThread({
        ok: false, status: 422,
        body: { error: "reply_window_expired" }, error: "reply_window_expired",
      }),
      (staleGate.threadText || "").slice(0, 160));
    check("19f: stale-user text invents no listing and no fake error",
      staleGate.threadText.indexOf("$") === -1 &&
      !/^sent|delivered|message_id/i.test(staleGate.threadText) &&
      !/silk|cotton|linen|wool|in stock|ships in/i.test(staleGate.threadText),
      (staleGate.threadText || "").slice(0, 200));

    // No inbound yet: honestly unknown — draft, never queued blindly.
    const emptyCat = Catalog.createCatalog({ userKey: "SYNTH_user_19f_empty" });
    const emptyGate = Scheduler.checkSendWindow(emptyCat, nowIso);
    check("19f: no-inbound user is gated as unknown-window draft (not sent, not thrown)",
      emptyGate.allowed === false && emptyGate.status === 0 &&
      /draft/i.test(emptyGate.threadText || ""),
      JSON.stringify(emptyGate));

    // A catalog anchored to the NEWEST inbound stays open even when an
    // older share exists — the anchor is user-keyed, not per-share.
    const mixedCat = Catalog.createCatalog({ userKey: "SYNTH_user_19f_mixed" });
    mixedCat.noteInboundShare({
      shareId: "SYNTH_mid_19f_mixed_old",
      receivedAt: new Date(T0 - 30 * 3600 * 1000).toISOString(),
    });
    mixedCat.noteInboundShare({
      shareId: "SYNTH_mid_19f_mixed_new",
      receivedAt: new Date(T0 - 3600 * 1000).toISOString(),
    });
    const mixedGate = Scheduler.checkSendWindow(mixedCat, nowIso);
    check("19f: window anchors to the user's LATEST inbound, not an old share",
      mixedGate.allowed === true,
      JSON.stringify(mixedGate));
  }

  // --- stale turn end-to-end: real mock bot 422 + in-thread surfacing ------
  {
    ({ server, store } = await startServer({ port: 0, token: TOKEN }));
    base = `http://127.0.0.1:${server.address().port}`;
    const staleAt = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    store.shares.push({
      id: "SYNTH_mid_19f_live_stale",
      received_at: staleAt,
      attachment: {
        type: "text",
        payload: { text: "SYNTH stale user turn fixture" },
      },
      media_id: null,
      media_available: false,
    });
    const client = SendClient.createSendClient({ base, token: TOKEN });
    const sent = await client.sendTurn({
      shareId: "SYNTH_mid_19f_live_stale",
      text: "SYNTH assistant reply to a stale user",
    });
    check("19f: mock bot still rules 422 reply_window_expired for the stale share",
      sent.ok === false && sent.status === 422 && sent.body.error === "reply_window_expired",
      `${sent.status} ${JSON.stringify(sent.body).slice(0, 120)}`);
    const threadText = SendClient.describeForThread(sent);
    check("19f: server 422 surfaces in-thread as readable text (not silent, not thrown)",
      threadText.indexOf("422") !== -1 && /window/i.test(threadText),
      threadText.slice(0, 160));
    // And the client-side pre-send gate agrees without any POST:
    // a catalog anchored to that same stale received_at blocks first.
    const gateCat = Catalog.createCatalog({ userKey: "SYNTH_user_19f_live" });
    gateCat.noteInboundShare({ shareId: "SYNTH_mid_19f_live_stale", receivedAt: staleAt });
    const gate = Scheduler.checkSendWindow(gateCat);
    check("19f: client gate blocks the stale turn BEFORE any send is attempted",
      gate.allowed === false && gate.status === 422 && gate.threadText === threadText,
      (gate.threadText || "").slice(0, 160));
  }

  // --- isolation walk: no new external network dependency -------------------
  {
    const modSrc = fs.readFileSync(path.join(__dirname, "..", "poll-scheduler.js"), "utf8");
    const code = modSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^\S\n])\/\/[^\n]*/g, "$1");
    const requires = [...code.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
    check("19f: scheduler requires no network modules (only sibling 19b/19c or stdlib)",
      requires.every((r) => /^\.\//.test(r)),
      JSON.stringify(requires));
    check("19f: scheduler issues no requests itself (no fetch/XHR/http.request/get)",
      !/fetch\s*\(|XMLHttpRequest|http\.(request|get)\s*\(|net\.connect|WebSocket/.test(code));
    check("19f: scheduler hardcodes no hosts at all (no new endpoints)",
      !/https?:\/\/|127\.0\.0\.1|:\d{3,5}/.test(code));
    const page = fs.readFileSync(path.join(__dirname, "..", "mock-dm.html"), "utf8");
    const inlineScripts = [...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((m) => m[1]).join("\n");
    const absFetches = [...inlineScripts.matchAll(/fetch\(\s*[`'"]([^`'"]+)/g)].map((m) => m[1]);
    check("19f: page still fetches only same-origin + the mock bot base (no new hosts)",
      absFetches.every((u) => !/^https?:\/\//.test(u)),
      JSON.stringify(absFetches.slice(0, 5)));
    check("19f: page loads the scheduler module and drives cadence off it",
      /src="poll-scheduler\.js"/.test(page) &&
      /intervalAt/.test(inlineScripts) && /visibilitychange/.test(inlineScripts) &&
      /preSendWindowBlock/.test(inlineScripts));
    check("19f: fixed 5s setInterval is gone (adaptive scheduler owns the timer)",
      !/setInterval\s*\(\s*refreshThread/.test(inlineScripts));
  }

  // --- interface-agnostic: no IG / fabric / price / vendor fields ------------
  // (comments stripped first, same as the M13 task11 walk — the header
  // documents the descoping, the live code must not carry the fields).
  {
    const modSrc = fs.readFileSync(path.join(__dirname, "..", "poll-scheduler.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^\S\n])\/\/[^\n]*/g, "$1")
      .toLowerCase();
    const hit = BANNED_KEYS.find((k) => new RegExp(`\\b${k}\\b`).test(modSrc));
    check("19f: scheduler carries no IG-specific or fabric/price/vendor fields",
      hit === undefined, hit || "");
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
