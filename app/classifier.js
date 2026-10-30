"use strict";
/* meta-styles Milestone 2 — garment classifier stub.
 *
 * Fixed taxonomy: base/top, base/bottom, dress, layer/cardigan,
 * layer/blazer, scarf, bag. "shoes" is deliberately NOT in the taxonomy:
 * shoes are explicitly excluded from look cards (too hard to size), and the
 * assembler rejects them — see assembler.js.
 *
 * Fitting conventions baked in here: tie-blouses and shrugs are LAYERS worn
 * over a cami/base, so hint labels like "tie-blouse" or "shrug" map to
 * "layer/cardigan", never to a base.
 *
 * Milestone 14c: classifyRegion below is the offline heuristic fallback.
 * The live path is classifyFromSpark (Muse Spark vision via the proxy),
 * which returns the same { category, method, confidence, placeholder }
 * shape with placeholder:false.
 */
(function (root) {
  const TAXONOMY = [
    "base/top",
    "base/bottom",
    "dress",
    "layer/cardigan",
    "layer/blazer",
    "scarf",
    "bag",
  ];

  // Mask-label hints from Milestone 1's stub segmenter (or a future SAM 3.1
  // label set) mapped onto the taxonomy. Tie-blouses/shrugs -> layer.
  const HINT_MAP = {
    dress: "dress",
    gown: "dress",
    top: "base/top",
    cami: "base/top",
    camisole: "base/top",
    tee: "base/top",
    blouse: "layer/cardigan", // tie-blouses are layers over a cami/base
    "tie-blouse": "layer/cardigan",
    shrug: "layer/cardigan",
    skirt: "base/bottom",
    pants: "base/bottom",
    jeans: "base/bottom",
    trousers: "base/bottom",
    jacket: "layer/blazer",
    blazer: "layer/blazer",
    coat: "layer/blazer",
    cardigan: "layer/cardigan",
    scarf: "scarf",
    bag: "bag",
    purse: "bag",
  };

  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function bboxOfPoints(points) {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const [x, y] of points) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
  }

  // region: { kind: "box"|"mask", rect: [x,y,w,h] (normalized),
  //           labelHint?: string, sourceId?: string }
  // Deterministic: same input always yields the same category.
  function classifyRegion(region) {
    const hint = (region.labelHint || "").toLowerCase().trim();
    if (hint && HINT_MAP[hint]) {
      return {
        category: HINT_MAP[hint],
        method: `hint:${hint}`,
        confidence: "stub",
        placeholder: true,
      };
    }
    const [x, y, w, h] = region.rect;
    const area = w * h;
    const yCenter = y + h / 2;
    const aspect = w / Math.max(h, 1e-6);
    // Small regions read as accessories; tall centered ones as dresses.
    if (area < 0.02) {
      return {
        category: yCenter < 0.5 ? "scarf" : "bag",
        method: "rule:small-area-accessory",
        confidence: "stub",
        placeholder: true,
      };
    }
    if (aspect > 2.2 && yCenter < 0.4) {
      return {
        category: "scarf",
        method: "rule:wide-high-wrap",
        confidence: "stub",
        placeholder: true,
      };
    }
    if (h > 0.55 && x > 0.15 && x + w < 0.85) {
      return {
        category: "dress",
        method: "rule:tall-centered",
        confidence: "stub",
        placeholder: true,
      };
    }
    if (yCenter < 0.42) {
      return {
        category: "base/top",
        method: "rule:upper-region",
        confidence: "stub",
        placeholder: true,
      };
    }
    if (yCenter > 0.55) {
      return {
        category: "base/bottom",
        method: "rule:lower-region",
        confidence: "stub",
        placeholder: true,
      };
    }
    // Mid-band ambiguity: deterministic hash tiebreak so the offline
    // fallback is stable across reloads. Live scores come from Spark.
    const pick = TAXONOMY[fnv1a(JSON.stringify(region.rect)) % TAXONOMY.length];
    return {
      category: pick,
      method: "rule:hash-tiebreak",
      confidence: "stub",
      placeholder: true,
    };
  }

  // Placeholder per-piece copy: vendor-grounded resale-listing tone,
  // Y2K x fairycore, fit-aware for tall/curvy (6'2", size 18 top / 12
  // bottom). PLACEHOLDER — no real vendor data backs any of this; every
  // record carries placeholder:true plus this note. Kept ~45-55 words so a
  // full card stays under the 300-word cap.
  const PLACEHOLDER_NOTE =
    "Placeholder copy: no real vendor data yet — do not treat as a real listing.";
  const COPY_BANK = {
    "base/top":
      "Deadstock Y2K butterfly-mesh cami in washed lilac, built-in shelf and extra-long straps cut for a 6'2\" torso. Skims a size-18 bust without riding up; sheer overlay over opaque lining keeps it fairycore-soft. Pairs under any layer in this card.",
    "base/bottom":
      "Low-rise Y2K denim mini in sun-faded wash, longer hem than standard so it sits right on a tall frame. Relaxed through a size-12 hip with stretch at the waist; raw fray reads fairycore when paired with sheer layers.",
    dress:
      "Mesh-trim wrap dress in sage with an all-over butterfly print and lace-edged hem. Empire waist skims a size-18 bust while the skirt floats over a size-12 bottom; cut long through the torso for 6'2\". One-piece base, pure Y2K fairycore.",
    "layer/cardigan":
      "Cropped tie-front shrug in cream pointelle knit — a layer, never a base. Worn open over the cami so nothing pulls at the bust; cropped length keeps a long torso leggy. Strawberry-milk Y2K staple with fairycore eyelet texture.",
    "layer/blazer":
      "Oversized Y2K pinstripe blazer in sheer-coated charcoal, sleeves cut long for tall arms. Worn open over the base so the shoulders drape instead of binding a size-18 top. Sharpens the fairycore softness with city edge.",
    scarf:
      "Iridescent mesh neck scarf in opal butterfly print. Ties high at the throat to draw the eye up and lengthen a 6'2\" line; featherweight, catches the light. The fairycore signal piece of the scarf-plus-bag finish.",
    bag:
      "Mini Y2K shoulder bag in silver metallic faux leather with butterfly charm. Strap drop fits over layers without digging; just big enough for phone and gloss. Shine that ties the fairycore story together.",
  };

  // Milestone 14c: validate a Muse Spark vision result (from the proxy in
  // meta-client.js) onto this module's contract. Spark proposes; the fixed
  // taxonomy + tie-blouse/shrug layer rule dispose. Returns null when the
  // model output is off-taxonomy, so callers fall back to classifyRegion.
  function classifyFromSpark(region, sparkResult) {
    if (!sparkResult || typeof sparkResult.category !== "string") return null;
    let category = sparkResult.category.toLowerCase().trim();
    const aliases = {
      top: "base/top", cami: "base/top", bottom: "base/bottom", skirt: "base/bottom",
      cardigan: "layer/cardigan", "tie-blouse": "layer/cardigan", blouse: "layer/cardigan",
      shrug: "layer/cardigan", blazer: "layer/blazer", jacket: "layer/blazer",
      handbag: "bag", purse: "bag",
    };
    if (aliases[category]) category = aliases[category];
    if (!TAXONOMY.includes(category)) return null;
    const hint = (region && region.labelHint || "").toLowerCase().trim();
    if ((hint === "tie-blouse" || hint === "shrug" || hint === "blouse") && category.startsWith("base/")) {
      category = "layer/cardigan";
    }
    return {
      category,
      method: "spark-vision",
      confidence: typeof sparkResult.confidence === "number" ? sparkResult.confidence : "live",
      placeholder: false,
    };
  }

  function placeholderCopy(category) {
    return {
      category,
      text: COPY_BANK[category] || "Placeholder piece description.",
      placeholder: true,
      note: PLACEHOLDER_NOTE,
    };
  }

  root.MetaStyles = root.MetaStyles || {};
  Object.assign(root.MetaStyles, {
    TAXONOMY,
    HINT_MAP,
    classifyRegion,
    classifyFromSpark,
    bboxOfPoints,
    placeholderCopy,
    PLACEHOLDER_NOTE,
  });
  // Also register under the nested "classifier" key: auto-reply.js's
  // sibling() resolves modules by this file's own hyphen-free name
  // ("classifier"), but this file has always registered its functions
  // flat on MetaStyles (no nested namespace at all) for app.js's existing
  // MS.classifyFromSpark(...) call style. Without this alias,
  // sibling("classifier") finds nothing, auto-reply.js's classifyPhoto()
  // fallback calls null.classifyRegion(), the resulting TypeError is
  // swallowed by its own try/catch, and every real photo silently gets
  // "Couldn't make sense of that photo" with category:null -- found live
  // 30 Oct 2026 debugging why auto-reply never sent a single real reply.
  root.MetaStyles.classifier = {
    TAXONOMY,
    HINT_MAP,
    classifyRegion,
    classifyFromSpark,
    bboxOfPoints,
    placeholderCopy,
    PLACEHOLDER_NOTE,
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.MetaStyles;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
