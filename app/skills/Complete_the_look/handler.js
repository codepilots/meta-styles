"use strict";
/* meta-styles Milestone 21 — skill: Complete_the_look. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 */
(function (root) {

  var VINTED="https://www.vinted.co.uk/search?q=";
  function vintedUrl(t){ return VINTED+encodeURIComponent(t); }
  async function handle(opts){
    var o=opts||{}, catalog=o.catalog;
    var active=catalog? catalog.getActivePieces():[];
    var hasScarf=active.some(function(p){ return p.category==="scarf"; }), hasBag=active.some(function(p){ return p.category==="bag"; });
    var gap="moss-green wool scarf", advice="A soft, light-catching scarf would tie it all together, loveling \u2728";
    if(hasScarf&&!hasBag){ gap="silver metallic mini bag"; advice="A little silver bag would be the perfect finishing touch, darling \u2014 wear it high under the arm for that Y2K shine \u2728"; }
    else if(!active.some(function(p){ return p.category==="layer/cardigan"||p.category==="layer/blazer"; })&&!hasScarf&&!hasBag){ gap="cream pointelle cardigan"; advice="A cropped cardigan worn open would give you that cosy fairycore finish, loveling \u2728"; }
    return { text: advice+" If you\u2019d like to browse, here\u2019s a gentle starting point: "+vintedUrl(gap)+" \u2014 just a generic search, darling, buying stays entirely with you \u2728", image:null, persist:{ summaryDelta:"Suggested gap piece: "+gap+".", preferencesDelta:"" }, skill:"Complete_the_look" };
  }

  var api = { handle: handle, skill: "Complete_the_look" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["Complete_the_look"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
