"use strict";
/* meta-styles Milestone 21 — agentic loop harness (router → skill → summariser).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Require-able test harness; wardrobe-service can adopt. Additive to existing poll loop.
 *
 * Per-skill global rule (vault 06): each skill invocation is bounded to 20
 * tool steps — pass maxSteps=20, log every tool call and total steps used.
 */
(function (root) {
  var DEFAULT_MAX_STEPS = 20;

  function createAgenticLoop(opts) {
    var o = opts || {};
    var catalog = o.catalog || null;
    var userRef = o.userRef || "SYNTH_user";
    var router = o.router;
    var summariser = o.summariser;
    var skillLoaders = o.skillLoaders || {};
    var maxSteps = typeof o.maxSteps === "number" ? o.maxSteps : DEFAULT_MAX_STEPS;
    var onToolCall = typeof o.onToolCall === "function" ? o.onToolCall : null;

    if (!router) {
      try { router = (root.MetaStyles && root.MetaStyles.router) || require("./router.js"); } catch (e) { router = null; }
    }
    if (!summariser) {
      try { summariser = (root.MetaStyles && root.MetaStyles.summariser) || require("./summariser.js"); } catch (e) { summariser = null; }
    }

    function loadSkill(name) {
      if (skillLoaders[name]) return skillLoaders[name];
      try { return require("./skills/" + name + "/handler.js"); } catch (e) {}
      try {
        var ms = root.MetaStyles && root.MetaStyles.skills && root.MetaStyles.skills[name];
        if (ms) return ms;
      } catch (e2) {}
      return null;
    }

    // Wrap catalog to enforce 20-step cap and log every tool call.
    function wrapCatalogWithBudget(catalog, budget) {
      if (!catalog) return { proxy: catalog, getCalls: function () { return []; }, getSteps: function () { return 0; } };
      var cap = typeof budget === "number" ? budget : DEFAULT_MAX_STEPS;
      var steps = 0;
      var calls = [];
      function counted(name, fn) {
        return function () {
          if (steps >= cap) throw new Error("tool step cap reached (" + cap + " steps)");
          steps += 1;
          calls.push({ tool: name, step: steps, at: new Date().toISOString() });
          if (onToolCall) try { onToolCall({ tool: name, step: steps }); } catch (e) {}
          return fn.apply(catalog, arguments);
        };
      }
      var proxy = Object.create(catalog);
      proxy.store = catalog.store;
      proxy.userKey = catalog.userKey;
      proxy._realCatalog = catalog;
      [
        "addPiece", "getPiece", "getPieces", "getActivePieces", "setCopyPreviewKeys",
        "rejectPiece", "markSuperseded", "recordTurn", "getTurns", "historyForPrompt",
        "askQuestion", "resolveQuestion", "getPendingQuestions", "recordSentTurn",
        "getSentTurns", "toJSON", "save", "load", "noteInboundShare", "replyWindowStatus"
      ].forEach(function (k) {
        if (typeof catalog[k] === "function") proxy[k] = counted(k, catalog[k]);
      });
      return { proxy: proxy, getCalls: function () { return calls.slice(); }, getSteps: function () { return steps; } };
    }

    async function handleTurn(input) {
      var inp = input || {};
      var message = typeof inp.message === "string" ? inp.message : (typeof inp.text === "string" ? inp.text : "");
      var hasImage = inp.hasImage === true || !!inp.imageDataUrl;
      var wardrobeSummary = inp.wardrobeSummary || inp.summary || "";
      var preferences = inp.preferences || "";
      var lastTurns = inp.lastTurns || inp.history || [];
      var imageDataUrl = inp.imageDataUrl || null;

      var decision = { skill: "off_topic", confidence: 75, reason: "no router" };
      if (router) {
        try {
          if (typeof router.classify === "function") {
            decision = await router.classify({ text: message, imagePresent: hasImage, wardrobeSummary: wardrobeSummary, preferences: preferences, lastTurns: lastTurns }, o.metaClient || null);
          } else if (typeof router.classifySync === "function") {
            decision = router.classifySync({ text: message, imagePresent: hasImage, wardrobeSummary: wardrobeSummary, preferences: preferences, lastTurns: lastTurns });
          }
          if (router.logDecision) router.logDecision({ skill: decision.skill, confidence: decision.confidence, reason: decision.reason, input: message.slice(0,80) });
        } catch (e) {
          decision = { skill: "off_topic", confidence: 75, reason: "router error: " + String(e.message || e) };
        }
      }

      if (decision.confidence < 70) {
        var q = decision.clarification || (router && router.clarificationFor ? router.clarificationFor({ text: message }) : "Just to make sure I help the right way, loveling \u2728 — did you mean to share a piece, see a look, or tweak one?");
        var sumCl = { summary: wardrobeSummary, preferences: preferences };
        if (summariser && typeof summariser.buildSummary === "function") {
          try {
            sumCl.summary = summariser.buildSummary({ previousSummary: wardrobeSummary, lastUserText: message, skill: "clarification", replyText: q, piecesCount: catalog ? catalog.getActivePieces().length : 0 });
          } catch (e) {}
        }
        // Persist clarification summary via catalog API (100t each, per-user, never user-facing)
        if (summariser && typeof summariser.summariseTurn === "function" && catalog && catalog.store) {
          try {
            var sc = await summariser.summariseTurn({
              previousSummary: wardrobeSummary, previousPreferences: preferences,
              lastUserText: message, skill: "clarification", replyText: q,
              preferencesDelta: "", piecesCount: catalog.getActivePieces().length,
              store: catalog.store
            });
            sumCl.summary = sc.summary; sumCl.preferences = sc.preferences;
          } catch (e) {}
        }
        return { text: q, clarification: q, skill: "clarification", decision: decision, summary: sumCl.summary, preferences: sumCl.preferences, toolCalls: [], totalSteps: 0 };
      }

      // Wrap catalog for this skill invocation (20-step budget, logged)
      var wrapped = wrapCatalogWithBudget(catalog, maxSteps);
      var skillCatalog = wrapped.proxy;

      var handler = loadSkill(decision.skill);
      if (!handler || typeof handler.handle !== "function") {
        handler = loadSkill("off_topic");
        if (!handler) return { text: "I'm just here for your wardrobe — I can catalogue new pieces, put looks together, or tweak a look you didn't love. Here's a quick guide: https://codepilots.co.uk/secondbloom/guide.html — what would you like to try? \u2728", skill: "off_topic", decision: decision, toolCalls: wrapped.getCalls(), totalSteps: wrapped.getSteps() };
      }

      var result = await handler.handle({
        catalog: skillCatalog, text: message, imageDataUrl: imageDataUrl, imagePresent: hasImage,
        wardrobeSummary: wardrobeSummary, preferences: preferences, lastTurns: lastTurns,
        metaClient: o.metaClient || null, sendClient: o.sendClient || null
      });

      var outText = (result && result.text) || "";
      var sum = { summary: wardrobeSummary, preferences: preferences };
      if (summariser && typeof summariser.summariseTurn === "function") {
        try {
          var s = await summariser.summariseTurn({
            previousSummary: wardrobeSummary, previousPreferences: preferences,
            lastUserText: message, skill: decision.skill, replyText: outText,
            preferencesDelta: (result && result.persist && result.persist.preferencesDelta) || "",
            piecesCount: skillCatalog ? skillCatalog.getActivePieces().length : 0,
            store: skillCatalog && skillCatalog.store ? skillCatalog.store : (catalog && catalog.store ? catalog.store : null)
          });
          sum.summary = s.summary; sum.preferences = s.preferences;
        } catch (e) {}
      }

      return { text: outText, image: result.image || null, skill: decision.skill, decision: decision, summary: sum.summary, preferences: sum.preferences, handlerResult: result, toolCalls: wrapped.getCalls(), totalSteps: wrapped.getSteps() };
    }

    return { handleTurn: handleTurn, router: router, summariser: summariser, DEFAULT_MAX_STEPS: DEFAULT_MAX_STEPS };
  }

  var api = { createAgenticLoop: createAgenticLoop, DEFAULT_MAX_STEPS: DEFAULT_MAX_STEPS };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.agenticLoop = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
