"use strict";
/* Milestone 14 — Meta Model API integration tests (no live key needed).
 *
 * Covers: SAM wire parsing, Spark JSON/category validation, model-copy
 * mapping, assembler fit rules (direct, per roadmap M18), and the proxy
 * HTTP routes against a fake upstream (fetchImpl injection).
 * Live-API proof is separate: one real call per model was verified
 * 2026-10-28 against api.meta.ai (see docs/roadmap.md M14).
 *
 * Run: node app/test/milestone14-meta-api.test.js
 */

// Localhost must bypass any env HTTP proxy (sandbox sets one for external traffic).
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";

const path = require("path");
const assert = (cond, name, detail) => {
  if (cond) { passes++; console.log("PASS: " + name); }
  else { failures++; console.log("FAIL: " + name + (detail ? " — " + detail : "")); }
};
let passes = 0;
let failures = 0;

const proxy = require(path.resolve(__dirname, "../../meta-api-proxy/server.js"));
require(path.resolve(__dirname, "../classifier.js"));
require(path.resolve(__dirname, "../assembler.js"));
require(path.resolve(__dirname, "../spark.js"));
require(path.resolve(__dirname, "../preview.js"));
const MS = globalThis.MetaStyles;

// --- SAM wire parsing -------------------------------------------------------
const samText =
  "<0f>0<|box;x1=60;y1=30;x2=179;y2=139;w=240;h=320;c=0.55|>" +
  "<|mask;x=0;y=0;c=0.55;data=110,120,!abc|>,1<|box;x1=0;y1=160;x2=240;y2=320;w=240;h=320|>";
const sam = proxy.parseSamOutput(samText, "top");
assert(sam.polygons.length === 2 && sam.boxes.length === 2, "sam: parses two records");
assert(
  Math.abs(sam.boxes[0].rect[0] - 60 / 240) < 1e-9 && Math.abs(sam.boxes[0].rect[2] - 119 / 240) < 1e-9,
  "sam: box normalized to 0..1"
);
assert(sam.boxes[0].confidence === 0.55, "sam: confidence parsed");
assert(sam.boxes[0].mask && sam.boxes[0].mask.height === 110 && sam.boxes[0].mask.encoding === "one_bit",
  "sam: mask metadata parsed");
assert(sam.polygons[0].label === "top", "sam: phrase label kept");
assert(proxy.parseSamOutput("", "dress").polygons.length === 0, "sam: empty output is valid zero-match");
assert(proxy.parseSamOutput("<0f>", "dress").polygons.length === 0, "sam: junk output yields no polygons");

// --- Spark response helpers ---------------------------------------------------
assert(
  proxy.extractOutputText({ output: [{ content: [{ type: "output_text", text: "hi" }] }] }) === "hi",
  "spark: extractOutputText from responses shape"
);
assert(
  proxy.parseJsonText('```json\n{"a":1}\n```').a === 1 && proxy.parseJsonText('x {"a":2} y').a === 2,
  "spark: parseJsonText handles fences and prose"
);
assert(proxy.parseJsonText("no json") === null, "spark: parseJsonText null on junk");
assert(proxy.normalizeCategory("Tie-Blouse") === "layer/cardigan", "spark: tie-blouse maps to layer");
assert(proxy.normalizeCategory("shoes") === null, "spark: shoes off-taxonomy -> null");
assert(proxy.normalizeCategory("dress") === "dress", "spark: dress kept");

// --- Classifier validation (Spark proposes, taxonomy disposes) ----------------
const c1 = MS.classifyFromSpark({ labelHint: "" }, { category: "base/top", confidence: 0.8 });
assert(c1 && c1.category === "base/top" && c1.placeholder === false && c1.method === "spark-vision",
  "classify: live result keeps contract, placeholder false");
const c2 = MS.classifyFromSpark({ labelHint: "shrug" }, { category: "base/top", confidence: 0.5 });
assert(c2 && c2.category === "layer/cardigan", "classify: shrug hint forces layer over base");
assert(MS.classifyFromSpark({}, { category: "shoes" }) === null, "classify: off-taxonomy -> null (fallback)");
assert(MS.classifyFromSpark({}, null) === null, "classify: null result -> null");

// --- Model copy mapping -------------------------------------------------------
const card = MS.assembleLook([
  { id: "piece-1", category: "dress", copy: { text: "x", placeholder: true } },
  { id: "piece-2", category: "layer/cardigan", copy: { text: "y", placeholder: true } },
]);
const modelCopy = MS.generateCopyFromModel(card, {
  title: "Live Title",
  perPiece: [{ id: "piece-1", text: "Spark dress copy." }],
  lookStory: "Spark story.",
  source: "muse-spark-1.3",
});
assert(modelCopy && modelCopy.placeholder === false && modelCopy.source === "muse-spark-1.3",
  "copy: model result placeholder false");
assert(modelCopy.perPiece[0].text === "Spark dress copy.", "copy: per-piece matched by id");
assert(modelCopy.perPiece[1].text.length > 10, "copy: missing piece falls back to bank text");
assert(modelCopy.wordCount <= 300, "copy: model copy held to 300-word budget", String(modelCopy.wordCount));
assert(MS.generateCopyFromModel(card, null) === null, "copy: null model result -> null");
assert(MS.generateCopy(card).placeholder === true, "copy: stub fallback stays placeholder true");
assert(typeof MS.buildPreviewPrompt === "function" && MS.buildPreviewPrompt(card, modelCopy).includes("No people"),
  "preview: prompt forbids worn try-on");

// --- Assembler fit rules (direct) ----------------------------------------------
function look(items) {
  return MS.assembleLook(items.map(([id, category]) => ({
    id, category, copy: { text: "copy for " + category, placeholder: true },
  })));
}
assert(look([["a", "dress"], ["b", "layer/cardigan"]]).valid === true, "assemble: dress+layer valid");
assert(look([["a", "base/top"], ["b", "scarf"], ["c", "bag"]]).valid === true, "assemble: base+scarf+bag valid");
assert(look([["a", "dress"], ["b", "layer/cardigan"], ["c", "layer/blazer"]]).valid === false,
  "assemble: two layers rejected");
assert(look([["a", "dress"], ["b", "shoes"]]).valid === false, "assemble: shoes rejected");
assert(look([["a", "dress"], ["b", "scarf"]]).valid === false, "assemble: lone scarf rejected");
assert(look([["a", "dress"]]).valid === false, "assemble: base only rejected");

// --- Proxy routes with fake upstream --------------------------------------------
function fakeUpstream(url, opts) {
  const body = JSON.parse(opts.body);
  let payload;
  if (url.endsWith("/responses") && body.model === "sam-3.1") {
    payload = { output: [{ content: [{ type: "output_text", text: samText }] }] };
  } else if (url.endsWith("/responses") && String(JSON.stringify(body.input)).includes("complete outfits")) {
    payload = { output: [{ content: [{ type: "output_text", text: '{"looks":[{"pieceIds":["a","b"],"rationale":"ok"}]}' }] }] };
  } else if (url.endsWith("/responses") && String(JSON.stringify(body.input)).includes("look-card copy")) {
    payload = { output: [{ content: [{ type: "output_text", text: '{"title":"T","perPiece":[{"id":"piece-1","text":"live"}],"lookStory":"S"}' }] }] };
  } else if (url.endsWith("/responses")) {
    payload = { output: [{ content: [{ type: "output_text", text: '{"category":"dress","confidence":0.9}' }] }] };
  } else if (url.endsWith("/images/generations") || url.endsWith("/images/edits")) {
    payload = { data: [{ b64_json: "QUJD" }], output_format: "webp" };
  } else {
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("{}") });
  }
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) });
}

async function main() {
  const { server } = await proxy.startServer({ port: 0, apiKey: "test-key", fetchImpl: fakeUpstream });
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (p, b) => fetch(base + p, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

  try {
    const health = await fetch(base + "/health").then((r) => r.json());
    assert(health.ok && health.keyPresent === true, "proxy: health reports key present");

    const seg = await post("/api/segment", { image: "data:image/jpeg;base64,QUJD", phrases: ["top"] });
    assert(seg.status === 200 && seg.json.polygons.length === 2 && seg.json.placeholder === false,
      "proxy: /api/segment returns SAM polygons");

    const segBad = await post("/api/segment", {});
    assert(segBad.status === 400, "proxy: /api/segment rejects missing image");

    const cls = await post("/api/classify", { image: "data:image/jpeg;base64,QUJD" });
    assert(cls.status === 200 && cls.json.category === "dress" && cls.json.placeholder === false,
      "proxy: /api/classify returns taxonomy category");

    const cp = await post("/api/copy", { pieces: [{ id: "piece-1", category: "dress" }], finish: "layer" });
    assert(cp.status === 200 && cp.json.perPiece[0].text === "live", "proxy: /api/copy returns Spark JSON");

    const asm = await post("/api/assemble", { pieces: [{ id: "a", category: "dress" }, { id: "b", category: "bag" }] });
    assert(asm.status === 200 && asm.json.looks.length === 1, "proxy: /api/assemble returns proposals");

    const prev = await post("/api/preview", { prompt: "flat lay" });
    assert(prev.status === 200 && prev.json.dataURL.startsWith("data:image/webp;base64,"),
      "proxy: /api/preview returns image data URL");

    const nf = await post("/api/nope", {});
    assert(nf.status === 404, "proxy: unknown route 404");
  } finally {
    server.close();
  }

  const { server: noKey } = await proxy.startServer({ port: 0, apiKey: "", fetchImpl: fakeUpstream });
  const base2 = "http://127.0.0.1:" + noKey.address().port;
  try {
    const r = await fetch(base2 + "/api/classify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: "data:image/jpeg;base64,QUJD" }),
    });
    assert(r.status === 503, "proxy: missing key -> 503, not a crash");
  } finally {
    noKey.close();
  }

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
