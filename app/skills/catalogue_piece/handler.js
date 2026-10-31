"use strict";
/* meta-styles Milestone 21 + multi-detect — skill: catalogue_piece. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 */
(function (root) {

  function plainNoun(c){ var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag"}; return m[c]||c; }

  function recordLookExpectation(catalog, questionText){
    try{
      if(catalog && typeof catalog.askQuestion==="function"){
        catalog.askQuestion({ text:questionText, skill:"propose_look", expects:"yes_no" });
      }
    }catch(e){}
  }

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

  async function segmentRect(imageDataUrl, metaClient, phrase){
    try{
      if(!metaClient||typeof metaClient.segment!=="function"||!imageDataUrl) return null;
      var out=await metaClient.segment(imageDataUrl,[phrase]);
      if(!out||!Array.isArray(out.boxes)) return null;
      var b=pickBox(out.boxes);
      return b?b.rect:null;
    }catch(e){ return null; }
  }

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

  function computeCropHash(croppedOriginal){
    if(!croppedOriginal || typeof croppedOriginal!=="string") return null;
    try{
      var m=/^data:[^,]+;base64,([A-Za-z0-9+/=]+)$/.exec(croppedOriginal);
      var bytes;
      if(m){
        if(typeof Buffer!=="undefined") bytes=Buffer.from(m[1],"base64");
        else return null;
      } else {
        if(typeof Buffer!=="undefined") bytes=Buffer.from(croppedOriginal,"utf8");
        else return null;
      }
      var crypto=null;
      try{ if(typeof require!=="undefined") crypto=require("crypto"); }catch(e){}
      if(crypto && typeof crypto.createHash==="function"){
        return crypto.createHash("sha256").update(bytes).digest("hex").slice(0,16);
      }
      return null;
    }catch(e){ return null; }
  }

  // Build region crops: for each usable region, crop via SAM refinement then capture thumb+original+hash.
  async function buildRegions(imageDataUrl, detectPieces, metaClient, sid){
    var regions=[];
    for(var i=0;i<detectPieces.length;i++){
      var dp=detectPieces[i];
      if(!dp||!dp.bbox||!validRect(dp.bbox)) continue;
      var phrase=plainNoun(dp.category)||"garment";
      var rect=dp.bbox;
      // SAM refines each box with category phrase when proxy segment succeeds
      var samRect=null;
      try{
        samRect=await segmentRect(imageDataUrl, metaClient, phrase);
      }catch(e){ samRect=null; }
      var cropRect=samRect||dp.bbox;
      var thumb=captureThumb(imageDataUrl,cropRect);
      var original=captureOriginal(imageDataUrl);
      var hashInput=(thumb||original||imageDataUrl)+"|"+dp.category+"|"+dp.bbox.join(",");
      var ch=computeCropHash(hashInput);
      var attrs={};
      if(dp.attributes && typeof dp.attributes==="object"){
        if(dp.attributes.color) attrs.color=dp.attributes.color;
      }
      if(dp.layer_role) attrs.layer_role=dp.layer_role;
      regions.push({
        category: dp.category,
        attributes: attrs,
        bbox: dp.bbox,
        cropRect: cropRect,
        thumb: thumb,
        original: original,
        crop_hash: ch||("SYNTH_hash_"+i+"_"+Date.now()),
        source_share_id: sid
      });
    }
    return regions;
  }

  // Add path: invoked when turn text is YES for pending detection
  async function handleAddDetected(o){
    var catalog=o.catalog;
    var bag=o.pendingBag;
    if(!catalog||!bag||!Array.isArray(bag.regions)||!bag.regions.length){
      return { text:"Oh loveling, that little bundle seems to have fluttered away \u2728 Mind resending the photo and I'll give it another go?", image:null, persist:{ summaryDelta:"No bag to add.", preferencesDelta:"" }, skill:"catalogue_piece" };
    }
    // dedupe against existing pieces by crop_hash
    var existing=[];
    try{ existing=catalog.getPieces()||[]; }catch(e){ existing=[]; }
    var existingHashes={};
    for(var ei=0;ei<existing.length;ei++){
      var ep=existing[ei];
      if(ep&&ep.crop_hash) existingHashes[ep.crop_hash]=true;
    }
    var added=[];
    for(var ri=0;ri<bag.regions.length;ri++){
      var reg=bag.regions[ri];
      if(!reg) continue;
      if(reg.crop_hash && existingHashes[reg.crop_hash]) continue;
      var sidPerRegion = (reg.source_share_id && typeof reg.source_share_id==="string") ? reg.source_share_id : (bag.source_share_id||o.shareId||"SYNTH_share_"+Date.now());
      var input={ category:reg.category, attributes:reg.attributes||{}, source_share_id:sidPerRegion };
      if(reg.thumb) input.photo_thumb=reg.thumb;
      if(reg.original) input.image_original=reg.original;
      if(reg.crop_hash) input.crop_hash=reg.crop_hash;
      try{
        var p=catalog.addPiece(input);
        added.push(p);
        if(reg.crop_hash) existingHashes[reg.crop_hash]=true;
      }catch(e){
        // duplicate piece_id or validation edge: try without thumb
        try{
          var bare={ category:reg.category, attributes:reg.attributes||{}, source_share_id:sidPerRegion };
          if(reg.crop_hash) bare.crop_hash=reg.crop_hash;
          var p2=catalog.addPiece(bare);
          added.push(p2);
          if(reg.crop_hash) existingHashes[reg.crop_hash]=true;
        }catch(e2){}
      }
    }
    if(added.length){
      try{ if(catalog.save) await catalog.save(); }catch(e){}
    }
    // resolve pending expectation
    try{
      var pqs=catalog.getPendingQuestions()||[];
      for(var qi=0;qi<pqs.length;qi++){
        if(pqs[qi]&&pqs[qi].skill==="catalogue_piece"&&pqs[qi].expects==="yes_no"){
          try{ catalog.resolveQuestion(pqs[qi].id); }catch(e){}
        }
      }
    }catch(e){}
    if(!added.length){
      return { text:"Those pieces are already in your wardrobe, loveling \u2728 — keeping one copy of each safe. Want me to put a look together from what you've got?", image:null, persist:{ summaryDelta:"Already had all pieces.", preferencesDelta:"" }, skill:"catalogue_piece" };
    }
    var nouns=added.map(function(p){ return plainNoun(p.category); });
    var summary=nouns.join(", ");
    // honest summary
    var countText=added.length===1? "1 piece in" : added.length+" pieces in";
    var reply=countText+", loveling \u2728 — "+summary+" are yours now.";
    // try same-turn look proposal
    var lookRes=await trySameTurnProposal(o);
    if(lookRes&&lookRes.meta&&typeof lookRes.meta.selectedCount==="number"&&lookRes.meta.selectedCount>0&&typeof lookRes.text==="string"&&lookRes.text){
      reply += " "+lookRes.text;
      var lookPersist="Added "+added.length+" pieces: "+summary+". "+((lookRes.persist&&lookRes.persist.summaryDelta)||"Proposed a look.");
      return { text:reply, image:lookRes.image||null,
        persist:{ summaryDelta:lookPersist, preferencesDelta:"" }, skill:"catalogue_piece",
        meta:{ source:(lookRes.meta&&lookRes.meta.source)||"fallback", selectedCount:lookRes.meta.selectedCount,
          rejectedReason:(lookRes.meta&&lookRes.meta.rejectedReason)||null,
          imageDelivery:(lookRes.meta&&lookRes.meta.imageDelivery)||{ requested:false, generated:false, delivered:false, reason:"no_same_turn_look_image" } } };
    }
    reply += " Want me to put a look together from what you've got?";
    recordLookExpectation(catalog, reply);
    return { text:reply, image:null, persist:{ summaryDelta:"Added "+added.length+" pieces: "+summary+".", preferencesDelta:"" }, skill:"catalogue_piece" };
  }

  function handleDiscard(o){
    var catalog=o.catalog;
    try{
      var pqs=catalog&&typeof catalog.getPendingQuestions==="function"?catalog.getPendingQuestions()||[]:[];
      for(var qi=0;qi<pqs.length;qi++){
        if(pqs[qi]&&pqs[qi].skill==="catalogue_piece"&&pqs[qi].expects==="yes_no"){
          try{ catalog.resolveQuestion(pqs[qi].id); }catch(e){}
          break;
        }
      }
    }catch(e){}
    return { text:"No worries, loveling \u2728 — I left those out. Just say the word if you change your mind!", image:null, persist:{ summaryDelta:"Declined multi-piece add.", preferencesDelta:"" }, skill:"catalogue_piece" };
  }

  function isNegativeReply(text){
    if(typeof text!=="string") return false;
    var t=text.toLowerCase().trim().replace(/^[.,!?\s]+|[.,!?\s]+$/g,"");
    var negs=["no","nope","nah","not now","no thanks","no thank you","never mind","cancel","skip","pass","no thank you loveling"];
    for(var i=0;i<negs.length;i++){ if(t===negs[i]) return true; }
    if(t==="no"||t==="nope"||t==="nah") return true;
    return false;
  }

  async function handle(opts){
    var o=opts||{}, catalog=o.catalog, text=o.text||"", imageDataUrl=o.imageDataUrl||null;

    // Discard/add path for pending bag text replies (no image)
    if(!imageDataUrl && o.pendingBag && catalog){
      var pqs=null;
      try{ pqs=catalog.getPendingQuestions()||[]; }catch(e){}
      var hasPending=false;
      if(pqs) for(var pi=0;pi<pqs.length;pi++){ if(pqs[pi]&&pqs[pi].skill==="catalogue_piece"&&pqs[pi].expects==="yes_no"){ hasPending=true; break; } }
      if(hasPending){
        // Check if bag expired — caller sets pendingBag null on expiry, but double-check TTL here too
        var isNeg=isNegativeReply(text);
        if(isNeg) return handleDiscard(o);
        // affirmative path — use agentic-loop's isAffirmative logic already checked before routing here,
        // but handler also accepts plain "yes"
        return await handleAddDetected(o);
      }
    }

    // Text-only no-pending branch: honest reply instead of photo-failure copy
    if(!imageDataUrl && o.pendingBag === null){
      return { text:"Nothing pending, loveling \u2728 \u2014 send a photo to catalogue pieces, or ask for what to wear!", image:null, persist:{ summaryDelta:"No pending catalogue.", preferencesDelta:"" }, skill:"catalogue_piece" };
    }

    var pieces=[];
    if(catalog && imageDataUrl){
      var sid=(o && typeof o.shareId==="string" && o.shareId) ? o.shareId : ("SYNTH_share_"+Date.now());
      // Idempotent guard for single-piece era: same source_share_id
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
        var dupLookRes=await trySameTurnProposal(o);
        if(dupLookRes&&dupLookRes.meta&&typeof dupLookRes.meta.selectedCount==="number"&&dupLookRes.meta.selectedCount>0&&typeof dupLookRes.text==="string"&&dupLookRes.text){
          var dupLookText="That "+dupNoun+" (#"+_disc+") is already in your wardrobe, loveling \u2728 — keeping one copy safe. "+dupLookRes.text;
          var dupLookPersist="Already in wardrobe — keeping one copy. "+((dupLookRes.persist&&dupLookRes.persist.summaryDelta)||"Proposed a look.");
          try{ if(catalog&&typeof catalog.recordTurn==="function") catalog.recordTurn({ userText:text, proposal:null, verdict:true, reasons:["idempotent_catalogue_guard"] }); }catch(e){}
          recordLookExpectation(catalog, dupLookText);
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

      // Detection path: try metaClient.detectGarments
      var detectResult=null;
      var detectUsable=null;
      if(o.metaClient && typeof o.metaClient.detectGarments==="function"){
        try{
          detectResult=await o.metaClient.detectGarments(imageDataUrl);
          if(detectResult && Array.isArray(detectResult.pieces)){
            // filter to usable: sane bbox + valid category
            var usable=[];
            for(var di=0;di<detectResult.pieces.length;di++){
              var dr=detectResult.pieces[di];
              if(!dr||!dr.bbox||!validRect(dr.bbox)) continue;
              if(!dr.category) continue;
              usable.push(dr);
            }
            if(!detectResult.placeholder && usable.length>=1){
              detectUsable=usable;
            }
          }
        }catch(e){ detectUsable=null; }
      }

      if(detectUsable && detectUsable.length>=1){
        // Detect-bearing: build regions, store bag, ask (covers single too for batch uniformity)
        var regions=await buildRegions(imageDataUrl, detectUsable, o.metaClient, sid);
        // Cap at 6 already done at proxy; ensure here too
        if(regions.length>6) regions=regions.slice(0,6);
        if(regions.length>=1){
          var bag={ at: Date.now(), regions: regions, source_share_id: sid };
          if(o.pendingBag!==undefined){
            o.pendingBag=bag;
          }
          // Build persona listing
          var foundNouns=regions.map(function(r){ return plainNoun(r.category); });
          var listStr="";
          if(foundNouns.length===2) listStr=foundNouns[0]+" and "+foundNouns[1];
          else if(foundNouns.length>2) listStr=foundNouns.slice(0,-1).join(", ")+" and "+foundNouns[foundNouns.length-1];
          else listStr=foundNouns.join(", ");
          var askText="Found "+regions.length+" pieces in that photo, loveling \u2728 — a "+listStr+". Shall I add all of them?";
          try{
            if(catalog&&typeof catalog.askQuestion==="function"){
              catalog.askQuestion({ text:askText, skill:"catalogue_piece", expects:"yes_no" });
            }
          }catch(e){}
          // Return with pendingBag attached for service to store on ctx
          return { text:askText, image:null, persist:{ summaryDelta:"Detected "+regions.length+" pieces, awaiting confirmation.", preferencesDelta:"" }, skill:"catalogue_piece", pendingBag: bag };
        }
        // fell through to single path if regions collapsed to 1
      }

      // Single-piece fallback: existing classify/segment/auto-add path
      var cat="dress";
      try{ if(o.metaClient&&o.metaClient.classify){ var cr=await o.metaClient.classify(imageDataUrl,""); if(cr&&cr.placeholder===true) throw new Error("classify placeholder"); if(cr&&cr.category) cat=cr.category; } }catch(e){}
      if(cat==="dress"){ var h=(text||"").toLowerCase(); if(/scarf/.test(h)) cat="scarf"; else if(/bag|purse/.test(h)) cat="bag"; else if(/blazer|jacket/.test(h)) cat="layer/blazer"; else if(/cardigan|shrug/.test(h)) cat="layer/cardigan"; else if(/top|cami/.test(h)) cat="base/top"; else if(/trouser|jean|skirt|bottom/.test(h)) cat="base/bottom"; }
      var phrase=plainNoun(cat)||"garment";
      if(typeof phrase!=="string"||!phrase) phrase="garment";
      var rect=await segmentRect(imageDataUrl,o.metaClient,phrase);
      var thumb=captureThumb(imageDataUrl,rect);
      var original=captureOriginal(imageDataUrl);
      var cropHashVal=null;
      if(thumb||original) cropHashVal=computeCropHash(thumb||original);
      var input={ category:cat, attributes:{}, source_share_id:sid };
      if(thumb) input.photo_thumb=thumb;
      if(original) input.image_original=original;
      if(cropHashVal) input.crop_hash=cropHashVal;
      try{ var p=catalog.addPiece(input); pieces.push(p); if(catalog.save) try{ await catalog.save(); }catch(e){} }catch(e){
        try{ var bareInput={ category:cat, attributes:{}, source_share_id:sid }; if(cropHashVal) bareInput.crop_hash=cropHashVal; var bare=catalog.addPiece(bareInput); pieces.push(bare); if(catalog.save) try{ await catalog.save(); }catch(e2){} }catch(e3){}
      }
    }
    var noun=pieces.length? plainNoun(pieces[0].category):"piece";
    if(!pieces.length){
      var failText="Oh loveling, I couldn't get that piece tucked into your wardrobe just now \u2728 Mind resending the photo and I'll give it another go? Want me to put a look together from what you've got?";
      recordLookExpectation(catalog, failText);
      return { text:failText, image:null, persist:{ summaryDelta:"Catalogued "+noun+".", preferencesDelta:"" }, skill:"catalogue_piece" };
    }
    var lookRes2=await trySameTurnProposal(o);
    if(lookRes2&&lookRes2.meta&&typeof lookRes2.meta.selectedCount==="number"&&lookRes2.meta.selectedCount>0&&typeof lookRes2.text==="string"&&lookRes2.text){
      var lookText="Got your "+noun+" \u2014 noted, loveling! \u2728 It's tucked safely in your wardrobe. "+lookRes2.text;
      var lookPersist="Catalogued "+noun+". "+((lookRes2.persist&&lookRes2.persist.summaryDelta)||"Proposed a look.");
      return { text:lookText, image:lookRes2.image||null,
        persist:{ summaryDelta:lookPersist, preferencesDelta:"" }, skill:"catalogue_piece",
        meta:{ source:(lookRes2.meta&&lookRes2.meta.source)||"fallback", selectedCount:lookRes2.meta.selectedCount,
          rejectedReason:(lookRes2.meta&&lookRes2.meta.rejectedReason)||null,
          imageDelivery:(lookRes2.meta&&lookRes2.meta.imageDelivery)||{ requested:false, generated:false, delivered:false, reason:"no_same_turn_look_image" } } };
    }
    var gapText="Got your "+noun+" \u2014 noted, loveling! \u2728 It's tucked safely in your wardrobe. A "+noun+" alone isn't a full look yet \u2014 it needs exactly one finish: one layer, or a scarf plus a bag. Share one of those next and I'll style the complete look. Want me to put a look together from what you've got?";
    recordLookExpectation(catalog, gapText);
    return { text:gapText, image:null, persist:{ summaryDelta:"Catalogued "+noun+".", preferencesDelta:"" }, skill:"catalogue_piece" };
  }

  var api = { handle: handle, skill: "catalogue_piece", handleAddDetected: handleAddDetected, plainNoun: plainNoun, validRect: validRect, computeCropHash: computeCropHash };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["catalogue_piece"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
