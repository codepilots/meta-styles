"use strict";
/* meta-styles Milestone 21 — agentic loop harness (router → skill → summariser).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Require-able test harness; wardrobe-service can adopt. Additive to existing poll loop.
 */
(function (root) {
  function createAgenticLoop(opts) {
    var o = opts || {};
    var catalog = o.catalog || null;
    var userRef = o.userRef || "SYNTH_user";
    var router = o.router;
    var summariser = o.summariser;
    var skillLoaders = o.skillLoaders || {};

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
        var q = decision.clarification || router.clarificationFor({ text: message });
        // Still update summary
        var sumCl = { summary: wardrobeSummary, preferences: preferences };
        if (summariser && typeof summariser.buildSummary === "function") {
          sumCl.summary = summariser.buildSummary({ previousSummary: wardrobeSummary, lastUserText: message, skill: "clarification", replyText: q, piecesCount: catalog ? catalog.getActivePieces().length : 0 });
        }
        return { text: q, clarification: q, skill: "clarification", decision: decision, summary: sumCl.summary, preferences: sumCl.preferences };
      }

      var handler = loadSkill(decision.skill);
      if (!handler || typeof handler.handle !== "function") {
        handler = loadSkill("off_topic");
        if (!handler) return { text: "I'm just here for your wardrobe — I can catalogue new pieces, put looks together, or tweak a look you didn't love. Here's a quick guide: https://codepilots.co.uk/secondbloom/guide.html — what would you like to try? \u2728", skill: "off_topic", decision: decision };
      }

      var result = await handler.handle({
        catalog: catalog, text: message, imageDataUrl: imageDataUrl, imagePresent: hasImage,
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
            piecesCount: catalog ? catalog.getActivePieces().length : 0,
            store: catalog && catalog.store ? catalog.store : null
          });
          sum.summary = s.summary; sum.preferences = s.preferences;
        } catch (e) {}
      }

      return { text: outText, image: result.image || null, skill: decision.skill, decision: decision, summary: sum.summary, preferences: sum.preferences, handlerResult: result };
    }

    return { handleTurn: handleTurn, router: router, summariser: summariser };
  }

  var api = { createAgenticLoop: createAgenticLoop };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.agenticLoop = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
