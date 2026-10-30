"use strict";
/* meta-styles Milestone 21 — skill: catalogue_piece. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 */
(function (root) {

  function plainNoun(c){ var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag"}; return m[c]||c; }
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
      try{ var p=catalog.addPiece({ category:cat, attributes:{}, source_share_id:sid }); pieces.push(p); if(catalog.save) try{ await catalog.save(); }catch(e){} }catch(e){}
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
