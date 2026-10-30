"use strict";
/* meta-styles Milestone 22 — skill: Complete_the_look. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 *
 * Opus finding #12 fix: the gap suggestion is derived from the project's
 * own fit engine (app/assembler.js), never from ad-hoc hasScarf/hasBag
 * booleans. Flow: (1) if ALL active pieces assemble to valid:true, the
 * look is already complete — say so honestly instead of inventing a
 * redundant gap; (2) else if a valid subset exists (same validated-combo
 * logic propose_look's fallbackChoose uses), name that subset as the
 * already-complete look; (3) else try each single-piece addition in
 * cheapest-first order and suggest the first category that turns the
 * set valid:true; (4) else say honestly that one piece alone won't
 * finish it, quoting the engine's own reasons. Vendor-link behaviour is
 * unchanged: gap branches keep the generic Vinted search link (a category
 * search, never a listing); the already-complete branches link nothing
 * because there is nothing to browse for.
 *
 * Preview honesty: the preview image is only ever a real metaClient.preview
 * dataURL staged via the service-passed shareId + stageImage. When no
 * preview client exists, or preview/staging fails, image stays null and an
 * honest caveat is appended — never a fabricated URL.
 */
(function (root) {

  var VINTED="https://www.vinted.co.uk/search?q=";
  function vintedUrl(t){ return VINTED+encodeURIComponent(t); }
  function plainNoun(c){ var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag"}; return m[c]||c; }
  var CAVEAT=" (I can\u2019t tuck preview pictures into chat just yet, loveling, so picture this little treasure sparkling beside your other pieces for now. \u2728)";

  // Server-side assembler, in preference order: injected opt -> Node
  // require -> browser global. Same resolution order propose_look uses.
  function getAssembleLook(opts){
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

  // propose_look's validated-combo stack (finding #12 fix direction:
  // derive the gap from fallbackChoose/strictShape, don't invent a new
  // selection algorithm). Falls back to a local mirror when the sibling
  // module is unreachable (e.g. a browser global without require).
  function getPropose(){
    try {
      if (typeof require !== "undefined") return require("../propose_look/handler.js");
    } catch (e) { /* use local mirror below */ }
    try {
      if (root.MetaStyles && root.MetaStyles.skills && root.MetaStyles.skills.propose_look) {
        return root.MetaStyles.skills.propose_look;
      }
    } catch (e2) { /* none available */ }
    return null;
  }

  function toAssembleItems(active){
    return active.map(function (p) {
      return {
        id: p.piece_id, category: p.category,
        copy: { text: "SYNTH " + p.category, placeholder: true, note: "Complete_the_look validation input" }
      };
    });
  }

  function hypoItems(current, category){
    return current.concat([{
      id: "SYNTH_hypo_" + category, category: category,
      copy: { text: "SYNTH hypothetical " + category, placeholder: true, note: "Complete_the_look gap probe" }
    }]);
  }

  function tryAssemble(assembleLook, items){
    try {
      var card = assembleLook(items);
      if (card && card.valid === true) return card;
    } catch (e) { /* invalid on error */ }
    return null;
  }

  // Local mirror of propose_look's fallbackChoose (same base x finish
  // enumeration order: dresses, then top/bottom pairs, then singles;
  // layers before scarf+bag pairs), used only when the sibling module
  // cannot be required. Local strictness matches strictShape: no shoes,
  // no duplicate categories, never the whole wardrobe when it is large.
  function localFallback(active, assembleLook){
    var LAYERS = ["layer/cardigan", "layer/blazer"];
    function ofCat(cats){ return active.filter(function (p) { return cats.indexOf(p.category) !== -1; }); }
    var dresses = ofCat(["dress"]);
    var tops = ofCat(["base/top"]);
    var bottoms = ofCat(["base/bottom"]);
    var layers = ofCat(LAYERS);
    var scarves = ofCat(["scarf"]);
    var bags = ofCat(["bag"]);
    var baseOptions = [];
    dresses.forEach(function (d) { baseOptions.push([d]); });
    tops.forEach(function (t) { bottoms.forEach(function (b) { baseOptions.push([t, b]); }); });
    tops.forEach(function (t) { baseOptions.push([t]); });
    bottoms.forEach(function (b) { baseOptions.push([b]); });
    var finishOptions = [];
    layers.forEach(function (l) { finishOptions.push([l]); });
    scarves.forEach(function (s) { bags.forEach(function (b) { finishOptions.push([s, b]); }); });
    for (var bi = 0; bi < baseOptions.length; bi++) {
      for (var fi = 0; fi < finishOptions.length; fi++) {
        var combo = baseOptions[bi].concat(finishOptions[fi]);
        var seen = {};
        var dup = false;
        for (var k = 0; k < combo.length; k++) {
          var c = combo[k].category;
          if (c === "shoes" || /shoe/i.test(c)) { dup = true; break; }
          if (seen[c]) { dup = true; break; }
          seen[c] = true;
        }
        if (dup) continue;
        if (combo.length === active.length && active.length > 4) continue;
        var card = tryAssemble(assembleLook, toAssembleItems(combo));
        if (card) return { items: toAssembleItems(combo), card: card };
      }
    }
    return { items: null, card: null };
  }

  // Cheapest/single simplest addition first, steered by what's already
  // there so the suggestion answers the engine's own diagnosis: a missing
  // base wants a base (dresses first, fallbackChoose's base order); a lone
  // scarf wants its bag partner and vice versa; a missing finish wants a
  // layer before anything else — the same spirit as fallbackChoose's
  // finish order. Every candidate still has to turn the set valid:true.
  function gapOrderFor(active){
    var cats = active.map(function (p) { return p.category; });
    function has(c){ return cats.indexOf(c) !== -1; }
    var hasBase = has("base/top") || has("base/bottom") || has("dress");
    var nScarf = cats.filter(function (c) { return c === "scarf"; }).length;
    var nBag = cats.filter(function (c) { return c === "bag"; }).length;
    var order = [];
    function push(c){ if (order.indexOf(c) === -1) order.push(c); }
    if (!hasBase) { push("dress"); push("base/top"); push("base/bottom"); }
    if (nScarf >= 1 && nBag === 0) push("bag");
    if (nBag >= 1 && nScarf === 0) push("scarf");
    push("layer/cardigan"); push("layer/blazer");
    push("scarf"); push("bag");
    push("dress"); push("base/top"); push("base/bottom");
    return order;
  }
  var GAP_COPY = {
    "layer/cardigan": { term: "cream pointelle cardigan", advice: "A cropped cardigan worn open would give you that cosy fairycore finish, loveling \u2728" },
    "layer/blazer": { term: "cropped satin blazer", advice: "A little cropped blazer worn open would give you that Y2K shine while keeping the line long, darling \u2728" },
    "scarf": { term: "moss-green wool scarf", advice: "A soft, light-catching scarf would tie it all together, loveling \u2728" },
    "bag": { term: "silver metallic mini bag", advice: "A little silver bag would be the perfect finishing touch, darling \u2014 wear it high under the arm for that Y2K shine \u2728" },
    "base/top": { term: "ribbed knit cami top", advice: "A simple ribbed cami would give the look the soft base it\u2019s missing, loveling \u2728" },
    "base/bottom": { term: "high-rise satin midi skirt", advice: "A swishy high-rise skirt would ground the look into a proper base, darling \u2728" },
    "dress": { term: "champagne slip dress", advice: "A slinky slip dress would give the whole look its base in one go, loveling \u2728" }
  };

  async function handle(opts){
    var o=opts||{}, catalog=o.catalog;
    var metaClient=o.metaClient||null;
    var shareId=typeof o.shareId==="string"&&o.shareId?o.shareId:null;
    var stageImage=typeof o.stageImage==="function"?o.stageImage:null;
    var active=[];
    try { active = catalog ? catalog.getActivePieces() : []; } catch (e) { active = []; }
    if (!Array.isArray(active)) active = [];
    var assembleLook = getAssembleLook(o);

    // --- Fit-engine verdict (finding #12): what, if anything, is the gap?
    var state = "legacy"; // complete | complete_subset | gap | no_single_fix | empty | legacy
    var gapCat = null;
    var lookNouns = "";
    var engineWhy = "";
    if (active.length === 0) {
      state = "empty";
    } else if (typeof assembleLook !== "function") {
      state = "legacy";
    } else {
      var current = toAssembleItems(active);
      var whole = null;
      try { whole = assembleLook(current); } catch (e) { whole = null; }
      if (whole && whole.valid === true) {
        state = "complete";
        lookNouns = current.map(function (it) { return plainNoun(it.category); }).join(" + ");
      } else {
        if (whole && Array.isArray(whole.reasons) && whole.reasons.length > 0) {
          engineWhy = whole.reasons.join(" ");
        }
        var Propose = getPropose();
        var fb = null;
        try {
          if (Propose && typeof Propose.fallbackChoose === "function") {
            fb = Propose.fallbackChoose(active, assembleLook);
          } else {
            fb = localFallback(active, assembleLook);
          }
        } catch (e) { fb = null; }
        if (fb && fb.items) {
          state = "complete_subset";
          lookNouns = fb.items.map(function (it) { return plainNoun(it.category); }).join(" + ");
        } else {
          var order = gapOrderFor(active);
          for (var gi = 0; gi < order.length; gi++) {
            if (tryAssemble(assembleLook, hypoItems(current, order[gi]))) {
              gapCat = order[gi];
              break;
            }
          }
          state = gapCat ? "gap" : "no_single_fix";
        }
      }
    }
    // Legacy ad-hoc mapping, kept only for the engine-unreachable path
    // (in practice the in-repo assembler always resolves above).
    if (state === "legacy") {
      var hasScarf=active.some(function(p){ return p.category==="scarf"; }), hasBag=active.some(function(p){ return p.category==="bag"; });
      gapCat="scarf";
      if(hasScarf&&!hasBag){ gapCat="bag"; }
      else if(!active.some(function(p){ return p.category==="layer/cardigan"||p.category==="layer/blazer"; })&&!hasScarf&&!hasBag){ gapCat="layer/cardigan"; }
      state = "gap";
    }

    var reply, gapLabel, summaryDelta;
    if (state === "complete" || state === "complete_subset") {
      var whose = state === "complete"
        ? "your current pieces already make a complete look \u2014 " + lookNouns + " together pass the fit check \u2714"
        : "your " + lookNouns + " already make a complete look together (fit check: valid \u2714) \u2014 the rest sits this one out";
      reply = "Oh loveling \u2728 " + whose + " \u2014 so there\u2019s no gap to fill! Want me to suggest a *different* style direction instead of a gap piece? \u2728";
      gapLabel = lookNouns;
      summaryDelta = "Already a complete look; no gap suggested.";
    } else if (state === "gap") {
      var copy = GAP_COPY[gapCat] || GAP_COPY["scarf"];
      var gap = copy.term;
      reply = copy.advice + " If you\u2019d like to browse, here\u2019s a gentle starting point: " + vintedUrl(gap) + " \u2014 just a generic search, darling, buying stays entirely with you \u2728";
      gapLabel = gap;
      summaryDelta = "Suggested gap piece: " + gap + ".";
    } else if (state === "empty") {
      reply = "Your wardrobe\u2019s feeling a little empty just now, loveling \u2014 share a photo of something you love and I\u2019ll catalogue it, then we\u2019ll find its perfect partner! \u2728";
      gapLabel = "a finishing touch";
      summaryDelta = "Empty wardrobe; asked for a first piece.";
    } else {
      reply = "Oh loveling \u2728 I\u2019ve turned every piece over in the lamplight, and one new treasure alone wouldn\u2019t finish this look"
        + (engineWhy ? " \u2014 " + engineWhy : "")
        + ". If you share another piece or two, I\u2019ll find the combination that clicks! \u2728";
      gapLabel = "a finishing touch";
      summaryDelta = "No single-piece gap completes the look; said why honestly.";
    }

    var imageDelivery={ requested:false, generated:false, delivered:false, reason:"no_preview_client" };
    var img=null;
    var refThumb=null;
    for(var ti=0;ti<active.length&&ti<3;ti++){ var lp=active[ti]; if(lp&&typeof lp.photo_thumb==="string"&&/^data:image\//.test(lp.photo_thumb)){ refThumb=lp.photo_thumb; break; } }
    var have=active.slice(0,3).map(function(p){ return plainNoun(p.category); }).join(" + ");
    var previewPrompt="Y2K fairycore flat-lay look card, soft pastel background, garments laid out neatly: "+gapLabel+(have?" styled with "+have:"")+". No people, no worn try-on, no readable text.";
    if(refThumb) previewPrompt+=" Use the attached reference garment photo for the true colors and silhouette.";
    if(metaClient&&typeof metaClient.preview==="function"){
      imageDelivery.requested=true; imageDelivery.reason="preview_failed";
      try{
        var pr=await metaClient.preview(previewPrompt, refThumb||null);
        var durl=pr&&(pr.dataURL||pr.dataUrl||pr.data_url);
        if(typeof durl==="string"&&/^data:image\//.test(durl)){
          imageDelivery.generated=true;
          img={ dataURL:durl, caption: gapLabel+" \u2014 the finishing touch, styled with love" };
          if(shareId&&stageImage){
            var staged=null;
            try{ staged=await stageImage(shareId, durl); }catch(e){ staged=null; }
            if(staged&&staged.ok){ imageDelivery.delivered=true; imageDelivery.reason="staged for send with image"; }
            else imageDelivery.reason="stage_failed";
          } else imageDelivery.reason="text-only send; preview not staged for delivery";
        } else imageDelivery.reason="preview_unparseable";
      }catch(e){ imageDelivery.reason="preview_failed"; }
    }
    if(imageDelivery.requested&&!imageDelivery.delivered) reply+=CAVEAT;
    return { text: reply, image:img, persist:{ summaryDelta: summaryDelta, preferencesDelta:"" }, skill:"Complete_the_look", meta:{ imageDelivery: imageDelivery } };
  }

  var api = { handle: handle, skill: "Complete_the_look" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["Complete_the_look"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
