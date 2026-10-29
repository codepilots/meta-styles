"use strict";
/* meta-styles Milestone 19d — NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Turn loop for the chat-first pivot
 * (docs/milestone-19-chat-first-pivot.md §2, §7 task 5):
 * wire triggers → extract-and-catalog on photo shares → Spark propose
 * (drawing on previously catalogued pieces, not just the new share) →
 * UNCHANGED assembleLook validate → in-thread revise-or-flag replies;
 * fabric/price answers gated on §8.4 (say plainly no data, never invent).
 *
 * Calls the real 19e/19b/19c/19a-adjacent exports, never re-invents them:
 *   - 19c app/wardrobe-catalog.js  (createCatalog — injected or created;
 *     noteInboundShare / addPiece / recordTurn / recordSentTurn /
 *     rejectPiece / getActivePieces)
 *   - unchanged app/assembler.js    (assembleLook — validate only)
 *   - app/spark.js                  (generateCopy — offline copy fallback;
 *     the live Muse Spark path stays behind meta-client, as in app.js)
 *   - 19b app/send-client.js        (left to the caller: this module
 *     returns in-thread reply text; the caller sends it per turn)
 *   - 19a app/mock-dm.html         (reply text shape matches the look-bubble
 *     convention: title + fit verdict + one line per piece; untouched here)
 *
 * Interface-agnostic: no IG-specific fields, no fabric/price/vendor fields
 * (§3 schema, §8.4 descoped). All ids/text synthetic (SYNTH_ prefix,
 * example.invalid URLs) — never real Instagram data.
 */

(function (root) {
  var MS = root.MetaStyles || {};

  // Fabric/price/vendor questions are answered plainly — the agent says
  // it does not have that data rather than inventing a listing (§8.4).
  // The follow-up stays fit-rule-shaped (a category-level next step),
  // never a quoted listing.
  var NO_DATA_LEAD = "I don't have that data — no fabric, price, or vendor details in this wardrobe, so I can't quote a listing.";
  var GROUNDING_RE = /\b(fabric|price|cost|cheaper|cheapest|discount|vendor|listing|material|how much|how much does|what does .* cost)\b/i;

  // "no X" / "drop X" / "remove X" revise intents, mapped onto the fixed
  // classifier taxonomy (tie-blouses/shrugs are layers — see classifier.js).
  var REVISE_WORDS = [
    { re: /\bbag\b|purse|handbag/, category: "bag" },
    { re: /\bscarf\b|wrap\b/, category: "scarf" },
    { re: /\bblazer\b|jacket|coat/, category: "layer/blazer" },
    { re: /\bcardigan\b|shrug|tie-blouse|blouse/, category: "layer/cardigan" },
    { re: /\bdress\b|gown/, category: "dress" },
    { re: /\btop\b|cami|camisole|tee/, category: "base/top" },
    { re: /\bbottom\b|jeans|skirt|trousers|pants|mini/, category: "base/bottom" },
  ];
  var REVISE_RE = /\b(no|drop|remove|without|lose|ditch)\b[^.?!]{0,40}?\b(bag|purse|handbag|scarf|wrap|blazer|jacket|coat|cardigan|shrug|tie-blouse|blouse|dress|gown|top|cami|camisole|tee|bottom|jeans|skirt|trousers|pants|mini)\b/i;

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function isGroundingQuestion(text) {
    return typeof text === "string" && GROUNDING_RE.test(text);
  }

  function matchReviseCategory(text) {
    if (typeof text !== "string" || !REVISE_RE.test(text)) return null;
    for (var i = 0; i < REVISE_WORDS.length; i++) {
      if (REVISE_WORDS[i].re.test(text)) return REVISE_WORDS[i].category;
    }
    return null;
  }

  function copyTextFor(category, pieceId) {
    return "SYNTH catalogued " + category + " " + pieceId + " — visible evidence only.";
  }

  function toAssembleItems(pieces) {
    return pieces.map(function (p) {
      return {
        id: p.piece_id,
        category: p.category,
        copy: { text: copyTextFor(p.category, p.piece_id), placeholder: true, note: "turn-loop assembler input" },
        _source_share_id: p.source_share_id,
      };
    });
  }

  function candidateKey(items) {
    return items.map(function (it) { return it.id; }).sort().join("+");
  }

  function distinctSources(items) {
    var seen = {};
    items.forEach(function (it) { seen[it._source_share_id] = true; });
    return Object.keys(seen);
  }

  function createTurnLoop(opts) {
    var o = opts || {};
    if (typeof o.userKey !== "string" || o.userKey.length === 0) {
      throw new Error("turn-loop: a userKey is required (createTurnLoop({ userKey }))");
    }
    var catalog = o.catalog || null;
    if (!catalog) {
      var wc = MS.wardrobeCatalog ||
        (typeof require !== "undefined" && require("./wardrobe-catalog.js"));
      if (!wc || typeof wc.createCatalog !== "function") {
        throw new Error("turn-loop: no catalog supplied and wardrobe-catalog is unavailable");
      }
      catalog = wc.createCatalog({ userKey: o.userKey });
    }
    var validate = o.validate || MS.assembleLook ||
      (typeof require !== "undefined" && require("./assembler.js").assembleLook);
    if (typeof validate !== "function") {
      throw new Error("turn-loop: no validate (assembleLook) available");
    }
    var copyFn = o.copy || MS.generateCopy ||
      (typeof require !== "undefined" && require("./spark.js").generateCopy) ||
      null;

    // Spark proposes from THIS user's catalogued pool — previously
    // extracted pieces from earlier shares included, not only the piece
    // just shared (§2 item 1: that recall is the agentic beat). Offline
    // default: deterministic candidate shapes over the active pool;
    // the live Muse Spark path (meta-client assemble/copy) slots in as
    // o.propose / o.copy without changing this loop.
    function proposeCandidates(activePieces) {
      var items = toAssembleItems(activePieces);
      var byId = {};
      items.forEach(function (it) { byId[it.id] = it; });
      var sets = [];
      if (items.length > 0) sets.push(items.slice());
      var bases = items.filter(function (it) {
        return it.category === "base/top" || it.category === "base/bottom" || it.category === "dress";
      });
      var layers = items.filter(function (it) {
        return it.category === "layer/cardigan" || it.category === "layer/blazer";
      });
      var scarves = items.filter(function (it) { return it.category === "scarf"; });
      var bags = items.filter(function (it) { return it.category === "bag"; });
      // Base × each valid finish — finishes from a DIFFERENT share than
      // the base first, so cross-piece mix-match surfaces by construction.
      bases.forEach(function (base) {
        var xLayers = layers.slice().sort(function (a, b) {
          return (a._source_share_id === base._source_share_id) - (b._source_share_id === base._source_share_id);
        });
        var xScarves = scarves.slice().sort(function (a, b) {
          return (a._source_share_id === base._source_share_id) - (b._source_share_id === base._source_share_id);
        });
        var xBags = bags.slice().sort(function (a, b) {
          return (a._source_share_id === base._source_share_id) - (b._source_share_id === base._source_share_id);
        });
        xLayers.forEach(function (layer) {
          sets.push([base, layer].filter(function (x, i, arr) { return arr.indexOf(x) === i; }));
        });
        xScarves.forEach(function (scarf) {
          xBags.forEach(function (bag) {
            var s = [base, scarf, bag].filter(function (x, i, arr) { return arr.indexOf(x) === i; });
            sets.push(s);
          });
        });
      });
      // Dedupe (identical id sets), drop empties/singletons that cannot
      // validate — except keep a lone piece so its reasons[] surface.
      var seen = {};
      var out = [];
      sets.forEach(function (s) {
        if (s.length === 0) return;
        var k = candidateKey(s);
        if (seen[k]) return;
        seen[k] = true;
        out.push(s);
      });
      if (out.length === 0 && items.length > 0) out.push(items.slice(0, 1));
      return out;
    }

    // Validate every candidate through the UNCHANGED fit-rule engine;
    // valid cards first, then widest cross-share span, then fewest
    // reasons — deterministic, no invented data anywhere.
    function proposeLooks() {
      var active = catalog.getActivePieces();
      var custom = typeof o.propose === "function" ? o.propose(active) : null;
      var sets = Array.isArray(custom) ? custom : proposeCandidates(active);
      var looks = sets.map(function (set) {
        var card = validate(set.map(function (it) {
          return { id: it.id, category: it.category, copy: it.copy };
        }));
        var copy = null;
        if (copyFn) {
          try { copy = copyFn(card); } catch (err) { copy = null; }
        }
        return {
          items: set,
          pieceIds: set.map(function (it) { return it.id; }),
          sources: distinctSources(set),
          card: card,
          copy: copy,
          title: (copy && copy.title) || "Look from your wardrobe",
        };
      });
      looks.sort(function (a, b) {
        if ((a.card.valid ? 0 : 1) !== (b.card.valid ? 0 : 1)) {
          return (a.card.valid ? 0 : 1) - (b.card.valid ? 0 : 1);
        }
        if (a.sources.length !== b.sources.length) return b.sources.length - a.sources.length;
        if (a.card.reasons.length !== b.card.reasons.length) {
          return a.card.reasons.length - b.card.reasons.length;
        }
        return a.pieceIds.join(",") < b.pieceIds.join(",") ? -1 : 1;
      });
      return looks;
    }

    function pieceLine(item) {
      return "[" + item.category + "] " + item.id + " (from " + item._source_share_id + ")";
    }

    function formatLookReply(look, leadLine) {
      var lines = [];
      if (leadLine) lines.push(leadLine);
      var cite = look.items.map(pieceLine).join(" + ");
      lines.push("Look: " + look.title + " — combining " + cite + ".");
      if (look.card.valid) {
        lines.push("Fit check: valid full look (finish: " + (look.card.finish || "none") + ") ✔");
      } else {
        lines.push("Fit check: not a full look yet — " + look.card.reasons.join(" "));
      }
      return lines.join("\n");
    }

    function missingFinishHint(card) {
      var cats = card.pieces.map(function (p) { return p.category; });
      var hasScarf = cats.indexOf("scarf") !== -1;
      var hasBag = cats.indexOf("bag") !== -1;
      if (hasScarf && !hasBag) {
        return "Want me to find its bag partner, or switch to a single layer instead?";
      }
      if (hasBag && !hasScarf) {
        return "Want me to find its scarf partner, or switch to a single layer instead?";
      }
      return "Add one layer, or a scarf + bag pair, and I will re-check the fit.";
    }

    function finishReply(looks, leadLine, userText, inReplyTo) {
      if (looks.length === 0) {
        var q = catalog.askQuestion("What should I style around first — share another photo anytime.");
        var emptyText = (leadLine ? leadLine + "\n" : "") +
          "Your wardrobe is empty — share a photo to catalogue the first piece.";
        catalog.recordTurn({ userText: userText, proposal: null, verdict: false, reasons: ["empty_wardrobe"] });
        catalog.recordSentTurn({ text: emptyText, in_reply_to_share: inReplyTo });
        return { text: emptyText, looks: [], best: null, questionId: q.id };
      }
      var best = looks[0];
      var text = formatLookReply(best, leadLine);
      if (!best.card.valid) text += "\n" + missingFinishHint(best.card);
      var proposal = {
        pieces: best.pieceIds.slice(),
        title: best.title,
        note: best.card.valid
          ? "valid:" + (best.card.finish || "none")
          : "invalid:" + best.card.reasons.join(" | ").slice(0, 280),
      };
      catalog.recordTurn({
        userText: userText,
        proposal: proposal,
        verdict: best.card,
        reasons: best.card.reasons.slice(),
      });
      catalog.recordSentTurn({ text: text, in_reply_to_share: inReplyTo });
      return { text: text, looks: looks, best: best };
    }

    // Photo-share trigger (§2): extract garment(s) → catalogue under this
    // user's wardrobe citing the source share → Spark propose from the
    // FULL catalogued pool (recall, not just the new share) → unchanged
    // assembleLook validate → in-thread reply. Each extraction must be
    // { category, attributes? }; visible evidence only (§3, §8.4).
    function handlePhotoShare(share, extractions) {
      var s = share || {};
      var shareId = s.shareId || s.id;
      if (typeof shareId !== "string" || shareId.length === 0) {
        throw new Error("turn-loop: handlePhotoShare needs a share id ({ shareId|id })");
      }
      var receivedAt = s.receivedAt || s.received_at || nowIso();
      catalog.noteInboundShare({ shareId: shareId, receivedAt: receivedAt });
      var list = Array.isArray(extractions) ? extractions : [extractions];
      if (list.length === 0) {
        throw new Error("turn-loop: handlePhotoShare needs at least one extraction");
      }
      var added = list.map(function (ex) {
        var e = ex || {};
        return catalog.addPiece({
          category: e.category,
          attributes: e.attributes || {},
          source_share_id: shareId,
        });
      });
      var looks = proposeLooks();
      var lead = "Catalogued " + added.length + " piece" + (added.length === 1 ? "" : "s") +
        " from " + shareId + " (" +
        added.map(function (p) { return p.piece_id + " " + p.category; }).join(", ") + ").";
      var out = finishReply(looks, lead, "photo:" + shareId, shareId);
      out.pieces = added;
      out.shareId = shareId;
      return out;
    }

    // Text-message trigger (§2): revise, re-validate, or answer — exactly
    // one assistant turn. Fabric/price/vendor questions are answered
    // plainly with no data (§8.4), never invented.
    function handleTextTurn(text, opts) {
      var t = typeof text === "string" ? text : "";
      var o2 = opts || {};
      var inReplyTo = typeof o2.inReplyTo === "string"
        ? o2.inReplyTo
        : (typeof o2.shareId === "string" ? o2.shareId : null);
      if (typeof o2.shareId === "string") {
        catalog.noteInboundShare({ shareId: o2.shareId, receivedAt: o2.receivedAt || nowIso() });
      }
      if (isGroundingQuestion(t)) {
        var follow = catalog.getActivePieces().length === 0
          ? "Share a photo and I will propose a fit-checked look from it."
          : "Fit-wise, I can still propose and validate looks from your catalogued pieces — just say the word.";
        var noData = NO_DATA_LEAD + " " + follow;
        catalog.recordTurn({ userText: t, proposal: null, verdict: false, reasons: ["no_grounding_data"] });
        catalog.recordSentTurn({ text: noData, in_reply_to_share: inReplyTo });
        return { text: noData, looks: [], best: null, noData: true };
      }
      var reviseCat = matchReviseCategory(t);
      if (reviseCat) {
        var removed = catalog.getActivePieces()
          .filter(function (p) { return p.category === reviseCat; })
          .map(function (p) { return catalog.rejectPiece(p.piece_id); });
        var looks = proposeLooks();
        var lead = removed.length > 0
          ? "Removed " + removed.map(function (p) { return p.piece_id; }).join(", ") +
            " (" + reviseCat + ") per your note — re-checking the fit from the rest of your wardrobe."
          : "No active " + reviseCat + " in your wardrobe — re-checking the fit as-is.";
        var out = finishReply(looks, lead, t, inReplyTo);
        out.removed = removed;
        out.revised = true;
        return out;
      }
      var looks2 = proposeLooks();
      return finishReply(looks2, null, t, inReplyTo);
    }

    return {
      userKey: o.userKey,
      catalog: catalog,
      handlePhotoShare: handlePhotoShare,
      handleTextTurn: handleTextTurn,
      proposeLooks: proposeLooks,
      isGroundingQuestion: isGroundingQuestion,
      matchReviseCategory: matchReviseCategory,
      NO_DATA_LEAD: NO_DATA_LEAD,
    };
  }

  var api = {
    createTurnLoop: createTurnLoop,
    isGroundingQuestion: isGroundingQuestion,
    matchReviseCategory: matchReviseCategory,
    NO_DATA_LEAD: NO_DATA_LEAD,
  };

  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.turnLoop = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);