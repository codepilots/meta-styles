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
  // ADD/INCLUDE support: same category-noun set as matchRevise (never
  // duplicated/diverged), scanned over the FULL text independently so a
  // both-match turn ("swap the cardigan for the blazer") finds its own
  // add-target instead of reusing matchRevise's already-consumed match.
  // "swap X for [the|my] Y" names Y as the add-target even with no add
  // verb, so the for-phrase is checked first; otherwise an add verb must
  // be present and the first-mentioned category in the text wins.
  var ADD_VERB_RE=/\b(add|adds|added|adding|include|includes|included|including|bring\s+back|put\s+back|plus|with\s+(the|my))\b/i;
  var WEAR_TOO_RE=/\bwear\b[\s\S]{0,30}\btoo\b/i;
  var BASE_CATS=["base/top", "base/bottom", "dress"];
  var FINISH_CATS=["layer/cardigan", "layer/blazer", "scarf", "bag"];
  function matchAdd(t){
    if(typeof t!=="string") return null;
    var low=t.toLowerCase();
    var hasSwapVerb=/\b(swap|switch|change|exchange|trade|replace|instead)\b/i.test(t);
    var forM=/\bfor\s+(?:(?:the|my|that|this)\s+)?/.exec(t);
    if(forM && (hasSwapVerb || ADD_VERB_RE.test(t) || WEAR_TOO_RE.test(t))){
      var after=t.slice(forM.index+forM[0].length);
      for(var fi=0;fi<REVISE_WORDS.length;fi++){
        var anchored=null;
        try{ anchored=new RegExp("^(?:"+REVISE_WORDS[fi].re.source+")","i"); }catch(e){ anchored=null; }
        if(anchored && anchored.test(after)) return REVISE_WORDS[fi].category;
      }
    }
    if(!ADD_VERB_RE.test(t) && !WEAR_TOO_RE.test(t)) return null;
    var best=null, bestIdx=-1;
    for(var i=0;i<REVISE_WORDS.length;i++){
      var m=REVISE_WORDS[i].re.exec(low);
      if(m && (bestIdx===-1 || m.index<bestIdx)){ bestIdx=m.index; best=REVISE_WORDS[i].category; }
    }
    return best;
  }
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
  // to swap, skip, or add back?" fallback below is a "we are mid-flow, awaiting a
  // bare piece-name reply" moment. A one-word answer like "the scarf"
  // never matches matchRevise's verb rule, so without this the next turn
  // falls through to off_topic instead of continuing the revision.
  // Recorded on the catalog (the single source of truth
  // agentic-loop.js checks before routing). Never throws: a catalog
  // failure must not break the reply itself.
  var CLARIFY_TEXT="Tell me a little more, loveling \u2014 which piece would you like to swap, skip, or add back? \u2728";
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
  // Most recent valid proposal on record (the look a bare "show me
  // wearing it" refers to). verdict is stored boolean; proposal.pieces
  // are piece ids in selection order.
  function lastValidProposal(catalog){
    try{
      var turns=catalog&&typeof catalog.getTurns==="function"?catalog.getTurns():[];
      for(var i=turns.length-1;i>=0;i--){
        var t=turns[i];
        if(t&&t.verdict===true&&t.proposal&&Array.isArray(t.proposal.pieces)&&t.proposal.pieces.length>0){
          return t.proposal.pieces.slice();
        }
      }
    }catch(e){}
    return null;
  }

  // Render-on-user follow-up: render the most recent valid proposal on
  // the wearer. The look re-validates through propose_look's own stack
  // (categories are immutable per piece, so a once-valid look stays
  // valid); profile consent + both references gate the preview exactly
  // like propose_look's fresh-render path. Never a flat-lay here.
  async function handleRenderFollowup(o){
    var catalog=o.catalog, stack=o.stack, text=o.text||"";
    var metaClient=o.metaClient||null;
    var shareId=o.shareId||null, stageImage=o.stageImage||null;
    var assembleLook=o.assembleLook||null;
    var pieceIds=lastValidProposal(catalog);
    if(!pieceIds){
      recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["no_prior_look"] });
      return { text: "No saved look to render just yet, loveling \u2728 \u2014 ask me to put a look together first, then say \u201Cshow me wearing it\u201D and I\u2019ll picture it on you.", image: null, persist:{ summaryDelta: "Render follow-up with no prior look.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: { requested:false, generated:false, delivered:false, reason:"no_prior_look" }, renderOnUser: false } };
    }
    var active=[];
    try{ active=catalog?catalog.getActivePieces():[]; }catch(e){ active=[]; }
    if(!Array.isArray(active)) active=[];
    var checked=null;
    try{
      if(stack&&typeof stack.validateSelection==="function") checked=stack.validateSelection(active, pieceIds, assembleLook);
    }catch(e){ checked=null; }
    if(!checked||!checked.ok){
      recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["prior_look_changed"] });
      return { text: "That saved look\u2019s pieces have changed since I wove it, loveling \u2728 \u2014 ask me to put a fresh look together and I\u2019ll render that one on you instead.", image: null, persist:{ summaryDelta: "Saved look no longer valid; offered a fresh one.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: { requested:false, generated:false, delivered:false, reason:"prior_look_changed" }, renderOnUser: false } };
    }
    try{ await stack.ensureProfileLoaded(catalog); }catch(e){}
    var prof=stack.safeGetProfile(catalog);
    if(!prof.consent){
      try{ stack.recordConsentExpectation(catalog, "revise_look", stack.PROFILE_CONSENT_TEXT); }catch(e){}
      recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["profile_consent_pending"] });
      return { text: stack.PROFILE_CONSENT_TEXT, image: null, persist:{ summaryDelta: "Asked for profile-photo consent.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: stack.noPreviewDelivery("profile_consent_pending"), renderOnUser: false } };
    }
    var missing=stack.missingProfileTypes(prof);
    if(missing.length>0){
      var ask=stack.profileAskText(missing);
      try{ stack.recordProfileImageExpectation(catalog, "revise_look", ask); }catch(e){}
      recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["profile_refs_pending:"+missing.join(",")] });
      return { text: ask, image: null, persist:{ summaryDelta: "Asked for missing profile refs: "+missing.join(", ")+".", preferencesDelta: "" }, skill:"revise_look", meta:{ profileMissing: missing, imageDelivery: stack.noPreviewDelivery("profile_refs_pending"), renderOnUser: false } };
    }
    var gar=stack.buildGarmentRefUrls(active, checked.items);
    var nouns=checked.items.map(function(it){ return plainNoun(it.category); }).join(" + ");
    var prefsText=typeof o.preferences==="string"?o.preferences:"";
    var rctx=(text+(prefsText?". "+prefsText:"")).slice(0,300);
    if(!rctx.trim()) rctx="";
    var onUser=await stack.requestOnUserPreview({
      metaClient: metaClient, headshot: prof.headshot, fullBody: prof.full_body,
      garmentRefs: gar.urls, garmentTotal: checked.items.length,
      nouns: nouns, context: rctx, shareId: shareId, stageImage: stageImage, toolSteps: 0
    });
    var reply="Oh, here you are wearing it, darling \u2728 \u2014 your "+nouns+" together. Fit check: valid \u2714 Rendered on you from your saved photos \u2728.";
    if(onUser.imageDelivery.requested&&!onUser.imageDelivery.delivered) reply+=CAVEAT;
    recordReviseTurn(catalog, {
      userText: typeof text==="string"?text:"",
      proposal: { pieces: checked.items.map(function(it){ return it.id; }), title: null, note: "render_on_user" },
      verdict: true, reasons: ["render_on_user"]
    });
    return { text: reply, image: onUser.image, persist:{ summaryDelta: "Rendered saved look on wearer: "+nouns+".", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: onUser.imageDelivery, renderOnUser: true, profileRefs: onUser.meta.profileRefs, referencePieces: onUser.meta.referencePieces, referenceGarmentTotal: onUser.meta.referenceGarmentTotal, referenceDowngraded: onUser.meta.referenceDowngraded, referencePayloadBytes: onUser.meta.referencePayloadBytes, previewPrompt: onUser.meta.previewPrompt } };
  }

  async function handle(opts){
    var o=opts||{}, catalog=o.catalog, text=o.text||"";
    var metaClient=o.metaClient||null;
    var shareId=typeof o.shareId==="string"&&o.shareId?o.shareId:null;
    var stageImage=typeof o.stageImage==="function"?o.stageImage:null;
    var imageDelivery={ requested:false, generated:false, delivered:false, reason:"no_preview_client" };
    // Shared profile flow (selection stack + render-on-user helpers live
    // in propose_look; fail-closed when unavailable — no render, no
    // intake, ordinary revise behaviour only).
    var stackForProfile=proposeStack();
    var hasProfileStack=!!(stackForProfile&&typeof stackForProfile.isRenderIntent==="function");
    var renderIntent=hasProfileStack?stackForProfile.isRenderIntent(o,text)===true:false;
    var imageDataUrl=typeof o.imageDataUrl==="string"?o.imageDataUrl:null;
    var pendingSatisfied=o.pendingSatisfied&&typeof o.pendingSatisfied==="object"?o.pendingSatisfied:null;
    if(hasProfileStack&&stackForProfile.isDeletePhotos(o,text)===true){
      return await stackForProfile.handleDeletePhotos({ catalog: catalog, skill: "revise_look" });
    }
    // A photo arriving while a profile_image expectation pends is a
    // wearer reference, never a wardrobe piece. Completion renders the
    // most recent valid proposal in the same turn.
    if(hasProfileStack&&imageDataUrl&&pendingSatisfied&&pendingSatisfied.expects==="profile_image"){
      var intake=await stackForProfile.handleProfileIntake({ catalog: catalog, skill: "revise_look", imageDataUrl: imageDataUrl, text: text });
      if(!intake.complete){
        recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: [intake.reply&&intake.reply.meta&&intake.reply.meta.profileAction==="consent_asked"?"profile_consent_pending":"profile_refs_pending"] });
        return intake.reply;
      }
      var followAsm=null;
      try{ followAsm=stackForProfile.getAssembleLook(o); }catch(e){ followAsm=null; }
      if(!followAsm){
        try{ if(root.MetaStyles&&typeof root.MetaStyles.assembleLook==="function") followAsm=root.MetaStyles.assembleLook; }catch(e2){}
      }
      return await handleRenderFollowup({ catalog: catalog, stack: stackForProfile, text: text, metaClient: metaClient, shareId: shareId, stageImage: stageImage, assembleLook: followAsm, preferences: o.preferences });
    }
    // Consent "yes" routed back here: grant, persist, ask for headshot.
    // An attached photo counts as the first upload — stored inline and,
    // when it completes the set, rendered in the same turn.
    if(hasProfileStack&&!renderIntent&&pendingSatisfied&&pendingSatisfied.expects==="yes_no"&&pendingSatisfied.text===stackForProfile.PROFILE_CONSENT_TEXT){
      try{ await stackForProfile.ensureProfileLoaded(catalog); }catch(e){}
      var consentNow=stackForProfile.safeGetProfile(catalog);
      if(!consentNow.consent){
        try{ if(catalog&&typeof catalog.setProfileConsent==="function") catalog.setProfileConsent(true); }catch(e2){}
        var granted2=stackForProfile.safeGetProfile(catalog);
        if(granted2.consent){
          try{ await stackForProfile.saveProfileBestEffort(catalog); }catch(e3){}
          if(imageDataUrl&&/^data:image\//.test(imageDataUrl)){
            var grantIntake2=await stackForProfile.handleProfileIntake({ catalog: catalog, skill: "revise_look", imageDataUrl: imageDataUrl, text: text });
            if(!grantIntake2.complete){
              recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["profile_refs_pending"] });
              return grantIntake2.reply;
            }
            var grantAsm=null;
            try{ grantAsm=stackForProfile.getAssembleLook(o); }catch(e5){ grantAsm=null; }
            if(!grantAsm){
              try{ if(root.MetaStyles&&typeof root.MetaStyles.assembleLook==="function") grantAsm=root.MetaStyles.assembleLook; }catch(e6){}
            }
            return await handleRenderFollowup({ catalog: catalog, stack: stackForProfile, text: text, metaClient: metaClient, shareId: shareId, stageImage: stageImage, assembleLook: grantAsm, preferences: o.preferences });
          }
          var grantAsk2=stackForProfile.profileAskText(["headshot","full_body"]);
          try{ stackForProfile.recordProfileImageExpectation(catalog, "revise_look", grantAsk2); }catch(e4){}
          recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["profile_consent_granted"] });
          return { text: "Wonderful, darling \u2728 \u2014 your photos will stay encrypted and are only ever used to render your looks on you. "+grantAsk2, image: null, persist:{ summaryDelta: "Profile consent granted; asked for headshot.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: stackForProfile.noPreviewDelivery("profile_refs_pending"), renderOnUser: false } };
        }
      }
    }
    var cat=matchRevise(text);
    var required=matchAdd(text);
    // Both-match collision: matchRevise scans REVISE_WORDS order (not
    // text order), so "swap the cardigan for the blazer" lands BOTH
    // parsers on "blazer". The exclusion must be the OTHER mentioned
    // category (the swap-source), never the required add-target.
    if(cat && required && cat===required){
      var lowAll=String(text).toLowerCase();
      var otherCat=null, otherIdx=-1;
      for(var oi=0;oi<REVISE_WORDS.length;oi++){
        if(REVISE_WORDS[oi].category===required) continue;
        var om=REVISE_WORDS[oi].re.exec(lowAll);
        if(om && (otherIdx===-1 || om.index<otherIdx)){ otherIdx=om.index; otherCat=REVISE_WORDS[oi].category; }
      }
      if(otherCat) cat=otherCat;
    }

    // Pure render follow-up ("show me wearing this"): render the most
    // recent valid proposal on the wearer — never a clarification, never
    // a new look.
    if(renderIntent && hasProfileStack && !cat && !required){
      var followAsm0=null;
      try{ followAsm0=stackForProfile.getAssembleLook(o); }catch(e9){ followAsm0=null; }
      if(!followAsm0){
        try{ if(root.MetaStyles&&typeof root.MetaStyles.assembleLook==="function") followAsm0=root.MetaStyles.assembleLook; }catch(e10){}
      }
      return await handleRenderFollowup({ catalog: catalog, stack: stackForProfile, text: text, metaClient: metaClient, shareId: shareId, stageImage: stageImage, assembleLook: followAsm0, preferences: o.preferences });
    }
    // Render intent WITH a revise target ("no bag, show me wearing it"):
    // revise first, then render the revised look below (never a flat-lay).
    var renderOnRevised = renderIntent && hasProfileStack && (!!cat || !!required);

    // Ambiguous / no revision target: clarification path (unchanged).
    if(!cat && !required){
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
    // wardrobe minus this turn's excluded category. A required (ADD)
    // category shapes the pool the OTHER direction: down to that one
    // allowed family, so the deterministic picker structurally can only
    // ever produce it — never by relaxing the fit rules.
    var active=[];
    try{ active=catalog?catalog.getActivePieces():[]; }catch(e){ active=[]; }
    if(!Array.isArray(active)) active=[];
    var excluded=cat ? active.filter(function(p){ return p && p.category===cat; }) : [];
    var requiredPieces=required ? active.filter(function(p){ return p && p.category===required; }) : null;
    var requiredMissing=!!(required && requiredPieces && requiredPieces.length===0);
    var requiredPresent=!!(required && requiredPieces && requiredPieces.length>0);
    var candidates=active.filter(function(p){ return p && (!cat || p.category!==cat); });
    if(requiredPresent){
      if(FINISH_CATS.indexOf(required)!==-1){
        // Finish-type required: no OTHER finish family may remain.
        candidates=candidates.filter(function(p){ return FINISH_CATS.indexOf(p.category)===-1 || p.category===required; });
      } else {
        // Base-type required: only that base category's own pieces remain
        // among base-type candidates. Multiple same-category pieces all
        // stay — fallbackChoose's deterministic ordering picks naturally.
        candidates=candidates.filter(function(p){ return BASE_CATS.indexOf(p.category)===-1 || p.category===required; });
      }
    }

    // Re-select one real 2-4 piece look from the reduced set, using
    // propose_look's own selection stack over that smaller pool. A
    // required-but-not-present category is an honest failure: no such
    // piece exists, so fallbackChoose is never called (nothing to pick).
    var stack=proposeStack(), assembleLook=null;
    try{ assembleLook=stack ? stack.getAssembleLook(o) : null; }catch(e){ assembleLook=null; }
    if(!assembleLook){
      try{
        if(root.MetaStyles && typeof root.MetaStyles.assembleLook==="function") assembleLook=root.MetaStyles.assembleLook;
      }catch(e2){}
    }
    var chosen=null, card=null, rejected=null;
    if(requiredMissing){
      rejected=null;
    } else if(stack && typeof stack.fallbackChoose==="function"){
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
      if(excluded.length>0 && requiredPresent) reply="Got it, loveling \u2014 set aside your "+plainNoun(cat)+" and brought back your "+plainNoun(required)+" \u2728 Let me re-weave the rest into something lovely.";
      else if(excluded.length>0) reply="Got it, loveling \u2014 set aside your "+plainNoun(cat)+" for now \u2728 Let me re-weave the rest into something lovely.";
      else if(requiredPresent && cat) reply="No "+plainNoun(cat)+" in the mix right now, darling \u2014 but I brought back your "+plainNoun(required)+" \u2728";
      else if(requiredPresent) reply="Got it, loveling \u2014 brought back your "+plainNoun(required)+" \u2728 Let me re-weave things into something lovely.";
      else reply="No "+plainNoun(cat)+" in the mix right now, darling \u2014 but I\u2019ll re-check the fit with what we\u2019ve got \u2728";
      reply+=" Your "+nouns+" are looking darling together.";
      if(card && card.valid===true) reply+=" Fit check: valid \u2714";
      // Render intent: the revised look renders on the wearer (profile
      // refs + revised garments, never a flat-lay). The profile gate
      // returns early with consent/missing copy when the record is not
      // ready — no preview call, no image delivery, explicit reason.
      var didRenderOnUser=false;
      var renderOnUserMeta=null;
      if(renderOnRevised){
        var gateProf=null, gateMissing=null;
        try{ await stackForProfile.ensureProfileLoaded(catalog); gateProf=stackForProfile.safeGetProfile(catalog); }catch(e){ gateProf=null; }
        if(!gateProf) gateProf={ headshot:null, full_body:null, consent:false, updated_at:null };
        if(!gateProf.consent){
          var gateAskC=stackForProfile.PROFILE_CONSENT_TEXT;
          try{ stackForProfile.recordConsentExpectation(catalog, "revise_look", gateAskC); }catch(e2){}
          recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["profile_consent_pending"] });
          return { text: gateAskC, image: null, persist:{ summaryDelta: "Asked for profile-photo consent.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: stackForProfile.noPreviewDelivery("profile_consent_pending"), renderOnUser: false } };
        }
        gateMissing=stackForProfile.missingProfileTypes(gateProf);
        if(gateMissing.length>0){
          var gateAskR=stackForProfile.profileAskText(gateMissing);
          try{ stackForProfile.recordProfileImageExpectation(catalog, "revise_look", gateAskR); }catch(e3){}
          recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["profile_refs_pending:"+gateMissing.join(",")] });
          return { text: gateAskR, image: null, persist:{ summaryDelta: "Asked for missing profile refs: "+gateMissing.join(", ")+".", preferencesDelta: "" }, skill:"revise_look", meta:{ profileMissing: gateMissing, imageDelivery: stackForProfile.noPreviewDelivery("profile_refs_pending"), renderOnUser: false } };
        }
        var byIdRender={};
        candidates.forEach(function(p){ byIdRender[p.piece_id]=p; });
        var garRender=stackForProfile.buildGarmentRefUrls(candidates, chosen);
        var onUserRevised=await stackForProfile.requestOnUserPreview({
          metaClient: metaClient, headshot: gateProf.headshot, fullBody: gateProf.full_body,
          garmentRefs: garRender.urls, garmentTotal: chosen.length,
          nouns: nouns, context: text, shareId: shareId, stageImage: stageImage, toolSteps: 0
        });
        img=onUserRevised.image;
        imageDelivery=onUserRevised.imageDelivery;
        renderOnUserMeta=onUserRevised.meta;
        didRenderOnUser=true;
        reply+=" Rendered on you from your saved photos \u2728.";
      }
      if(!didRenderOnUser){
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
      } // end flat-lay-only preview (render intent takes the on-user branch above)
      if(imageDelivery.requested&&!imageDelivery.delivered) reply+=CAVEAT;
    } else {
      // Honest no-valid-look: name the reason, never a fabricated look.
      // A required-but-not-present category is its own honest failure:
      // no such piece exists, so say so plainly (never fabricate one,
      // never silently propose something else without saying so).
      var why=plainWhy(stack, rejected||"no_valid_combination");
      if(requiredMissing) reply="Oh, loveling \u2728 There\u2019s no "+plainNoun(required)+" in your wardrobe yet, so I can\u2019t add one \u2014 share a photo of it and I\u2019ll catalogue it, then we\u2019ll weave it in!";
      else if(excluded.length>0) reply="Got it, loveling \u2014 set aside your "+plainNoun(cat)+" for now \u2728 I turned every piece over in the lamplight, but "+why+" \u2014 share one more piece (a layer, or a scarf with its bag) and I\u2019ll spin it into a full look!";
      else reply="No "+plainNoun(cat)+" in the mix right now, darling \u2014 I turned every piece over in the lamplight, but "+why+" \u2014 share one more piece (a layer, or a scarf with its bag) and I\u2019ll spin it into a full look!";
      imageDelivery.reason="no_valid_look";
    }
    // Opus finding #6: remember the actual revised look (or the honest
    // no-op) for explain_fit / the router — the chosen 2-4 piece look,
    // never the whole wardrobe.
    var revisedVerdict=!!chosen;
    var revisedFinish=chosen ? finishOfItems(chosen, card) : null;
    var revisedReasons=[];
    if(cat && excluded.length===0) revisedReasons.push("category_not_present");
    if(cat && excluded.length>0) revisedReasons.push("excluded:"+cat);
    if(requiredPresent) revisedReasons.push("required:"+required);
    if(requiredMissing) revisedReasons.push("required_not_present");
    if(!revisedVerdict) revisedReasons.push(rejected ? ("fallback_rejected:"+rejected) : "no_valid_look");
    if(didRenderOnUser) revisedReasons.push("render_on_user");
    recordReviseTurn(catalog, {
      userText: typeof text==="string" ? text : "",
      proposal: (revisedVerdict && (revisedFinish==="layer"||revisedFinish==="scarf+bag")) ? {
        pieces: chosen.map(function(it){ return it.id; }),
        title: null, note: "valid:"+revisedFinish
      } : null,
      verdict: revisedVerdict, reasons: revisedReasons
    });
    var sumDelta, prefDelta;
    if(requiredMissing){ sumDelta="Tried adding "+plainNoun(required)+"; none in wardrobe yet."; prefDelta=""; }
    else if(chosen && excluded.length>0 && requiredPresent){ sumDelta="Revised look, swapped "+plainNoun(cat)+" for "+plainNoun(required)+"."; prefDelta="Prefers without "+plainNoun(cat)+", with "+plainNoun(required)+"."; }
    else if(chosen && requiredPresent){ sumDelta="Revised look, added "+plainNoun(required)+"."; prefDelta="Prefers with "+plainNoun(required)+"."; }
    else if(chosen && cat){ sumDelta="Revised look, removed "+plainNoun(cat)+"."; prefDelta="Prefers without "+plainNoun(cat)+"."; }
    else if(cat){ sumDelta="Tried revising without "+plainNoun(cat)+"; no valid look yet."; prefDelta="Prefers without "+plainNoun(cat)+"."; }
    else { sumDelta="Asked for revise clarification."; prefDelta=""; }
    if(didRenderOnUser){ sumDelta+=" Rendered on wearer."; }
    var outMeta={ imageDelivery: imageDelivery, renderOnUser: didRenderOnUser };
    if(didRenderOnUser && renderOnUserMeta){
      outMeta.profileRefs=renderOnUserMeta.profileRefs;
      outMeta.referencePieces=renderOnUserMeta.referencePieces;
      outMeta.referenceGarmentTotal=renderOnUserMeta.referenceGarmentTotal;
      outMeta.referenceDowngraded=renderOnUserMeta.referenceDowngraded;
      outMeta.referencePayloadBytes=renderOnUserMeta.referencePayloadBytes;
      outMeta.previewPrompt=renderOnUserMeta.previewPrompt;
    }
    return { text: reply, image: img, persist:{ summaryDelta: sumDelta, preferencesDelta: prefDelta }, skill:"revise_look", meta: outMeta };
  }

  var api = { handle: handle, skill: "revise_look", matchRevise: matchRevise, matchAdd: matchAdd };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["revise_look"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
