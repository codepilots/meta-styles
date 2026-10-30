"use strict";
/* meta-styles Milestone 20 — persistent wardrobe service (NEW hackathon work,
 * building period Oct 27 – Nov 4, 2026).
 *
 * The problem it closes (verified real incident 2026-10-30): the browser's
 * auto-reply wiring kept "already replied" memory in each tab's own
 * localStorage — not shared, not server-side. Two tabs polling the same
 * account both believed "I haven't sent this yet" and both sent for real
 * (same share_id, ~35 minutes apart, `status=200 result=sent` twice in the
 * bot's own logs). This service is the SOLE writer/sender: one process
 * owns the poll loop, so there is exactly one place that decides "have I
 * already handled this share" — no cross-tab race possible.
 *
 * Architecture (docs/milestone-20-persistent-node-service.md §1):
 * stdlib-only Node (no npm dependency — same convention as
 * mock-ig-bot/server.js and meta-api-proxy/server.js). Dual mode via
 * LIVE_IG=1 exactly like start.sh: mock 8904 default, real 8903 opt-in.
 * Reuses every §1.2 module via require (assembler, classifier, spark,
 * turn-loop, wardrobe-catalog, send-client, poll-scheduler, inbox-bridge
 * pure half, meta-client); app/preview.js and app/app.js are NOT reused
 * (browser-only) and server-side preview is deliberately not staged —
 * sends are text-only in BOTH modes because outbound-image staging is a
 * mock-only route with no live counterpart, and attaching images only in
 * mock mode would BE a forbidden mock/live fork (same stated reason as
 * the retired auto-reply wiring).
 *
 * STORAGE RULE (non-negotiable): ALL catalog/wardrobe data lives in the
 * bot via the existing wardrobe-catalog PUT/GET contract (createCatalog
 * + createCatalogStore + catalog.save()/load()). The service keeps NO
 * separate file, DB, or second schema for piece/turn data — zero local
 * store. The only local/in-memory state is transient runtime state that
 * needs no restart durability: the poll cursor, the in-memory
 * handled-set, per-share attempt counts, cached per-user contexts, and
 * the status ring. Restart recovery is enforced by the BOT, not by local
 * state: (a) photo shares already catalogued match source_share_id and
 * are skipped without re-sending; (b) any re-attempted send carries
 * byte-identical deterministic text (stub copy — see below), so the
 * bot's own duplicate_send rule (same share + same text + fresh key ->
 * 409) refuses the second send. The dedicated duplicate-send regression
 * test proves exactly one outbound send per share across restarts and
 * concurrent pollers.
 *
 * Deterministic-copy note: turn-loop's o.copy slot is synchronous, so a
 * live LLM copy cannot be injected without reimplementing the loop — and
 * reimplementing is exactly what §1.2 forbids. The service therefore uses
 * the same labelled stub copy the judged path uses. That is also what
 * makes the duplicate_send backstop airtight: regeneration is
 * byte-identical, so a reprocessed share deterministically 409s instead
 * of sending a second, differently-worded reply. A live (nondeterministic)
 * copy would defeat the backstop. Classify IS live-via-proxy with the
 * labelled heuristic fallback (async-friendly, proven path).
 *
 * Cursor rule (uniform for the mock's numeric paging and the real bot's
 * opaque next_cursor, which is only ever echoed, never interpreted): the
 * cursor advances to a page's next_cursor only when EVERY item on that
 * page reached a terminal outcome. Otherwise the cursor stays and the
 * page replays next tick; terminal items skip via the handled-set, so
 * re-offer is safe and nothing strands. Per-share attempt counts bound
 * wedging: after 5 unsuccessful attempts a share goes terminal
 * (error_gave_up) with an honest activity line — a restart replays it
 * with a fresh count, so give-up is never silent loss.
 *
 * Poll cadence reuses the poll-scheduler state machine with the
 * document.hidden arm dropped (no DOM server-side — the "stop when
 * hidden" arm is replaced by: keep polling while the process lives, with
 * the idle backoff arms retained). The stopped phase is clamped to the
 * 30s backoff interval rather than halting, because halting IS the bug
 * this service exists to prevent.
 *
 * Run: node wardrobe-service/server.js (env per config.js; see
 * wardrobe-service/config.js for the full contract).
 * Status: GET /wardrobe/status (public, loopback-only, CORS *, never any
 * token, id, or user_ref — plain-language activity lines only).
 */

var http = require("http");

var Config = require("./config.js");
var Bridge = require("../app/inbox-bridge.js");
var Wardrobe = require("../app/wardrobe-catalog.js");
var Assembler = require("../app/assembler.js");
var Classifier = require("../app/classifier.js");
var Spark = require("../app/spark.js");
var TurnLoop = require("../app/turn-loop.js");
var SendClient = require("../app/send-client.js");
var Scheduler = require("../app/poll-scheduler.js");

var PAGE_LIMIT = 50;
var MAX_ATTEMPTS = 5;
var ACTIVITY_RING = 30;
var STOPPED_CLAMP_MS = Scheduler.BACKOFF_POLL_MS;

// Plain nouns for the status activity feed — category slugs stay in code,
// never in front of a watcher. (Same convention as the retired browser
// wiring: no tokens, no share/message ids, no API dumps in log lines.)
var CATEGORY_NOUNS = {
  "base/top": "top",
  "base/bottom": "bottoms",
  "dress": "dress",
  "layer/cardigan": "cardigan layer",
  "layer/blazer": "blazer layer",
  "scarf": "scarf",
  "bag": "bag",
};

function nounFor(category) {
  return CATEGORY_NOUNS[category] || "piece";
}

function indefinite(noun) {
  return (/^[aeiou]/i.test(noun) ? "an " : "a ") + noun;
}

function shortText(text, max) {
  var t = String(text || "");
  if (t.length <= max) return t;
  return t.slice(0, max) + "…";
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// meta-client captures its proxy base once at require time, so the
// service defaults globalThis.__IG_RUNTIME__.proxyBase BEFORE the first
// require — and never overwrites a value already present (tests point it
// at an unreachable port to force the labelled fallback deterministically,
// exactly like the M19 suites do). One proxy base per process: a documented
// consequence of reusing the module as-is via require.
function metaClient(proxyBase) {
  try {
    if (!globalThis.__IG_RUNTIME__) globalThis.__IG_RUNTIME__ = {};
    if (!globalThis.__IG_RUNTIME__.proxyBase) {
      globalThis.__IG_RUNTIME__.proxyBase = proxyBase;
    }
    return require("../app/meta-client.js");
  } catch (err) {
    return null;
  }
}

function base64Of(bytes) {
  var buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return buf.toString("base64");
}

function captionHint(item) {
  var payload = (item.attachment && item.attachment.payload) || {};
  var title = typeof payload.title === "string" ? payload.title : "";
  return title.slice(0, 40);
}

function createService(opts) {
  var o = opts || {};
  var botBase = String(o.botBase || Config.MOCK_BOT_BASE).replace(/\/+$/, "");
  var proxyBase = String(o.proxyBase || Config.PROXY_BASE).replace(/\/+$/, "");
  var readToken = typeof o.readToken === "string" ? o.readToken : "";
  var catalogToken = typeof o.catalogToken === "string" ? o.catalogToken : readToken;
  var sendToken = typeof o.sendToken === "string" ? o.sendToken : readToken;
  var port = o.port !== undefined ? o.port : Config.DEFAULT_PORT;
  var mode = o.mode === "live" ? "live" : "mock";
  var demoUserKey = o.demoUserKey || Config.DEMO_USER_KEY;
  var demoUserRef = o.demoUserRef || Config.DEMO_USER_REF;
  var nowMs = typeof o.nowMs === "function" ? o.nowMs : Date.now;

  var Meta = metaClient(proxyBase);

  var scheduler = Scheduler.createPollScheduler({});
  var users = new Map(); // userRef -> { catalog, loop, send, loaded }
  var handled = new Map(); // shareId -> terminal outcome string
  var attempts = new Map(); // shareId -> unsuccessful-attempt count
  var deferredLogged = {}; // shareId -> true (pending-media notice said once)
  var activity = [];
  var counts = {
    polled: 0, processed: 0, sent: 0, skipped: 0,
    duplicates: 0, errors: 0, gave_up: 0,
  };
  var livePaths = { classify: "unprobed", copy: "stub", preview: "not-staged" };
  var cursor = null;
  var cursorEverSet = false;
  var startedAt = new Date(nowMs()).toISOString();
  var lastProcessedShareAt = null;
  var lastTurnText = "";
  var lastError = null;
  var tickInFlight = false;
  var timer = null;
  var server = null;

  function say(text) {
    activity.push("[" + new Date(nowMs()).toLocaleTimeString() + "] " + text);
    if (activity.length > ACTIVITY_RING) activity = activity.slice(-ACTIVITY_RING);
  }

  function authHeaders(token) {
    return { Authorization: "Bearer " + token };
  }

  // Lazy per-sender wardrobe context. MOCK mode uses the single fixed demo
  // identity (the mock bot has no sender model); LIVE mode keys EVERYTHING
  // by the real per-sender item.user_ref the bot already provides — one
  // sender's shares are catalogued into their own catalog via their own
  // ref, never a shared bucket. userKey takes the opaque ref (never a raw
  // identifier — user_ref IS the opaque id the bot supplies).
  function userContext(userRef) {
    var hit = users.get(userRef);
    if (hit) return hit;
    var isDemo = mode === "mock";
    var store = null;
    try {
      if (typeof Wardrobe.createCatalogStore === "function") {
        store = Wardrobe.createCatalogStore({
          base: botBase, token: catalogToken, userRef: userRef,
        });
      }
    } catch (err) {
      store = null;
    }
    var catalog = Wardrobe.createCatalog({
      userKey: isDemo ? demoUserKey : userRef, store: store,
    });
    var loop = TurnLoop.createTurnLoop({
      userKey: isDemo ? demoUserKey : userRef,
      catalog: catalog,
      validate: Assembler.assembleLook,
      copy: Spark.generateCopy,
    });
    var send = SendClient.createSendClient({ base: botBase, token: sendToken });
    var ctx = { catalog: catalog, loop: loop, send: send, loaded: false };
    users.set(userRef, ctx);
    return ctx;
  }

  function ensureLoaded(ctx) {
    if (ctx.loaded) return Promise.resolve(ctx);
    ctx.loaded = true; // load once per process; a failed load degrades to memory-only
    if (!ctx.catalog.store || typeof ctx.catalog.load !== "function") {
      return Promise.resolve(ctx);
    }
    return ctx.catalog.load().then(function (res) {
      if (!res.ok) say("Couldn't load the saved wardrobe — starting fresh this session.");
      return ctx;
    }, function () {
      say("Couldn't load the saved wardrobe — starting fresh this session.");
      return ctx;
    });
  }

  function piecesCount() {
    var n = 0;
    users.forEach(function (ctx) {
      try {
        n += ctx.catalog.getActivePieces().length;
      } catch (err) {
        // A broken catalog instance must never break the status endpoint.
      }
    });
    return n;
  }

  function statusBody() {
    return {
      service: "wardrobe-service",
      mode: mode,
      bot_base: botBase,
      proxy_base: proxyBase,
      started_at: startedAt,
      updated_at: new Date(nowMs()).toISOString(),
      cursor_set: cursorEverSet,
      last_processed_share: lastProcessedShareAt,
      pieces_count: piecesCount(),
      users_known: users.size,
      last_turn_text: lastTurnText,
      counts: Object.assign({}, counts),
      live_paths: Object.assign({}, livePaths),
      activity: activity.slice(),
      last_error: lastError,
    };
  }

  // --- Bot I/O (same contracts inbox-bridge.js already calls) --------------

  function fetchSharesPage() {
    var url = botBase + "/ig/shares?limit=" + PAGE_LIMIT;
    if (cursor !== null && cursor !== undefined && cursor !== "") {
      url += "&since=" + encodeURIComponent(String(cursor));
    }
    return fetch(url, { headers: authHeaders(readToken) }).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        var auth = new Error("bot rejected the service credential (HTTP " + res.status + ")");
        auth.code = "auth";
        throw auth;
      }
      if (res.status === 400) {
        var bad = new Error("bot rejected the poll cursor; will restart from the beginning");
        bad.code = "badCursor";
        throw bad;
      }
      if (!res.ok) throw new Error("shares HTTP " + res.status);
      return res.json();
    }).then(function (body) {
      var raw = body && Array.isArray(body.items) ? body.items : [];
      var next = body && typeof body.next_cursor === "string" ? body.next_cursor : null;
      return { items: raw.filter(Bridge.isValidShareItem), nextCursor: next };
    });
  }

  function fetchMediaBytes(mediaId) {
    return fetch(botBase + "/ig/media/" + encodeURIComponent(mediaId), {
      headers: authHeaders(readToken),
    }).then(function (res) {
      if (!res.ok) throw new Error("media HTTP " + res.status);
      var ct = "image/jpeg";
      try {
        ct = res.headers.get("content-type") || ct;
      } catch (err) {
        // Keep the default.
      }
      return res.arrayBuffer().then(function (buf) {
        return "data:" + ct + ";base64," + base64Of(new Uint8Array(buf));
      });
    });
  }

  // Collect-then-delete acknowledgement, best-effort: ONLY after the bytes
  // are in hand AND catalogued (the inbox-bridge rule), never before.
  function acknowledgeMedia(mediaId) {
    return fetch(botBase + "/ig/media/" + encodeURIComponent(mediaId), {
      method: "DELETE",
      headers: authHeaders(readToken),
    }).then(function () { return null; }, function () { return null; });
  }

  // One photo, classified: live Muse Spark vision via the proxy when it
  // answers, otherwise the labelled on-device heuristic (placeholder).
  // Resolves { category, live } or { category: null } — never rejects.
  function classifyPhoto(item, hint) {
    function fallback() {
      var region = { kind: "box", rect: [0.2, 0.2, 0.6, 0.6], labelHint: hint || "" };
      try {
        var r = Classifier.classifyRegion(region);
        if (r && typeof r.category === "string") return { category: r.category, live: false };
      } catch (err) {
        // Fall through to unknown below.
      }
      return { category: null, live: false };
    }
    var canTryLive = !!(item.media_id && Meta && typeof Meta.classify === "function");
    if (!canTryLive) {
      livePaths.classify = livePaths.classify === "live" ? "live" : "fallback";
      return Promise.resolve(fallback());
    }
    return fetchMediaBytes(item.media_id).then(function (dataURL) {
      return Meta.classify(dataURL, hint).then(function (sparkRes) {
        try {
          var region = { kind: "box", rect: [0.2, 0.2, 0.6, 0.6], labelHint: hint || "" };
          var mapped = Classifier.classifyFromSpark(region, sparkRes);
          if (mapped && typeof mapped.category === "string") {
            livePaths.classify = "live";
            return { category: mapped.category, live: true };
          }
        } catch (err) {
          // Off-shape model output falls back below.
        }
        livePaths.classify = livePaths.classify === "live" ? "live" : "fallback";
        return fallback();
      }, function () {
        livePaths.classify = livePaths.classify === "live" ? "live" : "fallback";
        return fallback();
      });
    }, function () {
      throw new Error("media_unavailable");
    });
  }

  function saveBestEffort(ctx) {
    try {
      var r = ctx.catalog.save();
      if (r && typeof r.then === "function") {
        return r.then(function () { return null; }, function () { return null; });
      }
    } catch (err) {
      // Best-effort only: the reply already went out.
    }
    return Promise.resolve(null);
  }

  // --- Per-share processing -------------------------------------------------
  // Resolves "terminal:<outcome>" (handled — cursor may advance past it) or
  // "retry" (not handled — the cursor stays so the page replays and this
  // share is re-offered). Retryable shares are attempt-counted; after
  // MAX_ATTEMPTS they go terminal with an honest line instead of wedging
  // the queue forever.

  function noteTerminal(id, outcome, processed, sent) {
    handled.set(id, outcome);
    attempts.delete(id);
    counts.processed += processed ? 1 : 0;
    counts.sent += sent ? 1 : 0;
    return Promise.resolve("terminal:" + outcome);
  }

  function noteRetry(id) {
    var n = (attempts.get(id) || 0) + 1;
    if (n >= MAX_ATTEMPTS) {
      counts.gave_up += 1;
      say("Gave up on a message after several tries — it stays in the inbox and will be retried after a restart.");
      return noteTerminal(id, "gave_up", true, false);
    }
    attempts.set(id, n);
    counts.errors += 1;
    return Promise.resolve("retry");
  }

  function sendComposed(ctx, shareId, text) {
    return ctx.send.sendTurn({ shareId: shareId, text: text }).then(function (result) {
      if (result && result.ok) {
        say("Sent a reply.");
        return saveBestEffort(ctx).then(function () {
          lastTurnText = shortText(text, 280);
          return noteTerminal(shareId, "sent", true, true);
        });
      }
      if (result && result.status === 409 &&
        (result.error === "duplicate_send" || result.error === "idempotency_key_reused")) {
        // The bot itself refused the second send: for duplicate_send the
        // reply text already went out under a fresh key (restart replay or
        // a second poller); for idempotency_key_reused the stored result
        // stands. Either way: terminal, never a retry — this branch is the
        // server-side backstop that makes double-sending impossible.
        counts.duplicates += 1;
        say("That reply already went out — keeping the earlier one.");
        return saveBestEffort(ctx).then(function () {
          return noteTerminal(shareId, "duplicate", true, false);
        });
      }
      if (result && result.status === 422) {
        say("Reply window expired, didn't send a reply.");
        return noteTerminal(shareId, "window_closed", true, false);
      }
      // Transport failure, auth failure, or any other HTTP status:
      // retryable — the cursor stays so this share is re-offered.
      if (result && (result.status === 401 || result.status === 403)) {
        lastError = "bot rejected the service send credential (HTTP " + result.status + ")";
        say("Couldn't send — the bot didn't accept the service login. Will try again.");
      } else {
        say("Couldn't reach the bot — will try again on the next check.");
      }
      return noteRetry(shareId);
    }, function () {
      say("Couldn't reach the bot — will try again on the next check.");
      return noteRetry(shareId);
    });
  }

  function processTextShare(ctx, item, id) {
    var text = "";
    try {
      text = Bridge.textOf(item);
    } catch (err) {
      text = "";
    }
    var turned;
    try {
      turned = ctx.loop.handleTextTurn(text, { shareId: id, receivedAt: item.received_at });
    } catch (err) {
      return noteRetry(id);
    }
    if (turned.noData) {
      say("Answered: no fabric or price data available.");
    } else if (turned.revised) {
      say("You asked for a change — updated your wardrobe and re-checked the fit.");
    } else if (turned.best && turned.best.card && turned.best.card.valid) {
      say("Replied to your message with a full look.");
    } else {
      say("Replied to your message — not a full look yet, said why.");
    }
    return sendComposed(ctx, id, turned.text);
  }

  function processPhotoShare(ctx, item, id) {
    var hint = captionHint(item);
    return classifyPhoto(item, hint).then(function (found) {
      if (!found || !found.category) {
        if (!deferredLogged[id]) {
          say("Couldn't make sense of that photo — will try again on the next check.");
        }
        return noteRetry(id);
      }
      var composed;
      try {
        composed = ctx.loop.handlePhotoShare(
          { shareId: id, receivedAt: item.received_at },
          [{ category: found.category, attributes: {} }]
        );
      } catch (err) {
        return noteRetry(id);
      }
      var lead = "Catalogued " + indefinite(nounFor(found.category)) + " from your photo. " +
        (composed.best && composed.best.card && composed.best.card.valid
          ? "Proposed a full look."
          : "Not a full look yet — explained why.");
      say(lead);
      if (!found.live) {
        say("Couldn't reach the styling service, used the on-device fallback.");
      }
      return sendComposed(ctx, id, composed.text).then(function (outcome) {
        // Media ack ONLY after bytes were in hand and catalogued (the
        // inbox-bridge rule) — best-effort, never blocking the outcome.
        if (item.media_id) acknowledgeMedia(item.media_id);
        return outcome;
      });
    }, function (err) {
      // Media fetch failed (photo not yet downloadable): defer, no
      // terminal mark — the cursor stays and this share is re-offered.
      if (String((err && err.message) || err) === "media_unavailable") {
        if (!deferredLogged[id]) {
          deferredLogged[id] = true;
          say("Your photo isn't ready yet — I'll try again on the next check.");
        }
        return noteRetry(id);
      }
      return noteRetry(id);
    });
  }

  function processOne(item) {
    var id = item && typeof item.id === "string" ? item.id : null;
    if (!id) return Promise.resolve("terminal:ignored");
    if (handled.has(id)) {
      counts.skipped += 1;
      return Promise.resolve("terminal:" + handled.get(id));
    }
    if (SendClient.shouldProcess(item) === false) {
      // The bot's own echoed-back send — never processed, never replied to.
      return noteTerminal(id, "echo", false, false);
    }

    // Sender identity: LIVE mode keys everything by the real per-sender
    // item.user_ref; MOCK mode uses the single fixed demo ref. A live
    // share with no usable sender ref cannot be keyed to any wardrobe, so
    // it is terminally skipped with an honest line (never guessed).
    var userRef;
    if (mode === "mock") {
      userRef = demoUserRef;
    } else if (typeof item.user_ref === "string" && item.user_ref) {
      userRef = item.user_ref;
    } else {
      counts.skipped += 1;
      say("Skipped a message with no sender identity — it can't be filed to any wardrobe.");
      return noteTerminal(id, "no_sender", false, false);
    }

    var ctx = userContext(userRef);
    return ensureLoaded(ctx).then(function () {
      var isText = Bridge.isTextItem(item) === true;
      if (!isText && !(item.attachment &&
        (item.attachment.type === "image" || item.attachment.type === "ig_post"))) {
        counts.skipped += 1;
        say("Got a message I don't understand yet — skipped it.");
        return noteTerminal(id, "unsupported", true, false);
      }
      if (!isText && item.media_available === false && !item.media_id && !item.media_file) {
        counts.skipped += 1;
        say("Got a message I don't understand yet — skipped it.");
        return noteTerminal(id, "unsupported", true, false);
      }
      if (!isText && item.media_available === false && item.media_id) {
        if (!deferredLogged[id]) {
          deferredLogged[id] = true;
          say("Your photo isn't ready yet — I'll try again on the next check.");
        }
        return noteRetry(id);
      }

      // 24h window BEFORE composing, user-anchored like the 19c catalog:
      // the share's own timestamp must be inside the window AND the
      // user's latest-inbound anchor must still be open. A lapsed window
      // records nothing it cannot send — terminal, honest line.
      var open = Scheduler.isWindowOpen(item.received_at, nowMs());
      try {
        ctx.catalog.noteInboundShare({ shareId: id, receivedAt: item.received_at });
      } catch (err) {
        open = false;
      }
      var gate = Scheduler.checkSendWindow(ctx.catalog);
      if (!open || !gate.allowed) {
        try {
          ctx.catalog.noteInboundShare({ shareId: id, receivedAt: item.received_at });
        } catch (err) {
          // Anchor already attempted above; the gate stays closed.
        }
        say("Reply window expired, didn't send a reply.");
        return noteTerminal(id, "window_closed", true, false);
      }

      lastProcessedShareAt = typeof item.received_at === "string" ? item.received_at : null;
      if (isText) return processTextShare(ctx, item, id);
      return processPhotoShare(ctx, item, id);
    });
  }

  // --- Poll loop -------------------------------------------------------------
  // One tick: fetch one page since the cursor, process items in order,
  // advance the cursor only when every item on the page is terminal.
  // A 400 on the cursor replays from the start once (the inbox-bridge
  // badCursor rule); any other fetch failure keeps the cursor and is
  // retried next tick.

  function tick() {
    if (tickInFlight) return Promise.resolve({ tick: "busy" });
    tickInFlight = true;
    scheduler.setPendingTurn(true);
    return fetchSharesPage().then(function (page) {
      var items = page.items || [];
      counts.polled += items.length;
      scheduler.noteInboundPoll(items.length);
      var chain = Promise.resolve();
      var outcomes = [];
      items.forEach(function (item) {
        chain = chain.then(function () {
          return processOne(item).then(function (outcome) {
            outcomes.push(outcome);
            return null;
          });
        });
      });
      return chain.then(function () {
        var allTerminal = outcomes.every(function (outcome) {
          return typeof outcome === "string" && outcome.indexOf("terminal:") === 0;
        });
        if (allTerminal && typeof page.nextCursor === "string") {
          cursor = page.nextCursor;
          cursorEverSet = true;
        }
        lastError = null;
        return { tick: "ok", items: items.length, outcomes: outcomes };
      });
    }, function (err) {
      if (err && err.code === "badCursor") {
        cursor = null;
        cursorEverSet = false;
        say("The inbox cursor went stale — re-checking from the beginning.");
      } else {
        lastError = String((err && err.message) || err);
        say("Couldn't reach the bot — will try again on the next check.");
      }
      return { tick: "error" };
    }).then(function (out) {
      tickInFlight = false;
      scheduler.setPendingTurn(false);
      return out;
    });
  }

  function scheduleNext() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    // Server-side the stopped phase never halts the loop (halting is the
    // bug being fixed) — it clamps to the 30s backoff instead. The hidden
    // arm is never passed (no DOM): intervalAt(now, false).
    var delay = scheduler.intervalAt(nowMs(), false);
    if (delay === null || delay === undefined) delay = STOPPED_CLAMP_MS;
    timer = setTimeout(function () {
      timer = null;
      tick().then(function () {
        if (server !== null) scheduleNext();
      }, function () {
        if (server !== null) scheduleNext();
      });
    }, delay);
    if (typeof timer.unref === "function") timer.unref();
  }

  // --- Status endpoint --------------------------------------------------------
  // GET /wardrobe/status only. Public loopback JSON for the thin client —
  // by construction it can NEVER carry a token, a share/message id, or a
  // user_ref: every field is a count, a timestamp, a mode string, or a
  // plain-language activity line. CORS * is safe for exactly that reason
  // (the mock static server is cross-origin to this port), and the
  // live-proxy serves the same path same-origin remotely.

  function requestHandler(req, res) {
    var url;
    try {
      url = new URL(req.url, "http://127.0.0.1");
    } catch (err) {
      url = { pathname: "" };
    }
    function finish(status, obj) {
      var body = JSON.stringify(obj);
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Content-Length": Buffer.byteLength(body),
      });
      res.end(body);
      try {
        console.log(req.method + " " + url.pathname + " " + status);
      } catch (err) {
        // Logging must never break serving.
      }
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/wardrobe/status") {
      finish(200, statusBody());
      return;
    }
    finish(404, { error: "not_found" });
  }

  function start() {
    return new Promise(function (resolve, reject) {
      server = http.createServer(requestHandler);
      server.once("error", function (err) {
        server = null;
        reject(err);
      });
      server.listen(port, "127.0.0.1", function () {
        say(mode === "live"
          ? "Wardrobe service started — watching your Instagram bot."
          : "Wardrobe service started — watching the demo bot.");
        scheduleNext();
        resolve({ port: server.address().port });
      });
    });
  }

  function stop() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    var srv = server;
    server = null;
    if (!srv) return Promise.resolve();
    return new Promise(function (resolve) {
      srv.close(function () { resolve(); });
    });
  }

  return {
    mode: mode,
    port: port,
    botBase: botBase,
    tick: tick,
    start: start,
    stop: stop,
    status: statusBody,
    processOne: processOne,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createService: createService, resolveConfig: Config.resolveConfig };
}

if (require.main === module) {
  // Launcher contract: start.sh exports the resolved env (parsed from
  // .env/secrets without printing, same pattern as the proxy launcher).
  // Direct runs work too: LIVE_IG=1 WARDROBE_READ_TOKEN=... node
  // wardrobe-service/server.js (see config.js for every variable).
  var cfg = Config.resolveConfig(process.env);
  var svc = createService({
    mode: cfg.mode,
    botBase: cfg.botBase,
    proxyBase: cfg.proxyBase,
    readToken: cfg.readToken,
    catalogToken: cfg.catalogToken,
    sendToken: cfg.sendToken,
    port: cfg.port,
    demoUserKey: cfg.demoUserKey,
    demoUserRef: cfg.demoUserRef,
  });
  svc.start().then(function (info) {
    console.log("wardrobe-service listening on 127.0.0.1:" + info.port +
      " (" + cfg.mode + " mode, bot " + cfg.botBase + ")");
  }).catch(function (err) {
    console.error("wardrobe-service failed to start: " + ((err && err.message) || err));
    process.exit(1);
  });
}

