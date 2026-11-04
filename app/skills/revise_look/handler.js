"use strict";
/* meta-styles Milestone 21 — skill: revise_look. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 *
 * Opus finding #7 fix: a same-turn revision ("no bag this time") must NEVER
 * call catalog.rejectPiece — rejection is terminal (nothing reactivates a
 * rejected piece) and the wardrobe IS the product, so the old loop was
 * unrecoverable data loss. The excluded category now lives in a local
 * variable for the duration of this call only; the catalog is never
 * mutated and never saved from this skill.
 *
 * The re-woven look is picked by propose_look's own selection stack
 * (fallbackChoose over the reduced candidate set), so a valid look is
 * always a base plus exactly one finish (at most 4 pieces) — never the
 * whole remaining wardrobe. When nothing validates, the reply says so
 * honestly (propose_look's plainWhy copy pattern), never a fabricated
 * "looking darling together".
 *
 * Extras (user-chosen, never fit-checked): a pure "add my X" builds on
 * the most recent recorded look instead of re-weaving — the addition
 * joins the core only when core+addition still passes the fit rules,
 * otherwise it rides on top as an extra (recorded on proposal.extras,
 * never claimed to pass the fit check). Removing a category that lives
 * only in extras drops just that extra. Shoes are extras-only, backed
 * by a real catalogued shoes piece: strictShape never admits them to a
 * core, so they always ride on top like any other extra.
 *
 * Preview honesty: the preview image is only ever a real metaClient.preview
 * dataURL staged via the service-passed shareId + stageImage. When no
 * preview client exists, or preview/staging fails, image stays null and an
 * honest caveat is appended — never a fabricated URL.
 */
(function (root) {

  var REVISE_WORDS=[{ re:/\bbag\b|purse|handbag/, category:"bag" },{ re:/\bscarf\b|wrap\b/, category:"scarf" },{ re:/\bblazer\b|jacket|coat/, category:"layer/blazer" },{ re:/\bcardigan\b|shrug|tie-blouse|blouse/, category:"layer/cardigan" },{ re:/\bdress\b|gown/, category:"dress" },{ re:/\btop\b|cami|camisole|tee/, category:"base/top" },{ re:/\bbottom\b|jeans|skirt|trousers|pants|mini/, category:"base/bottom" },{ re:/\bshoes?\b|boots?|heels?|trainers?|sneakers?|sandals?\b/, category:"shoes" }];
  // Shared vocabulary (app/interpret.js): extend each category regex with
  // the table's singular/plural/synonym words it does not already match
  // ("dresses", "tops", "blazers", "scarves", "bags", "tote", "shirt",
  // "t-shirt", "skirts", "shorts", "coats", "jackets", "cardigans",
  // "scarfs", "shoe", "loafers"). Existing alternatives are never
  // removed or reordered, so every previously-matching input matches
  // identically — the set only grows. Fail-closed: when the module is
  // unreachable the literal regexes above stand as before.
  var InterpretMod = null;
  try {
    if (typeof require !== "undefined") InterpretMod = require("../../interpret.js");
  } catch (e) { InterpretMod = null; }
  function interpretMod(){
    if (InterpretMod && typeof InterpretMod.categoryOf === "function") return InterpretMod;
    try {
      var g = root.MetaStyles && root.MetaStyles.interpret;
      if (g && typeof g.categoryOf === "function") return g;
    } catch (e2) {}
    return null;
  }
  (function extendReviseWords(){
    var mod = interpretMod();
    if (!mod || !mod.CATEGORY_WORDS) return;
    var byCat = {};
    Object.keys(mod.CATEGORY_WORDS).forEach(function (w) {
      var c = mod.CATEGORY_WORDS[w];
      (byCat[c] = byCat[c] || []).push(w);
    });
    function esc(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    for (var i = 0; i < REVISE_WORDS.length; i++) {
      var entry = REVISE_WORDS[i];
      var words = byCat[entry.category] || [];
      var extra = [];
      for (var k = 0; k < words.length; k++) {
        var already = false;
        try { already = entry.re.test(words[k]); } catch (e) { already = false; }
        if (!already) extra.push("\\b" + esc(words[k]) + "\\b");
      }
      if (extra.length) {
        try { entry.re = new RegExp(entry.re.source + "|" + extra.join("|")); } catch (e) {}
      }
    }
  })();
  function sparkPickFn() {
    var mod = interpretMod();
    if (mod && typeof mod.sparkPick === "function") return mod.sparkPick;
    return null;
  }
  var TAXONOMY_ORDER = [
    "base/top", "base/bottom", "dress",
    "layer/cardigan", "layer/blazer", "scarf", "bag", "shoes"
  ];
  function isRealCategory(c) { return TAXONOMY_ORDER.indexOf(c) !== -1; }
  // Milestone 36: "change" and "a different <noun>" name a revision
  // target too ("change the scarf", "a different scarf") — they feed the
  // intra-category swap path below, falling back to today's removal when
  // no other piece of the family exists.
  function matchRevise(t){ if(typeof t!=="string") return null; if(!/\b(no|drop|remove|without|lose|ditch|swap|skip|change|different)\b/i.test(t)) return null; for(var i=0;i<REVISE_WORDS.length;i++) if(REVISE_WORDS[i].re.test(t.toLowerCase())) return REVISE_WORDS[i].category; return null; }
  // ADD/INCLUDE support: same category-noun set as matchRevise (never
  // duplicated/diverged), scanned over the FULL text independently so a
  // both-match turn ("swap the cardigan for the blazer") finds its own
  // add-target instead of reusing matchRevise's already-consumed match.
  // "swap X for [the|my] Y" names Y as the add-target even with no add
  // verb, so the for-phrase is checked first; otherwise an add verb must
  // be present and the first-mentioned category in the text wins.
  var ADD_VERB_RE=/\b(add|adds|added|adding|include|includes|included|including|bring\s+back|put\s+back|plus|with\s+(the|my))\b/i;
  var WEAR_TOO_RE=/\bwear\b[\s\S]{0,30}\btoo\b/i;
  var BASE_CATS=["base/top", "base/bottom", "dress"];
  var FINISH_CATS=["layer/cardigan", "layer/blazer", "scarf", "bag"];
  function matchAdd(t){
    if(typeof t!=="string") return null;
    var low=t.toLowerCase();
    var hasSwapVerb=/\b(swap|switch|change|exchange|trade|replace|instead)\b/i.test(t);
    var forM=/\bfor\s+(?:(?:the|my|that|this)\s+)?/.exec(t);
    if(forM && (hasSwapVerb || ADD_VERB_RE.test(t) || WEAR_TOO_RE.test(t))){
      var after=t.slice(forM.index+forM[0].length);
      for(var fi=0;fi<REVISE_WORDS.length;fi++){
        var anchored=null;
        try{ anchored=new RegExp("^(?:"+REVISE_WORDS[fi].re.source+")","i"); }catch(e){ anchored=null; }
        if(anchored && anchored.test(after)) return REVISE_WORDS[fi].category;
      }
    }
    if(!ADD_VERB_RE.test(t) && !WEAR_TOO_RE.test(t)) return null;
    var best=null, bestIdx=-1;
    for(var i=0;i<REVISE_WORDS.length;i++){
      var m=REVISE_WORDS[i].re.exec(low);
      if(m && (bestIdx===-1 || m.index<bestIdx)){ bestIdx=m.index; best=REVISE_WORDS[i].category; }
    }
    return best;
  }
  function plainNoun(c){ var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag","shoes":"shoes"}; return m[c]||c; }

  // Milestone 36 — specific-piece helpers. revise_look used to resolve an
  // add/swap to a bare CATEGORY and always pick the first piece of it;
  // descriptors ("multicolor") were discarded. Now the requested family is
  // narrowed to one real piece before anything is added or forced.

  // Swap intent (cat set, no add-target): "swap/change/... the scarf" and
  // "a different scarf" try an intra-category swap first. Plain removals
  // ("no / remove / drop the scarf") never match — they keep removing.
  var SWAP_INTENT_RE=/\b(swap|switch|change|exchange|trade|replace|instead)\b/i;
  var DIFFERENT_RE=/\bdifferent\b/i;
  function isSwapIntent(t){ if(typeof t!=="string") return false; return SWAP_INTENT_RE.test(t)||DIFFERENT_RE.test(t); }
  // Explicit removal intent: keeps today's remove behaviour even where a
  // swap verb also appears ("drop the scarf" must still remove).
  var REMOVE_INTENT_RE=/\b(no|drop|remove|without|lose|ditch)\b/i;

  // Short description naming the ACTUAL piece — the same "colour + plain
  // noun" shape as view_wardrobe_item's shortDesc (parity comment, not a
  // dependency: plainNoun is already duplicated across skills the same
  // way). Colourless pieces read exactly as plainNoun, so every old reply
  // keeps its wording.
  function pieceDesc(piece){
    var color=piece&&piece.attributes&&typeof piece.attributes.color==="string"?piece.attributes.color.trim():"";
    return (color?color+" ":"")+plainNoun(piece?piece.category:null);
  }

  // Colour matching, local-first against stored attributes.color
  // (case-insensitive, tolerant): "multicolor" ~ "multicolored" ~
  // "multicolour" ~ "multi-coloured" ~ "multi colour"; "colored" ~
  // "coloured"; trailing plural/possessive noise ("pink's" ~ "pink").
  function canonColorWord(s){
    return String(s||"").toLowerCase().replace(/_/g," ").replace(/-/g," ")
      .replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim().replace(/our/g,"or");
  }
  function deedWord(w){ return (w.length>4&&/ed$/.test(w))?w.slice(0,-2):w; }
  function singWord(w){ return (w.length>4&&/s$/.test(w)&&!/ss$/.test(w))?w.slice(0,-1):w; }
  function colorMatchesText(color, text){
    var c=canonColorWord(color), t=canonColorWord(text);
    if(!c||!t) return false;
    var words=t.split(" ").filter(function(w){ return !!w; });
    var set={};
    words.forEach(function(w){
      set[w]=true;
      var d=deedWord(w), s=singWord(w);
      set[d]=true; set[s]=true; set[deedWord(s)]=true;
    });
    var variants=[c];
    var de=deedWord(c);
    if(de!==c) variants.push(de);
    var nospace=c.replace(/ /g,"");
    if(nospace!==c) variants.push(nospace);
    if(/^multi[^ ]/.test(c)) variants.push("multi "+c.slice(5));
    for(var i=0;i<variants.length;i++){
      var v=variants[i];
      if(!v) continue;
      if(v.indexOf(" ")===-1){ if(set[v]) return true; }
      else {
        var vw=v.split(" ");
        for(var s2=0;s2+vw.length<=words.length;s2++){
          var ok=true;
          for(var k=0;k<vw.length;k++){
            var w=words[s2+k];
            if(!(w===vw[k]||deedWord(w)===vw[k]||singWord(w)===vw[k])){ ok=false; break; }
          }
          if(ok) return true;
        }
      }
    }
    return false;
  }

  // Descriptor words in the request: everything that is neither a
  // category word (any family's singular/plural/synonym) nor verb or
  // filler ("my striped scarf" -> ["striped"]; "add my scarf to my
  // look" -> []). Empty means "no descriptor given".
  var DESCRIPTOR_STOP={a:1,an:1,the:1,my:1,your:1,this:1,that:1,these:1,those:1,it:1,one:1,ones:1,s:1,
    please:1,can:1,could:1,you:1,would:1,will:1,to:1,for:1,me:1,look:1,outfit:1,back:1,on:1,top:1,of:1,in:1,
    with:1,and:1,or:1,i:1,am:1,are:1,is:1,be:1,show:1,get:1,give:1,pop:1,wear:1,wearing:1,too:1,
    add:1,adds:1,added:1,adding:1,include:1,includes:1,included:1,including:1,bring:1,put:1,plus:1,
    swap:1,switch:1,change:1,exchange:1,trade:1,replace:1,instead:1,remove:1,removes:1,drop:1,drops:1,
    without:1,another:1,different:1,no:1,not:1,now:1,just:1,like:1,want:1,need:1,have:1,has:1,got:1,
    love:1,lovely:1,darling:1,loveling:1,kindly:1,bit:1,little:1,more:1,very:1,really:1,over:1,up:1,
    some:1,any:1,all:1,own:1,ours:1,theirs:1,mine:1,yours:1,sure:1,yes:1,yeah:1,ok:1,okay:1,hi:1,hey:1};
  function descriptorOf(text){
    var mod=interpretMod();
    var catWords=(mod&&mod.CATEGORY_WORDS)?mod.CATEGORY_WORDS:null;
    var raw=String(text||"").toLowerCase().replace(/[^a-z0-9\- ]/g," ").split(/[\s]+/);
    var out=[];
    for(var i=0;i<raw.length;i++){
      var w=raw[i].replace(/^-+|-+$/g,"");
      if(!w||DESCRIPTOR_STOP[w]) continue;
      if(catWords&&Object.prototype.hasOwnProperty.call(catWords,w)) continue;
      // Possessive/plural noise of a category word ("scarves'" etc.).
      if(catWords&&(Object.prototype.hasOwnProperty.call(catWords,singWord(w)))) continue;
      out.push(w);
    }
    return out;
  }

  // Follow-up fix: descriptor words come in two kinds. ATTRIBUTE words
  // are a small fixed colour/pattern/material vocabulary — the only words
  // that can name a particular piece we don't hold (and the only words
  // the honest no-add reply quotes). Everything else (filler, names,
  // typos like "maybe"/"hun"/"also"/"thanks"/"lets"/"try") must never
  // trigger a no-add on its own — a stop-list alone can never be
  // complete, so filler falls back to the default pick as before M36.
  var ATTRIBUTE_WORDS={
    // Colours: basics + common fashion colours + multicolor variants +
    // colourful/colorful + light/dark/pale/bright modifiers.
    black:1,white:1,gray:1,grey:1,red:1,orange:1,yellow:1,green:1,blue:1,
    purple:1,pink:1,brown:1,beige:1,nude:1,cream:1,ivory:1,navy:1,teal:1,
    turquoise:1,aqua:1,coral:1,peach:1,mint:1,lilac:1,lavender:1,mauve:1,
    plum:1,wine:1,burgundy:1,maroon:1,mustard:1,olive:1,khaki:1,tan:1,
    camel:1,gold:1,golden:1,silver:1,bronze:1,copper:1,rust:1,terracotta:1,
    charcoal:1,slate:1,indigo:1,violet:1,magenta:1,fuchsia:1,cyan:1,lime:1,
    emerald:1,sage:1,forest:1,royal:1,sky:1,powder:1,blush:1,rose:1,ruby:1,
    scarlet:1,crimson:1,taupe:1,mocha:1,chocolate:1,champagne:1,
    multicolor:1,multicolored:1,multicolour:1,multicoloured:1,
    colorful:1,colourful:1,light:1,dark:1,pale:1,bright:1,
    // Patterns + materials.
    striped:1,stripes:1,stripe:1,stripy:1,stripey:1,floral:1,florals:1,
    plaid:1,tartan:1,check:1,checks:1,checked:1,checkered:1,gingham:1,
    polka:1,dot:1,dots:1,dotted:1,dotty:1,spotted:1,spotty:1,spots:1,
    leopard:1,animal:1,print:1,prints:1,printed:1,paisley:1,
    knit:1,knits:1,knitted:1,silk:1,silky:1,satin:1,wool:1,woolen:1,
    woollen:1,denim:1,leather:1,lace:1,lacy:1,velvet:1,velvety:1,
    sheer:1,chiffon:1,cotton:1,linen:1,cashmere:1,
    sequin:1,sequins:1,sequined:1,metallic:1
  };
  // Attribute subset of descriptorOf's output (same word order). Handles
  // the spaced/hyphenated "multi colour" spelling via the phrase check —
  // bare "multi"/"color" alone stay non-attributes (too generic).
  function attributeWordsOf(text){
    var all=descriptorOf(text);
    var out=[];
    for(var i=0;i<all.length;i++){
      var w=all[i];
      if(ATTRIBUTE_WORDS[w]||ATTRIBUTE_WORDS[singWord(w)]||
        ATTRIBUTE_WORDS[deedWord(w)]||ATTRIBUTE_WORDS[deedWord(singWord(w))]) out.push(w);
    }
    if(/multi[\s\-_]*colou?rs?\b/.test(String(text||"").toLowerCase())||
       /multi[\s\-_]*colou?red\b/.test(String(text||"").toLowerCase())){
      var has=false;
      for(var j=0;j<out.length;j++){
        if(out[j].indexOf("multi")===0||out[j]==="colorful"||out[j]==="colourful"){ has=true; break; }
      }
      if(!has) out.push("multicolor");
    }
    return out;
  }
  // "a" vs "an" for the honest no-add quote ("an orange scarf").
  function descriptorArticle(word){
    return /^[aeiou]/i.test(String(word||""))?"an":"a";
  }

  // "…to my look" / "…to the look": the explicit look-target phrase the
  // breakout check (agentic-loop.js) and the pronoun branch share.
  var LOOK_TARGET_RE=/\bto\s+(my|the)\s+look\b/i;
  var PRONOUN_RE=/\b(it|that one|this one|that|this)\b/i;

  // view_wardrobe_item's last-shown piece (its pickPiece records one id):
  // require in Node, else the browser global, else null (pronoun then
  // keeps today's clarification). Never throws.
  var ViewMod=null;
  try {
    if (typeof require!=="undefined") ViewMod=require("../view_wardrobe_item/handler.js");
  } catch (e) { ViewMod=null; }
  function viewMod(){
    if (ViewMod&&typeof ViewMod.lastShownFor==="function") return ViewMod;
    try {
      var sk=root.MetaStyles&&root.MetaStyles.skills&&root.MetaStyles.skills["view_wardrobe_item"];
      if(sk&&typeof sk.lastShownFor==="function") return sk;
    } catch (e2) {}
    return null;
  }
  function lastShownPiece(catalog, liveById){
    try {
      var vm=viewMod();
      if(!vm) return null;
      var ref=vm.lastShownFor(catalog);
      if(!ref||!ref.piece_id) return null;
      var p=liveById?liveById[ref.piece_id]:null;
      if(!p) return null;
      return p;
    } catch (e) { return null; }
  }

  // Closed-choice over the REAL candidate pieces (reuse the
  // sparkPick/interpret pattern): options are real piece_ids with
  // "pink scarf"-style descriptions plus "any" (local miss only: the
  // user did not ask for a particular one) plus "none"; anything outside
  // the option set (including an invented id) resolves null via
  // sparkPick's own re-validation. Records "interpret:spark:<choice>"
  // (or "...:none" on a miss) in trace — never raw text. Never throws;
  // null = no usable client / no pick.
  async function sparkClosedPiece(metaClient, text, cands, trace, descWords, includeAny){
    var sp=sparkPickFn();
    if(!sp||!metaClient||typeof metaClient.interpret!=="function") return null;
    var said=String(text||"");
    if(!said.trim()) return null;
    var noun=plainNoun(cands.length>0?cands[0].category:null);
    var desc=(Array.isArray(descWords)&&descWords.length>0)?descWords.join(" "):noun;
    var opts=cands.map(function(p){ return { id: p.piece_id, description: pieceDesc(p) }; });
    if(includeAny) opts.push({ id:"any", description:"any "+noun+" will do — no particular one" });
    opts.push({ id:"none", description:"none of these — no "+desc+" "+noun });
    var pick=null;
    try {
      pick=await sp(metaClient, said, opts,
        "The user wants to add a specific piece to their look. Which exact piece did they mean — or none?", null);
    } catch (e) { pick=null; }
    if(trace) trace.push("interpret:spark:"+(pick||"none"));
    return pick;
  }

  // Resolve the requested family to ONE real piece.
  // Returns { piece } (local hit or Spark pick), { noMatch:{...} } (an
  // ATTRIBUTE word was given but names nothing we hold — caller must NOT
  // add), or { piece:null, noMatch:null } (no descriptor at all, filler
  // words only, a lone piece, or an ambiguous miss with no Spark client
  // — caller keeps today's default pick). "any" (and a "none" with no
  // attribute word, an invented id with no attribute word, or any Spark
  // failure with no attribute word) all fall back to the default pick —
  // only a "none"/invented-id/failure WITH an attribute word is an
  // honest no-add. Never throws.
  async function resolveSpecificPiece(activePieces, category, text, metaClient, trace){
    try {
      var cands=(Array.isArray(activePieces)?activePieces:[]).filter(function(p){ return p&&p.category===category; });
      if(cands.length<2) return { piece:null, noMatch:null };
      var desc=descriptorOf(text);
      if(desc.length===0) return { piece:null, noMatch:null };
      // Attribute words only drive the local colour match — filler never
      // does ("maybe"/"hun"/"also"/"thanks"/"lets"/"try" must not match
      // or mismatch anything).
      var attrs=attributeWordsOf(text);
      var hits=[];
      if(attrs.length>0){
        var attrText=attrs.join(" ");
        hits=cands.filter(function(p){
          return p&&p.attributes&&typeof p.attributes.color==="string"&&colorMatchesText(p.attributes.color,attrText);
        });
      }
      if(hits.length===1) return { piece:hits[0], noMatch:null };
      if(hits.length>1){
        // Ambiguous locally: Spark breaks the tie when possible. With no
        // client there is nothing to consult, so the caller keeps today's
        // deterministic pick; but a consulted Spark that answers "none"
        // or an invented id is a REJECTION — never a silent add. (Kept
        // without the "any" option: the user DID name a particular colour
        // here, so the closed choice stays pieces + none.)
        var spA=sparkPickFn();
        var usableA=!!(spA&&metaClient&&typeof metaClient.interpret==="function");
        if(!usableA) return { piece:null, noMatch:null };
        var apick=await sparkClosedPiece(metaClient,text,cands,trace,attrs,false);
        if(apick&&apick!=="none"){
          for(var ai=0;ai<cands.length;ai++){ if(cands[ai].piece_id===apick) return { piece:cands[ai], noMatch:null }; }
        }
        return { piece:null, noMatch:{ descriptor:attrs, category:category, cands:cands, contested:true } };
      }
      // Local miss: ask Spark over the real pieces plus "any" (the user
      // did not name a particular one) plus "none" when possible. "any"
      // keeps today's default pick; a real id adds that piece; "none" is
      // an honest no-add ONLY when an attribute word was given —
      // otherwise it is also the default pick. With no usable client (or
      // a Spark failure / invented id, both of which surface as null):
      // attribute words given means an honest no-add, filler-only means
      // the default pick.
      var sp2=sparkPickFn();
      if(!sp2||!metaClient||typeof metaClient.interpret!=="function"){
        if(attrs.length>0) return { piece:null, noMatch:{ descriptor:attrs, category:category, cands:cands } };
        return { piece:null, noMatch:null };
      }
      var mpick=await sparkClosedPiece(metaClient,text,cands,trace,attrs,true);
      if(mpick==="any") return { piece:null, noMatch:null };
      if(mpick&&mpick!=="none"){
        for(var mi=0;mi<cands.length;mi++){ if(cands[mi].piece_id===mpick) return { piece:cands[mi], noMatch:null }; }
      }
      if(attrs.length>0) return { piece:null, noMatch:{ descriptor:attrs, category:category, cands:cands } };
      return { piece:null, noMatch:null };
    } catch (e) { return { piece:null, noMatch:null }; }
  }

  // Shared selection stack: required in Node, or read off the browser
  // global (skills index loads propose_look before revise_look). The fit
  // rules live in exactly one place — never reimplemented here.
  var ProposeStack = null;
  try {
    if (typeof require !== "undefined") ProposeStack = require("../propose_look/handler.js");
  } catch (e) { ProposeStack = null; }
  function proposeStack(){
    if (ProposeStack && typeof ProposeStack.fallbackChoose === "function") return ProposeStack;
    try {
      var sk = root.MetaStyles && root.MetaStyles.skills && root.MetaStyles.skills["propose_look"];
      if (sk && typeof sk.fallbackChoose === "function") return sk;
    } catch (e) {}
    return null;
  }

  // Pending expectation (Milestone 24): the "which piece would you like
  // to swap, skip, or add back?" fallback below is a "we are mid-flow, awaiting a
  // bare piece-name reply" moment. A one-word answer like "the scarf"
  // never matches matchRevise's verb rule, so without this the next turn
  // falls through to off_topic instead of continuing the revision.
  // Recorded on the catalog (the single source of truth
  // agentic-loop.js checks before routing). Never throws: a catalog
  // failure must not break the reply itself.
  var CLARIFY_TEXT="Tell me a little more, loveling \u2014 which piece would you like to swap, skip, or add back? \u2728";
  function recordTextExpectation(catalog){
    try{
      if(catalog && typeof catalog.askQuestion==="function"){
        catalog.askQuestion({ text:CLARIFY_TEXT, skill:"revise_look", expects:"text" });
      }
    }catch(e){}
  }
  // Closed-choice options for the no-target CLARIFY path, built from REAL
  // state only: the current look's plus the wardrobe's live categories.
  // remove:<cat> / add:<cat> map onto the existing cat/required flow;
  // swap:<from>:<to> maps onto cat=<from>, required=<to> (the wire id
  // uses ":" — ">" is outside the /api/interpret id charset); render
  // means "show me wearing it" via the normal render follow-up. "none"
  // keeps the existing CLARIFY_TEXT. Never invents a category.
  function relevantReviseCategories(catalog){
    var have = {};
    var active = [];
    try { active = catalog ? catalog.getActivePieces() : []; } catch (e) { active = []; }
    (Array.isArray(active) ? active : []).forEach(function (p) {
      if (p && typeof p.category === "string" && isRealCategory(p.category)) have[p.category] = true;
    });
    try {
      var look = lastValidLook(catalog);
      if (look) {
        var map = {};
        active.forEach(function (p) { if (p && p.piece_id) map[p.piece_id] = p; });
        look.coreIds.forEach(function (id) {
          if (map[id] && isRealCategory(map[id].category)) have[map[id].category] = true;
        });
        (look.extras || []).forEach(function (ex) {
          if (ex && isRealCategory(ex.category)) have[ex.category] = true;
        });
      }
    } catch (e) {}
    return TAXONOMY_ORDER.filter(function (c) { return have[c]; });
  }
  function clarifyOptions(catalog){
    var cats = relevantReviseCategories(catalog);
    var opts = [];
    cats.forEach(function (c) {
      opts.push({ id: "remove:" + c, description: "take the " + plainNoun(c) + " out of the look" });
    });
    cats.forEach(function (c) {
      opts.push({ id: "add:" + c, description: "add the " + plainNoun(c) + " to the look" });
    });
    // Swaps ride whatever budget remains (at most 24 options total):
    // each look category crossed with each other real category.
    var lookCats = [];
    try {
      var look = lastValidLook(catalog);
      if (look) {
        var seen = {};
        var activeNow = [];
        try { activeNow = catalog ? catalog.getActivePieces() : []; } catch (e) { activeNow = []; }
        var liveMap = {};
        (Array.isArray(activeNow) ? activeNow : []).forEach(function (p) { if (p && p.piece_id) liveMap[p.piece_id] = p; });
        look.coreIds.forEach(function (id) {
          if (liveMap[id] && isRealCategory(liveMap[id].category) && !seen[liveMap[id].category]) {
            seen[liveMap[id].category] = true;
            lookCats.push(liveMap[id].category);
          }
        });
      }
    } catch (e) {}
    for (var fi = 0; fi < lookCats.length && opts.length < 22; fi++) {
      for (var ti = 0; ti < cats.length && opts.length < 22; ti++) {
        if (lookCats[fi] === cats[ti]) continue;
        opts.push({ id: "swap:" + lookCats[fi] + ":" + cats[ti],
          description: "swap the " + plainNoun(lookCats[fi]) + " for the " + plainNoun(cats[ti]) });
      }
    }
    opts.push({ id: "render", description: "show me wearing the current look" });
    opts.push({ id: "none", description: "none of these — still unclear" });
    return opts.slice(0, 24);
  }
  // Resolve one CLARIFY-miss turn via Spark. Returns { choice, cat,
  // required, render } for the normal flow, or null to keep the existing
  // CLARIFY_TEXT. Records "interpret:spark:<choice|none>" in trace —
  // never the user's raw text. Never throws.
  async function clarifyViaSpark(catalog, text, metaClient, trace){
    var sp = sparkPickFn();
    // No usable client means no fallback was attempted: stay exactly as
    // before (no trace entry either).
    if (!sp || !metaClient || typeof metaClient.interpret !== "function") return null;
    var pick = null;
    try {
      pick = await sp(metaClient, text, clarifyOptions(catalog),
        "The user was asked which piece to swap, skip, or add back. What did they mean?", null);
    } catch (e) { pick = null; }
    if (trace) trace.push("interpret:spark:" + (pick || "none"));
    if (!pick || pick === "none") return null;
    if (pick === "render") return { choice: pick, cat: null, required: null, render: true };
    var parts = pick.split(":");
    if (parts[0] === "remove" && parts.length === 2 && isRealCategory(parts[1])) {
      return { choice: pick, cat: parts[1], required: null, render: false };
    }
    if (parts[0] === "add" && parts.length === 2 && isRealCategory(parts[1])) {
      return { choice: pick, cat: null, required: parts[1], render: false };
    }
    if (parts[0] === "swap" && parts.length === 3 && isRealCategory(parts[1]) && isRealCategory(parts[2])) {
      return { choice: pick, cat: parts[1], required: parts[2], render: false };
    }
    return null;
  }
  var CAVEAT=" (I can\u2019t tuck preview pictures into chat just yet, so this word-picture will have to sparkle on its own. \u2728)";
  var NO_SHOES_TEXT="Oh, loveling \u2728 There are no shoes in your wardrobe yet, so I can\u2019t pop them on top \u2014 share a photo of them and I\u2019ll catalogue it, then we\u2019ll pop them on top of a look! \u2728";
  // Opus finding #6: record every turn (success AND clarification)
  // so explain_fit can reference the revised look via
  // catalog.getTurns(). Fail-closed-but-never-blocking: recording
  // must never break the user-facing reply. Verdict-false turns carry
  // a null proposal so explain_fit never reads one as a look.
  function recordReviseTurn(catalog, entry){
    if(!catalog || typeof catalog.recordTurn!=="function") return;
    try{ catalog.recordTurn(entry); }catch(e){}
  }
  function finishOfItems(items, card){
    if(card && (card.finish==="layer"||card.finish==="scarf+bag"||card.finish==="scarf"||card.finish==="bag")) return card.finish;
    var hasLayer=items.some(function(it){ return it.category==="layer/cardigan"||it.category==="layer/blazer"; });
    var hasScarf=items.some(function(it){ return it.category==="scarf"; });
    var hasBag=items.some(function(it){ return it.category==="bag"; });
    if(hasLayer) return "layer";
    if(hasScarf&&hasBag) return "scarf+bag";
    if(hasScarf) return "scarf";
    if(hasBag) return "bag";
    return "scarf+bag";
  }
  function plainWhy(stack, reason){
    if(stack && typeof stack.plainWhy==="function") return stack.plainWhy(reason);
    return "it didn't pass the fit rules";
  }
  // Most recent valid look on record (the look a bare "show me
  // wearing it" refers to, and the base a pure "add my X" builds on).
  // verdict is stored boolean; proposal.pieces are CORE piece ids in
  // selection order, proposal.extras (optional) are user-chosen extras
  // riding on top as [{ piece_id, category }] — every extra names a
  // REAL active piece (legacy pieceless entries resolve to nothing and
  // are dropped). Returns { coreIds, extras } or null.
  // Core ids must all still resolve to ACTIVE pieces — a core piece
  // that left the active set invalidates that turn (the wardrobe
  // changed since it was woven), so older turns are tried; extras
  // whose piece left the active set are dropped silently.
  // Never throws.
  function lastValidLook(catalog){
    try{
      var active=[];
      try{ active=catalog?catalog.getActivePieces():[]; }catch(e){ active=[]; }
      if(!Array.isArray(active)) active=[];
      var live={};
      active.forEach(function(p){ if(p&&p.piece_id) live[p.piece_id]=p; });
      var turns=catalog&&typeof catalog.getTurns==="function"?catalog.getTurns():[];
      for(var i=turns.length-1;i>=0;i--){
        var t=turns[i];
        if(t&&t.verdict===true&&t.proposal&&Array.isArray(t.proposal.pieces)&&t.proposal.pieces.length>0){
          var coreIds=t.proposal.pieces.slice();
          var allLive=true;
          for(var ci=0;ci<coreIds.length;ci++){ if(!live[coreIds[ci]]){ allLive=false; break; } }
          if(!allLive) continue;
          var extras=[];
          if(Array.isArray(t.proposal.extras)){
            for(var ei=0;ei<t.proposal.extras.length;ei++){
              var ex=t.proposal.extras[ei];
              if(!ex||typeof ex.category!=="string"||!ex.category) continue;
              // Real pieces only: legacy pieceless entries (piece_id
              // null) and ids that left the active set are dropped.
              if(typeof ex.piece_id==="string"&&live[ex.piece_id]){
                extras.push({ piece_id: ex.piece_id, category: live[ex.piece_id].category });
              }
            }
          }
          return { coreIds: coreIds, extras: extras };
        }
      }
    }catch(e){}
    return null;
  }

  // Live piece map: piece_id -> piece, over one active array.
  function liveMapOf(active){
    var map={};
    (Array.isArray(active)?active:[]).forEach(function(p){ if(p&&p.piece_id) map[p.piece_id]=p; });
    return map;
  }

  // Assembler-shaped core items ({ id, category }) for core ids that
  // are known live — enough for preview building and noun naming.
  function coreItemsOf(coreIds, liveMap){
    return (Array.isArray(coreIds)?coreIds:[]).map(function(id){
      return { id: id, category: liveMap[id] ? liveMap[id].category : null };
    }).filter(function(it){ return !!it.category; });
  }

  // Audit reasons naming every extra riding on a recorded turn.
  function extraReasonsOf(extras){
    return (Array.isArray(extras)?extras:[]).map(function(ex){ return "extra:"+ex.category; });
  }

  function coreNounStr(items){ return items.map(function(it){ return plainNoun(it.category); }).join(" + "); }
  function extraNounStr(extras){ return extras.map(function(ex){ return plainNoun(ex.category); }).join(" + "); }

  // Combined preview items: core assembler items first, then extras.
  // Every extra names a real piece, so extras resolve to live pieces
  // like core items; an extra whose piece left the pool resolves to
  // nothing and counts as missing, so the honest "Only N of M" line
  // applies. Order: core then extras.
  function combinedPreviewItems(piecesForMap, coreItems, extras){
    var map=liveMapOf(piecesForMap);
    var out=(Array.isArray(coreItems)?coreItems:[]).slice();
    (Array.isArray(extras)?extras:[]).forEach(function(ex){
      if(!ex||typeof ex.category!=="string") return;
      if(typeof ex.piece_id==="string"&&map[ex.piece_id]){
        out.push({ id: ex.piece_id, category: map[ex.piece_id].category });
      }
    });
    return out;
  }

  function combinedNounsStr(coreItems, extras){
    var nouns=(Array.isArray(coreItems)?coreItems:[]).map(function(it){ return plainNoun(it.category); });
    (Array.isArray(extras)?extras:[]).forEach(function(ex){ if(ex&&typeof ex.category==="string") nouns.push(plainNoun(ex.category)); });
    return nouns.join(" + ");
  }

  // Kept extras over a fresh core: drop the removed category, anything
  // already in the new core (same category — no "bag + bag" doubles in
  // the preview), and extras whose piece left the pool. Extras always
  // name a real piece, so a missing/empty piece_id drops the extra.
  function carryExtras(oldExtras, removedCat, coreItems, poolPieces){
    var coreCats={}, coreIds={};
    (Array.isArray(coreItems)?coreItems:[]).forEach(function(it){ if(it){ coreCats[it.category]=true; if(it.id) coreIds[it.id]=true; } });
    var pool={};
    (Array.isArray(poolPieces)?poolPieces:[]).forEach(function(p){ if(p&&p.piece_id) pool[p.piece_id]=true; });
    return (Array.isArray(oldExtras)?oldExtras:[]).filter(function(ex){
      if(!ex||typeof ex.category!=="string") return false;
      if(typeof ex.piece_id!=="string"||!ex.piece_id) return false;
      if(removedCat&&ex.category===removedCat) return false;
      if(coreCats[ex.category]) return false;
      if(coreIds[ex.piece_id]) return false;
      if(!pool[ex.piece_id]) return false;
      return true;
    });
  }

  // True when the category lives ONLY in extras (not in the live core)
  // — a removal then drops just the extra, no re-weave.
  function isExtraOnlyDrop(look, cat, liveMap){
    var inCore=false;
    look.coreIds.forEach(function(id){ if(liveMap[id]&&liveMap[id].category===cat) inCore=true; });
    if(inCore) return false;
    return look.extras.some(function(ex){ return ex&&ex.category===cat; });
  }

  // Render-on-user follow-up: render the most recent valid proposal on
  // the wearer. The look re-validates through propose_look's own stack
  // (categories are immutable per piece, so a once-valid look stays
  // valid); profile consent + both references gate the preview exactly
  // like propose_look's fresh-render path. Never a flat-lay here.
  async function handleRenderFollowup(o){
    var catalog=o.catalog, stack=o.stack, text=o.text||"";
    var metaClient=o.metaClient||null;
    var shareId=o.shareId||null, stageImage=o.stageImage||null;
    var assembleLook=o.assembleLook||null;
    var look=lastValidLook(catalog);
    if(!look){
      recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["no_prior_look"] });
      return { text: "No saved look to render just yet, loveling \u2728 \u2014 ask me to put a look together first, then say \u201Cshow me wearing it\u201D and I\u2019ll picture it on you.", image: null, persist:{ summaryDelta: "Render follow-up with no prior look.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: { requested:false, generated:false, delivered:false, reason:"no_prior_look" }, renderOnUser: false } };
    }
    var active=[];
    try{ active=catalog?catalog.getActivePieces():[]; }catch(e){ active=[]; }
    if(!Array.isArray(active)) active=[];
    var checked=null;
    try{
      if(stack&&typeof stack.validateSelection==="function") checked=stack.validateSelection(active, look.coreIds, assembleLook);
    }catch(e){ checked=null; }
    if(!checked||!checked.ok){
      recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["prior_look_changed"] });
      return { text: "That saved look\u2019s pieces have changed since I wove it, loveling \u2728 \u2014 ask me to put a fresh look together and I\u2019ll render that one on you instead.", image: null, persist:{ summaryDelta: "Saved look no longer valid; offered a fresh one.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: { requested:false, generated:false, delivered:false, reason:"prior_look_changed" }, renderOnUser: false } };
    }
    try{ await stack.ensureProfileLoaded(catalog); }catch(e){}
    var prof=stack.safeGetProfile(catalog);
    if(!prof.consent){
      try{ stack.recordConsentExpectation(catalog, "revise_look", stack.PROFILE_CONSENT_TEXT); }catch(e){}
      recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["profile_consent_pending"] });
      return { text: stack.PROFILE_CONSENT_TEXT, image: null, persist:{ summaryDelta: "Asked for profile-photo consent.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: stack.noPreviewDelivery("profile_consent_pending"), renderOnUser: false } };
    }
    var missing=stack.missingProfileTypes(prof);
    if(missing.length>0){
      var ask=stack.profileAskText(missing);
      try{ stack.recordProfileImageExpectation(catalog, "revise_look", ask); }catch(e){}
      recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["profile_refs_pending:"+missing.join(",")] });
      return { text: ask, image: null, persist:{ summaryDelta: "Asked for missing profile refs: "+missing.join(", ")+".", preferencesDelta: "" }, skill:"revise_look", meta:{ profileMissing: missing, imageDelivery: stack.noPreviewDelivery("profile_refs_pending"), renderOnUser: false } };
    }
    // Every preview (and the recorded turn) carries core + extras: the
    // combined items ride buildGarmentImages, nouns list core then extras.
    var combined=combinedPreviewItems(active, checked.items, look.extras);
    var coreNouns=coreNounStr(checked.items);
    var nouns=combinedNounsStr(checked.items, look.extras);
    var prefsText=typeof o.preferences==="string"?o.preferences:"";
    var rctx=(text+(prefsText?". "+prefsText:"")).slice(0,300);
    if(!rctx.trim()) rctx="";
    if(look.extras.length>0) rctx+=(rctx?" ":"")+"Note: my extras ("+extraNounStr(look.extras)+") are styled on top of the fit-checked look.";
    var onUser=await stack.requestOnUserPreview({
      skill: "revise_look",
      metaClient: metaClient, headshot: prof.headshot, fullBody: prof.full_body,
      activePieces: active, chosenItems: combined,
      nouns: nouns, context: rctx, shareId: shareId, stageImage: stageImage, toolSteps: 0
    });
    var reply="Oh, here you are wearing it, darling \u2728 \u2014 your "+coreNouns+" together. Fit check: valid \u2714";
    if(look.extras.length>0) reply+=" Plus your "+extraNounStr(look.extras)+" styled on top \u2014 your pick outside the fit rules \u2728";
    reply+=" Rendered on you from your saved photos \u2728.";
    if(onUser.imageDelivery.requested&&!onUser.imageDelivery.delivered) reply+=CAVEAT;
    recordReviseTurn(catalog, {
      userText: typeof text==="string"?text:"",
      proposal: { pieces: checked.items.map(function(it){ return it.id; }), extras: look.extras, title: null, note: "render_on_user" },
      verdict: true, reasons: ["render_on_user"].concat(extraReasonsOf(look.extras))
    });
    return { text: reply, image: onUser.image, persist:{ summaryDelta: "Rendered saved look on wearer: "+nouns+".", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: onUser.imageDelivery, renderOnUser: true, profileRefs: onUser.meta.profileRefs, referencePieces: onUser.meta.referencePieces, referenceGarmentTotal: onUser.meta.referenceGarmentTotal, referenceDowngraded: onUser.meta.referenceDowngraded, referencePayloadBytes: onUser.meta.referencePayloadBytes, referenceMode: onUser.meta.referenceMode, previewPrompt: onUser.meta.previewPrompt } };
  }

  async function handleInner(opts){
    var o=opts||{}, catalog=o.catalog, text=o.text||"";
    var metaClient=o.metaClient||null;
    var shareId=typeof o.shareId==="string"&&o.shareId?o.shareId:null;
    var stageImage=typeof o.stageImage==="function"?o.stageImage:null;
    var imageDelivery={ requested:false, generated:false, delivered:false, reason:"no_preview_client" };
    // Shared profile flow (selection stack + render-on-user helpers live
    // in propose_look; fail-closed when unavailable — no render, no
    // intake, ordinary revise behaviour only).
    var stackForProfile=proposeStack();
    var hasProfileStack=!!(stackForProfile&&typeof stackForProfile.isRenderIntent==="function");
    var renderIntent=hasProfileStack?stackForProfile.isRenderIntent(o,text)===true:false;
    var imageDataUrl=typeof o.imageDataUrl==="string"?o.imageDataUrl:null;
    var pendingSatisfied=o.pendingSatisfied&&typeof o.pendingSatisfied==="object"?o.pendingSatisfied:null;
    if(hasProfileStack&&stackForProfile.isDeletePhotos(o,text)===true){
      return await stackForProfile.handleDeletePhotos({ catalog: catalog, skill: "revise_look" });
    }
    // A photo arriving while a profile_image expectation pends is a
    // wearer reference, never a wardrobe piece. Completion renders the
    // most recent valid proposal in the same turn.
    if(hasProfileStack&&imageDataUrl&&pendingSatisfied&&pendingSatisfied.expects==="profile_image"){
      var intake=await stackForProfile.handleProfileIntake({ catalog: catalog, skill: "revise_look", imageDataUrl: imageDataUrl, text: text });
      if(!intake.complete){
        recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: [intake.reply&&intake.reply.meta&&intake.reply.meta.profileAction==="consent_asked"?"profile_consent_pending":"profile_refs_pending"] });
        return intake.reply;
      }
      var followAsm=null;
      try{ followAsm=stackForProfile.getAssembleLook(o); }catch(e){ followAsm=null; }
      if(!followAsm){
        try{ if(root.MetaStyles&&typeof root.MetaStyles.assembleLook==="function") followAsm=root.MetaStyles.assembleLook; }catch(e2){}
      }
      // imageConsumed (2026-11-03): intake.complete above means the
      // attached photo was just filed as a wearer reference — consumed
      // this turn, so the service may ack the media.
      var followRes=await handleRenderFollowup({ catalog: catalog, stack: stackForProfile, text: text, metaClient: metaClient, shareId: shareId, stageImage: stageImage, assembleLook: followAsm, preferences: o.preferences });
      try{ if(followRes&&followRes.meta&&typeof followRes.meta==="object") followRes.meta.imageConsumed=true; }catch(e3){}
      return followRes;
    }
    // Consent "yes" routed back here: grant, persist, ask for headshot.
    // An attached photo counts as the first upload — stored inline and,
    // when it completes the set, rendered in the same turn.
    if(hasProfileStack&&!renderIntent&&pendingSatisfied&&pendingSatisfied.expects==="yes_no"&&pendingSatisfied.text===stackForProfile.PROFILE_CONSENT_TEXT){
      try{ await stackForProfile.ensureProfileLoaded(catalog); }catch(e){}
      var consentNow=stackForProfile.safeGetProfile(catalog);
      if(!consentNow.consent){
        try{ if(catalog&&typeof catalog.setProfileConsent==="function") catalog.setProfileConsent(true); }catch(e2){}
        var granted2=stackForProfile.safeGetProfile(catalog);
        if(granted2.consent){
          try{ await stackForProfile.saveProfileBestEffort(catalog); }catch(e3){}
          if(imageDataUrl&&/^data:image\//.test(imageDataUrl)){
            var grantIntake2=await stackForProfile.handleProfileIntake({ catalog: catalog, skill: "revise_look", imageDataUrl: imageDataUrl, text: text });
            if(!grantIntake2.complete){
              recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["profile_refs_pending"] });
              return grantIntake2.reply;
            }
            var grantAsm=null;
            try{ grantAsm=stackForProfile.getAssembleLook(o); }catch(e5){ grantAsm=null; }
            if(!grantAsm){
              try{ if(root.MetaStyles&&typeof root.MetaStyles.assembleLook==="function") grantAsm=root.MetaStyles.assembleLook; }catch(e6){}
            }
            // imageConsumed (2026-11-03): grantIntake2.complete above
            // means the attached photo was just filed as a wearer
            // reference — consumed this turn.
            var grantRes=await handleRenderFollowup({ catalog: catalog, stack: stackForProfile, text: text, metaClient: metaClient, shareId: shareId, stageImage: stageImage, assembleLook: grantAsm, preferences: o.preferences });
            try{ if(grantRes&&grantRes.meta&&typeof grantRes.meta==="object") grantRes.meta.imageConsumed=true; }catch(e7){}
            return grantRes;
          }
          var grantAsk2=stackForProfile.profileAskText(["headshot","full_body"]);
          try{ stackForProfile.recordProfileImageExpectation(catalog, "revise_look", grantAsk2); }catch(e4){}
          recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["profile_consent_granted"] });
          return { text: "Wonderful, darling \u2728 \u2014 your photos will stay encrypted and are only ever used to render your looks on you. "+grantAsk2, image: null, persist:{ summaryDelta: "Profile consent granted; asked for headshot.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: stackForProfile.noPreviewDelivery("profile_refs_pending"), renderOnUser: false } };
        }
      }
    }
    var cat=matchRevise(text);
    var required=matchAdd(text);
    // Both-match collision: matchRevise scans REVISE_WORDS order (not
    // text order), so "swap the cardigan for the blazer" lands BOTH
    // parsers on "blazer". The exclusion must be the OTHER mentioned
    // category (the swap-source), never the required add-target.
    if(cat && required && cat===required){
      var lowAll=String(text).toLowerCase();
      var otherCat=null, otherIdx=-1;
      for(var oi=0;oi<REVISE_WORDS.length;oi++){
        if(REVISE_WORDS[oi].category===required) continue;
        var om=REVISE_WORDS[oi].re.exec(lowAll);
        if(om && (otherIdx===-1 || om.index<otherIdx)){ otherIdx=om.index; otherCat=REVISE_WORDS[oi].category; }
      }
      if(otherCat) cat=otherCat;
    }
    // Same-family both-match ("swap the scarf for the multicolor scarf"):
    // an intra-family add/swap, never an exclusion — drop the removal
    // side so the specific-piece path below owns it.
    if(cat && required && cat===required){
      cat=null;
    }

    // Live wardrobe, early (Milestone 36): specific-piece resolution and
    // the intra-category swap both need it before the clarify fork below.
    // (The later Re-select block reuses this same array — declared once.)
    var active=[];
    try{ active=catalog?catalog.getActivePieces():[]; }catch(eA){ active=[]; }
    if(!Array.isArray(active)) active=[];
    var sparkTrace36=(o && Array.isArray(o._trace)) ? o._trace : null;
    // "add it/that/this (one) to my look": the piece
    // view_wardrobe_item just showed, when still active. No last-shown
    // piece falls through to today's clarification as before.
    var forcedPiece=null;
    if(!required && typeof text==="string" && PRONOUN_RE.test(text) && LOOK_TARGET_RE.test(text)){
      var lsShown=lastShownPiece(catalog, liveMapOf(active));
      if(lsShown){ required=lsShown.category; forcedPiece=lsShown; }
    }
    // Narrow the requested family to one real piece (the pure-add turn
    // AND the re-weave force path below). Shoes stay family-level, as
    // today. A descriptor that matches nothing resolves to an honest
    // no-add reply — never a silent different piece.
    var noMatchInfo=null;
    if(required && required!=="shoes" && !forcedPiece){
      var res36=await resolveSpecificPiece(active, required, text, metaClient, sparkTrace36);
      if(res36){
        if(res36.piece) forcedPiece=res36.piece;
        else if(res36.noMatch) noMatchInfo=res36.noMatch;
      }
    }
    if(noMatchInfo){
      return noMatchReply(noMatchInfo);
    }

    // Pure render follow-up ("show me wearing this"): render the most
    // recent valid proposal on the wearer — never a clarification, never
    // a new look.
    if(renderIntent && hasProfileStack && !cat && !required){
      var followAsm0=null;
      try{ followAsm0=stackForProfile.getAssembleLook(o); }catch(e9){ followAsm0=null; }
      if(!followAsm0){
        try{ if(root.MetaStyles&&typeof root.MetaStyles.assembleLook==="function") followAsm0=root.MetaStyles.assembleLook; }catch(e10){}
      }
      return await handleRenderFollowup({ catalog: catalog, stack: stackForProfile, text: text, metaClient: metaClient, shareId: shareId, stageImage: stageImage, assembleLook: followAsm0, preferences: o.preferences });
    }
    // Render intent WITH a revise target ("no bag, show me wearing it"):
    // revise first, then render the revised look below (never a flat-lay).
    var renderOnRevised = renderIntent && hasProfileStack && (!!cat || !!required);

    // Ambiguous / no revision target: Spark closed-choice over the live
    // look + wardrobe categories FIRST ("lose the strappy thing" ->
    // remove:bag); only a miss keeps the clarification path (unchanged).
    // A hit maps onto the existing cat / required variables (or the
    // render follow-up) so the normal flow runs below. Never invents a
    // category — clarifyViaSpark only returns real ones.
    if(!cat && !required){
      var sparkTrace = (o && Array.isArray(o._trace)) ? o._trace : null;
      var mapped = await clarifyViaSpark(catalog, text, metaClient, sparkTrace);
      // A "render" choice renders the most recent valid proposal on the
      // wearer via the normal render follow-up (the pure-render block
      // sits above, so this calls it directly — never a re-weave).
      if (mapped && mapped.render) {
        if (hasProfileStack) {
          var followAsmR = null;
          try{ followAsmR=stackForProfile.getAssembleLook(o); }catch(e11){ followAsmR=null; }
          if(!followAsmR){
            try{ if(root.MetaStyles&&typeof root.MetaStyles.assembleLook==="function") followAsmR=root.MetaStyles.assembleLook; }catch(e12){}
          }
          return await handleRenderFollowup({ catalog: catalog, stack: stackForProfile, text: text, metaClient: metaClient, shareId: shareId, stageImage: stageImage, assembleLook: followAsmR, preferences: o.preferences });
        }
        mapped = null;
      } else if (mapped) {
        cat = mapped.cat;
        required = mapped.required;
      }
      if(!cat && !required){
        recordTextExpectation(catalog);
        recordReviseTurn(catalog, {
          userText: typeof text==="string" ? text : "",
          proposal: null, verdict: false, reasons: ["no_revision_target"]
        });
        imageDelivery.reason="no_valid_look";
        return { text: CLARIFY_TEXT, image: null, persist:{ summaryDelta: "Asked for revise clarification.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: imageDelivery } };
      }
    }

    // Per-turn exclusion only (Opus finding #7): the catalog is never
    // mutated here — no rejectPiece, no save. Candidates are the live
    // wardrobe minus this turn's excluded category. A required (ADD)
    // category shapes the pool the OTHER direction: down to that one
    // allowed family, so the deterministic picker structurally can only
    // ever produce it — never by relaxing the fit rules.
    // (active was read above, before the clarify fork — reused here.)

    // Re-select one real 2-4 piece look from the reduced set, using
    // propose_look's own selection stack over that smaller pool. A
    // required-but-not-present category is an honest failure: no such
    // piece exists, so fallbackChoose is never called (nothing to pick).
    var stack=proposeStack(), assembleLook=null;
    try{ assembleLook=stack ? stack.getAssembleLook(o) : null; }catch(e){ assembleLook=null; }
    if(!assembleLook){
      try{
        if(root.MetaStyles && typeof root.MetaStyles.assembleLook==="function") assembleLook=root.MetaStyles.assembleLook;
      }catch(e2){}
    }

    // Core selection primitive: shape the candidate pool (exclude one
    // category, optionally force one family) and pick one real 2-4 piece
    // look via propose_look's own selection stack. Never relaxes the
    // fit rules. Used by the re-weave path below and by the
    // swap-to-shoes removal half.
    // Place one SPECIFIC piece onto a look (Milestone 36): same-category
    // pieces already there (core or extras) are replaced, never stacked —
    // at most one of the family rides the result. The piece joins the
    // core only when core+piece still passes the fit rules (validateSelection);
    // otherwise the core stands and the piece rides on top as an extra.
    // Returns { trialIds, baseExtras, checked } — checked may be null.
    function placeSpecificOnLook(coreIdsIn, extrasIn, specific, live){
      var newCoreIds=[];
      var inserted=false;
      for(var i=0;i<coreIdsIn.length;i++){
        var id=coreIdsIn[i];
        if(live[id]&&live[id].category===specific.category){
          if(!inserted){ newCoreIds.push(specific.piece_id); inserted=true; }
        } else newCoreIds.push(id);
      }
      if(!inserted){
        var has=false;
        for(var h=0;h<newCoreIds.length;h++){ if(newCoreIds[h]===specific.piece_id) has=true; }
        if(!has) newCoreIds.push(specific.piece_id);
      }
      var baseExtras=(Array.isArray(extrasIn)?extrasIn:[]).filter(function(ex){ return ex&&ex.category!==specific.category; });
      var checked=null;
      try{ checked=stack.validateSelection(active, newCoreIds, assembleLook); }catch(e){ checked=null; }
      return { trialIds: newCoreIds, baseExtras: baseExtras, checked: checked };
    }

    // Already-in-the-look reply naming the ACTUAL piece (Milestone 36).
    async function alreadyInLookReply(coreIdsIn, extrasIn, name){
      var liveA=liveMapOf(active);
      var coreItemsA=coreItemsOf(coreIdsIn, liveA);
      var nounsA=combinedNounsStr(coreItemsA, extrasIn);
      var finishA=finishOfItems(coreItemsA, null);
      recordReviseTurn(catalog, {
        userText: typeof text==="string"?text:"",
        proposal: { pieces: coreIdsIn, extras: extrasIn, title: null, note: "valid:"+finishA },
        verdict: true, reasons: ["already_in_look"].concat(extraReasonsOf(extrasIn))
      });
      var pvA=await previewCombined(coreItemsA, extrasIn, nounsA);
      if(pvA.early) return pvA.early;
      var replyA="Your "+name+" is already in the look, darling \u2728 \u2014 your "+nounsA+" stand as they are. Fit check: valid \u2714";
      if(pvA.imageDelivery.requested&&!pvA.imageDelivery.delivered) replyA+=CAVEAT;
      return { text: replyA, image: pvA.img, persist:{ summaryDelta: "Add requested for "+name+"; already in the look, left unchanged.", preferencesDelta: "" }, skill:"revise_look", meta: outMetaFor(pvA) };
    }

    // Intra-category swap (Milestone 36): the family IS worn (core or
    // extra) and another live piece of it sits outside the look — swap to
    // it. Returns the turn reply, or null when there is nothing to swap
    // to (caller keeps today's remove behaviour).
    async function intraSwapTurn(look, category, targetOrNull){
      var liveS=liveMapOf(active);
      var coreIdsS=look.coreIds.slice();
      var inLookIds={};
      var wornOld=null;
      coreIdsS.forEach(function(id){
        inLookIds[id]=true;
        if(!wornOld&&liveS[id]&&liveS[id].category===category) wornOld=liveS[id];
      });
      look.extras.forEach(function(ex){
        if(ex&&ex.piece_id) inLookIds[ex.piece_id]=true;
        if(!wornOld&&ex&&ex.category===category&&ex.piece_id&&liveS[ex.piece_id]) wornOld=liveS[ex.piece_id];
      });
      if(!wornOld) return null;
      var target=targetOrNull||null;
      if(!target){
        for(var i=0;i<active.length;i++){
          var ap=active[i];
          if(ap&&ap.category===category&&!inLookIds[ap.piece_id]){ target=ap; break; }
        }
      }
      if(!target) return null;
      var newDesc=pieceDesc(target);
      if(inLookIds[target.piece_id]){
        return await alreadyInLookReply(coreIdsS, look.extras, newDesc);
      }
      var oldDesc=pieceDesc(wornOld);
      var placed=placeSpecificOnLook(coreIdsS, look.extras, target, liveS);
      if(placed.checked&&placed.checked.ok&&placed.checked.card&&placed.checked.card.valid===true){
        var newCore=placed.checked.items;
        recordReviseTurn(catalog, {
          userText: typeof text==="string"?text:"",
          proposal: { pieces: newCore.map(function(it){ return it.id; }), extras: placed.baseExtras, title: null, note: "valid:"+finishOfItems(newCore, placed.checked.card) },
          verdict: true, reasons: ["swapped:"+category].concat(extraReasonsOf(placed.baseExtras))
        });
        var nounsJ=combinedNounsStr(newCore, placed.baseExtras);
        var pvJ=await previewCombined(newCore, placed.baseExtras, nounsJ);
        if(pvJ.early) return pvJ.early;
        var replyJ="Got it, loveling \u2014 swapped your "+oldDesc+" for your "+newDesc+" \u2728 Your "+coreNounStr(newCore)+" are looking darling together. Fit check: valid \u2714";
        if(placed.baseExtras.length>0) replyJ+=" Plus your "+extraNounStr(placed.baseExtras)+" riding on top \u2014 your pick outside the fit rules \u2728.";
        if(pvJ.imageDelivery.requested&&!pvJ.imageDelivery.delivered) replyJ+=CAVEAT;
        return { text: replyJ, image: pvJ.img, persist:{ summaryDelta: "Swapped "+oldDesc+" for "+newDesc+".", preferencesDelta: "Prefers with "+newDesc+"." }, skill:"revise_look", meta: outMetaFor(pvJ) };
      }
      var newExtras=placed.baseExtras.concat([{ piece_id: target.piece_id, category: target.category }]);
      var coreItemsS=coreItemsOf(coreIdsS, liveS);
      recordReviseTurn(catalog, {
        userText: typeof text==="string"?text:"",
        proposal: { pieces: coreIdsS, extras: newExtras, title: null, note: "valid:"+finishOfItems(coreItemsS, null) },
        verdict: true, reasons: ["swapped:"+category].concat(extraReasonsOf(newExtras))
      });
      var nounsE=combinedNounsStr(coreItemsS, newExtras);
      var pvE=await previewCombined(coreItemsS, newExtras, nounsE);
      if(pvE.early) return pvE.early;
      var replyE="Swapped your "+oldDesc+" for your "+newDesc+" on top, darling \u2014 it\u2019s your pick outside my fit rules, so the fit check covers your "+coreNounStr(coreItemsS)+" only \u2728";
      if(pvE.imageDelivery.requested&&!pvE.imageDelivery.delivered) replyE+=CAVEAT;
      return { text: replyE, image: pvE.img, persist:{ summaryDelta: "Swapped "+oldDesc+" for "+newDesc+" on top as an extra (outside the fit rules).", preferencesDelta: "Prefers with "+newDesc+"." }, skill:"revise_look", meta: outMetaFor(pvE) };
    }

    function selectCore(excludeCat, forceCat, forcePieceId){
      var sExcluded=excludeCat ? active.filter(function(p){ return p && p.category===excludeCat; }) : [];
      var sReqPieces=forceCat ? active.filter(function(p){ return p && p.category===forceCat; }) : null;
      var sReqMissing=!!(forceCat && sReqPieces && sReqPieces.length===0);
      var sReqPresent=!!(forceCat && sReqPieces && sReqPieces.length>0);
      var cands=active.filter(function(p){ return p && (!excludeCat || p.category!==excludeCat); });
      if(sReqPresent){
        if(FINISH_CATS.indexOf(forceCat)!==-1){
          // Finish-type required: no OTHER finish family may remain.
          cands=cands.filter(function(p){ return FINISH_CATS.indexOf(p.category)===-1 || p.category===forceCat; });
        } else {
          // Base-type required: only that base category's own pieces remain
          // among base-type candidates. Multiple same-category pieces all
          // stay — fallbackChoose's deterministic ordering picks naturally.
          cands=cands.filter(function(p){ return BASE_CATS.indexOf(p.category)===-1 || p.category===forceCat; });
        }
      }
      // Milestone 36: a resolved specific piece forces THAT piece, not
      // just its family — the pool keeps no sibling of the same family.
      if(forcePieceId && sReqPresent){
        var forceLive=false;
        for(var fpi=0;fpi<active.length;fpi++){
          if(active[fpi]&&active[fpi].piece_id===forcePieceId&&active[fpi].category===forceCat){ forceLive=true; break; }
        }
        if(forceLive) cands=cands.filter(function(p){ return p.category!==forceCat||p.piece_id===forcePieceId; });
      }
      var sChosen=null, sCard=null, sRejected=null;
      if(sReqMissing){
        sRejected=null;
      } else if(stack && typeof stack.fallbackChoose==="function"){
        var fb=null;
        try{ fb=stack.fallbackChoose(cands, assembleLook); }catch(e){ fb=null; }
        if(fb && fb.items){ sChosen=fb.items; sCard=fb.card; }
        else sRejected=(fb && fb.rejected) || "no_valid_combination";
      } else {
        sRejected="no_selection_stack";
      }
      return { excluded: sExcluded, requiredPieces: sReqPieces, requiredMissing: sReqMissing,
        requiredPresent: sReqPresent, candidates: cands, chosen: sChosen, card: sCard, rejected: sRejected };
    }

    // Honest no-add reply for an ATTRIBUTE word that names nothing
    // holdable (Milestone 36 + follow-up fix): adds nothing, quotes ONLY
    // the attribute words (never filler like "also thanks"), lists the
    // real pieces of the family by their actual short descriptions, and
    // uses "an" before a vowel sound. contested=true means the
    // descriptor DID match locally but the Spark tie-break rejected it —
    // ask which one instead of claiming none exists.
    function noMatchReply(info){
      var d=(Array.isArray(info.descriptor)&&info.descriptor.length>0)?info.descriptor.join(" "):plainNoun(info.category);
      var n=plainNoun(info.category);
      var art=descriptorArticle((Array.isArray(info.descriptor)&&info.descriptor.length>0)?info.descriptor[0]:"");
      var list=info.cands.map(function(p){ return pieceDesc(p); }).join(", ");
      var copy=info.contested
        ? "Oh, loveling \u2728 I couldn't quite tell which "+d+" "+n+" you meant \u2014 yours are the "+list+". Tell me its colour and I'll pop it right on! \u2728"
        : "Oh, loveling \u2728 I don't see "+art+" "+d+" "+n+" in your wardrobe just yet \u2014 yours are the "+list+". Share a photo of one and I'll catalogue it, then we'll weave it in! \u2728";
      var sumDelta=info.contested
        ? "Couldn't tell which "+d+" "+n+" was meant; added nothing."
        : "Looked for "+art+" "+d+" "+n+"; none in wardrobe, added nothing.";
      recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["descriptor_no_match:"+info.category] });
      imageDelivery.reason="no_valid_look";
      return { text: copy, image: null, persist:{ summaryDelta: sumDelta, preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: imageDelivery } };
    }

    // Meta shape for the extras-aware turns: mirrors the re-weave tail
    // (flat-lay carries audit via the ring, not meta; on-user spreads
    // the render meta the same way).
    function outMetaFor(pv){
      var m={ imageDelivery: pv.imageDelivery, renderOnUser: pv.renderOnUser };
      if(pv.renderOnUser && pv.onUserMeta){
        m.profileRefs=pv.onUserMeta.profileRefs;
        m.referencePieces=pv.onUserMeta.referencePieces;
        m.referenceGarmentTotal=pv.onUserMeta.referenceGarmentTotal;
        m.referenceDowngraded=pv.onUserMeta.referenceDowngraded;
        m.referencePayloadBytes=pv.onUserMeta.referencePayloadBytes;
        m.referenceMode=pv.onUserMeta.referenceMode;
        m.previewPrompt=pv.onUserMeta.previewPrompt;
      }
      return m;
    }

    // Shoes with no current look: shoes can only ride on a woven look,
    // so with nothing woven yet there is nothing for them to ride on.
    // With no shoes piece catalogued at all, say so honestly and invite
    // a photo — never claim the shoes were added.
    function shoeNoLookTurn(){
      var hasShoesPiece=active.some(function(p){ return p && p.category==="shoes"; });
      if(!hasShoesPiece){
        recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["required_not_present"] });
        imageDelivery.reason="required_not_present";
        return { text: NO_SHOES_TEXT, image: null, persist:{ summaryDelta:"Shoes requested; none in wardrobe yet.", preferencesDelta:"" }, skill:"revise_look", meta:{ imageDelivery: imageDelivery } };
      }
      recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["no_prior_look","added:shoes"] });
      return { text: "Lovely pick, darling \u2728 \u2014 shoes always ride on top as your own extra. There\u2019s no look woven yet, so ask me to put one together and then we\u2019ll pop your shoes on top \u2728", image: null, persist:{ summaryDelta: "Shoes requested with no current look; asked to weave one first.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: { requested:false, generated:false, delivered:false, reason:"no_prior_look" }, renderOnUser: false } };
    }

    // Shared preview for the extras-aware paths: core + extras ride every
    // preview via buildGarmentImages (the composite sheet kicks in past
    // the free slots), nouns list core then extras, and the flat-lay /
    // on-user prompt may name the extras as styled on top. Render intent
    // takes the on-user branch behind the same profile gate as the
    // re-weave path; otherwise a flat-lay. Returns { img,
    // imageDelivery, renderOnUser, onUserMeta }, or { early } for a gate
    // short-circuit (already recorded — the caller returns it directly).
    async function previewCombined(coreItems, extras, nouns){
      var combined=combinedPreviewItems(active, coreItems, extras);
      if(renderIntent && hasProfileStack){
        var gateProf=null;
        try{ await stackForProfile.ensureProfileLoaded(catalog); gateProf=stackForProfile.safeGetProfile(catalog); }catch(e){ gateProf=null; }
        if(!gateProf) gateProf={ headshot:null, full_body:null, consent:false, updated_at:null };
        if(!gateProf.consent){
          var gateAskC=stackForProfile.PROFILE_CONSENT_TEXT;
          try{ stackForProfile.recordConsentExpectation(catalog, "revise_look", gateAskC); }catch(e2){}
          recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["profile_consent_pending"] });
          return { early: { text: gateAskC, image: null, persist:{ summaryDelta: "Asked for profile-photo consent.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: stackForProfile.noPreviewDelivery("profile_consent_pending"), renderOnUser: false } } };
        }
        var gateMissing=stackForProfile.missingProfileTypes(gateProf);
        if(gateMissing.length>0){
          var gateAskR=stackForProfile.profileAskText(gateMissing);
          try{ stackForProfile.recordProfileImageExpectation(catalog, "revise_look", gateAskR); }catch(e3){}
          recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["profile_refs_pending:"+gateMissing.join(",")] });
          return { early: { text: gateAskR, image: null, persist:{ summaryDelta: "Asked for missing profile refs: "+gateMissing.join(", ")+".", preferencesDelta: "" }, skill:"revise_look", meta:{ profileMissing: gateMissing, imageDelivery: stackForProfile.noPreviewDelivery("profile_refs_pending"), renderOnUser: false } } };
        }
        var onUserCtx=text;
        if(extras.length>0) onUserCtx+=(onUserCtx?" ":"")+"Note: my extras ("+extraNounStr(extras)+") are styled on top of the fit-checked look.";
        var onUser=await stackForProfile.requestOnUserPreview({
          skill: "revise_look",
          metaClient: metaClient, headshot: gateProf.headshot, fullBody: gateProf.full_body,
          activePieces: active, chosenItems: combined,
          nouns: nouns, context: onUserCtx, shareId: shareId, stageImage: stageImage, toolSteps: 0
        });
        return { img: onUser.image, imageDelivery: onUser.imageDelivery, renderOnUser: true, onUserMeta: onUser.meta };
      }
      var delivery={ requested:false, generated:false, delivered:false, reason:"no_preview_client" };
      var img=null;
      var gar=null;
      try{
        if(stackForProfile&&typeof stackForProfile.buildGarmentImages==="function"){
          gar=stackForProfile.buildGarmentImages(active, combined, 4);
        }
      }catch(e){ gar=null; }
      var refThumbs=[], auditRefs=[], fMode="individual", fRepresented=0, fTotal=combined.length, fNouns=[];
      if(gar&&Array.isArray(gar.images)&&gar.images.length>0){
        refThumbs=gar.images.slice(0,4);
        fMode=gar.mode==="composite"?"composite":"individual";
        fRepresented=gar.represented;
        fTotal=gar.total;
        fNouns=Array.isArray(gar.orderedNouns)?gar.orderedNouns:[];
        auditRefs=fMode==="composite"
          ? (Array.isArray(gar.refs)?gar.refs:[]).slice()
          : (Array.isArray(gar.refs)?gar.refs:[]).slice(0,refThumbs.length);
      }
      // Without the helper there are no refs to audit; the text-only
      // reply below stays honest about that.
      var missingRefs=fTotal-fRepresented;
      var prompt="Y2K fairycore flat-lay look card, soft pastel background, garments laid out neatly: "+nouns+". No people, no worn try-on, no readable text.";
      if(extras.length>0) prompt+=" The "+extraNounStr(extras)+" ride along as extra styling on top of the fit-checked look.";
      if(refThumbs.length>0){
        if(fMode==="composite"){
          prompt+=" The attached image is a reference sheet of the "+fRepresented+" selected garments arranged in a grid, read left-to-right, top-to-bottom: "+fNouns.join(", ")+".";
          prompt+=" Lay each garment from the sheet out as a separate flat-lay item, preserving each garment\u2019s colour, print, silhouette, and details; do not reproduce the grid, white background, or sheet layout itself; do not substitute generic garments; do not add unreferenced garments; no person/try-on/readable text.";
        } else {
          prompt+=" Use the attached reference garment photo for the true colors and silhouette.";
          prompt+=" Each attached image is a distinct wardrobe garment; preserve the colour, print, silhouette, and details of every attached reference as a separate flat-lay item; do not substitute generic garments; do not add unreferenced garments; no person/try-on/readable text.";
        }
        if(missingRefs>0){
          prompt+=" Only "+fRepresented+" of "+combined.length+" selected pieces have reference photos; the remaining piece(s) are not represented in references.";
        }
      }
      if(metaClient&&typeof metaClient.preview==="function"){
        delivery.requested=true; delivery.reason="preview_failed";
        try{
          if(stackForProfile&&typeof stackForProfile.recordPreviewAudit==="function"){
            var flatPayloadBytes=0;
            for(var ai=0;ai<auditRefs.length;ai++){ if(typeof auditRefs[ai].ref_bytes==="number") flatPayloadBytes+=auditRefs[ai].ref_bytes; }
            stackForProfile.recordPreviewAudit({
              skill:"revise_look", renderOnUser:false,
              refs: auditRefs,
              previewPromptPreview: prompt,
              totalRefs: refThumbs.length, totalPayloadBytes: flatPayloadBytes,
              mode: fMode
            });
          }
        }catch(auditErr){}
        try{
          var previewRef=null;
          if(refThumbs.length===1) previewRef=refThumbs[0];
          else if(refThumbs.length>1) previewRef=refThumbs;
          var pr=await metaClient.preview(prompt, previewRef);
          var durl=pr&&(pr.dataURL||pr.dataUrl||pr.data_url);
          if(typeof durl==="string"&&/^data:image\//.test(durl)){
            delivery.generated=true;
            img={ dataURL:durl, caption: nouns+" \u2014 styled with love" };
            if(shareId&&stageImage){
              var staged=null;
              try{ staged=await stageImage(shareId, durl); }catch(e){ staged=null; }
              if(staged&&staged.ok){ delivery.delivered=true; delivery.reason="staged for send with image"; }
              else delivery.reason="stage_failed";
            } else delivery.reason="text-only send; preview not staged for delivery";
          } else delivery.reason="preview_unparseable";
        }catch(e){ delivery.reason="preview_failed"; }
      }
      return { img: img, imageDelivery: delivery, renderOnUser: false, onUserMeta: null };
    }

    // Pure ADD on a current look: the addition joins the core only when
    // core+addition still passes the fit rules — otherwise the core
    // stays unchanged and the piece rides on top as a user-chosen extra.
    async function pureAddTurn(look, specific){
      var live=liveMapOf(active);
      var coreIds=look.coreIds.slice();
      var oldExtras=look.extras;
      var inLookIds={}, inLookCats={};
      coreIds.forEach(function(id){ inLookIds[id]=true; if(live[id]) inLookCats[live[id].category]=true; });
      oldExtras.forEach(function(ex){ if(ex.piece_id) inLookIds[ex.piece_id]=true; inLookCats[ex.category]=true; });
      var noun=plainNoun(required);
      var coreItems=coreItemsOf(coreIds, live);
      // Milestone 36: a resolved specific piece replaces its same-family
      // sibling (core or extra) instead of stacking two of the family.
      if(specific && specific.piece_id && live[specific.piece_id]){
        var addName=pieceDesc(specific);
        if(inLookIds[specific.piece_id]){
          return await alreadyInLookReply(coreIds, oldExtras, addName);
        }
        var placed=placeSpecificOnLook(coreIds, oldExtras, specific, live);
        if(placed.checked&&placed.checked.ok&&placed.checked.card&&placed.checked.card.valid===true){
          var newCoreS=placed.checked.items;
          recordReviseTurn(catalog, {
            userText: typeof text==="string"?text:"",
            proposal: { pieces: newCoreS.map(function(it){ return it.id; }), extras: placed.baseExtras, title: null, note: "valid:"+finishOfItems(newCoreS, placed.checked.card) },
            verdict: true, reasons: ["added:"+specific.category].concat(extraReasonsOf(placed.baseExtras))
          });
          var nounsSP=combinedNounsStr(newCoreS, placed.baseExtras);
          var pvSP=await previewCombined(newCoreS, placed.baseExtras, nounsSP);
          if(pvSP.early) return pvSP.early;
          var replySP="Got it, loveling \u2014 added your "+addName+" \u2728 Your "+coreNounStr(newCoreS)+" are looking darling together. Fit check: valid \u2714";
          if(placed.baseExtras.length>0) replySP+=" Plus your "+extraNounStr(placed.baseExtras)+" riding on top \u2014 your pick outside the fit rules \u2728.";
          if(pvSP.imageDelivery.requested&&!pvSP.imageDelivery.delivered) replySP+=CAVEAT;
          return { text: replySP, image: pvSP.img, persist:{ summaryDelta: "Revised look, added "+addName+".", preferencesDelta: "Prefers with "+addName+"." }, skill:"revise_look", meta: outMetaFor(pvSP) };
        }
        var newExtrasS=placed.baseExtras.concat([{ piece_id: specific.piece_id, category: specific.category }]);
        var finishS=finishOfItems(coreItems, null);
        recordReviseTurn(catalog, {
          userText: typeof text==="string"?text:"",
          proposal: { pieces: coreIds, extras: newExtrasS, title: null, note: "valid:"+finishS },
          verdict: true, reasons: ["added:"+specific.category].concat(extraReasonsOf(newExtrasS))
        });
        var nounsSE=combinedNounsStr(coreItems, newExtrasS);
        var pvSE=await previewCombined(coreItems, newExtrasS, nounsSE);
        if(pvSE.early) return pvSE.early;
        var replySE="Added your "+addName+" on top, darling \u2014 it\u2019s your pick outside my fit rules, so the fit check covers your "+coreNounStr(coreItems)+" only \u2728";
        if(pvSE.imageDelivery.requested&&!pvSE.imageDelivery.delivered) replySE+=CAVEAT;
        return { text: replySE, image: pvSE.img, persist:{ summaryDelta: "Added "+addName+" on top as an extra (outside the fit rules).", preferencesDelta: "Prefers with "+addName+"." }, skill:"revise_look", meta: outMetaFor(pvSE) };
      }
      var finish=finishOfItems(coreItems, null);
      // Deterministic pick: the first active piece of the requested
      // category not already in the look — active (catalog) order is the
      // same ordering fallbackChoose uses among same-category pieces.
      var pick=null;
      for(var ai=0;ai<active.length;ai++){
        var ap=active[ai];
        if(ap&&ap.category===required&&!inLookIds[ap.piece_id]){ pick=ap; break; }
      }
      if(!pick){
        // Everything of this category is already in the look.
        var nouns0=combinedNounsStr(coreItems, oldExtras);
        recordReviseTurn(catalog, {
          userText: typeof text==="string"?text:"",
          proposal: { pieces: coreIds, extras: oldExtras, title: null, note: "valid:"+finish },
          verdict: true, reasons: ["already_in_look"].concat(extraReasonsOf(oldExtras))
        });
        var pv0=await previewCombined(coreItems, oldExtras, nouns0);
        if(pv0.early) return pv0.early;
        var reply0="Your "+noun+" is already in the look, darling \u2728 \u2014 your "+nouns0+" stand as they are. Fit check: valid \u2714";
        if(pv0.imageDelivery.requested&&!pv0.imageDelivery.delivered) reply0+=CAVEAT;
        return { text: reply0, image: pv0.img, persist:{ summaryDelta: "Add requested for "+noun+"; already in the look, left unchanged.", preferencesDelta: "" }, skill:"revise_look", meta: outMetaFor(pv0) };
      }
      var trialIds=coreIds.concat([pick.piece_id]);
      var checked=null;
      try{ checked=stack.validateSelection(active, trialIds, assembleLook); }catch(e){ checked=null; }
      if(checked&&checked.ok&&checked.card&&checked.card.valid===true){
        // The addition passes the fit rules: it becomes the new core.
        var newCore=checked.items;
        recordReviseTurn(catalog, {
          userText: typeof text==="string"?text:"",
          proposal: { pieces: newCore.map(function(it){ return it.id; }), extras: oldExtras, title: null, note: "valid:"+finishOfItems(newCore, checked.card) },
          verdict: true, reasons: ["added:"+required].concat(extraReasonsOf(oldExtras))
        });
        var nounsA=combinedNounsStr(newCore, oldExtras);
        var pvA=await previewCombined(newCore, oldExtras, nounsA);
        if(pvA.early) return pvA.early;
        var replyA="Got it, loveling \u2014 added your "+noun+" \u2728 Your "+coreNounStr(newCore)+" are looking darling together. Fit check: valid \u2714";
        if(oldExtras.length>0) replyA+=" Plus your "+extraNounStr(oldExtras)+" riding on top \u2014 your pick outside the fit rules \u2728.";
        if(pvA.imageDelivery.requested&&!pvA.imageDelivery.delivered) replyA+=CAVEAT;
        return { text: replyA, image: pvA.img, persist:{ summaryDelta: "Revised look, added "+noun+".", preferencesDelta: "Prefers with "+noun+"." }, skill:"revise_look", meta: outMetaFor(pvA) };
      }
      // Otherwise the core stays unchanged and the piece rides on top as
      // a user-chosen extra — never claimed to pass the fit check.
      var newExtras=oldExtras.concat([{ piece_id: pick.piece_id, category: pick.category }]);
      recordReviseTurn(catalog, {
        userText: typeof text==="string"?text:"",
        proposal: { pieces: coreIds, extras: newExtras, title: null, note: "valid:"+finish },
        verdict: true, reasons: ["added:"+required].concat(extraReasonsOf(newExtras))
      });
      var nounsE=combinedNounsStr(coreItems, newExtras);
      var pvE=await previewCombined(coreItems, newExtras, nounsE);
      if(pvE.early) return pvE.early;
      var replyE="Added your "+noun+" on top, darling \u2014 it\u2019s your pick outside my fit rules, so the fit check covers your "+coreNounStr(coreItems)+" only \u2728";
      if(pvE.imageDelivery.requested&&!pvE.imageDelivery.delivered) replyE+=CAVEAT;
      return { text: replyE, image: pvE.img, persist:{ summaryDelta: "Added "+noun+" on top as an extra (outside the fit rules).", preferencesDelta: "Prefers with "+noun+"." }, skill:"revise_look", meta: outMetaFor(pvE) };
    }

    // Shoes on a current look: shoes are extras-only, backed by a real
    // catalogued shoes piece — never validated, never in the core. The
    // pick is deterministic: the first active shoes piece not already
    // on the look. With no shoes piece catalogued, say so honestly,
    // record no extra, and never claim the shoes were added.
    async function addShoesTurn(look){
      var live=liveMapOf(active);
      var coreIds=look.coreIds.slice();
      var coreItems=coreItemsOf(coreIds, live);
      var finish=finishOfItems(coreItems, null);
      var onLookIds={};
      coreIds.forEach(function(id){ onLookIds[id]=true; });
      look.extras.forEach(function(ex){ if(ex&&typeof ex.piece_id==="string") onLookIds[ex.piece_id]=true; });
      var pick=null, anyShoes=false;
      for(var pai=0;pai<active.length;pai++){
        var pap=active[pai];
        if(pap&&pap.category==="shoes"){
          anyShoes=true;
          if(!onLookIds[pap.piece_id]&&!pick){ pick=pap; }
        }
      }
      if(!pick&&!anyShoes){
        recordReviseTurn(catalog, {
          userText: typeof text==="string"?text:"",
          proposal: null, verdict: false, reasons: ["required_not_present"]
        });
        imageDelivery.reason="required_not_present";
        return { text: NO_SHOES_TEXT, image: null, persist:{ summaryDelta:"Shoes requested; none in wardrobe yet.", preferencesDelta:"" }, skill:"revise_look", meta:{ imageDelivery: imageDelivery } };
      }
      if(!pick){
        var nouns0=combinedNounsStr(coreItems, look.extras);
        var nouns0=combinedNounsStr(coreItems, look.extras);
        recordReviseTurn(catalog, {
          userText: typeof text==="string"?text:"",
          proposal: { pieces: coreIds, extras: look.extras, title: null, note: "valid:"+finish },
          verdict: true, reasons: ["already_in_look"].concat(extraReasonsOf(look.extras))
        });
        var pv0=await previewCombined(coreItems, look.extras, nouns0);
        if(pv0.early) return pv0.early;
        var reply0="Your shoes are already on top, darling \u2728 \u2014 your "+nouns0+" stand as they are. Fit check: valid \u2714";
        if(pv0.imageDelivery.requested&&!pv0.imageDelivery.delivered) reply0+=CAVEAT;
        return { text: reply0, image: pv0.img, persist:{ summaryDelta: "Shoes already an extra; left unchanged.", preferencesDelta: "" }, skill:"revise_look", meta: outMetaFor(pv0) };
      }
      var newExtras=look.extras.concat([{ piece_id: pick.piece_id, category: "shoes" }]);
      recordReviseTurn(catalog, {
        userText: typeof text==="string"?text:"",
        proposal: { pieces: coreIds, extras: newExtras, title: null, note: "valid:"+finish },
        verdict: true, reasons: ["added:shoes"].concat(extraReasonsOf(newExtras))
      });
      var nouns=combinedNounsStr(coreItems, newExtras);
      var pv=await previewCombined(coreItems, newExtras, nouns);
      if(pv.early) return pv.early;
      var reply="Added your shoes on top, darling \u2014 it\u2019s your pick outside my fit rules, so the fit check covers your "+coreNounStr(coreItems)+" only \u2728";
      if(pv.imageDelivery.requested&&!pv.imageDelivery.delivered) reply+=CAVEAT;
      return { text: reply, image: pv.img, persist:{ summaryDelta: "Added shoes on top as an extra (outside the fit rules).", preferencesDelta: "Prefers with shoes." }, skill:"revise_look", meta: outMetaFor(pv) };
    }

    // Removing a category that lives only in extras: drop just the
    // extra, keep the core look and remaining extras unchanged — no
    // re-weave.
    async function extraDropTurn(look){
      var live=liveMapOf(active);
      var coreIds=look.coreIds.slice();
      var coreItems=coreItemsOf(coreIds, live);
      var noun=plainNoun(cat);
      var kept=look.extras.filter(function(ex){ return ex&&ex.category!==cat; });
      var finish=finishOfItems(coreItems, null);
      recordReviseTurn(catalog, {
        userText: typeof text==="string"?text:"",
        proposal: { pieces: coreIds, extras: kept, title: null, note: "valid:"+finish },
        verdict: true, reasons: ["removed_extra:"+cat].concat(extraReasonsOf(kept))
      });
      var nouns=combinedNounsStr(coreItems, kept);
      var pv=await previewCombined(coreItems, kept, nouns);
      if(pv.early) return pv.early;
      var reply="Set aside your "+noun+", loveling \u2728 \u2014 your "+coreNounStr(coreItems)+" still stand. Fit check: valid \u2714";
      if(kept.length>0) reply+=" Plus your "+extraNounStr(kept)+" still riding on top \u2014 your pick outside the fit rules \u2728.";
      if(pv.imageDelivery.requested&&!pv.imageDelivery.delivered) reply+=CAVEAT;
      return { text: reply, image: pv.img, persist:{ summaryDelta: "Set aside extra "+noun+"; core unchanged.", preferencesDelta: "Prefers without "+noun+"." }, skill:"revise_look", meta: outMetaFor(pv) };
    }

    // Swap onto shoes ("swap the bag for shoes"): the removal half runs
    // first (extra-only drop, else a re-weave excluding the category —
    // never forcing shoes, which no pool can hold), then a real
    // catalogued shoes piece rides on top as the user's extra. With no
    // shoes piece catalogued, say so honestly and record no extra.
    async function swapToShoesTurn(look){
      var live=liveMapOf(active);
      var noun=plainNoun(cat);
      var shoePick=null;
      for(var spi=0;spi<active.length;spi++){
        if(active[spi]&&active[spi].category==="shoes"){ shoePick=active[spi]; break; }
      }
      if(!shoePick){
        recordReviseTurn(catalog, {
          userText: typeof text==="string"?text:"",
          proposal: null, verdict: false, reasons: ["required_not_present"]
        });
        imageDelivery.reason="required_not_present";
        return { text: NO_SHOES_TEXT, image: null, persist:{ summaryDelta:"Shoes requested; none in wardrobe yet.", preferencesDelta:"" }, skill:"revise_look", meta:{ imageDelivery: imageDelivery } };
      }
      var coreIds, keptExtras, removedFromCore;
      if(isExtraOnlyDrop(look, cat, live)){
        coreIds=look.coreIds.slice();
        keptExtras=look.extras.filter(function(ex){ return ex&&ex.category!==cat; });
        removedFromCore=false;
      } else {
        var sel=selectCore(cat, null);
        if(!sel.chosen){
          var why=plainWhy(stack, sel.rejected||"no_valid_combination");
          recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["excluded:"+cat, sel.rejected?("fallback_rejected:"+sel.rejected):"no_valid_look"] });
          imageDelivery.reason="no_valid_look";
          return { text: "Got it, loveling \u2014 set aside your "+noun+" for now \u2728 I turned every piece over in the lamplight, but "+why+" \u2014 share one more piece (a layer, a scarf or a bag) and I\u2019ll spin it into a full look! And your shoes will have to wait for a valid look to ride on \u2728", image: null, persist:{ summaryDelta: "Tried revising without "+noun+" for shoes; no valid look yet.", preferencesDelta: "Prefers without "+noun+"." }, skill:"revise_look", meta:{ imageDelivery: imageDelivery } };
        }
        coreIds=sel.chosen.map(function(it){ return it.id; });
        keptExtras=carryExtras(look.extras, cat, sel.chosen, sel.candidates);
        removedFromCore=true;
      }
      var coreItems=coreItemsOf(coreIds, live);
      var shoesHad=keptExtras.some(function(ex){ return ex&&ex.category==="shoes"; });
      if(!shoesHad) keptExtras=keptExtras.concat([{ piece_id: shoePick.piece_id, category: "shoes" }]);
      var finish=finishOfItems(coreItems, null);
      var reasons=(removedFromCore?["excluded:"+cat]:["removed_extra:"+cat]).concat(shoesHad?[]:["added:shoes"]).concat(extraReasonsOf(keptExtras));
      recordReviseTurn(catalog, {
        userText: typeof text==="string"?text:"",
        proposal: { pieces: coreIds, extras: keptExtras, title: null, note: "valid:"+finish },
        verdict: true, reasons: reasons
      });
      var nouns=combinedNounsStr(coreItems, keptExtras);
      var pv=await previewCombined(coreItems, keptExtras, nouns);
      if(pv.early) return pv.early;
      var reply;
      if(removedFromCore) reply="Got it, loveling \u2014 set aside your "+noun+" for now \u2728 Let me re-weave the rest into something lovely. Your "+coreNounStr(coreItems)+" are looking darling together. Fit check: valid \u2714";
      else reply="Set aside your "+noun+", loveling \u2014 your "+coreNounStr(coreItems)+" still stand. Fit check: valid \u2714";
      reply+=shoesHad?" Your shoes stay on top as your extra \u2728.":" And your shoes join on top \u2014 your pick outside my fit rules \u2728.";
      if(pv.imageDelivery.requested&&!pv.imageDelivery.delivered) reply+=CAVEAT;
      return { text: reply, image: pv.img, persist:{ summaryDelta: removedFromCore?("Revised look, removed "+noun+" for shoes."):("Set aside extra "+noun+" for shoes."), preferencesDelta: "Prefers without "+noun+", with shoes." }, skill:"revise_look", meta: outMetaFor(pv) };
    }

    // Shoes are extras-only (backed by a real catalogued shoes piece —
    // strictShape never admits them to a core). They never reach the
    // pool shaping below; with no current look there is nothing for
    // them to ride on.
    if(required==="shoes" && !cat){
      var lookShoes=lastValidLook(catalog);
      if(lookShoes) return await addShoesTurn(lookShoes);
      return shoeNoLookTurn();
    }
    if(cat && required==="shoes"){
      var lookSwapShoes=lastValidLook(catalog);
      if(lookSwapShoes && stack && typeof stack.validateSelection==="function" && assembleLook){
        return await swapToShoesTurn(lookSwapShoes);
      }
      return shoeNoLookTurn();
    }
    // Pure ADD (an add-target, no removal target): build on the current
    // look instead of re-weaving — the addition joins the core only when
    // core+addition still passes the fit rules, else it rides on top.
    // No current look (or nothing to validate with) falls through to
    // today's re-weave below.
    if(!cat && required){
      var reqAlive=active.some(function(p){ return p && p.category===required; });
      if(reqAlive && stack && typeof stack.validateSelection==="function" && assembleLook){
        var lookAdd=lastValidLook(catalog);
        if(lookAdd) return await pureAddTurn(lookAdd, forcedPiece);
      }
      // else: fall through (no such piece, no look, or no stack).
    }
    // Intra-category swap (Milestone 36): "swap/change the scarf" / "a
    // different scarf" with no add-target and no explicit removal verb
    // swaps to another live piece of the family instead of removing it.
    // Anything else (including "remove/drop the scarf") keeps today's
    // remove path below.
    if(cat && !required && isSwapIntent(text) && !REMOVE_INTENT_RE.test(text)){
      var lookSwap=lastValidLook(catalog);
      if(lookSwap && stack && typeof stack.validateSelection==="function" && assembleLook){
        var swapSpec=null, swapNoMatch=null;
        var resSwap=await resolveSpecificPiece(active, cat, text, metaClient, sparkTrace36);
        if(resSwap){
          if(resSwap.piece) swapSpec=resSwap.piece;
          else if(resSwap.noMatch) swapNoMatch=resSwap.noMatch;
        }
        if(swapNoMatch){
          return noMatchReply(swapNoMatch);
        }
        var swapped=await intraSwapTurn(lookSwap, cat, swapSpec);
        if(swapped) return swapped;
      }
      // else: fall through to today's remove behaviour.
    }
    // Pure removal of a category that lives only in extras: drop just
    // the extra, keep the core look and remaining extras unchanged.
    if(cat && !required){
      var lookRem=lastValidLook(catalog);
      if(lookRem && isExtraOnlyDrop(lookRem, cat, liveMapOf(active))){
        return await extraDropTurn(lookRem);
      }
      // else: fall through to the re-weave.
    }

    var forcePieceId=(forcedPiece&&required&&forcedPiece.category===required)?forcedPiece.piece_id:null;
    var sel=selectCore(cat, required, forcePieceId);
    var excluded=sel.excluded, requiredPieces=sel.requiredPieces, requiredMissing=sel.requiredMissing,
      requiredPresent=sel.requiredPresent, candidates=sel.candidates,
      chosen=sel.chosen, card=sel.card, rejected=sel.rejected;

    var reply, img=null;
    if(chosen){
      // Re-weaves keep existing extras on top of the new core (minus the
      // removed category and anything the new core already holds); every
      // preview and the recorded turn carry core then extras.
      var carryLook=lastValidLook(catalog);
      var carryFrom=carryLook?carryLook.extras:[];
      var keptExtras=carryExtras(carryFrom, cat, chosen, candidates);
      // The forced piece names the reply below; the pool shaping above
      // usually lands it in the re-woven core already.
      var reqName=(forcePieceId&&forcedPiece)?pieceDesc(forcedPiece):(requiredPresent?plainNoun(required):null);
      var forcedExtra=false;
      if(forcePieceId&&forcedPiece){
        var hasForced=false;
        for(var hfi=0;hfi<chosen.length;hfi++){ if(chosen[hfi]&&chosen[hfi].id===forcedPiece.piece_id){ hasForced=true; break; } }
        if(!hasForced){
          // The re-weave left the exact piece out: place it on top of the
          // new core the same honest way a pure add would (core when it
          // validates, otherwise an extra) — it is never silently dropped.
          var fplaced=placeSpecificOnLook(chosen.map(function(it){ return it.id; }), keptExtras, forcedPiece, liveMapOf(active));
          if(fplaced.checked&&fplaced.checked.ok&&fplaced.checked.card&&fplaced.checked.card.valid===true){
            chosen=fplaced.checked.items; card=fplaced.checked.card; keptExtras=fplaced.baseExtras;
          } else {
            keptExtras=fplaced.baseExtras.concat([{ piece_id: forcedPiece.piece_id, category: forcedPiece.category }]);
            forcedExtra=true;
          }
        }
      }
      var combinedAll=combinedPreviewItems(candidates, chosen, keptExtras);
      var nouns=combinedNounsStr(chosen, keptExtras);
      if(excluded.length>0 && requiredPresent) reply="Got it, loveling \u2014 set aside your "+plainNoun(cat)+" and brought back your "+reqName+" \u2728 Let me re-weave the rest into something lovely.";
      else if(excluded.length>0) reply="Got it, loveling \u2014 set aside your "+plainNoun(cat)+" for now \u2728 Let me re-weave the rest into something lovely.";
      else if(requiredPresent && cat) reply="No "+plainNoun(cat)+" in the mix right now, darling \u2014 but I brought back your "+reqName+" \u2728";
      else if(requiredPresent) reply="Got it, loveling \u2014 brought back your "+reqName+" \u2728 Let me re-weave things into something lovely.";
      else reply="No "+plainNoun(cat)+" in the mix right now, darling \u2014 but I\u2019ll re-check the fit with what we\u2019ve got \u2728";
      reply+=" Your "+coreNounStr(chosen)+" are looking darling together.";
      if(forcedExtra) reply+=" Your "+reqName+" rides on top \u2014 your pick outside my fit rules \u2728.";
      if(card && card.valid===true) reply+=" Fit check: valid \u2714";
      if(keptExtras.length>0) reply+=" Plus your "+extraNounStr(keptExtras)+" riding on top \u2014 your pick outside the fit rules \u2728.";
      var onUserReviseCtx=text;
      if(keptExtras.length>0) onUserReviseCtx+=(onUserReviseCtx?" ":"")+"Note: my extras ("+extraNounStr(keptExtras)+") are styled on top of the fit-checked look.";
      // Render intent: the revised look renders on the wearer (profile
      // refs + revised garments, never a flat-lay). The profile gate
      // returns early with consent/missing copy when the record is not
      // ready — no preview call, no image delivery, explicit reason.
      var didRenderOnUser=false;
      var renderOnUserMeta=null;
      if(renderOnRevised){
        var gateProf=null, gateMissing=null;
        try{ await stackForProfile.ensureProfileLoaded(catalog); gateProf=stackForProfile.safeGetProfile(catalog); }catch(e){ gateProf=null; }
        if(!gateProf) gateProf={ headshot:null, full_body:null, consent:false, updated_at:null };
        if(!gateProf.consent){
          var gateAskC=stackForProfile.PROFILE_CONSENT_TEXT;
          try{ stackForProfile.recordConsentExpectation(catalog, "revise_look", gateAskC); }catch(e2){}
          recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["profile_consent_pending"] });
          return { text: gateAskC, image: null, persist:{ summaryDelta: "Asked for profile-photo consent.", preferencesDelta: "" }, skill:"revise_look", meta:{ imageDelivery: stackForProfile.noPreviewDelivery("profile_consent_pending"), renderOnUser: false } };
        }
        gateMissing=stackForProfile.missingProfileTypes(gateProf);
        if(gateMissing.length>0){
          var gateAskR=stackForProfile.profileAskText(gateMissing);
          try{ stackForProfile.recordProfileImageExpectation(catalog, "revise_look", gateAskR); }catch(e3){}
          recordReviseTurn(catalog, { userText: typeof text==="string"?text:"", proposal: null, verdict: false, reasons: ["profile_refs_pending:"+gateMissing.join(",")] });
          return { text: gateAskR, image: null, persist:{ summaryDelta: "Asked for missing profile refs: "+gateMissing.join(", ")+".", preferencesDelta: "" }, skill:"revise_look", meta:{ profileMissing: gateMissing, imageDelivery: stackForProfile.noPreviewDelivery("profile_refs_pending"), renderOnUser: false } };
        }
        var byIdRender={};
        candidates.forEach(function(p){ byIdRender[p.piece_id]=p; });
        var onUserRevised=await stackForProfile.requestOnUserPreview({
          skill: "revise_look",
          metaClient: metaClient, headshot: gateProf.headshot, fullBody: gateProf.full_body,
          activePieces: candidates, chosenItems: combinedAll,
          nouns: nouns, context: onUserReviseCtx, shareId: shareId, stageImage: stageImage, toolSteps: 0
        });
        img=onUserRevised.image;
        imageDelivery=onUserRevised.imageDelivery;
        renderOnUserMeta=onUserRevised.meta;
        didRenderOnUser=true;
        reply+=" Rendered on you from your saved photos \u2728.";
      }
      if(!didRenderOnUser){
      // Preview prompt names the actual chosen look only.
      var byId={};
      candidates.forEach(function(p){ byId[p.piece_id]=p; });
      // Multi-reference flat-lay: the shared selection-stack helper builds
      // one ref per chosen piece (384px original-derived, thumb fallback)
      // in selection order — the same helper the render path above uses.
      // More refs than the 4 proxy slots pre-combine into ONE composite
      // reference sheet that counts as one ref.
      var garFlat=null;
      try{
        if(stackForProfile&&typeof stackForProfile.buildGarmentImages==="function"){
          garFlat=stackForProfile.buildGarmentImages(candidates, combinedAll, 4);
        } else if(stackForProfile&&typeof stackForProfile.buildGarmentRefUrls==="function"){
          var garLegacy=stackForProfile.buildGarmentRefUrls(candidates, chosen);
          garFlat={ images: garLegacy.urls, mode: "individual", refs: garLegacy.refs,
            orderedNouns: [], total: chosen.length, represented: garLegacy.urls.length,
            downgraded: garLegacy.downgraded, payloadBytes: garLegacy.payloadBytes };
        }
      }catch(e){ garFlat=null; }
      var refThumbs=[], auditRefsFlat=[], flatMode="individual", flatRepresented=0, flatTotal=combinedAll.length, flatNouns=[];
      if(garFlat&&Array.isArray(garFlat.images)&&garFlat.images.length>0){
        refThumbs=garFlat.images.slice(0,4);
        flatMode=garFlat.mode==="composite"?"composite":"individual";
        flatRepresented=garFlat.represented;
        flatTotal=garFlat.total;
        flatNouns=Array.isArray(garFlat.orderedNouns)?garFlat.orderedNouns:[];
        // A composite sheet carries every ref in its one image: keep all
        // audit rows, not just one per attached image.
        auditRefsFlat=flatMode==="composite"
          ? (Array.isArray(garFlat.refs)?garFlat.refs:[]).slice()
          : (Array.isArray(garFlat.refs)?garFlat.refs:[]).slice(0,refThumbs.length);
      } else if(!garFlat){
        // Helper unavailable: legacy single-thumb fallback (first chosen
        // piece with a photo_thumb), never more than one ref.
        for(var ti2=0;ti2<chosen.length;ti2++){
          var lp2=byId[chosen[ti2].id];
          if(lp2&&typeof lp2.photo_thumb==="string"&&/^data:image\//.test(lp2.photo_thumb)){
            var legacyLen=0;
            try{ if(stackForProfile&&typeof stackForProfile.refBytesLen==="function") legacyLen=stackForProfile.refBytesLen(lp2.photo_thumb); }catch(e2){ legacyLen=0; }
            refThumbs=[lp2.photo_thumb];
            auditRefsFlat=[{ piece_id: chosen[ti2].id, category: chosen[ti2].category, ref_source:"photo_thumb", ref_bytes: legacyLen, downgraded:true }];
            flatRepresented=1;
            break;
          }
        }
      }
      var missingRefsFlat=flatTotal-flatRepresented;
      var previewPrompt="Y2K fairycore flat-lay look card, soft pastel background, garments laid out neatly: "+nouns+". No people, no worn try-on, no readable text.";
      if(keptExtras.length>0) previewPrompt+=" The "+extraNounStr(keptExtras)+" ride along as extra styling on top of the fit-checked look.";
      if(refThumbs.length>0){
        if(flatMode==="composite"){
          previewPrompt+=" The attached image is a reference sheet of the "+flatRepresented+" selected garments arranged in a grid, read left-to-right, top-to-bottom: "+flatNouns.join(", ")+".";
          previewPrompt+=" Lay each garment from the sheet out as a separate flat-lay item, preserving each garment's colour, print, silhouette, and details; do not reproduce the grid, white background, or sheet layout itself; do not substitute generic garments; do not add unreferenced garments; no person/try-on/readable text.";
        } else {
          previewPrompt+=" Use the attached reference garment photo for the true colors and silhouette.";
          previewPrompt+=" Each attached image is a distinct wardrobe garment; preserve the colour, print, silhouette, and details of every attached reference as a separate flat-lay item; do not substitute generic garments; do not add unreferenced garments; no person/try-on/readable text.";
        }
        if(missingRefsFlat>0){
          previewPrompt+=" Only "+flatRepresented+" of "+combinedAll.length+" selected pieces have reference photos; the remaining piece(s) are not represented in references.";
        }
      }
      if(metaClient&&typeof metaClient.preview==="function"){
        imageDelivery.requested=true; imageDelivery.reason="preview_failed";
        // Audit the request via the shared propose_look ring (facts only —
        // ids, counts, prompt text; the ref bytes are never recorded).
        // Fail-closed: a logging problem must never break the reply.
        try{
          if(stackForProfile&&typeof stackForProfile.recordPreviewAudit==="function"){
            var flatPayloadBytes=0;
            for(var ai=0;ai<auditRefsFlat.length;ai++){ if(typeof auditRefsFlat[ai].ref_bytes==="number") flatPayloadBytes+=auditRefsFlat[ai].ref_bytes; }
            stackForProfile.recordPreviewAudit({
              skill:"revise_look", renderOnUser:false,
              refs: auditRefsFlat,
              previewPromptPreview: previewPrompt,
              totalRefs: refThumbs.length, totalPayloadBytes: flatPayloadBytes,
              mode: flatMode
            });
          }
        }catch(auditErr){}
        try{
          var previewRefFlat=null;
          if(refThumbs.length===1) previewRefFlat=refThumbs[0];
          else if(refThumbs.length>1) previewRefFlat=refThumbs;
          var pr=await metaClient.preview(previewPrompt, previewRefFlat);
          var durl=pr&&(pr.dataURL||pr.dataUrl||pr.data_url);
          if(typeof durl==="string"&&/^data:image\//.test(durl)){
            imageDelivery.generated=true;
            img={ dataURL:durl, caption: nouns+" \u2014 styled with love" };
            if(shareId&&stageImage){
              var staged=null;
              try{ staged=await stageImage(shareId, durl); }catch(e){ staged=null; }
              if(staged&&staged.ok){ imageDelivery.delivered=true; imageDelivery.reason="staged for send with image"; }
              else imageDelivery.reason="stage_failed";
            } else imageDelivery.reason="text-only send; preview not staged for delivery";
          } else imageDelivery.reason="preview_unparseable";
        }catch(e){ imageDelivery.reason="preview_failed"; }
      }
      } // end flat-lay-only preview (render intent takes the on-user branch above)
      if(imageDelivery.requested&&!imageDelivery.delivered) reply+=CAVEAT;
    } else {
      // Honest no-valid-look: name the reason, never a fabricated look.
      // A required-but-not-present category is its own honest failure:
      // no such piece exists, so say so plainly (never fabricate one,
      // never silently propose something else without saying so).
      var why=plainWhy(stack, rejected||"no_valid_combination");
      if(requiredMissing) reply="Oh, loveling \u2728 There\u2019s no "+plainNoun(required)+" in your wardrobe yet, so I can\u2019t add one \u2014 share a photo of it and I\u2019ll catalogue it, then we\u2019ll weave it in!";
      else if(excluded.length>0) reply="Got it, loveling \u2014 set aside your "+plainNoun(cat)+" for now \u2728 I turned every piece over in the lamplight, but "+why+" \u2014 share one more piece (a layer, a scarf or a bag) and I\u2019ll spin it into a full look!";
      else reply="No "+plainNoun(cat)+" in the mix right now, darling \u2014 I turned every piece over in the lamplight, but "+why+" \u2014 share one more piece (a layer, a scarf or a bag) and I\u2019ll spin it into a full look!";
      imageDelivery.reason="no_valid_look";
    }
    // Opus finding #6: remember the actual revised look (or the honest
    // no-op) for explain_fit / the router — the chosen 2-4 piece look,
    // never the whole wardrobe.
    var revisedVerdict=!!chosen;
    var revisedFinish=chosen ? finishOfItems(chosen, card) : null;
    var revisedReasons=[];
    if(cat && excluded.length===0) revisedReasons.push("category_not_present");
    if(cat && excluded.length>0) revisedReasons.push("excluded:"+cat);
    if(requiredPresent) revisedReasons.push("required:"+required);
    if(requiredMissing) revisedReasons.push("required_not_present");
    if(!revisedVerdict) revisedReasons.push(rejected ? ("fallback_rejected:"+rejected) : "no_valid_look");
    if(didRenderOnUser) revisedReasons.push("render_on_user");
    if(revisedVerdict) revisedReasons=revisedReasons.concat(extraReasonsOf(keptExtras));
    recordReviseTurn(catalog, {
      userText: typeof text==="string" ? text : "",
      proposal: (revisedVerdict && (revisedFinish==="layer"||revisedFinish==="scarf+bag"||revisedFinish==="scarf"||revisedFinish==="bag")) ? {
        pieces: chosen.map(function(it){ return it.id; }),
        extras: keptExtras,
        title: null, note: "valid:"+revisedFinish
      } : null,
      verdict: revisedVerdict, reasons: revisedReasons
    });
    var sumDelta, prefDelta;
    if(requiredMissing){ sumDelta="Tried adding "+plainNoun(required)+"; none in wardrobe yet."; prefDelta=""; }
    else if(chosen && excluded.length>0 && requiredPresent){ sumDelta="Revised look, swapped "+plainNoun(cat)+" for "+plainNoun(required)+"."; prefDelta="Prefers without "+plainNoun(cat)+", with "+plainNoun(required)+"."; }
    else if(chosen && requiredPresent){ sumDelta="Revised look, added "+plainNoun(required)+"."; prefDelta="Prefers with "+plainNoun(required)+"."; }
    else if(chosen && cat){ sumDelta="Revised look, removed "+plainNoun(cat)+"."; prefDelta="Prefers without "+plainNoun(cat)+"."; }
    else if(cat){ sumDelta="Tried revising without "+plainNoun(cat)+"; no valid look yet."; prefDelta="Prefers without "+plainNoun(cat)+"."; }
    else { sumDelta="Asked for revise clarification."; prefDelta=""; }
    if(didRenderOnUser){ sumDelta+=" Rendered on wearer."; }
    var outMeta={ imageDelivery: imageDelivery, renderOnUser: didRenderOnUser };
    if(didRenderOnUser && renderOnUserMeta){
      outMeta.profileRefs=renderOnUserMeta.profileRefs;
      outMeta.referencePieces=renderOnUserMeta.referencePieces;
      outMeta.referenceGarmentTotal=renderOnUserMeta.referenceGarmentTotal;
      outMeta.referenceDowngraded=renderOnUserMeta.referenceDowngraded;
      outMeta.referencePayloadBytes=renderOnUserMeta.referencePayloadBytes;
      outMeta.referenceMode=renderOnUserMeta.referenceMode;
      outMeta.previewPrompt=renderOnUserMeta.previewPrompt;
    }
    return { text: reply, image: img, persist:{ summaryDelta: sumDelta, preferencesDelta: prefDelta }, skill:"revise_look", meta: outMeta };
  }

  // Trace wrapper: Spark-fallback entries name only the chosen option
  // id ("interpret:spark:<choice>" / "interpret:spark:none") — never raw
  // text. Attached only when a fallback was actually attempted, so the
  // no-client path stays exactly as before.
  async function handle(opts){
    var o = opts || {};
    var trace = [];
    var inner = Object.assign({}, o, { _trace: trace });
    var r = await handleInner(inner);
    if (trace.length && r && typeof r === "object" && !Array.isArray(r.trace)) {
      r.trace = trace.slice();
    }
    return r;
  }
  var api = { handle: handle, skill: "revise_look", matchRevise: matchRevise, matchAdd: matchAdd };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["revise_look"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
