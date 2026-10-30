"use strict";
/* meta-styles Milestone 21 — skill: off_topic. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 */
(function (root) {

  var GUIDE="https://codepilots.co.uk/secondbloom/guide.html";
  async function handle(opts){
    return { text:"I\u2019m just here for your wardrobe \u2014 I can catalogue new pieces, put looks together, or tweak a look you didn\u2019t love. Here\u2019s a quick guide: "+GUIDE+" \u2014 what would you like to try, loveling? \u2728", image:null, persist:{ summaryDelta:"Off-topic deflection.", preferencesDelta:"" }, skill:"off_topic" };
  }

  var api = { handle: handle, skill: "off_topic" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["off_topic"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
