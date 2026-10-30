"use strict";
/* meta-styles — turn-loop live wiring (NEW hackathon work, building period Oct 27 – Nov 4, 2026).
 *
 * Follow-up to Milestone 19d (docs/milestone-19-chat-first-pivot.md §2,
 * §7 task 5): app/turn-loop.js was built and unit-tested in isolation but
 * wired into NOTHING. This module is the single wiring both mock-dm.html
 * modes (MOCK demo bot and LIVE real bot) call once per poll tick — there
 * is no live-only or mock-only pipeline fork. The ONLY differences between
 * modes are the base/token arguments the page passes in (resolved by the
 * page's existing connection-field + __IG_RUNTIME__ logic); this module
 * itself never branches on mode.
 *
 * Per new share (photo or text), genuinely new and not the bot's own echo:
 *   1. classify the photo (meta-client.classify live via the proxy, with
 *      the labelled classifier.classifyRegion on-device fallback when the
 *      proxy is unreachable) or take the text turn as-is;
 *   2. run it through turn-loop.js's UNCHANGED contract (handlePhotoShare
 *      / handleTextTurn — extract-and-catalog, propose from the FULL
 *      catalogued pool, assembleLook validate, revise-or-flag replies);
 *   3. send the composed reply text-only via send-client.js's sendTurn
 *      (fresh idempotency key per turn; user-anchored 24h window checked
 *      BEFORE composing via poll-scheduler.js, so a lapsed window never
 *      records a turn it cannot send).
 *
 * Deliberately NOT live-wired (stated, not overlooked):
 *   - assemble/validate stays the local Assembler.assembleLook. The proxy's
 *     /api/assemble returns look PROPOSALS ({looks:[{pieceIds}]}, async),
 *     not fit-rule verdicts, and turn-loop's validate/copy slots are
 *     synchronous by contract — plugging the proxy in there would bypass
 *     the fit-rule engine the pivot doc mandates as the validator. The
 *     live-Spark-copy path stays available to future work that can carry
 *     it asynchronously; auto-replies use the labelled offline copy
 *     (placeholder:true), same as the rest of the judged mock path.
 *   - No preview image is staged or sent in the auto flow. Staging uses
 *     the mock-only /mock/stage-outbound-image route, which has no live
 *     counterpart — attaching images only in mock mode would BE the
 *     forbidden mock/live fork. Auto-replies are text-only in BOTH modes;
 *     the manual "Propose look" panel keeps the image flow for operators.
 *
 * Dedupe (at most ONE automatic reply per share id, ever): three layered
 * guards, all skip in the same direction —
 *   a. in-session set of ids this instance already handled;
 *   b. persisted map in the injected storage (the page passes
 *      window.localStorage, so it survives a page reload; outcomes are
 *      terminal: sent / duplicate / window_closed / unsupported — only a
 *      transport error retries, after a 60s cooldown);
 *   c. the catalog's own sent-turn log (in_reply_to_share match) as a
 *      backstop when storage was cleared mid-session.
 * The live bot has no outbound-log read route, so the outbound log is NOT
 * consulted — that keeps both modes on the identical code path.
 *
 * Single-user assumption (§8.9 unresolved): one fixed userKey/userRef for
 * the demo wardrobe in both modes, per wardrobe-catalog.js's injected-key
 * design. The catalog store is attached with the module's own live-aware
 * base/token resolution (wardrobe-catalog.js createCatalogStore), so
 * pieces persist across reloads wherever the bot offers /ig/catalog —
 * and degrade to memory-only when it does not. A failed load/save never
 * blocks a reply.
 *
 * All ids/text synthetic (SYNTH_ prefix, example.invalid URLs) — never
 * real Instagram data. Log lines are plain language for a non-technical
 * watcher: timestamp + what arrived + what happened. Never a token, never
 * a share/message id, never an API dump.
 */

(function (root) {
  var STORAGE_KEY = "metaStylesAutoReply:v1";
  var RETRY_COOLDOWN_MS = 60 * 1000;
  var TERMINAL_OUTCOMES = {
    sent: true,
    duplicate: true,
    window_closed: true,
    unsupported: true,
  };

  // Plain nouns for the activity log — category slugs stay in code, never
  // in front of a non-technical watcher.
  var CATEGORY_NOUNS = {
    "base/top": "top",
    "base/bottom": "bottoms",
    "dress": "dress",
    "layer/cardigan": "cardigan layer",
    "layer/blazer": "blazer layer",
    "scarf": "scarf",
    "bag": "bag",
  };

  function sibling(name) {
    if (root.MetaStyles) {
      if (root.MetaStyles[name]) return root.MetaStyles[name];
      // Browser registration uses camelCase keys (MetaStyles.wardrobeCatalog,
      // .turnLoop, .sendClient, .metaClient, .pollScheduler) while sibling()
      // is called with this module's hyphenated filename ("wardrobe-catalog",
      // "turn-loop", etc.) -- convert before giving up, or every multi-word
      // sibling silently resolves to null and createAutoReply throws
      // "<name> is unavailable" on the very first dependency check.
      var camel = name.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
      if (root.MetaStyles[camel]) return root.MetaStyles[camel];
    }
    if (typeof require !== "undefined") {
      try {
        return require("./" + name + ".js");
      } catch (err) {
        return null;
      }
    }
    return null;
  }

  // Same tiny helper duplicated across the sibling modules (this static
  // app has no shared module, so each file stays standalone for tests).
  function joinBase(base, path) {
    var b = String(base === undefined || base === null ? "" : base);
    if (b.length > 1) b = b.replace(/\/+$/, "");
    else if (b === "/") b = "";
    if (b && path.indexOf(b + "/") === 0) return path;
    return b + path;
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function indefinite(noun) {
    return (/^[aeiou]/i.test(noun) ? "an " : "a ") + noun;
  }

  function nounFor(category) {
    return CATEGORY_NOUNS[category] || "piece";
  }

  function shortText(text, max) {
    var t = String(text || "");
    if (t.length <= max) return t;
    return t.slice(0, max) + "…";
  }

  function base64Of(bytes) {
    if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
      var buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      return buf.toString("base64");
    }
    if (typeof btoa === "function") {
      var bin = "";
      var CHUNK = 32768;
      for (var i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return btoa(bin);
    }
    throw new Error("auto-reply: no base64 encoder available");
  }

  function createAutoReply(opts) {
    var o = opts || {};
    if (typeof o.base !== "string" || o.base.length === 0) {
      throw new Error("auto-reply: a bot base is required (createAutoReply({ base }))");
    }
    if (typeof o.userKey !== "string" || o.userKey.length === 0) {
      throw new Error("auto-reply: a userKey is required (single-user assumption until §8.9 resolves)");
    }
    if (typeof o.userRef !== "string" || o.userRef.length === 0) {
      throw new Error("auto-reply: a userRef is required (catalog store key, opaque)");
    }
    var base = o.base;
    var token = typeof o.token === "string" ? o.token : "";
    var sendBase = typeof o.sendBase === "string" ? o.sendBase : base;
    var sendToken = typeof o.sendToken === "string" ? o.sendToken : token;
    var catalogBase = typeof o.catalogBase === "string" ? o.catalogBase : base;
    var catalogToken = typeof o.catalogToken === "string" ? o.catalogToken : token;
    var storage = o.storage && typeof o.storage.getItem === "function" &&
      typeof o.storage.setItem === "function" ? o.storage : null;
    var clock = typeof o.nowMs === "function" ? o.nowMs : Date.now;
    var logFn = typeof o.log === "function" ? o.log : null;

    var Bridge = o.depsBridge || sibling("inbox-bridge");
    var Wardrobe = o.depsCatalog || sibling("wardrobe-catalog");
    var Assembler = o.depsAssembler || sibling("assembler");
    var Spark = o.depsSpark || sibling("spark");
    var Classifier = o.depsClassifier || sibling("classifier");
    var TurnLoop = o.depsTurnLoop || sibling("turn-loop");
    var SendClient = o.depsSend || sibling("send-client");
    var Meta = o.depsMeta || sibling("meta-client");
    var Scheduler = o.depsScheduler || sibling("poll-scheduler");

    if (!Wardrobe || typeof Wardrobe.createCatalog !== "function") {
      throw new Error("auto-reply: wardrobe-catalog is unavailable");
    }
    if (!TurnLoop || typeof TurnLoop.createTurnLoop !== "function") {
      throw new Error("auto-reply: turn-loop is unavailable");
    }
    if (!SendClient || typeof SendClient.createSendClient !== "function") {
      throw new Error("auto-reply: send-client is unavailable");
    }

    var validateFn = Assembler && typeof Assembler.assembleLook === "function"
      ? Assembler.assembleLook
      : null;
    var copyFn = Spark && typeof Spark.generateCopy === "function"
      ? Spark.generateCopy
      : null;

    // One wardrobe for the demo user in BOTH modes. The store reuses
    // wardrobe-catalog.js's own live-aware base/token resolution when the
    // caller passes them through (the page resolves per-route tokens the
    // same way its existing authed() helper already does).
    var store = null;
    try {
      if (typeof Wardrobe.createCatalogStore === "function") {
        store = Wardrobe.createCatalogStore({
          base: catalogBase,
          token: catalogToken,
          userRef: o.userRef,
        });
      }
    } catch (err) {
      store = null;
    }
    var catalog = Wardrobe.createCatalog({ userKey: o.userKey, store: store });
    var loop = TurnLoop.createTurnLoop({
      userKey: o.userKey,
      catalog: catalog,
      validate: validateFn || undefined,
      copy: copyFn || undefined,
    });
    var send = SendClient.createSendClient({ base: sendBase, token: sendToken });

    // Load persisted at-most-once map. Corrupt or foreign shapes reset to
    // empty rather than throwing — a bad blob must never wedge replies.
    var replied = {};
    if (storage) {
      try {
        var raw = storage.getItem(STORAGE_KEY);
        var parsed = raw ? JSON.parse(raw) : null;
        if (parsed && isPlainObject(parsed.replied)) {
          Object.keys(parsed.replied).forEach(function (id) {
            var e = parsed.replied[id];
            if (e && isPlainObject(e) && typeof e.outcome === "string") {
              replied[id] = { outcome: e.outcome, at: e.at, messageId: e.messageId };
            }
          });
        }
      } catch (err) {
        replied = {};
      }
    }

    function persist() {
      if (!storage) return;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, replied: replied }));
      } catch (err) {
        // Quota or privacy mode — the in-session + sent-turn guards below
        // still hold for this session; reload-safety just degrades.
      }
    }

    function mark(id, outcome, messageId) {
      replied[id] = { outcome: outcome, at: clock(), messageId: messageId || null };
      persist();
    }

    function terminalEntry(id) {
      var e = replied[id];
      if (!e) return null;
      if (TERMINAL_OUTCOMES[e.outcome] === true) return e;
      if (e.outcome === "error" && (clock() - (e.at || 0)) > RETRY_COOLDOWN_MS) return null;
      return e;
    }

    var seenThisRun = {}; // every id this instance already handled (any outcome)
    var deferredLogged = {}; // pending-media notice already shown this session

    var lines = [];
    function say(text) {
      var line = "[" + new Date(clock()).toLocaleTimeString() + "] " + text;
      lines.push(line);
      if (logFn) {
        try {
          logFn(line);
        } catch (err) {
          // A broken log sink must never break replies.
        }
      }
    }

    // Startup wardrobe load, best-effort: a missing route, a wrong token,
    // or an unreadable blob resolves to memory-only, never rejects.
    // processShares chains on this so a first tick cannot race the load
    // and then get its fresh pieces wiped by a late whole-array replace.
    var ready = (function init() {
      if (!store || typeof store.load !== "function") return Promise.resolve({ loaded: false });
      return store.load().then(function (res) {
        if (res && res.ok) return { loaded: true, count: res.count || 0 };
        say("Couldn't load your saved wardrobe — starting fresh this session.");
        return { loaded: false };
      }, function () {
        say("Couldn't load your saved wardrobe — starting fresh this session.");
        return { loaded: false };
      });
    })();

    function captionHint(item) {
      var payload = (item.attachment && item.attachment.payload) || {};
      var title = typeof payload.title === "string" ? payload.title : "";
      return title.slice(0, 40);
    }

    function fetchMediaDataURL(mediaId) {
      return root.fetch(joinBase(base, "/ig/media/" + encodeURIComponent(mediaId)), {
        headers: { Authorization: "Bearer " + token },
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

    // Classify one photo: live Muse Spark vision via the proxy when it is
    // reachable, otherwise the labelled on-device heuristic (placeholder).
    // Resolves { category, live } — never rejects.
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
      if (!canTryLive) return Promise.resolve(fallback());
      return fetchMediaDataURL(item.media_id).then(function (dataURL) {
        return Meta.classify(dataURL, hint).then(function (sparkRes) {
          try {
            var region = { kind: "box", rect: [0.2, 0.2, 0.6, 0.6], labelHint: hint || "" };
            var mapped = Classifier.classifyFromSpark(region, sparkRes);
            if (mapped && typeof mapped.category === "string") {
              return { category: mapped.category, live: true };
            }
          } catch (err) {
            // Off-shape model output falls back below.
          }
          return fallback();
        }, function () {
          return fallback();
        });
      }, function () {
        return fallback();
      });
    }

    function windowGate(item, batchLatest) {
      if (!Scheduler || typeof Scheduler.isWindowOpen !== "function") return true;
      var now = clock();
      var batchOpen = batchLatest ? Scheduler.isWindowOpen(batchLatest, now) : true;
      var itemOpen = Scheduler.isWindowOpen(item.received_at, now);
      return batchOpen && itemOpen;
    }

    function alreadySentByCatalog(id) {
      try {
        return catalog.getSentTurns().some(function (s) {
          return s && s.in_reply_to_share === id;
        });
      } catch (err) {
        return false;
      }
    }

    function describeSendError(result) {
      if (!result) return "Send failed — will try again on the next check.";
      if (result.status === 422) return "Reply window expired, didn't send a reply.";
      if (result.status === 401) return "Couldn't send — the bot didn't accept this page's login token.";
      if (result.status === 409 && result.error === "duplicate_send") {
        return "That reply already went out — keeping the earlier one.";
      }
      if (result.status === 0) return "Couldn't reach the bot — will try again on the next check.";
      return "Send failed — will try again on the next check.";
    }

    function saveBestEffort() {
      try {
        var r = catalog.save();
        if (r && typeof r.then === "function") {
          return r.then(function () { return null; }, function () { return null; });
        }
      } catch (err) {
        // Best-effort only.
      }
      return Promise.resolve(null);
    }

    function processOne(item, batchLatest, out) {
      var id = item && typeof item.id === "string" ? item.id : null;
      if (!id) {
        out.results.push({ id: null, action: "ignored", sent: false, retry: false });
        return Promise.resolve();
      }
      if (seenThisRun[id]) {
        out.skipped += 1;
        out.results.push({ id: id, action: "skipped", sent: false, retry: false });
        return Promise.resolve();
      }
      var echo = false;
      try {
        echo = SendClient.shouldProcess(item) === false;
      } catch (err) {
        echo = false;
      }
      if (echo) {
        seenThisRun[id] = true; // the bot's own send — never processed, never persisted
        out.results.push({ id: id, action: "ignored", sent: false, retry: false });
        return Promise.resolve();
      }
      var held = terminalEntry(id);
      if (held) {
        seenThisRun[id] = true;
        out.skipped += 1;
        out.results.push({ id: id, action: "skipped", sent: false, retry: false });
        return Promise.resolve();
      }
      if (alreadySentByCatalog(id)) {
        seenThisRun[id] = true;
        mark(id, "sent");
        out.skipped += 1;
        out.results.push({ id: id, action: "skipped", sent: false, retry: false });
        return Promise.resolve();
      }
      seenThisRun[id] = true;

      var isText = !!(Bridge && typeof Bridge.isTextItem === "function" && Bridge.isTextItem(item));
      var valid = false;
      try {
        valid = Bridge && typeof Bridge.isValidShareItem === "function"
          ? Bridge.isValidShareItem(item) === true
          : true;
      } catch (err) {
        valid = false;
      }
      if (!valid || (!isText && !(item.attachment && (item.attachment.type === "image" || item.attachment.type === "ig_post")))) {
        mark(id, "unsupported");
        say("Got a message I don't understand yet — skipped it.");
        out.processed += 1;
        out.results.push({ id: id, action: "unsupported", sent: false, retry: false });
        return Promise.resolve();
      }
      if (!isText && item.media_available === false && item.media_id) {
        // Still downloading on the bot — defer, no persisted mark, and the
        // caller re-offers this id next tick (same direction, no fork).
        if (!deferredLogged[id]) {
          deferredLogged[id] = true;
          say("Your photo isn't ready yet — I'll try again on the next check.");
        }
        delete seenThisRun[id];
        out.results.push({ id: id, action: "deferred", sent: false, retry: true });
        return Promise.resolve();
      }
      if (!isText && item.media_available === false && !item.media_id && !item.media_file) {
        mark(id, "unsupported");
        say("Got a message I don't understand yet — skipped it.");
        out.processed += 1;
        out.results.push({ id: id, action: "unsupported", sent: false, retry: false });
        return Promise.resolve();
      }

      // 24h window BEFORE composing: a lapsed window records nothing it
      // cannot send (no turn, no sent-turn entry), just the honest line.
      if (!windowGate(item, batchLatest)) {
        try {
          catalog.noteInboundShare({ shareId: id, receivedAt: item.received_at });
        } catch (err) {
          // Malformed timestamp — the gate already said closed; move on.
        }
        mark(id, "window_closed");
        say("Reply window expired, didn't send a reply.");
        out.processed += 1;
        out.results.push({ id: id, action: "window_closed", sent: false, retry: false });
        return Promise.resolve();
      }

      if (isText) {
        var text = "";
        try {
          text = Bridge.textOf(item);
        } catch (err) {
          text = "";
        }
        var turned;
        try {
          turned = loop.handleTextTurn(text, { shareId: id, receivedAt: item.received_at });
        } catch (err) {
          mark(id, "error");
          say("Auto-reply hit a snag on that message — will try again on the next check.");
          out.processed += 1;
          out.results.push({ id: id, action: "error", sent: false, retry: true });
          return Promise.resolve();
        }
        if (turned.noData) {
          say("Answered: no fabric or price data available.");
        } else if (turned.revised) {
          say("You said \"" + shortText(text, 28) + "\" — updated your wardrobe and re-checked the fit.");
        } else if (turned.best && turned.best.card && turned.best.card.valid) {
          say("Replied to your message with a full look.");
        } else {
          say("Replied to your message — not a full look yet, said why.");
        }
        return sendComposed(id, turned.text, out);
      }

      var hint = captionHint(item);
      return classifyPhoto(item, hint).then(function (found) {
        if (!found || !found.category) {
          mark(id, "error");
          say("Couldn't make sense of that photo — skipped it for now.");
          out.processed += 1;
          out.results.push({ id: id, action: "error", sent: false, retry: true });
          return null;
        }
        var composed;
        try {
          composed = loop.handlePhotoShare(
            { shareId: id, receivedAt: item.received_at },
            [{ category: found.category, attributes: {} }]
          );
        } catch (err) {
          mark(id, "error");
          say("Auto-reply hit a snag on that photo — will try again on the next check.");
          out.processed += 1;
          out.results.push({ id: id, action: "error", sent: false, retry: true });
          return null;
        }
        var lead = "Catalogued " + indefinite(nounFor(found.category)) + " from your photo. " +
          (composed.best && composed.best.card && composed.best.card.valid
            ? "Proposed a full look."
            : "Not a full look yet — explained why.");
        say(lead);
        if (!found.live) {
          say("Couldn't reach the styling service, used the on-device fallback.");
        }
        return sendComposed(id, composed.text, out);
      });
    }

    function sendComposed(id, text, out) {
      return send.sendTurn({ shareId: id, text: text }).then(function (result) {
        return saveBestEffort().then(function () {
          if (result && result.ok) {
            mark(id, "sent", result.body && result.body.message_id);
            say("Sent a reply.");
            out.processed += 1;
            out.sent += 1;
            out.results.push({ id: id, action: "sent", sent: true, retry: false });
          } else if (result && result.status === 409 && result.error === "duplicate_send") {
            mark(id, "duplicate");
            say("That reply already went out — keeping the earlier one.");
            out.processed += 1;
            out.results.push({ id: id, action: "duplicate", sent: false, retry: false });
          } else if (result && result.status === 422) {
            mark(id, "window_closed");
            say(describeSendError(result));
            out.processed += 1;
            out.results.push({ id: id, action: "window_closed", sent: false, retry: false });
          } else {
            mark(id, "error");
            say(describeSendError(result));
            out.processed += 1;
            out.results.push({ id: id, action: "error", sent: false, retry: true });
          }
          return null;
        });
      }, function () {
        mark(id, "error");
        say("Couldn't reach the bot — will try again on the next check.");
        out.processed += 1;
        out.results.push({ id: id, action: "error", sent: false, retry: true });
        return null;
      });
    }

    function processShares(items) {
      return ready.then(function () {
        var list = Array.isArray(items) ? items : [];
        var batchLatest = null;
        list.forEach(function (it) {
          if (it && typeof it.received_at === "string" &&
            (batchLatest === null || it.received_at > batchLatest)) {
            batchLatest = it.received_at;
          }
        });
        var out = { processed: 0, sent: 0, skipped: 0, results: [] };
        var chain = Promise.resolve();
        list.forEach(function (it) {
          chain = chain.then(function () {
            try {
              return processOne(it, batchLatest, out);
            } catch (err) {
              mark((it && it.id) || "unknown", "error");
              say("Auto-reply hit a snag — will try again on the next check.");
              out.processed += 1;
              out.results.push({ id: (it && it.id) || null, action: "error", sent: false, retry: true });
              return Promise.resolve();
            }
          });
        });
        return chain.then(function () { return out; });
      });
    }

    return {
      processShares: processShares,
      init: function () { return ready; },
      getLog: function () { return lines.slice(); },
      getRepliedIds: function () { return Object.keys(replied); },
      catalog: catalog,
    };
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    RETRY_COOLDOWN_MS: RETRY_COOLDOWN_MS,
    createAutoReply: createAutoReply,
  };

  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.autoReply = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
