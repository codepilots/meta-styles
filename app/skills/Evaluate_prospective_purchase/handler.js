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

  function outfitsFor(active){
    var nouns = active.slice(0, 2).map(function(p){ return plainNoun(p.category); }).join(" and ");
    return [
      "1. With your " + nouns + " — soft base, new piece as the finish",
      "2. With your " + plainNoun(active[0].category) + " — let the new piece do the talking",
      "3. Layered open over what you\u2019ve got — long line, fairycore shimmer"
    ];
  }

  async function handle(opts){
    var o = opts || {}, catalog = o.catalog, text = o.text || "";
    var imageDataUrl = o.imageDataUrl || null;
    var nowMs = Date.now();

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
    var active = catalog ? catalog.getActivePieces() : [];
    var holdOk = false;
    if(catalog){
      try{
        var cat = await sniffCategory(o, text, imageDataUrl);
        var sid = (o && typeof o.shareId === "string" && o.shareId) ? o.shareId : ("SYNTH_share_" + Date.now());
        catalog.addPiece({
          category: cat,
          attributes: {},
          source_share_id: sid,
          status: "held",
          held_until: new Date(nowMs + HOLD_MS).toISOString()
        });
        if(catalog.save){ try{ await catalog.save(); }catch(e){} }
        holdOk = true;
      }catch(e){ holdOk = false; }
    }
    if(!holdOk){
      var tail = "";
      if(active.length > 0){
        var outfits = outfitsFor(active);
        tail = " From what you\u2019ve got, this could unlock " + outfits.length + " lovely outfits:\n" + outfits.join("\n") + "\n\n";
      }
      return { text: "Ooh, let\u2019s have a look, loveling \u2728" + tail + "But I couldn\u2019t quite tuck this one away safely, so no promises on the hold, loveling! Tell me if you bring it home and I\u2019ll catalogue it properly. \u2728", image: null, persist: { summaryDelta: "Evaluated prospective purchase (hold not stored).", preferencesDelta: "" }, skill: "Evaluate_prospective_purchase" };
    }
    var intro = "Ooh, let\u2019s have a look, loveling \u2728 I\u2019ll hold this one just for 24 hours while you decide \u2014 text first, preview only if you\u2019d like it.";
    if(active.length === 0){
      var emptyReply = intro + " Your wardrobe\u2019s empty just now, so I can\u2019t cross-check \u2014 but it looks like a darling piece on its own! Share a couple of wardrobe photos and I can show you how it would mix and match. (24hr hold, then I discard it unless you say you bought it \u2728)";
      recordPurchaseExpectation(catalog, emptyReply);
      return { text: emptyReply, image: null, persist: { summaryDelta: "Evaluated prospective purchase (empty wardrobe).", preferencesDelta: "" }, skill: "Evaluate_prospective_purchase" };
    }
    var outfits2 = outfitsFor(active);
    var outfitsReply = intro + " From what you\u2019ve got, this could unlock " + outfits2.length + " lovely outfits:\n" + outfits2.join("\n") + "\n\nIt\u2019s held for 24 hours, darling \u2014 say \u201CI bought it\u201D to catalogue it properly, or I\u2019ll gently let it go. Want a preview image too? \u2728";
    recordPurchaseExpectation(catalog, outfitsReply);
    return { text: outfitsReply, image: null, persist: { summaryDelta: "Evaluated prospective purchase: " + outfits2.length + " outfits.", preferencesDelta: "" }, skill: "Evaluate_prospective_purchase" };
  }

  var api = { handle: handle, skill: "Evaluate_prospective_purchase" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["Evaluate_prospective_purchase"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
