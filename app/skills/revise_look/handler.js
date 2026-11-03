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
 * Extras (user-chosen, never fit-checked): a pure "add my X" builds on
 * the most recent recorded look instead of re-weaving — the addition
 * joins the core only when core+addition still passes the fit rules,
 * otherwise it rides on top as an extra (recorded on proposal.extras,
 * never claimed to pass the fit check). Removing a category that lives
 * only in extras drops just that extra. Shoes are extras-only, backed
 * by a real catalogued shoes piece: strictShape never admits them to a
 * core, so they always ride on top like any other extra.
 *
 * Preview honesty: the preview image is only ever a real metaClient.preview
 * dataURL staged via the service-passed shareId + stageImage. When no
 * preview client exists, or preview/staging fails, image stays null and an
 * honest caveat is appended — never a fabricated URL.
 */
(function (root) {

  var REVISE_WORDS=[{ re:/\bbag\b|purse|handbag/, category:"bag" },{ re:/\bscarf\b|wrap\b/, category:"scarf" },{ re:/\bblazer\b|jacket|coat/, category:"layer/blazer" },{ re:/\bcardigan\b|shrug|tie-blouse|blouse/, category:"layer/cardigan" },{ re:/\bdress\b|gown/, category:"dress" },{ re:/\btop\b|cami|camisole|tee/, category:"base/top" },{ re:/\bbottom\b|jeans|skirt|trousers|pants|mini/, category:"base/bottom" },{ re:/\bshoes?\b|boots?|heels?|trainers?|sneakers?|sandals?\b/, category:"shoes" }];
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
  function plainNoun(c){ var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag","shoes":"shoes"}; return m[c]||c; }

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
  var NO_SHOES_TEXT="Oh, loveling \u2728 There are no shoes in your wardrobe yet, so I can\u2019t pop them on top \u2014 share a photo of them and I\u2019ll catalogue it, then we\u2019ll pop them on top of a look! \u2728";
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
  // Most recent valid look on record (the look a bare "show me
  // wearing it" refers to, and the base a pure "add my X" builds on).
  // verdict is stored boolean; proposal.pieces are CORE piece ids in
  // selection order, proposal.extras (optional) are user-chosen extras
  // riding on top as [{ piece_id, category }] — every extra names a
  // REAL active piece (legacy pieceless entries resolve to nothing and
  // are dropped). Returns { coreIds, extras } or null.
  // Core ids must all still resolve to ACTIVE pieces — a core piece
  // that left the active set invalidates that turn (the wardrobe
  // changed since it was woven), so older turns are tried; extras
  // whose piece left the active set are dropped silently.
  // Never throws.
  function lastValidLook(catalog){
    try{
      var active=[];
      try{ active=catalog?catalog.getActivePieces():[]; }catch(e){ active=[]; }
      if(!Array.isArray(active)) active=[];
      var live={};
      active.forEach(function(p){ if(p&&p.piece_id) live[p.piece_id]=p; });
      var turns=catalog&&typeof catalog.getTurns==="function"?catalog.getTurns():[];
      for(var i=turns.length-1;i>=0;i--){
        var t=turns[i];
        if(t&&t.verdict===true&&t.proposal&&Array.isArray(t.proposal.pieces)&&t.proposal.pieces.length>0){
          var coreIds=t.proposal.pieces.slice();
          var allLive=true;
          for(var ci=0;ci<coreIds.length;ci++){ if(!live[coreIds[ci]]){ allLive=false; break; } }
          if(!allLive) continue;
          var extras=[];
          if(Array.isArray(t.proposal.extras)){
            for(var ei=0;ei<t.proposal.extras.length;ei++){
              var ex=t.proposal.extras[ei];
              if(!ex||typeof ex.category!=="string"||!ex.category) continue;
              // Real pieces only: legacy pieceless entries (piece_id
              // null) and ids that left the active set are dropped.
              if(typeof ex.piece_id==="string"&&live[ex.piece_id]){
                extras.push({ piece_id: ex.piece_id, category: live[ex.piece_id].category });
              }
            }
          }
          return { coreIds: coreIds, extras: extras };
        }
      }
    }catch(e){}
    return null;
  }

  // Live piece map: piece_id -> piece, over one active array.
  function liveMapOf(active){
    var map={};
    (Array.isArray(active)?active:[]).forEach(function(p){ if(p&&p.piece_id) map[p.piece_id]=p; });
    return map;
  }

  // Assembler-shaped core items ({ id, category }) for core ids that
  // are known live — enough for preview building and noun naming.
  function coreItemsOf(coreIds, liveMap){
    return (Array.isArray(coreIds)?coreIds:[]).map(function(id){
      return { id: id, category: liveMap[id] ? liveMap[id].category : null };
    }).filter(function(it){ return !!it.category; });
  }

  // Audit reasons naming every extra riding on a recorded turn.
  function extraReasonsOf(extras){
    return (Array.isArray(extras)?extras:[]).map(function(ex){ return "extra:"+ex.category; });
  }

  function coreNounStr(items){ return items.map(function(it){ return plainNoun(it.category); }).join(" + "); }
  function extraNounStr(extras){ return extras.map(function(ex){ return plainNoun(ex.category); }).join(" + "); }

  // Combined preview items: core assembler items first, then extras.
  // Every extra names a real piece, so extras resolve to live pieces
  // like core items; an extra whose piece left the pool resolves to
  // nothing and counts as missing, so the honest "Only N of M" line
  // applies. Order: core then extras.
  function combinedPreviewItems(piecesForMap, coreItems, extras){
    var map=liveMapOf(piecesForMap);
    var out=(Array.isArray(coreItems)?coreItems:[]).slice();
    (Array.isArray(extras)?extras:[]).forEach(function(ex){
      if(!ex||typeof ex.category!=="string") return;
      if(typeof ex.piece_id==="string"&&map[ex.piece_id]){
        out.push({ id: ex.piece_id, category: map[ex.piece_id].category });
      }
    });
    return out;
  }

  function combinedNounsStr(coreItems, extras){
    var nouns=(Array.isArray(coreItems)?coreItems:[]).map(function(it){ return plainNoun(it.category); });
    (Array.isArray(extras)?extras:[]).forEach(function(ex){ if(ex&&typeof ex.category==="string") nouns.push(plainNoun(ex.category)); });
    return nouns.join(" + ");
  }

  // Kept extras over a fresh core: drop the removed category, anything
  // already in the new core (same category — no "bag + bag" doubles in
  // the preview), and extras whose piece left the pool. Extras always
  // name a real piece, so a missing/empty piece_id drops the extra.
  function carryExtras(oldExtras, removedCat, coreItems, poolPieces){
    var coreCats={}, coreIds={};
    (Array.isArray(coreItems)?coreItems:[]).forEach(function(it){ if(it){ coreCats[it.category]=true; if(it.id) coreIds[it.id]=true; } });
    var pool={};
    (Array.isArray(poolPieces)?poolPieces:[]).forEach(function(p){ if(p&&p.piece_id) pool[p.piece_id]=true; });
    return (Array.isArray(oldExtras)?oldExtras:[]).filter(function(ex){
      if(!ex||typeof ex.category!=="string") return false;
      if(typeof ex.piece_id!=="string"||!ex.piece_id) return false;
      if(removedCat&&ex.category===removedCat) return false;
      if(coreCats[ex.category]) return false;
      if(coreIds[ex.piece_id]) return false;
      if(!pool[ex.piece_id]) return false;
      return true;
    });
  }

  // True when the category lives ONLY in extras (not in the live core)
  // — a removal then drops just the extra, no re-weave.
  function isExtraOnlyDrop(look, cat, liveMap){
    var inCore=false;
    look.coreIds.forEach(function(id){ if(liveMap[id]&&liveMap[id].category===cat) inCore=true; });
    if(inCore) return false;
    return look.extras.some(function(ex){ return ex&&ex.category===cat; });
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
    var look=lastValidLook(catalog);
    if(!look){
      recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["no_prior_look"] });
      return { text: "No saved look to render just yet, loveling \u2728 \u2014 ask me to put a look together first, then say \u201Cshow me wearing it\u201D and I\u2019ll picture it on you.", image: null, persist:{ summaryDelta: "Render follow-up with no prior look.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: { requested:false, generated:false, delivered:false, reason:"no_prior_look" }, renderOnUser: false } };
    }
    var active=[];
    try{ active=catalog?catalog.getActivePieces():[]; }catch(e){ active=[]; }
    if(!Array.isArray(active)) active=[];
    var checked=null;
    try{
      if(stack&&typeof stack.validateSelection==="function") checked=stack.validateSelection(active, look.coreIds, assembleLook);
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
    // Every preview (and the recorded turn) carries core + extras: the
    // combined items ride buildGarmentImages, nouns list core then extras.
    var combined=combinedPreviewItems(active, checked.items, look.extras);
    var coreNouns=coreNounStr(checked.items);
    var nouns=combinedNounsStr(checked.items, look.extras);
    var prefsText=typeof o.preferences==="string"?o.preferences:"";
    var rctx=(text+(prefsText?". "+prefsText:"")).slice(0,300);
    if(!rctx.trim()) rctx="";
    if(look.extras.length>0) rctx+=(rctx?" ":"")+"Note: my extras ("+extraNounStr(look.extras)+") are styled on top of the fit-checked look.";
    var onUser=await stack.requestOnUserPreview({
      skill: "revise_look",
      metaClient: metaClient, headshot: prof.headshot, fullBody: prof.full_body,
      activePieces: active, chosenItems: combined,
      nouns: nouns, context: rctx, shareId: shareId, stageImage: stageImage, toolSteps: 0
    });
    var reply="Oh, here you are wearing it, darling \u2728 \u2014 your "+coreNouns+" together. Fit check: valid \u2714";
    if(look.extras.length>0) reply+=" Plus your "+extraNounStr(look.extras)+" styled on top \u2014 your pick outside the fit rules \u2728";
    reply+=" Rendered on you from your saved photos \u2728.";
    if(onUser.imageDelivery.requested&&!onUser.imageDelivery.delivered) reply+=CAVEAT;
    recordReviseTurn(catalog, {
      userText: typeof text==="string"?text:"",
      proposal: { pieces: checked.items.map(function(it){ return it.id; }), extras: look.extras, title: null, note: "render_on_user" },
      verdict: true, reasons: ["render_on_user"].concat(extraReasonsOf(look.extras))
    });
    return { text: reply, image: onUser.image, persist:{ summaryDelta: "Rendered saved look on wearer: "+nouns+".", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: onUser.imageDelivery, renderOnUser: true, profileRefs: onUser.meta.profileRefs, referencePieces: onUser.meta.referencePieces, referenceGarmentTotal: onUser.meta.referenceGarmentTotal, referenceDowngraded: onUser.meta.referenceDowngraded, referencePayloadBytes: onUser.meta.referencePayloadBytes, referenceMode: onUser.meta.referenceMode, previewPrompt: onUser.meta.previewPrompt } };
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

    // Core selection primitive: shape the candidate pool (exclude one
    // category, optionally force one family) and pick one real 2-4 piece
    // look via propose_look's own selection stack. Never relaxes the
    // fit rules. Used by the re-weave path below and by the
    // swap-to-shoes removal half.
    function selectCore(excludeCat, forceCat){
      var sExcluded=excludeCat ? active.filter(function(p){ return p && p.category===excludeCat; }) : [];
      var sReqPieces=forceCat ? active.filter(function(p){ return p && p.category===forceCat; }) : null;
      var sReqMissing=!!(forceCat && sReqPieces && sReqPieces.length===0);
      var sReqPresent=!!(forceCat && sReqPieces && sReqPieces.length>0);
      var cands=active.filter(function(p){ return p && (!excludeCat || p.category!==excludeCat); });
      if(sReqPresent){
        if(FINISH_CATS.indexOf(forceCat)!==-1){
          // Finish-type required: no OTHER finish family may remain.
          cands=cands.filter(function(p){ return FINISH_CATS.indexOf(p.category)===-1 || p.category===forceCat; });
        } else {
          // Base-type required: only that base category's own pieces remain
          // among base-type candidates. Multiple same-category pieces all
          // stay — fallbackChoose's deterministic ordering picks naturally.
          cands=cands.filter(function(p){ return BASE_CATS.indexOf(p.category)===-1 || p.category===forceCat; });
        }
      }
      var sChosen=null, sCard=null, sRejected=null;
      if(sReqMissing){
        sRejected=null;
      } else if(stack && typeof stack.fallbackChoose==="function"){
        var fb=null;
        try{ fb=stack.fallbackChoose(cands, assembleLook); }catch(e){ fb=null; }
        if(fb && fb.items){ sChosen=fb.items; sCard=fb.card; }
        else sRejected=(fb && fb.rejected) || "no_valid_combination";
      } else {
        sRejected="no_selection_stack";
      }
      return { excluded: sExcluded, requiredPieces: sReqPieces, requiredMissing: sReqMissing,
        requiredPresent: sReqPresent, candidates: cands, chosen: sChosen, card: sCard, rejected: sRejected };
    }

    // Meta shape for the extras-aware turns: mirrors the re-weave tail
    // (flat-lay carries audit via the ring, not meta; on-user spreads
    // the render meta the same way).
    function outMetaFor(pv){
      var m={ imageDelivery: pv.imageDelivery, renderOnUser: pv.renderOnUser };
      if(pv.renderOnUser && pv.onUserMeta){
        m.profileRefs=pv.onUserMeta.profileRefs;
        m.referencePieces=pv.onUserMeta.referencePieces;
        m.referenceGarmentTotal=pv.onUserMeta.referenceGarmentTotal;
        m.referenceDowngraded=pv.onUserMeta.referenceDowngraded;
        m.referencePayloadBytes=pv.onUserMeta.referencePayloadBytes;
        m.referenceMode=pv.onUserMeta.referenceMode;
        m.previewPrompt=pv.onUserMeta.previewPrompt;
      }
      return m;
    }

    // Shoes with no current look: shoes can only ride on a woven look,
    // so with nothing woven yet there is nothing for them to ride on.
    // With no shoes piece catalogued at all, say so honestly and invite
    // a photo — never claim the shoes were added.
    function shoeNoLookTurn(){
      var hasShoesPiece=active.some(function(p){ return p && p.category==="shoes"; });
      if(!hasShoesPiece){
        recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["required_not_present"] });
        imageDelivery.reason="required_not_present";
        return { text: NO_SHOES_TEXT, image: null, persist:{ summaryDelta:"Shoes requested; none in wardrobe yet.", preferencesDelta:"" }, skill:"revise_look", meta:{ imageDelivery: imageDelivery } };
      }
      recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["no_prior_look","added:shoes"] });
      return { text: "Lovely pick, darling \u2728 \u2014 shoes always ride on top as your own extra. There\u2019s no look woven yet, so ask me to put one together and then we\u2019ll pop your shoes on top \u2728", image: null, persist:{ summaryDelta: "Shoes requested with no current look; asked to weave one first.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: { requested:false, generated:false, delivered:false, reason:"no_prior_look" }, renderOnUser: false } };
    }

    // Shared preview for the extras-aware paths: core + extras ride every
    // preview via buildGarmentImages (the composite sheet kicks in past
    // the free slots), nouns list core then extras, and the flat-lay /
    // on-user prompt may name the extras as styled on top. Render intent
    // takes the on-user branch behind the same profile gate as the
    // re-weave path; otherwise a flat-lay. Returns { img,
    // imageDelivery, renderOnUser, onUserMeta }, or { early } for a gate
    // short-circuit (already recorded — the caller returns it directly).
    async function previewCombined(coreItems, extras, nouns){
      var combined=combinedPreviewItems(active, coreItems, extras);
      if(renderIntent && hasProfileStack){
        var gateProf=null;
        try{ await stackForProfile.ensureProfileLoaded(catalog); gateProf=stackForProfile.safeGetProfile(catalog); }catch(e){ gateProf=null; }
        if(!gateProf) gateProf={ headshot:null, full_body:null, consent:false, updated_at:null };
        if(!gateProf.consent){
          var gateAskC=stackForProfile.PROFILE_CONSENT_TEXT;
          try{ stackForProfile.recordConsentExpectation(catalog, "revise_look", gateAskC); }catch(e2){}
          recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["profile_consent_pending"] });
          return { early: { text: gateAskC, image: null, persist:{ summaryDelta: "Asked for profile-photo consent.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: stackForProfile.noPreviewDelivery("profile_consent_pending"), renderOnUser: false } } };
        }
        var gateMissing=stackForProfile.missingProfileTypes(gateProf);
        if(gateMissing.length>0){
          var gateAskR=stackForProfile.profileAskText(gateMissing);
          try{ stackForProfile.recordProfileImageExpectation(catalog, "revise_look", gateAskR); }catch(e3){}
          recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["profile_refs_pending:"+gateMissing.join(",")] });
          return { early: { text: gateAskR, image: null, persist:{ summaryDelta: "Asked for missing profile refs: "+gateMissing.join(", ")+".", preferencesDelta: "" }, skill:"revise_look", meta:{ profileMissing: gateMissing, imageDelivery: stackForProfile.noPreviewDelivery("profile_refs_pending"), renderOnUser: false } } };
        }
        var onUserCtx=text;
        if(extras.length>0) onUserCtx+=(onUserCtx?" ":"")+"Note: my extras ("+extraNounStr(extras)+") are styled on top of the fit-checked look.";
        var onUser=await stackForProfile.requestOnUserPreview({
          skill: "revise_look",
          metaClient: metaClient, headshot: gateProf.headshot, fullBody: gateProf.full_body,
          activePieces: active, chosenItems: combined,
          nouns: nouns, context: onUserCtx, shareId: shareId, stageImage: stageImage, toolSteps: 0
        });
        return { img: onUser.image, imageDelivery: onUser.imageDelivery, renderOnUser: true, onUserMeta: onUser.meta };
      }
      var delivery={ requested:false, generated:false, delivered:false, reason:"no_preview_client" };
      var img=null;
      var gar=null;
      try{
        if(stackForProfile&&typeof stackForProfile.buildGarmentImages==="function"){
          gar=stackForProfile.buildGarmentImages(active, combined, 4);
        }
      }catch(e){ gar=null; }
      var refThumbs=[], auditRefs=[], fMode="individual", fRepresented=0, fTotal=combined.length, fNouns=[];
      if(gar&&Array.isArray(gar.images)&&gar.images.length>0){
        refThumbs=gar.images.slice(0,4);
        fMode=gar.mode==="composite"?"composite":"individual";
        fRepresented=gar.represented;
        fTotal=gar.total;
        fNouns=Array.isArray(gar.orderedNouns)?gar.orderedNouns:[];
        auditRefs=fMode==="composite"
          ? (Array.isArray(gar.refs)?gar.refs:[]).slice()
          : (Array.isArray(gar.refs)?gar.refs:[]).slice(0,refThumbs.length);
      }
      // Without the helper there are no refs to audit; the text-only
      // reply below stays honest about that.
      var missingRefs=fTotal-fRepresented;
      var prompt="Y2K fairycore flat-lay look card, soft pastel background, garments laid out neatly: "+nouns+". No people, no worn try-on, no readable text.";
      if(extras.length>0) prompt+=" The "+extraNounStr(extras)+" ride along as extra styling on top of the fit-checked look.";
      if(refThumbs.length>0){
        if(fMode==="composite"){
          prompt+=" The attached image is a reference sheet of the "+fRepresented+" selected garments arranged in a grid, read left-to-right, top-to-bottom: "+fNouns.join(", ")+".";
          prompt+=" Lay each garment from the sheet out as a separate flat-lay item, preserving each garment\u2019s colour, print, silhouette, and details; do not reproduce the grid, white background, or sheet layout itself; do not substitute generic garments; do not add unreferenced garments; no person/try-on/readable text.";
        } else {
          prompt+=" Use the attached reference garment photo for the true colors and silhouette.";
          prompt+=" Each attached image is a distinct wardrobe garment; preserve the colour, print, silhouette, and details of every attached reference as a separate flat-lay item; do not substitute generic garments; do not add unreferenced garments; no person/try-on/readable text.";
        }
        if(missingRefs>0){
          prompt+=" Only "+fRepresented+" of "+combined.length+" selected pieces have reference photos; the remaining piece(s) are not represented in references.";
        }
      }
      if(metaClient&&typeof metaClient.preview==="function"){
        delivery.requested=true; delivery.reason="preview_failed";
        try{
          if(stackForProfile&&typeof stackForProfile.recordPreviewAudit==="function"){
            var flatPayloadBytes=0;
            for(var ai=0;ai<auditRefs.length;ai++){ if(typeof auditRefs[ai].ref_bytes==="number") flatPayloadBytes+=auditRefs[ai].ref_bytes; }
            stackForProfile.recordPreviewAudit({
              skill:"revise_look", renderOnUser:false,
              refs: auditRefs,
              previewPromptPreview: prompt,
              totalRefs: refThumbs.length, totalPayloadBytes: flatPayloadBytes,
              mode: fMode
            });
          }
        }catch(auditErr){}
        try{
          var previewRef=null;
          if(refThumbs.length===1) previewRef=refThumbs[0];
          else if(refThumbs.length>1) previewRef=refThumbs;
          var pr=await metaClient.preview(prompt, previewRef);
          var durl=pr&&(pr.dataURL||pr.dataUrl||pr.data_url);
          if(typeof durl==="string"&&/^data:image\//.test(durl)){
            delivery.generated=true;
            img={ dataURL:durl, caption: nouns+" \u2014 styled with love" };
            if(shareId&&stageImage){
              var staged=null;
              try{ staged=await stageImage(shareId, durl); }catch(e){ staged=null; }
              if(staged&&staged.ok){ delivery.delivered=true; delivery.reason="staged for send with image"; }
              else delivery.reason="stage_failed";
            } else delivery.reason="text-only send; preview not staged for delivery";
          } else delivery.reason="preview_unparseable";
        }catch(e){ delivery.reason="preview_failed"; }
      }
      return { img: img, imageDelivery: delivery, renderOnUser: false, onUserMeta: null };
    }

    // Pure ADD on a current look: the addition joins the core only when
    // core+addition still passes the fit rules — otherwise the core
    // stays unchanged and the piece rides on top as a user-chosen extra.
    async function pureAddTurn(look){
      var live=liveMapOf(active);
      var coreIds=look.coreIds.slice();
      var oldExtras=look.extras;
      var inLookIds={}, inLookCats={};
      coreIds.forEach(function(id){ inLookIds[id]=true; if(live[id]) inLookCats[live[id].category]=true; });
      oldExtras.forEach(function(ex){ if(ex.piece_id) inLookIds[ex.piece_id]=true; inLookCats[ex.category]=true; });
      var noun=plainNoun(required);
      var coreItems=coreItemsOf(coreIds, live);
      var finish=finishOfItems(coreItems, null);
      // Deterministic pick: the first active piece of the requested
      // category not already in the look — active (catalog) order is the
      // same ordering fallbackChoose uses among same-category pieces.
      var pick=null;
      for(var ai=0;ai<active.length;ai++){
        var ap=active[ai];
        if(ap&&ap.category===required&&!inLookIds[ap.piece_id]){ pick=ap; break; }
      }
      if(!pick){
        // Everything of this category is already in the look.
        var nouns0=combinedNounsStr(coreItems, oldExtras);
        recordReviseTurn(catalog, {
          userText: typeof text==="string"?text:"",
          proposal: { pieces: coreIds, extras: oldExtras, title: null, note: "valid:"+finish },
          verdict: true, reasons: ["already_in_look"].concat(extraReasonsOf(oldExtras))
        });
        var pv0=await previewCombined(coreItems, oldExtras, nouns0);
        if(pv0.early) return pv0.early;
        var reply0="Your "+noun+" is already in the look, darling \u2728 \u2014 your "+nouns0+" stand as they are. Fit check: valid \u2714";
        if(pv0.imageDelivery.requested&&!pv0.imageDelivery.delivered) reply0+=CAVEAT;
        return { text: reply0, image: pv0.img, persist:{ summaryDelta: "Add requested for "+noun+"; already in the look, left unchanged.", preferencesDelta: "" }, skill:"revise_look", meta: outMetaFor(pv0) };
      }
      var trialIds=coreIds.concat([pick.piece_id]);
      var checked=null;
      try{ checked=stack.validateSelection(active, trialIds, assembleLook); }catch(e){ checked=null; }
      if(checked&&checked.ok&&checked.card&&checked.card.valid===true){
        // The addition passes the fit rules: it becomes the new core.
        var newCore=checked.items;
        recordReviseTurn(catalog, {
          userText: typeof text==="string"?text:"",
          proposal: { pieces: newCore.map(function(it){ return it.id; }), extras: oldExtras, title: null, note: "valid:"+finishOfItems(newCore, checked.card) },
          verdict: true, reasons: ["added:"+required].concat(extraReasonsOf(oldExtras))
        });
        var nounsA=combinedNounsStr(newCore, oldExtras);
        var pvA=await previewCombined(newCore, oldExtras, nounsA);
        if(pvA.early) return pvA.early;
        var replyA="Got it, loveling \u2014 added your "+noun+" \u2728 Your "+coreNounStr(newCore)+" are looking darling together. Fit check: valid \u2714";
        if(oldExtras.length>0) replyA+=" Plus your "+extraNounStr(oldExtras)+" riding on top \u2014 your pick outside the fit rules \u2728.";
        if(pvA.imageDelivery.requested&&!pvA.imageDelivery.delivered) replyA+=CAVEAT;
        return { text: replyA, image: pvA.img, persist:{ summaryDelta: "Revised look, added "+noun+".", preferencesDelta: "Prefers with "+noun+"." }, skill:"revise_look", meta: outMetaFor(pvA) };
      }
      // Otherwise the core stays unchanged and the piece rides on top as
      // a user-chosen extra — never claimed to pass the fit check.
      var newExtras=oldExtras.concat([{ piece_id: pick.piece_id, category: pick.category }]);
      recordReviseTurn(catalog, {
        userText: typeof text==="string"?text:"",
        proposal: { pieces: coreIds, extras: newExtras, title: null, note: "valid:"+finish },
        verdict: true, reasons: ["added:"+required].concat(extraReasonsOf(newExtras))
      });
      var nounsE=combinedNounsStr(coreItems, newExtras);
      var pvE=await previewCombined(coreItems, newExtras, nounsE);
      if(pvE.early) return pvE.early;
      var replyE="Added your "+noun+" on top, darling \u2014 it\u2019s your pick outside my fit rules, so the fit check covers your "+coreNounStr(coreItems)+" only \u2728";
      if(pvE.imageDelivery.requested&&!pvE.imageDelivery.delivered) replyE+=CAVEAT;
      return { text: replyE, image: pvE.img, persist:{ summaryDelta: "Added "+noun+" on top as an extra (outside the fit rules).", preferencesDelta: "Prefers with "+noun+"." }, skill:"revise_look", meta: outMetaFor(pvE) };
    }

    // Shoes on a current look: shoes are extras-only, backed by a real
    // catalogued shoes piece — never validated, never in the core. The
    // pick is deterministic: the first active shoes piece not already
    // on the look. With no shoes piece catalogued, say so honestly,
    // record no extra, and never claim the shoes were added.
    async function addShoesTurn(look){
      var live=liveMapOf(active);
      var coreIds=look.coreIds.slice();
      var coreItems=coreItemsOf(coreIds, live);
      var finish=finishOfItems(coreItems, null);
      var onLookIds={};
      coreIds.forEach(function(id){ onLookIds[id]=true; });
      look.extras.forEach(function(ex){ if(ex&&typeof ex.piece_id==="string") onLookIds[ex.piece_id]=true; });
      var pick=null, anyShoes=false;
      for(var pai=0;pai<active.length;pai++){
        var pap=active[pai];
        if(pap&&pap.category==="shoes"){
          anyShoes=true;
          if(!onLookIds[pap.piece_id]&&!pick){ pick=pap; }
        }
      }
      if(!pick&&!anyShoes){
        recordReviseTurn(catalog, {
          userText: typeof text==="string"?text:"",
          proposal: null, verdict: false, reasons: ["required_not_present"]
        });
        imageDelivery.reason="required_not_present";
        return { text: NO_SHOES_TEXT, image: null, persist:{ summaryDelta:"Shoes requested; none in wardrobe yet.", preferencesDelta:"" }, skill:"revise_look", meta:{ imageDelivery: imageDelivery } };
      }
      if(!pick){
        var nouns0=combinedNounsStr(coreItems, look.extras);
        var nouns0=combinedNounsStr(coreItems, look.extras);
        recordReviseTurn(catalog, {
          userText: typeof text==="string"?text:"",
          proposal: { pieces: coreIds, extras: look.extras, title: null, note: "valid:"+finish },
          verdict: true, reasons: ["already_in_look"].concat(extraReasonsOf(look.extras))
        });
        var pv0=await previewCombined(coreItems, look.extras, nouns0);
        if(pv0.early) return pv0.early;
        var reply0="Your shoes are already on top, darling \u2728 \u2014 your "+nouns0+" stand as they are. Fit check: valid \u2714";
        if(pv0.imageDelivery.requested&&!pv0.imageDelivery.delivered) reply0+=CAVEAT;
        return { text: reply0, image: pv0.img, persist:{ summaryDelta: "Shoes already an extra; left unchanged.", preferencesDelta: "" }, skill:"revise_look", meta: outMetaFor(pv0) };
      }
      var newExtras=look.extras.concat([{ piece_id: pick.piece_id, category: "shoes" }]);
      recordReviseTurn(catalog, {
        userText: typeof text==="string"?text:"",
        proposal: { pieces: coreIds, extras: newExtras, title: null, note: "valid:"+finish },
        verdict: true, reasons: ["added:shoes"].concat(extraReasonsOf(newExtras))
      });
      var nouns=combinedNounsStr(coreItems, newExtras);
      var pv=await previewCombined(coreItems, newExtras, nouns);
      if(pv.early) return pv.early;
      var reply="Added your shoes on top, darling \u2014 it\u2019s your pick outside my fit rules, so the fit check covers your "+coreNounStr(coreItems)+" only \u2728";
      if(pv.imageDelivery.requested&&!pv.imageDelivery.delivered) reply+=CAVEAT;
      return { text: reply, image: pv.img, persist:{ summaryDelta: "Added shoes on top as an extra (outside the fit rules).", preferencesDelta: "Prefers with shoes." }, skill:"revise_look", meta: outMetaFor(pv) };
    }

    // Removing a category that lives only in extras: drop just the
    // extra, keep the core look and remaining extras unchanged — no
    // re-weave.
    async function extraDropTurn(look){
      var live=liveMapOf(active);
      var coreIds=look.coreIds.slice();
      var coreItems=coreItemsOf(coreIds, live);
      var noun=plainNoun(cat);
      var kept=look.extras.filter(function(ex){ return ex&&ex.category!==cat; });
      var finish=finishOfItems(coreItems, null);
      recordReviseTurn(catalog, {
        userText: typeof text==="string"?text:"",
        proposal: { pieces: coreIds, extras: kept, title: null, note: "valid:"+finish },
        verdict: true, reasons: ["removed_extra:"+cat].concat(extraReasonsOf(kept))
      });
      var nouns=combinedNounsStr(coreItems, kept);
      var pv=await previewCombined(coreItems, kept, nouns);
      if(pv.early) return pv.early;
      var reply="Set aside your "+noun+", loveling \u2728 \u2014 your "+coreNounStr(coreItems)+" still stand. Fit check: valid \u2714";
      if(kept.length>0) reply+=" Plus your "+extraNounStr(kept)+" still riding on top \u2014 your pick outside the fit rules \u2728.";
      if(pv.imageDelivery.requested&&!pv.imageDelivery.delivered) reply+=CAVEAT;
      return { text: reply, image: pv.img, persist:{ summaryDelta: "Set aside extra "+noun+"; core unchanged.", preferencesDelta: "Prefers without "+noun+"." }, skill:"revise_look", meta: outMetaFor(pv) };
    }

    // Swap onto shoes ("swap the bag for shoes"): the removal half runs
    // first (extra-only drop, else a re-weave excluding the category —
    // never forcing shoes, which no pool can hold), then a real
    // catalogued shoes piece rides on top as the user's extra. With no
    // shoes piece catalogued, say so honestly and record no extra.
    async function swapToShoesTurn(look){
      var live=liveMapOf(active);
      var noun=plainNoun(cat);
      var shoePick=null;
      for(var spi=0;spi<active.length;spi++){
        if(active[spi]&&active[spi].category==="shoes"){ shoePick=active[spi]; break; }
      }
      if(!shoePick){
        recordReviseTurn(catalog, {
          userText: typeof text==="string"?text:"",
          proposal: null, verdict: false, reasons: ["required_not_present"]
        });
        imageDelivery.reason="required_not_present";
        return { text: NO_SHOES_TEXT, image: null, persist:{ summaryDelta:"Shoes requested; none in wardrobe yet.", preferencesDelta:"" }, skill:"revise_look", meta:{ imageDelivery: imageDelivery } };
      }
      var coreIds, keptExtras, removedFromCore;
      if(isExtraOnlyDrop(look, cat, live)){
        coreIds=look.coreIds.slice();
        keptExtras=look.extras.filter(function(ex){ return ex&&ex.category!==cat; });
        removedFromCore=false;
      } else {
        var sel=selectCore(cat, null);
        if(!sel.chosen){
          var why=plainWhy(stack, sel.rejected||"no_valid_combination");
          recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["excluded:"+cat, sel.rejected?("fallback_rejected:"+sel.rejected):"no_valid_look"] });
          imageDelivery.reason="no_valid_look";
          return { text: "Got it, loveling \u2014 set aside your "+noun+" for now \u2728 I turned every piece over in the lamplight, but "+why+" \u2014 share one more piece (a layer, or a scarf with its bag) and I\u2019ll spin it into a full look! And your shoes will have to wait for a valid look to ride on \u2728", image: null, persist:{ summaryDelta: "Tried revising without "+noun+" for shoes; no valid look yet.", preferencesDelta: "Prefers without "+noun+"." }, skill:"revise_look", meta:{ imageDelivery: imageDelivery } };
        }
        coreIds=sel.chosen.map(function(it){ return it.id; });
        keptExtras=carryExtras(look.extras, cat, sel.chosen, sel.candidates);
        removedFromCore=true;
      }
      var coreItems=coreItemsOf(coreIds, live);
      var shoesHad=keptExtras.some(function(ex){ return ex&&ex.category==="shoes"; });
      if(!shoesHad) keptExtras=keptExtras.concat([{ piece_id: shoePick.piece_id, category: "shoes" }]);
      var finish=finishOfItems(coreItems, null);
      var reasons=(removedFromCore?["excluded:"+cat]:["removed_extra:"+cat]).concat(shoesHad?[]:["added:shoes"]).concat(extraReasonsOf(keptExtras));
      recordReviseTurn(catalog, {
        userText: typeof text==="string"?text:"",
        proposal: { pieces: coreIds, extras: keptExtras, title: null, note: "valid:"+finish },
        verdict: true, reasons: reasons
      });
      var nouns=combinedNounsStr(coreItems, keptExtras);
      var pv=await previewCombined(coreItems, keptExtras, nouns);
      if(pv.early) return pv.early;
      var reply;
      if(removedFromCore) reply="Got it, loveling \u2014 set aside your "+noun+" for now \u2728 Let me re-weave the rest into something lovely. Your "+coreNounStr(coreItems)+" are looking darling together. Fit check: valid \u2714";
      else reply="Set aside your "+noun+", loveling \u2014 your "+coreNounStr(coreItems)+" still stand. Fit check: valid \u2714";
      reply+=shoesHad?" Your shoes stay on top as your extra \u2728.":" And your shoes join on top \u2014 your pick outside my fit rules \u2728.";
      if(pv.imageDelivery.requested&&!pv.imageDelivery.delivered) reply+=CAVEAT;
      return { text: reply, image: pv.img, persist:{ summaryDelta: removedFromCore?("Revised look, removed "+noun+" for shoes."):("Set aside extra "+noun+" for shoes."), preferencesDelta: "Prefers without "+noun+", with shoes." }, skill:"revise_look", meta: outMetaFor(pv) };
    }

    // Shoes are extras-only (backed by a real catalogued shoes piece —
    // strictShape never admits them to a core). They never reach the
    // pool shaping below; with no current look there is nothing for
    // them to ride on.
    if(required==="shoes" && !cat){
      var lookShoes=lastValidLook(catalog);
      if(lookShoes) return await addShoesTurn(lookShoes);
      return shoeNoLookTurn();
    }
    if(cat && required==="shoes"){
      var lookSwapShoes=lastValidLook(catalog);
      if(lookSwapShoes && stack && typeof stack.validateSelection==="function" && assembleLook){
        return await swapToShoesTurn(lookSwapShoes);
      }
      return shoeNoLookTurn();
    }
    // Pure ADD (an add-target, no removal target): build on the current
    // look instead of re-weaving — the addition joins the core only when
    // core+addition still passes the fit rules, else it rides on top.
    // No current look (or nothing to validate with) falls through to
    // today's re-weave below.
    if(!cat && required){
      var reqAlive=active.some(function(p){ return p && p.category===required; });
      if(reqAlive && stack && typeof stack.validateSelection==="function" && assembleLook){
        var lookAdd=lastValidLook(catalog);
        if(lookAdd) return await pureAddTurn(lookAdd);
      }
      // else: fall through (no such piece, no look, or no stack).
    }
    // Pure removal of a category that lives only in extras: drop just
    // the extra, keep the core look and remaining extras unchanged.
    if(cat && !required){
      var lookRem=lastValidLook(catalog);
      if(lookRem && isExtraOnlyDrop(lookRem, cat, liveMapOf(active))){
        return await extraDropTurn(lookRem);
      }
      // else: fall through to the re-weave.
    }

    var sel=selectCore(cat, required);
    var excluded=sel.excluded, requiredPieces=sel.requiredPieces, requiredMissing=sel.requiredMissing,
      requiredPresent=sel.requiredPresent, candidates=sel.candidates,
      chosen=sel.chosen, card=sel.card, rejected=sel.rejected;

    var reply, img=null;
    if(chosen){
      // Re-weaves keep existing extras on top of the new core (minus the
      // removed category and anything the new core already holds); every
      // preview and the recorded turn carry core then extras.
      var carryLook=lastValidLook(catalog);
      var carryFrom=carryLook?carryLook.extras:[];
      var keptExtras=carryExtras(carryFrom, cat, chosen, candidates);
      var combinedAll=combinedPreviewItems(candidates, chosen, keptExtras);
      var nouns=combinedNounsStr(chosen, keptExtras);
      if(excluded.length>0 && requiredPresent) reply="Got it, loveling \u2014 set aside your "+plainNoun(cat)+" and brought back your "+plainNoun(required)+" \u2728 Let me re-weave the rest into something lovely.";
      else if(excluded.length>0) reply="Got it, loveling \u2014 set aside your "+plainNoun(cat)+" for now \u2728 Let me re-weave the rest into something lovely.";
      else if(requiredPresent && cat) reply="No "+plainNoun(cat)+" in the mix right now, darling \u2014 but I brought back your "+plainNoun(required)+" \u2728";
      else if(requiredPresent) reply="Got it, loveling \u2014 brought back your "+plainNoun(required)+" \u2728 Let me re-weave things into something lovely.";
      else reply="No "+plainNoun(cat)+" in the mix right now, darling \u2014 but I\u2019ll re-check the fit with what we\u2019ve got \u2728";
      reply+=" Your "+coreNounStr(chosen)+" are looking darling together.";
      if(card && card.valid===true) reply+=" Fit check: valid \u2714";
      if(keptExtras.length>0) reply+=" Plus your "+extraNounStr(keptExtras)+" riding on top \u2014 your pick outside the fit rules \u2728.";
      var onUserReviseCtx=text;
      if(keptExtras.length>0) onUserReviseCtx+=(onUserReviseCtx?" ":"")+"Note: my extras ("+extraNounStr(keptExtras)+") are styled on top of the fit-checked look.";
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
        var onUserRevised=await stackForProfile.requestOnUserPreview({
          skill: "revise_look",
          metaClient: metaClient, headshot: gateProf.headshot, fullBody: gateProf.full_body,
          activePieces: candidates, chosenItems: combinedAll,
          nouns: nouns, context: onUserReviseCtx, shareId: shareId, stageImage: stageImage, toolSteps: 0
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
      // Multi-reference flat-lay: the shared selection-stack helper builds
      // one ref per chosen piece (384px original-derived, thumb fallback)
      // in selection order — the same helper the render path above uses.
      // More refs than the 4 proxy slots pre-combine into ONE composite
      // reference sheet that counts as one ref.
      var garFlat=null;
      try{
        if(stackForProfile&&typeof stackForProfile.buildGarmentImages==="function"){
          garFlat=stackForProfile.buildGarmentImages(candidates, combinedAll, 4);
        } else if(stackForProfile&&typeof stackForProfile.buildGarmentRefUrls==="function"){
          var garLegacy=stackForProfile.buildGarmentRefUrls(candidates, chosen);
          garFlat={ images: garLegacy.urls, mode: "individual", refs: garLegacy.refs,
            orderedNouns: [], total: chosen.length, represented: garLegacy.urls.length,
            downgraded: garLegacy.downgraded, payloadBytes: garLegacy.payloadBytes };
        }
      }catch(e){ garFlat=null; }
      var refThumbs=[], auditRefsFlat=[], flatMode="individual", flatRepresented=0, flatTotal=combinedAll.length, flatNouns=[];
      if(garFlat&&Array.isArray(garFlat.images)&&garFlat.images.length>0){
        refThumbs=garFlat.images.slice(0,4);
        flatMode=garFlat.mode==="composite"?"composite":"individual";
        flatRepresented=garFlat.represented;
        flatTotal=garFlat.total;
        flatNouns=Array.isArray(garFlat.orderedNouns)?garFlat.orderedNouns:[];
        // A composite sheet carries every ref in its one image: keep all
        // audit rows, not just one per attached image.
        auditRefsFlat=flatMode==="composite"
          ? (Array.isArray(garFlat.refs)?garFlat.refs:[]).slice()
          : (Array.isArray(garFlat.refs)?garFlat.refs:[]).slice(0,refThumbs.length);
      } else if(!garFlat){
        // Helper unavailable: legacy single-thumb fallback (first chosen
        // piece with a photo_thumb), never more than one ref.
        for(var ti2=0;ti2<chosen.length;ti2++){
          var lp2=byId[chosen[ti2].id];
          if(lp2&&typeof lp2.photo_thumb==="string"&&/^data:image\//.test(lp2.photo_thumb)){
            var legacyLen=0;
            try{ if(stackForProfile&&typeof stackForProfile.refBytesLen==="function") legacyLen=stackForProfile.refBytesLen(lp2.photo_thumb); }catch(e2){ legacyLen=0; }
            refThumbs=[lp2.photo_thumb];
            auditRefsFlat=[{ piece_id: chosen[ti2].id, category: chosen[ti2].category, ref_source:"photo_thumb", ref_bytes: legacyLen, downgraded:true }];
            flatRepresented=1;
            break;
          }
        }
      }
      var missingRefsFlat=flatTotal-flatRepresented;
      var previewPrompt="Y2K fairycore flat-lay look card, soft pastel background, garments laid out neatly: "+nouns+". No people, no worn try-on, no readable text.";
      if(keptExtras.length>0) previewPrompt+=" The "+extraNounStr(keptExtras)+" ride along as extra styling on top of the fit-checked look.";
      if(refThumbs.length>0){
        if(flatMode==="composite"){
          previewPrompt+=" The attached image is a reference sheet of the "+flatRepresented+" selected garments arranged in a grid, read left-to-right, top-to-bottom: "+flatNouns.join(", ")+".";
          previewPrompt+=" Lay each garment from the sheet out as a separate flat-lay item, preserving each garment's colour, print, silhouette, and details; do not reproduce the grid, white background, or sheet layout itself; do not substitute generic garments; do not add unreferenced garments; no person/try-on/readable text.";
        } else {
          previewPrompt+=" Use the attached reference garment photo for the true colors and silhouette.";
          previewPrompt+=" Each attached image is a distinct wardrobe garment; preserve the colour, print, silhouette, and details of every attached reference as a separate flat-lay item; do not substitute generic garments; do not add unreferenced garments; no person/try-on/readable text.";
        }
        if(missingRefsFlat>0){
          previewPrompt+=" Only "+flatRepresented+" of "+combinedAll.length+" selected pieces have reference photos; the remaining piece(s) are not represented in references.";
        }
      }
      if(metaClient&&typeof metaClient.preview==="function"){
        imageDelivery.requested=true; imageDelivery.reason="preview_failed";
        // Audit the request via the shared propose_look ring (facts only —
        // ids, counts, prompt text; the ref bytes are never recorded).
        // Fail-closed: a logging problem must never break the reply.
        try{
          if(stackForProfile&&typeof stackForProfile.recordPreviewAudit==="function"){
            var flatPayloadBytes=0;
            for(var ai=0;ai<auditRefsFlat.length;ai++){ if(typeof auditRefsFlat[ai].ref_bytes==="number") flatPayloadBytes+=auditRefsFlat[ai].ref_bytes; }
            stackForProfile.recordPreviewAudit({
              skill:"revise_look", renderOnUser:false,
              refs: auditRefsFlat,
              previewPromptPreview: previewPrompt,
              totalRefs: refThumbs.length, totalPayloadBytes: flatPayloadBytes,
              mode: flatMode
            });
          }
        }catch(auditErr){}
        try{
          var previewRefFlat=null;
          if(refThumbs.length===1) previewRefFlat=refThumbs[0];
          else if(refThumbs.length>1) previewRefFlat=refThumbs;
          var pr=await metaClient.preview(previewPrompt, previewRefFlat);
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
    if(revisedVerdict) revisedReasons=revisedReasons.concat(extraReasonsOf(keptExtras));
    recordReviseTurn(catalog, {
      userText: typeof text==="string" ? text : "",
      proposal: (revisedVerdict && (revisedFinish==="layer"||revisedFinish==="scarf+bag")) ? {
        pieces: chosen.map(function(it){ return it.id; }),
        extras: keptExtras,
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
      outMeta.referenceMode=renderOnUserMeta.referenceMode;
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
