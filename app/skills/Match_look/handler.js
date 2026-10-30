"use strict";
/* meta-styles Milestone 21 — skill: Match_look. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 *
 * Preview honesty: the preview image is only ever a real metaClient.preview
 * dataURL staged via the service-passed shareId + stageImage. When no
 * preview client exists, or preview/staging fails, image stays null and an
 * honest caveat is appended — never a fabricated URL.
 */
(function (root) {

  function plainNoun(c){ var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag"}; return m[c]||c; }
  var CAVEAT=" (I can\u2019t tuck preview pictures into chat just yet, so this word-picture will have to sparkle on its own. \u2728)";
  async function handle(opts){
    var o=opts||{}, catalog=o.catalog, imageDataUrl=o.imageDataUrl||null;
    var metaClient=o.metaClient||null;
    var shareId=typeof o.shareId==="string"&&o.shareId?o.shareId:null;
    var stageImage=typeof o.stageImage==="function"?o.stageImage:null;
    var active=catalog? catalog.getActivePieces():[];
    var imageDelivery={ requested:false, generated:false, delivered:false, reason:"no_preview_client" };
    var desc="I see soft Y2K x fairycore vibes, loveling \u2014 lovely layering, shimmer and gentle colour. \u2728";
    if(metaClient&&imageDataUrl) try{ var r=await metaClient.classify(imageDataUrl,"inspiration"); if(r&&r.category) desc="I see a beautiful "+plainNoun(r.category)+" moment, loveling \u2014 soft layers and shimmer with a Y2K twist \u2728"; }catch(e){}
    if(active.length===0) return { text: desc+" Your wardrobe\u2019s empty just now, so I can\u2019t match it yet \u2014 share a few pieces and I\u2019ll find the closest cousins!", image:null, persist:{ summaryDelta:"Match_look: no wardrobe to match.", preferencesDelta:"" }, skill:"Match_look", imageDelivery:{ requested:false, generated:false, delivered:false, reason:"no_valid_look" } };
    var nouns=active.slice(0,3).map(function(p){ return plainNoun(p.category); }).join(" + ");
    var reply=desc+" From your own wardrobe, your "+nouns+" come closest, darling \u2014 let\u2019s style them together for a similar feel! \u2728";
    var img=null;
    var refThumb=null;
    for(var ti=0;ti<active.length&&ti<3;ti++){ var lp=active[ti]; if(lp&&typeof lp.photo_thumb==="string"&&/^data:image\//.test(lp.photo_thumb)){ refThumb=lp.photo_thumb; break; } }
    var previewPrompt="Y2K fairycore flat-lay look card, soft pastel background, garments laid out neatly: "+nouns+". No people, no worn try-on, no readable text.";
    if(refThumb) previewPrompt+=" Use the attached reference garment photo for the true colors and silhouette.";
    if(metaClient&&typeof metaClient.preview==="function"){
      imageDelivery.requested=true; imageDelivery.reason="preview_failed";
      try{
        var pr=await metaClient.preview(previewPrompt, refThumb||null);
        var durl=pr&&(pr.dataURL||pr.dataUrl||pr.data_url);
        if(typeof durl==="string"&&/^data:image\//.test(durl)){
          imageDelivery.generated=true;
          img={ dataURL:durl, caption: nouns+" \u2014 inspired match, styled with love" };
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
    return { text: reply, image:img, persist:{ summaryDelta:"Matched look from wardrobe.", preferencesDelta:"" }, skill:"Match_look", imageDelivery: imageDelivery };
  }

  var api = { handle: handle, skill: "Match_look" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["Match_look"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
