"use strict";
/* meta-styles Milestone 21 — agentic router (Muse Spark). NEW hackathon work
 * (building period Oct 27 – Nov 4, 2026).
 *
 * Router: input (user message + last 2-3 turns + wardrobe summary (100t) +
 * preferences (100t) + image presence flag) → { skill, confidence, reason }
 * Threshold: <70 → clarification instead of skill pick. Every decision logged
 * for provenance (wardrobe-catalog provenance + router log via PUT sync).
 *
 * Structured-output via Muse Spark when proxy reachable; heuristic fallback
 * when not — both return identical shape with honest confidence.
 */

(function (root) {
  var SKILL_NAMES = [
    "catalogue_piece",
    "propose_look",
    "revise_look",
    "view_wardrobe_item",
    "delete_wardrobe_item",
    "describe_wardrobe",
    "explain_fit",
    "answer_no_data",
    "off_topic",
    "Match_look",
    "Complete_the_look",
    "What_suits",
    "Evaluate_prospective_purchase",
  ];

  // Explicit render-on-user intent: the wearer asks to see a look
  // rendered ON THEM (using their saved headshot + full-body photo),
  // not a flat-lay. Single source of truth — propose_look and
  // revise_look reuse this (via require or the browser global) so the
  // intent vocabulary never drifts between router and skills.
  // Deliberately narrow: "make me a look" / "show me a look" (fresh
  // flat-lay look requests) must NOT match — only on-the-wearer
  // phrasing counts.
  var RENDER_INTENT_RES = [
    /show\s+me\s+wearing\b/,
    /render\s+(this|that|it|the\s+look|this\s+look)?\s*on\s+me\b/,
    /render\s+me\s+wearing\b/,
    /\bput\s+(this|that|it|the\s+look|this\s+look)\s+on\s+me\b/,
    /\bshow\s+(this|that|it|the\s+look)\s+on\s+me\b/,
    /\btry\s+(this|that|it)\s+on\s+me\b/,
    /what\s+(would\s+|does\s+)?(this|that|it)\s+look\s+like\s+on\s+me\b/,
    /what\s+it\s+looks\s+like\s+on\s+me\b/,
    /show\s+me\s+what\s+it\s+looks\s+like\s+on\s+me\b/,
    /show\s+me\s+in\s+this\s+(look|outfit)\b/,
    /\buse\s+my\s+headshot\b/,
    /\buse\s+my\s+(profile\s+)?photos?\s+to\s+show\b/,
    /\bwith\s+my\s+headshot\s+and\s+full[\s-]?body\b/
  ];

  function detectRenderIntent(text) {
    if (typeof text !== "string" || !text) return false;
    var t = text.toLowerCase();
    for (var i = 0; i < RENDER_INTENT_RES.length; i++) {
      if (RENDER_INTENT_RES[i].test(t)) return true;
    }
    return false;
  }

  // Saved profile-photo deletion ("delete my photos" / "forget my
  // profile photos"): removes the stored headshot + full-body record,
  // never wardrobe pieces. Kept separate from delete_wardrobe_item
  // (which needs a garment category word) so the two can never collide.
  var DELETE_PHOTOS_RE = /\b(delete|forget)\s+(all\s+)?my\s+(profile\s+)?(photos?|pictures?)\b/;

  function matchDeletePhotos(text) {
    if (typeof text !== "string" || !text) return false;
    return DELETE_PHOTOS_RE.test(text.toLowerCase());
  }

  // Heuristic routing rules — mirrors vault 06 trigger definitions.
  // Kept as explicit regex so behaviour is auditable without an LLM.
  function heuristicSkill(input) {
    var text = (input.text || "").toLowerCase();
    var hasImage = !!input.imagePresent;
    var lastTurns = (input.lastTurns || []).join(" ").toLowerCase();
    var rawText = input.text || "";

    // Saved profile-photo deletion — explicit data-removal request,
    // highest priority: never wardrobe pieces, handled by propose_look's
    // profile flow. Checked before everything (including the generic
    // photo catch-all) so "delete my photos" can never catalogue, view,
    // or revise anything.
    if (matchDeletePhotos(rawText)) {
      return { skill: "propose_look", confidence: 93, reason: "saved profile-photo delete request" };
    }

    // Photo + inspiration language → Match_look
    if (hasImage && /\b(inspiration|do this look|recreate|like this|model|magazine|pinterest)\b/.test(text)) {
      return { skill: "Match_look", confidence: 92, reason: "image + inspiration phrasing" };
    }
    // Prospective purchase: image of item they could buy
    if (hasImage && /\b(should i buy|worth buying|prospective|thinking of buying|could buy|considering)\b/.test(text)) {
      return { skill: "Evaluate_prospective_purchase", confidence: 88, reason: "image + prospective purchase phrasing" };
    }
    // What_suits: explicit request (with or without image)
    if (/\b(what suits|what would suit|my colours|what colours suit|colour.*suit me|style.*suit me)\b/.test(text)) {
      return { skill: "What_suits", confidence: hasImage ? 90 : 86, reason: "explicit What_suits trigger" };
    }
    // Evaluate prospective purchase text-only triggers (Opus finding #13):
    // checked BEFORE the generic photo catch-all so a photo plus
    // "should I get this?" / "is this worth it?" phrasing routes to
    // Evaluate_prospective_purchase (an item only being considered),
    // never catalogued as owned. Purchase confirmation ("I bought it")
    // always wins over the generic should-i-get-this trigger below
    // (checked first) — same relative order as before, just earlier.
    if (/\b(i bought it|i got it|i bought that|bought it|i picked it up)\b/.test(text)) {
      return { skill: "Evaluate_prospective_purchase", confidence: 88, reason: "purchase confirmation trigger" };
    }
    // Evaluate prospective purchase text-only trigger
    if (/\b(should i get|is this worth|thinking.*buying|found this.*should)\b/.test(text)) {
      return { skill: "Evaluate_prospective_purchase", confidence: 75, reason: "prospective purchase text trigger" };
    }
    // Generic photo → catalogue_piece
    if (hasImage) {
      return { skill: "catalogue_piece", confidence: 94, reason: "photo shared without other trigger" };
    }
    // Complete_the_look
    if (/\b(complete.*look|what.*buy.*complete|missing.*look|what could i buy)\b/.test(text)) {
      return { skill: "Complete_the_look", confidence: 90, reason: "complete-the-look phrasing" };
    }
    // Revise
    if (/\b(no |without |drop |remove |lose |ditch |swap |skip ).*\b(bag|scarf|blazer|cardigan|dress|top|bottom|purse|coat|jacket|shrug)\b/.test(text)) {
      return { skill: "revise_look", confidence: 89, reason: "revise phrasing matched" };
    }
    // Revise (add/include phrasing with no exclude word, e.g. "add the
    // cardigan back", "can you add my blazer") — same verb/category
    // vocabulary as revise_look's matchAdd, so a fresh add request
    // reaches revise_look even outside a pending-expectation follow-up.
    if (/\b(add|include|bring back|put back|with the|with my|plus|for the|for my)\b.*\b(bag|scarf|blazer|cardigan|dress|top|bottom|purse|coat|jacket|shrug)\b/.test(text)) {
      return { skill: "revise_look", confidence: 89, reason: "revise add phrasing matched" };
    }
    // Propose look — include natural variants like "cook up a look", "make me a look", "create a look"
    if (/\b(show me a look|propose.*look|what goes together|suggest.*look|put.*look together|style me|outfit idea|cook.*look|make.*look|create.*look|find.*bag|can you find)\b/.test(text)) {
      return { skill: "propose_look", confidence: 91, reason: "propose-look trigger" };
    }
    // Render-on-user follow-up ("show me wearing this", "render this
    // on me", "put this look on me") with NO fresh-look request words:
    // render the EXISTING look on the wearer, so it goes to revise_look's
    // render-follow-up path — never a new-look proposal. Placed AFTER
    // the propose block so a combined turn ("make me a look and show me
    // wearing it") still proposes first. revise_look's own revise
    // triggers already matched above, so this only catches pure
    // render follow-ups.
    if (detectRenderIntent(rawText)) {
      return { skill: "revise_look", confidence: 90, reason: "render-on-user follow-up; render existing look on wearer" };
    }
    // Delete one wardrobe piece, with a yes/no confirm (delete_wardrobe_item).
    // Checked before the view trigger below: the verb sets differ ("delete/
    // remove" vs "show/see"), so the two can never collide either way.
    if (/\b(delete|remove)\b.*\b(tops|bottoms|dresses|cardigans|blazers|scarves|bags)\b/.test(text)) {
      return { skill: "delete_wardrobe_item", confidence: 93, reason: "wardrobe category delete trigger" };
    }
    // View one wardrobe category, then pick a numbered piece (view_wardrobe_item)
    if (/\b(show|see)\b.*\b(tops|bottoms|dresses|cardigans|blazers|scarves|bags)\b/.test(text)) {
      return { skill: "view_wardrobe_item", confidence: 93, reason: "wardrobe category view trigger" };
    }
    // Describe wardrobe
    if (/\b(what do i have|show.*wardrobe|my wardrobe|what.*in.*wardrobe|list.*pieces|find.*(bag|dress|scarf|top|wardrobe))\b/.test(text)) {
      return { skill: "describe_wardrobe", confidence: 93, reason: "describe-wardrobe trigger" };
    }
    // Explain fit
    if (/\b(why does this work|why.*work|explain.*fit|how does.*fit|fit.*together)\b/.test(text)) {
      return { skill: "explain_fit", confidence: 88, reason: "explain-fit trigger" };
    }
    // Answer no data (fabric/price/vendor descoped)
    if (/\b(fabric|price|cost|how much|cheaper|discount|vendor|listing|material|what.*made of)\b/.test(text)) {
      return { skill: "answer_no_data", confidence: 87, reason: "descoped fabric/price/vendor question" };
    }
    // Off-topic: low-confidence fallback — return off_topic with modest confidence
    // so caller maps it, but route() will still treat <70 as clarification.
    // Here we return off_topic with 82 so direct calls classify correctly.
    return { skill: "off_topic", confidence: 82, reason: "no skill trigger matched, off-topic" };
  }

  // Clarification text for <70 confidence
  function clarificationFor(input) {
    var text = input.text || "";
    return "Just to make sure I help the right way, loveling ✨ — did you mean to share a piece, see a look, or tweak one? A quick hint helps me pick the perfect spell for you.";
  }

  // Main entry: classify → { skill, confidence, reason, clarification? }
  // opts: { text, imagePresent, wardrobeSummary, preferences, lastTurns }
  // metaClient optional: { classifyText } for live Spark path — when present,
  // we call it and merge, but never let it invent a skill outside SKILL_NAMES.
  function classifySync(input) {
    var h = heuristicSkill(input || {});
    // Vague / very short inputs get low confidence → clarification path
    var raw = (input.text || "").trim();
    if (raw.length > 0 && raw.length < 4) {
      return { skill: h.skill, confidence: 45, reason: h.reason + " but text too short", clarification: clarificationFor(input) };
    }
    // Low-signal inputs like "hi", "hello", "hey", "ok", "thanks"
    if (/^(hi|hello|hey|ok|thanks|thank you|yo|sup|hiya)[.! ]*$/i.test(raw)) {
      return { skill: "off_topic", confidence: 55, reason: "greeting/small-talk, low intent signal", clarification: clarificationFor(input) };
    }
    // Ambiguous single words that could be multiple skills
    if (/^(look|wardrobe|help|please|item)$/i.test(raw)) {
      return { skill: h.skill, confidence: 50, reason: "ambiguous single word", clarification: clarificationFor(input) };
    }
    if (h.confidence < 70) {
      return { skill: h.skill, confidence: h.confidence, reason: h.reason, clarification: clarificationFor(input) };
    }
    return h;
  }

  // Async entry that tries live Spark first, falls back to heuristic.
  // Spark is called via metaClient.route(text, context) if available.
  async function classify(input, metaClient) {
    if (metaClient && typeof metaClient.route === "function") {
      try {
        var ctx = {
          text: input.text || "",
          imagePresent: !!input.imagePresent,
          wardrobeSummary: input.wardrobeSummary || "",
          preferences: input.preferences || "",
          lastTurns: input.lastTurns || [],
        };
        var live = await metaClient.route(ctx.text, ctx);
        if (live && typeof live.skill === "string" && SKILL_NAMES.indexOf(live.skill) !== -1) {
          var conf = typeof live.confidence === "number" ? live.confidence : 75;
          var reason = typeof live.reason === "string" ? live.reason : "live router";
          if (conf < 70) return { skill: live.skill, confidence: conf, reason: reason, clarification: clarificationFor(input) };
          return { skill: live.skill, confidence: conf, reason: reason };
        }
      } catch (e) { /* fall through to heuristic */ }
    }
    return classifySync(input);
  }

  // Router decisions log for provenance (in-memory ring, flushed via summariser)
  var decisionLog = [];
  function logDecision(entry) {
    decisionLog.push(Object.assign({ at: new Date().toISOString() }, entry));
    if (decisionLog.length > 50) decisionLog = decisionLog.slice(-50);
  }
  function getLog() { return decisionLog.slice(); }
  function clearLog() { decisionLog = []; }

  var api = {
    SKILL_NAMES: SKILL_NAMES,
    heuristicSkill: heuristicSkill,
    detectRenderIntent: detectRenderIntent,
    matchDeletePhotos: matchDeletePhotos,
    classifySync: classifySync,
    classify: classify,
    clarificationFor: clarificationFor,
    logDecision: logDecision,
    getLog: getLog,
    clearLog: clearLog,
  };

  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.router = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
