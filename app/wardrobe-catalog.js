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
 * M11 BOT-SIDE STORAGE CONTRACT — SKETCH ONLY (not implemented; no bot
 * DB code is built or touched by this task):
 *   store(user_ref, pieces[])       // bot persists the interface-agnostic
 *                                   // piece records above under an opaque
 *                                   // user_ref it resolves server-side
 *   retrieve(user_ref) -> {pieces[]} // app fetches the same shape back;
 *                                   // payload is NEVER an IG shape
 * The seam this module leaves for that future milestone is the injected
 * user key + the interface-agnostic piece schema. Nothing here writes
 * to any bot, database, or network.
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

  var PIECE_STATUSES = ["active", "rejected", "superseded"];

  // Exact allowed keys — fail-closed: anything else throws.
  var PIECE_KEYS = [
    "piece_id",
    "category",
    "attributes",
    "source_share_id",
    "added_at",
    "copy_preview_keys",
    "status",
  ];
  // Visible evidence only: color / silhouette / layer role (§3, §8.4).
  // Never inferred fabric — "fabric" is not an allowed key, on purpose.
  var ATTRIBUTE_KEYS = ["color", "silhouette", "layer_role"];
  var COPY_PREVIEW_KEYS = ["copy", "preview"];
  var TURN_KEYS = ["turn", "userText", "proposal", "verdict", "reasons"];
  var SENT_TURN_KEYS = ["seq", "text", "sent_at", "in_reply_to_share"];
  var QUESTION_KEYS = ["id", "text", "asked_at", "resolved"];

  // 24h reply window, measured against the USER's latest inbound
  // received_at (user-anchored per §4 Gap 3), never per share_id.
  var REPLY_WINDOW_MS = 24 * 3600 * 1000;

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
        status: p.status,
      };
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
      var piece = {
        piece_id: id,
        category: v.category,
        attributes: Object.assign({}, attrs),
        source_share_id: v.source_share_id,
        added_at: v.added_at === undefined ? nowIso() : isoOrThrow(v.added_at, "added_at"),
        copy_preview_keys: { copy: cpk.copy === undefined ? null : cpk.copy, preview: cpk.preview === undefined ? null : cpk.preview },
        status: "active",
      };
      if (v.status !== undefined && v.status !== "active") {
        throw new Error("wardrobe-catalog: new pieces enter as 'active'");
      }
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

    function askQuestion(text) {
      if (typeof text !== "string" || text.length === 0) {
        throw new Error("wardrobe-catalog: question text is required");
      }
      questionCounter += 1;
      var q = {
        id: "SYNTH_q_" + String(questionCounter).padStart(3, "0"),
        text: text,
        asked_at: nowIso(),
        resolved: false,
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

    return {
      userKey: userKey,
      noteInboundShare: noteInboundShare,
      replyWindowStatus: replyWindowStatus,
      addPiece: addPiece,
      getPiece: getPiece,
      getPieces: getPieces,
      getActivePieces: getActivePieces,
      setCopyPreviewKeys: setCopyPreviewKeys,
      rejectPiece: rejectPiece,
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
    ATTRIBUTE_KEYS: ATTRIBUTE_KEYS,
    TURN_KEYS: TURN_KEYS,
    REPLY_WINDOW_MS: REPLY_WINDOW_MS,
    createCatalog: createCatalog,
  };

  if (root.MetaStyles === undefined) root.MetaStyles = {};
  root.MetaStyles.wardrobeCatalog = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
