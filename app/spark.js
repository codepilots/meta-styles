"use strict";
/* meta-styles Milestone 3 — Spark copy generator stub.
 *
 * Interface: generateCopy(lookCard) takes an assembled look card (the return
 * shape of assembleLook in assembler.js) and returns richer per-piece +
 * whole-look copy:
 *   { title, perPiece: [{ id, category, text }], lookStory,
 *     wordCount, trimmed, placeholder, placeholderNote, source }
 * Total (title + per-piece + story + the card's fit note) is held to the
 * shared ≤300-word card budget, trimmed at word boundaries and flagged —
 * same convention as assembler.js.
 *
 * STUB: all text below is invented placeholder copy (placeholder:true), Y2K x
 * fairycore voice, fit-aware for tall/curvy (6'2", size 18 top / 12 bottom).
 * No Meta API is called; .env/secrets is never read here.
 *
 * TODO(Spark-API): replace the body of generateCopy with a real Meta Muse
 * Spark call — e.g. POST the look card's pieces + fit note with a
 * ≤300-word Y2K-x-fairycore system prompt to the Model API and map the
 * response onto { title, perPiece, lookStory }. Keep the return shape and
 * the word-budget trim so the share-card UI needs no changes.
 */
(function (root) {
  function wordCount(text) {
    return String(text).split(/\s+/).filter(Boolean).length;
  }

  function trimTo(text, budget) {
    const words = String(text).split(/\s+/).filter(Boolean);
    if (words.length <= budget) return { text, trimmed: false };
    return {
      text: words.slice(0, Math.max(1, budget)).join(" ") + "…",
      trimmed: true,
    };
  }

  // Longer-form per-piece copy than the Milestone 2 bank: adds a fabric /
  // detail sentence plus a styling-tip sentence per piece. PLACEHOLDER.
  const SPARK_BANK = {
    "base/top":
      "Deadstock Y2K butterfly-mesh cami in washed lilac, built-in shelf and extra-long straps cut for a 6'2\" torso so it never rides up over a size-18 bust. Sheer glitter overlay floats over an opaque lining — fairycore-soft with a wink of shine. Style tip: leave the straps long and let the hem peek under your finish layer; the lilac reads like moonlight against metallics.",
    "base/bottom":
      "Low-rise Y2K denim mini in a sun-faded wash, hemmed longer than standard so it lands right on a tall frame instead of hiking up. Relaxed through a size-12 hip with hidden stretch at the waistband, raw fray at the hem for fairycore texture. Style tip: sit it on the hips and balance the short line with a sheer layer or high-tied scarf up top.",
    dress:
      "Mesh-trim wrap dress in sage with an all-over butterfly print, lace-edged hem, and an empire waist that skims a size-18 bust while the skirt floats over a size-12 bottom. Cut long through the torso for 6'2\" — no tugging at the shoulders, no surprise mini. Style tip: one-piece base, so let your single finish do the talking; this print loves silver shine.",
    "layer/cardigan":
      "Cropped tie-front shrug in cream pointelle knit — a layer, never a base, worn open over the cami so nothing pulls at the bust. Cropped length keeps a long torso leggy; the eyelet texture is pure fairycore while the strawberry-milk cream keeps it sweet Y2K. Style tip: knot it loose and push the sleeves up; bare wrists + a charm bracelet finish the arm.",
    "layer/blazer":
      "Oversized Y2K pinstripe blazer in sheer-coated charcoal, sleeves cut long for tall arms and shoulders that drape instead of binding a size-18 top. Worn open over the base, it sharpens fairycore softness with city edge. Style tip: roll the cuffs once to flash lining, and keep everything underneath soft and shimmery — the blazer is the frame, not the picture.",
    scarf:
      "Iridescent mesh neck scarf in an opal butterfly print, featherweight and catching the light with every turn. Tied high at the throat it draws the eye up and lengthens a 6'2\" line — the fairycore signal piece of the scarf-plus-bag finish. Style tip: knot it off-center over one shoulder and let the tails trail; echo the opal tones in gloss or shadow.",
    bag:
      "Mini Y2K shoulder bag in silver metallic faux leather with a butterfly charm on the zip. Strap drop clears layers without digging into the shoulder; just big enough for phone and gloss. Style tip: wear it high under the arm so the shine sits near the face — it's the full stop at the end of the fairycore sentence.",
  };

  const FALLBACK_TEXT =
    "Placeholder piece description — longer Spark-style copy will land with the real API.";

  const STORIES = {
    layer:
      "✨ Whole-look story (placeholder): soft base, one sharp-or-sweet layer worn open — the silhouette stays long and leggy while shine and mesh do the Y2K talking. Nothing pulls, nothing stacks; butterflies optional but encouraged.",
    "scarf+bag":
      "✨ Whole-look story (placeholder): the base floats clean while the scarf-plus-bag finish works as a pair — light-catching mesh up top, silver shine at the hip. High tie, high carry, long line: fairycore shimmer anchored for a tall frame.",
    none: "✨ Whole-look story (placeholder): this card isn't a full look yet — add one layer, or a scarf + bag pair, and the story writes itself.",
  };

  const TITLES = {
    layer: "✨ Moonlit Mesh Layering Story",
    "scarf+bag": "✨ Opal Shine + Flutter Finish",
    none: "✨ Look In Progress",
  };

  function generateCopy(lookCard) {
    // TODO(Spark-API): live call goes here — POST lookCard.pieces +
    // lookCard.fitNote to the Muse Spark Model API and map the response
    // onto { title, perPiece, lookStory }. Everything below is stub.
    const ms = root.MetaStyles || {};
    const maxWords = ms.MAX_WORDS || 300;
    const fitNote = (lookCard && lookCard.fitNote) || "";
    const fitWords = fitNote ? wordCount(fitNote) : 0;
    const budget = Math.max(1, maxWords - fitWords);

    const pieces = ((lookCard && lookCard.pieces) || []).map((p) => ({
      id: p.id,
      category: p.category,
      text: SPARK_BANK[p.category] || FALLBACK_TEXT,
    }));
    const finish = (lookCard && lookCard.finish) || null;
    const title = TITLES[finish || "none"];
    let story = STORIES[finish || "none"];

    // Hold title + pieces + story to budget; trim longest text first.
    let trimmed = false;
    const totalWords = () =>
      wordCount(title) +
      pieces.reduce((n, p) => n + wordCount(p.text), 0) +
      wordCount(story);
    const fields = () => [
      ...pieces.map((p) => ({
        get: () => p.text,
        set: (t) => { p.text = t; },
      })),
      { get: () => story, set: (t) => { story = t; } },
    ];
    let guard = 0;
    while (totalWords() > budget && guard++ < 50) {
      const fs = fields();
      let longest = fs[0];
      for (const f of fs) {
        if (wordCount(f.get()) > wordCount(longest.get())) longest = f;
      }
      const target = Math.max(
        1,
        wordCount(longest.get()) - (totalWords() - budget)
      );
      const out = trimTo(longest.get(), target);
      longest.set(out.text);
      trimmed = true;
      if (!out.trimmed) break;
    }

    return {
      title,
      perPiece: pieces,
      lookStory: story,
      wordCount: totalWords() + fitWords,
      trimmed,
      placeholder: true,
      placeholderNote:
        "Placeholder Spark copy: invented longer-form text, not from the Muse Spark Model API — no live call yet (TODO(Spark-API)).",
      source: "stub",
    };
  }

  root.MetaStyles = root.MetaStyles || {};
  Object.assign(root.MetaStyles, { generateCopy, SPARK_BANK });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.MetaStyles;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
