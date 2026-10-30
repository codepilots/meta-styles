"use strict";
// RETIRED by Milestone 20 (d4f8ba4): browser-side auto-reply.js was removed —
// wardrobe-service/server.js is now the sole writer/sender. This test
// covered the old browser wiring that caused the duplicate-send incident.
// Kept for history; skipped — not deleted — so git blame still shows it.
// New coverage: wardrobe-service handles the same behaviour server-side.
if (!require("fs").existsSync(require("path").join(__dirname, "..", "auto-reply.js"))) {
  console.log("SKIP: " + __filename.split("/").pop() + " — auto-reply.js retired by M20");
  process.exit(0);
}


/* meta-styles — turn-loop live-wiring tests (chat-first pivot follow-up).
 *
 * app/turn-loop.js was built and unit-tested in isolation
 * (app/test/milestone19d-turn-loop.test.js) but wired into NOTHING. This
 * file proves the actual page wiring — app/auto-reply.js, the single module
 * app/mock-dm.html's refreshThread() calls in BOTH mock and live mode:
 * photo/text shares in -> classify -> turn-loop -> compose -> POST /ig/send.
 *
 * Covers the wiring acceptance criteria:
 *   1. a photo injected via POST /mock/incoming-photo gets an automatic
 *      reply (visible in GET /mock/outbound);
 *   2. a text command ("no bag"-shaped revise, "fabric?"-shaped no-data)
 *      injected via POST /mock/incoming-text gets an automatic reply;
 *   3. a second poll tick over the SAME shares sends NOTHING new
 *      (at-most-once per share id);
 *   4. a FRESH wiring instance sharing the same persisted dedupe store
 *      (the page-reload simulation — same localStorage file underneath)
 *      also sends nothing new;
 *   5. the on-page log array carries a plain-language entry per action —
 *      no token, no share/message id, no API dump;
 *   6. the catalog reflects the turns (piece added, revise rejected,
 *      second photo's look cites BOTH source shares);
 *   7. a stale (30h) share hits the honest window-expired path — logged,
 *      never sent;
 *   8. the page itself carries the wiring: script tags, #autoLog panel,
 *      "auto-reply" banner text, one unconditional pipeline call site
 *      shared by both modes, and the manual Send-as-app flow untouched.
 *
 * In-process mock bot via startServer; all ids synthetic (SYNTH_ prefix,
 * example.invalid URLs) — never real Instagram data. No Meta proxy runs
 * here, so classify deterministically takes the labelled on-device
 * fallback (caption-hint -> category), which is exactly the path asserted.
 *
 * Run: node app/test/auto-reply-wiring.test.js
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

// Sandbox sets an HTTP proxy; the mock is local-only, so bypass it here.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

// Force the on-device classify fallback deterministically. meta-client.js
// reads globalThis.__IG_RUNTIME__.proxyBase ONCE at module load and caches
// it as PROXY_BASE for the module's lifetime, defaulting to the real
// 127.0.0.1:8905 meta-api-proxy address otherwise. If a real proxy happens
// to be running on this host (e.g. a live-mode session left one up), this
// test would silently call the REAL Meta API with a meaningless 1x1 test
// pixel instead of taking the labelled on-device fallback it documents —
// pointing at a guaranteed-unreachable port makes classify() reject no
// matter what else is running on the host, so the fallback path is
// actually exercised every time. Must be set before the first require of
// auto-reply.js / meta-client.js below (module-load-time capture).
globalThis.__IG_RUNTIME__ = { proxyBase: "http://127.0.0.1:1" };

const AutoReply = require("../auto-reply.js");
const { startServer } = require("../../mock-ig-bot/server.js");

const TOKEN = "SYNTH_mock_token";
const APP_DIR = path.resolve(__dirname, "..");
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

let server;
let store;
let base;
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

function authHeaders(extra) {
  return { Authorization: "Bearer " + TOKEN, ...(extra || {}) };
}

// localStorage-shape stub backed by one JSON file, shared across wiring
// instances — the page-reload simulation (same file under a fresh page).
function fileStorage(file) {
  return {
    getItem(k) {
      try {
        const all = JSON.parse(fs.readFileSync(file, "utf8"));
        return typeof all[k] === "string" ? all[k] : null;
      } catch (err) {
        return null;
      }
    },
    setItem(k, v) {
      let all = {};
      try {
        all = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (err) {
        // Start fresh.
      }
      all[k] = String(v);
      fs.writeFileSync(file, JSON.stringify(all));
    },
  };
}

async function postPhoto(caption) {
  const res = await fetch(
    `${base}/mock/incoming-photo?kind=post&caption=${encodeURIComponent(caption)}`,
    {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "image/png" },
      body: PNG_1PX,
    }
  );
  return { status: res.status, body: await res.json() };
}

async function postText(text, query) {
  const res = await fetch(`${base}/mock/incoming-text${query || ""}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return { status: res.status, body: await res.json() };
}

async function getShares() {
  const res = await fetch(`${base}/ig/shares?limit=50`, { headers: authHeaders() });
  return (await res.json()).items;
}

async function getOutbound() {
  const res = await fetch(`${base}/mock/outbound`, { headers: authHeaders() });
  return (await res.json()).outbound;
}

async function main() {
  // --- A. The page carries the wiring -----------------------------------
  const page = fs.readFileSync(path.join(APP_DIR, "mock-dm.html"), "utf8");

  for (const mod of [
    "inbox-bridge.js", "wardrobe-catalog.js", "classifier.js", "assembler.js",
    "spark.js", "send-client.js", "meta-client.js", "turn-loop.js", "auto-reply.js",
  ]) {
    check(`wiring: page loads ${mod}`,
      new RegExp(`<script src="${mod.replace(".", "\\.")}"></script>`).test(page));
  }
  check("wiring: page has the assistant-activity log panel",
    /id="autoLog"/.test(page) && /Assistant activity/.test(page));
  check("wiring: log panel promises plain language, newest at bottom",
    /plain language, newest at the bottom/.test(page));
  check("wiring: banner says automatic replies are active",
    /Auto-reply is on/.test(page) && /Auto-replying to new messages/.test(page));
  check("wiring: refreshThread offers new arrivals to the pipeline",
    page.includes("runAutoReply(freshItems)"));
  check("wiring: exactly one pipeline call site (no mock/live fork)",
    (page.match(/runAutoReply\(freshItems\)/g) || []).length === 1);
  check("wiring: pipeline call site is not mode-guarded",
    !/IS_LIVE/.test(page.slice(Math.max(0, page.indexOf("runAutoReply(freshItems)") - 300),
      page.indexOf("runAutoReply(freshItems)"))));
  check("wiring: manual Send-as-app flow untouched (doSend /ig/send confirm:true)",
    /function sendAsApp\(\)/.test(page) && /"confirm": true/.test(page) &&
    /id="sendBtn"/.test(page) && /addEventListener\("click", sendAsApp\)/.test(page));
  check("wiring: manual Propose-look flow untouched",
    /function proposeLook\(\)/.test(page) && /id="lookBtn"/.test(page));
  check("wiring: auto-reply module entry exists",
    page.includes("createAutoReplyClient") && page.includes("autoReply.init()"));

  // Same technique as milestone13-mock-dm-page.test.js: parse every inline
  // script (proves the edited page is still syntax-valid JS).
  const scriptBodies = [...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1]);
  let syntaxOk = false;
  try {
    for (const body of scriptBodies) new vm.Script(body);
    syntaxOk = true;
  } catch (err) {
    console.log("  script syntax error: " + err.message);
  }
  check("wiring: edited page inline scripts are syntax-valid JS", syntaxOk);

  // --- B. Live wiring through the page's pipeline module ----------------
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "auto-reply-"));
  const catalogDir = path.join(scratch, "catalog");
  ({ server, store } = await startServer({
    port: 0,
    token: TOKEN,
    catalogDir,
    catalogSecret: "SYNTH_test_catalog_secret (non-secret, never real data)",
  }));
  base = `http://127.0.0.1:${server.address().port}`;

  const lines = [];
  const storageFile = path.join(scratch, "localStorage.json");
  function freshHarness(collect) {
    return AutoReply.createAutoReply({
      base,
      token: TOKEN,
      userKey: "SYNTH_user_019x",
      userRef: "u_deadbeefdeadbeefdeadbeefdeadbeef",
      storage: fileStorage(storageFile),
      log: (line) => collect.push(line),
    });
  }

  const log1 = [];
  const h1 = freshHarness(log1);
  await h1.init();

  // B1: photo 1 -> automatic reply (criterion 1).
  const p1 = await postPhoto("dress");
  check("wiring: photo injects as an ig_post share",
    p1.status === 200 && typeof p1.body.share.id === "string", `got ${p1.status}`);
  const share1 = p1.body.share.id;

  const p2 = await postPhoto("blazer");
  const share2 = p2.body.share.id;
  const t1 = await postText("SYNTH no blazer");
  const t2 = await postText("SYNTH show fabric");
  check("wiring: text turns inject as text shares",
    t1.status === 200 && t2.status === 200);

  const items = await getShares();
  check("wiring: all four shares visible via GET /ig/shares",
    items.length === 4, `got ${items.length}`);

  const r1 = await h1.processShares(items);
  check("wiring: one tick processes all four shares",
    r1.processed === 4 && r1.sent === 4,
    JSON.stringify({ processed: r1.processed, sent: r1.sent }));

  let outbound = await getOutbound();
  check("wiring: four automatic replies actually sent (outbound log)",
    outbound.length === 4, `got ${outbound.length}`);

  // Photo 2's look mixes the catalogued pool: cites BOTH source shares.
  const turn2 = outbound.find((e) => e.share_id === share2);
  check("wiring: second photo turn cites both shares (cross-share mix-match)",
    !!turn2 && turn2.text.includes(share1) && turn2.text.includes(share2),
    turn2 ? turn2.text.slice(0, 160) : "missing turn 2");
  check("wiring: second photo turn validates a full look (dress + blazer layer)",
    !!turn2 && /valid full look/.test(turn2.text), turn2 ? turn2.text.slice(0, 160) : "missing");

  // Photo 1's lone dress cannot be a full look — the reasons surface.
  const turn1 = outbound.find((e) => e.share_id === share1);
  check("wiring: lone-dress turn says why it is not a full look yet",
    !!turn1 && /not a full look yet/.test(turn1.text),
    turn1 ? turn1.text.slice(0, 160) : "missing turn 1");

  // B2: catalog reflects the turns (criterion 6).
  const active = h1.catalog.getActivePieces();
  check("wiring: catalog holds the dress, blazer rejected after 'no blazer'",
    active.length === 1 && active[0].category === "dress" &&
    active[0].source_share_id === share1,
    JSON.stringify(active.map((p) => p.category + "/" + p.status)));
  const rejected = h1.catalog.getPieces({ status: "rejected" });
  check("wiring: revise rejected (not deleted) the blazer piece",
    rejected.length === 1 && rejected[0].category === "layer/blazer");
  check("wiring: four turns recorded (photo, photo, revise, no-data)",
    h1.catalog.getTurns().length === 4,
    `got ${h1.catalog.getTurns().length}`);

  // B3: no-data answer is honest (criterion 2, fabric half).
  const turn4 = outbound.find((e) => e.text.includes("don't have that data"));
  check("wiring: 'show fabric' answered with honest no-data, actually sent",
    !!turn4, outbound.map((e) => e.text.slice(0, 60)).join(" | ").slice(0, 200));

  // B4: log lines are plain language (criterion 5).
  const joined = log1.join("\n");
  check("wiring: log narrates cataloguing in plain language",
    /Catalogued a dress from your photo/.test(joined) &&
    /Catalogued a blazer layer from your photo/.test(joined));
  check("wiring: log notes the on-device fallback (no proxy running here)",
    /used the on-device fallback/.test(joined));
  check("wiring: log notes the revise + the no-data answer",
    /updated your wardrobe and re-checked the fit/.test(joined) &&
    /no fabric or price data available/.test(joined));
  check("wiring: log confirms sends",
    (joined.match(/Sent a reply\./g) || []).length === 4);
  check("wiring: every log line is timestamped",
    log1.length > 0 && log1.every((l) => /^\[.+\] /.test(l)));
  const BANNED = /SYNTH_mid|SYNTH_msg|SYNTH_mock_token|Bearer |igsid|mid\/|graph_api/i;
  check("wiring: log carries no token, no share/message id, no API dump",
    log1.every((l) => !BANNED.test(l)),
    log1.find((l) => BANNED.test(l)) || "");

  // B5: second tick sends nothing new (criterion 3).
  const r2 = await h1.processShares(await getShares());
  check("wiring: second tick over the same shares sends nothing",
    r2.sent === 0 && r2.processed === 0,
    JSON.stringify({ processed: r2.processed, sent: r2.sent }));
  outbound = await getOutbound();
  check("wiring: outbound still exactly four after the re-tick",
    outbound.length === 4, `got ${outbound.length}`);

  // B6: fresh instance + same persisted store sends nothing (criterion 4 —
  // the page-reload simulation).
  const log2 = [];
  const h2 = freshHarness(log2);
  await h2.init();
  const r3 = await h2.processShares(await getShares());
  check("wiring: reloaded instance (same storage) sends nothing new",
    r3.sent === 0, JSON.stringify({ sent: r3.sent }));
  outbound = await getOutbound();
  check("wiring: outbound still exactly four after the reload tick",
    outbound.length === 4, `got ${outbound.length}`);
  check("wiring: reloaded instance relearns the same persisted ids",
    h2.getRepliedIds().length === 4, `got ${h2.getRepliedIds().length}`);

  // B7: stale share hits the honest window-expired path (criterion 7).
  const stale = await postText("SYNTH stale ping", "?age_hours=30");
  check("wiring: stale share injected (30h old)", stale.status === 200);
  const r4 = await h2.processShares(await getShares());
  const staleRes = r4.results.find((r) => r.id === stale.body.share.id);
  check("wiring: stale share takes the window-closed path, not a send",
    !!staleRes && staleRes.action === "window_closed" && staleRes.sent === false,
    JSON.stringify(staleRes));
  outbound = await getOutbound();
  check("wiring: stale share sent nothing (outbound still four)",
    outbound.length === 4, `got ${outbound.length}`);
  check("wiring: window expiry logged in plain language",
    log2.some((l) => /Reply window expired, didn't send a reply/.test(l)));

  console.log(`\n${passes} passed, ${failures} failed.`);
  server.close();
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  if (server) server.close();
  process.exit(1);
});
