"use strict";
/* meta-styles — shared closed-choice interpreter + category-word table.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Two things live here so they can never drift apart:
 *
 *  1. CATEGORY_WORDS — ONE singular/plural/synonym -> taxonomy table.
 *     categoryOf() scans it (earliest mention in the text wins) and is
 *     used by the router's offline heuristic plus the view/delete Step A
 *     local parse. revise_look's REVISE_WORDS covers the same vocabulary
 *     (extended there with revise-specific extras); the router's
 *     delete/view triggers stay in lockstep with it.
 *
 *  2. sparkPick() — the generic closed-choice fallback: when local parsing
 *     misses, ask Muse Spark (via metaClient.interpret -> POST
 *     /api/interpret) to pick exactly one caller-supplied option id.
 *     The server validates the choice against the supplied ids and the
 *     helper re-validates here — anything outside the options resolves
 *     null, so Spark can never invent a category, piece, or action.
 *     Never throws: null means "no match, reply honestly as before", and
 *     no Spark call happens at all when local parsing already succeeded
 *     (callers only invoke this on a miss) or when metaClient.interpret
 *     is missing/fails.
 *
 * Dual Node/browser module pattern (same as app/router.js): skills
 * require it in Node, browsers read the MetaStyles.interpret global.
 * All fixtures in tests are synthetic (SYNTH_ ids) — never real data.
 */
(function (root) {

  // Word -> taxonomy category. Every key is matched whole-word,
  // case-insensitive. Keep in sync with the classifier TAXONOMY
  // (meta-api-proxy/server.js) — every value must be one of those 8.
  var CATEGORY_WORDS = {
    // base/top
    "top": "base/top", "tops": "base/top",
    "tee": "base/top", "t-shirt": "base/top",
    "cami": "base/top", "camisole": "base/top",
    "shirt": "base/top",
    // base/bottom
    "bottom": "base/bottom", "bottoms": "base/bottom",
    "jeans": "base/bottom",
    "skirt": "base/bottom", "skirts": "base/bottom",
    "trousers": "base/bottom", "pants": "base/bottom",
    "shorts": "base/bottom",
    // dress
    "dress": "dress", "dresses": "dress",
    "gown": "dress",
    // layer/cardigan
    "cardigan": "layer/cardigan", "cardigans": "layer/cardigan",
    "shrug": "layer/cardigan",
    // layer/blazer
    "blazer": "layer/blazer", "blazers": "layer/blazer",
    "jacket": "layer/blazer", "jackets": "layer/blazer",
    "coat": "layer/blazer", "coats": "layer/blazer",
    // scarf
    "scarf": "scarf", "scarves": "scarf", "scarfs": "scarf",
    "wrap": "scarf",
    // bag
    "bag": "bag", "bags": "bag",
    "purse": "bag", "handbag": "bag",
    "tote": "bag",
    // shoes
    "shoe": "shoes", "shoes": "shoes",
    "boots": "shoes", "heels": "shoes",
    "trainers": "shoes", "sneakers": "shoes",
    "sandals": "shoes", "loafers": "shoes"
  };

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  }

  // Earliest-mentioned category word wins (same convention as the old
  // per-skill plural maps: first match in text order). Returns the
  // taxonomy category string, or null when no word matches.
  function categoryOf(text) {
    var t = String(text || "").toLowerCase();
    if (!t) return null;
    var best = null;
    var bestIdx = -1;
    for (var word in CATEGORY_WORDS) {
      if (!Object.prototype.hasOwnProperty.call(CATEGORY_WORDS, word)) continue;
      var m = new RegExp("\\b" + escapeRegExp(word) + "\\b").exec(t);
      if (m && (bestIdx === -1 || m.index < bestIdx)) {
        bestIdx = m.index;
        best = CATEGORY_WORDS[word];
      }
    }
    return best;
  }

  // options: [{ id, description }] — ids are validated server-side
  // against this same list; re-validated here so an invented id can
  // never flow into a caller. Resolves the chosen id, or null.
  // Never throws, never calls when metaClient.interpret is missing.
  async function sparkPick(metaClient, text, options, question, context) {
    try {
      if (!metaClient || typeof metaClient.interpret !== "function") return null;
      if (!Array.isArray(options) || options.length === 0) return null;
      var ids = {};
      for (var i = 0; i < options.length; i++) {
        var o = options[i];
        if (!o || typeof o.id !== "string" || !o.id) return null;
        ids[o.id] = true;
      }
      var said = String(text || "");
      if (!said.trim()) return null;
      var out = await metaClient.interpret(said, options, question, context);
      var choice = out && typeof out.choice === "string" ? out.choice : null;
      if (choice && ids[choice]) return choice;
      return null;
    } catch (e) {
      return null;
    }
  }

  // Fixed yes/no/unclear option set for pending yes_no expectations
  // (agentic-loop.js + Evaluate_prospective_purchase's confirm branch).
  // One shared copy so the two can never diverge.
  var YES_NO_UNCLEAR_OPTIONS = [
    { id: "yes", description: "the reply confirms / agrees (yes, go ahead, do it)" },
    { id: "no", description: "the reply declines / refuses (no, keep it, not now)" },
    { id: "unclear", description: "the reply is neither a clear yes nor a clear no" }
  ];

  function yesNoUnclearOptions() {
    return YES_NO_UNCLEAR_OPTIONS.map(function (o) {
      return { id: o.id, description: o.description };
    });
  }

  var api = {
    CATEGORY_WORDS: CATEGORY_WORDS,
    categoryOf: categoryOf,
    sparkPick: sparkPick,
    YES_NO_UNCLEAR_OPTIONS: YES_NO_UNCLEAR_OPTIONS,
    yesNoUnclearOptions: yesNoUnclearOptions
  };

  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.interpret = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
