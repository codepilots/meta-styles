"use strict";
/* meta-styles Milestone 19f — NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Polling cadence + pre-send reply-window discipline
 * (docs/milestone-19-chat-first-pivot.md §4 Gap 3, §7 task 6):
 *   - poll GET /ig/shares every 5s while the conversation is active;
 *   - after 10 minutes with no new inbound items and no pending
 *     assistant turn, back off to 30s;
 *   - after 30 minutes idle, or whenever document.hidden is true, stop
 *     polling entirely;
 *   - resume (restart at the 5s cadence) on the next visibility/focus
 *     event, or on any operator/user action (sending a message, clicking
 *     something that triggers a turn).
 * Plus the pre-send user-anchored 24h reply-window check: the window is
 * measured against THIS user's latest inbound received_at (user-keyed,
 * matching the 19c catalog anchor — never the old per-share one). Before
 * the client attempts a send it checks this window itself; when lapsed,
 * the reply surfaces the honest 422 wording (same text the 19b
 * send-client renders for a server 422) — never a fake error, never a
 * silent drop, never a fabricated listing.
 *
 * No new network dependency: this module issues no requests itself. It
 * reuses the 19c catalog's replyWindowStatus() and the 19b send-client's
 * describeForThread() for the 422 wording. The only endpoints ever
 * polled/sent are the ones 19a–19e already use (same bot/proxy, no new
 * hosts). Interface-agnostic: no IG-specific fields, no
 * fabric/price/vendor fields (fully descoped per §8.4).
 *
 * Runs in Node (module.exports) and in the browser demo page
 * (window.MetaStyles.pollScheduler) with zero dependencies beyond the
 * sibling 19b/19c modules, resolved lazily so the cadence state machine
 * works standalone. All ids/text synthetic (SYNTH_ prefix,
 * example.invalid URLs) — never real Instagram data.
 */

(function (root) {
  // Designed cadence (§4 Gap 3). Names are part of the contract the
  // demo page and the tests both read — do not renumber silently.
  var ACTIVE_POLL_MS = 5000; // 5s while the conversation is active
  var BACKOFF_POLL_MS = 30000; // 30s after 10 min with no activity
  var IDLE_TO_BACKOFF_MS = 10 * 60 * 1000; // 10 minutes
  var IDLE_TO_STOP_MS = 30 * 60 * 1000; // 30 minutes
  var REPLY_WINDOW_MS = 24 * 3600 * 1000; // 24h user-anchored reply window

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function toMs(value, fallback) {
    var ms = typeof value === "number" ? value : Date.parse(value);
    return typeof ms === "number" && !Number.isNaN(ms) ? ms : fallback;
  }

  function sibling(name) {
    if (root.MetaStyles && root.MetaStyles[name]) return root.MetaStyles[name];
    if (typeof require !== "undefined") {
      try {
        return require("./" + name + ".js");
      } catch (err) {
        return null;
      }
    }
    return null;
  }

  // Pure helper: is the user-anchored 24h window open for a user whose
  // latest inbound arrived at latestInboundAt (ISO string), evaluated at
  // nowMs? True only for a parseable inbound in the past and strictly
  // inside the window. Never throws.
  function isWindowOpen(latestInboundAt, nowMs) {
    var now = toMs(nowMs, Date.now());
    var inbound = Date.parse(latestInboundAt);
    if (typeof latestInboundAt !== "string" || Number.isNaN(inbound)) return false;
    var age = now - inbound;
    return age >= 0 && age < REPLY_WINDOW_MS;
  }

  // The honest 422 wording for a lapsed window, in one place. Reuses the
  // 19b send-client's describeForThread() so the pre-send gate and the
  // server-returned 422 read identically in-thread; falls back to the
  // same sentence if the sibling is unavailable (wording kept in sync
  // by the 19f tests). Never throws.
  function lapsedWindowText() {
    try {
      var sendClient = sibling("send-client");
      if (sendClient && typeof sendClient.describeForThread === "function") {
        return sendClient.describeForThread({
          ok: false,
          status: 422,
          body: { error: "reply_window_expired" },
          error: "reply_window_expired",
        });
      }
    } catch (err) {
      // Fall through to the inline wording below.
    }
    return "Not sent (HTTP 422 reply_window_expired): the 24h reply " +
      "window for this conversation has closed.";
  }

  // Pre-send gate. catalog is a 19c wardrobe-catalog instance (or any
  // object with replyWindowStatus(nowIso)); nowIso is optional (defaults
  // to now). Returns { allowed, status, threadText }: allowed turns carry
  // threadText null (caller sends normally); lapsed-window turns carry
  // status 422 and threadText naming the lapsed window plainly — the
  // caller renders that text in-thread and skips the POST. Never throws,
  // never invents a listing, never silently drops.
  function checkSendWindow(catalog, nowIso) {
    var status = null;
    try {
      if (catalog && typeof catalog.replyWindowStatus === "function") {
        status = catalog.replyWindowStatus(nowIso === undefined ? new Date().toISOString() : nowIso);
      }
    } catch (err) {
      status = null;
    }
    var reason = status && typeof status.reason === "string" ? status.reason : "window_unknown";
    var open = !!(status && status.open === true);
    if (open) {
      return { allowed: true, status: 200, threadText: null, reason: reason };
    }
    var lapsed = reason === "reply_window_expired";
    return {
      allowed: false,
      status: lapsed ? 422 : 0,
      threadText: lapsed
        ? lapsedWindowText()
        : "Not sent: reply window state is unknown — keeping this turn as an " +
          "unsent draft, never queued blindly.",
      reason: reason,
    };
  }

  // Cadence state machine (§4 Gap 3). Timer-agnostic on purpose: the
  // caller drives setTimeout off intervalAt() and feeds it inbound /
  // pending / action / visibility events, so tests run it on a fake
  // clock with no wall-clock waits.
  function createPollScheduler(opts) {
    var o = opts || {};
    var nowMs = typeof o.nowMs === "function" ? o.nowMs : Date.now;
    var startAt = toMs(o.startAtMs, nowMs());

    var lastActiveMs = startAt; // last inbound item, pending-turn start, or operator/user action
    var pending = false; // a pending assistant turn keeps the active cadence
    var enabled = o.enabled === undefined ? true : o.enabled !== false;

    function touch(atMs) {
      var t = toMs(atMs, nowMs());
      if (t > lastActiveMs) lastActiveMs = t;
    }

    // New inbound items arrived (count > 0) — conversation is active.
    function noteInboundPoll(count, atMs) {
      if (typeof count === "number" && count > 0) touch(atMs);
      return phaseAt(toMs(atMs, nowMs()), false);
    }

    // An assistant turn is (or is no longer) pending. Starting one
    // counts as activity; clearing one does not rewind the clock.
    function setPendingTurn(on, atMs) {
      pending = on === true;
      if (pending) touch(atMs);
      return phaseAt(toMs(atMs, nowMs()), false);
    }

    // Any operator/user action (send a message, click something that
    // triggers a turn, focus/visibility resume): activity + resume from
    // stopped back to the 5s cadence.
    function noteOperatorAction(atMs) {
      touch(atMs === undefined ? nowMs() : atMs);
      return phaseAt(toMs(atMs, nowMs()), false);
    }

    function setEnabled(on) {
      enabled = on === true;
    }

    // Current phase at (nowMs, hidden): "active" | "backoff" | "stopped".
    // hidden (document.hidden) stops polling immediately; 30 min idle
    // stops until the next resume; 10 min idle without a pending turn
    // backs off to 30s.
    function phaseAt(atMs, hidden) {
      var now = toMs(atMs, nowMs());
      if (!enabled || hidden === true) return "stopped";
      var idle = now - lastActiveMs;
      if (idle < 0) return "active";
      if (idle >= IDLE_TO_STOP_MS) return "stopped";
      if (idle >= IDLE_TO_BACKOFF_MS && !pending) return "backoff";
      return "active";
    }

    // Poll interval for the phase: 5000 | 30000 | null (stopped = do
    // not schedule; resume on the next visibility/focus/action event).
    function intervalAt(atMs, hidden) {
      var phase = phaseAt(atMs, hidden);
      if (phase === "active") return ACTIVE_POLL_MS;
      if (phase === "backoff") return BACKOFF_POLL_MS;
      return null;
    }

    function snapshot(atMs, hidden) {
      var now = toMs(atMs, nowMs());
      return {
        phase: phaseAt(now, hidden),
        intervalMs: intervalAt(now, hidden),
        pendingTurn: pending,
        idleMs: Math.max(0, now - lastActiveMs),
        enabled: enabled,
      };
    }

    return {
      noteInboundPoll: noteInboundPoll,
      setPendingTurn: setPendingTurn,
      noteOperatorAction: noteOperatorAction,
      setEnabled: setEnabled,
      phaseAt: phaseAt,
      intervalAt: intervalAt,
      snapshot: snapshot,
      isPending: function () { return pending; },
    };
  }

  var api = {
    ACTIVE_POLL_MS: ACTIVE_POLL_MS,
    BACKOFF_POLL_MS: BACKOFF_POLL_MS,
    IDLE_TO_BACKOFF_MS: IDLE_TO_BACKOFF_MS,
    IDLE_TO_STOP_MS: IDLE_TO_STOP_MS,
    REPLY_WINDOW_MS: REPLY_WINDOW_MS,
    isWindowOpen: isWindowOpen,
    lapsedWindowText: lapsedWindowText,
    checkSendWindow: checkSendWindow,
    createPollScheduler: createPollScheduler,
  };

  if (root.MetaStyles === undefined) root.MetaStyles = {};
  root.MetaStyles.pollScheduler = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
