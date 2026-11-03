"use strict";
/* meta-styles — skill: view_wardrobe_item. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 *
 * Two-step wardrobe viewing, one skill handling both steps:
 *  Step A — the user names a wardrobe category ("show me the dresses"):
 *    reply with up to 5 numbered ACTIVE pieces of that category, each a
 *    short description (plain noun + stored colour, e.g. "pink dress").
 *    When more than 5 remain, invite "say 'show more' for the next ones"
 *    and keep a pagination cursor; with 5 or fewer, end naturally.
 *  Step B — the follow-up turn (routed back here by the pending
 *    askQuestion expectation, expects:"text"):
 *    (a) a number picks that entry of the LAST shown list and sends the
 *        piece's own STORED photo (image_original, else photo_thumb) as
 *        the reply image — never a generated image, no Muse Image call;
 *    (b) "show more"/"more"/"next" shows the next 5 of the same category;
 *    (c) anything else re-prompts honestly, restates the live list, and
 *        keeps the context alive — never silently drops the flow.
 *
 * State: catalog list context { skill, category, piece_ids (the
 * currently-shown page, in order), offset, expires_at } via
 * catalog.setListContext/getListContext/clearListContext (fail-closed,
 * ~24h expiry like the pending-expectation TTL). The pending
 * askQuestion({ skill:"view_wardrobe_item", expects:"text" }) is what
 * routes the next turn back here; it is re-recorded on every Step B
 * turn that stays in-flow (the loop consumes it each turn) and only
 * ends when a number resolves (context cleared, no fresh question).
 *
 * Image contract (same shape as propose_look so the existing send
 * plumbing works unchanged): { image: { dataURL, caption } | null,
 * meta: { imageDelivery: { requested, generated, delivered, reason } } }.
 * generated stays false — the bytes are the stored photo, sent as-is
 * (image_original is already correctly sized per decision #11; never
 * re-rendered or downscaled here).
 */
(function (root) {

  var PAGE = 5;
  // Same 24h window the catalog's pending-expectation TTL uses.
  var CONTEXT_TTL_MS = 24 * 3600 * 1000;
  var SKILL = "view_wardrobe_item";

  // Fixed plural -> category map (mirrors describe_wardrobe's
  // plural->category spirit, pinned to the classifier taxonomy).
  var PLURAL_TO_CATEGORY = {
    "tops": "base/top",
    "bottoms": "base/bottom",
    "dresses": "dress",
    "cardigans": "layer/cardigan",
    "blazers": "layer/blazer",
    "scarves": "scarf",
    "bags": "bag",
    "shoes": "shoes"
  };

  function plainNoun(c) {
    var m = {
      "base/top": "top", "base/bottom": "bottom", "dress": "dress",
      "layer/cardigan": "cardigan", "layer/blazer": "blazer",
      "scarf": "scarf", "bag": "bag", "shoes": "shoes"
    };
    return m[c] || "piece";
  }

  // "shoes" is already plural — never "shoess".
  function pluralOf(c) {
    var noun = plainNoun(c);
    if (noun === "shoes") return "shoes";
    if (noun === "dress") return "dresses";
    if (noun === "scarf") return "scarves";
    return noun + "s";
  }

  // Short description used both in the numbered list and as the photo
  // caption: plain noun plus stored colour when present.
  function shortDesc(piece) {
    var color = piece && piece.attributes &&
      typeof piece.attributes.color === "string" ?
      piece.attributes.color.trim() : "";
    var noun = plainNoun(piece ? piece.category : null);
    return (color ? color + " " : "") + noun;
  }

  function categoryOf(text) {
    var t = String(text || "").toLowerCase();
    var names = Object.keys(PLURAL_TO_CATEGORY);
    for (var i = 0; i < names.length; i++) {
      if (new RegExp("\\b" + names[i] + "\\b").test(t)) {
        return PLURAL_TO_CATEGORY[names[i]];
      }
    }
    return null;
  }

  function liveContext(catalog) {
    if (!catalog || typeof catalog.getListContext !== "function") return null;
    try {
      var ctx = catalog.getListContext();
      if (ctx && ctx.skill === SKILL) return ctx;
    } catch (e) { /* never break the reply */ }
    return null;
  }

  function expiresAt() {
    return new Date(Date.now() + CONTEXT_TTL_MS).toISOString();
  }

  // Record the Step B expectation (never throws) + stash the page cursor.
  function holdPage(catalog, replyText, category, pageIds, offset) {
    try {
      if (catalog && typeof catalog.setListContext === "function") {
        catalog.setListContext({
          skill: SKILL, category: category,
          piece_ids: pageIds, offset: offset, expires_at: expiresAt()
        });
      }
    } catch (e) { /* cursor must not break the reply */ }
    try {
      if (catalog && typeof catalog.askQuestion === "function") {
        catalog.askQuestion({ text: replyText, skill: SKILL, expects: "text" });
      }
    } catch (e) { /* expectation must not break the reply */ }
  }

  function releaseFlow(catalog) {
    try {
      if (catalog && typeof catalog.clearListContext === "function") {
        catalog.clearListContext();
      }
    } catch (e) { /* never break the reply */ }
  }

  // Render one numbered page ("1. pink dress\n2. cream dress..."), lines
  // joined for the reply. Numbering is always relative to the shown page.
  function pageLines(pagePieces) {
    return pagePieces.map(function (p, i) {
      return (i + 1) + ". " + shortDesc(p);
    });
  }

  function listReply(category, pagePieces, total, offset) {
    var plural = pluralOf(category);
    var head = "Here are your " + plural + ", darling \u2728";
    var lines = [head].concat(pageLines(pagePieces));
    if (offset + pagePieces.length < total) {
      lines.push("Say \u2018show more\u2019 for the next ones! \u2728");
    } else {
      lines.push("That\u2019s the whole coven of them! \u2728");
    }
    return lines.join("\n");
  }

  function repromptReply(pagePieces, extra) {
    var lines = [extra].concat(pageLines(pagePieces));
    lines.push("Just reply with a number, or say \u2018show more\u2019! \u2728");
    return lines.join("\n");
  }

  function activeByCategory(catalog, category) {
    var active = [];
    try {
      active = catalog ? catalog.getActivePieces() : [];
    } catch (e) { active = []; }
    if (!Array.isArray(active)) return [];
    return active.filter(function (p) { return p && p.category === category; });
  }

  function isShowMore(text) {
    var t = String(text || "");
    if (/\bshow\s+more\b/i.test(t)) return true;
    return /^\s*(more|next)\b/i.test(t);
  }

  // A bare digit anywhere reasonable: a lone number always counts, and so
  // do natural wrappings like "show me 1" or "show me number 2".
  function pickNumber(text) {
    var t = String(text || "");
    var bare = t.match(/^\s*(\d{1,3})\s*\.?\s*$/);
    if (bare) return parseInt(bare[1], 10);
    var any = t.match(/\d{1,3}/);
    if (any) return parseInt(any[0], 10);
    return null;
  }

  function noImageResult(text, reason) {
    return {
      text: text,
      image: null,
      persist: { summaryDelta: "Viewed a wardrobe piece (text only).", preferencesDelta: "" },
      skill: SKILL,
      meta: {
        imageDelivery: { requested: false, generated: false, delivered: false, reason: reason }
      }
    };
  }

  // ---- Step A: fresh category request ----
  function freshRequest(catalog, text) {
    var category = categoryOf(text);
    if (!category) {
      var names = Object.keys(PLURAL_TO_CATEGORY).join(", ");
      return noImageResult(
        "Tell me which bit of your wardrobe to open, loveling \u2728 " +
        "Name a kind — " + names + " — like \u2018show me the dresses\u2019!",
        "no_category_named"
      );
    }
    var inCategory = activeByCategory(catalog, category);
    if (inCategory.length === 0) {
      return noImageResult(
        "No " + pluralOf(category) + " tucked in your wardrobe just yet, darling \u2728 " +
        "Share a photo and I\u2019ll catalogue your first one!",
        "empty_category"
      );
    }
    var page = inCategory.slice(0, PAGE);
    var reply = listReply(category, page, inCategory.length, 0);
    holdPage(catalog, reply, category,
      page.map(function (p) { return p.piece_id; }), 0);
    return {
      text: reply,
      image: null,
      persist: { summaryDelta: "Listed " + pluralOf(category) + " (" + inCategory.length + ").", preferencesDelta: "" },
      skill: SKILL,
      meta: {
        imageDelivery: { requested: false, generated: false, delivered: false, reason: "list_no_image" }
      }
    };
  }

  // ---- Step B: follow-up against the live list context ----
  function followUp(catalog, text, ctx, opts) {
    var o = opts || {};
    var shareId = typeof o.shareId === "string" && o.shareId ? o.shareId : null;
    var stageImage = typeof o.stageImage === "function" ? o.stageImage : null;
    var inCategory = activeByCategory(catalog, ctx.category);
    var byId = {};
    inCategory.forEach(function (p) { byId[p.piece_id] = p; });
    // The live page, in order — entries that fell out of active since
    // are skipped honestly rather than sent blind.
    var pagePieces = ctx.piece_ids.map(function (id) { return byId[id] || null; })
      .filter(function (p) { return !!p; });

    // (b) next page.
    if (isShowMore(text)) {
      var nextOffset = ctx.offset + PAGE;
      var nextPage = inCategory.slice(nextOffset, nextOffset + PAGE);
      if (nextPage.length === 0) {
        var restate = repromptReply(pagePieces,
          "That\u2019s every one, loveling \u2728 Here\u2019s the page again:");
        holdPage(catalog, restate, ctx.category,
          pagePieces.map(function (p) { return p.piece_id; }), ctx.offset);
        return {
          text: restate,
          image: null,
          persist: { summaryDelta: "Show-more at end of list; restated page.", preferencesDelta: "" },
          skill: SKILL,
          meta: {
            imageDelivery: { requested: false, generated: false, delivered: false, reason: "list_no_image" }
          }
        };
      }
      var reply = listReply(ctx.category, nextPage, inCategory.length, nextOffset);
      holdPage(catalog, reply, ctx.category,
        nextPage.map(function (p) { return p.piece_id; }), nextOffset);
      return {
        text: reply,
        image: null,
        persist: { summaryDelta: "Listed next " + pluralOf(ctx.category) + ".", preferencesDelta: "" },
        skill: SKILL,
        meta: {
          imageDelivery: { requested: false, generated: false, delivered: false, reason: "list_no_image" }
        }
      };
    }

    // (a) a number picks one piece off the LAST shown list.
    var n = pickNumber(text);
    if (n !== null) {
      return pickPiece(catalog, ctx, pagePieces, n, shareId, stageImage);
    }

    // (c) anything else: honest re-prompt, same page still live.
    var again = repromptReply(pagePieces,
      "Oh loveling, I didn\u2019t catch a number or \u2018show more\u2019 just then \u2728 " +
      "Here\u2019s the list again — it\u2019s still live:");
    holdPage(catalog, again, ctx.category,
      pagePieces.map(function (p) { return p.piece_id; }), ctx.offset);
    return {
      text: again,
      image: null,
      persist: { summaryDelta: "Re-prompted for a list pick.", preferencesDelta: "" },
      skill: SKILL,
      meta: {
        imageDelivery: { requested: false, generated: false, delivered: false, reason: "list_no_image" }
      }
    };
  }

  async function pickPiece(catalog, ctx, pagePieces, n, shareId, stageImage) {
    if (n < 1 || n > pagePieces.length) {
      var range = repromptReply(pagePieces,
        "Hmm, that number drifted off the page, darling \u2728 " +
        "I only showed " + pagePieces.length + " — pick 1 to " + pagePieces.length +
        " and I\u2019ll fetch its photo:");
      holdPage(catalog, range, ctx.category,
        pagePieces.map(function (p) { return p.piece_id; }), ctx.offset);
      return {
        text: range,
        image: null,
        persist: { summaryDelta: "Out-of-range list pick; re-prompted.", preferencesDelta: "" },
        skill: SKILL,
        meta: {
          imageDelivery: { requested: false, generated: false, delivered: false, reason: "pick_out_of_range" }
        }
      };
    }
    var piece = pagePieces[n - 1];
    var desc = shortDesc(piece);
    var dataURL = null;
    var source = null;
    if (piece && typeof piece.image_original === "string" &&
        /^data:image\//.test(piece.image_original)) {
      dataURL = piece.image_original;
      source = "image_original";
    } else if (piece && typeof piece.photo_thumb === "string" &&
        /^data:image\//.test(piece.photo_thumb)) {
      dataURL = piece.photo_thumb;
      source = "photo_thumb";
    }
    // A successful pick ends the flow: clear the cursor and record no
    // fresh expectation (the loop already consumed this turn's).
    releaseFlow(catalog);
    if (!dataURL) {
      return {
        text: "Here\u2019s your " + desc + ", darling \u2728 " +
          "(I don\u2019t have its photo tucked away, so this word-picture will have to sparkle on its own!)",
        image: null,
        persist: { summaryDelta: "Picked " + desc + " (no stored photo).", preferencesDelta: "" },
        skill: SKILL,
        meta: {
          imageDelivery: { requested: false, generated: false, delivered: false, reason: "no_stored_photo" }
        }
      };
    }
    var imageDelivery = { requested: true, generated: false, delivered: false, reason: "stage_failed" };
    var image = { dataURL: dataURL, caption: desc };
    if (shareId && stageImage) {
      try {
        var staged = await stageImage(shareId, dataURL);
        if (staged && staged.ok) {
          imageDelivery.delivered = true;
          imageDelivery.reason = "staged for send with image";
        }
      } catch (e) { /* delivered stays false, reason stays stage_failed */ }
    } else {
      imageDelivery.reason = "text-only send; stored photo not staged for delivery";
    }
    return pickedReply(desc, source, image, imageDelivery);
  }

  function pickedReply(desc, source, image, imageDelivery) {
    return {
      text: "Here she is, darling \u2728 Your " + desc + "!",
      image: image,
      persist: { summaryDelta: "Showed stored photo of " + desc + " (" + source + ").", preferencesDelta: "" },
      skill: SKILL,
      meta: { imageDelivery: imageDelivery }
    };
  }

  async function handle(opts) {
    var o = opts || {};
    var catalog = o.catalog || null;
    var text = typeof o.text === "string" ? o.text :
      (typeof o.message === "string" ? o.message : "");
    var ctx = liveContext(catalog);
    if (ctx) return followUp(catalog, text, ctx, o);
    return freshRequest(catalog, text);
  }

  var api = {
    handle: handle, skill: SKILL,
    plainNoun: plainNoun, shortDesc: shortDesc,
    PLURAL_TO_CATEGORY: PLURAL_TO_CATEGORY, PAGE: PAGE
  };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills[SKILL] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
