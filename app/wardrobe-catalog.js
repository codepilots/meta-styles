"use strict";
/* meta-styles Milestone 19c — NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * User-keyed wardrobe catalog module
 * (docs/milestone-19-chat-first-pivot.md §3, §7 task 3).
 *
 * One user keeps one evolving wardrobe/conversation across many shared
 * photos over time — NOT one-thread-per-share-id (§8.5). The catalog
 * module takes the user key as an INJECTED parameter
 * (createCatalog({ userKey })) — single-user assumption until §8.9
 * resolves; no user id is hardcoded anywhere in this file.
 *
 * Interface-agnostic schema (hard framing rule, §3): piece records
 * carry NO Instagram-specific fields (no IGSID, no mid semantics, no
 * Graph API shapes — source_share_id is an opaque provenance string
 * only), and NO fabric/price/vendor fields (fully descoped per §8.4 —
 * the agent says it does not have that data rather than inventing a
 * listing). Unknown keys are REJECTED (fail-closed), so a future edit
 * cannot silently smuggle an IG or inventory field into the schema.
 *
 * Piece record (exact field names, §3):
 *   piece_id, category, attributes, source_share_id, added_at,
 *   copy_preview_keys, status ("active" / "rejected" / "superseded")
 * Turn record (§3): { turn, userText, proposal, verdict, reasons[] }
 * Plus: own-sent-turn log (Gap 4 — no live outbound route to read the
 * app's own sends back from), pending clarifying questions, and a
 * user-anchored reply-window check (24h measured against THIS user's
 * latest inbound received_at, not per share_id — §4 Gap 3).
 *
 * M11 BOT-SIDE STORAGE CONTRACT — WIRED BY MILESTONE 19h (memory +
 * persisted). The mock bot (`mock-ig-bot/server.js`, NEW hackathon work,
 * never the prior-work `igwebhook` service) exposes a local-only
 *   PUT /ig/catalog/<user_ref>  // body: full piece array (whole-array
 *                               // replace, last-write-wins, opaque bytes)
 *   GET /ig/catalog/<user_ref>  // -> the stored array, or [] when empty
 * with per-user AES-256-GCM encryption at rest (Node builtins only).
 * The seam is the injected user key + the interface-agnostic piece
 * schema, now joined by an injected store: pass
 * `createCatalog({ userKey, store })` where store is built by
 * `createCatalogStore({ base, token, userRef })` (same base/token/error
 * conventions as app/send-client.js). `catalog.save()` PUTs the current
 * pieces on update; `catalog.load()` GETs and whole-array-replaces local
 * memory on load. With no store attached the catalog stays memory-only
 * exactly as before (save/load resolve an honest `no_store` error).
 *
 * All ids/text below are synthetic (SYNTH_ prefix, example.invalid
 * URLs) — never real Instagram data.
 */

(function (root) {
  // Fixed classifier taxonomy term (mirrors app/classifier.js TAXONOMY —
  // "shoes" is deliberately NOT in it; the assembler rejects shoes).
  var TAXONOMY = [
    "base/top",
    "base/bottom",
    "dress",
    "layer/cardigan",
    "layer/blazer",
    "scarf",
    "bag",
  ];

  var PIECE_STATUSES = ["active", "rejected", "superseded", "held"];

  // Exact allowed keys — fail-closed: anything else throws.
  // photo_thumb is the small PNG data-URL reference captured at catalogue
  // time by app/photo-thumb.js makeSync() (M21 photo-reference work);
  // optional — old pieces catalogued before the feature simply lack it.
  // held_until is the ISO-8601 expiry of a prospective-purchase 24h hold
  // (M22 item 3); optional — only "held" pieces carry it, and it is
  // cleared to null when the hold is confirmed via activatePiece().
  var PIECE_KEYS = [
    "piece_id",
    "category",
    "attributes",
    "source_share_id",
    "added_at",
    "copy_preview_keys",
    "photo_thumb",
    "held_until",
    "status",
  ];
  // Per-thumb size bound, mirrors app/photo-thumb.js MAX_CHARS so a stored
  // thumb always fits the bot-side 1MB whole-catalog PUT cap (mock-ig-bot
  // MAX_SEND_BODY) with room for dozens of pieces. There is no separate
  // per-piece byte cap in this file — this IS the per-piece bound.
  var PHOTO_THUMB_MAX_CHARS = 20 * 1024;
  // Visible evidence only: color / silhouette / layer role (§3, §8.4).
  // Never inferred fabric — "fabric" is not an allowed key, on purpose.
  var ATTRIBUTE_KEYS = ["color", "silhouette", "layer_role"];
  var COPY_PREVIEW_KEYS = ["copy", "preview"];
  var TURN_KEYS = ["turn", "userText", "proposal", "verdict", "reasons"];
  var SENT_TURN_KEYS = ["seq", "text", "sent_at", "in_reply_to_share"];
  var QUESTION_KEYS = ["id", "text", "asked_at", "resolved", "skill", "expects", "expires_at"];

  // Pending-expectation window (Milestone 24): a skill awaiting a specific
  // kind of reply (e.g. What_suits consent asking for photos) holds it for
  // the same 24h window the M22 purchase hold and the user-anchored reply
  // window use — an ISO-8601 expiry compared the same way, not a new
  // ad-hoc format. Anything older reads as already resolved.
  var PENDING_EXPECTATION_TTL_MS = 24 * 3600 * 1000;
  // Fail-closed vocabulary for what a pending question can await. Only
  // "image" exists today; anything else throws rather than silently
  // matching a turn it was never meant to match.
  var EXPECTS_VALUES = ["image"];

  // 24h reply window, measured against the USER's latest inbound
  // received_at (user-anchored per §4 Gap 3), never per share_id.
  var REPLY_WINDOW_MS = 24 * 3600 * 1000;

  // Milestone 19h — catalog API base. Defaults to mock bot 8904;
  // LIVE_IG=1 injects app/ig-runtime-config.js -> window.__IG_RUNTIME__
  // with catalogBase + catalogToken for the real bot (same-origin proxy
  // prefix "/ig" — see joinBase; absolute bases keep working unchanged).
  var _RT = (typeof globalThis !== "undefined" && globalThis.__IG_RUNTIME__) || {};
  var CATALOG_BASE = _RT.catalogBase || _RT.botBase || "http://127.0.0.1:8904";
  var RUNTIME_CATALOG_TOKEN = _RT.catalogToken || "";

  // Join a configured base with a "/ig/..." path without doubling the
  // prefix: joinBase("/ig", "/ig/catalog/x") === "/ig/catalog/x", while
  // absolute bases concatenate as before. (Same tiny helper is duplicated
  // in inbox-bridge.js, send-client.js, and meta-client.js — this static
  // app has no shared module, so each file stays standalone for Node tests.)
  function joinBase(base, path) {
    var b = String(base === undefined || base === null ? "" : base);
    if (b.length > 1) b = b.replace(/\/+$/, "");
    else if (b === "/") b = "";
    if (b && path.indexOf(b + "/") === 0) return path;
    return b + path;
  }

  // Same result shape as send-client.normalizeResult(): HTTP statuses
  // resolve (surfaced), only a network failure resolves as status 0
  // `bot_unreachable`. Never throws for transport/HTTP outcomes.
  function normalizeStoreResult(status, body, op) {
    var ok = status === 200 || status === 204;
    var error = body && typeof body.error === "string" ? body.error : null;
    return {
      ok: ok,
      status: status,
      body: body || {},
      error: ok ? null : (error || ("http_" + status)),
      op: op,
    };
  }

  function parseJsonBody(text) {
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (err) {
      return null;
    }
  }

  // One persisted-catalog client per user wardrobe; mirrors
  // send-client.createSendClient (base/token opts, Bearer auth, honest
  // error results). Payloads are the interface-agnostic piece arrays —
  // NEVER an IG shape. Requires root.fetch (browser + Node 18+).
  function createCatalogStore(opts) {
    var o = opts || {};
    var base = o.base || CATALOG_BASE;
    var token = o.token || RUNTIME_CATALOG_TOKEN || "";
    var userRef = o.userRef || "";

    function url() {
      return joinBase(base, "/ig/catalog/" + encodeURIComponent(userRef));
    }

    function authed(method, body) {
      return root.fetch(url(), {
        method: method,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }

    // Whole-array replace: PUTs the FULL catalog array for this user_ref.
    // Last write wins server-side. Resolves {ok:true} on 200/204.
    function save(pieces) {
      if (!root.Promise) return null;
      if (!Array.isArray(pieces)) {
        return root.Promise.resolve({
          ok: false, status: 0, body: {}, error: "bad_catalog", op: "save",
        });
      }
      return authed("PUT", pieces).then(function (res) {
        return res.text().then(function (text) {
          return normalizeStoreResult(res.status, parseJsonBody(text) || {}, "save");
        });
      }, function () {
        return { ok: false, status: 0, body: {}, error: "bot_unreachable", op: "save" };
      });
    }

    // Whole-array read: GETs the stored array ([] when nothing stored).
    // Mock bot returns a raw array; real bot wraps as {"pieces": [...]};
    // both are accepted. Resolves {ok:true, pieces:[...]}; non-array
    // shapes are surfaced as bad_catalog, never passed through.
    function load() {
      if (!root.Promise) return null;
      return root.fetch(url(), {
        headers: { Authorization: "Bearer " + token },
      }).then(function (res) {
        return res.text().then(function (text) {
          var parsed = parseJsonBody(text);
          // Unwrap real-bot shape {"pieces": [...]} -> [...]
          var arr = parsed;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray(parsed.pieces)) {
            arr = parsed.pieces;
          }
          if (res.status === 200 && !Array.isArray(arr)) {
            return { ok: false, status: 200, body: {}, error: "bad_catalog", op: "load" };
          }
          var out = normalizeStoreResult(
            res.status, Array.isArray(parsed) ? {} : (parsed || {}), "load");
          if (out.ok) out.pieces = arr;
          return out;
        });
      }, function () {
        return { ok: false, status: 0, body: {}, error: "bot_unreachable", op: "load" };
      });
    }

    return {
      base: base,
      userRef: userRef,
      save: save,
      load: load,
    };
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function rejectUnknownKeys(obj, allowed, label) {
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      if (allowed.indexOf(keys[i]) === -1) {
        throw new Error(
          "wardrobe-catalog: rejected key '" + keys[i] + "' on " + label +
          " (interface-agnostic schema — no IG/inventory fields)"
        );
      }
    }
  }

  function isoOrThrow(value, label) {
    var ms = Date.parse(value);
    if (typeof value !== "string" || Number.isNaN(ms)) {
      throw new Error("wardrobe-catalog: " + label + " must be an ISO timestamp string");
    }
    return value;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  // Injected user key — required, never defaulted, never hardcoded.
  function createCatalog(opts) {
    var o = opts || {};
    if (typeof o.userKey !== "string" || o.userKey.length === 0) {
      throw new Error(
        "wardrobe-catalog: a user key is required " +
        "(createCatalog({ userKey }) — single-user assumption until §8.9 resolves)"
      );
    }
    var userKey = o.userKey;
    // Injected persistence (Milestone 19h): a createCatalogStore() client.
    // Absent by default — the catalog stays memory-only exactly as before.
    var store = o.store && typeof o.store.save === "function" &&
      typeof o.store.load === "function" ? o.store : null;

    var pieces = [];           // piece records, §3 schema (never deleted)
    var turns = [];            // turn records {turn, userText, proposal, verdict, reasons[]}
    var sentTurns = [];        // own-sent-turn log (Gap 4)
    var pendingQuestions = []; // clarifying questions awaiting a user answer
    var latestInboundMs = null;
    var latestInboundAt = null;
    var pieceCounter = 0;
    var questionCounter = 0;

    function findPieceIndex(pieceId) {
      for (var i = 0; i < pieces.length; i++) {
        if (pieces[i].piece_id === pieceId) return i;
      }
      return -1;
    }

    function copyPiece(p) {
      return {
        piece_id: p.piece_id,
        category: p.category,
        attributes: Object.assign({}, p.attributes),
        source_share_id: p.source_share_id,
        added_at: p.added_at,
        copy_preview_keys: Object.assign({}, p.copy_preview_keys),
        photo_thumb: p.photo_thumb === undefined || p.photo_thumb === null ? null : p.photo_thumb,
        held_until: p.held_until === undefined || p.held_until === null ? null : p.held_until,
        status: p.status,
      };
    }

    // Optional thumbnail reference: null/absent is valid (pieces
    // catalogued before the photo-reference feature, or catalogued from an
    // undecodable image, carry no thumb and still catalogue). A present
    // value must be a small PNG/JPEG data URL within the per-thumb bound;
    // anything else throws (fail-closed, same as every other piece field).
    function checkPhotoThumb(value, label) {
      if (value === undefined || value === null) return null;
      if (typeof value !== "string" || value.length > PHOTO_THUMB_MAX_CHARS ||
          !(value.indexOf("data:image/png;base64,") === 0 ||
            value.indexOf("data:image/jpeg;base64,") === 0)) {
        throw new Error(
          "wardrobe-catalog: " + label + " must be a small PNG/JPEG data URL " +
          "(<=" + PHOTO_THUMB_MAX_CHARS + " chars)"
        );
      }
      return value;
    }

    // Optional hold expiry: null/absent is valid (every non-held piece,
    // and old pieces from before the field existed). A present value
    // must be an ISO-8601 timestamp string; anything else throws
    // (fail-closed, same as every other piece field).
    function checkHeldUntil(value, label) {
      if (value === undefined || value === null) return null;
      return isoOrThrow(value, label);
    }

    // Fail-closed validation for one piece record read back from the
    // persisted store (Milestone 19h load path). Same interface-agnostic
    // schema as addPiece, except stored pieces may carry any of the four
    // lifecycle statuses (active/rejected/superseded/held), not just
    // 'active'/'held'. Throws on anything else; memory is only replaced
    // after the WHOLE array validates, so a corrupt stored array never
    // half-loads.
    function validateStoredPiece(p, seenIds) {
      if (!isPlainObject(p)) {
        throw new Error("wardrobe-catalog: stored catalog holds a non-object piece");
      }
      rejectUnknownKeys(p, PIECE_KEYS, "stored piece");
      if (typeof p.piece_id !== "string" || p.piece_id.length === 0) {
        throw new Error("wardrobe-catalog: stored piece needs a non-empty piece_id");
      }
      if (seenIds[p.piece_id]) {
        throw new Error("wardrobe-catalog: stored catalog has duplicate piece_id '" + p.piece_id + "'");
      }
      seenIds[p.piece_id] = true;
      if (typeof p.category !== "string" || TAXONOMY.indexOf(p.category) === -1) {
        throw new Error("wardrobe-catalog: stored piece has an unknown category");
      }
      if (!isPlainObject(p.attributes)) {
        throw new Error("wardrobe-catalog: stored piece attributes must be an object");
      }
      rejectUnknownKeys(p.attributes, ATTRIBUTE_KEYS, "stored piece attributes");
      if (typeof p.source_share_id !== "string" || p.source_share_id.length === 0) {
        throw new Error("wardrobe-catalog: stored piece needs source_share_id");
      }
      isoOrThrow(p.added_at, "stored added_at");
      if (!isPlainObject(p.copy_preview_keys)) {
        throw new Error("wardrobe-catalog: stored copy_preview_keys must be an object");
      }
      rejectUnknownKeys(p.copy_preview_keys, COPY_PREVIEW_KEYS, "stored copy_preview_keys");
      checkPhotoThumb(p.photo_thumb, "stored photo_thumb");
      checkHeldUntil(p.held_until, "stored held_until");
      if (PIECE_STATUSES.indexOf(p.status) === -1) {
        throw new Error("wardrobe-catalog: stored piece has an unknown status");
      }
      return copyPiece(p);
    }

    // Validate a whole stored array; returns { pieces, maxCounter } where
    // maxCounter is the highest SYNTH_piece_NNN suffix seen, so the next
    // app-assigned id cannot collide with a loaded one.
    function checkStoredArray(arr) {
      if (!Array.isArray(arr)) {
        throw new Error("wardrobe-catalog: stored catalog is not an array");
      }
      var seenIds = {};
      var maxCounter = 0;
      var next = arr.map(function (p) { return validateStoredPiece(p, seenIds); });
      next.forEach(function (p) {
        var m = /^SYNTH_piece_(\d+)$/.exec(p.piece_id);
        if (m && Number(m[1]) > maxCounter) maxCounter = Number(m[1]);
      });
      return { pieces: next, maxCounter: maxCounter };
    }

    // Provenance pointer for the 24h window + turn linkage. Opaque:
    // never an IGSID, never a Graph shape.
    function noteInboundShare(share) {
      var s = share || {};
      if (typeof s.shareId !== "string" || s.shareId.length === 0) {
        throw new Error("wardrobe-catalog: noteInboundShare needs { shareId, receivedAt }");
      }
      var at = isoOrThrow(s.receivedAt, "receivedAt");
      var ms = Date.parse(at);
      if (latestInboundMs === null || ms > latestInboundMs) {
        latestInboundMs = ms;
        latestInboundAt = at;
      }
      return { share_id: s.shareId, received_at: at };
    }

    // User-anchored window flag: open only within 24h of THIS user's
    // latest inbound received_at (§4 Gap 3). No inbound yet, or a stale
    // user, both read as closed — honestly, never assumed open.
    function replyWindowStatus(now) {
      var atMs = now === undefined ? Date.now() : Date.parse(now);
      if (latestInboundMs === null || Number.isNaN(atMs)) {
        return {
          anchored: "user",
          user_key: userKey,
          latest_inbound_at: latestInboundAt,
          open: false,
          reason: latestInboundMs === null ? "no_inbound_yet" : "bad_now_timestamp",
        };
      }
      var open = atMs - latestInboundMs >= 0 && atMs - latestInboundMs < REPLY_WINDOW_MS;
      return {
        anchored: "user",
        user_key: userKey,
        latest_inbound_at: latestInboundAt,
        open: open,
        reason: open ? "within_window" : "reply_window_expired",
      };
    }

    // Extract-and-catalog one garment from a photo share: visible
    // evidence only (color/silhouette/layer role). piece_id is
    // app-assigned unless the caller passes an explicit SYNTH_ id.
    function addPiece(input) {
      var v = input || {};
      rejectUnknownKeys(v, PIECE_KEYS, "piece input");
      if (typeof v.category !== "string" || TAXONOMY.indexOf(v.category) === -1) {
        throw new Error(
          "wardrobe-catalog: category must be a fixed taxonomy term (" +
          TAXONOMY.join(", ") + ")"
        );
      }
      var attrs = v.attributes === undefined ? {} : v.attributes;
      if (!isPlainObject(attrs)) {
        throw new Error("wardrobe-catalog: attributes must be an object");
      }
      rejectUnknownKeys(attrs, ATTRIBUTE_KEYS, "piece attributes");
      if (typeof v.source_share_id !== "string" || v.source_share_id.length === 0) {
        throw new Error("wardrobe-catalog: source_share_id (opaque provenance pointer) is required");
      }
      var cpk = v.copy_preview_keys === undefined
        ? { copy: null, preview: null }
        : v.copy_preview_keys;
      if (!isPlainObject(cpk)) {
        throw new Error("wardrobe-catalog: copy_preview_keys must be an object");
      }
      rejectUnknownKeys(cpk, COPY_PREVIEW_KEYS, "copy_preview_keys");
      var id;
      if (v.piece_id === undefined) {
        pieceCounter += 1;
        id = "SYNTH_piece_" + String(pieceCounter).padStart(3, "0");
      } else {
        if (typeof v.piece_id !== "string" || v.piece_id.length === 0) {
          throw new Error("wardrobe-catalog: piece_id must be a non-empty string");
        }
        if (findPieceIndex(v.piece_id) !== -1) {
          throw new Error("wardrobe-catalog: duplicate piece_id '" + v.piece_id + "'");
        }
        id = v.piece_id;
      }
      var status = v.status === undefined ? "active" : v.status;
      if (status !== "active" && status !== "held") {
        throw new Error("wardrobe-catalog: new pieces enter as 'active' or 'held'");
      }
      var piece = {
        piece_id: id,
        category: v.category,
        attributes: Object.assign({}, attrs),
        source_share_id: v.source_share_id,
        added_at: v.added_at === undefined ? nowIso() : isoOrThrow(v.added_at, "added_at"),
        copy_preview_keys: { copy: cpk.copy === undefined ? null : cpk.copy, preview: cpk.preview === undefined ? null : cpk.preview },
        photo_thumb: checkPhotoThumb(v.photo_thumb, "photo_thumb"),
        held_until: checkHeldUntil(v.held_until, "held_until"),
        status: status,
      };
      pieces.push(piece);
      return copyPiece(piece);
    }

    function getPiece(pieceId) {
      var i = findPieceIndex(pieceId);
      return i === -1 ? null : copyPiece(pieces[i]);
    }

    function getPieces(filter) {
      var f = filter || {};
      return pieces
        .filter(function (p) {
          return f.status === undefined || p.status === f.status;
        })
        .map(copyPiece);
    }

    function getActivePieces() {
      return getPieces({ status: "active" });
    }

    // Cache keys for generated copy/preview, so repeats never re-call
    // the proxy for the same piece (§3).
    function setCopyPreviewKeys(pieceId, keys) {
      var i = findPieceIndex(pieceId);
      if (i === -1) throw new Error("wardrobe-catalog: unknown piece_id '" + pieceId + "'");
      var k = keys || {};
      rejectUnknownKeys(k, COPY_PREVIEW_KEYS, "copy_preview_keys");
      if (k.copy !== undefined) pieces[i].copy_preview_keys.copy = k.copy;
      if (k.preview !== undefined) pieces[i].copy_preview_keys.preview = k.preview;
      return copyPiece(pieces[i]);
    }

    // Rejections flip flags, never delete history (§3).
    function rejectPiece(pieceId) {
      var i = findPieceIndex(pieceId);
      if (i === -1) throw new Error("wardrobe-catalog: unknown piece_id '" + pieceId + "'");
      pieces[i].status = "rejected";
      return copyPiece(pieces[i]);
    }

    // Purchase confirmation (M22 item 3): a "held" piece whose hold has
    // not expired becomes fully "active". held_until is cleared to null
    // (not deleted — the key stays in the fail-closed schema, null like
    // photo_thumb on pieces without one) so a confirmed piece never
    // reads as still-held. Throws on unknown ids, same as rejectPiece.
    function activatePiece(pieceId) {
      var i = findPieceIndex(pieceId);
      if (i === -1) throw new Error("wardrobe-catalog: unknown piece_id '" + pieceId + "'");
      pieces[i].status = "active";
      pieces[i].held_until = null;
      return copyPiece(pieces[i]);
    }

    function markSuperseded(oldPieceId, newPieceId) {
      var oi = findPieceIndex(oldPieceId);
      var ni = findPieceIndex(newPieceId);
      if (oi === -1) throw new Error("wardrobe-catalog: unknown piece_id '" + oldPieceId + "'");
      if (ni === -1) throw new Error("wardrobe-catalog: unknown piece_id '" + newPieceId + "'");
      pieces[oi].status = "superseded";
      return copyPiece(pieces[oi]);
    }

    // One conversation turn: user text + proposal + assembleLook
    // verdict + reasons[]. verdict accepts a boolean or an
    // assembleLook-shaped { valid } object; stored as a boolean.
    function recordTurn(input) {
      var v = input || {};
      rejectUnknownKeys(v, TURN_KEYS, "turn input");
      var verdict = v.verdict;
      if (isPlainObject(verdict) && typeof verdict.valid === "boolean") {
        verdict = verdict.valid;
      }
      if (typeof verdict !== "boolean") {
        throw new Error("wardrobe-catalog: verdict must be a boolean (or { valid })");
      }
      if (!Array.isArray(v.reasons)) {
        throw new Error("wardrobe-catalog: reasons[] is required (possibly empty)");
      }
      var turn = {
        turn: turns.length + 1,
        userText: typeof v.userText === "string" ? v.userText : "",
        proposal: v.proposal === undefined ? null : v.proposal,
        verdict: verdict,
        reasons: v.reasons.slice(),
      };
      if (isPlainObject(turn.proposal)) {
        rejectUnknownKeys(turn.proposal, ["pieces", "title", "note"], "turn proposal");
      }
      turns.push(turn);
      return JSON.parse(JSON.stringify(turn));
    }

    function getTurns() {
      return JSON.parse(JSON.stringify(turns));
    }

    // Next-turn prompt input: this user's active pieces + full turn
    // history, keyed by the injected user key.
    function historyForPrompt() {
      return {
        user_key: userKey,
        pieces: getActivePieces(),
        turns: getTurns(),
        pending_questions: getPendingQuestions(),
      };
    }

    // Pending-expectation form (Milestone 24): askQuestion({ text, skill,
    // expects }) records "we are mid-flow, awaiting a specific kind of
    // reply" state a later turn can route on. Bare-string askQuestion(text)
    // stays valid (existing callers, e.g. turn-loop.js) and records a
    // plain question with no expectation attached. expires_at defaults to
    // asked_at + PENDING_EXPECTATION_TTL_MS for expectations, null for
    // plain questions; callers may pass an explicit ISO expires_at the
    // same way addPiece accepts an explicit added_at.
    function askQuestion(input) {
      var v;
      if (typeof input === "string") {
        v = { text: input };
      } else if (isPlainObject(input)) {
        v = input;
        rejectUnknownKeys(v, ["text", "skill", "expects", "expires_at"], "question input");
      } else {
        throw new Error("wardrobe-catalog: question needs text (string or { text, ... })");
      }
      if (typeof v.text !== "string" || v.text.length === 0) {
        throw new Error("wardrobe-catalog: question text is required");
      }
      var skill = v.skill === undefined ? null : v.skill;
      if (skill !== null && (typeof skill !== "string" || skill.length === 0)) {
        throw new Error("wardrobe-catalog: question skill must be a non-empty skill name");
      }
      var expects = v.expects === undefined ? null : v.expects;
      if (expects !== null && EXPECTS_VALUES.indexOf(expects) === -1) {
        throw new Error("wardrobe-catalog: question expects must be one of (" + EXPECTS_VALUES.join(", ") + ")");
      }
      var askedAt = nowIso();
      var expiresAt;
      if (v.expires_at === undefined) {
        expiresAt = expects === null ? null : new Date(Date.parse(askedAt) + PENDING_EXPECTATION_TTL_MS).toISOString();
      } else if (v.expires_at === null) {
        expiresAt = null;
      } else {
        expiresAt = isoOrThrow(v.expires_at, "expires_at");
      }
      questionCounter += 1;
      var q = {
        id: "SYNTH_q_" + String(questionCounter).padStart(3, "0"),
        text: v.text,
        asked_at: askedAt,
        resolved: false,
        skill: skill,
        expects: expects,
        expires_at: expiresAt,
      };
      pendingQuestions.push(q);
      return Object.assign({}, q);
    }

    function resolveQuestion(id) {
      for (var i = 0; i < pendingQuestions.length; i++) {
        if (pendingQuestions[i].id === id) {
          pendingQuestions[i].resolved = true;
          return Object.assign({}, pendingQuestions[i]);
        }
      }
      throw new Error("wardrobe-catalog: unknown question id '" + id + "'");
    }

    function getPendingQuestions() {
      return pendingQuestions
        .filter(function (q) { return !q.resolved; })
        .map(function (q) { return Object.assign({}, q); });
    }

    // Gap 4: the live side has no outbound-log route, so the app
    // records its own sent turns locally (text + opaque share linkage
    // only — never a recipient identifier).
    function recordSentTurn(input) {
      var v = input || {};
      rejectUnknownKeys(v, SENT_TURN_KEYS, "sent-turn input");
      if (typeof v.text !== "string" || v.text.length === 0) {
        throw new Error("wardrobe-catalog: sent-turn text is required");
      }
      var sent = {
        seq: sentTurns.length + 1,
        text: v.text,
        sent_at: v.sent_at === undefined ? nowIso() : isoOrThrow(v.sent_at, "sent_at"),
        in_reply_to_share: v.in_reply_to_share === undefined ? null : v.in_reply_to_share,
      };
      if (sent.in_reply_to_share !== null && typeof sent.in_reply_to_share !== "string") {
        throw new Error("wardrobe-catalog: in_reply_to_share must be an opaque share id string");
      }
      sentTurns.push(sent);
      return Object.assign({}, sent);
    }

    function getSentTurns() {
      return sentTurns.map(function (s) { return Object.assign({}, s); });
    }

    function toJSON() {
      return {
        user_key: userKey,
        pieces: getPieces(),
        turns: getTurns(),
        sent_turns: getSentTurns(),
        pending_questions: pendingQuestions.map(function (q) { return Object.assign({}, q); }),
        latest_inbound_at: latestInboundAt,
      };
    }

    function noStore(op) {
      if (!root.Promise) return null;
      return root.Promise.resolve({ ok: false, status: 0, body: {}, error: "no_store", op: op });
    }

    // PUT on catalog update: persists the FULL piece array through the
    // injected store (whole-array replace, last write wins). Resolves
    // send-client-style {ok,...}; with no store attached resolves an
    // honest no_store error and changes nothing.
    function save() {
      if (!store) return noStore("save");
      return store.save(getPieces());
    }

    // GET on load: fetches the stored array and whole-array-replaces
    // local memory with it (validated fail-closed first — a corrupt
    // stored array resolves an error and leaves memory untouched).
    function load() {
      if (!store) return noStore("load");
      return store.load().then(function (result) {
        if (!result.ok) return result;
        var checked;
        try {
          checked = checkStoredArray(result.pieces);
        } catch (err) {
          return {
            ok: false, status: result.status, body: {},
            error: String((err && err.message) || err), op: "load",
          };
        }
        pieces = checked.pieces;
        if (checked.maxCounter > pieceCounter) pieceCounter = checked.maxCounter;
        return { ok: true, status: result.status, body: {}, error: null, op: "load", count: pieces.length };
      });
    }

    return {
      userKey: userKey,
      store: store,
      save: save,
      load: load,
      noteInboundShare: noteInboundShare,
      replyWindowStatus: replyWindowStatus,
      addPiece: addPiece,
      getPiece: getPiece,
      getPieces: getPieces,
      getActivePieces: getActivePieces,
      setCopyPreviewKeys: setCopyPreviewKeys,
      rejectPiece: rejectPiece,
      activatePiece: activatePiece,
      markSuperseded: markSuperseded,
      recordTurn: recordTurn,
      getTurns: getTurns,
      historyForPrompt: historyForPrompt,
      askQuestion: askQuestion,
      resolveQuestion: resolveQuestion,
      getPendingQuestions: getPendingQuestions,
      recordSentTurn: recordSentTurn,
      getSentTurns: getSentTurns,
      toJSON: toJSON,
    };
  }

  var api = {
    TAXONOMY: TAXONOMY,
    PIECE_STATUSES: PIECE_STATUSES,
    PIECE_KEYS: PIECE_KEYS,
    PHOTO_THUMB_MAX_CHARS: PHOTO_THUMB_MAX_CHARS,
    ATTRIBUTE_KEYS: ATTRIBUTE_KEYS,
    TURN_KEYS: TURN_KEYS,
    REPLY_WINDOW_MS: REPLY_WINDOW_MS,
    PENDING_EXPECTATION_TTL_MS: PENDING_EXPECTATION_TTL_MS,
    CATALOG_BASE: CATALOG_BASE,
    joinBase: joinBase,
    createCatalog: createCatalog,
    createCatalogStore: createCatalogStore,
  };

  if (root.MetaStyles === undefined) root.MetaStyles = {};
  root.MetaStyles.wardrobeCatalog = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
