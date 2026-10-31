"use strict";
/* meta-styles Milestone 14 — Meta Model API proxy (NEW hackathon work).
 *
 * Why this exists: the app is a static browser page and the Meta Model API
 * key must never ship to a browser. This tiny stdlib-only Node server holds
 * the key server-side (MODEL_API_KEY from the process environment — see
 * start.sh, which parses ../.env/secrets without printing it) and exposes a
 * narrow local API the browser calls instead:
 *
 *   GET  /health          -> { ok, keyPresent, models }
 *   POST /api/segment     { image, phrases? }        -> SAM 3.1 polygons
 *   POST /api/classify    { image, labelHint? }      -> Spark vision category
 *   POST /api/palette     { image }                    -> Spark vision colour advice
 *   POST /api/copy        { pieces, finish, fitNote } -> Spark look copy (JSON)
 *   POST /api/assemble    { pieces }                 -> Spark look proposals
 *   POST /api/preview     { prompt, image? }         -> Muse Image data URL
 *
 * Upstream: https://api.meta.ai/v1 (OpenAI-compatible), Bearer auth.
 *   SAM 3.1:      POST /responses model=sam-3.1, one noun phrase per call,
 *                 output_text lines `<0f>0<|box;...|><|mask;...|>`
 *   Muse Spark:   POST /responses model=muse-spark-1.3 (text + vision)
 *   Muse Image:   POST /images/generations|edits model=muse-image-1.0
 *
 * Binds 127.0.0.1 only. No key, image bytes, or prompt text is logged.
 * Known limitation: SAM mask rasters (base85 payloads) are reported as
 * metadata only; polygons are the SAM box rectangles. A future pass can
 * decode rasters with @meta-sam/parser for true mask outlines.
 */

const http = require("http");
const crypto = require("crypto");

const DEFAULT_PORT = 8905;
const DEFAULT_API_BASE = "https://api.meta.ai/v1";
const DEFAULT_ORIGIN = "http://localhost:8000";
const SPARK_MODEL = "muse-spark-1.3";
const SAM_MODEL = "sam-3.1";
const IMAGE_MODEL = "muse-image-1.0";
const MAX_BODY = 12 * 1024 * 1024;
// Opus finding #14: the response cache below is process-wide (shared by all
// users), so keys must hash full inputs (never just input length) and the
// Map must stay bounded via the LRU helpers in createHandler.
const CACHE_MAX_ENTRIES = 200;
// Opus finding #15: every upstream Meta API call gets its own server-side
// bound, SHORTER than the matching browser client timeout in
// app/meta-client.js (classify/palette/copy/assemble 60s, route 30s,
// preview 120s, segment 180s for the whole op). Without this, one hung
// upstream stalls the proxy request until the client gives up — and the
// proxy keeps the abandoned work open. Timeouts reuse the 502 shape so
// callers fall back to the same skill-fallback path as other failures.
const DEFAULT_UPSTREAM_TIMEOUT_MS = 45000;
const SEGMENT_PHRASE_TIMEOUT_MS = 20000; // x <=8 phrases: whole op < 180s client
const PREVIEW_UPSTREAM_TIMEOUT_MS = 100000; // < 120s client
const ROUTE_UPSTREAM_TIMEOUT_MS = 20000; // < 30s client

const TAXONOMY = [
  "base/top", "base/bottom", "dress",
  "layer/cardigan", "layer/blazer", "scarf", "bag",
];

// SAM concept phrase -> overlay label used by app.js MASK_COLORS / hints.
const SAM_LABEL_MAP = {
  dress: "dress", top: "top", skirt: "skirt", jacket: "jacket",
  cardigan: "cardigan", scarf: "scarf", handbag: "bag", bag: "bag",
};
const DEFAULT_PHRASES = ["dress", "top", "skirt", "jacket", "cardigan", "scarf", "handbag"];

function hashKey(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex").slice(0, 24);
}

// --- Pure helpers (exported for tests) -------------------------------------

function extractOutputText(responseBody) {
  if (!responseBody || typeof responseBody !== "object") return "";
  if (typeof responseBody.output_text === "string") return responseBody.output_text;
  let text = "";
  for (const item of responseBody.output || []) {
    for (const c of item.content || []) {
      if (c.type === "output_text" && typeof c.text === "string") text += c.text;
    }
  }
  return text;
}

function parseJsonText(text) {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

// Parse one SAM output_text line set into normalized polygons + boxes.
// Wire: `<0f>0<|box;x1=..;y1=..;x2=..;y2=..;w=W;h=H[;c=..]|><|mask;...data=H,W,~..|>`
function parseSamOutput(text, phrase) {
  const label = SAM_LABEL_MAP[String(phrase || "").toLowerCase()] || String(phrase || "garment");
  const polygons = [];
  const boxes = [];
  const recordRe = /<\|box;([^|]+)\|>(?:<\|mask;([^|]+)\|>)?/g;
  let m;
  while ((m = recordRe.exec(String(text || ""))) !== null) {
    const fields = {};
    for (const part of m[1].split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0) fields[part.slice(0, eq)] = Number(part.slice(eq + 1));
    }
    const { x1, y1, x2, y2, w, h } = fields;
    if (![x1, y1, x2, y2, w, h].every((n) => Number.isFinite(n)) || w <= 0 || h <= 0) continue;
    const nx1 = Math.min(1, Math.max(0, x1 / w));
    const ny1 = Math.min(1, Math.max(0, y1 / h));
    const nx2 = Math.min(1, Math.max(0, x2 / w));
    const ny2 = Math.min(1, Math.max(0, y2 / h));
    if (nx2 <= nx1 || ny2 <= ny1) continue;
    let mask = null;
    if (m[2]) {
      const dm = /data=(\d+),(\d+),(.)/.exec(m[2]);
      if (dm) mask = { height: Number(dm[1]), width: Number(dm[2]), encoding: dm[3] === "!" ? "one_bit" : "lossless" };
    }
    polygons.push({
      label,
      points: [[nx1, ny1], [nx2, ny1], [nx2, ny2], [nx1, ny2]],
    });
    boxes.push({
      label,
      rect: [nx1, ny1, nx2 - nx1, ny2 - ny1],
      confidence: Number.isFinite(fields.c) ? fields.c : null,
      mask,
    });
  }
  return { polygons, boxes };
}

function normalizeCategory(raw) {
  let c = String(raw || "").toLowerCase().trim();
  const aliases = {
    "top": "base/top", "cami": "base/top", "camisole": "base/top", "tee": "base/top",
    "bottom": "base/bottom", "skirt": "base/bottom", "pants": "base/bottom", "jeans": "base/bottom",
    "cardigan": "layer/cardigan", "tie-blouse": "layer/cardigan", "blouse": "layer/cardigan", "shrug": "layer/cardigan",
    "blazer": "layer/blazer", "jacket": "layer/blazer", "coat": "layer/blazer",
    "handbag": "bag", "purse": "bag",
  };
  if (aliases[c]) c = aliases[c];
  return TAXONOMY.includes(c) ? c : null;
}

function coerceCategory(raw) {
  let c = String(raw || "").toLowerCase().trim();
  if (TAXONOMY.includes(c)) return c;
  const map = {
    "jacket": "layer/blazer", "coat": "layer/blazer", "blazer": "layer/blazer",
    "jumper": "layer/cardigan", "sweater": "layer/cardigan", "pullover": "layer/cardigan",
    "knitwear": "layer/cardigan", "cardigan": "layer/cardigan", "shrug": "layer/cardigan",
    "tie-blouse": "layer/cardigan", "tie blouse": "layer/cardigan",
    "shirt": "base/top", "blouse": "base/top", "top": "base/top", "tank": "base/top",
    "cami": "base/top", "camisole": "base/top", "tee": "base/top",
    "jeans": "base/bottom", "trousers": "base/bottom", "trousered": "base/bottom",
    "skirt": "base/bottom", "pants": "base/bottom",
    "frock": "dress", "gown": "dress", "pinafore": "dress", "dress": "dress",
    "pashmina": "scarf", "wrap": "scarf", "shawl": "scarf", "scarf": "scarf",
    "handbag": "bag", "purse": "bag", "tote": "bag", "clutch": "bag", "bag": "bag",
  };
  if (map[c]) return map[c];
  // shoes are deliberately not catalogueable -> null
  if (c.includes("shoe") || c.includes("sneaker") || c.includes("heel") || c.includes("boot")) return null;
  return null;
}

// --- Server ------------------------------------------------------------------

function sendJson(res, status, obj, corsOrigin) {
  const body = JSON.stringify(obj);
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  };
  if (corsOrigin) headers["Access-Control-Allow-Origin"] = corsOrigin;
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req, cap) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > cap) { tooLarge = true; return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(tooLarge ? { tooLarge: true } : { bytes: Buffer.concat(chunks) }));
    req.on("error", () => resolve({ bytes: Buffer.alloc(0) }));
  });
}

function createHandler(config) {
  const cfg = config || {};
  const apiKey = cfg.apiKey !== undefined ? cfg.apiKey : process.env.MODEL_API_KEY;
  const apiBase = (cfg.apiBase || process.env.META_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
  const allowOrigin = cfg.allowOrigin || process.env.META_PROXY_ALLOW_ORIGIN || DEFAULT_ORIGIN;
  const fetchImpl = cfg.fetchImpl || fetch;
  const cache = new Map();
  // Plain Map-based LRU over the shared cache: re-insert on hit to mark an
  // entry most-recently-used, evict oldest-first when over the bound.
  function cacheGet(k) {
    if (!cache.has(k)) return undefined;
    const v = cache.get(k);
    cache.delete(k);
    cache.set(k, v);
    return v;
  }
  function cacheSet(k, v) {
    if (cache.has(k)) cache.delete(k);
    cache.set(k, v);
    while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  }

  // Opus finding #15: resolve the per-call bound. cfg.timeoutMs caps
  // every route (tests inject a tiny value); otherwise each route uses
  // its own bound, all shorter than the matching client timeout.
  function resolveTimeout(routeMs) {
    const cap = cfg.timeoutMs !== undefined ? cfg.timeoutMs : DEFAULT_UPSTREAM_TIMEOUT_MS;
    return routeMs !== undefined ? Math.min(routeMs, cap) : cap;
  }

  function timeoutError(ms) {
    const e = new Error("Meta API timeout after " + ms + "ms");
    e.status = 502; e.code = "upstream_timeout";
    e.upstream = { raw: "proxy upstream timeout after " + ms + "ms" };
    return e;
  }

  async function upstream(path, body, routeTimeoutMs) {
    if (!apiKey) {
      const e = new Error("MODEL_API_KEY is not set on the proxy");
      e.status = 503; e.code = "key_missing";
      throw e;
    }
    const ms = resolveTimeout(routeTimeoutMs);
    // AbortController lets a well-behaved fetchImpl (real fetch) drop the
    // socket on timeout; the Promise.race below ALSO bounds mocks that
    // ignore the signal and never settle. Mirror app/meta-client.js post():
    // clearTimeout(timer) on every path so no timer leaks.
    const ctrl = new AbortController();
    let timer = null;
    const timeoutP = new Promise((_, reject) => {
      timer = setTimeout(() => { ctrl.abort(); reject(timeoutError(ms)); }, ms);
    });
    const fetchP = fetchImpl(apiBase + path, {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    // Mark a late settlement handled so a hung mock resolving after the
    // race already settled never surfaces as an unhandled rejection.
    if (fetchP && typeof fetchP.catch === "function") fetchP.catch(() => {});
    let res;
    try {
      res = await Promise.race([fetchP, timeoutP]);
    } catch (err) {
      clearTimeout(timer);
      // A fetchImpl that honours the signal rejects with an abort error
      // instead of hanging until our race fires — classify that as the
      // same 502 timeout shape.
      if (ctrl.signal.aborted && (!err || err.code !== "upstream_timeout")) throw timeoutError(ms);
      throw err;
    }
    clearTimeout(timer);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep raw below */ }
    if (!res.ok) {
      const e = new Error("Meta API HTTP " + res.status);
      e.status = res.status === 429 ? 429 : 502;
      e.upstreamStatus = res.status;
      e.upstream = json && json.error ? json.error : { raw: text.slice(0, 300) };
      throw e;
    }
    return json;
  }

  async function sparkJson(systemText, userContent, cacheTag, routeTimeoutMs) {
    const cacheK = cacheTag ? hashKey(cacheTag) : null;
    if (cacheK) { const hit = cacheGet(cacheK); if (hit !== undefined) return { parsed: hit, cached: true }; }
    const body = await upstream("/responses", {
      model: SPARK_MODEL,
      input: [{
        type: "message", role: "user",
        content: [
          { type: "input_text", text: systemText + "\n\n" + (typeof userContent === "string" ? userContent : "") },
          ...(Array.isArray(userContent) ? userContent : []),
        ],
      }],
    }, routeTimeoutMs);
    const parsed = parseJsonText(extractOutputText(body));
    if (cacheK && parsed) cacheSet(cacheK, parsed);
    return { parsed, cached: false };
  }

  return async function handler(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const origin = req.headers.origin || null;
    const corsOrigin = origin === allowOrigin ? allowOrigin : null;
    if (req.method === "OPTIONS" && origin && req.headers["access-control-request-method"]) {
      if (!corsOrigin) { sendJson(res, 403, { error: "forbidden_origin" }); return; }
      res.writeHead(204, {
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }
    if (origin && !corsOrigin) { sendJson(res, 403, { error: "forbidden_origin" }); return; }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true, keyPresent: !!apiKey,
        models: { spark: SPARK_MODEL, sam: SAM_MODEL, image: IMAGE_MODEL },
      }, corsOrigin);
      return;
    }
    if (req.method !== "POST") { sendJson(res, 404, { error: "not_found" }, corsOrigin); return; }

    const parsedBody = await readBody(req, MAX_BODY);
    if (parsedBody.tooLarge) { sendJson(res, 413, { error: "body_too_large" }, corsOrigin); return; }
    let payload = null;
    try { payload = JSON.parse(parsedBody.bytes.toString("utf8")); } catch { payload = null; }
    if (!payload || typeof payload !== "object") { sendJson(res, 400, { error: "bad_request" }, corsOrigin); return; }

    try {
      if (url.pathname === "/api/segment") {
        const image = payload.image;
        if (typeof image !== "string" || !image.startsWith("data:image/")) {
          sendJson(res, 400, { error: "image_data_url_required" }, corsOrigin); return;
        }
        const phrases = (Array.isArray(payload.phrases) && payload.phrases.length
          ? payload.phrases : DEFAULT_PHRASES).slice(0, 8).map(String);
        const ck = hashKey(image.slice(0, 4096) + "|" + phrases.join(",") + "|" + image.length);
        { const segHit = cacheGet(ck); if (segHit !== undefined) { sendJson(res, 200, { ...segHit, cached: true }, corsOrigin); return; } }
        let polygons = [];
        let boxes = [];
        for (const phrase of phrases) {
          const body = await upstream("/responses", {
            model: SAM_MODEL,
            input: [{
              type: "message", role: "user",
              content: [
                { type: "input_text", text: phrase },
                { type: "input_image", image_url: image },
              ],
            }],
            stream: false,
            metadata: { mask_encoding: "one_bit", include_confidence: "true" },
          }, SEGMENT_PHRASE_TIMEOUT_MS);
          const got = parseSamOutput(extractOutputText(body), phrase);
          polygons = polygons.concat(got.polygons);
          boxes = boxes.concat(got.boxes);
        }
        const out = { polygons, boxes, source: "sam-3.1", model: SAM_MODEL, placeholder: false };
        cacheSet(ck, out);
        sendJson(res, 200, out, corsOrigin);
        return;
      }

      if (url.pathname === "/api/classify") {
        const image = payload.image;
        if (typeof image !== "string" || !image.startsWith("data:image/")) {
          sendJson(res, 400, { error: "image_data_url_required" }, corsOrigin); return;
        }
        const hint = payload.labelHint ? ` The segmentation hint is "${String(payload.labelHint).slice(0, 40)}".` : "";
        const classifyCacheKey = hashKey(image.slice(0, 4096) + "|classify|" + image.length);
        { const hit = cacheGet(classifyCacheKey); if (hit !== undefined) { sendJson(res, 200, { ...hit, cached: true }, corsOrigin); return; } }
        const { parsed } = await sparkJson(
          "You classify one garment region for a tall/curvy styling app. " +
          `Reply with JSON only: {"category":"...","confidence":0.0}. ` +
          `Category must be exactly one of: ${TAXONOMY.join(", ")}. ` +
          "Tie-blouses and shrugs are layer/cardigan, never a base. Never return shoes.",
          [{ type: "input_image", image_url: image }],
          null
        );
        const category = parsed ? coerceCategory(parsed.category) : null;
        if (!category) {
          const fallback = { category: "dress", method: "spark-vision", confidence: 0, placeholder: true, source: SPARK_MODEL };
          cacheSet(classifyCacheKey, fallback);
          sendJson(res, 200, fallback, corsOrigin);
          return;
        }
        const outClassify = {
          category,
          method: "spark-vision",
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
          placeholder: false, source: SPARK_MODEL,
        };
        cacheSet(classifyCacheKey, outClassify);
        sendJson(res, 200, outClassify, corsOrigin);
        return;
      }

      if (url.pathname === "/api/palette") {
        const image = payload.image;
        if (typeof image !== "string" || !image.startsWith("data:image/")) {
          sendJson(res, 400, { error: "image_data_url_required" }, corsOrigin); return;
        }
        const { parsed } = await sparkJson(
          "You suggest colours that suit the person in this photo for a tall/curvy Y2K x fairycore styling app. " +
          "Look at what is actually visible (skin tone, hair colour, existing clothing colours in frame) and " +
          'reply with JSON only: {"palette":["colour1","colour2","colour3"],"note":"..."}. ' +
          "Palette: 2-4 short colour/tone words (not hex codes). Note: one short sentence of genuine " +
          "reasoning tied to what is visible. Never invent facts not visible in the photo.",
          [{ type: "input_image", image_url: image }],
          hashKey(image.slice(0, 4096) + "|palette|" + image.length)
        );
        const palette = parsed && Array.isArray(parsed.palette)
          ? parsed.palette.filter((w) => typeof w === "string" && w.trim()).slice(0, 4)
          : [];
        const note = parsed && typeof parsed.note === "string" ? parsed.note.trim() : "";
        if (palette.length < 2 || !note) { sendJson(res, 502, { error: "unparseable_palette", raw: parsed }, corsOrigin); return; }
        sendJson(res, 200, {
          palette,
          note,
          method: "spark-vision",
          placeholder: false, source: SPARK_MODEL,
        }, corsOrigin);
        return;
      }

      if (url.pathname === "/api/copy") {
        const pieces = Array.isArray(payload.pieces) ? payload.pieces.slice(0, 12) : [];
        if (!pieces.length) { sendJson(res, 400, { error: "pieces_required" }, corsOrigin); return; }
        const desc = pieces.map((p) => `${p.id}: ${p.category}`).join("\n");
        const { parsed, cached } = await sparkJson(
          "You write short Y2K x fairycore look-card copy for a 6'2\" tall/curvy wearer (size 18 top / 12 bottom). " +
          "Describe styling and fit only — do not invent vendor names, prices, measurements, or claim real listings. " +
          'Reply with JSON only: {"title":"...","perPiece":[{"id":"...","text":"..."}],"lookStory":"..."}. ' +
          "Keep title + all pieces + story under 240 words total.",
          `Finish: ${payload.finish || "none"}\nFit note: ${String(payload.fitNote || "").slice(0, 400)}\nPieces:\n${desc}`,
          "copy|" + desc + "|" + (payload.finish || "")
        );
        if (!parsed || !Array.isArray(parsed.perPiece)) { sendJson(res, 502, { error: "unparseable_copy" }, corsOrigin); return; }
        sendJson(res, 200, { ...parsed, cached: !!cached, source: SPARK_MODEL, placeholder: false }, corsOrigin);
        return;
      }

      if (url.pathname === "/api/assemble") {
        const pieces = Array.isArray(payload.pieces) ? payload.pieces.slice(0, 16) : [];
        if (pieces.length < 2) { sendJson(res, 400, { error: "pieces_required" }, corsOrigin); return; }
        const desc = pieces.map((p) => `${p.id}: ${p.category}`).join("\n");
        const { parsed, cached } = await sparkJson(
          "You propose complete outfits. A valid look needs a base (dress, or base/top and/or base/bottom) plus exactly one finish: either exactly one layer (layer/cardigan or layer/blazer) OR a scarf plus a bag. Never include shoes. Never use two layers. " +
          'Reply with JSON only: {"looks":[{"pieceIds":["..."],"rationale":"..."}]} with up to 3 looks, best first.',
          `Available pieces:\n${desc}`,
          "assemble|" + desc
        );
        if (!parsed || !Array.isArray(parsed.looks)) { sendJson(res, 502, { error: "unparseable_assembly" }, corsOrigin); return; }
        sendJson(res, 200, { looks: parsed.looks, cached: !!cached, source: SPARK_MODEL, placeholder: false }, corsOrigin);
        return;
      }

      if (url.pathname === "/api/preview") {
        const prompt = String(payload.prompt || "").slice(0, 1000);
        if (!prompt) { sendJson(res, 400, { error: "prompt_required" }, corsOrigin); return; }
        // Multi-reference preview (max 4): accept legacy `image` or new `images[]`.
        let refs = null;
        if (payload.images !== undefined) {
          if (!Array.isArray(payload.images) || payload.images.length === 0 || payload.images.length > 4) {
            sendJson(res, 400, { error: "image_data_url_required" }, corsOrigin); return;
          }
          for (const u of payload.images) {
            if (typeof u !== "string" || !u.startsWith("data:image/")) {
              sendJson(res, 400, { error: "image_data_url_required" }, corsOrigin); return;
            }
          }
          refs = payload.images;
        } else if (payload.image !== undefined && payload.image !== null) {
          if (typeof payload.image !== "string" || !payload.image.startsWith("data:image/")) {
            sendJson(res, 400, { error: "image_data_url_required" }, corsOrigin); return;
          }
          refs = [payload.image];
        }
        // Opus finding #14: hash the FULL image data URLs, not just length —
        // two different garment photos with equal-length data URLs must never
        // share a cache entry. Text-only previews keep their exact old key.
        const ck = refs ? hashKey(prompt + "|" + refs.join("|")) : hashKey(prompt + "|0");
        { const prevHit = cacheGet(ck); if (prevHit !== undefined) { sendJson(res, 200, { ...prevHit, cached: true }, corsOrigin); return; } }
        let body;
        if (refs) {
          body = await upstream("/images/edits", {
            model: IMAGE_MODEL, prompt, n: 1,
            images: refs.map(function (u) { return { image_url: u }; }),
          }, PREVIEW_UPSTREAM_TIMEOUT_MS);
        } else {
          body = await upstream("/images/generations", { model: IMAGE_MODEL, prompt, n: 1 }, PREVIEW_UPSTREAM_TIMEOUT_MS);
        }
        const first = body && body.data && body.data[0];
        if (!first || !first.b64_json) { sendJson(res, 502, { error: "no_image_returned" }, corsOrigin); return; }
        const fmt = body.output_format || "webp";
        const out = {
          dataURL: `data:image/${fmt};base64,${first.b64_json}`,
          source: IMAGE_MODEL, placeholder: false,
        };
        cacheSet(ck, out);
        sendJson(res, 200, out, corsOrigin);
        return;
      }

      if (url.pathname === "/api/route") {
        var text = typeof payload.text === "string" ? payload.text : "";
        var SKILL_NAMES = [
          "catalogue_piece","propose_look","revise_look","describe_wardrobe",
          "explain_fit","answer_no_data","off_topic",
          "Match_look","Complete_the_look","What_suits","Evaluate_prospective_purchase"
        ];
        var imagePresent = !!payload.imagePresent;
        var wardrobeSummary = typeof payload.wardrobeSummary === "string" ? payload.wardrobeSummary : "";
        var preferences = typeof payload.preferences === "string" ? payload.preferences : "";
        var lastTurns = Array.isArray(payload.lastTurns) ? payload.lastTurns.slice(0,5).map(String) : [];
        var lastTurnsStr = lastTurns.length ? "Recent turns:\n" + lastTurns.map(function(t){return "- "+t;}).join("\n") : "No prior turns.";
        var hasImageNote = imagePresent ? "An image IS attached to this message." : "No image attached.";
        // lsCache optional pattern for route: cache by content hash
        var routeCacheKey = null;
        try { routeCacheKey = "route|" + hashKey(text+"|"+imagePresent+"|"+wardrobeSummary+"|"+preferences+"|"+lastTurns.join("|")); } catch(e){}
        if (routeCacheKey) { const routeHit = cacheGet(routeCacheKey); if (routeHit !== undefined) { sendJson(res, 200, Object.assign({}, routeHit, { cached: true }), corsOrigin); return; } }
        var skillList = SKILL_NAMES.join(", ");
        var triggers = [
          "catalogue_piece: Photo(s) shared (image present, no other trigger — but FIRST check Recent turns: if the assistant just asked the user to share a photo, route to that skill instead)",
          "propose_look: user wants a look suggested — e.g. \"show me a look\", \"what goes together\", \"style me\", \"outfit idea\", \"cook up a look\", \"make me a look\", \"can you find …\"",
          "revise_look: user wants to change last look — e.g. \"no bag\", \"without blazer\", \"swap scarf\", \"drop the bag\"",
          // Opus finding #13: "find the bag" lives under describe_wardrobe only
          // (locating a wardrobe item), not under propose_look.
          "describe_wardrobe: user wants to see/list wardrobe — e.g. \"what do I have\", \"show my wardrobe\", \"find the bag\"",
          "explain_fit: user asks why look works — e.g. \"why does this work\", \"explain the fit\"",
          "answer_no_data: fabric/price/vendor question — e.g. \"what fabric\", \"how much does it cost\"",
          "off_topic: unrelated topic or greeting with no wardrobe intent",
          "Match_look: inspiration photo + wants to recreate that look — e.g. \"do this look\", \"like this\" with image",
          "Complete_the_look: wants buying advice to finish a look — e.g. \"complete the look\", \"what could I buy\"",
          "What_suits: asks what colours/styles suit them — e.g. \"what suits me\", \"what colours suit me\"; also the photo reply when Recent turns show the assistant just asked for head-shot/full-body photos",
          "Evaluate_prospective_purchase: image of item they consider buying — e.g. \"should I buy\", \"worth buying\" with image"
        ].join("\n");
        var systemText =
          "You are a router for a wardrobe styling app. Given the user's message and context, pick exactly one skill.\n" +
          "Skills and their triggers:\n" + triggers + "\n" +
          "Valid skills: " + skillList + "\n" +
          "Rules: Return STRICT JSON only with exactly this shape: {\"skill\":\"<one of 11>\",\"confidence\":0-100,\"reason\":\"short\"}. " +
          "Before defaulting a bare photo to catalogue_piece, check Recent turns for a just-asked pending question (e.g. a request to share photos); if present, route to that skill. " +
          "Use confidence 85-95 for clear matches, 40-65 for vague/ambiguous inputs like \"hmm\" or greetings. " +
          "Vague single-word or greeting inputs should get confidence <70 so the system can ask for clarification.";
        var userStr =
          "Message: \"" + text.slice(0,500) + "\"\n" +
          hasImageNote + "\n" +
          (wardrobeSummary ? "Wardrobe summary: " + wardrobeSummary.slice(0,400) + "\n" : "") +
          (preferences ? "Preferences: " + preferences.slice(0,400) + "\n" : "") +
          lastTurnsStr;
        var out = await upstream("/responses", {
          model: SPARK_MODEL,
          input: [{ type: "message", role: "user", content: [{ type: "input_text", text: systemText + "\n\n" + userStr }] }],
          text: { format: { type: "json_object" } }
        }, ROUTE_UPSTREAM_TIMEOUT_MS);
        var parsed = parseJsonText(extractOutputText(out));
        if (!parsed || typeof parsed.skill !== "string" || SKILL_NAMES.indexOf(parsed.skill) === -1) {
          var e2 = new Error("route: unparseable or invalid skill");
          e2.status = 502; e2.code = "unparseable_route"; e2.upstream = parsed;
          throw e2;
        }
        var conf = typeof parsed.confidence === "number" ? Math.round(parsed.confidence) : 75;
        var reason = typeof parsed.reason === "string" ? parsed.reason.slice(0,200) : "routed via Spark";
        var routeOut = { skill: parsed.skill, confidence: conf, reason: reason, source: SPARK_MODEL, placeholder: false };
        if (routeCacheKey) cacheSet(routeCacheKey, routeOut);
        sendJson(res, 200, routeOut, corsOrigin);
        return;
      }

      if (url.pathname === "/api/detect") {
        const image = payload.image;
        if (typeof image !== "string" || !image.startsWith("data:image/")) {
          sendJson(res, 400, { error: "image_data_url_required" }, corsOrigin); return;
        }
        if (!apiKey) { const e=new Error("MODEL_API_KEY is not set on the proxy"); e.status=503; e.code="key_missing"; throw e; }
        const detectCacheKey = hashKey(image.slice(0, 4096) + "|detect|" + image.length);
        { const hit = cacheGet(detectCacheKey); if (hit !== undefined) { sendJson(res, 200, Object.assign({}, hit, { cached: true }), corsOrigin); return; } }
        var detectFallback = null;
        try {
          const { parsed: classifyParsed } = await sparkJson(
            "You classify one garment region for a tall/curvy styling app. " +
            `Reply with JSON only: {"category":"...","confidence":0.0}. ` +
            `Category must be exactly one of: ${TAXONOMY.join(", ")}. ` +
            "Tie-blouses and shrugs are layer/cardigan, never a base. Never return shoes.",
            [{ type: "input_image", image_url: image }],
            null
          );
          const fallbackCat = classifyParsed ? coerceCategory(classifyParsed.category) : null;
          if (fallbackCat) detectFallback = fallbackCat;
        } catch (e) { /* fallback may stay null */ }
        try {
          const { parsed } = await sparkJson(
            "You detect every garment in this outfit photo for a tall/curvy styling app. " +
            `Categories must be exactly one of: ${TAXONOMY.join(", ")}. ` +
            'Reply with STRICT JSON only: {"pieces":[{"category":"...","layer_role":null or word,"attributes":{"color":null or word},"bbox":[x,y,w,h]}]} ' +
            "where bbox is fractional [x,y,w,h] in [0,1] for the garment bounding box. " +
            "List every distinct garment visible. Category must be exactly one of the 7 listed. Never return shoes. " +
            "If only one garment is visible, return a single-element pieces array.",
            [{ type: "input_image", image_url: image }],
            null
          );
          let pieces = [];
          if (parsed && Array.isArray(parsed.pieces)) {
            for (let i = 0; i < parsed.pieces.length && pieces.length < 6; i++) {
              const raw = parsed.pieces[i];
              if (!raw || typeof raw !== "object") continue;
              const cat = coerceCategory(raw.category);
              if (!cat) continue;
              let bbox = raw.bbox;
              if (!Array.isArray(bbox) || bbox.length !== 4) continue;
              let ok = true;
              for (let j = 0; j < 4; j++) { if (typeof bbox[j] !== "number" || !isFinite(bbox[j])) { ok = false; break; } }
              if (!ok) continue;
              if (bbox[2] <= 0 || bbox[3] <= 0) continue;
              const x1 = Math.min(1, bbox[0] + bbox[2]), y1 = Math.min(1, bbox[1] + bbox[3]);
              if (x1 <= Math.max(0, bbox[0]) || y1 <= Math.max(0, bbox[1])) continue;
              bbox = [Math.max(0, Math.min(1, bbox[0])), Math.max(0, Math.min(1, bbox[1])), Math.max(0, Math.min(1, bbox[2])), Math.max(0, Math.min(1, bbox[3]))];
              let attrs = {};
              if (raw.attributes && typeof raw.attributes === "object" && !Array.isArray(raw.attributes)) {
                if (typeof raw.attributes.color === "string" && raw.attributes.color.trim()) attrs.color = raw.attributes.color.trim().slice(0, 40);
              }
              let layerRole = null;
              if (typeof raw.layer_role === "string" && raw.layer_role.trim()) layerRole = raw.layer_role.trim().slice(0, 40);
              pieces.push({ category: cat, layer_role: layerRole, attributes: attrs, bbox: bbox });
            }
          }
          if (pieces.length === 0) throw new Error("no valid pieces parsed");
          const out = { placeholder: false, pieces: pieces, source: SPARK_MODEL };
          cacheSet(detectCacheKey, out);
          sendJson(res, 200, out, corsOrigin);
          return;
        } catch (e) {
          if(e && (e.status===503 || e.code==="key_missing" || e.code==="upstream_timeout" || e.status===502 && e.code==="upstream_timeout")) throw e;
          const fbPieces = detectFallback ? [{ category: detectFallback, layer_role: null, attributes: {}, bbox: [0, 0, 1, 1] }] : [];
          const out = { placeholder: true, pieces: fbPieces, source: SPARK_MODEL };
          cacheSet(detectCacheKey, out);
          sendJson(res, 200, out, corsOrigin);
          return;
        }
      }

      sendJson(res, 404, { error: "not_found" }, corsOrigin);
    } catch (err) {
      sendJson(res, err.status || 500, {
        error: err.code || "upstream_failed",
        message: err.message,
        upstreamStatus: err.upstreamStatus || null,
        upstream: err.upstream || null,
      }, corsOrigin);
    }
  };
}

function startServer(opts) {
  const options = opts || {};
  const port = options.port !== undefined ? options.port : DEFAULT_PORT;
  const server = http.createServer(createHandler(options));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server }));
  });
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--port");
  const port = Number((i !== -1 && argv[i + 1]) || process.env.META_PROXY_PORT || DEFAULT_PORT);
  startServer({ port }).then(({ server }) => {
    console.log(`meta-api-proxy listening on 127.0.0.1:${server.address().port} (key present: ${!!process.env.MODEL_API_KEY})`);
  }).catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = {
  createHandler, startServer,
  extractOutputText, parseJsonText, parseSamOutput, normalizeCategory, coerceCategory,
  TAXONOMY, SAM_LABEL_MAP, DEFAULT_PORT, SPARK_MODEL, SAM_MODEL, IMAGE_MODEL,
  CACHE_MAX_ENTRIES,
  DEFAULT_UPSTREAM_TIMEOUT_MS, SEGMENT_PHRASE_TIMEOUT_MS,
  PREVIEW_UPSTREAM_TIMEOUT_MS, ROUTE_UPSTREAM_TIMEOUT_MS,
};
