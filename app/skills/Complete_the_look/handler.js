"use strict";
/* meta-styles Milestone 22 — skill: Complete_the_look. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
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
  async function handle(opts){
    var o=opts||{}, catalog=o.catalog;
    var metaClient=o.metaClient||null;
    var shareId=typeof o.shareId==="string"&&o.shareId?o.shareId:null;
    var stageImage=typeof o.stageImage==="function"?o.stageImage:null;
    var active=catalog? catalog.getActivePieces():[];
    var hasScarf=active.some(function(p){ return p.category==="scarf"; }), hasBag=active.some(function(p){ return p.category==="bag"; });
    var gap="moss-green wool scarf", advice="A soft, light-catching scarf would tie it all together, loveling \u2728";
    if(hasScarf&&!hasBag){ gap="silver metallic mini bag"; advice="A little silver bag would be the perfect finishing touch, darling \u2014 wear it high under the arm for that Y2K shine \u2728"; }
    else if(!active.some(function(p){ return p.category==="layer/cardigan"||p.category==="layer/blazer"; })&&!hasScarf&&!hasBag){ gap="cream pointelle cardigan"; advice="A cropped cardigan worn open would give you that cosy fairycore finish, loveling \u2728"; }
    var reply=advice+" If you\u2019d like to browse, here\u2019s a gentle starting point: "+vintedUrl(gap)+" \u2014 just a generic search, darling, buying stays entirely with you \u2728";
    var imageDelivery={ requested:false, generated:false, delivered:false, reason:"no_preview_client" };
    var img=null;
    var refThumb=null;
    for(var ti=0;ti<active.length&&ti<3;ti++){ var lp=active[ti]; if(lp&&typeof lp.photo_thumb==="string"&&/^data:image\//.test(lp.photo_thumb)){ refThumb=lp.photo_thumb; break; } }
    var have=active.slice(0,3).map(function(p){ return plainNoun(p.category); }).join(" + ");
    var previewPrompt="Y2K fairycore flat-lay look card, soft pastel background, garments laid out neatly: "+gap+(have?" styled with "+have:"")+". No people, no worn try-on, no readable text.";
    if(refThumb) previewPrompt+=" Use the attached reference garment photo for the true colors and silhouette.";
    if(metaClient&&typeof metaClient.preview==="function"){
      imageDelivery.requested=true; imageDelivery.reason="preview_failed";
      try{
        var pr=await metaClient.preview(previewPrompt, refThumb||null);
        var durl=pr&&(pr.dataURL||pr.dataUrl||pr.data_url);
        if(typeof durl==="string"&&/^data:image\//.test(durl)){
          imageDelivery.generated=true;
          img={ dataURL:durl, caption: gap+" \u2014 the finishing touch, styled with love" };
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
    return { text: reply, image:img, persist:{ summaryDelta:"Suggested gap piece: "+gap+".", preferencesDelta:"" }, skill:"Complete_the_look", meta:{ imageDelivery: imageDelivery } };
  }

  var api = { handle: handle, skill: "Complete_the_look" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["Complete_the_look"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
