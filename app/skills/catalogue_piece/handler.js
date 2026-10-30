"use strict";
/* meta-styles Milestone 21 — skill: catalogue_piece. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 */
(function (root) {

  function plainNoun(c){ var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag"}; return m[c]||c; }

  // Photo-reference capture (M21 photo-reference work): shrink the inbound
  // photo to a small PNG data URL via photo-thumb.js makeSync() and store
  // it as the piece's photo_thumb. Fail-soft by contract: undecodable
  // input (or a missing thumb module) resolves null and the piece still
  // catalogues — the thumbnail must never block cataloguing.
  function captureThumb(imageDataUrl){
    try{
      var pt=null;
      try{ if(typeof require!=="undefined") pt=require("../../photo-thumb.js"); }catch(e){ pt=null; }
      if((!pt||typeof pt.makeSync!=="function")&&root.MetaStyles&&root.MetaStyles.photoThumb) pt=root.MetaStyles.photoThumb;
      if(!pt||typeof pt.makeSync!=="function"||!imageDataUrl) return null;
      var t=pt.makeSync(imageDataUrl);
      return (typeof t==="string"&&t)?t:null;
    }catch(e){ return null; }
  }

  async function handle(opts){
    var o=opts||{}, catalog=o.catalog, text=o.text||"", imageDataUrl=o.imageDataUrl||null;
    var pieces=[];
    if(catalog && imageDataUrl){
      var cat="dress";
      try{ if(o.metaClient&&o.metaClient.classify){ var cr=await o.metaClient.classify(imageDataUrl,""); if(cr&&cr.category) cat=cr.category; } }catch(e){}
      if(cat==="dress"){ var h=(text||"").toLowerCase(); if(/scarf/.test(h)) cat="scarf"; else if(/bag|purse/.test(h)) cat="bag"; else if(/blazer|jacket/.test(h)) cat="layer/blazer"; else if(/cardigan|shrug/.test(h)) cat="layer/cardigan"; else if(/top|cami/.test(h)) cat="base/top"; else if(/trouser|jean|skirt|bottom/.test(h)) cat="base/bottom"; }
      // Provenance pointer the wardrobe-service matches on restart replays:
      // the real share id when the turn carries one, so a collected share
      // (media deleted after the reply) is recognised as already answered.
      // SYNTH fallback only when no share context exists (unit tests).
      var sid=(o && typeof o.shareId==="string" && o.shareId) ? o.shareId : ("SYNTH_share_"+Date.now());
      var thumb=captureThumb(imageDataUrl);
      var input={ category:cat, attributes:{}, source_share_id:sid };
      if(thumb) input.photo_thumb=thumb;
      try{ var p=catalog.addPiece(input); pieces.push(p); if(catalog.save) try{ await catalog.save(); }catch(e){} }catch(e){
        // The thumbnail must never block cataloguing: retry bare.
        try{ var bare=catalog.addPiece({ category:cat, attributes:{}, source_share_id:sid }); pieces.push(bare); if(catalog.save) try{ await catalog.save(); }catch(e2){} }catch(e3){}
      }
    }
    var noun=pieces.length? plainNoun(pieces[0].category):"piece";
    return { text:"Got your "+noun+" \u2014 noted, loveling! \u2728 It's tucked safely in your wardrobe. Want me to put a look together from what you've got?", image:null, persist:{ summaryDelta:"Catalogued "+noun+".", preferencesDelta:"" }, skill:"catalogue_piece" };
  }

  var api = { handle: handle, skill: "catalogue_piece" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["catalogue_piece"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
