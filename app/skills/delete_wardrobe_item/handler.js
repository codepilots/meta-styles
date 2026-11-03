"use strict";
/* meta-styles — skill: delete_wardrobe_item. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 *
 * Three-step wardrobe deletion, deliberately mirroring view_wardrobe_item's
 * Step A/B conventions (same 7-category taxonomy + plural map, same 5-per-
 * page numbered list, same short descriptions, same "show more" pagination,
 * same honesty-struct style, same skill-scoped list-context cursor) with
 * ONE difference: a yes/no confirm before the piece is actually removed.
 *
 *  Step A — the user names a wardrobe category ("delete the dresses"):
 *    reply with up to 5 numbered ACTIVE pieces of that category, each a
 *    short description (plain noun + stored colour, e.g. "pink dress").
 *    When more than 5 remain, invite "say 'show more' for the next ones"
 *    and keep a pagination cursor; with 5 or fewer, end naturally.
 *    An empty category reads honestly: nothing to delete.
 *  Step B — the follow-up turn (routed back here by the pending
 *    askQuestion expectation, expects:"text"):
 *    (a) a number picks that entry of the LAST shown list and moves to
 *        Step C (never deletes yet, sends no photo);
 *    (b) "show more"/"more"/"next" shows the next 5 of the same category;
 *    (c) anything else re-prompts honestly, restates the live list, and
 *        keeps the context alive — never silently drops the flow.
 *  Step C — confirm before delete: the picked piece's exact description is
 *    asked back ("Remove your magenta dress — are you sure? Say yes to
 *    confirm, or no to keep it."), recorded via catalog.askQuestion({
 *    skill:"delete_wardrobe_item", expects:"yes_no" }) plus a small
 *    short-lived pending-deletion state (piece_id, description, ~10min
 *    expiry). The list context is cleared — the picking phase is done and
 *    the confirm question itself is now the only live pending-expectation.
 *  Step D — the confirmation turn: the agentic loop itself decides whether
 *    a expects:"yes_no" reply was affirmative BEFORE ever calling a skill
 *    back, so a call that finds a live getPendingDeletion() for this skill
 *    is ALREADY the confirmed "yes" (same precedent as
 *    Evaluate_prospective_purchase's "say I bought it" confirm — yes/no is
 *    never re-parsed here). Perform the removal via catalog.rejectPiece()
 *    (soft-delete: flips flags, never destroys history), clear the
 *    pending-deletion state, and confirm warmly. A declined ("no") or
 *    unrelated reply never reaches this skill — the short-TTL state simply
 *    goes stale. A stashed piece_id that is no longer active reads
 *    honestly as already gone, never an error.
 *
 * Clear-all — a whole-wardrobe wipe with one yes/no confirm, reusing the
 *    SAME Step C/D machinery (no new skill). A turn naming the whole
 *    wardrobe ("clear my wardrobe", "delete everything in my wardrobe" —
 *    see wantsClearAll, mirrored in app/router.js matchClearAll) skips
 *    Steps A/B and asks directly: the reply names the ACTIVE count plus,
 *    separately, any "held" prospective-purchase pieces (both are cleared),
 *    with a short per-category breakdown, states that saved profile photos
 *    are NOT touched, and records askQuestion({ skill, expects:"yes_no" })
 *    plus a pending-deletion marked as clear-all: piece_id is the
 *    "clear-all" sentinel and description carries a JSON snapshot
 *    { label, piece_ids } (the snapshot ids are the ONLY pieces the
 *    confirm may touch — anything catalogued after the ask is left alone).
 *    Same ~10min expiry. An empty wardrobe (no active AND no held pieces)
 *    reads honestly as nothing to clear, with no question recorded. The
 *    confirm turn rejectPiece()es every snapshot id still active or held,
 *    saves the catalog ONCE via catalog.save() (same save path the service
 *    uses after a single delete), clears pending + list context, and
 *    replies warmly with the number removed. A confirm whose snapshot
 *    already went stale reads honestly as already gone, never an error.
 *
 * Text-only throughout: every reply is { text, image: null, ... } with the
 * same imageDelivery honesty struct view_wardrobe_item uses — no image is
 * ever staged or sent here, so wardrobe-service send/stage plumbing is
 * untouched.
 */
(function (root) {

  var PAGE = 5;
  // Same 24h window the catalog's pending-expectation TTL uses (list cursor).
  var CONTEXT_TTL_MS = 24 * 3600 * 1000;
  // Short-lived confirm window: a single immediate yes/no step, not a
  // multi-turn browsing session — much shorter than the 24h TTLs above.
  var PENDING_TTL_MS = 10 * 60 * 1000;
  var SKILL = "delete_wardrobe_item";

  // Fixed plural -> category map (identical to view_wardrobe_item's,
  // pinned to the classifier taxonomy).
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

  // Short description used in the numbered list, the confirm question, and
  // the done reply: plain noun plus stored colour when present.
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

  // This skill's OWN live list context only — keyed on its own skill name,
  // exactly like view_wardrobe_item does, so the two never collide (the
  // catalog holds one list-context at a time).
  function liveContext(catalog) {
    if (!catalog || typeof catalog.getListContext !== "function") return null;
    try {
      var ctx = catalog.getListContext();
      if (ctx && ctx.skill === SKILL) return ctx;
    } catch (e) { /* never break the reply */ }
    return null;
  }

  // Whole-wardrobe phrasing ("clear my wardrobe", "empty my wardrobe",
  // "reset my wardrobe", "start my wardrobe fresh/over", "delete/remove
  // everything in my wardrobe", "delete/remove all my clothes/pieces/
  // wardrobe"). Must name the wardrobe/clothes/pieces — a bare "delete",
  // "forget me", or "delete my photos" never matches (the photos case is
  // claimed earlier by the router's matchDeletePhotos rule). Mirrored in
  // app/router.js matchClearAll — keep the two in lockstep.
  function wantsClearAll(text) {
    var t = String(text || "").toLowerCase();
    if (!/\b(wardrobe|clothes|pieces)\b/.test(t)) return false;
    if (/\b(clear|empty|reset)\b/.test(t)) return true;
    if (/\bstart\b[\s\S]{0,24}\b(fresh|over)\b/.test(t)) return true;
    if (/\b(delete|remove)\b[\s\S]*\b(everything|all|whole|entire)\b/.test(t)) return true;
    return false;
  }

  // Clear-all pending-deletion marker: piece_id is the sentinel and
  // description parses as { label, piece_ids }. Single-piece pendings
  // carry a human description ("pink dress") that never parses as such,
  // so the two can never be confused either way.
  var CLEAR_ALL_PIECE_ID = "clear-all";
  function clearAllSnapshotIds(pending) {
    try {
      if (!pending || pending.piece_id !== CLEAR_ALL_PIECE_ID) return null;
      if (typeof pending.description !== "string") return null;
      var snap = JSON.parse(pending.description);
      if (!snap || !Array.isArray(snap.piece_ids)) return null;
      for (var i = 0; i < snap.piece_ids.length; i++) {
        if (typeof snap.piece_ids[i] !== "string" || !snap.piece_ids[i]) return null;
      }
      return snap.piece_ids.slice();
    } catch (e) { return null; }
  }

  // This skill's OWN live pending deletion only — same skill-scoping.
  function livePending(catalog) {
    if (!catalog || typeof catalog.getPendingDeletion !== "function") return null;
    try {
      var p = catalog.getPendingDeletion();
      if (p && p.skill === SKILL) return p;
    } catch (e) { /* never break the reply */ }
    return null;
  }

  function expiresAt(ms) {
    return new Date(Date.now() + ms).toISOString();
  }

  // Record the Step B expectation (never throws) + stash the page cursor.
  function holdPage(catalog, replyText, category, pageIds, offset) {
    try {
      if (catalog && typeof catalog.setListContext === "function") {
        catalog.setListContext({
          skill: SKILL, category: category,
          piece_ids: pageIds, offset: offset, expires_at: expiresAt(CONTEXT_TTL_MS)
        });
      }
    } catch (e) { /* cursor must not break the reply */ }
    try {
      if (catalog && typeof catalog.askQuestion === "function") {
        catalog.askQuestion({ text: replyText, skill: SKILL, expects: "text" });
      }
    } catch (e) { /* expectation must not break the reply */ }
  }

  function releaseList(catalog) {
    try {
      if (catalog && typeof catalog.clearListContext === "function") {
        catalog.clearListContext();
      }
    } catch (e) { /* never break the reply */ }
  }

  function releasePending(catalog) {
    try {
      if (catalog && typeof catalog.clearPendingDeletion === "function") {
        catalog.clearPendingDeletion();
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
    var head = "Which one shall we let go, darling \u2728 Here are your " + plural + " — reply with its number:";
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
  // do natural wrappings like "delete 1" or "remove number 2".
  function pickNumber(text) {
    var t = String(text || "");
    var bare = t.match(/^\s*(\d{1,3})\s*\.?\s*$/);
    if (bare) return parseInt(bare[1], 10);
    var any = t.match(/\d{1,3}/);
    if (any) return parseInt(any[0], 10);
    return null;
  }

  function textOnlyResult(text, reason, summaryDelta) {
    return {
      text: text,
      image: null,
      persist: { summaryDelta: summaryDelta, preferencesDelta: "" },
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
      return textOnlyResult(
        "Tell me which bit of your wardrobe to tidy, loveling \u2728 " +
        "Name a kind — " + names + " — like \u2018delete the dresses\u2019!",
        "no_category_named",
        "Delete request with no named category."
      );
    }
    var inCategory = activeByCategory(catalog, category);
    if (inCategory.length === 0) {
      return textOnlyResult(
        "No " + pluralOf(category) + " tucked in your wardrobe just now, darling \u2728 " +
        "Nothing to delete!",
        "empty_category",
        "Delete request on an empty category."
      );
    }
    var page = inCategory.slice(0, PAGE);
    var reply = listReply(category, page, inCategory.length, 0);
    holdPage(catalog, reply, category,
      page.map(function (p) { return p.piece_id; }), 0);
    return {
      text: reply,
      image: null,
      persist: { summaryDelta: "Listed " + pluralOf(category) + " for deletion (" + inCategory.length + ").", preferencesDelta: "" },
      skill: SKILL,
      meta: {
        imageDelivery: { requested: false, generated: false, delivered: false, reason: "list_no_image" }
      }
    };
  }

  // ---- Step B: follow-up against the live list context ----
  function followUp(catalog, text, ctx) {
    var inCategory = activeByCategory(catalog, ctx.category);
    var byId = {};
    inCategory.forEach(function (p) { byId[p.piece_id] = p; });
    // The live page, in order — entries that fell out of active since
    // are skipped honestly rather than offered blind.
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
        return textOnlyResult(restate, "list_no_image",
          "Show-more at end of delete list; restated page.");
      }
      var reply = listReply(ctx.category, nextPage, inCategory.length, nextOffset);
      holdPage(catalog, reply, ctx.category,
        nextPage.map(function (p) { return p.piece_id; }), nextOffset);
      return textOnlyResult(reply, "list_no_image",
        "Listed next " + pluralOf(ctx.category) + " for deletion.");
    }

    // (a) a number picks one piece off the LAST shown list — and moves to
    // Step C (confirm), never deleting yet.
    var n = pickNumber(text);
    if (n !== null) {
      return pickPiece(catalog, ctx, pagePieces, n);
    }

    // (c) anything else: honest re-prompt, same page still live.
    var again = repromptReply(pagePieces,
      "Oh loveling, I didn\u2019t catch a number or \u2018show more\u2019 just then \u2728 " +
      "Here\u2019s the list again — it\u2019s still live:");
    holdPage(catalog, again, ctx.category,
      pagePieces.map(function (p) { return p.piece_id; }), ctx.offset);
    return textOnlyResult(again, "list_no_image",
      "Re-prompted for a delete-list pick.");
  }

  function pickPiece(catalog, ctx, pagePieces, n) {
    if (n < 1 || n > pagePieces.length) {
      var range = repromptReply(pagePieces,
        "Hmm, that number drifted off the page, darling \u2728 " +
        "I only showed " + pagePieces.length + " — pick 1 to " + pagePieces.length +
        " and I\u2019ll double-check before anything goes:");
      holdPage(catalog, range, ctx.category,
        pagePieces.map(function (p) { return p.piece_id; }), ctx.offset);
      return textOnlyResult(range, "pick_out_of_range",
        "Out-of-range delete pick; re-prompted.");
    }
    var piece = pagePieces[n - 1];
    var desc = shortDesc(piece);
    // The picking phase is done: the list context goes, and the confirm
    // question itself becomes the only live pending-expectation.
    releaseList(catalog);
    var question = "Remove your " + desc + " \u2014 are you sure? Say yes to confirm, or no to keep it.";
    try {
      if (catalog && typeof catalog.setPendingDeletion === "function") {
        catalog.setPendingDeletion({
          skill: SKILL, piece_id: piece.piece_id,
          description: desc, expires_at: expiresAt(PENDING_TTL_MS)
        });
      }
    } catch (e) { /* pending state must not break the reply */ }
    try {
      if (catalog && typeof catalog.askQuestion === "function") {
        catalog.askQuestion({ text: question, skill: SKILL, expects: "yes_no" });
      }
    } catch (e) { /* expectation must not break the reply */ }
    return textOnlyResult(question, "confirm_awaiting_yes_no",
      "Asked to confirm removing " + desc + ".");
  }

  // ---- Step D: the confirmation turn ----
  // The loop only invokes this skill on an already-verified affirmative
  // reply when expects:"yes_no" is pending, so a live pending deletion
  // here IS the confirmed "yes" — never re-parse yes/no. Deletion is the
  // existing soft-delete primitive (status flip, history kept).
  function confirmDeletion(catalog, pending) {
    var desc = pending.description;
    var piece = null;
    try {
      piece = catalog && typeof catalog.getPiece === "function" ?
        catalog.getPiece(pending.piece_id) : null;
    } catch (e) { piece = null; }
    releasePending(catalog);
    if (!piece || piece.status !== "active") {
      return textOnlyResult(
        "Oh loveling, that " + desc + " already slipped out of the wardrobe \u2728 " +
        "Nothing left to remove!",
        "delete_already_gone",
        "Delete confirm found " + desc + " already gone."
      );
    }
    try {
      if (catalog && typeof catalog.rejectPiece === "function") {
        catalog.rejectPiece(pending.piece_id);
      }
    } catch (e) {
      return textOnlyResult(
        "Oh loveling, I couldn\u2019t quite lift that " + desc + " out just now \u2728 " +
        "Say the word and I\u2019ll try again!",
        "delete_failed",
        "Delete confirm failed to reject " + desc + "."
      );
    }
    return textOnlyResult(
      "Done, darling \u2728 Your " + desc + " is out of the wardrobe.",
      "delete_confirmed",
      "Removed " + desc + " from the wardrobe."
    );
  }

  // Pieces the clear-all ask covers: every ACTIVE piece plus every
  // "held" prospective-purchase piece (held pieces are wardrobe pieces
  // too — they clear along with the rest and are named separately in
  // the ask wording). Rejected/superseded history is never touched.
  function clearAllTargets(catalog) {
    var actives = [];
    var helds = [];
    try { actives = catalog ? catalog.getActivePieces() : []; } catch (e) { actives = []; }
    try {
      helds = (catalog && typeof catalog.getPieces === "function") ?
        catalog.getPieces({ status: "held" }) : [];
    } catch (e) { helds = []; }
    if (!Array.isArray(actives)) actives = [];
    if (!Array.isArray(helds)) helds = [];
    return actives.concat(helds);
  }

  // Short per-category breakdown in fixed taxonomy order ("2 dresses,
  // 3 tops, 2 bags, 1 scarf, 1 pair of shoes").
  function clearAllBreakdown(targets) {
    var order = Object.keys(PLURAL_TO_CATEGORY);
    var counts = {};
    targets.forEach(function (p) {
      if (!p || typeof p.category !== "string") return;
      counts[p.category] = (counts[p.category] || 0) + 1;
    });
    var parts = [];
    order.forEach(function (plural) {
      var c = PLURAL_TO_CATEGORY[plural];
      if (!counts[c]) return;
      var n = counts[c];
      if (c === "shoes") parts.push(n === 1 ? "1 pair of shoes" : n + " pairs of shoes");
      else parts.push(n + " " + (n === 1 ? plainNoun(c) : plural));
    });
    return parts.join(", ");
  }

  // ---- Clear-all ask: count + breakdown, profile photos untouched ----
  function clearAllAsk(catalog) {
    // A stale Step B list never survives pivoting to a whole-wardrobe
    // clear — the confirm question becomes the only live expectation.
    releaseList(catalog);
    var targets = clearAllTargets(catalog);
    if (targets.length === 0) {
      return textOnlyResult(
        "Your wardrobe is already a blank canvas, darling \u2728 " +
        "Nothing to clear!",
        "clear_all_empty",
        "Clear-all request on an empty wardrobe."
      );
    }
    var heldCount = 0;
    try {
      heldCount = targets.filter(function (p) {
        return p && p.status === "held";
      }).length;
    } catch (e) { heldCount = 0; }
    var total = targets.length;
    var noun = total === 1 ? "piece" : "pieces";
    var heldSuffix = (heldCount > 0 ?
      ", including " + heldCount + " held one" + (heldCount === 1 ? "" : "s") +
      " you\u2019re still deciding on" : "");
    var head = total === 1 ?
      "A brand-new wardrobe, darling \u2728 \u2014 that\u2019s your " +
      total + " " + noun + " (" + clearAllBreakdown(targets) + ")" +
      heldSuffix + "." :
      "A brand-new wardrobe, darling \u2728 \u2014 that\u2019s all " +
      total + " " + noun + " (" + clearAllBreakdown(targets) + ")" +
      heldSuffix + ".";
    var question = head + " Your saved profile photos stay exactly as they are " +
      "\u2014 this only clears wardrobe pieces. " +
      "Say yes to clear it all, or no to keep everything.";
    var label = total === 1 ?
      "your " + total + " " + noun + " (" + clearAllBreakdown(targets) + ")" :
      "all " + total + " " + noun + " (" + clearAllBreakdown(targets) + ")";
    try {
      if (catalog && typeof catalog.setPendingDeletion === "function") {
        catalog.setPendingDeletion({
          skill: SKILL, piece_id: CLEAR_ALL_PIECE_ID,
          description: JSON.stringify({
            label: label,
            piece_ids: targets.map(function (p) { return p.piece_id; })
          }),
          expires_at: expiresAt(PENDING_TTL_MS)
        });
      }
    } catch (e) { /* pending state must not break the reply */ }
    try {
      if (catalog && typeof catalog.askQuestion === "function") {
        catalog.askQuestion({ text: question, skill: SKILL, expects: "yes_no" });
      }
    } catch (e) { /* expectation must not break the reply */ }
    return textOnlyResult(question, "clear_all_awaiting_yes_no",
      "Asked to confirm clearing " + label + ".");
  }

  // ---- Clear-all confirm: reject ONLY the snapshot ids still live ----
  // Pieces catalogued after the ask are absent from the snapshot and are
  // left alone; snapshot ids already rejected read as already gone.
  // Saves the catalog exactly ONCE via catalog.save() (best-effort, the
  // same save path the service uses after a single delete).
  async function confirmClearAll(catalog, pending) {
    var ids = clearAllSnapshotIds(pending) || [];
    releasePending(catalog);
    releaseList(catalog);
    var removed = 0;
    ids.forEach(function (id) {
      var piece = null;
      try {
        piece = catalog && typeof catalog.getPiece === "function" ?
          catalog.getPiece(id) : null;
      } catch (e) { piece = null; }
      if (!piece || (piece.status !== "active" && piece.status !== "held")) return;
      try {
        if (catalog && typeof catalog.rejectPiece === "function") {
          catalog.rejectPiece(id);
          removed += 1;
        }
      } catch (e) { /* one bad id never blocks the rest */ }
    });
    try {
      if (catalog && typeof catalog.save === "function") await catalog.save();
    } catch (e) { /* best-effort: the service also saves after the turn */ }
    if (removed === 0) {
      return textOnlyResult(
        "Oh loveling, those pieces already slipped out of the wardrobe \u2728 " +
        "Nothing left to clear!",
        "clear_all_already_gone",
        "Clear-all confirm found every snapshot piece already gone."
      );
    }
    var noun = removed === 1 ? "piece" : "pieces";
    if (removed === 1) {
      return textOnlyResult(
        "Done, darling \u2728 \u2014 1 piece is out of the wardrobe, a blank canvas just for you. " +
        "Your saved profile photos are untouched. " +
        "Share a fresh photo whenever you like and we\u2019ll start your new wardrobe story! \u2728",
        "clear_all_confirmed",
        "Cleared 1 piece from the wardrobe."
      );
    }
    return textOnlyResult(
      "Done, darling \u2728 \u2014 all " + removed + " " + noun +
      " are out of the wardrobe, a blank canvas just for you. " +
      "Your saved profile photos are untouched. " +
      "Share a fresh photo whenever you like and we\u2019ll start your new wardrobe story! \u2728",
      "clear_all_confirmed",
      "Cleared " + removed + " " + noun + " from the wardrobe."
    );
  }

  async function handle(opts) {
    var o = opts || {};
    var catalog = o.catalog || null;
    var text = typeof o.text === "string" ? o.text :
      (typeof o.message === "string" ? o.message : "");
    // Step D first: a live pending deletion means this call is the
    // already-verified "yes" — single-piece or clear-all by its marker.
    var pending = livePending(catalog);
    if (pending) {
      if (clearAllSnapshotIds(pending) !== null) return await confirmClearAll(catalog, pending);
      return confirmDeletion(catalog, pending);
    }
    // A whole-wardrobe ask pivots out of any live Step B list first.
    if (wantsClearAll(text)) return clearAllAsk(catalog);
    var ctx = liveContext(catalog);
    if (ctx) return followUp(catalog, text, ctx);
    return freshRequest(catalog, text);
  }

  var api = {
    handle: handle, skill: SKILL,
    plainNoun: plainNoun, shortDesc: shortDesc,
    wantsClearAll: wantsClearAll,
    PLURAL_TO_CATEGORY: PLURAL_TO_CATEGORY, PAGE: PAGE
  };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills[SKILL] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
