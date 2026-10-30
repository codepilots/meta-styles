"use strict";
/* meta-styles Milestone 21 — skill: revise_look. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 *
 * Opus finding #7 fix: a same-turn revision ("no bag this time") must NEVER
 * call catalog.rejectPiece — rejection is terminal (nothing reactivates a
 * rejected piece) and the wardrobe IS the product, so the old loop was
 * unrecoverable data loss. The excluded category now lives in a local
 * variable for the duration of this call only; the catalog is never
 * mutated and never saved from this skill.
 *
 * The re-woven look is picked by propose_look's own selection stack
 * (fallbackChoose over the reduced candidate set), so a valid look is
 * always a base plus exactly one finish (at most 4 pieces) — never the
 * whole remaining wardrobe. When nothing validates, the reply says so
 * honestly (propose_look's plainWhy copy pattern), never a fabricated
 * "looking darling together".
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

  // Shared selection stack: required in Node, or read off the browser
  // global (skills index loads propose_look before revise_look). The fit
  // rules live in exactly one place — never reimplemented here.
  var ProposeStack = null;
  try {
    if (typeof require !== "undefined") ProposeStack = require("../propose_look/handler.js");
  } catch (e) { ProposeStack = null; }
  function proposeStack(){
    if (ProposeStack && typeof ProposeStack.fallbackChoose === "function") return ProposeStack;
    try {
      var sk = root.MetaStyles && root.MetaStyles.skills && root.MetaStyles.skills["propose_look"];
      if (sk && typeof sk.fallbackChoose === "function") return sk;
    } catch (e) {}
    return null;
  }

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
  function finishOfItems(items, card){
    if(card && (card.finish==="layer"||card.finish==="scarf+bag")) return card.finish;
    var hasLayer=items.some(function(it){ return it.category==="layer/cardigan"||it.category==="layer/blazer"; });
    return hasLayer ? "layer" : "scarf+bag";
  }
  function plainWhy(stack, reason){
    if(stack && typeof stack.plainWhy==="function") return stack.plainWhy(reason);
    return "it didn't pass the fit rules";
  }
  async function handle(opts){
    var o=opts||{}, catalog=o.catalog, text=o.text||"";
    var metaClient=o.metaClient||null;
    var shareId=typeof o.shareId==="string"&&o.shareId?o.shareId:null;
    var stageImage=typeof o.stageImage==="function"?o.stageImage:null;
    var imageDelivery={ requested:false, generated:false, delivered:false, reason:"no_preview_client" };
    var cat=matchRevise(text);

    // Ambiguous / no revision target: clarification path (unchanged).
    if(!cat){
      recordTextExpectation(catalog);
      recordReviseTurn(catalog, {
        userText: typeof text==="string" ? text : "",
        proposal: null, verdict: false, reasons: ["no_revision_target"]
      });
      imageDelivery.reason="no_valid_look";
      return { text: CLARIFY_TEXT, image: null, persist:{ summaryDelta: "Asked for revise clarification.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: imageDelivery } };
    }

    // Per-turn exclusion only (Opus finding #7): the catalog is never
    // mutated here — no rejectPiece, no save. Candidates are the live
    // wardrobe minus this turn's excluded category.
    var active=[];
    try{ active=catalog?catalog.getActivePieces():[]; }catch(e){ active=[]; }
    if(!Array.isArray(active)) active=[];
    var excluded=active.filter(function(p){ return p && p.category===cat; });
    var candidates=active.filter(function(p){ return p && p.category!==cat; });

    // Re-select one real 2-4 piece look from the reduced set, using
    // propose_look's own selection stack over that smaller pool.
    var stack=proposeStack(), assembleLook=null;
    try{ assembleLook=stack ? stack.getAssembleLook(o) : null; }catch(e){ assembleLook=null; }
    if(!assembleLook){
      try{
        if(root.MetaStyles && typeof root.MetaStyles.assembleLook==="function") assembleLook=root.MetaStyles.assembleLook;
      }catch(e2){}
    }
    var chosen=null, card=null, rejected=null;
    if(stack && typeof stack.fallbackChoose==="function"){
      var fb=null;
      try{ fb=stack.fallbackChoose(candidates, assembleLook); }catch(e){ fb=null; }
      if(fb && fb.items){ chosen=fb.items; card=fb.card; }
      else rejected=(fb && fb.rejected) || "no_valid_combination";
    } else {
      rejected="no_selection_stack";
    }

    var reply, img=null;
    if(chosen){
      var nouns=chosen.map(function(it){ return plainNoun(it.category); }).join(" + ");
      if(excluded.length>0) reply="Got it, loveling \u2014 set aside your "+plainNoun(cat)+" for now \u2728 Let me re-weave the rest into something lovely.";
      else reply="No "+plainNoun(cat)+" in the mix right now, darling \u2014 but I\u2019ll re-check the fit with what we\u2019ve got \u2728";
      reply+=" Your "+nouns+" are looking darling together.";
      if(card && card.valid===true) reply+=" Fit check: valid \u2714";
      // Preview prompt names the actual chosen look only.
      var byId={};
      candidates.forEach(function(p){ byId[p.piece_id]=p; });
      var refThumb=null;
      for(var ti=0;ti<chosen.length;ti++){ var lp=byId[chosen[ti].id]; if(lp&&typeof lp.photo_thumb==="string"&&/^data:image\//.test(lp.photo_thumb)){ refThumb=lp.photo_thumb; break; } }
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
    } else {
      // Honest no-valid-look: name the reason, never a fabricated look.
      var why=plainWhy(stack, rejected||"no_valid_combination");
      if(excluded.length>0) reply="Got it, loveling \u2014 set aside your "+plainNoun(cat)+" for now \u2728 I turned every piece over in the lamplight, but "+why+" \u2014 share one more piece (a layer, or a scarf with its bag) and I\u2019ll spin it into a full look!";
      else reply="No "+plainNoun(cat)+" in the mix right now, darling \u2014 I turned every piece over in the lamplight, but "+why+" \u2014 share one more piece (a layer, or a scarf with its bag) and I\u2019ll spin it into a full look!";
      imageDelivery.reason="no_valid_look";
    }
    // Opus finding #6: remember the actual revised look (or the honest
    // no-op) for explain_fit / the router — the chosen 2-4 piece look,
    // never the whole wardrobe.
    var revisedVerdict=!!chosen;
    var revisedFinish=chosen ? finishOfItems(chosen, card) : null;
    var revisedReasons=[];
    if(excluded.length===0) revisedReasons.push("category_not_present");
    if(!revisedVerdict) revisedReasons.push(rejected ? ("fallback_rejected:"+rejected) : "no_valid_look");
    recordReviseTurn(catalog, {
      userText: typeof text==="string" ? text : "",
      proposal: (revisedVerdict && (revisedFinish==="layer"||revisedFinish==="scarf+bag")) ? {
        pieces: chosen.map(function(it){ return it.id; }),
        title: null, note: "valid:"+revisedFinish
      } : null,
      verdict: revisedVerdict, reasons: revisedReasons
    });
    return { text: reply, image: img, persist:{ summaryDelta: cat?(chosen?"Revised look, removed "+plainNoun(cat)+".":"Tried revising without "+plainNoun(cat)+"; no valid look yet."):"Asked for revise clarification.", preferencesDelta: cat? "Prefers without "+plainNoun(cat)+".":"" }, skill:"revise_look", meta:{ imageDelivery: imageDelivery } };
  }

  var api = { handle: handle, skill: "revise_look" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["revise_look"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
