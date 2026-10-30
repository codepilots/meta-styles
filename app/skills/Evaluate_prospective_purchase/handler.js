"use strict";
/* meta-styles Milestone 21 — skill: Evaluate_prospective_purchase. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 *
 * M22 item 3 — real 24-hour hold: a new evaluation actually stores a
 * "held" piece (status + held_until ISO expiry) via catalog.addPiece(),
 * and a later "I bought it" confirmation flips that piece to "active"
 * via catalog.activatePiece() — which clears held_until to null (the key
 * stays, null like photo_thumb, so a confirmed piece never reads as
 * still-held). Honesty discipline (same as propose_look's imageDelivery
 * truth-telling and catalogue_piece's thumbnail fail-soft): the reply
 * only promises a hold when addPiece actually succeeded, and a
 * confirmation with no live hold never fabricates a catalogue entry.
 *
 * Opus finding #12 fix: the "lovely outfits" are real validated outfit
 * possibilities — combinations of the active wardrobe plus the newly
 * held piece, each checked with the project's own fit engine
 * (app/assembler.js, via propose_look's validateSelection/strictShape so
 * the stricter no-duplicate-category rule applies too). Only combos that
 * come back valid:true are counted and described, naming the actual
 * pieces (never "top and top"). Zero valid combos get an honest
 * "can't quite picture a complete look yet, here's why" branch quoting
 * the engine's own reasons — never a fabricated outfit count. The
 * preview offer is backed by a real metaClient.preview call (same
 * preview->stage->send + imageDelivery honesty struct Complete_the_look
 * uses); when no preview client exists the "Want a preview image too?"
 * line is dropped instead of dangling.
 */
(function (root) {

  var HOLD_MS = 24 * 3600 * 1000;

  // Purchase-confirmation phrasing — mirrors the router's
  // "purchase confirmation trigger" (app/router.js); both must agree.
  var CONFIRM_RE = /\b(i bought it|i got it|i bought that|bought it|i picked it up)\b/;

  // Short-affirmative confirmation (Milestone 24): a plain "yes"/"done"/
  // "sure" reply to the "say 'I bought it'" prompt also completes the
  // purchase — the pending yes_no expectation routes it here, and this
  // accepts it. Reuses agentic-loop.js's conservative whole-reply
  // matcher (single source of truth — never a looser local copy: a
  // false-positive "yes" would wrongly activate a piece). Falls back to
  // false (exact-phrase-only, the pre-M24 behaviour) when the matcher is
  // unreachable, so confirmation can only get stricter, never looser.
  // Photo-carrying turns are never affirmative confirmations — a picture
  // plus "sure" is a new item to evaluate, not a bought-it.
  function affirmativeShortReply(text){
    try{
      var m = null;
      try{ if(typeof require!=="undefined") m=require("../../agentic-loop.js"); }catch(e){ m=null; }
      if((!m||typeof m.isAffirmativeReply!=="function")&&root.MetaStyles&&root.MetaStyles.agenticLoop) m=root.MetaStyles.agenticLoop;
      if(m&&typeof m.isAffirmativeReply==="function") return m.isAffirmativeReply(text);
    }catch(e){}
    return false;
  }

  // Pending expectation (Milestone 24): the "say 'I bought it'" prompt
  // below is a yes/no moment — recorded so a plain "yes"/"done"/"sure"
  // routes back here instead of deflecting to off_topic. Keeps the
  // default 24h TTL deliberately: the hold itself is a 24h window made at
  // the same moment, so the two expire together — and confirmation stays
  // double-gated on a still-live hold anyway, so a stale routing can
  // never activate a lapsed piece. Never throws.
  function recordPurchaseExpectation(catalog, questionText){
    try{
      if(catalog && typeof catalog.askQuestion==="function"){
        catalog.askQuestion({ text:questionText, skill:"Evaluate_prospective_purchase", expects:"yes_no" });
      }
    }catch(e){}
  }

  function plainNoun(c){ var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag"}; return m[c]||c; }

  var BASE_CATS = ["base/top", "base/bottom", "dress"];
  var LAYER_CATS = ["layer/cardigan", "layer/blazer"];

  // Server-side assembler, in preference order: injected opt -> Node
  // require -> browser global. Same resolution order propose_look uses.
  function getAssembleLook(o){
    if (o && typeof o.assembler === "function") return o.assembler;
    if (o && o.assembler && typeof o.assembler.assembleLook === "function") {
      return o.assembler.assembleLook;
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

  // propose_look's validated-combo stack (finding #12 fix direction:
  // validate outfits with assembleLook, don't template them). Local
  // mirrors cover the sibling-unreachable path only.
  function getPropose(){
    try {
      if (typeof require !== "undefined") return require("../propose_look/handler.js");
    } catch (e) { /* use local mirrors below */ }
    try {
      if (root.MetaStyles && root.MetaStyles.skills && root.MetaStyles.skills.propose_look) {
        return root.MetaStyles.skills.propose_look;
      }
    } catch (e2) { /* none available */ }
    return null;
  }

  function localPlainWhy(reason){
    var m = {
      missing_base: "there's no base to build on yet",
      dress_plus_separates: "a dress already counts as the whole base, so it won't share with separates",
      two_layers: "layers never stack — just one at a time",
      two_finishes: "a look takes exactly one finish, not a layer plus scarf-and-bag",
      incomplete_finish: "a scarf needs its bag partner and vice versa",
      missing_finish: "there's no finish yet — one layer, or a scarf plus bag",
      all_pieces: "using every single piece at once would stack finishes",
      duplicate_category: "two pieces played the same role",
      shoes_excluded: "shoes stay out of look cards",
      fit_invalid: "the fit rules didn't pass it"
    };
    return m[reason] || "it didn't pass the fit rules";
  }

  // Local mirror of propose_look's strictShape + assembleLook check:
  // no shoes, no duplicate categories, real base+finish shape, and the
  // engine itself must say valid:true. Used only when the sibling
  // module is unreachable.
  function localValidCombo(pool, selIds, assembleLook){
    var map = {};
    pool.forEach(function (p) { map[p.piece_id] = p; });
    var seen = {};
    for (var i = 0; i < selIds.length; i++) {
      if (!map[selIds[i]] || seen[selIds[i]]) return { ok: false, reason: "unknown_piece" };
      seen[selIds[i]] = true;
    }
    var items = selIds.map(function (pid) {
      return { id: pid, category: map[pid].category,
        copy: { text: "SYNTH " + map[pid].category, placeholder: true, note: "Evaluate_prospective_purchase validation input" } };
    });
    var cats = items.map(function (it) { return it.category; });
    var seenCat = {};
    for (var k = 0; k < cats.length; k++) {
      if (cats[k] === "shoes" || /shoe/i.test(cats[k])) return { ok: false, reason: "shoes_excluded" };
      if (seenCat[cats[k]]) return { ok: false, reason: "duplicate_category" };
      seenCat[cats[k]] = true;
    }
    var bases = items.filter(function (it) { return BASE_CATS.indexOf(it.category) !== -1; });
    if (bases.length === 0) return { ok: false, reason: "missing_base" };
    var layers = items.filter(function (it) { return LAYER_CATS.indexOf(it.category) !== -1; });
    if (layers.length >= 2) return { ok: false, reason: "two_layers" };
    var scarves = items.filter(function (it) { return it.category === "scarf"; });
    var bags = items.filter(function (it) { return it.category === "bag"; });
    if (layers.length === 1 && scarves.length >= 1 && bags.length >= 1) return { ok: false, reason: "two_finishes" };
    if (layers.length !== 1 && !(scarves.length >= 1 && bags.length >= 1)) {
      return { ok: false, reason: (scarves.length >= 1 || bags.length >= 1) ? "incomplete_finish" : "missing_finish" };
    }
    if (typeof assembleLook === "function") {
      var card = null;
      try { card = assembleLook(items); } catch (e) { return { ok: false, reason: "assembler_error" }; }
      if (!card || card.valid !== true) return { ok: false, reason: "fit_invalid" };
      return { ok: true, items: items, card: card };
    }
    return { ok: true, items: items, card: null };
  }

  function checkCombo(Propose, pool, selIds, assembleLook){
    if (Propose && typeof Propose.validateSelection === "function") {
      try { return Propose.validateSelection(pool, selIds, assembleLook); }
      catch (e) { /* fall through to local mirror */ }
    }
    return localValidCombo(pool, selIds, assembleLook);
  }

  // Validated outfit possibilities over the wardrobe pool (actives plus
  // the newly held piece). Enumerates base x finish combos in the same
  // fixed order fallbackChoose uses; when requiredId is set, only combos
  // containing the held piece count — every returned outfit features the
  // prospective purchase. Only combos the fit engine marks valid:true
  // (via validateSelection/strictShape) are returned.
  function enumerateOutfits(pool, requiredId, assembleLook, Propose){
    var dresses = pool.filter(function (p) { return p.category === "dress"; });
    var tops = pool.filter(function (p) { return p.category === "base/top"; });
    var bottoms = pool.filter(function (p) { return p.category === "base/bottom"; });
    var layers = pool.filter(function (p) { return LAYER_CATS.indexOf(p.category) !== -1; });
    var scarves = pool.filter(function (p) { return p.category === "scarf"; });
    var bags = pool.filter(function (p) { return p.category === "bag"; });
    var baseOptions = [];
    dresses.forEach(function (d) { baseOptions.push([d]); });
    tops.forEach(function (t) { bottoms.forEach(function (b) { baseOptions.push([t, b]); }); });
    tops.forEach(function (t) { baseOptions.push([t]); });
    bottoms.forEach(function (b) { baseOptions.push([b]); });
    var finishOptions = [];
    layers.forEach(function (l) { finishOptions.push([l]); });
    scarves.forEach(function (s) { bags.forEach(function (b) { finishOptions.push([s, b]); }); });
    var out = [];
    for (var bi = 0; bi < baseOptions.length; bi++) {
      for (var fi = 0; fi < finishOptions.length; fi++) {
        var combo = baseOptions[bi].concat(finishOptions[fi]);
        if (requiredId) {
          var hasHeld = false;
          for (var h = 0; h < combo.length; h++) {
            if (combo[h].piece_id === requiredId) { hasHeld = true; break; }
          }
          if (!hasHeld) continue;
        }
        var ids = combo.map(function (p) { return p.piece_id; });
        var checked = checkCombo(Propose, pool, ids, assembleLook);
        if (checked.ok) out.push({ items: checked.items, card: checked.card || null });
      }
    }
    return out;
  }

  function finishRoleNoun(heldCategory){
    if (LAYER_CATS.indexOf(heldCategory) !== -1) return "finishes it as the single layer";
    if (heldCategory === "scarf" || heldCategory === "bag") return "completes the scarf-and-bag finish";
    return "gives the look the base it was missing";
  }

  // One truthful line per validated outfit: names the actual pieces
  // (nouns only, never ids) and marks which one is the new piece.
  function describeOutfit(entry, heldId, index, nounOf){
    var held = null;
    var existing = [];
    for (var i = 0; i < entry.items.length; i++) {
      if (entry.items[i].id === heldId) held = entry.items[i];
      else existing.push(entry.items[i]);
    }
    var heldNoun = held ? nounOf(held.category) : "new piece";
    var heldCat = held ? held.category : "";
    if (existing.length === 0) {
      return (index + 1) + ". This " + heldNoun + " " + finishRoleNoun(heldCat) + " (fit check: valid \u2714)";
    }
    var eNouns = existing.map(function (it) { return nounOf(it.category); }).join(" and ");
    return (index + 1) + ". With your " + eNouns + " \u2014 this " + heldNoun + " " +
      finishRoleNoun(heldCat) + " (fit check: valid \u2714)";
  }

  var CAVEAT = " (I can\u2019t tuck preview pictures into chat just yet, loveling, so this word-picture will have to sparkle on its own. \u2728)";

  // Category sniffing — same approach as catalogue_piece/handler.js:
  // live classify first, then text-keyword fallback off the "dress"
  // default. Never throws; resolves "dress" when nothing else fits.
  async function sniffCategory(o, text, imageDataUrl){
    var cat = "dress";
    try{ if(o.metaClient && o.metaClient.classify){ var cr = await o.metaClient.classify(imageDataUrl, ""); if(cr && cr.category) cat = cr.category; } }catch(e){}
    if(cat === "dress"){
      var h = (text || "").toLowerCase();
      if(/scarf/.test(h)) cat = "scarf";
      else if(/bag|purse/.test(h)) cat = "bag";
      else if(/blazer|jacket/.test(h)) cat = "layer/blazer";
      else if(/cardigan|shrug/.test(h)) cat = "layer/cardigan";
      else if(/top|cami/.test(h)) cat = "base/top";
      else if(/trouser|jean|skirt|bottom/.test(h)) cat = "base/bottom";
    }
    return cat;
  }

  // Held pieces via the existing status-filtered accessor — no new
  // catalog API. Falls back to [] when the catalog has no getPieces
  // (a mock with only getActivePieces cannot see holds, honestly).
  function readHeldPieces(catalog){
    try{
      if(catalog && typeof catalog.getPieces === "function") return catalog.getPieces({ status: "held" }) || [];
    }catch(e){}
    return [];
  }

  function isLiveHold(p, nowMs){
    if(!p || typeof p.held_until !== "string") return false;
    var ms = Date.parse(p.held_until);
    return !Number.isNaN(ms) && ms > nowMs;
  }

  async function handle(opts){
    var o = opts || {}, catalog = o.catalog, text = o.text || "";
    var imageDataUrl = o.imageDataUrl || null;
    var metaClient = o.metaClient || null;
    var shareId = (typeof o.shareId === "string" && o.shareId) ? o.shareId : null;
    var stageImage = (typeof o.stageImage === "function") ? o.stageImage : null;
    var canPreview = !!(metaClient && typeof metaClient.preview === "function");
    var nowMs = Date.now();
    var assembleLook = getAssembleLook(o);
    var Propose = getPropose();
    var nounOf = (Propose && typeof Propose.plainNoun === "function") ? Propose.plainNoun : plainNoun;

    // --- (a/b) purchase confirmation ---
    // Exact phrase wins as before; a short affirmative ("yes"/"done"/
    // "sure") with NO photo attached also confirms — but only ever
    // against a still-live hold (checked inside), so hedged replies
    // ("maybe", "I'll think about it") and declines can never activate.
    var shortYes = !imageDataUrl && !o.imagePresent && affirmativeShortReply(text);
    if(CONFIRM_RE.test(text.toLowerCase()) || shortYes){
      var held = readHeldPieces(catalog);
      var live = null;
      for(var i = 0; i < held.length; i++){
        if(isLiveHold(held[i], nowMs)){ live = held[i]; break; }
      }
      if(live){
        var confirmed = false;
        if(catalog && typeof catalog.activatePiece === "function"){
          try{ catalog.activatePiece(live.piece_id); confirmed = true; }catch(e){ confirmed = false; }
        }
        if(confirmed){
          if(catalog.save){ try{ await catalog.save(); }catch(e){} }
          return { text: "Yay, it\u2019s officially yours now, loveling \u2728 I\u2019ve tucked it safely into your wardrobe — say the word anytime you want me to put a look together with it!", image: null, persist: { summaryDelta: "Confirmed prospective purchase into wardrobe.", preferencesDelta: "" }, skill: "Evaluate_prospective_purchase" };
        }
        return { text: "Oh loveling, I tried to tuck that one into your wardrobe but it wouldn\u2019t settle \u2728 Your 24-hour hold is still ticking — try saying \u201CI bought it\u201D again in a moment?", image: null, persist: { summaryDelta: "Purchase confirmation failed to catalogue.", preferencesDelta: "" }, skill: "Evaluate_prospective_purchase" };
      }
      if(held.length > 0){
        return { text: "Oh loveling, that little hold already lapsed \u2728 I only keep a piece aside for 24 hours, and this one slipped back. If you did bring it home, share it again and I\u2019ll catalogue it properly!", image: null, persist: { summaryDelta: "Purchase confirmation arrived after the hold lapsed.", preferencesDelta: "" }, skill: "Evaluate_prospective_purchase" };
      }
      return { text: "Oh loveling, there\u2019s nothing on hold for you just now \u2728 If you\u2019ve found something darling, show me and I\u2019ll hold it for 24 hours while you decide!", image: null, persist: { summaryDelta: "Purchase confirmation with nothing held.", preferencesDelta: "" }, skill: "Evaluate_prospective_purchase" };
    }

    // --- (c) new evaluation: store a real hold, then talk outfits ---
    var active = [];
    try { active = catalog ? catalog.getActivePieces() : []; } catch (e) { active = []; }
    if (!Array.isArray(active)) active = [];
    var holdOk = false;
    var heldCat = "dress";
    var heldId = null;
    if(catalog){
      try{
        var cat = await sniffCategory(o, text, imageDataUrl);
        var sid = (o && typeof o.shareId === "string" && o.shareId) ? o.shareId : ("SYNTH_share_" + Date.now());
        var added = catalog.addPiece({
          category: cat,
          attributes: {},
          source_share_id: sid,
          status: "held",
          held_until: new Date(nowMs + HOLD_MS).toISOString()
        });
        if(catalog.save){ try{ await catalog.save(); }catch(e){} }
        holdOk = true;
        heldCat = cat;
        if (added && typeof added.piece_id === "string") heldId = added.piece_id;
      }catch(e){ holdOk = false; }
    }

    // Validated outfit possibilities over actives + the held piece —
    // only combos the fit engine marks valid:true are counted and named.
    function validatedOutfitLines(pool, reqId){
      if (typeof assembleLook !== "function" || pool.length === 0) return { lines: [], outfits: [] };
      var found = enumerateOutfits(pool, reqId, assembleLook, Propose);
      var lines = found.map(function (entry, idx) { return describeOutfit(entry, reqId, idx, nounOf); });
      return { lines: lines, outfits: found };
    }

    function engineReasons(poolItems){
      if (typeof assembleLook !== "function") return "";
      try {
        var card = assembleLook(poolItems.map(function (p) {
          return { id: p.piece_id, category: p.category,
            copy: { text: "SYNTH " + p.category, placeholder: true, note: "Evaluate_prospective_purchase reason probe" } };
        }));
        if (card && !card.valid && Array.isArray(card.reasons) && card.reasons.length > 0) {
          return card.reasons.join(" ");
        }
      } catch (e) { /* fall through to generic */ }
      return "";
    }

    // Shared preview block (same honesty struct as Complete_the_look):
    // a real metaClient.preview dataURL staged via shareId + stageImage.
    // Returns { image, imageDelivery, caveat } — caveat is "" unless a
    // requested preview never made it to delivery.
    async function maybePreview(promptNouns, refPool){
      var imageDelivery = { requested: false, generated: false, delivered: false, reason: holdOk ? "no_preview_client" : "hold_not_stored" };
      var image = null;
      var caveat = "";
      if (!canPreview) return { image: image, imageDelivery: imageDelivery, caveat: caveat };
      var refThumb = null;
      for (var ti = 0; ti < refPool.length && ti < 3; ti++) {
        var lp = refPool[ti];
        if (lp && typeof lp.photo_thumb === "string" && /^data:image\//.test(lp.photo_thumb)) { refThumb = lp.photo_thumb; break; }
      }
      var prompt = "Y2K fairycore flat-lay look card, soft pastel background, garments laid out neatly: " +
        promptNouns + ". No people, no worn try-on, no readable text.";
      if (refThumb) prompt += " Use the attached reference garment photo for the true colors and silhouette.";
      imageDelivery.requested = true;
      imageDelivery.reason = "preview_failed";
      try {
        var pr = await metaClient.preview(prompt, refThumb || null);
        var durl = pr && (pr.dataURL || pr.dataUrl || pr.data_url);
        if (typeof durl === "string" && /^data:image\//.test(durl)) {
          imageDelivery.generated = true;
          image = { dataURL: durl, caption: promptNouns + " \u2014 styled with love" };
          if (shareId && stageImage) {
            var staged = null;
            try { staged = await stageImage(shareId, durl); } catch (e) { staged = null; }
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
      if (imageDelivery.requested && !imageDelivery.delivered) caveat = CAVEAT;
      return { image: image, imageDelivery: imageDelivery, caveat: caveat };
    }

    if(!holdOk){
      var tail = "";
      if(active.length > 0){
        var poolOnly = active.map(function (p) { return { piece_id: p.piece_id, category: p.category }; });
        var only = validatedOutfitLines(poolOnly, null);
        if (only.lines.length > 0) {
          var n0 = only.lines.length;
          tail = " From what you\u2019ve got, this could unlock " + n0 + (n0 === 1 ? " lovely outfit:\n" : " lovely outfits:\n") + only.lines.join("\n") + "\n\n";
        } else {
          var why0 = engineReasons(poolOnly);
          tail = " From what you\u2019ve got, I can\u2019t quite picture a complete look with this yet"
            + (why0 ? " \u2014 " + why0 : "") + ". If you share another piece or two, I\u2019ll show you how it mixes and matches!\n\n";
        }
      }
      return { text: "Ooh, let\u2019s have a look, loveling \u2728" + tail + "But I couldn\u2019t quite tuck this one away safely, so no promises on the hold, loveling! Tell me if you bring it home and I\u2019ll catalogue it properly. \u2728", image: null, persist: { summaryDelta: "Evaluated prospective purchase (hold not stored).", preferencesDelta: "" }, skill: "Evaluate_prospective_purchase", meta: { imageDelivery: { requested: false, generated: false, delivered: false, reason: "hold_not_stored" } } };
    }
    var intro = "Ooh, let\u2019s have a look, loveling \u2728 I\u2019ll hold this one just for 24 hours while you decide \u2014 text first, preview only if you\u2019d like it.";
    var previewQ = canPreview ? " Want a preview image too? \u2728" : " \u2728";
    if(active.length === 0){
      var emptyReply = intro + " Your wardrobe\u2019s empty just now, so I can\u2019t cross-check \u2014 but it looks like a darling piece on its own! Share a couple of wardrobe photos and I can show you how it would mix and match. (24hr hold, then I discard it unless you say you bought it \u2728)";
      var pv0 = await maybePreview("a new " + nounOf(heldCat), []);
      emptyReply += pv0.caveat;
      recordPurchaseExpectation(catalog, emptyReply);
      return { text: emptyReply, image: pv0.image, persist: { summaryDelta: "Evaluated prospective purchase (empty wardrobe).", preferencesDelta: "" }, skill: "Evaluate_prospective_purchase", meta: { imageDelivery: pv0.imageDelivery } };
    }
    var pool = active.map(function (p) { return { piece_id: p.piece_id, category: p.category }; });
    if (heldId) pool.push({ piece_id: heldId, category: heldCat });
    var found = validatedOutfitLines(pool, heldId);
    var promptNouns = "a new " + nounOf(heldCat);
    var outfitsReply;
    if (found.lines.length === 0) {
      var why = engineReasons(pool);
      outfitsReply = intro + " I can\u2019t quite picture a complete look with this yet"
        + (why ? ", but here\u2019s why: " + why : "")
        + ". If you share another piece or two, I\u2019ll show you how it mixes and matches! It\u2019s held for 24 hours, darling \u2014 say \u201CI bought it\u201D to catalogue it properly, or I\u2019ll gently let it go." + previewQ;
      var pvz = await maybePreview(promptNouns, active);
      outfitsReply += pvz.caveat;
      recordPurchaseExpectation(catalog, outfitsReply);
      return { text: outfitsReply, image: pvz.image, persist: { summaryDelta: "Evaluated prospective purchase: no valid combination yet.", preferencesDelta: "" }, skill: "Evaluate_prospective_purchase", meta: { imageDelivery: pvz.imageDelivery } };
    }
    if (found.outfits.length > 0 && found.outfits[0].items.length > 0) {
      var firstNouns = found.outfits[0].items.map(function (it) { return nounOf(it.category); }).join(" + ");
      if (firstNouns) promptNouns = firstNouns;
    }
    var n = found.lines.length;
    outfitsReply = intro + " From what you\u2019ve got, this could unlock " + n + (n === 1 ? " lovely outfit:\n" : " lovely outfits:\n") + found.lines.join("\n") + "\n\nIt\u2019s held for 24 hours, darling \u2014 say \u201CI bought it\u201D to catalogue it properly, or I\u2019ll gently let it go." + previewQ;
    var pv = await maybePreview(promptNouns, active);
    outfitsReply += pv.caveat;
    recordPurchaseExpectation(catalog, outfitsReply);
    return { text: outfitsReply, image: pv.image, persist: { summaryDelta: "Evaluated prospective purchase: " + n + " outfits.", preferencesDelta: "" }, skill: "Evaluate_prospective_purchase", meta: { imageDelivery: pv.imageDelivery } };
  }

  var api = { handle: handle, skill: "Evaluate_prospective_purchase" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["Evaluate_prospective_purchase"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
