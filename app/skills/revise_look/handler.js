"use strict";
/* meta-styles Milestone 21 — skill: revise_look. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 */
(function (root) {

  var REVISE_WORDS=[{ re:/\bbag\b|purse|handbag/, category:"bag" },{ re:/\bscarf\b|wrap\b/, category:"scarf" },{ re:/\bblazer\b|jacket|coat/, category:"layer/blazer" },{ re:/\bcardigan\b|shrug|tie-blouse|blouse/, category:"layer/cardigan" },{ re:/\bdress\b|gown/, category:"dress" },{ re:/\btop\b|cami|camisole|tee/, category:"base/top" },{ re:/\bbottom\b|jeans|skirt|trousers|pants|mini/, category:"base/bottom" }];
  function matchRevise(t){ if(typeof t!=="string") return null; if(!/\b(no|drop|remove|without|lose|ditch|swap|skip)\b/i.test(t)) return null; for(var i=0;i<REVISE_WORDS.length;i++) if(REVISE_WORDS[i].re.test(t.toLowerCase())) return REVISE_WORDS[i].category; return null; }
  function plainNoun(c){ var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag"}; return m[c]||c; }
  async function handle(opts){
    var o=opts||{}, catalog=o.catalog, text=o.text||"";
    var cat=matchRevise(text), removed=[];
    if(cat&&catalog){ catalog.getActivePieces().filter(function(p){ return p.category===cat; }).forEach(function(p){ try{ catalog.rejectPiece(p.piece_id); removed.push(p); }catch(e){} }); if(catalog.save) try{ await catalog.save(); }catch(e){} }
    var MS=root.MetaStyles||{}, reply, img=null;
    if(removed.length>0) reply="Got it, loveling \u2014 set aside your "+plainNoun(cat)+" for now \u2728 Let me re-weave the rest into something lovely.";
    else if(cat) reply="No "+plainNoun(cat)+" in the mix right now, darling \u2014 but I\u2019ll re-check the fit with what we\u2019ve got \u2728";
    else reply="Tell me a little more, loveling \u2014 which piece would you like to swap or skip? \u2728";
    if(catalog&&MS.assembleLook&&catalog.getActivePieces().length>0){ var active=catalog.getActivePieces(); var items=active.map(function(p){ return { id:p.piece_id, category:p.category, copy:{ text:"SYNTH "+p.category, placeholder:true, note:"" } }; }); var card=MS.assembleLook(items); var nouns=items.map(function(it){ return plainNoun(it.category); }).join(" + "); reply+=" Your "+nouns+" are looking darling together."; if(card.valid) reply+=" Fit check: valid \u2714"; img={ url:"https://example.invalid/SYNTH_preview_rev_"+Date.now()+".png", caption: nouns+" \u2014 styled with love by Second Bloom" }; }
    return { text: reply, image: img, persist:{ summaryDelta: cat?"Revised look, removed "+plainNoun(cat)+".":"Asked for revise clarification.", preferencesDelta: cat? "Prefers without "+plainNoun(cat)+".":"" }, skill:"revise_look" };
  }

  var api = { handle: handle, skill: "revise_look" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["revise_look"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
