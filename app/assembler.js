"use strict";
/* meta-styles Milestone 2 — look-card assembler with fit rules.
 *
 * Fit rules (hardcoded from docs/decisions.md):
 * - Output is a FULL LOOK CARD: a base garment plus exactly one finish —
 *   either one layer (cardigan/jacket/blazer; tie-blouses and shrugs count
 *   as layers over a cami/base) OR a scarf + bag pair. NEVER shoes.
 * - Layers never stack: two or more layers is invalid.
 * - An incomplete finish is invalid: a lone scarf or a lone bag is flagged,
 *   not silently accepted. A lone base with no finish is also invalid.
 * - Target body: tall/curvy, 6'2", size 18 top / 12 bottom — the fit note
 *   acknowledges proportions, not generic sizing.
 * - Aesthetic: Y2K x fairycore.
 * - Card total: <= 300 words (per-piece copy + fit note). Over-budget cards
 *   are trimmed at word boundaries and flagged, never silently over.
 */
(function (root) {
  const BASE = ["base/top", "base/bottom", "dress"];
  const LAYERS = ["layer/cardigan", "layer/blazer"];
  const MAX_WORDS = 300;

  // Per-finish fit notes (M23): the old single FIT_NOTE described only the
  // "layer worn open" finish, which is false for scarf+bag looks. Each
  // variant keeps Autumn's real confirmed specs (tall/curvy 6'2",
  // 18 top / 12 bottom — not placeholder) and the Y2K x fairycore line.
  const FIT_NOTE_LAYER =
    "Fit note: cut for a tall/curvy 6'2\" frame — size 18 top / 12 bottom. " +
    "Bases run long in torso and hem; layers are worn open so nothing pulls at the bust; " +
    "accessories sit high to keep proportions leggy. Y2K x fairycore: shine, mesh, butterflies, soft metallics.";
  const FIT_NOTE_SCARF_BAG =
    "Fit note: cut for a tall/curvy 6'2\" frame — size 18 top / 12 bottom. " +
    "Bases run long in torso and hem; the scarf is tied high and accessories sit at/above the natural waist, " +
    "so nothing added stacks or pulls at the bust. Y2K x fairycore: shine, mesh, butterflies, soft metallics.";
  const FIT_NOTES = { layer: FIT_NOTE_LAYER, "scarf+bag": FIT_NOTE_SCARF_BAG };
  // Backward-compatible default: the layer variant is closest to the old
  // single string, and the only in-repo importer (explain_fit) now picks
  // per-finish via FIT_NOTES with this as its fallback.
  const FIT_NOTE = FIT_NOTE_LAYER;

  function fitNoteFor(finish) {
    return finish === "scarf+bag" ? FIT_NOTE_SCARF_BAG : FIT_NOTE_LAYER;
  }

  function wordCount(text) {
    return text.split(/\s+/).filter(Boolean).length;
  }

  function trimTo(text, budget) {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= budget) return { text, trimmed: false };
    return { text: words.slice(0, Math.max(1, budget)).join(" ") + "…", trimmed: true };
  }

  // items: [{ id, category, copy: { text, placeholder, note } }]
  // Returns { valid, finish, baseIds, reasons[], notes[], pieces[],
  //           fitNote, wordCount, trimmed, placeholder }
  function assembleLook(items) {
    const reasons = [];
    const notes = [];
    const by = (cats) => items.filter((it) => cats.includes(it.category));
    const base = by(BASE);
    const layers = by(LAYERS);
    const scarves = by(["scarf"]);
    const bags = by(["bag"]);
    const shoes = items.filter(
      (it) => it.category === "shoes" || /shoe/i.test(it.category)
    );

    if (shoes.length > 0) {
      reasons.push(
        `Shoes are explicitly excluded from look cards (too hard to size): remove ${shoes.length} shoe piece(s).`
      );
    }
    if (base.length === 0) {
      reasons.push("Missing base: add a dress, or a top and/or bottom.");
    }
    if (layers.length >= 2) {
      reasons.push(
        `Two layers stacked (${layers.map((l) => l.category).join(" + ")}): tie-blouses and shrugs are layers over a cami/base — keep exactly one.`
      );
    }

    const hasLayerFinish = layers.length === 1;
    const hasScarfBagFinish = scarves.length >= 1 && bags.length >= 1;
    let finish = null;
    if (hasLayerFinish && hasScarfBagFinish) {
      reasons.push("Two finishes at once (layer plus scarf + bag): pick exactly one finish.");
    } else if (hasLayerFinish) {
      if (scarves.length >= 1 || bags.length >= 1) {
        reasons.push("Stray accessory with a layer finish (layer plus a lone scarf and/or bag): a layer look takes no scarf or bag — drop the stray piece, or drop the layer and pair the scarf with its bag.");
      } else {
        finish = "layer";
      }
    } else if (hasScarfBagFinish) {
      finish = "scarf+bag";
    } else if (scarves.length >= 1 || bags.length >= 1) {
      reasons.push("Incomplete finish: a scarf needs its bag partner and vice versa (scarf + bag together, or one layer).");
    } else if (layers.length === 0) {
      reasons.push("Missing finish: add one layer, or a scarf + bag pair.");
    }
    // layers.length >= 2 already pushed its reason; no finish assigned.

    if (base.some((b) => b.category === "dress") && base.length > 1) {
      notes.push("Dress plus separates: the dress alone counts as the base; extra base pieces are spare options.");
    }

    // Assemble card copy within the 300-word budget (fit note included).
    // The note is the variant matching this look's own finish (invalid
    // looks with no finish keep the layer default, as before).
    const fitNote = fitNoteFor(finish);
    const fitWords = wordCount(fitNote);
    let budget = MAX_WORDS - fitWords;
    const pieces = items.map((it) => ({ ...it, copy: { ...it.copy } }));
    // Trim longest pieces first until the card fits.
    let trimmed = false;
    const totalWords = () =>
      pieces.reduce((n, p) => n + wordCount(p.copy.text), 0);
    while (pieces.length > 0 && totalWords() > budget) {
      let longest = pieces[0];
      for (const p of pieces) {
        if (wordCount(p.copy.text) > wordCount(longest.copy.text)) longest = p;
      }
      const target = Math.max(1, wordCount(longest.copy.text) - (totalWords() - budget));
      const out = trimTo(longest.copy.text, target);
      longest.copy.text = out.text;
      longest.copy.trimmed = true;
      trimmed = true;
      if (!out.trimmed) break;
    }
    if (trimmed) {
      notes.push("Per-piece copy trimmed to hold the card to ≤300 words total.");
    }

    const valid = reasons.length === 0;
    return {
      valid,
      finish,
      baseIds: base.map((b) => b.id),
      reasons,
      notes,
      pieces,
      fitNote: fitNote,
      wordCount: totalWords() + fitWords,
      trimmed,
      // Placeholder provenance: no real vendor data yet (see classifier.js).
      placeholder: true,
      placeholderNote:
        "Placeholder card: per-piece copy is invented, not from real resale listings.",
    };
  }

  root.MetaStyles = root.MetaStyles || {};
  Object.assign(root.MetaStyles, { BASE, LAYERS, MAX_WORDS, FIT_NOTE, FIT_NOTE_LAYER, FIT_NOTE_SCARF_BAG, FIT_NOTES, fitNoteFor, assembleLook });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.MetaStyles;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
