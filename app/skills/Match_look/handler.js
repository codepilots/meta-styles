"use strict";
/* meta-styles Milestone 21 — skill: Match_look. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 */
(function (root) {

  function plainNoun(c){ var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag"}; return m[c]||c; }
  async function handle(opts){
    var o=opts||{}, catalog=o.catalog, imageDataUrl=o.imageDataUrl||null;
    var active=catalog? catalog.getActivePieces():[];
    var desc="I see soft Y2K x fairycore vibes, loveling \u2014 lovely layering, shimmer and gentle colour. \u2728";
    if(o.metaClient&&imageDataUrl) try{ var r=await o.metaClient.classify(imageDataUrl,"inspiration"); if(r&&r.category) desc="I see a beautiful "+plainNoun(r.category)+" moment, loveling \u2014 soft layers and shimmer with a Y2K twist \u2728"; }catch(e){}
    if(active.length===0) return { text: desc+" Your wardrobe\u2019s empty just now, so I can\u2019t match it yet \u2014 share a few pieces and I\u2019ll find the closest cousins!", image:null, persist:{ summaryDelta:"Match_look: no wardrobe to match.", preferencesDelta:"" }, skill:"Match_look" };
    var nouns=active.slice(0,3).map(function(p){ return plainNoun(p.category); }).join(" + ");
    return { text: desc+" From your own wardrobe, your "+nouns+" come closest, darling \u2014 let\u2019s style them together for a similar feel! \u2728", image:{ url:"https://example.invalid/SYNTH_match_"+Date.now()+".png", caption: nouns+" \u2014 inspired match, styled with love by Second Bloom" }, persist:{ summaryDelta:"Matched look from wardrobe.", preferencesDelta:"" }, skill:"Match_look" };
  }

  var api = { handle: handle, skill: "Match_look" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["Match_look"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
