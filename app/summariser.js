"use strict";
/* meta-styles Milestone 21 — summariser (rolling 100t summary + 100t preferences).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * After each turn, generate rolling 100-token summary + 100-token preferences
 * delta — never user-facing. Summaries used as next-turn context
 * (wardrobe summary + preferences).
 *
 * Persistence (Opus finding #10, honest as of this fix): memory-only. The
 * catalog contract is pieces-array-only (PUT /ig/catalog/<user_ref> rejects
 * non-array bodies; user_refs must match u_<32 hex>, so a "__meta" suffix
 * key is rejected too), so summary/preferences CANNOT be persisted through
 * it without changing its documented shape. persistViaStore() therefore
 * resolves an explicit { ok:false, error:"not_persisted" } — never a fake
 * { ok:true }. The rolling strings live in the service ctx and are lost on
 * restart; nothing claims otherwise. No local file/DB.
 */

(function (root) {
  var MAX_TOKENS = 100; // ~400 chars ≈ 100 tokens

  // Rolling window keeps the TAIL (most recent turns), not the head:
  // once the window is full, each new turn pushes the oldest content out
  // instead of being silently dropped (Opus finding #10). A partial
  // leading word from the cut is dropped for cleanliness.
  function truncateTokens(text, maxTokens) {
    var maxChars = maxTokens * 4;
    var t = String(text || "").trim();
    if (t.length <= maxChars) return t;
    var tail = t.slice(t.length - maxChars).trim();
    var sp = tail.indexOf(" ");
    if (sp > 0) tail = tail.slice(sp + 1);
    return tail;
  }

  function wordCount(text) { return String(text).split(/\s+/).filter(Boolean).length; }

  // Build a rolling summary from previous summary + last turn + skill choice
  function buildSummary(opts) {
    var o = opts || {};
    var prev = o.previousSummary || "";
    var lastText = o.lastUserText || "";
    var skill = o.skill || "";
    var replySnippet = (o.replyText || "").slice(0, 80);
    var piecesCount = o.piecesCount !== undefined ? o.piecesCount : 0;
    var base = prev ? prev + " " : "";
    var addition = "Turn: " + skill + " (" + piecesCount + " pieces). User: " + lastText.slice(0, 40) + ". Reply: " + replySnippet.slice(0, 40) + ".";
    return truncateTokens(base + addition, MAX_TOKENS);
  }

  function buildPreferences(opts) {
    var o = opts || {};
    var prev = o.previousPreferences || "";
    var delta = o.preferencesDelta || "";
    if (!delta) return truncateTokens(prev, MAX_TOKENS);
    var combined = prev ? prev + " " + delta : delta;
    return truncateTokens(combined, MAX_TOKENS);
  }

  // Persistence honesty (Opus finding #10): the catalog store contract is
  // pieces-array-only — store.save() PUTs a piece array and the bot rejects
  // non-array bodies with 400, and user_refs must match u_<32 hex> so a
  // "__meta"-suffixed key is rejected as bad_user_ref. There is therefore
  // NO compatible way to persist { summary, preferences } through it, and
  // this function must NOT report success for a no-op. It resolves an
  // explicit { ok:false, error:"not_persisted" } so callers (agentic-loop,
  // wardrobe-service) report the truth: rolling context is memory-only in
  // the service ctx and lost on restart. The summary/preferences arguments
  // are echoed back for convenience only — nothing was written anywhere.
  function persistViaStore(store, summary, preferences) {
    if (!store || typeof store.save !== "function") {
      return Promise.resolve({ ok: false, error: "no_store", summary: summary, preferences: preferences });
    }
    return Promise.resolve({
      ok: false,
      error: "not_persisted",
      reason: "catalog contract is pieces-array-only; summary/preferences are memory-only",
      summary: summary,
      preferences: preferences,
    });
  }

  // Full turn summarise: build + persist
  async function summariseTurn(opts) {
    var o = opts || {};
    var summary = buildSummary(o);
    var preferences = buildPreferences(o);
    var persistResult = null;
    if (o.store) {
      try { persistResult = await persistViaStore(o.store, summary, preferences); } catch (e) { persistResult = { ok: false, error: String(e.message || e) }; }
    }
    return { summary: summary, preferences: preferences, persistResult: persistResult };
  }

  var api = {
    MAX_TOKENS: MAX_TOKENS,
    truncateTokens: truncateTokens,
    buildSummary: buildSummary,
    buildPreferences: buildPreferences,
    persistViaStore: persistViaStore,
    summariseTurn: summariseTurn,
  };

  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.summariser = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
