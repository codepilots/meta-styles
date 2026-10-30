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
    "describe_wardrobe",
    "explain_fit",
    "answer_no_data",
    "off_topic",
    "Match_look",
    "Complete_the_look",
    "What_suits",
    "Evaluate_prospective_purchase",
  ];

  // Heuristic routing rules — mirrors vault 06 trigger definitions.
  // Kept as explicit regex so behaviour is auditable without an LLM.
  function heuristicSkill(input) {
    var text = (input.text || "").toLowerCase();
    var hasImage = !!input.imagePresent;
    var lastTurns = (input.lastTurns || []).join(" ").toLowerCase();

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
    // Propose look — include natural variants like "cook up a look", "make me a look", "create a look"
    if (/\b(show me a look|propose.*look|what goes together|suggest.*look|put.*look together|style me|outfit idea|cook.*look|make.*look|create.*look|find.*bag|can you find)\b/.test(text)) {
      return { skill: "propose_look", confidence: 91, reason: "propose-look trigger" };
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
