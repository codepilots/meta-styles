"use strict";
/* meta-styles Milestone 21 — skill: Evaluate_prospective_purchase. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 */
(function (root) {

  function plainNoun(c){ var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag"}; return m[c]||c; }
  async function handle(opts){
    var o=opts||{}, catalog=o.catalog;
    var active=catalog? catalog.getActivePieces():[];
    var intro="Ooh, let\u2019s have a look, loveling \u2728 I\u2019ll hold this one just for 24 hours while you decide \u2014 text first, preview only if you\u2019d like it.";
    if(active.length===0) return { text: intro+" Your wardrobe\u2019s empty just now, so I can\u2019t cross-check \u2014 but it looks like a darling piece on its own! Share a couple of wardrobe photos and I can show you how it would mix and match. (24hr hold, then I discard it unless you say you bought it \u2728)", image:null, persist:{ summaryDelta:"Evaluated prospective purchase (empty wardrobe).", preferencesDelta:"" }, skill:"Evaluate_prospective_purchase" };
    var nouns=active.slice(0,2).map(function(p){ return plainNoun(p.category); }).join(" and ");
    var outfits=["1. With your "+nouns+" \u2014 soft base, new piece as the finish","2. With your "+plainNoun(active[0].category)+" \u2014 let the new piece do the talking","3. Layered open over what you\u2019ve got \u2014 long line, fairycore shimmer"];
    return { text: intro+" From what you\u2019ve got, this could unlock "+outfits.length+" lovely outfits:\n"+outfits.join("\n")+"\n\nIt\u2019s held for 24 hours, darling \u2014 say \u201CI bought it\u201D to catalogue it properly, or I\u2019ll gently let it go. Want a preview image too? \u2728", image:null, persist:{ summaryDelta:"Evaluated prospective purchase: "+outfits.length+" outfits.", preferencesDelta:"" }, skill:"Evaluate_prospective_purchase" };
  }

  var api = { handle: handle, skill: "Evaluate_prospective_purchase" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["Evaluate_prospective_purchase"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
