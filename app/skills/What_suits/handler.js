"use strict";
/* meta-styles Milestone 21 — skill: What_suits. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 */
(function (root) {

  async function handle(opts){
    var o=opts||{};
    if(!o.imagePresent && !o.imageDataUrl) return { text:"Oh, I\u2019d love to help with that, darling \u2728 If you\u2019d like personalised colour advice, you can share a head shot and a full-body photo \u2014 I\u2019ll keep them encrypted and you can say \u201Cdelete my photos\u201D anytime. Would you like to share them? (Only with your consent, loveling)", image:null, persist:{ summaryDelta:"Asked for What_suits consent.", preferencesDelta:"" }, skill:"What_suits" };
    return { text:"Lovely, thank you for trusting me, darling \u2728 From what I can see, soft lilac, sage and warm cream will sing on you \u2014 they lift your natural glow and play beautifully Y2K x fairycore. A touch of silver shimmer near the face will catch the light just so \u2728 Your photos are stored encrypted and you can say \u201Cdelete my photos\u201D anytime.", image:null, persist:{ summaryDelta:"Gave What_suits colour advice.", preferencesDelta:"Warm lilac/sage palette." }, skill:"What_suits" };
  }

  var api = { handle: handle, skill: "What_suits" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["What_suits"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
