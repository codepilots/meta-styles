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
 * (browser-only). Preview delivery follows each mode's real capability,
 * declared openly rather than forked silently: mock mode stages the
 * generated dataURL via POST /mock/stage-outbound-image and attaches it
 * to the send (image:true); live mode stays text-only because the real
 * bot has no staging route (its image:true path needs the file pre-placed
 * on the bot host, which no client route provides) and its Graph send
 * credential is still a placeholder. Generation vs delivery are reported
 * separately and honestly: live_paths.preview tracks whether the proxy
 * generated a dataURL, counts.images_delivered tracks bot-confirmed
 * image_message_ids, and each propose_look reply's meta.imageDelivery
 * states requested/generated/delivered and why not.
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
 * are skipped without re-sending; (b) every send reuses a stable
 * per-share idempotency key (wardrobe-send-v1:<share_id> — derived, never
 * stored), so any re-attempt replays the bot's stored result or 409s
 * instead of sending a second time. The dedicated duplicate-send
 * regression test proves exactly one outbound send per share across
 * restarts and concurrent pollers. (c) A photo share whose media is gone
 * (collected and deleted after the reply) but whose piece is catalogued
 * resolves terminal as already-answered — read-only match, never a
 * second send, and deliberately never an idempotent-send probe (a probe
 * would itself deliver a message for fresh shares, and would
 * duplicate-send shares first answered before the stable key existed).
 * (d) A media-gone share whose own timestamp is already outside the 24h
 * window resolves terminal window_closed at once — the send gate below
 * would refuse it anyway, so this only skips the futile retries.
 * Catalog saves stay best-effort (never block the reply) but are loud:
 * every failed save logs an activity line and bumps
 * counts.catalog_save_failed instead of vanishing silently.
 *
 * Restart-safety note: Spark copy is nondeterministic per call, so
 * byte-identical regeneration across restarts is impossible — safety
 * instead rests on the stable per-share idempotency key above (the send
 * spec's own retry rule: never retry a send with a new key). Same key +
 * same text replays the bot's stored result; same key + different text
 * 409s idempotency_key_reused; the bot's duplicate_send rule still catches
 * same-text replays from any other writer. Every outcome is terminal and
 * none is a second real send — with zero new local store (the key is
 * derived from the share id, not persisted) and no change to the catalog
 * PUT/GET contract. The local-fallback copy path stays deterministic;
 * classify IS live-via-proxy with the labelled heuristic fallback
 * (async-friendly, proven path).
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
var AgenticLoop = require("../app/agentic-loop.js");
var Router = require("../app/router.js");
var Summariser = require("../app/summariser.js");

var PAGE_LIMIT = 50;
var MAX_ATTEMPTS = 5;
var ACTIVITY_RING = 30;
var STOPPED_CLAMP_MS = Scheduler.BACKOFF_POLL_MS;
var MAX_TOOL_STEPS = 20;

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

  // Observed meta-client: same interface, but each route/assemble/preview
  // call updates livePaths from what actually happened — "live" when the
  // proxy answered, "fallback" when it threw (callers then use labelled
  // paths). Assemble may still be downgraded to "fallback" below when the
  // skill rejects Spark's output as invalid. Preview "live" means a dataURL
  // was generated; delivery still stays text-only (see livePaths comment).
  var MetaObserved = null;
  function observedMeta() {
    if (MetaObserved) return MetaObserved;
    if (!Meta) return null;
    MetaObserved = Object.create(Meta);
    [["route", "route"], ["assemble", "assemble"], ["preview", "preview"]].forEach(function (pair) {
      var method = pair[0];
      var path = pair[1];
      if (typeof Meta[method] !== "function") return;
      MetaObserved[method] = function () {
        var args = arguments;
        return Meta[method].apply(Meta, args).then(function (out) {
          if (path === "preview") {
            var durl = out && (out.dataURL || out.dataUrl || out.data_url);
            livePaths.preview = (typeof durl === "string" && /^data:image\//.test(durl)) ? "live" : "fallback";
          } else {
            livePaths[path] = "live";
          }
          return out;
        }, function (err) {
          if (path === "preview") {
            livePaths.preview = livePaths.preview === "live" ? "live" : "fallback";
          } else {
            livePaths[path] = livePaths[path] === "live" ? "live" : "fallback";
          }
          throw err;
        });
      };
    });
    return MetaObserved;
  }

  var scheduler = Scheduler.createPollScheduler({});
  var users = new Map(); // userRef -> { catalog, loop, send, loaded }
  var handled = new Map(); // shareId -> terminal outcome string
  var attempts = new Map(); // shareId -> unsuccessful-attempt count
  var deferredLogged = {}; // shareId -> true (pending-media notice said once)
  var activity = [];
  var counts = {
    polled: 0, processed: 0, sent: 0, skipped: 0,
    duplicates: 0, errors: 0, gave_up: 0, images_delivered: 0,
    catalog_save_failed: 0,
  };
  // Observed-call truth, one value each: "unprobed" (never attempted),
  // "live" (proxy answered and the result was used), "fallback" (proxy
  // failed or its output was rejected, labelled path used instead), or —
  // for preview only — "not-staged" (never attempted; mock mode then
  // stages and attaches via POST /mock/stage-outbound-image, while live
  // mode stays text-only — the real bot has no staging route and its Graph
  // send credential is still a placeholder — and the handler reports that
  // delivery truth per reply).
  var livePaths = {
    route: "unprobed", assemble: "unprobed", preview: "not-staged",
    classify: "unprobed", copy: "stub",
  };
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
    // Per-user rolling summary/preferences (M21) — 100t each, via PUT /ig/catalog only.
    // Kept in ctx, persisted via catalog store alongside pieces.
    var ctx = { catalog: catalog, loop: loop, send: send, loaded: false, wardrobeSummary: "", preferences: "", lastAgenticDecision: null, lastSkillSteps: 0 };
    users.set(userRef, ctx);
    return ctx;
  }

  // Agentic helpers (M21) — 20-step cap, logging, router+summariser wiring.
  var agenticLog = []; // { shareId, skill, stepCount, toolCalls[], totalSteps, at }
  var AGENTIC_LOG_CAP = 50;

  function logAgentic(entry) {
    agenticLog.push(Object.assign({ at: new Date(nowMs()).toISOString() }, entry));
    if (agenticLog.length > AGENTIC_LOG_CAP) agenticLog = agenticLog.slice(-AGENTIC_LOG_CAP);
  }

  function getAgenticLog() { return agenticLog.slice(); }

  // Extract message + hasImage from a share for the router.
  function shareToRouterInput(item) {
    var text = "";
    try { text = Bridge.textOf(item) || ""; } catch (e) { text = ""; }
    if (!text) {
      var hint = captionHint(item);
      if (hint) text = hint;
    }
    var hasImage = !!(item.media_id || item.media_file || (item.attachment && (item.attachment.type === "image" || item.attachment.type === "ig_post")));
    return { text: text, hasImage: hasImage };
  }

  // Build agentic loop invocation for one share: router → skill → summariser.
  // The 20-step cap is enforced inside agentic-loop.js (vault 06 global rule);
  // this layer just logs the per-turn step counts for analysis and persists.
  function runAgenticTurn(ctx, item, shareId) {
    var routerInput = shareToRouterInput(item);
    var message = routerInput.text;
    var hasImage = routerInput.hasImage;
    var wardrobeSummary = ctx.wardrobeSummary || "";
    var preferences = ctx.preferences || "";

    var lastTurns = [];
    try {
      var turns = ctx.catalog.getTurns() || [];
      lastTurns = turns.slice(-3).map(function (t) { return t.userText || ""; });
    } catch (e) { lastTurns = []; }

    var imageDataUrl = null;
    var imagePromise;
    if (hasImage && item.media_id) {
      imagePromise = fetchMediaBytes(item.media_id).then(function (url) {
        imageDataUrl = url;
        return null;
      }, function () { return null; });
    } else if (hasImage && item.media_file) {
      imageDataUrl = item.media_file;
      imagePromise = Promise.resolve(null);
    } else {
      imagePromise = Promise.resolve(null);
    }

    return imagePromise.then(function () {
      // Image staging is mock-mode only: the mock bot stages preview bytes
      // via POST /mock/stage-outbound-image, while the real bot has no
      // staging route (its image:true path needs the file pre-placed on the
      // bot host). Live mode therefore gets no stageImage and stays
      // honestly text-only; the skill keeps its caveat there.
      var stageImage = mode === "mock" ? function (sid, dataURL) {
        return ctx.send.stageOutboundImage(sid, dataURL);
      } : null;
      var loop = AgenticLoop.createAgenticLoop({
        catalog: ctx.catalog,
        userRef: ctx.catalog.userKey,
        router: Router,
        summariser: Summariser,
        metaClient: observedMeta(),
        sendClient: ctx.send,
        stageImage: stageImage,
        maxSteps: MAX_TOOL_STEPS,
        onToolCall: function (ev) {
          // Per-tool-call logging for analysis (step count tracked by agentic-loop)
        },
      });

      return loop.handleTurn({
        message: message,
        hasImage: hasImage,
        imageDataUrl: imageDataUrl,
        shareId: shareId,
        wardrobeSummary: wardrobeSummary,
        preferences: preferences,
        lastTurns: lastTurns,
      }).then(function (result) {
        if (result && typeof result.summary === "string") ctx.wardrobeSummary = result.summary;
        if (result && typeof result.preferences === "string") ctx.preferences = result.preferences;

        var toolCalls = (result && result.toolCalls) || [];
        var totalSteps = (result && typeof result.totalSteps === "number") ? result.totalSteps : toolCalls.length;
        var skillName = (result && result.skill) || "unknown";
        // Skill-reported source of truth: a propose_look whose Spark output
        // validated stays "live"; a Spark fetch failure or a rejected
        // candidate (bad IDs, repeats, fit-invalid) lands on the local
        // fallback. Preview "live" (observed wrapper) means a dataURL was
        // generated — delivery still stays text-only, reported per reply.
        try {
          var hr = result && result.handlerResult;
          if (skillName === "propose_look" && hr && hr.meta) {
            if (hr.meta.source === "spark") livePaths.assemble = "live";
            else livePaths.assemble = livePaths.assemble === "live" ? "live" : "fallback";
          }
        } catch (e) { /* status must never break the turn */ }
        var entry = { shareId: shareId, skill: skillName, toolCalls: toolCalls, totalSteps: totalSteps, at: new Date(nowMs()).toISOString() };
        logAgentic(entry);
        ctx.lastAgenticDecision = skillName;
        ctx.lastSkillSteps = totalSteps;

        // Persist: agentic-loop already persisted summary/preferences via
        // Summariser.summariseTurn + catalog store; here we ensure pieces are
        // saved too (best-effort, never blocking).
        return saveBestEffort(ctx).then(function () {
          return { result: result, toolCalls: toolCalls, totalSteps: totalSteps, skill: skillName };
        });
      }, function (err) {
        var entry2 = { shareId: shareId, skill: "error", toolCalls: [], totalSteps: MAX_TOOL_STEPS, at: new Date(nowMs()).toISOString(), error: String((err && err.message) || err) };
        logAgentic(entry2);
        throw err;
      });
    });
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
      // Delivery truth, per mode capability. Mock mode stages the
      // generated preview via POST /mock/stage-outbound-image and attaches
      // it (image:true); live mode stays text-only because the real bot has
      // no staging route and its Graph send credential is still a
      // placeholder. preview_delivery flips to "staged" once the bot
      // confirms an image_message_id. Per-reply
      // handlerResult.meta.imageDelivery says requested/generated/delivered
      // and why not.
      image_delivery: mode === "mock" ? {
        sends: "text+image",
        preview_delivery: counts.images_delivered > 0 ? "staged" : "not-staged",
        note: "Mock mode stages the generated preview and sends it with the reply (image:true).",
      } : {
        sends: "text-only",
        preview_delivery: "not-staged",
        note: "Live mode stays text-only: the real bot has no staging route for the image file, and its Graph send is not yet credentialed.",
      },
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
    // Best-effort only: the reply already went out, so a save failure never
    // blocks or rejects — but it is LOUD, never silently discarded. A
    // failed save is how pieces go missing with no record, so every failure
    // logs an activity line and bumps counts.catalog_save_failed.
    function loud(res) {
      if (res && res.ok) return null;
      var detail = (res && (res.error || ("http_" + res.status))) || "unknown_error";
      counts.catalog_save_failed += 1;
      lastError = "wardrobe save failed (" + detail + ") — will try again on the next check";
      say("Couldn't save the wardrobe just now — will try again on the next check.");
      return null;
    }
    try {
      var r = ctx.catalog.save();
      if (r && typeof r.then === "function") {
        return r.then(loud, function (err) {
          return loud({ error: String((err && err.message) || err) });
        });
      }
      // Sync return (never the real catalog — it always promises): only an
      // explicit {ok:false} counts as a failure; anything else stays silent.
      if (r && typeof r === "object" && r.ok === false) return Promise.resolve(loud(r));
      return Promise.resolve(null);
    } catch (err) {
      return Promise.resolve(loud({ error: String((err && err.message) || err) }));
    }
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

  // Restart-safe send key: derived deterministically from the share id, so
  // every attempt for the SAME share — same process or after a restart —
  // reuses the SAME idempotency key (the send spec's own retry rule: never
  // retry a send with a new key). The bot then replays the stored result
  // (same text) or 409s idempotency_key_reused (different text) — either
  // way terminal, never a second real send. No key is stored anywhere; the
  // mapping is pure derivation, so there is nothing to lose on restart and
  // nothing outside the existing catalog PUT/GET contract.
  function sendKeyForShare(shareId) {
    return "wardrobe-send-v1:" + String(shareId);
  }

  function sendComposed(ctx, shareId, text, opts) {
    var withImage = !!(opts && opts.withImage);
    return ctx.send.sendTurn({
      shareId: shareId, text: text,
      key: sendKeyForShare(shareId), withImage: withImage,
    }).then(function (result) {
      if (result && result.ok) {
        // image_message_id is the bot's own proof an image went out with
        // the text — counted only when the bot says so, never on stage alone.
        if (result.body && result.body.image_message_id) {
          counts.images_delivered += 1;
          say("Sent a reply with a preview picture.");
        } else {
          say("Sent a reply.");
        }
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
      if (result && result.status === 400 && withImage &&
        result.error === "image_not_staged") {
        // The staged preview bytes went missing (e.g. the bot restarted
        // between staging and sending — the mock stage store is in-memory).
        // The text never went out either, so this is retryable: the next
        // attempt re-stages and re-sends under the SAME idempotency key.
        say("The preview picture didn't stage — will try again on the next check.");
        return noteRetry(shareId);
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

  // M21 agentic path: single entry for both text and photo shares.
  // Router picks skill; skill executes (20-step cap, logged); summariser
  // persists; stable per-share idempotency key → bot-side backstop intact.
  function processAgenticShare(ctx, item, id) {
    return runAgenticTurn(ctx, item, id).then(function (agentic) {
      var result = agentic.result;
      var skill = agentic.skill || (result && result.skill) || "unknown";
      var text = result && typeof result.text === "string" ? result.text : "";

      if (!text) {
        say("Got a message but couldn't compose a reply — will try again.");
        return noteRetry(id);
      }

      // Plain-language activity feed — no ids, no tokens, no long refs.
      if (skill === "catalogue_piece") {
        say("Catalogued a piece from your photo.");
      } else if (skill === "clarification") {
        say("Asked for a little clarification.");
      } else if (skill === "off_topic") {
        say("Replied — gently steered back to your wardrobe.");
      } else if (skill === "propose_look") {
        say("Replied to your message with a full look.");
      } else if (skill === "revise_look") {
        say("You asked for a change — updated your wardrobe and re-checked the fit.");
      } else if (skill === "describe_wardrobe") {
        say("Replied with your wardrobe summary.");
      } else if (skill === "explain_fit") {
        say("Explained the fit for your look.");
      } else if (skill === "answer_no_data") {
        say("Answered: no fabric or price data available.");
      } else {
        say("Replied to your message.");
      }

      // Image send only when the skill genuinely staged the preview
      // (delivered:true means the stage call succeeded); otherwise the
      // reply already carries the honest text-only caveat and goes plain.
      // The skill's output lives under handlerResult — the agentic wrapper
      // itself carries no meta.
      var hr = result && result.handlerResult ? result.handlerResult : result;
      var withImage = !!(hr && hr.image &&
        typeof hr.image.dataURL === "string" &&
        hr.meta && hr.meta.imageDelivery &&
        hr.meta.imageDelivery.delivered === true);
      return sendComposed(ctx, id, text, { withImage: withImage }).then(function (outcome) {
        // Media ack ONLY after bytes were in hand and catalogued — preserve
        // inbox-bridge rule; best-effort, never blocking the outcome.
        if (item.media_id) acknowledgeMedia(item.media_id);
        return outcome;
      });
    }, function (err) {
      if (String((err && err.message) || err) === "media_unavailable") {
        if (!deferredLogged[id]) {
          deferredLogged[id] = true;
          say("Your photo isn't ready yet — I'll try again on the next check.");
        }
        return noteRetry(id);
      }
      if (String((err && err.message) || err).indexOf("tool step cap") !== -1) {
        say("That one took a few too many steps — sending what I have and will try again next time.");
        return noteRetry(id);
      }
      return noteRetry(id);
    });
  }

  // Legacy non-agentic paths retained for reference / fallback only — the
  // active path is processAgenticShare above (catalogue_piece skill, not ad-hoc).
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
        if (item.media_id) acknowledgeMedia(item.media_id);
        return outcome;
      });
    }, function (err) {
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
        // Already answered in an earlier turn or a previous process? The
        // media was collected and deleted after the reply went out, so it
        // can never be re-fetched — but the piece is in the wardrobe, so
        // there is nothing left to do. Read-only match on the provenance
        // pointer the catalogue skill stores: terminal, never a second
        // send. Deliberately NOT an idempotent-send probe — with no prior
        // send the probe itself would deliver a message, and for shares
        // first answered before the stable per-share key existed it would
        // duplicate-send instead of 409ing.
        var already = false;
        try {
          already = ctx.catalog.getPieces().some(function (p) {
            return !!p && p.source_share_id === id;
          });
        } catch (err) {
          already = false;
        }
        if (already) {
          counts.duplicates += 1;
          say("That photo was already answered earlier — keeping the earlier reply.");
          return noteTerminal(id, "duplicate", true, false);
        }
        // Reply window already closed on the share's own timestamp? Then no
        // reply can ever go out for it — terminal now instead of retrying
        // until give-up on every restart forever. Outcome-identical to the
        // send gate below (which also requires the share's own timestamp
        // to be inside the window); this only skips the futile retries.
        if (!Scheduler.isWindowOpen(item.received_at, nowMs())) {
          say("Reply window expired, didn't send a reply.");
          return noteTerminal(id, "window_closed", true, false);
        }
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
      return processAgenticShare(ctx, item, id);
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
    // M21 agentic surface for tests / introspection
    getAgenticLog: getAgenticLog,
    MAX_TOOL_STEPS: MAX_TOOL_STEPS,
    getUserContext: function (userRef) { return users.get(userRef) || null; },
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

