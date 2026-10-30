"use strict";
/* meta-styles Milestone 21 — skill: explain_fit. NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 * Persona: cheery green witch, fairy-core, warm complimentary, never shaming.
 *
 * M23: the handler used to ignore its context and return one fixed
 * paragraph. It now reads the most recent proposed/revised look first
 * (turn proposals via lastTurns object entries or catalog.getTurns(),
 * newest first), then finish-noun hints in recent user text cross-checked
 * against the catalog's real active pieces, then the catalog's active
 * pieces alone. Piece nouns are only ever named from catalog data — with
 * no look/catalog data it gives an honest no-guess fallback, never
 * invented piece names.
 */
(function (root) {

  function plainNoun(c){
    var m={"base/top":"top","base/bottom":"bottom","dress":"dress","layer/cardigan":"cardigan","layer/blazer":"blazer","scarf":"scarf","bag":"bag"};
    return m[c]||null;
  }

  // User-text finish hints ("my scarf look", "without the blazer") — only
  // ever used when the named category really is in the active catalog.
  var HINT_WORDS=[
    { re:/\bcardigan\b|shrug|tie-blouse|blouse/, category:"layer/cardigan" },
    { re:/\bblazer\b|jacket|coat/, category:"layer/blazer" },
    { re:/\bscarf\b|wrap\b/, category:"scarf" },
    { re:/\bbag\b|purse|handbag/, category:"bag" },
    { re:/\bdress\b|gown/, category:"dress" },
    { re:/\btop\b|cami|camisole|tee/, category:"base/top" },
    { re:/\bbottom\b|jeans|skirt|trousers|pants|mini/, category:"base/bottom" }
  ];
  function hintCategories(text){
    if(typeof text!=="string") return [];
    var low=text.toLowerCase(), out=[];
    for(var i=0;i<HINT_WORDS.length;i++){
      if(HINT_WORDS[i].re.test(low)) out.push(HINT_WORDS[i].category);
    }
    return out;
  }

  function inferFinish(cats){
    var hasLayer=cats.some(function(c){ return c==="layer/cardigan"||c==="layer/blazer"; });
    var hasScarf=cats.indexOf("scarf")!==-1, hasBag=cats.indexOf("bag")!==-1;
    if(hasLayer) return "layer";
    if(hasScarf&&hasBag) return "scarf+bag";
    return null;
  }

  function finishFromNote(note){
    var m=/valid:(layer|scarf\+bag)/.exec(String((note===undefined||note===null)?"":note));
    if(!m) return null;
    return m[1]==="scarf+bag" ? "scarf+bag" : "layer";
  }

  function safeActive(catalog){
    try { var a=catalog ? catalog.getActivePieces() : []; return Array.isArray(a) ? a : []; }
    catch(e){ return []; }
  }
  function safeTurns(catalog){
    try { var t=catalog && typeof catalog.getTurns==="function" ? catalog.getTurns() : []; return Array.isArray(t) ? t : []; }
    catch(e){ return []; }
  }
  function safePiece(catalog, id){
    try { return catalog && typeof catalog.getPiece==="function" ? catalog.getPiece(id) : null; }
    catch(e){ return null; }
  }

  // Resolve one turn proposal's piece ids to real catalog categories.
  // Returns null when nothing resolves (unknown ids are skipped, never named).
  function resolveProposal(catalog, proposal){
    if(!proposal || !Array.isArray(proposal.pieces) || proposal.pieces.length===0) return null;
    var cats=[];
    for(var i=0;i<proposal.pieces.length;i++){
      var p=safePiece(catalog, proposal.pieces[i]);
      if(p && typeof p.category==="string" && plainNoun(p.category)) cats.push(p.category);
    }
    if(cats.length===0) return null;
    var finish=finishFromNote(proposal.note) || inferFinish(cats);
    return { cats: cats, finish: finish };
  }

  // Most recent proposed/revised look: object-shaped lastTurns entries
  // first (newest last), then the catalog's own recorded turns.
  function latestLook(catalog, lastTurns){
    for(var i=lastTurns.length-1;i>=0;i--){
      var t=lastTurns[i];
      if(t && typeof t==="object" && t.proposal){
        var r=resolveProposal(catalog, t.proposal);
        if(r) return r;
      }
    }
    var turns=safeTurns(catalog);
    for(var j=turns.length-1;j>=0;j--){
      if(turns[j] && turns[j].proposal){
        var r2=resolveProposal(catalog, turns[j].proposal);
        if(r2) return r2;
      }
    }
    return null;
  }

  // Fallback: a coherent look from the active catalog alone (bases plus
  // exactly one finish — layers preferred, mirroring the assembler's
  // deterministic fallback order). Returns null when no finish exists.
  function lookFromActive(active){
    var cats=active.map(function(p){ return p.category; }).filter(function(c){ return !!plainNoun(c); });
    var layers=cats.filter(function(c){ return c==="layer/cardigan"||c==="layer/blazer"; });
    var hasScarf=cats.indexOf("scarf")!==-1, hasBag=cats.indexOf("bag")!==-1;
    var bases=cats.filter(function(c){ return c==="base/top"||c==="base/bottom"||c==="dress"; });
    if(bases.length===0) return null;
    if(layers.length===1) return { cats: bases.concat(layers), finish: "layer" };
    if(hasScarf&&hasBag) return { cats: bases.concat(["scarf","bag"]), finish: "scarf+bag" };
    return null;
  }

  function fitNoteFor(MS, finish){
    if(MS && MS.FIT_NOTES && typeof MS.FIT_NOTES[finish]==="string") return MS.FIT_NOTES[finish];
    if(MS && typeof MS.fitNoteFor==="function") { try { return MS.fitNoteFor(finish); } catch(e){} }
    if(MS && typeof MS.FIT_NOTE==="string") return MS.FIT_NOTE;
    return "";
  }

  async function handle(opts){
    var o=opts||{}, catalog=o.catalog;
    var lastTurns=Array.isArray(o.lastTurns) ? o.lastTurns : (Array.isArray(o.history) ? o.history : []);
    var MS=root.MetaStyles||{};
    var active=safeActive(catalog);
    var activeCats={};
    active.forEach(function(p){ if(p && typeof p.category==="string") activeCats[p.category]=true; });

    // 1. Most recent proposed/revised look.
    var look=latestLook(catalog, lastTurns);

    // 2. Finish hints in recent user text, cross-checked against the real
    // catalog so hinted-but-absent pieces are never named.
    if(!look){
      for(var i=lastTurns.length-1;i>=0;i--){
        if(typeof lastTurns[i]!=="string") continue;
        var hinted=hintCategories(lastTurns[i]).filter(function(c){ return !!activeCats[c]; });
        if(hinted.length===0) continue;
        var hf=inferFinish(hinted);
        if(hf==="layer" || hf==="scarf+bag"){
          var bases=active.map(function(p){ return p.category; })
            .filter(function(c){ return c==="base/top"||c==="base/bottom"||c==="dress"; });
          var finishCats=hinted.filter(function(c){
            return hf==="layer"
              ? (c==="layer/cardigan"||c==="layer/blazer")
              : (c==="scarf"||c==="bag");
          });
          if(bases.length>0 && finishCats.length>0){
            look={ cats: bases.slice(0,2).concat(finishCats), finish: hf };
            break;
          }
        }
      }
    }

    // 3. Catalog's active pieces alone.
    if(!look && active.length>0) look=lookFromActive(active);

    // 4. Honest fallback: no look data anywhere — say so, name nothing.
    if(!look || !look.finish){
      return {
        text: "Oh, lovely question, darling ✨ I don't have a look to read just yet, so I won't guess at pieces — " +
          "share a photo or two and once we've spun a look together I'll tell you exactly why the fit sings. " +
          "Y2K x fairycore, made for you! ✨",
        image: null,
        persist: { summaryDelta: "Explained fit: no look yet, said so honestly.", preferencesDelta: "" },
        skill: "explain_fit"
      };
    }

    var nouns=look.cats.map(function(c){ return plainNoun(c); }).join(" + ");
    var baseCat=look.cats.filter(function(c){ return c==="base/top"||c==="base/bottom"||c==="dress"; })[0] || look.cats[0];
    var baseNoun=plainNoun(baseCat) || "base";
    var body;
    if(look.finish==="layer"){
      var layerNoun=plainNoun(look.cats.filter(function(c){ return c==="layer/cardigan"||c==="layer/blazer"; })[0]) || "layer";
      body="Oh, lovely question, darling ✨ Your " + nouns + " work because the " + baseNoun +
        " gives you that long, leggy line, and the " + layerNoun +
        " worn open keeps everything skimming — nothing pulls at the bust, nothing stacks, just soft shimmer where you want it. " +
        "Y2K x fairycore, made for you! ✨";
    } else {
      body="Oh, lovely question, darling ✨ Your " + nouns + " work because the " + baseNoun +
        " gives you that long, leggy line, and the scarf tied high with the bag sitting pretty at the waist " +
        "keeps everything in proportion — nothing added stacks, just soft shimmer where you want it. " +
        "Y2K x fairycore, made for you! ✨";
    }
    var note=fitNoteFor(MS, look.finish);
    if(note) body+="\n\n"+note;
    return {
      text: body,
      image: null,
      persist: { summaryDelta: "Explained fit for " + nouns + " (" + look.finish + ").", preferencesDelta: "" },
      skill: "explain_fit"
    };
  }

  var api = { handle: handle, skill: "explain_fit" };
  root.MetaStyles = root.MetaStyles || {};
  root.MetaStyles.skills = root.MetaStyles.skills || {};
  root.MetaStyles.skills["explain_fit"] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
