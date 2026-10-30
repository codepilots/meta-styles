"use strict";
/* meta-styles Milestone 21 — skills index. NEW hackathon work. */
(function (root) {
  var SKILL_NAMES=["catalogue_piece","propose_look","revise_look","describe_wardrobe","explain_fit","answer_no_data","off_topic","Match_look","Complete_the_look","What_suits","Evaluate_prospective_purchase"];
  function loadAll(){ var out={}; for(var i=0;i<SKILL_NAMES.length;i++){ var n=SKILL_NAMES[i]; try{ var mod=root.MetaStyles&&root.MetaStyles.skills&&root.MetaStyles.skills[n]; if(mod) out[n]=mod; else if(typeof require!=="undefined") try{ out[n]=require("./"+n+"/handler.js"); }catch(e){} }catch(e){} } return out; }
  var api={ SKILL_NAMES: SKILL_NAMES, loadAll: loadAll };
  root.MetaStyles=root.MetaStyles||{}; root.MetaStyles.skillsIndex=api;
  if(typeof module!=="undefined"&&module.exports) module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
