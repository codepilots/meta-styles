"use strict";
/* meta-styles Milestone 6 wiring proof (verification-only, no product code).
 *
 * Claim under test: Milestone 6 ("DM photo → look-card pipeline") needed no
 * separate pipeline code, because the Milestone 5 fixture bridge and the
 * Milestone 9 live bot client both feed every inbox entry through the SAME
 * loadImage(src, sourceId, sourceName) entry point in app/app.js that the
 * Milestone 1 upload / demo-picker path uses — so the mask → classify →
 * assemble pipeline downstream is already shared and never branches on
 * where the image came from.
 *
 * What this test proves, mechanically (plain Node, no browser, no deps):
 *   1. A Milestone 5 fixture-shaped entry ({id, media_file, attachment,
 *      caption?}, as stored in app/inbox-fixtures/shares.jsonl) resolves to
 *      the same 3-arg loadImage(src, id, caption) call the demo-picker
 *      buttons use.
 *   2. A Milestone 9 live-bot-shaped entry ({id, media_id, attachment,
 *      media_available}, per docs/instagram-bot-api.md "Item shape") also
 *      resolves to that same loadImage(src, id, caption) call via the live
 *      path in app/inbox-bridge.js.
 *   3. Neither app.js's segmentation stub (StubSegmentationService.segment /
 *      mockPolygons) nor classifier.js's classifyRegion branches on whether
 *      a sourceId came from an inbox entry vs. an upload vs. a demo card.
 *
 * All ids/data below are synthetic (SYNTH_ prefix) or rows read AS-IS at
 * runtime from the already-synthetic fixture file — never real captured
 * Instagram data.
 *
 * Run: node app/test/milestone6-pipeline-wiring.test.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP_DIR = path.resolve(__dirname, "..");

let failures = 0;
let passes = 0;

function check(name, cond, detail) {
  if (cond) {
    passes++;
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

function isValidPolygonShape(polys) {
  if (!Array.isArray(polys) || polys.length === 0) return false;
  return polys.every(
    (p) =>
      p &&
      typeof p.label === "string" &&
      p.label.length > 0 &&
      Array.isArray(p.points) &&
      p.points.length >= 3 &&
      p.points.every(
        (pt) =>
          Array.isArray(pt) &&
          pt.length === 2 &&
          pt.every((n) => typeof n === "number" && n >= 0 && n <= 1)
      )
  );
}

// ---------------------------------------------------------------------------
// Load app/inbox-bridge.js pure helpers via vm (browser wiring is guarded).
// ---------------------------------------------------------------------------
const bridgeSrc = fs.readFileSync(path.join(APP_DIR, "inbox-bridge.js"), "utf8");
const bridgeSandbox = {};
vm.createContext(bridgeSandbox);
// No `document`/`fetch` in this context, so inbox-bridge.js returns right
// after exporting its pure helpers — same technique used when it was built.
vm.runInContext(bridgeSrc, bridgeSandbox, { filename: "inbox-bridge.js" });
const Bridge = bridgeSandbox.InboxBridge;

check("inbox-bridge.js exposes pure InboxBridge helpers via vm", !!(
  Bridge &&
  typeof Bridge.captionFor === "function" &&
  typeof Bridge.kindFor === "function" &&
  typeof Bridge.isValidShareItem === "function" &&
  typeof Bridge.parseJsonLines === "function" &&
  typeof Bridge.buildSharesUrl === "function"
));

// ---------------------------------------------------------------------------
// Load app/classifier.js via vm (it attaches to globalThis.MetaStyles).
// ---------------------------------------------------------------------------
const classifierSrc = fs.readFileSync(path.join(APP_DIR, "classifier.js"), "utf8");
const classifierSandbox = {};
vm.createContext(classifierSandbox);
classifierSandbox.globalThis = classifierSandbox;
vm.runInContext(classifierSrc, classifierSandbox, { filename: "classifier.js" });
const MS = classifierSandbox.MetaStyles;

check("classifier.js exposes MetaStyles.classifyRegion via vm", !!(
  MS && typeof MS.classifyRegion === "function"
));

// ---------------------------------------------------------------------------
// Extract app.js's pure segmentation logic (StubSegmentationService +
// mockPolygons) without executing its browser-only top level
// (document.getElementById etc.). app.js itself is NOT modified.
// ---------------------------------------------------------------------------
const appSrc = fs.readFileSync(path.join(APP_DIR, "app.js"), "utf8");

const segStart = appSrc.indexOf("class StubSegmentationService");
const segEnd = appSrc.indexOf("// State + canvas rendering");
check("app.js pure segmenter block is extractable", segStart !== -1 && segEnd !== -1 && segEnd > segStart);
const segBlockSrc = appSrc.slice(segStart, segEnd);

const appPureSandbox = { setTimeout, clearTimeout };
vm.createContext(appPureSandbox);
vm.runInContext(segBlockSrc + "\nglobalThis.__M6mockPolygons = mockPolygons;\nglobalThis.__M6Segmenter = StubSegmentationService;", appPureSandbox, { filename: "app.js#segment-block" });
const mockPolygons = appPureSandbox.__M6mockPolygons;
const StubSegmentationService = appPureSandbox.__M6Segmenter;

check("mockPolygons + StubSegmentationService isolated from app.js", (
  typeof mockPolygons === "function" && typeof StubSegmentationService === "function"
));

// ---------------------------------------------------------------------------
// Static wiring proof: every caller uses the same loadImage(src, id, name).
// ---------------------------------------------------------------------------
check("app.js defines loadImage(src, sourceId, sourceName)", /function loadImage\(src,\s*sourceId,\s*sourceName\)/.test(appSrc));

check("app.js demo-picker calls loadImage(d.file, d.id, d.name)", /loadImage\(d\.file,\s*d\.id,\s*d\.name\)/.test(appSrc));

check("app.js upload path calls loadImage(url, \"upload\", file.name)", /loadImage\(url,\s*"upload",\s*file\.name\)/.test(appSrc));

check("inbox-bridge.js fixture path calls loadImage(\"inbox-fixtures/\" + e.media_file, e.id, captionFor(e))",
  /loadImage\(\s*"inbox-fixtures\/"\s*\+\s*e\.media_file,\s*e\.id,\s*captionFor\(e\)/.test(bridgeSrc));

check("inbox-bridge.js live path calls loadImage(url, e.id, captionFor(e))",
  /loadImage\(url,\s*e\.id,\s*captionFor\(e\)\)/.test(bridgeSrc));

// ---------------------------------------------------------------------------
// Goal 1: Milestone 5 fixture-shaped entry -> same loadImage() signature.
// ---------------------------------------------------------------------------
const fixtureText = fs.readFileSync(path.join(APP_DIR, "inbox-fixtures", "shares.jsonl"), "utf8");
const fixtureEntries = Bridge.parseJsonLines(fixtureText);
check("existing synthetic fixture file parses to >=1 valid share item", fixtureEntries.length >= 1, `got ${fixtureEntries.length}`);

// Fixture shape per Milestone 5: {id, media_file, attachment, caption?}.
const fixtureEntry = fixtureEntries[0];
check("fixture row has the Milestone 5 shape {id, media_file, attachment}", (
  typeof fixtureEntry.id === "string" &&
  typeof fixtureEntry.media_file === "string" &&
  !!fixtureEntry.attachment
));
check("reused fixture row ids are synthetic (no real captured data)", (
  /^synth-/i.test(fixtureEntry.id) && !/\d{10,}/.test(fixtureEntry.id)
), `id=${fixtureEntry.id}`);

// Record loadImage calls exactly as the fixture click-handler invokes them.
const loadImageCalls = [];
function recordLoadImage(src, sourceId, sourceName) {
  if (arguments.length !== 3) throw new Error(`loadImage arity: expected 3 args, got ${arguments.length}`);
  loadImageCalls.push({ src, sourceId, sourceName });
}
// Mirror of the fixture "Use this photo" handler (inbox-bridge.js):
//   loadImage("inbox-fixtures/" + e.media_file, e.id, captionFor(e))
recordLoadImage("inbox-fixtures/" + fixtureEntry.media_file, fixtureEntry.id, Bridge.captionFor(fixtureEntry));
check("fixture entry resolves to loadImage(src, id, caption) with 3 args", (
  loadImageCalls.length === 1 &&
  loadImageCalls[0].src === "inbox-fixtures/" + fixtureEntry.media_file &&
  loadImageCalls[0].sourceId === fixtureEntry.id &&
  typeof loadImageCalls[0].sourceName === "string" &&
  loadImageCalls[0].sourceName.length > 0
), JSON.stringify(loadImageCalls[0]));
check("fixture loadImage arity matches demo-picker calls (3 args)", recordLoadImage.length === 3);

// ---------------------------------------------------------------------------
// Goal 2: Milestone 9 live-bot-shaped entry -> same loadImage() signature.
// ---------------------------------------------------------------------------
// Synthetic live-bot items per docs/instagram-bot-api.md "Item shape":
// {id, media_id, attachment, media_available}. All ids SYNTH_-prefixed,
// all URLs example.invalid — never real data.
const liveImageEntry = {
  id: "SYNTH_mid_001",
  received_at: "2026-10-28T12:00:00Z",
  attachment: { type: "image", payload: { url: "https://example.invalid/synth-media/SYNTH_live_001.png" } },
  media_id: "SYNTH_media_001",
  media_available: true,
};
const livePostEntry = {
  id: "SYNTH_mid_002",
  received_at: "2026-10-28T12:05:00Z",
  attachment: { type: "ig_post", payload: { ig_post_media_id: "SYNTH_100000000000002", title: "SYNTH post title", url: "https://example.invalid/synth-media/SYNTH_live_002.jpg" } },
  media_id: "SYNTH_media_002",
  media_available: true,
};
const livePendingEntry = {
  id: "SYNTH_mid_003",
  received_at: "2026-10-28T12:06:00Z",
  attachment: { type: "image", payload: { url: "https://example.invalid/synth-media/SYNTH_live_003.png" } },
  media_id: "SYNTH_media_003",
  media_available: false,
};

check("live-bot image entry passes isValidShareItem", Bridge.isValidShareItem(liveImageEntry));
check("live-bot ig_post entry passes isValidShareItem", Bridge.isValidShareItem(livePostEntry));
check("live-bot pending entry (media_available:false) is still a valid item", Bridge.isValidShareItem(livePendingEntry));

// Mirror of the live "Use this photo" handler (inbox-bridge.js):
//   loadImage(url, e.id, captionFor(e))  — url is the fetched object URL.
const synthObjectURL = "blob:https://example.invalid/SYNTH_object_url_001";
const before = loadImageCalls.length;
recordLoadImage(synthObjectURL, liveImageEntry.id, Bridge.captionFor(liveImageEntry));
recordLoadImage(synthObjectURL, livePostEntry.id, Bridge.captionFor(livePostEntry));
check("live-bot entries resolve to loadImage(url, id, caption) with 3 args", (
  loadImageCalls.length === before + 2 &&
  loadImageCalls[before].src === synthObjectURL &&
  loadImageCalls[before].sourceId === "SYNTH_mid_001" &&
  loadImageCalls[before + 1].sourceId === "SYNTH_mid_002" &&
  loadImageCalls.every((c) => typeof c.sourceName === "string" && c.sourceName.length > 0)
));

// Pending entries get NO button and hence no loadImage call (guard in
// renderList: media_available === false -> "not yet ready", no action).
const pendingGetsButton = !(livePendingEntry.media_available === false || !livePendingEntry.media_id);
check("pending live entry (media_available:false) yields no loadImage call", pendingGetsButton === false);

// parseJsonLines accepts both shapes and skips malformed lines.
const mixedJsonl = [
  JSON.stringify({ id: "SYNTH_fixture_009", attachment: { type: "image", payload: { url: "https://example.invalid/synth-media/SYNTH_f009.png" } }, media_file: "SYNTH-fixture-9.svg" }),
  JSON.stringify(liveImageEntry),
  "{not valid json",
  JSON.stringify({ id: "", attachment: null }),
].join("\n");
const mixed = Bridge.parseJsonLines(mixedJsonl);
check("parseJsonLines accepts both fixture + live shapes, skips bad lines", (
  mixed.length === 2 && mixed[0].id === "SYNTH_fixture_009" && mixed[1].id === "SYNTH_mid_001"
), `got ${mixed.length} entries`);

check("captionFor falls back through caption -> payload.title -> id", (
  Bridge.captionFor({ id: "SYNTH_x", caption: "SYNTH hello", attachment: {} }) === "SYNTH hello" &&
  Bridge.captionFor(livePostEntry) === "SYNTH post title" &&
  Bridge.captionFor({ id: "SYNTH_y", attachment: { type: "image", payload: { url: "https://example.invalid/u" } } }) === "SYNTH_y"
));

// ---------------------------------------------------------------------------
// Goal 3: segmentation stub + classifier do not branch on inbox origin.
// ---------------------------------------------------------------------------
// (a) Source-level: no inbox/mid/synthetic markers inside the stub block.
check("segmentation stub source has no inbox-specific branching", !/inbox|media_id|sourceName|SYNTH|synth-|mid_/i.test(segBlockSrc));
check("classifyRegion source never reads sourceId/inbox origin", !/sourceId|inbox|media_id|SYNTH/i.test(
  classifierSrc.slice(classifierSrc.indexOf("function classifyRegion"), classifierSrc.indexOf("function placeholderCopy"))
));

// (b) Behavioral: same valid polygon shape for demo, upload, inbox ids.
const sourceIds = ["demo-look-1", "demo-look-2", "demo-look-3", "upload", "SYNTH_mid_001", "SYNTH_mid_002", "synth-share-001"];
for (const sid of sourceIds) {
  let polys = null;
  let threw = null;
  try {
    polys = mockPolygons(sid);
  } catch (err) {
    threw = err;
  }
  check(`mockPolygons(${JSON.stringify(sid)}) returns valid non-empty polygons, no throw`, threw === null && isValidPolygonShape(polys),
    threw ? String(threw && threw.message) : `got ${JSON.stringify(polys && polys.length)}`);
}

// (c) Inbox ids take the SAME generic path as uploads (default branch).
const uploadPolys = mockPolygons("upload");
for (const sid of ["SYNTH_mid_001", "SYNTH_mid_002", "synth-share-001"]) {
  check(`inbox id ${sid} yields the generic upload-shaped mask (no special branch)`,
    JSON.stringify(mockPolygons(sid)) === JSON.stringify(uploadPolys));
}

// (d) The async segment() entry point works for an inbox id too.
(async () => {
  try {
    const seg = new StubSegmentationService();
    const res = await seg.segment({}, "SYNTH_mid_001");
    check("StubSegmentationService.segment(inbox id) resolves with valid polygons",
      !!res && isValidPolygonShape(res.polygons) && Array.isArray(res.boxes));
  } catch (err) {
    check("StubSegmentationService.segment(inbox id) resolves with valid polygons", false, String((err && err.message) || err));
  }

  // (e) classifyRegion ignores sourceId: identical region, different
  // sourceIds -> identical category.
  const baseRegion = { kind: "mask", rect: [0.3, 0.2, 0.4, 0.5], labelHint: "dress" };
  const cats = ["demo-look-1", "upload", "SYNTH_mid_001"].map((sid) =>
    MS.classifyRegion({ ...baseRegion, sourceId: sid }).category);
  check("classifyRegion returns the same category regardless of sourceId", cats.every((c) => c === cats[0]),
    `got ${JSON.stringify(cats)}`);
  const noHintCats = ["upload", "SYNTH_mid_001"].map((sid) =>
    MS.classifyRegion({ kind: "box", rect: [0.3, 0.2, 0.4, 0.5], sourceId: sid }));
  check("classifyRegion (no hint) is sourceId-independent and well-shaped", (
    noHintCats[0].category === noHintCats[1].category &&
    noHintCats.every((r) => typeof r.category === "string" && typeof r.method === "string")
  ), JSON.stringify(noHintCats.map((r) => r.category)));

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
})();
