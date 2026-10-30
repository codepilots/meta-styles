"use strict";
/* meta-styles Milestone 21 — skill: propose_look. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 */
(function (root) {

  function plainNoun(c){ var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag"}; return m[c]||c; }
  async function handle(opts){
    var o=opts||{}, catalog=o.catalog;
    var active=catalog? catalog.getActivePieces():[];
    if(active.length===0) return { text:"Your wardrobe\u2019s feeling a little empty just now, loveling \u2014 share a photo of something you love and I\u2019ll catalogue it, then we can make magic! \u2728", image:null, persist:{summaryDelta:"Empty wardrobe, offered to catalogue.",preferencesDelta:""}, skill:"propose_look" };
    var MS=root.MetaStyles||{};
    var items=active.map(function(p){ return { id:p.piece_id, category:p.category, copy:{ text:"SYNTH "+p.category, placeholder:true, note:"" } }; });
    var best={ items:items, card:{ valid:true, finish:null } };
    if(MS.assembleLook){ var card=MS.assembleLook(items); best={ items:items, card:card }; if(!card.valid && items.length>1){ for(var i=0;i<items.length;i++){ var sub=items.slice(); sub.splice(i,1); var c2=MS.assembleLook(sub); if(c2.valid){ best={ items:sub, card:c2 }; break; } } } }
    var nouns=best.items.map(function(it){ return plainNoun(it.category); }).join(" + ");
    var reply="Oh, here\u2019s a little spell for you, darling \u2728 How about your "+nouns+" together? The proportions will sing on you \u2014 long line, soft shimmer, just right. Want me to tweak anything?";
    var imgUrl="https://example.invalid/SYNTH_preview_"+Date.now()+".png";
    if(o.metaClient&&o.metaClient.preview) try{ var pr=await o.metaClient.preview("Y2K fairycore look: "+nouns); if(pr&&pr.url) imgUrl=pr.url; }catch(e){}
    return { text: reply, image:{ url:imgUrl, caption: nouns+" \u2014 styled with love by Second Bloom" }, persist:{ summaryDelta:"Proposed look: "+nouns+".", preferencesDelta:"" }, skill:"propose_look" };
  }

  var api = { handle: handle, skill: "propose_look" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["propose_look"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
