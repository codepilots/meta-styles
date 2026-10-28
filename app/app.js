"use strict";
/* meta-styles Milestone 1 — photo viewer + mock mask overlay + manual box.
 *
 * Segmentation interface: any segmenter implements
 *   segment(imageEl, sourceId) -> Promise<{ polygons, boxes }>
 * where polygons are [{ label, points: [[x,y],...] }] and boxes are
 * [{ label, rect: [x,y,w,h] }], all in normalized 0..1 coordinates.
 *
 * TODO(SAM-3.1): replace StubSegmentationService with a real client that
 * POSTs the image to the SAM 3.1 API and converts its masks to the shape
 * above. Nothing else in this file needs to change.
 */

const DEMOS = [
  { id: "demo-look-1", file: "demo-look-1.svg", name: "Wrap dress" },
  { id: "demo-look-2", file: "demo-look-2.svg", name: "Top + skirt" },
  { id: "demo-look-3", file: "demo-look-3.svg", name: "Jacket" },
];

const MASK_COLORS = {
  dress: "rgba(15, 118, 110, 1)",
  top: "rgba(15, 118, 110, 1)",
  skirt: "rgba(180, 120, 20, 1)",
  jacket: "rgba(40, 90, 160, 1)",
  garment: "rgba(15, 118, 110, 1)",
};

// ---------------------------------------------------------------------------
// Stub segmenter (stands in for SAM 3.1)
// ---------------------------------------------------------------------------
class StubSegmentationService {
  async segment(_imageEl, sourceId) {
    // Fake latency so the UI pattern (pending -> result) is exercised.
    await new Promise((r) => setTimeout(r, 500));
    return { polygons: mockPolygons(sourceId), boxes: [] };
  }
}

// Deterministic placeholder masks per demo image; a generic centered
// garment-ish shape for user uploads (key "upload").
function mockPolygons(sourceId) {
  switch (sourceId) {
    case "demo-look-1":
      return [{
        label: "dress",
        points: [
          [0.36, 0.16], [0.64, 0.16], [0.60, 0.34], [0.70, 0.62],
          [0.74, 0.86], [0.26, 0.86], [0.30, 0.62], [0.40, 0.34],
        ],
      }];
    case "demo-look-2":
      return [
        {
          label: "top",
          points: [
            [0.36, 0.14], [0.64, 0.14], [0.62, 0.30],
            [0.68, 0.46], [0.32, 0.46], [0.38, 0.30],
          ],
        },
        {
          label: "skirt",
          points: [
            [0.36, 0.50], [0.64, 0.50], [0.72, 0.84], [0.28, 0.84],
          ],
        },
      ];
    case "demo-look-3":
      return [{
        label: "jacket",
        points: [
          [0.30, 0.14], [0.70, 0.14], [0.74, 0.40], [0.70, 0.72],
          [0.58, 0.72], [0.55, 0.40], [0.52, 0.72], [0.48, 0.72],
          [0.45, 0.40], [0.42, 0.72], [0.30, 0.72], [0.26, 0.40],
        ],
      }];
    default:
      return [{
        label: "garment",
        points: [
          [0.35, 0.20], [0.65, 0.20], [0.62, 0.45],
          [0.70, 0.80], [0.30, 0.80], [0.38, 0.45],
        ],
      }];
  }
}

// ---------------------------------------------------------------------------
// State + canvas rendering (all geometry in normalized 0..1 coords)
// ---------------------------------------------------------------------------
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const readoutEl = document.getElementById("readout");

const state = {
  img: new Image(),
  sourceId: null,
  sourceName: "",
  imgAspect: 4 / 5,
  mask: null,          // { polygons } or null
  showMask: true,
  opacity: 0.45,
  box: null,           // [x, y, w, h] normalized or null
  drawMode: false,
  drag: null,          // active pointer gesture
};

const segmenter = new StubSegmentationService();
const HANDLE_R = 8; // px, hit-test radius for corner handles

function setStatus(text) {
  statusEl.textContent = text;
}

function fitCanvas() {
  const maxW = 640;
  canvas.width = maxW;
  canvas.height = Math.round(maxW / state.imgAspect);
  draw();
}

function toPx([x, y]) {
  return [x * canvas.width, y * canvas.height];
}

function toNorm(px, py) {
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width;
  const sy = canvas.height / r.height;
  return [
    Math.min(1, Math.max(0, ((px - r.left) * sx) / canvas.width)),
    Math.min(1, Math.max(0, ((py - r.top) * sy) / canvas.height)),
  ];
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (state.img.complete && state.img.naturalWidth) {
    ctx.drawImage(state.img, 0, 0, canvas.width, canvas.height);
  }
  if (state.showMask && state.mask) {
    for (const poly of state.mask.polygons) {
      ctx.beginPath();
      poly.points.forEach(([x, y], i) => {
        const [px, py] = toPx([x, y]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      const base = MASK_COLORS[poly.label] || MASK_COLORS.garment;
      ctx.fillStyle = withAlpha(base, state.opacity);
      ctx.fill();
      ctx.strokeStyle = withAlpha(base, 0.95);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  if (state.box) drawBox(state.box);
  updateReadout();
}

function withAlpha(rgba, a) {
  return rgba.replace(/[\d.]+\)$/, `${a})`);
}

function drawBox([x, y, w, h]) {
  const [x0, y0] = toPx([x, y]);
  const [x1, y1] = toPx([x + w, y + h]);
  ctx.save();
  ctx.strokeStyle = "#b3261e";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.setLineDash([]);
  ctx.fillStyle = "#b3261e";
  for (const [cx, cy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    ctx.fillRect(cx - 5, cy - 5, 10, 10);
  }
  ctx.restore();
}

function updateReadout() {
  if (typeof refreshRegionSources === "function") refreshRegionSources();
  if (!state.box) {
    readoutEl.textContent = "No box drawn yet.";
    return;
  }
  const [x, y, w, h] = state.box;
  const pw = Math.round(w * state.img.naturalWidth);
  const ph = Math.round(h * state.img.naturalHeight);
  readoutEl.textContent =
    `source: ${state.sourceName}\n` +
    `normalized: x=${x.toFixed(3)} y=${y.toFixed(3)} w=${w.toFixed(3)} h=${h.toFixed(3)}\n` +
    `pixels: ${pw} × ${ph} (on ${state.img.naturalWidth} × ${state.img.naturalHeight})`;
}

// ---------------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------------
function loadImage(src, sourceId, sourceName) {
  setStatus(`Loading ${sourceName}…`);
  state.mask = null;
  state.box = null;
  setDrawMode(false);
  const img = new Image();
  img.onload = () => {
    state.img = img;
    state.sourceId = sourceId;
    state.sourceName = sourceName;
    state.imgAspect = img.naturalWidth / img.naturalHeight;
    fitCanvas();
    markActiveThumb(sourceId);
    setStatus(`Showing ${sourceName} — no mask yet. Run segmentation or draw a box.`);
  };
  img.onerror = () => setStatus(`Could not load ${sourceName}.`);
  img.src = src;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const picker = document.getElementById("demoPicker");
for (const d of DEMOS) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.dataset.id = d.id;
  btn.title = d.name;
  btn.setAttribute("aria-pressed", "false");
  const thumb = document.createElement("img");
  thumb.src = d.file;
  thumb.alt = d.name;
  btn.appendChild(thumb);
  btn.addEventListener("click", () => loadImage(d.file, d.id, d.name));
  picker.appendChild(btn);
}

function markActiveThumb(sourceId) {
  for (const btn of picker.querySelectorAll("button")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.id === sourceId));
  }
}

document.getElementById("fileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  loadImage(url, "upload", file.name);
});

document.getElementById("segmentBtn").addEventListener("click", async () => {
  if (!state.sourceId) return;
  const btn = document.getElementById("segmentBtn");
  btn.disabled = true;
  setStatus("Segmenting… (stubbed SAM 3.1 call)");
  try {
    state.mask = await segmenter.segment(state.img, state.sourceId);
    const n = state.mask.polygons.length;
    setStatus(`Stub mask ready: ${n} region${n === 1 ? "" : "s"} for ${state.sourceName}.`);
  } catch (err) {
    setStatus(`Segmentation failed (${err.message}). Draw a box manually instead.`);
  } finally {
    btn.disabled = false;
    draw();
  }
});

document.getElementById("clearMaskBtn").addEventListener("click", () => {
  state.mask = null;
  draw();
  setStatus("Mask cleared. Draw a box manually if you need a selection.");
});

const drawBtn = document.getElementById("drawBtn");
drawBtn.addEventListener("click", () => setDrawMode(!state.drawMode));

function setDrawMode(on) {
  state.drawMode = on;
  drawBtn.setAttribute("aria-pressed", String(on));
  drawBtn.textContent = on ? "Cancel drawing" : "Draw box manually";
  canvas.classList.toggle("drawing", on);
}

document.getElementById("clearBoxBtn").addEventListener("click", () => {
  state.box = null;
  draw();
});

document.getElementById("maskToggle").addEventListener("change", (e) => {
  state.showMask = e.target.checked;
  draw();
});

document.getElementById("opacity").addEventListener("input", (e) => {
  state.opacity = e.target.value / 100;
  draw();
});

// ---------------------------------------------------------------------------
// Box gestures (pointer events: mouse + touch)
// ---------------------------------------------------------------------------
function boxHandles() {
  if (!state.box) return [];
  const [x, y, w, h] = state.box;
  return [toPx([x, y]), toPx([x + w, y]), toPx([x, y + h]), toPx([x + w, y + h])];
}

function hitHandle(px, py) {
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width;
  const sy = canvas.height / r.height;
  const cx = (px - r.left) * sx;
  const cy = (py - r.top) * sy;
  return boxHandles().findIndex(([hx, hy]) => Math.hypot(hx - cx, hy - cy) <= HANDLE_R * 1.5);
}

function insideBox(nx, ny) {
  if (!state.box) return false;
  const [x, y, w, h] = state.box;
  return nx >= x && nx <= x + w && ny >= y && ny <= y + h;
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const [nx, ny] = toNorm(e.clientX, e.clientY);
  if (state.drawMode) {
    state.drag = { kind: "new", x0: nx, y0: ny };
    state.box = [nx, ny, 0, 0];
    return;
  }
  if (!state.box) return;
  const hi = hitHandle(e.clientX, e.clientY);
  if (hi >= 0) {
    state.drag = { kind: "resize", handle: hi, orig: [...state.box] };
  } else if (insideBox(nx, ny)) {
    state.drag = { kind: "move", dx: nx - state.box[0], dy: ny - state.box[1] };
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!state.drag) return;
  const [nx, ny] = toNorm(e.clientX, e.clientY);
  const d = state.drag;
  if (d.kind === "new") {
    state.box = [
      Math.min(d.x0, nx), Math.min(d.y0, ny),
      Math.abs(nx - d.x0), Math.abs(ny - d.y0),
    ];
  } else if (d.kind === "move") {
    const w = state.box[2];
    const h = state.box[3];
    state.box[0] = Math.min(1 - w, Math.max(0, nx - d.dx));
    state.box[1] = Math.min(1 - h, Math.max(0, ny - d.dy));
  } else if (d.kind === "resize") {
    const [ox, oy, ow, oh] = d.orig;
    const x1 = ox + ow;
    const y1 = oy + oh;
    // handles: 0 TL, 1 TR, 2 BL, 3 BR
    let xa = d.handle % 2 === 0 ? nx : ox;
    let xb = d.handle % 2 === 0 ? x1 : nx;
    let ya = d.handle < 2 ? ny : oy;
    let yb = d.handle < 2 ? y1 : ny;
    if (xb - xa < 0.01 || yb - ya < 0.01) return;
    state.box = [
      Math.min(0.99, Math.max(0, xa)), Math.min(0.99, Math.max(0, ya)),
      Math.min(1, Math.max(0, xb)) - Math.min(0.99, Math.max(0, xa)),
      Math.min(1, Math.max(0, yb)) - Math.min(0.99, Math.max(0, ya)),
    ];
  }
  draw();
});

canvas.addEventListener("pointerup", () => {
  if (state.drag && state.drag.kind === "new") {
    const [, , w, h] = state.box;
    if (w < 0.01 || h < 0.01) state.box = null; // ignore accidental clicks
    else setStatus(`Manual box set on ${state.sourceName} — drag to move, corners to resize.`);
    setDrawMode(false);
    draw();
  }
  state.drag = null;
});

window.addEventListener("resize", () => draw());

// Boot with the first demo.
loadImage(DEMOS[0].file, DEMOS[0].id, DEMOS[0].name);

// ---------------------------------------------------------------------------
// Milestone 2 — tag regions with the classifier stub, assemble look cards.
// Depends on classifier.js + assembler.js loaded before this file (see
// index.html). Guards below keep Milestone 1 working if they fail to load.
// ---------------------------------------------------------------------------
const MS = (typeof window !== "undefined" && window.MetaStyles) || null;

const regionSourceEl = document.getElementById("regionSource");
const categorySelectEl = document.getElementById("categorySelect");
const suggestHintEl = document.getElementById("suggestHint");
const wardrobeEl = document.getElementById("wardrobe");
const validityEl = document.getElementById("validity");
const lookCardEl = document.getElementById("lookCard");

const wardrobe = []; // [{ id, category, sourceLabel, thumb, copy }]
let pieceSeq = 0;

// Milestone 3 element handles (looked up early so renderLook can use them;
// the share card itself renders in renderShare, defined further below).
const shareCardEl = document.getElementById("shareCard");
const shareTitleEl = document.getElementById("shareTitle");
const shareMetaEl = document.getElementById("shareMeta");
const shareBadgeEl = document.getElementById("shareBadge");
const sharePiecesEl = document.getElementById("sharePieces");
const shareStoryEl = document.getElementById("shareStory");
const shareFitEl = document.getElementById("shareFit");
const shareStubNoteEl = document.getElementById("shareStubNote");
const shareActionHintEl = document.getElementById("shareActionHint");
const previewCanvasEl = document.getElementById("previewCanvas");

let lastShareText = "";
let lastPreviewDataURL = "";

// Rebuild the region-source picker from current box/mask state, preserving
// the user's selection when it still exists.
function refreshRegionSources() {
  if (!regionSourceEl) return;
  const prev = regionSourceEl.value;
  regionSourceEl.innerHTML = "";
  const add = (value, label, disabled) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.disabled = !!disabled;
    regionSourceEl.appendChild(opt);
  };
  add("box", state.box ? "Manual box" : "Manual box (draw one first)", !state.box);
  const polys = (state.mask && state.mask.polygons) || [];
  polys.forEach((p, i) => add(`mask:${i}`, `Mask region ${i + 1} (${p.label})`, false));
  if ([...regionSourceEl.options].some((o) => o.value === prev && !o.disabled)) {
    regionSourceEl.value = prev;
  } else {
    const first = [...regionSourceEl.options].find((o) => !o.disabled);
    regionSourceEl.value = first ? first.value : "";
  }
}

function selectedRegion() {
  const v = regionSourceEl && regionSourceEl.value;
  if (v === "box" && state.box) {
    return { kind: "box", rect: [...state.box], labelHint: "", sourceLabel: `Manual box · ${state.sourceName}` };
  }
  const m = /^mask:(\d+)$/.exec(v || "");
  const polys = (state.mask && state.mask.polygons) || [];
  if (m && polys[+m[1]]) {
    const poly = polys[+m[1]];
    return {
      kind: "mask",
      rect: MS ? MS.bboxOfPoints(poly.points) : [0.2, 0.2, 0.6, 0.6],
      labelHint: poly.label,
      sourceLabel: `Mask region ${+m[1] + 1} (${poly.label}) · ${state.sourceName}`,
    };
  }
  return null;
}

// Crop a normalized rect of the current image to a thumbnail data URL.
function cropThumb(rect) {
  const img = state.img;
  const [x, y, w, h] = rect;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) return "";
  const sx = Math.round(x * iw);
  const sy = Math.round(y * ih);
  const sw = Math.max(1, Math.round(w * iw));
  const sh = Math.max(1, Math.round(h * ih));
  const c = document.createElement("canvas");
  const scale = Math.min(1, 160 / Math.max(sw, sh));
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

document.getElementById("suggestBtn").addEventListener("click", () => {
  const region = selectedRegion();
  if (!region || !MS) {
    suggestHintEl.textContent = region
      ? "Classifier failed to load — pick a category by hand."
      : "Nothing to label yet: run segmentation or draw a box first.";
    return;
  }
  const suggestion = MS.classifyRegion(region);
  categorySelectEl.value = MS.TAXONOMY.includes(suggestion.category)
    ? suggestion.category
    : categorySelectEl.value;
  suggestHintEl.textContent =
    `Stub suggests “${suggestion.category}” (${suggestion.method}, confidence: ${suggestion.confidence}). ` +
    "Confirm or change it, then add to your look.";
});

document.getElementById("addBtn").addEventListener("click", () => {
  const region = selectedRegion();
  if (!region) {
    setStatus("Nothing to add: run segmentation or draw a box first.");
    return;
  }
  const category = categorySelectEl.value;
  const copy = MS
    ? MS.placeholderCopy(category)
    : { category, text: "Placeholder piece description.", placeholder: true, note: "" };
  wardrobe.push({
    id: `piece-${++pieceSeq}`,
    category,
    sourceLabel: region.sourceLabel,
    thumb: cropThumb(region.rect),
    copy,
  });
  setStatus(`Added ${category} to your look (${wardrobe.length} piece${wardrobe.length === 1 ? "" : "s"}).`);
  renderLook();
});

function renderLook() {
  wardrobeEl.innerHTML = "";
  if (wardrobe.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Nothing tagged yet.";
    wardrobeEl.appendChild(p);
  }
  for (const item of wardrobe) {
    const div = document.createElement("div");
    div.className = "wardrobe-item";
    div.innerHTML =
      (item.thumb ? `<img src="${item.thumb}" alt="">` : "") +
      `<div><strong>${esc(item.category)}</strong><br>` +
      `<span class="hint">${esc(item.sourceLabel)}</span></div>`;
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "ghost small";
    rm.textContent = "Remove";
    rm.addEventListener("click", () => {
      wardrobe.splice(wardrobe.indexOf(item), 1);
      renderLook();
    });
    div.appendChild(rm);
    wardrobeEl.appendChild(div);
  }

  if (!MS) {
    validityEl.innerHTML = '<p class="hint">Assembler failed to load.</p>';
    lookCardEl.hidden = true;
    if (shareCardEl) shareCardEl.hidden = true;
    return;
  }
  const card = MS.assembleLook(wardrobe);
  const badge = card.valid
    ? '<span class="badge badge-ok">Valid full look ✔</span>'
    : '<span class="badge badge-bad">Not a full look yet</span>';
  const list = (items, cls) => items.length
    ? `<ul class="${cls}">${items.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`
    : "";
  validityEl.innerHTML =
    badge +
    `<span class="hint"> finish: ${esc(card.finish || "none")} · ${card.wordCount} / 300 words</span>` +
    list(card.reasons, "reasons") +
    list(card.notes, "notes hint");

  if (wardrobe.length === 0) {
    lookCardEl.hidden = true;
    if (shareCardEl) shareCardEl.hidden = true;
    return;
  }
  lookCardEl.hidden = false;
  lookCardEl.innerHTML =
    `<h3>Look card <span class="tag">placeholder copy — not real listings</span></h3>` +
    card.pieces.map((p) =>
      `<div class="piece">` +
      (p.thumb ? `<img src="${p.thumb}" alt="">` : "") +
      `<div><strong>${esc(p.category)}</strong> ` +
      `<span class="tag">placeholder</span>` +
      `<p>${esc(p.copy.text)}</p></div></div>`
    ).join("") +
    `<p class="fitnote">${esc(card.fitNote)}</p>` +
    `<p class="hint">${esc(card.placeholderNote)} ${card.wordCount} / 300 words.</p>`;
  // Milestone 3: share card renders from the same assembled card (async
  // preview draw runs fire-and-forget; text lands synchronously).
  renderShare(card);
}

refreshRegionSources();
renderLook();

// ---------------------------------------------------------------------------
// Milestone 3 — share card: Spark copy stub + preview-image stub + client-side
// copy/download. Depends on spark.js + preview.js loaded before this file;
// guards keep Milestones 1–2 working if they fail to load.
// ---------------------------------------------------------------------------
function buildShareText(card, spark) {
  const lines = [
    `${spark.title} — a meta-styles look card`,
    `${card.valid ? "Valid full look ✔" : "Not a full look yet"} · finish: ${card.finish || "none"} · ${spark.wordCount} / 300 words`,
    "",
  ];
  card.pieces.forEach((p, i) => {
    const sparkText = (spark.perPiece[i] && spark.perPiece[i].text) || p.copy.text;
    lines.push(`[${p.category}] ${sparkText}`);
    lines.push("");
  });
  lines.push(spark.lookStory, "", card.fitNote, "Placeholder card: Spark copy + preview image are stubbed mocks, not live AI output.");
  return lines.join("\n");
}

async function renderShare(card) {
  if (!shareCardEl) return;
  if (wardrobe.length === 0 || !MS || typeof MS.generateCopy !== "function") {
    shareCardEl.hidden = true;
    return;
  }
  const spark = MS.generateCopy(card);
  shareCardEl.hidden = false;
  shareTitleEl.textContent = spark.title;
  shareMetaEl.textContent =
    `finish: ${card.finish || "none"} · ${spark.wordCount} / 300 words` +
    (spark.trimmed ? " · Spark copy trimmed to budget" : "");
  shareBadgeEl.innerHTML = card.valid
    ? '<span class="badge badge-ok">Valid full look ✔</span>'
    : '<span class="badge badge-bad">Not a full look yet</span>';
  sharePiecesEl.innerHTML = card.pieces.map((p, i) => {
    const text = (spark.perPiece[i] && spark.perPiece[i].text) || p.copy.text;
    return `<div class="piece"><div><strong>${esc(p.category)}</strong> ` +
      `<span class="tag">placeholder</span><p>${esc(text)}</p></div></div>`;
  }).join("");
  shareStoryEl.textContent = spark.lookStory;
  shareFitEl.textContent = card.fitNote;
  shareStubNoteEl.textContent = `${spark.placeholderNote} ${card.placeholderNote}`;
  lastShareText = buildShareText(card, spark);

  // Mock preview image (stubbed canvas collage, TODO(Image-API)).
  if (MS && typeof MS.generateImage === "function" && previewCanvasEl) {
    try {
      const res = await MS.generateImage(previewCanvasEl, card);
      lastPreviewDataURL = res.dataURL || "";
    } catch (err) {
      lastPreviewDataURL = "";
      if (shareActionHintEl) shareActionHintEl.textContent = `Preview render failed (${err.message}).`;
    }
  }
}

document.getElementById("copyCardBtn").addEventListener("click", async () => {
  if (!lastShareText) return;
  shareActionHintEl.textContent = "";
  try {
    await navigator.clipboard.writeText(lastShareText);
    shareActionHintEl.textContent = "Share card copied as text ✔";
  } catch (err) {
    // Clipboard API unavailable (e.g. file:// without permission): fallback.
    const ta = document.createElement("textarea");
    ta.value = lastShareText;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      shareActionHintEl.textContent = "Share card copied as text ✔ (fallback)";
    } catch (e2) {
      shareActionHintEl.textContent = `Copy failed (${e2.message}). Select the card text manually.`;
    }
    ta.remove();
  }
});

document.getElementById("downloadCardBtn").addEventListener("click", () => {
  if (!lastPreviewDataURL) {
    shareActionHintEl.textContent = "No preview image yet — add pieces to your look first.";
    return;
  }
  const a = document.createElement("a");
  a.href = lastPreviewDataURL;
  a.download = "meta-styles-look.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  shareActionHintEl.textContent = "Preview image downloaded (client-side PNG) ✔";
});
