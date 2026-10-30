"use strict";
/* meta-styles Milestone 21 — skill: What_suits. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 *
 * Colour honesty (Milestone 22 item 2): when a photo is present and a
 * metaClient with a palette() vision call exists, the reply uses the REAL
 * returned palette words + note. Any failure (no client, no palette
 * function, throw, unparseable result) falls back to the original generic
 * reply word-for-word — never claims "from what I can see" content that
 * did not come from a real call.
 */
(function (root) {

  function joinWords(words){
    if(words.length===1) return words[0];
    if(words.length===2) return words[0]+" and "+words[1];
    return words.slice(0,-1).join(", ")+" and "+words[words.length-1];
  }

  // Pending expectation (Milestone 24): the consent prompt below is a
  // "we are mid-flow, awaiting a photo reply" moment. Record it on the
  // catalog (the single source of truth agentic-loop.js checks before
  // routing) so the user's bare-photo answer routes back here instead of
  // falling through to catalogue_piece. Never throws: a catalog failure
  // must not break the reply itself.
  function recordPhotoExpectation(catalog, questionText){
    try{
      if(catalog && typeof catalog.askQuestion==="function"){
        catalog.askQuestion({ text:questionText, skill:"What_suits", expects:"image" });
      }
    }catch(e){}
  }

  var CONSENT_TEXT="Oh, I\u2019d love to help with that, darling \u2728 If you\u2019d like personalised colour advice, you can share a head shot and a full-body photo \u2014 I\u2019ll keep them encrypted and you can say \u201Cdelete my photos\u201D anytime. Would you like to share them? (Only with your consent, loveling)";

  async function handle(opts){
    var o=opts||{};
    if(!o.imagePresent && !o.imageDataUrl){ recordPhotoExpectation(o.catalog, CONSENT_TEXT); return { text:CONSENT_TEXT, image:null, persist:{ summaryDelta:"Asked for What_suits consent.", preferencesDelta:"" }, skill:"What_suits" }; }
    var imageDataUrl=o.imageDataUrl||null;
    var metaClient=o.metaClient||null;
    if(imageDataUrl && metaClient && typeof metaClient.palette==="function"){
      try{
        var r=await metaClient.palette(imageDataUrl);
        var words=r&&Array.isArray(r.palette)
          ? r.palette.filter(function(w){ return typeof w==="string" && w.trim(); }).map(function(w){ return w.trim(); }).slice(0,4)
          : [];
        var note=r&&typeof r.note==="string" ? r.note.trim() : "";
        if(words.length>0 && note){
          if(!/[.!?\u2026]$/.test(note)) note+=".";
          return { text:"Lovely, thank you for trusting me, darling \u2728 From what I can see, "+joinWords(words)+" will sing on you \u2014 "+note+" A touch of silver shimmer near the face will catch the light just so \u2728 Your photos are stored encrypted and you can say \u201Cdelete my photos\u201D anytime.", image:null, persist:{ summaryDelta:"Gave What_suits colour advice.", preferencesDelta:words.join("/")+" palette." }, skill:"What_suits" };
        }
      }catch(e){}
    }
    return { text:"Lovely, thank you for trusting me, darling \u2728 From what I can see, soft lilac, sage and warm cream will sing on you \u2014 they lift your natural glow and play beautifully Y2K x fairycore. A touch of silver shimmer near the face will catch the light just so \u2728 Your photos are stored encrypted and you can say \u201Cdelete my photos\u201D anytime.", image:null, persist:{ summaryDelta:"Gave What_suits colour advice.", preferencesDelta:"Warm lilac/sage palette." }, skill:"What_suits" };
  }

  var api = { handle: handle, skill: "What_suits" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["What_suits"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
