"use strict";
/* meta-styles Milestone 21 — skill: describe_wardrobe. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 */
(function (root) {

  function plainNoun(c){ var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag"}; return m[c]||c; }

  // Pending expectation (Milestone 24): the "Want me to put a look
  // together from these beauties?" closer below is a yes/no moment — a
  // plain "yes" matches no router trigger and would otherwise fall to
  // off_topic instead of firing propose_look. Only recorded on the
  // non-empty branch (the empty wardrobe's "share a photo" prompt
  // correctly routes to catalogue_piece already). Never throws.
  function recordLookExpectation(catalog, questionText){
    try{
      if(catalog && typeof catalog.askQuestion==="function"){
        catalog.askQuestion({ text:questionText, skill:"propose_look", expects:"yes_no" });
      }
    }catch(e){}
  }

  async function handle(opts){
    var o=opts||{}, catalog=o.catalog;
    var active=catalog? catalog.getActivePieces():[];
    if(active.length===0) return { text:"Your wardrobe\u2019s a blank canvas right now, loveling \u2728 Share a photo and I\u2019ll catalogue your first piece \u2014 then we can start making looks together!", image:null, persist:{summaryDelta:"Described empty wardrobe.",preferencesDelta:""}, skill:"describe_wardrobe" };
    var grouped={}; active.forEach(function(p){ var k=plainNoun(p.category); if(!grouped[k]) grouped[k]=[]; grouped[k].push(p); });
    var lines=["Here\u2019s what we\u2019ve gathered together, darling \u2728"];
    Object.keys(grouped).forEach(function(k){ lines.push("\u2022 "+k+": "+grouped[k].length+" piece"+(grouped[k].length>1?"s":"")); });
    lines.push("Want me to put a look together from these beauties?");
    var replyText = lines.join("\n");
    recordLookExpectation(catalog, replyText);
    return { text: replyText, image:null, persist:{ summaryDelta:"Described wardrobe: "+active.length+" pieces.", preferencesDelta:"" }, skill:"describe_wardrobe" };
  }

  var api = { handle: handle, skill: "describe_wardrobe" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["describe_wardrobe"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
