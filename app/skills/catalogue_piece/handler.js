"use strict";
/* meta-styles Milestone 21 — skill: catalogue_piece. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 */
(function (root) {

  function plainNoun(c){ var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag"}; return m[c]||c; }

  // Photo-reference capture (M21 photo-reference work): shrink the inbound
  // photo to a small PNG data URL via photo-thumb.js makeSync() and store
  // it as the piece's photo_thumb. When a SAM box rect is supplied, the
  // decoded pixels are cropped to the garment's bounding box BEFORE
  // downscaling, so the thumb shows the garment instead of the whole
  // photo. Fail-soft by contract: undecodable input (or a missing thumb
  // module) resolves null and the piece still catalogues — the thumbnail
  // must never block cataloguing.
  function captureThumb(imageDataUrl, cropRect){
    try{
      var pt=null;
      try{ if(typeof require!=="undefined") pt=require("../../photo-thumb.js"); }catch(e){ pt=null; }
      if((!pt||typeof pt.makeSync!=="function")&&root.MetaStyles&&root.MetaStyles.photoThumb) pt=root.MetaStyles.photoThumb;
      if(!pt||typeof pt.makeSync!=="function"||!imageDataUrl) return null;
      var t=cropRect?pt.makeSync(imageDataUrl,cropRect):pt.makeSync(imageDataUrl);
      return (typeof t==="string"&&t)?t:null;
    }catch(e){ return null; }
  }

  // SAM box picker: the highest-confidence usable box wins; when no box
  // carries a numeric confidence the first usable box wins. A rect is
  // usable when it is [x,y,w,h] fractions with positive area overlapping
  // the unit square (the proxy's parseSamOutput already normalizes to
  // fractions; mask is metadata-only, so boxes are the only croppable
  // shape).
  function validRect(r){
    if(!Array.isArray(r)||r.length!==4) return false;
    for(var i=0;i<4;i++){ if(typeof r[i]!=="number"||!isFinite(r[i])) return false; }
    if(r[2]<=0||r[3]<=0) return false;
    var x1=Math.min(1,r[0]+r[2]), y1=Math.min(1,r[1]+r[3]);
    return x1>Math.max(0,r[0])&&y1>Math.max(0,r[1]);
  }
  function pickBox(boxes){
    if(!Array.isArray(boxes)||!boxes.length) return null;
    var best=null, bestConf=null;
    for(var i=0;i<boxes.length;i++){
      var b=boxes[i];
      if(!b||!validRect(b.rect)) continue;
      var c=(typeof b.confidence==="number"&&isFinite(b.confidence))?b.confidence:null;
      if(!best){ best=b; bestConf=c; }
      else if(c!==null&&(bestConf===null||c>bestConf)){ best=b; bestConf=c; }
    }
    return best;
  }

  // SAM segmentation for the crop step: same call pattern as classify
  // (o.metaClient.segment, awaited, optional). Resolves the winning box
  // rect or null — a throw, a timeout, and unusable outputs all fall back
  // to the whole-photo thumbnail; never throws up to handle().
  async function segmentRect(imageDataUrl, metaClient, phrase){
    try{
      if(!metaClient||typeof metaClient.segment!=="function"||!imageDataUrl) return null;
      var out=await metaClient.segment(imageDataUrl,[phrase]);
      if(!out||!Array.isArray(out.boxes)) return null;
      var b=pickBox(out.boxes);
      return b?b.rect:null;
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
      // SAM-segment the crop: phrase names the detected category (plain
      // noun the proxy's SAM_LABEL_MAP understands), falling back to a
      // generic garment phrase. Any failure resolves null and the thumb
      // below is the whole photo, exactly as before this change.
      var phrase=plainNoun(cat)||"garment";
      if(typeof phrase!=="string"||!phrase) phrase="garment";
      var rect=await segmentRect(imageDataUrl,o.metaClient,phrase);
      var thumb=captureThumb(imageDataUrl,rect);
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
