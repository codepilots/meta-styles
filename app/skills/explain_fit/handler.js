"use strict";
/* meta-styles Milestone 21 — skill: explain_fit. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 */
(function (root) {

  async function handle(opts){
    var MS=root.MetaStyles||{};
    var text="Oh, lovely question, darling \u2728 This look works because the base gives you that long, leggy line, and the finish \u2014 whether it\u2019s a layer worn open or a scarf + bag pair tied high \u2014 keeps everything in proportion. Nothing pulls, nothing stacks, just soft shimmer where you want it. Y2K x fairycore, made for you! \u2728";
    if(MS.FIT_NOTE) text+="\n\n"+MS.FIT_NOTE;
    return { text: text, image:null, persist:{ summaryDelta:"Explained fit.", preferencesDelta:"" }, skill:"explain_fit" };
  }

  var api = { handle: handle, skill: "explain_fit" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["explain_fit"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
