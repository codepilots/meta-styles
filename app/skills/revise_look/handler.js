"use strict";
/* meta-styles Milestone 21 — skill: revise_look. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 *
 * Preview honesty: the preview image is only ever a real metaClient.preview
 * dataURL staged via the service-passed shareId + stageImage. When no
 * preview client exists, or preview/staging fails, image stays null and an
 * honest caveat is appended — never a fabricated URL.
 */
(function (root) {

  var REVISE_WORDS=[{ re:/\bbag\b|purse|handbag/, category:"bag" },{ re:/\bscarf\b|wrap\b/, category:"scarf" },{ re:/\bblazer\b|jacket|coat/, category:"layer/blazer" },{ re:/\bcardigan\b|shrug|tie-blouse|blouse/, category:"layer/cardigan" },{ re:/\bdress\b|gown/, category:"dress" },{ re:/\btop\b|cami|camisole|tee/, category:"base/top" },{ re:/\bbottom\b|jeans|skirt|trousers|pants|mini/, category:"base/bottom" }];
  function matchRevise(t){ if(typeof t!=="string") return null; if(!/\b(no|drop|remove|without|lose|ditch|swap|skip)\b/i.test(t)) return null; for(var i=0;i<REVISE_WORDS.length;i++) if(REVISE_WORDS[i].re.test(t.toLowerCase())) return REVISE_WORDS[i].category; return null; }
  function plainNoun(c){ var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag"}; return m[c]||c; }

  // Pending expectation (Milestone 24): the "which piece would you like
  // to swap or skip?" fallback below is a "we are mid-flow, awaiting a
  // bare piece-name reply" moment. A one-word answer like "the scarf"
  // never matches matchRevise's verb rule, so without this the next turn
  // falls through to off_topic instead of continuing the revision.
  // Recorded on the catalog (the single source of truth
  // agentic-loop.js checks before routing). Never throws: a catalog
  // failure must not break the reply itself.
  var CLARIFY_TEXT="Tell me a little more, loveling \u2014 which piece would you like to swap or skip? \u2728";
  function recordTextExpectation(catalog){
    try{
      if(catalog && typeof catalog.askQuestion==="function"){
        catalog.askQuestion({ text:CLARIFY_TEXT, skill:"revise_look", expects:"text" });
      }
    }catch(e){}
  }
  var CAVEAT=" (I can\u2019t tuck preview pictures into chat just yet, so this word-picture will have to sparkle on its own. \u2728)";
  // Opus finding #6: record every turn (success AND clarification)
  // so explain_fit can reference the revised look via
  // catalog.getTurns(). Fail-closed-but-never-blocking: recording
  // must never break the user-facing reply. Verdict-false turns carry
  // a null proposal so explain_fit never reads one as a look.
  function recordReviseTurn(catalog, entry){
    if(!catalog || typeof catalog.recordTurn!=="function") return;
    try{ catalog.recordTurn(entry); }catch(e){}
  }
  function finishOfCats(cats){
    var hasLayer=cats.some(function(c){ return c==="layer/cardigan"||c==="layer/blazer"; });
    if(hasLayer) return "layer";
    if(cats.indexOf("scarf")!==-1 && cats.indexOf("bag")!==-1) return "scarf+bag";
    return null;
  }
  async function handle(opts){
    var o=opts||{}, catalog=o.catalog, text=o.text||"";
    var metaClient=o.metaClient||null;
    var shareId=typeof o.shareId==="string"&&o.shareId?o.shareId:null;
    var stageImage=typeof o.stageImage==="function"?o.stageImage:null;
    var cat=matchRevise(text), removed=[];
    if(cat&&catalog){ catalog.getActivePieces().filter(function(p){ return p.category===cat; }).forEach(function(p){ try{ catalog.rejectPiece(p.piece_id); removed.push(p); }catch(e){} }); if(catalog.save) try{ await catalog.save(); }catch(e){} }
    var MS=root.MetaStyles||{}, reply, img=null;
    var imageDelivery={ requested:false, generated:false, delivered:false, reason:"no_preview_client" };
    if(removed.length>0) reply="Got it, loveling \u2014 set aside your "+plainNoun(cat)+" for now \u2728 Let me re-weave the rest into something lovely.";
    else if(cat) reply="No "+plainNoun(cat)+" in the mix right now, darling \u2014 but I\u2019ll re-check the fit with what we\u2019ve got \u2728";
    else { reply=CLARIFY_TEXT; recordTextExpectation(catalog); }
    if(catalog&&MS.assembleLook&&catalog.getActivePieces().length>0){
      var active=catalog.getActivePieces();
      var items=active.map(function(p){ return { id:p.piece_id, category:p.category, copy:{ text:"SYNTH "+p.category, placeholder:true, note:"" } }; });
      var card=MS.assembleLook(items);
      var nouns=items.map(function(it){ return plainNoun(it.category); }).join(" + ");
      reply+=" Your "+nouns+" are looking darling together.";
      if(card.valid) reply+=" Fit check: valid \u2714";
      var refThumb=null;
      for(var ti=0;ti<active.length;ti++){ var lp=active[ti]; if(lp&&typeof lp.photo_thumb==="string"&&/^data:image\//.test(lp.photo_thumb)){ refThumb=lp.photo_thumb; break; } }
      var previewPrompt="Y2K fairycore flat-lay look card, soft pastel background, garments laid out neatly: "+nouns+". No people, no worn try-on, no readable text.";
      if(refThumb) previewPrompt+=" Use the attached reference garment photo for the true colors and silhouette.";
      if(metaClient&&typeof metaClient.preview==="function"){
        imageDelivery.requested=true; imageDelivery.reason="preview_failed";
        try{
          var pr=await metaClient.preview(previewPrompt, refThumb||null);
          var durl=pr&&(pr.dataURL||pr.dataUrl||pr.data_url);
          if(typeof durl==="string"&&/^data:image\//.test(durl)){
            imageDelivery.generated=true;
            img={ dataURL:durl, caption: nouns+" \u2014 styled with love" };
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
    } else imageDelivery.reason="no_valid_look";
    // Opus finding #6: remember the revised look (or the no-op) for
    // explain_fit / the router. The revised look is the wardrobe as it
    // stands after this turn's removal.
    var revisedActive=[];
    try{ revisedActive=catalog?catalog.getActivePieces():[]; }catch(e){ revisedActive=[]; }
    if(!Array.isArray(revisedActive)) revisedActive=[];
    var revisedCats=revisedActive.map(function(p){ return p && p.category; }).filter(function(c){ return !!c; });
    var revisedFinish=(card && card.valid===true && typeof card.finish==="string") ? card.finish : finishOfCats(revisedCats);
    // A clarification turn produces no revision, so it is never a
    // valid-look turn even though the reply quotes the current fit.
    var revisedVerdict=(cat && card) ? card.valid===true : false;
    var revisedReasons=[];
    if(!cat) revisedReasons.push("no_revision_target");
    else {
      if(removed.length===0) revisedReasons.push("category_not_present");
      if(!revisedVerdict) revisedReasons.push("no_valid_look");
    }
    recordReviseTurn(catalog, {
      userText: typeof text==="string" ? text : "",
      proposal: (revisedVerdict && (revisedFinish==="layer"||revisedFinish==="scarf+bag")) ? {
        pieces: revisedActive.map(function(p){ return p.piece_id; }),
        title: null, note: "valid:"+revisedFinish
      } : null,
      verdict: revisedVerdict, reasons: revisedReasons
    });
    return { text: reply, image: img, persist:{ summaryDelta: cat?"Revised look, removed "+plainNoun(cat)+".":"Asked for revise clarification.", preferencesDelta: cat? "Prefers without "+plainNoun(cat)+".":"" }, skill:"revise_look", meta:{ imageDelivery: imageDelivery } };
  }

  var api = { handle: handle, skill: "revise_look" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["revise_look"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
