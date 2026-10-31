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
 * declared openly rather than forked silently: both modes stage the
 * generated dataURL (mock: POST /mock/stage-outbound-image; live: POST
 * /ig/outbound-stage/<share_id>) and attach it to the send (image:true)
 * through the same downstream path — only the staging route differs per
 * mode. Generation vs delivery are reported separately and honestly:
 * live_paths.preview tracks whether the proxy generated a dataURL,
 * counts.images_delivered tracks bot-confirmed image_message_ids ONLY
 * (staging alone never counts), and each propose_look reply's
 * meta.imageDelivery states requested/generated/delivered and why not.
 * Live honesty caveat: staging may succeed while the photo send still
 * fails at the bot's Graph step (placeholder credential → 502/503) —
 * retried, never claimed delivered.
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
var DETECT_BAG_TTL_MS = 24 * 3600 * 1000;

function mergeDetectBag(existing, incoming){
  if(!incoming || !Array.isArray(incoming.regions)) return existing;
  if(!existing || !Array.isArray(existing.regions) || !existing.regions.length){
    var copy = { at: incoming.at, regions: incoming.regions.slice(), source_share_id: incoming.source_share_id, source_share_ids: incoming.source_share_ids ? incoming.source_share_ids.slice() : (incoming.source_share_id ? [incoming.source_share_id] : []), source_media_ids: incoming.source_media_ids ? incoming.source_media_ids.slice() : (incoming.source_media_id ? [incoming.source_media_id] : []) };
    if(incoming.source_media_id && (!copy.source_media_ids || copy.source_media_ids.indexOf(incoming.source_media_id)===-1)) copy.source_media_ids.push(incoming.source_media_id);
    return copy;
  }
  var seen={};
  for(var i=0;i<existing.regions.length;i++){ var h=existing.regions[i]&&existing.regions[i].crop_hash; if(h) seen[h]=true; }
  var mergedRegions = existing.regions.slice();
  for(var j=0;j<incoming.regions.length;j++){
    var r=incoming.regions[j];
    if(!r) continue;
    var ch=r.crop_hash;
    if(ch && seen[ch]) continue;
    mergedRegions.push(r);
    if(ch) seen[ch]=true;
  }
  var oldestAt = (existing.at!=null && incoming.at!=null) ? Math.min(existing.at, incoming.at) : (existing.at!=null?existing.at:incoming.at);
  var sids = (existing.source_share_ids||[]).slice();
  var incSids = incoming.source_share_ids ? incoming.source_share_ids : (incoming.source_share_id ? [incoming.source_share_id] : []);
  for(var k=0;k<incSids.length;k++){ if(sids.indexOf(incSids[k])===-1) sids.push(incSids[k]); }
  if(incoming.source_share_id && sids.indexOf(incoming.source_share_id)===-1) sids.push(incoming.source_share_id);
  var mids = (existing.source_media_ids||[]).slice();
  var incMids = incoming.source_media_ids ? incoming.source_media_ids : (incoming.source_media_id ? [incoming.source_media_id] : []);
  for(var km=0;km<incMids.length;km++){ if(mids.indexOf(incMids[km])===-1) mids.push(incMids[km]); }
  if(incoming.source_media_id && mids.indexOf(incoming.source_media_id)===-1) mids.push(incoming.source_media_id);
  return { at: oldestAt, regions: mergedRegions, source_share_id: existing.source_share_id||incoming.source_share_id, source_share_ids: sids, source_media_ids: mids };
}
function bagRegionsChanged(before, after){
  if(!before && after) return true;
  if(before && !after) return true;
  if(!before && !after) return false;
  if((before.regions||[]).length !== (after.regions||[]).length) return true;
  var aHashes={}, bHashes={};
  for(var i=0;i<(before.regions||[]).length;i++){ var h=(before.regions[i]||{}).crop_hash; if(h) aHashes[h]=true; }
  for(var j=0;j<(after.regions||[]).length;j++){ var hh=(after.regions[j]||{}).crop_hash; if(hh) bHashes[hh]=true; }
  for(var k in bHashes){ if(!aHashes[k]) return true; }
  return false;
}
function buildCombinedAskText(regions){
  var nouns = regions.map(function(r){ return nounFor(r.category)||"piece"; });
  var listStr="";
  if(nouns.length===2) listStr=nouns[0]+" and "+nouns[1];
  else if(nouns.length>2) listStr=nouns.slice(0,-1).join(", ")+" and "+nouns[nouns.length-1];
  else listStr=nouns.join(", ");
  var suffix = regions.length>1 ? " pieces across those photos" : " piece";
  if(regions.length>1) return "Found "+regions.length+" pieces across those photos, loveling \u2728 \u2014 a "+listStr+". Shall I add all of them?";
  return "Found "+regions.length+" pieces in that photo, loveling \u2728 \u2014 a "+listStr+". Shall I add all of them?";
}
function resolveAllCatalogueYesNo(catalog){
  try{
    var pqs=catalog.getPendingQuestions()||[];
    for(var i=0;i<pqs.length;i++){
      if(pqs[i]&&pqs[i].skill==="catalogue_piece"&&pqs[i].expects==="yes_no"){
        try{ catalog.resolveQuestion(pqs[i].id);}catch(e){}
      }
    }
  }catch(e){}
}


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
  // was generated; delivery is then decided per reply by the skill's
  // imageDelivery staging result (see livePaths comment).
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
    deletions_cleared: 0,
  };
  // Observed-call truth, one value each: "unprobed" (never attempted),
  // "live" (proxy answered and the result was used), "fallback" (proxy
  // failed or its output was rejected, labelled path used instead), or —
  // for preview only — "not-staged" (never attempted; either mode then
  // stages and attaches via its own route — mock
  // /mock/stage-outbound-image, live /ig/outbound-stage — and the handler
  // reports that delivery truth per reply).
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
  var reconcileInFlight = false;
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
    // The send client stages via the mode's own route (mock:
    // /mock/stage-outbound-image; live: /ig/outbound-stage) — same Bearer [REDACTED]
    var send = SendClient.createSendClient({ base: botBase, token: sendToken, mode: mode });
    // Per-user rolling summary/preferences (M21) — 100t each, memory-only.
    // Kept in ctx only: the catalog contract is pieces-array-only, so
    // summary/preferences canNOT be persisted through it (Opus finding
    // #10 — see app/summariser.js). Lost on restart; nothing claims
    // otherwise. Pieces remain the only persisted data.
    var ctx = { catalog: catalog, loop: loop, send: send, loaded: false, wardrobeSummary: "", preferences: "", lastAgenticDecision: null, lastSkillSteps: 0, detectBag: null };
    users.set(userRef, ctx);
    return ctx;
  }

  // Agentic helpers (M21) — 20-step cap, logging, router+summariser wiring
  // (summariser rolls memory-only context; only pieces persist).
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

    // Opus finding #6: user texts AND the bot's own sent replies,
    // interleaved in order (see buildLastTurns) — the live Spark
    // /api/route prompt's "check Recent turns" instruction finally has
    // real data instead of an always-empty array.
    var lastTurns = buildLastTurns(ctx.catalog);

    var imageDataUrl = null;
    var imagePromise;
    if (hasImage && item.media_id) {
      imagePromise = fetchMediaBytes(item.media_id).then(function (url) {
        imageDataUrl = url;
        return null;
      }, function () { throw new Error("media_unavailable"); });
    } else if (hasImage && item.media_file) {
      imageDataUrl = item.media_file;
      imagePromise = Promise.resolve(null);
    } else {
      imagePromise = Promise.resolve(null);
    }

    return imagePromise.then(function () {
      // Image staging, one downstream path for both modes: the mock bot
      // stages preview bytes via POST /mock/stage-outbound-image and the
      // real bot via POST /ig/outbound-stage/<share_id> — the send client
      // picks the route from its own mode, so the skill and the
      // send-with-image flow below are identical in both. A staging
      // failure still resolves {ok:false}, and the skill then keeps its
      // honest text-only caveat; only a bot-confirmed image_message_id
      // ever counts as delivered (see sendComposed).
      var stageImage = function (sid, dataURL) {
        return ctx.send.stageOutboundImage(sid, dataURL);
      };
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

      // Multi-detect pending bag: handle add/discard before routing when a text reply targets a pending catalogue_piece expectation
      var pendingBagForTurn = null;
      if (!hasImage && ctx.detectBag && ctx.detectBag.regions) {
        var bagAge = nowMs() - (ctx.detectBag.at || 0);
        if (bagAge > DETECT_BAG_TTL_MS) {
          ctx.detectBag = null;
          try{
            var pqsExp = ctx.catalog.getPendingQuestions()||[];
            for(var pe=0;pe<pqsExp.length;pe++){
              if(pqsExp[pe]&&pqsExp[pe].skill==="catalogue_piece"&&pqsExp[pe].expects==="yes_no"){
                try{ ctx.catalog.resolveQuestion(pqsExp[pe].id); }catch(e){}
              }
            }
          }catch(e){}
        } else {
          pendingBagForTurn = ctx.detectBag;
        }
      }
      // Pass pendingBag to agentic loop via extra; catalogue_piece will handle yes/no
      var turnOpts = {
        message: message,
        hasImage: hasImage,
        imageDataUrl: imageDataUrl,
        shareId: shareId,
        wardrobeSummary: wardrobeSummary,
        preferences: preferences,
        lastTurns: lastTurns,
      };
      if (pendingBagForTurn) turnOpts.pendingBag = pendingBagForTurn;
      return loop.handleTurn(turnOpts).then(function (result) {
        if (result && typeof result.summary === "string") ctx.wardrobeSummary = result.summary;
        if (result && typeof result.preferences === "string") ctx.preferences = result.preferences;

        var toolCalls = (result && result.toolCalls) || [];
        var totalSteps = (result && typeof result.totalSteps === "number") ? result.totalSteps : toolCalls.length;
        var skillName = (result && result.skill) || "unknown";
        // Skill-reported source of truth: a propose_look whose Spark output
        // validated stays "live"; a Spark fetch failure or a rejected
        // candidate (bad IDs, repeats, fit-invalid) lands on the local
        // fallback. Preview "live" (observed wrapper) means a dataURL was
        // generated — delivery is then decided per reply by the skill's
        // imageDelivery staging result, reported per reply.
        try {
          var hr = result && result.handlerResult;
          if (skillName === "propose_look" && hr && hr.meta) {
            if (hr.meta.source === "spark") livePaths.assemble = "live";
            else livePaths.assemble = livePaths.assemble === "live" ? "live" : "fallback";
          }
        } catch (e) { /* status must never break the turn */ }
        var traceForEntry = [];
        try{
          if(result && Array.isArray(result.trace)) traceForEntry = result.trace.slice(0,40);
          else if(result && result.handlerResult && Array.isArray(result.handlerResult.trace)) traceForEntry = result.handlerResult.trace.slice(0,40);
        }catch(e){ traceForEntry=[]; }
        // sanitize to strings only, id-free by construction
        try{ traceForEntry = traceForEntry.filter(function(s){ return typeof s==="string"; }).slice(0,40); }catch(e){ traceForEntry=[]; }
        var outcomeForEntry = (result && result.outcome) ? result.outcome : skillName;
        if(result && result.handlerResult && result.handlerResult.outcome === "handler_error") outcomeForEntry = "handler_error";
        var entry = { shareId: shareId, skill: skillName, toolCalls: toolCalls, totalSteps: totalSteps, at: new Date(nowMs()).toISOString(), trace: traceForEntry.slice(), outcome: outcomeForEntry };
        logAgentic(entry);
        ctx.lastAgenticDecision = skillName;
        ctx.lastSkillSteps = totalSteps;

        // Honest persistence split (Opus finding #10): the rolling
        // summary/preferences in ctx are memory-only (agentic-loop reports
        // summaryPersisted:false — the pieces-only catalog contract cannot
        // hold them); here we ensure PIECES are saved (best-effort, never
        // blocking), which is the only restart-persisted data.
        // Persist pendingBag from catalogue_piece multi-detect ask; clear on add/discard or expiry
        // NOTE: merging for accumulated-ask is handled in processOne (tick-level), not here;
        // this block only handles text-answer clearing and keeps direct overwrite for non-tick paths (e.g. single photo legacy).
        try{
          var hr2 = result && result.handlerResult;
          if(hr2 && hr2.pendingBag && Array.isArray(hr2.pendingBag.regions)){
            // Normalize bag to include source_share_ids for merge tracking
            if(!hr2.pendingBag.source_share_ids){
              hr2.pendingBag.source_share_ids = hr2.pendingBag.source_share_id ? [hr2.pendingBag.source_share_id] : [];
            }
            // Direct set only if not in a tick-merged flow (processOne will override with merged bag)
            // Keep old behaviour for single-photo legacy calls outside tick merging
            if(!ctx._tickMerging){
              ctx.detectBag = hr2.pendingBag;
            }
          } else if(skillName==="catalogue_piece" && hr2 && hasImage===false && pendingBagForTurn){
            // text reply that resolved the pending bag -> clear
            ctx.detectBag = null;
          }
        }catch(e){}
        // Also detect expiry after the turn: if bag still present but expired, clear it
        if(ctx.detectBag && (nowMs() - (ctx.detectBag.at||0) > DETECT_BAG_TTL_MS)){
          ctx.detectBag=null;
          resolveAllCatalogueYesNo(ctx.catalog);
        }
        return saveBestEffort(ctx).then(function () {
          return { result: result, toolCalls: toolCalls, totalSteps: totalSteps, skill: skillName };
        });
      }, function (err) {
        var traceErr = [];
        try{ if(err && Array.isArray(err.trace)) traceErr = err.trace.slice(0,40); }catch(e){}
        try{ traceErr = traceErr.filter(function(s){ return typeof s==="string"; }).slice(0,40); }catch(e){ traceErr=[]; }
        var skillErr = "error";
        try{ if(err && err.skill) skillErr = err.skill; }catch(e){}
        var entry2 = { shareId: shareId, skill: skillErr, toolCalls: [], totalSteps: MAX_TOOL_STEPS, at: new Date(nowMs()).toISOString(), error: String((err && err.message) || err), trace: traceErr, outcome: "handler_error" };
        logAgentic(entry2);
        throw err;
      });
    });
  }

  // Opus finding #5: a failed first load must never pin the catalog to
  // memory-only and unblock a destructive whole-array PUT. ctx.loaded is
  // set ONLY when the load actually succeeded (or when there is
  // deliberately no store to confirm against — memory-only mode works
  // exactly as before). On a failed load the flag stays false, so the
  // NEXT turn retries the load; meanwhile catalog.save() itself refuses
  // to PUT (load_not_confirmed), which saveBestEffort reports through
  // the existing loud catalog_save_failed path — never silently.
  function ensureLoaded(ctx) {
    if (ctx.loaded) return Promise.resolve(ctx);
    if (!ctx.catalog.store || typeof ctx.catalog.load !== "function") {
      ctx.loaded = true; // nothing to confirm against — memory-only, as before
      return Promise.resolve(ctx);
    }
    return ctx.catalog.load().then(function (res) {
      if (res.ok) {
        ctx.loaded = true;
      } else {
        say("Couldn't load the saved wardrobe — will try again on the next check.");
      }
      return ctx;
    }, function () {
      say("Couldn't load the saved wardrobe — will try again on the next check.");
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
      deletions_cleared: counts.deletions_cleared,
      last_turn_text: lastTurnText,
      counts: Object.assign({}, counts),
      live_paths: Object.assign({}, livePaths),
      // Delivery truth, per mode capability. Both modes stage the
      // generated preview (mock: POST /mock/stage-outbound-image; live:
      // POST /ig/outbound-stage) and attach it (image:true).
      // preview_delivery flips to "staged" ONLY once the bot confirms an
      // image_message_id — staging alone never counts. Live honesty
      // caveat: staging may succeed while the actual photo send still
      // fails at the bot's Graph step (its Graph send credential may
      // still be a placeholder, surfacing as 502/503) — a reason outside
      // this code's control, retried without ever claiming delivery.
      // Per-reply handlerResult.meta.imageDelivery says
      // requested/generated/delivered and why not.
      image_delivery: mode === "mock" ? {
        sends: "text+image",
        preview_delivery: counts.images_delivered > 0 ? "staged" : "not-staged",
        note: "Mock mode stages the generated preview and sends it with the reply (image:true).",
      } : {
        sends: "text+image",
        preview_delivery: counts.images_delivered > 0 ? "staged" : "not-staged",
        note: "Live mode stages the generated preview via POST /ig/outbound-stage and sends it with the reply (image:true). Delivery counts only on a bot-confirmed image_message_id; if the bot's photo send is not yet credentialed, staged sends fail at that Graph step and retry — never reported as delivered.",
      },
      activity: activity.slice(),
      last_error: lastError,
      agentic_recent: (function(){
        var out=[];
        var src=agenticLog.slice(-10);
        for(var i=0;i<src.length;i++){
          var e=src[i];
          var tools=[];
          try{
            var tcs=e.toolCalls||[];
            for(var j=0;j<tcs.length;j++){ if(tcs[j]&&typeof tcs[j].tool==="string") tools.push(tcs[j].tool); }
          }catch(e2){}
          var traceArr=[];
          try{
            if(e.trace && Array.isArray(e.trace)) traceArr = e.trace.filter(function(s){ return typeof s==="string"; }).slice(0,40);
          }catch(e2){}
          var outcomeVal = e.outcome || e.skill || "unknown";
          out.push({ skill: e.skill||"unknown", steps: typeof e.totalSteps==="number"?e.totalSteps:(tools.length), tools: tools, outcome: outcomeVal, trace: traceArr });
        }
        return out;
      })(),
    };
  }

  // --- Deletion reconciliation -----------------------------------------------
  // Live only: polls GET /ig/deletion-status/<user_ref> (Bearer catalogToken)
  // per known user. Mock mode has no deletion model — never probed.
  // Purges ONLY on HTTP 200 + JSON {scrubbed:true}; everything else (non-200,
  // malformed, scrubbed:false, network error) keeps silently (fail-open).
  // Purge: users.delete(ref), bump deletions_cleared, anonymous activity line
  // (PUBLIC via /wardrobe/status — never id/ref). Concurrent-safe via a
  // single-flight guard; harmless to double-run (users.delete is idempotent).
  function reconcileDeletions() {
    if (mode === "mock") return Promise.resolve();
    if (reconcileInFlight) return Promise.resolve();
    reconcileInFlight = true;
    var refs = [];
    users.forEach(function (_, ref) { refs.push(ref); });
    if (refs.length === 0) {
      reconcileInFlight = false;
      return Promise.resolve();
    }
    var checks = refs.map(function (ref) {
      return fetch(botBase + "/ig/deletion-status/" + encodeURIComponent(ref), {
        headers: authHeaders(catalogToken),
      }).then(function (res) {
        if (res.status !== 200) return null;
        return res.json().then(function (body) {
          if (!body || body.scrubbed !== true) return null;
          return ref;
        }, function () { return null; });
      }, function () { return null; });
    });
    return Promise.all(checks).then(function (results) {
      results.forEach(function (r) {
        if (typeof r === "string" && r) {
          if (users.has(r)) {
            users.delete(r);
            counts.deletions_cleared += 1;
            say("a wardrobe was cleared by its owner's deletion request");
          }
        }
      });
    }).then(function () {
      reconcileInFlight = false;
    }, function () {
      reconcileInFlight = false;
    });
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
        // Opus finding #6: remember our own sent reply next to the
        // recorded user turns — this is what buildLastTurns() reads for
        // the "Bot: ..." lines (the dead turn-loop.js used to be the
        // only recordSentTurn caller). Best-effort, never blocking.
        try {
          if (ctx.catalog && typeof ctx.catalog.recordSentTurn === "function") {
            ctx.catalog.recordSentTurn({ text: text, in_reply_to_share: shareId });
          }
        } catch (e) { /* sent-logging never breaks the outcome */ }
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
      if (withImage && result && (result.status === 502 || result.status === 503 ||
          result.error === "image_send_failed" || result.error === "graph_error" ||
          result.error === "graph_unreachable")) {
        // Staged but the Graph send failed: the preview bytes reached the
        // bot (staging succeeded — hence image:true), but the bot's own
        // photo-send step refused, e.g. its Graph send credential is still
        // a placeholder. This is distinct from a staging failure (which
        // falls back to an honest text-only send with a caveat) and from
        // the retired no-staging-route case: nothing here is claimed
        // delivered, and the share retries so the picture leg can go out
        // later — the stable per-share key replays-or-409s bot-side, so a
        // retry never duplicates text already sent.
        say("The preview picture staged but the photo service didn't accept it — will try again on the next check.");
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
  // rolls the memory-only summary (pieces are the only persisted data);
  // stable per-share idempotency key → bot-side backstop intact.
  function processAgenticShare(ctx, item, id) {
    return runAgenticTurn(ctx, item, id).then(function (agentic) {
      var result = agentic.result;
      var skill = agentic.skill || (result && result.skill) || "unknown";
      var hrPending = result && result.handlerResult ? result.handlerResult.pendingBag : null;
      // Detection accumulation per tick: suppress per-photo send, merge into ctx.detectBag
      if(hrPending && Array.isArray(hrPending.regions) && hrPending.regions.length){
        // Ensure source_share_ids tracking
        if(!hrPending.source_share_ids) hrPending.source_share_ids = hrPending.source_share_id ? [hrPending.source_share_id] : [];
        if(item && item.media_id){
          hrPending.source_media_id = item.media_id;
          if(!hrPending.source_media_ids) hrPending.source_media_ids = [item.media_id];
          else if(hrPending.source_media_ids.indexOf(item.media_id)===-1) hrPending.source_media_ids.push(item.media_id);
        }
        // Merge into ctx.detectBag instead of replacing (append by crop_hash, oldest at, record sources)
        var before = ctx.detectBag;
        ctx.detectBag = mergeDetectBag(ctx.detectBag, hrPending);
        // Track per-tick state for combined-ask post-processing
        if(ctx._tickLastShare !== undefined){
          ctx._tickLastShare = { item: item, id: id };
        }
        if(ctx._tickHadAnyDetect !== undefined){
          ctx._tickHadAnyDetect = true;
          // hasMulti if any bag (before or incoming) had >1 regions
          var incomingIsMulti = hrPending.regions.length > 1;
          var existingIsMulti = before && before.regions && before.regions.length > 1;
          if(incomingIsMulti || existingIsMulti) ctx._tickHadMulti = true;
        }
        if(!ctx._tickPendingBags) ctx._tickPendingBags = [];
        ctx._tickPendingBags.push({ id: id, item: item, bag: hrPending });
        // Suppress send, mark handled with internal outcome pending_ask (no idempotency consumption)
        // No activity for pending_ask itself; the combined ask will log when sent
        return noteTerminal(id, "pending_ask", true, false);
      }
      var text = result && typeof result.text === "string" ? result.text : "";

      if (!text) {
        say("Got a message but couldn't compose a reply — will try again.");
        return noteRetry(id);
      }

      // Plain-language activity feed — no ids, no tokens, no long refs.
      if (skill === "catalogue_piece") {
        var hrForAct = result && result.handlerResult ? result.handlerResult : result;
        if(hrForAct && hrForAct.meta && hrForAct.meta.addFailure && hrForAct.meta.addFailure.kind){
          say("Couldn't catalogue that photo — " + hrForAct.meta.addFailure.kind + ".");
        } else {
          say("Catalogued a piece from your photo.");
        }
      } else if (skill === "clarification") {
        say("Asked for a little clarification.");
      } else if (skill === "off_topic") {
        say("Replied — gently steered back to your wardrobe.");
      } else if (skill === "propose_look") {
        say("Replied to your message with a full look.");
      } else if (skill === "revise_look") {
        say("You asked for a change — re-wove your look and re-checked the fit.");
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
        if (item.media_id && typeof outcome === "string" && outcome.indexOf("terminal:") === 0) {
          var _hr = result && result.handlerResult ? result.handlerResult : result;
          var _isCat = skill === "catalogue_piece";
          var _isFailure = false;
          if(_isCat && _hr){
            if(_hr.meta && _hr.meta.addFailure && _hr.meta.addFailure.kind) _isFailure = true;
            else if(_hr.trace && Array.isArray(_hr.trace) && _hr.trace.indexOf("added:0")!==-1 && _hr.trace.indexOf("return:fail")!==-1) _isFailure = true;
          }
          if(_isCat && _isFailure){
            say("Your photo stays with me until its pieces land.");
          } else {
            acknowledgeMedia(item.media_id);
            // On successful yes-add, also ack original photo media retained from ask
            if(_isCat && _hr && _hr.trace && _hr.trace.indexOf("regions:")!==-1){
              // detect successful add via added>0 and return:added / return:already with pieces
            }
            // If this was a successful yes-add, ack the bag's original media ids (retained from ask)
            try{
              var _bagForAck = ctx.detectBag;
              // bag is cleared after success in runAgenticTurn, so check pendingBagForTurn
              var _pendingForAck = pendingBagForTurn;
              var _srcIds = null;
              if(_pendingForAck && Array.isArray(_pendingForAck.source_share_ids)) _srcIds = _pendingForAck.source_share_ids;
              else if(_pendingForAck && _pendingForAck.source_share_id) _srcIds = [_pendingForAck.source_share_id];
              // Only ack retained media when we actually added pieces (not on fail/empty)
              var _addedOk = _hr && _hr.trace && _hr.trace.some(function(s){ return typeof s==="string" && s.indexOf("added:")===0 && s!=="added:0"; });
              if(_srcIds && _addedOk){
                // We need media_ids: stored as source_media_ids if available, else try acknowledge via share's media (fallback: no-op if not found)
                var _mediaIds = _pendingForAck && Array.isArray(_pendingForAck.source_media_ids) ? _pendingForAck.source_media_ids : [];
                for(var _mi=0; _mi<_mediaIds.length; _mi++){ if(_mediaIds[_mi]) acknowledgeMedia(_mediaIds[_mi]); }
              }
            }catch(e){}
          }
        }
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
      say("You asked for a change — re-wove your look and re-checked the fit.");
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
    return reconcileDeletions().then(function () {
      return fetchSharesPage();
    }).then(function (page) {
      var items = page.items || [];
      counts.polled += items.length;
      scheduler.noteInboundPoll(items.length);
      // Snapshot per-user detectBag before tick for change detection
      var tickBagBefore = new Map();
      users.forEach(function(ctx, ref){ tickBagBefore.set(ref, ctx.detectBag ? { at: ctx.detectBag.at, regions: (ctx.detectBag.regions||[]).slice(), source_share_id: ctx.detectBag.source_share_id, source_share_ids: (ctx.detectBag.source_share_ids||[]).slice() } : null); ctx._tickMerging = true; ctx._tickLastShare = null; ctx._tickHadAnyDetect = false; ctx._tickHadMulti = false; ctx._tickPendingBags = []; });
      var chain = Promise.resolve();
      var outcomes = [];
      items.forEach(function (item) {
        chain = chain.then(function () {
          // Ensure new ctx created during tick also gets tick flags
          var urefForItem = (mode==="mock") ? demoUserRef : (item && typeof item.user_ref==="string" ? item.user_ref : null);
          if(urefForItem && !tickBagBefore.has(urefForItem)){
            var existingCtx = users.get(urefForItem);
            if(existingCtx){ tickBagBefore.set(urefForItem, existingCtx.detectBag ? { at: existingCtx.detectBag.at, regions: (existingCtx.detectBag.regions||[]).slice(), source_share_id: existingCtx.detectBag.source_share_id, source_share_ids: (existingCtx.detectBag.source_share_ids||[]).slice() } : null); existingCtx._tickMerging=true; existingCtx._tickLastShare=null; existingCtx._tickHadAnyDetect=false; existingCtx._tickHadMulti=false; existingCtx._tickPendingBags=[]; }
            else {
              // Will be created inside processOne; we will handle via after-check of all users
            }
          }
          return processOne(item).then(function (outcome) {
            outcomes.push(outcome);
            return null;
          });
        });
      });
      return chain.then(function () {
        // Per-user combined-ask post-processing: if merged bag changed this tick, build ONE ask via last share
        var tickCombinedPromises = [];
        users.forEach(function(ctx, ref){
          try{ delete ctx._tickMerging; }catch(e){ ctx._tickMerging=false; }
          var before = tickBagBefore.get(ref) || null;
          var after = ctx.detectBag || null;
          var hadDetectInTick = ctx._tickHadAnyDetect === true;
          // For users created mid-tick without snapshot, treat before as null
          if(!tickBagBefore.has(ref) && after){
            before = null;
            hadDetectInTick = true;
          }
          var changed = bagRegionsChanged(before, after);
          // Also need to handle case where after exists but changed false yet we had re-ask due to later detection landing while bag pending
          // In that model, mergeDetectBag deduplicates but new incoming with same hashes yields no change -> should not re-ask
          // So only when changed is true we re-ask
          if(changed && after && after.regions && after.regions.length){
            var lastShare = ctx._tickLastShare;
            if(!lastShare || !lastShare.id || !lastShare.item){
              // Fallback: no last share recorded (should not happen), skip
              return;
            }
            // Batch uniformity: if EVERY detected photo in tick was single-region, do instant auto-add instead of ask
            // hadMulti false means all detected bags in tick were single-region (1 each)
            if(!ctx._tickHadMulti){
              // All-single tick: instant auto-add flow unchanged — auto-add each pending single and send per-share replies
              var pendingBags = ctx._tickPendingBags || [];
              var perShareSends = [];
              var anyAdded = false;
              for(var pbi=0; pbi<pendingBags.length; pbi++){
                (function(entry){
                  var bagForShare = entry.bag;
                  var shareIdForSend = entry.id;
                  var shareItemForSend = entry.item;
                  // Auto-add each region in this bag (should be 1)
                  for(var riA=0; riA<(bagForShare.regions||[]).length; riA++){
                    var regA = bagForShare.regions[riA];
                    if(!regA) continue;
                    var sidA = regA.source_share_id || shareIdForSend;
                    // Dedupe by crop_hash
                    var existsA=false;
                    try{ var exA=ctx.catalog.getPieces()||[]; for(var eiA=0; eiA<exA.length; eiA++){ if(exA[eiA]&&exA[eiA].crop_hash===regA.crop_hash) { existsA=true; break; } } }catch(e){}
                    if(existsA) continue;
                    var inpA={ category:regA.category, attributes:regA.attributes||{}, source_share_id:sidA };
                    if(regA.thumb) inpA.photo_thumb=regA.thumb;
                    if(regA.original) inpA.image_original=regA.original;
                    if(regA.crop_hash) inpA.crop_hash=regA.crop_hash;
                    try{ ctx.catalog.addPiece(inpA); anyAdded=true; }catch(e){ try{ var bareA={ category:regA.category, attributes:regA.attributes||{}, source_share_id:sidA }; if(regA.crop_hash) bareA.crop_hash=regA.crop_hash; ctx.catalog.addPiece(bareA); anyAdded=true; }catch(e2){} }
                  }
                  var nounA = bagForShare.regions && bagForShare.regions[0] ? nounFor(bagForShare.regions[0].category) : "piece";
                  var textA = "Got your "+nounA+" \u2014 noted, loveling! \u2728 It's tucked safely in your wardrobe. Want me to put a look together from what you've got?";
                  // Record expectation for look proposal
                  try{ ctx.catalog.askQuestion({ text: textA, skill:"propose_look", expects:"yes_no"});}catch(e){}
                  var sendP = sendComposed(ctx, shareIdForSend, textA, { withImage: false });
                  // Update outcomes: replace corresponding pending_ask with its send outcome
                  var idxForOut = -1;
                  for(var oi2=0; oi2<outcomes.length; oi2++){ if(outcomes[oi2]==="terminal:pending_ask"){ // find first pending_ask not yet replaced
                      // Heuristic: assume order matches pendingBags order
                      idxForOut = oi2; break; } }
                  // Track promise
                  perShareSends.push(sendP.then(function(res){ if(idxForOut!==-1) outcomes[idxForOut]=res; }));
                })(pendingBags[pbi]);
              }
              if(anyAdded){ try{ ctx.catalog.save(); }catch(e){} }
              // Clear bag (all-single should not leave pending bag)
              ctx.detectBag = null;
              resolveAllCatalogueYesNo(ctx.catalog);
              if(perShareSends.length) tickCombinedPromises.push(Promise.all(perShareSends).then(function(){}));
              return;
            }
            // Window check: last share's own 24h window must still be open, else drop bag with activity line
            var winOpen = Scheduler.isWindowOpen(lastShare.item.received_at, nowMs());
            try{ ctx.catalog.noteInboundShare({ shareId: lastShare.id, receivedAt: lastShare.item.received_at }); }catch(e){ winOpen=false; }
            var gate2 = Scheduler.checkSendWindow(ctx.catalog);
            if(!winOpen || !gate2.allowed){
              ctx.detectBag = null;
              resolveAllCatalogueYesNo(ctx.catalog);
              say("Reply window expired, didn't send a reply.");
              return;
            }
            // Build combined ask text (multi-photo honesty)
            var askText = buildCombinedAskText(after.regions);
            // Replace any previous unanswered catalogue_piece yes_no before asking (not stacking)
            resolveAllCatalogueYesNo(ctx.catalog);
            try{ ctx.catalog.askQuestion({ text: askText, skill:"catalogue_piece", expects:"yes_no" }); }catch(e){}
            // Fix the outcomes array: replace pending_ask entry for lastShare with the combined ask send outcome
            // We will send via ordinary send path, inheriting confirm/idempotency/window semantics
            var p = sendComposed(ctx, lastShare.id, askText, { withImage: false }).then(function(outcome){
              // Media retained until pieces land: ask turn is not a catalogue success (detection pieces NOT added), so do NOT ack any media here.
              if(typeof outcome === "string" && outcome.indexOf("terminal:")===0){
                say("Your photo stays with me until its pieces land.");
              }
              // outcomes array update: find pending_ask index for lastShare and replace with outcome tag (sent)
              // outcomes already contains pending_ask terminals; we need to replace that entry's outcome string for cursor logic
              // Instead push outcome and handle cursor extra; but spec says both photo shares terminal without sends except one ask sent
              // So outcomes length stays same, but one of them becomes terminal:sent
              for(var oi=0; oi<outcomes.length; oi++){
                if(outcomes[oi]==="terminal:pending_ask"){
                  // Replace first pending_ask that matches lastShare? Actually there are multiple pending_ask; we replace the last one
                }
              }
              // Replace the last pending_ask with sent outcome
              for(var k2=outcomes.length-1; k2>=0; k2--){ if(outcomes[k2]==="terminal:pending_ask"){ outcomes[k2]=outcome; break; } }
              return outcome;
            }, function(err){
              // On failure, treat as retry (but we already marked pending_ask terminal)
              return "retry";
            });
            tickCombinedPromises.push(p);
          }
          // Cleanup tick flags
          try{ delete ctx._tickLastShare; delete ctx._tickHadAnyDetect; delete ctx._tickHadMulti; delete ctx._tickPendingBags; }catch(e){}
        });
        if(tickCombinedPromises.length){
          return Promise.all(tickCombinedPromises).then(function(){ return null; });
        }
      }).then(function(){

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
      reconcileDeletions().then(function () {
        finish(200, statusBody());
      }, function () {
        finish(200, statusBody());
      });
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
    reconcileDeletions: reconcileDeletions,
    // M21 agentic surface for tests / introspection
    getAgenticLog: getAgenticLog,
    MAX_TOOL_STEPS: MAX_TOOL_STEPS,
    getUserContext: function (userRef) { return users.get(userRef) || null; },
  };
}

// Opus finding #6: build the live-router prompt context from BOTH sides
// of the conversation — the user's texts (catalog.getTurns()) AND the
// bot's own sent replies (catalog.getSentTurns()) — interleaved in
// chronological order as plain "User: ..."/"Bot: ..." strings. Plain
// strings keep every existing consumer working: explain_fit's
// hint-matching only reads string entries, the heuristic router joins
// + lowercases, and the Spark /api/route prompt maps String().
// Exported for tests. Never throws: a catalog read error yields [].
function buildLastTurns(catalog) {
  try {
    var turns = (catalog && typeof catalog.getTurns === "function") ? (catalog.getTurns() || []) : [];
    var sent = (catalog && typeof catalog.getSentTurns === "function") ? (catalog.getSentTurns() || []) : [];
    if (!Array.isArray(turns)) turns = [];
    if (!Array.isArray(sent)) sent = [];
    // sent[i] is the reply to turns[i] (both recorded in order), so
    // pair by index, then keep the last ~4 exchanges (8 lines max —
    // this flows into a model prompt).
    var n = Math.max(turns.length, sent.length);
    var lines = [];
    for (var i = 0; i < n; i++) {
      var t = turns[i];
      if (t && typeof t.userText === "string" && t.userText) lines.push("User: " + t.userText);
      var s = sent[i];
      if (s && typeof s.text === "string" && s.text) lines.push("Bot: " + s.text);
    }
    return lines.slice(-8);
  } catch (e) { return []; }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createService: createService, resolveConfig: Config.resolveConfig, buildLastTurns: buildLastTurns, DETECT_BAG_TTL_MS: DETECT_BAG_TTL_MS };
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

