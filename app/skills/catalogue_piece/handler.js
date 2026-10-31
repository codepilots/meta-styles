"use strict";
/* meta-styles Milestone 21 — skill: catalogue_piece. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 */
(function (root) {

  function plainNoun(c){ var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag"}; return m[c]||c; }

  // Pending expectation (Milestone 24): the "Want me to put a look
  // together from what you've got?" closer below is a yes/no moment — a
  // plain "yes" matches no router trigger and would otherwise fall to
  // off_topic instead of firing propose_look. Recorded on the catalog
  // (the single source of truth agentic-loop.js checks before routing).
  // Never throws: a catalog failure must not break the reply itself.
  function recordLookExpectation(catalog, questionText){
    try{
      if(catalog && typeof catalog.askQuestion==="function"){
        catalog.askQuestion({ text:questionText, skill:"propose_look", expects:"yes_no" });
      }
    }catch(e){}
  }

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

  // Original retention (M25): keep the received source data URL as
  // image_original when it passes JPEG/PNG magic sniff + 1 MB cap.
  // Oversize or non-image -> omit field (thumb-only piece), same
  // honest no-drama fallback as the thumb path. Never throws.
  function captureOriginal(imageDataUrl){
    try{
      if(typeof imageDataUrl!=="string"||!imageDataUrl) return null;
      var m=/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(imageDataUrl);
      if(!m) return null;
      var mime=m[1].toLowerCase();
      if(mime!=="image/png"&&mime!=="image/jpeg"&&mime!=="image/jpg") return null;
      var b64=m[2];
      var rawLen=0;
      try{
        if(typeof Buffer!=="undefined") rawLen=Buffer.from(b64,"base64").length;
        else rawLen=Math.ceil(b64.length*3/4);
      }catch(e){ return null; }
      if(rawLen>1*1024*1024) return null;
      if(imageDataUrl.length>1400000) return null;
      // Magic sniff on decoded bytes: PNG 89 50 4E 47..., JPEG FF D8 FF
      try{
        var bytes=typeof Buffer!=="undefined"?Buffer.from(b64,"base64"):null;
        if(bytes){
          if(bytes.length>=8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47) {/* png ok */}
          else if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff) {/* jpeg ok */}
          else return null;
        }
      }catch(e){ return null; }
      return imageDataUrl;
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

  // Same-turn proposal (two-photo wardrobe arc): after a piece is
  // catalogued, run the existing propose_look selection/validation stack
  // (Spark -> strictShape/assembleLook -> deterministic fallback) in the
  // same turn instead of ending on a classifier-only acknowledgement.
  // Reuses propose_look's handle() directly so the fit rules live in
  // exactly one place — never a second fit engine. Resolves the
  // propose_look result, or null on any failure (fail-soft: the caller
  // then falls back to the honest gap reply, never a broken turn).
  async function trySameTurnProposal(o){
    try{
      var mod=null;
      try{ if(typeof require!=="undefined") mod=require("../propose_look/handler.js"); }catch(e){ mod=null; }
      if((!mod||typeof mod.handle!=="function")&&root.MetaStyles&&root.MetaStyles.skills) mod=root.MetaStyles.skills["propose_look"];
      if(!mod||typeof mod.handle!=="function") return null;
      return await mod.handle({
        catalog:o.catalog, text:o.text||"", imageDataUrl:null,
        metaClient:o.metaClient||null, assembler:o.assembler||null,
        shareId:o.shareId||null, stageImage:o.stageImage||null
      });
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
      // Idempotent catalogue guard (2026-10-31 incident): retries after a
      // failed/partial send re-offer the same share id with media still
      // available. Check already-loaded pieces for a matching
      // source_share_id before adding — one catalogue per share, safe to
      // reply as often as needed. No load-time dedup, no wipe.
      var alreadyCatalogued=null;
      try{
        if(catalog&&typeof catalog.getPieces==="function"){
          var existing=catalog.getPieces();
          for(var gi=0;gi<existing.length;gi++){
            var ep=existing[gi];
            if(ep&&ep.source_share_id===sid){ alreadyCatalogued=ep; break; }
          }
        }
      }catch(e){ alreadyCatalogued=null; }
      if(alreadyCatalogued){
        // Honest idempotent turn: no second copy, no save, do not claim
        // a new addition. Still record the turn and allow the reply/send
        // to proceed — the caller handles send idempotency separately.
        // Per-piece discriminator: category noun + short stable piece field
        // (piece_id tail — never mid/user_ref) so duplicate_send backstop
        // (text_hash) does not swallow distinct pieces and idempotency
        // contract (same piece -> same text) still holds.
        var dupNoun=plainNoun(alreadyCatalogued.category)||"piece";
        var _disc=(function(p){
          try{
            if(p&&typeof p.piece_id==="string"&&p.piece_id){
              var id=p.piece_id;
              var tail=id.indexOf("_")!==-1?id.slice(id.lastIndexOf("_")+1):id.slice(-4);
              if(tail.length>4) tail=tail.slice(-4);
              return tail;
            }
            if(p&&typeof p.photo_thumb==="string"&&p.photo_thumb.length>30){
              return p.photo_thumb.slice(22,26);
            }
          }catch(e){}
          return "000";
        })(alreadyCatalogued);
        var dupGapText="That "+dupNoun+" (#"+_disc+") is already in your wardrobe, loveling \u2728 — keeping one copy safe. Want me to put a look together from what you've got?";
        // Try same-turn proposal even on idempotent replays — the wardrobe
        // may now have enough for a look. Deterministic-per-piece same-turn
        // wording for the same duplicate_send reason.
        var dupLookRes=await trySameTurnProposal(o);
        if(dupLookRes&&dupLookRes.meta&&typeof dupLookRes.meta.selectedCount==="number"&&dupLookRes.meta.selectedCount>0&&typeof dupLookRes.text==="string"&&dupLookRes.text){
          var dupLookText="That "+dupNoun+" (#"+_disc+") is already in your wardrobe, loveling \u2728 — keeping one copy safe. "+dupLookRes.text;
          var dupLookPersist="Already in wardrobe — keeping one copy. "+((dupLookRes.persist&&dupLookRes.persist.summaryDelta)||"Proposed a look.");
          // Record turn honestly: no new catalogue, but a turn did happen.
          try{ if(catalog&&typeof catalog.recordTurn==="function") catalog.recordTurn({ userText:text, proposal:null, verdict:true, reasons:["idempotent_catalogue_guard"] }); }catch(e){}
          recordLookExpectation(catalog, dupLookText);
          // If proposal path, propose_look already recorded its expectation; don't double.
          // Overwrite the expectation already recorded for the non-look path would be duplicate, so only return.
          return { text:dupLookText, image:dupLookRes.image||null,
            persist:{ summaryDelta:dupLookPersist, preferencesDelta:"" }, skill:"catalogue_piece",
            meta:{ source:(dupLookRes.meta&&dupLookRes.meta.source)||"fallback", selectedCount:dupLookRes.meta.selectedCount,
              rejectedReason:(dupLookRes.meta&&dupLookRes.meta.rejectedReason)||null,
              imageDelivery:(dupLookRes.meta&&dupLookRes.meta.imageDelivery)||{ requested:false, generated:false, delivered:false, reason:"no_same_turn_look_image" } } };
        }
        try{ if(catalog&&typeof catalog.recordTurn==="function") catalog.recordTurn({ userText:text, proposal:null, verdict:true, reasons:["idempotent_catalogue_guard"] }); }catch(e){}
        recordLookExpectation(catalog, dupGapText);
        return { text:dupGapText, image:null, persist:{ summaryDelta:"Already in wardrobe — keeping one copy.", preferencesDelta:"" }, skill:"catalogue_piece" };
      }
      // SAM-segment the crop: phrase names the detected category (plain
      // noun the proxy's SAM_LABEL_MAP understands), falling back to a
      // generic garment phrase. Any failure resolves null and the thumb
      // below is the whole photo, exactly as before this change.
      var phrase=plainNoun(cat)||"garment";
      if(typeof phrase!=="string"||!phrase) phrase="garment";
      var rect=await segmentRect(imageDataUrl,o.metaClient,phrase);
      var thumb=captureThumb(imageDataUrl,rect);
      var original=captureOriginal(imageDataUrl);
      var input={ category:cat, attributes:{}, source_share_id:sid };
      if(thumb) input.photo_thumb=thumb;
      if(original) input.image_original=original;
      try{ var p=catalog.addPiece(input); pieces.push(p); if(catalog.save) try{ await catalog.save(); }catch(e){} }catch(e){
        // The thumbnail must never block cataloguing: retry bare.
        try{ var bare=catalog.addPiece({ category:cat, attributes:{}, source_share_id:sid }); pieces.push(bare); if(catalog.save) try{ await catalog.save(); }catch(e2){} }catch(e3){}
      }
    }
    var noun=pieces.length? plainNoun(pieces[0].category):"piece";
    if(!pieces.length){
      var failText="Oh loveling, I couldn't get that piece tucked into your wardrobe just now \u2728 Mind resending the photo and I'll give it another go? Want me to put a look together from what you've got?";
      recordLookExpectation(catalog, failText);
      return { text:failText, image:null, persist:{ summaryDelta:"Catalogued "+noun+".", preferencesDelta:"" }, skill:"catalogue_piece" };
    }
    // A newly catalogued piece may complete a full look: run the
    // propose_look stack in this same turn.
    var lookRes=await trySameTurnProposal(o);
    if(lookRes&&lookRes.meta&&typeof lookRes.meta.selectedCount==="number"&&lookRes.meta.selectedCount>0&&typeof lookRes.text==="string"&&lookRes.text){
      // Valid look produced — the reply names the cross-piece combination
      // and the fit-rule result (propose_look's own text). propose_look
      // already recorded its revise_look yes/no expectation, so this path
      // records NO further expectation (a second one would be a duplicate
      // pointing at propose_look after the look already exists).
      var lookText="Got your "+noun+" \u2014 noted, loveling! \u2728 It's tucked safely in your wardrobe. "+lookRes.text;
      var lookPersist="Catalogued "+noun+". "+((lookRes.persist&&lookRes.persist.summaryDelta)||"Proposed a look.");
      return { text:lookText, image:lookRes.image||null,
        persist:{ summaryDelta:lookPersist, preferencesDelta:"" }, skill:"catalogue_piece",
        meta:{ source:(lookRes.meta&&lookRes.meta.source)||"fallback", selectedCount:lookRes.meta.selectedCount,
          rejectedReason:(lookRes.meta&&lookRes.meta.rejectedReason)||null,
          imageDelivery:(lookRes.meta&&lookRes.meta.imageDelivery)||{ requested:false, generated:false, delivered:false, reason:"no_same_turn_look_image" } } };
    }
    // No valid look yet: honest gap, never framed as a complete look.
    // The missing-finish rule is exact: one layer, or a scarf plus a bag.
    var gapText="Got your "+noun+" \u2014 noted, loveling! \u2728 It's tucked safely in your wardrobe. A "+noun+" alone isn't a full look yet \u2014 it needs exactly one finish: one layer, or a scarf plus a bag. Share one of those next and I'll style the complete look. Want me to put a look together from what you've got?";
    recordLookExpectation(catalog, gapText);
    return { text:gapText, image:null, persist:{ summaryDelta:"Catalogued "+noun+".", preferencesDelta:"" }, skill:"catalogue_piece" };
  }

  var api = { handle: handle, skill: "catalogue_piece" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["catalogue_piece"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
