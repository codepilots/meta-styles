"use strict";
/* meta-styles Milestone 21 — skill: propose_look. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 *
 * Server-side Spark look choice (no browser global required):
 *  1. Read live pieces from the injected catalog (piece IDs + category only;
 *     no bearer tokens, no raw platform IDs in the Spark prompt or reply).
 *  2. Ask Spark (metaClient.assemble) for JSON {looks:[{pieceIds,rationale}]}
 *     constrained to the available pieces, best first.
 *  3. Validate Spark output locally before replying: every ID must exist,
 *     no repeats, valid outfit shape (assembler rules + no duplicate
 *     category/piece, never all pieces by default).
 *  4. Spark failure / invalid output / no valid look -> deterministic local
 *     assembler fallback, and honest text when nothing validates.
 *  5. Preview (metaClient.preview) only after a validated look; honours the
 *     proxy's actual return shape ({dataURL}, not url). When the service
 *     passes shareId + stageImage (either mode — mock stages via
 *     /mock/stage-outbound-image, live via /ig/outbound-stage), the
 *     dataURL is staged for a real send-with-image and delivered flips
 *     true with no caveat; otherwise sends stay text-only and
 *     result.meta.imageDelivery reports that truthfully — never an
 *     example.invalid URL in reply text. Staged-for-send is not
 *     delivered: only the bot's image_message_id on the later send
 *     counts as delivery (the service layer enforces that).
 */
(function (root) {

  var BASE_CATS = ["base/top", "base/bottom", "dress"];
  var LAYER_CATS = ["layer/cardigan", "layer/blazer"];

  function plainNoun(c) {
    var m = {
      "base/top": "top", "base/bottom": "bottom", "dress": "dress",
      "layer/cardigan": "cardigan", "layer/blazer": "blazer",
      "scarf": "scarf", "bag": "bag"
    };
    return m[c] || "piece";
  }

  // Server-side assembler, in preference order: injected opt -> Node require
  // -> browser global. Never assumes the browser global exists.
  function getAssembleLook(opts) {
    if (opts && typeof opts.assembler === "function") return opts.assembler;
    if (opts && opts.assembler && typeof opts.assembler.assembleLook === "function") {
      return opts.assembler.assembleLook;
    }
    try {
      if (typeof require !== "undefined") {
        var m = require("../../assembler.js");
        if (m && typeof m.assembleLook === "function") return m.assembleLook;
      }
    } catch (e) { /* fall through to global */ }
    try {
      if (root.MetaStyles && typeof root.MetaStyles.assembleLook === "function") {
        return root.MetaStyles.assembleLook;
      }
    } catch (e2) { /* none available */ }
    return null;
  }

  function byIdMap(active) {
    var map = {};
    active.forEach(function (p) { map[p.piece_id] = p; });
    return map;
  }

  // Strict outfit-shape check (mirrors assembler.js fit rules, plus the
  // skill's stricter no-duplicate-category/piece and never-all-pieces rules).
  // items: [{id, category}]. Returns null when the shape is fine, else a
  // short machine reason code.
  function strictShape(items, activeLength) {
    var cats = items.map(function (it) { return it.category; });
    var i;
    var seenCat = {};
    for (i = 0; i < cats.length; i++) {
      if (cats[i] === "shoes" || /shoe/i.test(cats[i])) return "shoes_excluded";
      if (seenCat[cats[i]]) return "duplicate_category";
      seenCat[cats[i]] = true;
    }
    var bases = items.filter(function (it) { return BASE_CATS.indexOf(it.category) !== -1; });
    if (bases.length === 0) return "missing_base";
    var dresses = bases.filter(function (b) { return b.category === "dress"; });
    if (dresses.length > 0 && bases.length > 1) return "dress_plus_separates";
    var layers = items.filter(function (it) { return LAYER_CATS.indexOf(it.category) !== -1; });
    if (layers.length >= 2) return "two_layers";
    var scarves = items.filter(function (it) { return it.category === "scarf"; });
    var bags = items.filter(function (it) { return it.category === "bag"; });
    var hasLayerFinish = layers.length === 1;
    var hasScarfBagFinish = scarves.length >= 1 && bags.length >= 1;
    if (hasLayerFinish && hasScarfBagFinish) return "two_finishes";
    if (!hasLayerFinish && !hasScarfBagFinish) {
      if (scarves.length >= 1 || bags.length >= 1) return "incomplete_finish";
      return "missing_finish";
    }
    // A valid strict-shape look is at most 4 pieces (base pair + scarf + bag),
    // so covering a bigger wardrobe wholesale is never a choice — while a
    // small wardrobe (<=4) may genuinely wear all of itself.
    if (items.length === activeLength && activeLength > 4) return "all_pieces";
    return null;
  }

  // Validate one Spark-proposed ID list against the live catalog.
  // Returns {ok, items, reason} where items are assembler-ready.
  function validateSelection(active, selIds, assembleLook) {
    if (!Array.isArray(selIds) || selIds.length === 0) {
      return { ok: false, reason: "empty_selection" };
    }
    var map = byIdMap(active);
    var seen = {};
    var i;
    for (i = 0; i < selIds.length; i++) {
      var id = selIds[i];
      if (typeof id !== "string" || !map[id]) return { ok: false, reason: "unknown_piece" };
      if (seen[id]) return { ok: false, reason: "repeated_piece" };
      seen[id] = true;
    }
    var items = selIds.map(function (pid) {
      var p = map[pid];
      return {
        id: pid,
        category: p.category,
        copy: { text: "SYNTH " + p.category, placeholder: true, note: "propose_look validation input" }
      };
    });
    var shapeReason = strictShape(items, active.length);
    if (shapeReason) return { ok: false, reason: shapeReason };
    if (typeof assembleLook === "function") {
      var card;
      try {
        card = assembleLook(items);
      } catch (e) {
        return { ok: false, reason: "assembler_error" };
      }
      if (!card || card.valid !== true) {
        return { ok: false, reason: "fit_invalid" };
      }
      return { ok: true, items: items, card: card };
    }
    return { ok: true, items: items, card: null };
  }

  // Deterministic local fallback: enumerate base x finish combos in fixed
  // order (dresses first, then tops/bottoms; layers before scarf+bag pairs)
  // and return the first candidate that validates. Small valid subsets come
  // out before larger ones by construction — never all pieces by default.
  function fallbackChoose(active, assembleLook) {
    var dresses = active.filter(function (p) { return p.category === "dress"; });
    var tops = active.filter(function (p) { return p.category === "base/top"; });
    var bottoms = active.filter(function (p) { return p.category === "base/bottom"; });
    var layers = active.filter(function (p) { return LAYER_CATS.indexOf(p.category) !== -1; });
    var scarves = active.filter(function (p) { return p.category === "scarf"; });
    var bags = active.filter(function (p) { return p.category === "bag"; });

    var baseOptions = [];
    dresses.forEach(function (d) { baseOptions.push([d]); });
    tops.forEach(function (t) {
      bottoms.forEach(function (b) { baseOptions.push([t, b]); });
    });
    tops.forEach(function (t) { baseOptions.push([t]); });
    bottoms.forEach(function (b) { baseOptions.push([b]); });

    var finishOptions = [];
    layers.forEach(function (l) { finishOptions.push([l]); });
    scarves.forEach(function (s) {
      bags.forEach(function (b) { finishOptions.push([s, b]); });
    });

    var rejected = "no_valid_combination";
    for (var bi = 0; bi < baseOptions.length; bi++) {
      for (var fi = 0; fi < finishOptions.length; fi++) {
        var combo = baseOptions[bi].concat(finishOptions[fi]);
        var ids = combo.map(function (p) { return p.piece_id; });
        var checked = validateSelection(active, ids, assembleLook);
        if (checked.ok) return { items: checked.items, card: checked.card };
        rejected = checked.reason;
      }
    }
    return { items: null, card: null, rejected: rejected };
  }

  // Spark rationale is model text: keep it, but strip anything shaped like a
  // piece/share id so the reply names only pieces/categories, never IDs.
  function cleanRationale(text) {
    var t = String(text || "");
    t = t.replace(/SYNTH_[A-Za-z0-9_]+/g, "");
    t = t.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
    return t;
  }

  function localRationale(items, card) {
    var nouns = items.map(function (it) { return plainNoun(it.category); });
    var finish = (card && card.finish) || null;
    if (!finish) {
      var cats = items.map(function (it) { return it.category; });
      var hasLayer = cats.some(function (c) { return LAYER_CATS.indexOf(c) !== -1; });
      finish = hasLayer ? "layer" : "scarf+bag";
    }
    if (finish === "layer") {
      return "The single layer worn open keeps the line long and leggy over " +
        (nouns.length > 1 ? "the " + nouns.slice(0, -1).join(" and ") : "your base") + " — nothing pulls, nothing stacks.";
    }
    return "The scarf tied high draws the eye up while the bag adds shine at the hip — " +
      "the pair works as one finish, so the line stays long.";
  }

  function plainWhy(reason) {
    var m = {
      missing_base: "there's no base to build on yet",
      dress_plus_separates: "a dress already counts as the whole base, so it won't share with separates",
      two_layers: "layers never stack — just one at a time",
      two_finishes: "a look takes exactly one finish, not a layer plus scarf-and-bag",
      incomplete_finish: "a scarf needs its bag partner and vice versa",
      missing_finish: "there's no finish yet — one layer, or a scarf plus bag",
      all_pieces: "using every single piece at once would stack finishes",
      unknown_piece: "Spark named a piece that isn't in your wardrobe",
      repeated_piece: "Spark named the same piece twice",
      duplicate_category: "two pieces played the same role",
      shoes_excluded: "shoes stay out of look cards",
      fit_invalid: "the fit rules didn't pass it",
      empty_selection: "Spark came back with no selection",
      assembler_error: "the fit-check stumbled",
      no_valid_combination: "nothing in there pairs into a full look yet"
    };
    return m[reason] || "it didn't pass the fit rules";
  }

  function logDecision(source, selectedCount, rejectedReason, toolSteps) {
    try {
      console.log("propose_look " + JSON.stringify({
        skill: "propose_look",
        source: source,
        selected: selectedCount,
        rejected: rejectedReason || null,
        steps: toolSteps
      }));
    } catch (e) { /* logging never breaks the reply */ }
  }

  // Opus finding #6: record every turn (success AND no-op) so later
  // skills (explain_fit via catalog.getTurns()) can see what was just
  // proposed. Fail-closed-but-never-blocking: a schema mismatch must
  // never break the user-facing reply. Verdict-false turns carry a
  // null proposal so explain_fit never reads a failed turn as a look.
  function recordLookTurn(catalog, entry) {
    if (!catalog || typeof catalog.recordTurn !== "function") return;
    try {
      catalog.recordTurn(entry);
    } catch (e) { /* turn-recording never breaks the reply */ }
  }

  function finishOf(items, card) {
    if (card && typeof card.finish === "string" &&
        (card.finish === "layer" || card.finish === "scarf+bag")) {
      return card.finish;
    }
    var cats = items.map(function (it) { return it.category; });
    var hasLayer = cats.some(function (c) { return LAYER_CATS.indexOf(c) !== -1; });
    return hasLayer ? "layer" : "scarf+bag";
  }

  async function handle(opts) {
    var o = opts || {};
    var catalog = o.catalog;
    var userText = typeof o.text === "string" ? o.text : (typeof o.message === "string" ? o.message : "");
    var metaClient = o.metaClient || null;
    var assembleLook = getAssembleLook(o);
    // Image delivery: the service passes its share id plus a staging
    // function (per mode — mock /mock/stage-outbound-image, live
    // /ig/outbound-stage). When both are present and staging succeeds,
    // the preview is genuinely queued for an image send and no caveat is
    // appended. Otherwise the honest "can't send pictures yet" caveat
    // stays. A null stageImage (a mode with no staging route) keeps the
    // text-only path exactly as before.
    var shareId = typeof o.shareId === "string" && o.shareId ? o.shareId : null;
    var stageImage = typeof o.stageImage === "function" ? o.stageImage : null;
    var toolSteps = 0;

    var active = [];
    try {
      active = catalog ? catalog.getActivePieces() : [];
      toolSteps += 1;
    } catch (e) { active = []; }
    if (!Array.isArray(active)) active = [];

    if (active.length === 0) {
      logDecision("empty", 0, "empty_wardrobe", toolSteps);
      recordLookTurn(catalog, { userText: userText, proposal: null, verdict: false, reasons: ["empty_wardrobe"] });
      return {
        text: "Your wardrobe\u2019s feeling a little empty just now, loveling \u2014 share a photo of something you love and I\u2019ll catalogue it, then we can make magic! \u2728",
        image: null,
        persist: { summaryDelta: "Empty wardrobe, offered to catalogue.", preferencesDelta: "" },
        skill: "propose_look",
        meta: {
          source: "empty", selectedCount: 0, rejectedReason: "empty_wardrobe",
          toolSteps: toolSteps,
          imageDelivery: { requested: false, generated: false, delivered: false, reason: "empty_wardrobe" }
        }
      };
    }

    // 1. Ask Spark for a constrained choice: IDs + categories only, JSON only.
    var sparkLooks = null;
    var sparkError = null;
    if (metaClient && typeof metaClient.assemble === "function") {
      toolSteps += 1;
      var promptPieces = active.map(function (p) { return { id: p.piece_id, category: p.category }; });
      try {
        var res = await metaClient.assemble(promptPieces);
        if (res && Array.isArray(res.looks) && res.looks.length > 0) {
          sparkLooks = res.looks;
        } else {
          sparkError = "no_looks";
        }
      } catch (e) {
        sparkError = "assemble_failed";
      }
    } else {
      sparkError = "no_assemble_client";
    }

    // 2. Validate each Spark candidate best-first.
    var chosen = null;
    var chosenRationale = "";
    var rejectedReason = sparkError;
    var sparkRejected = [];
    if (sparkLooks) {
      for (var li = 0; li < sparkLooks.length; li++) {
        var cand = sparkLooks[li] || {};
        var checked = validateSelection(active, cand.pieceIds, assembleLook);
        if (checked.ok) {
          chosen = checked;
          chosenRationale = cleanRationale(cand.rationale);
          rejectedReason = null;
          break;
        }
        rejectedReason = "spark_rejected:" + checked.reason;
        sparkRejected.push(rejectedReason);
      }
      if (!chosen && !rejectedReason) rejectedReason = "spark_rejected:no_valid_combination";
    }

    var source = chosen ? "spark" : "fallback";
    var fallbackRejected = null;
    if (!chosen) {
      var fb = fallbackChoose(active, assembleLook);
      if (fb.items) {
        chosen = { items: fb.items, card: fb.card };
        chosenRationale = localRationale(fb.items, fb.card);
      } else {
        fallbackRejected = fb.rejected;
        rejectedReason = rejectedReason || ("fallback_rejected:" + fb.rejected);
      }
    }

    // 3. No valid look anywhere: honest text, never a placeholder claim.
    if (!chosen) {
      var why = plainWhy(fallbackRejected || "no_valid_combination");
      logDecision("fallback", 0, rejectedReason, toolSteps);
      recordLookTurn(catalog, {
        userText: userText, proposal: null, verdict: false,
        reasons: rejectedReason ? [rejectedReason] : ["no_valid_combination"]
      });
      return {
        text: "Oh, loveling \u2728 I turned every piece over in the lamplight, but " + why +
          " — share one more piece (a layer, or a scarf with its bag) and I\u2019ll spin it into a full look!",
        image: null,
        persist: { summaryDelta: "No valid look; said why honestly.", preferencesDelta: "" },
        skill: "propose_look",
        meta: {
          source: "fallback", selectedCount: 0, rejectedReason: rejectedReason,
          toolSteps: toolSteps,
          imageDelivery: { requested: false, generated: false, delivered: false, reason: "no_valid_look" }
        }
      };
    }

    // 4. Validated look: reply names only piece nouns + the real rationale.
    var nouns = chosen.items.map(function (it) { return plainNoun(it.category); }).join(" + ");
    var rationale = chosenRationale || localRationale(chosen.items, chosen.card);
    var reply = "Oh, here\u2019s a little spell for you, darling \u2728 How about your " + nouns +
      " together? " + rationale + " Want me to tweak anything?";

    // 5. Preview only after a validated look; honour the real return shape.
    // Photo-reference (M21 photo-reference work, option b): pass the single
    // most relevant stored thumb — the first chosen piece that carries one
    // (chosen order is base-first, so this is the look's base garment) — as
    // the preview's reference image. metaClient.preview(prompt,
    // imageDataUrl) and the proxy's /api/preview {prompt, image?} route
    // only demonstrate single-image use upstream (images/edits with one
    // image_url), so multi-piece referencing stays a known limitation for a
    // future pass. No thumb anywhere -> the existing text-only prompt path.
    var byId = byIdMap(active);
    var refThumb = null;
    var refPieces = 0;
    for (var ti = 0; ti < chosen.items.length; ti++) {
      var lp = byId[chosen.items[ti].id];
      if (lp && typeof lp.photo_thumb === "string" && /^data:image\//.test(lp.photo_thumb)) {
        refPieces += 1;
        if (!refThumb) refThumb = lp.photo_thumb;
      }
    }
    var previewPrompt =
      "Y2K fairycore flat-lay look card, soft pastel background, garments laid out neatly: " +
      nouns + ". No people, no worn try-on, no readable text.";
    if (refThumb) {
      previewPrompt += " Use the attached reference garment photo for the true colors and silhouette.";
    }
    var imageDelivery = { requested: false, generated: false, delivered: false, reason: "no_preview_client" };
    var image = null;
    if (metaClient && typeof metaClient.preview === "function") {
      imageDelivery.requested = true;
      imageDelivery.reason = "preview_failed";
      toolSteps += 1;
      try {
        var pr = await metaClient.preview(previewPrompt, refThumb || null);
        var durl = pr && (pr.dataURL || pr.dataUrl || pr.data_url);
        if (typeof durl === "string" && /^data:image\//.test(durl)) {
          imageDelivery.generated = true;
          image = { dataURL: durl, caption: nouns + " \u2014 styled with love" };
          if (shareId && stageImage) {
            toolSteps += 1;
            var staged = null;
            try {
              staged = await stageImage(shareId, durl);
            } catch (e) {
              staged = null;
            }
            if (staged && staged.ok) {
              imageDelivery.delivered = true;
              imageDelivery.reason = "staged for send with image";
            } else {
              imageDelivery.reason = "stage_failed";
            }
          } else {
            imageDelivery.reason = "text-only send; preview not staged for delivery";
          }
        } else {
          imageDelivery.reason = "preview_unparseable";
        }
      } catch (e) {
        imageDelivery.reason = "preview_failed";
      }
    }
    if (imageDelivery.requested && !imageDelivery.delivered) {
      reply += " (I can\u2019t tuck preview pictures into chat just yet, so this word-picture will have to sparkle on its own. \u2728)";
    }

    // Pending expectation (Milestone 24): the "Want me to tweak
    // anything?" closer above is a yes/no moment — a plain "yes" matches
    // no router trigger and would otherwise fall to off_topic instead of
    // continuing into revise_look's own question flow. Only recorded on
    // this validated-look path (the honest no-valid-look fallback above
    // asks for another photo, which routes to catalogue_piece already).
    // Never throws: a catalog failure must not break the reply itself.
    try{
      if(opts && opts.catalog && typeof opts.catalog.askQuestion==="function"){
        opts.catalog.askQuestion({ text:reply, skill:"revise_look", expects:"yes_no" });
      }
    }catch(e){}
    logDecision(source, chosen.items.length, rejectedReason, toolSteps);
    // Opus finding #6: remember the look for explain_fit / the router.
    // Rejections that happened along the way travel in reasons[] so a
    // later turn can see "Spark's first picks didn't validate".
    var turnReasons = sparkRejected.slice();
    if (source === "fallback" && fallbackRejected) turnReasons.push("fallback_rejected:" + fallbackRejected);
    var turnFinish = finishOf(chosen.items, chosen.card);
    recordLookTurn(catalog, {
      userText: userText,
      proposal: {
        pieces: chosen.items.map(function (it) { return it.id; }),
        title: null, note: "valid:" + turnFinish
      },
      verdict: true, reasons: turnReasons
    });
    return {
      text: reply,
      image: image,
      persist: { summaryDelta: "Proposed look: " + nouns + ".", preferencesDelta: "" },
      skill: "propose_look",
      meta: {
        source: source, selectedCount: chosen.items.length, rejectedReason: rejectedReason,
        toolSteps: toolSteps, rationale: rationale, imageDelivery: imageDelivery,
        referenceThumb: refThumb ? true : false, referencePieces: refPieces
      }
    };
  }

  // Shared selection stack (Opus finding #7): revise_look reuses these
  // directly so the fit rules live in exactly one place. handle() above
  // is untouched — these are pure functions over caller-supplied sets.
  var api = {
    handle: handle, skill: "propose_look",
    validateSelection: validateSelection, fallbackChoose: fallbackChoose,
    strictShape: strictShape, getAssembleLook: getAssembleLook,
    plainWhy: plainWhy, plainNoun: plainNoun
  };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["propose_look"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
