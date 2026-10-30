"use strict";
/* meta-styles — pre-existing-backlog regression test (chat-first follow-up).
 *
 * The live incident (Oct 30, 2026): the page loaded onto a bot that already
 * held historical shares. The first poll tick marked every pre-existing
 * share "seen" as a side effect of FETCHING them, then handed them to
 * runAutoReply exactly once. Any first-attempt failure outside the two
 * explicit retry paths (busy, result flagged retry:true) — a null pipeline,
 * a rejected pipeline promise, a synchronous throw — stranded those ids
 * forever: marked seen, zero outcome recorded, never re-offered, while the
 * banner's "last checked" kept advancing and the activity log stayed empty.
 *
 * The existing auto-reply-wiring.test.js always creates the harness FIRST
 * and injects shares AFTER, so it never exercises this ordering.
 *
 * This file pins the fix at both layers:
 *   1. pipeline layer (real AutoReply + real mock bot): shares injected
 *      BEFORE the harness exists are sent on the harness's first-ever pass;
 *   2. page layer (the REAL runAutoReply extracted from app/mock-dm.html
 *      and run in a vm sandbox): no failure mode strands an id — terminal
 *      outcomes get marked seen, everything else stays eligible, and the
 *      page no longer marks the whole fetch seen up front.
 *
 * All ids synthetic (SYNTH_ prefix, example.invalid URLs) — never real data.
 * Run: node app/test/auto-reply-backlog.test.js
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

// Same deterministic offline-classify setup as auto-reply-wiring.test.js.
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

// --- Page-layer harness: run the REAL runAutoReply from mock-dm.html. ---
function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error("fn not found in page: " + name);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced braces for " + name);
}

// Simulates one refreshThread tick's share-offer half against a stub or real
// pipeline, replicating the page's OWN order as written in its source:
// compute fresh from seenShareIds, apply whatever mark step refreshThread
// currently performs on the raw fetch, then run and settle. Returns what a
// NEXT tick would be offered. Pre-fix the page marks the whole fetch seen
// up front (the bug); post-fix only runAutoReply's settle path marks.
function makePageTick(pipeline) {
  const page = fs.readFileSync(path.join(APP_DIR, "mock-dm.html"), "utf8");
  const runSrc = extractFn(page, "runAutoReply");
  // Helpers runAutoReply delegates to (same script scope on the page).
  const helperSrc = ["unmarkShares", "markSettledShares"]
    .map((n) => {
      try {
        return extractFn(page, n);
      } catch (err) {
        return "";
      }
    })
    .filter(Boolean)
    .join("\n");
  const eagerMarkPresent = /\(parts\[0\]\.items \|\| \[\]\)\.forEach\(function \(item\) \{\s*if \(item && item\.id\) seenShareIds\[item\.id\] = true;\s*\}\);/.test(page);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    "var autoReply = null; var autoReplyBusy = false; var seenShareIds = {};\n" +
    "var __logged = [];\n" +
    "function appendAutoLog(l) { __logged.push(l); }\n" +
    helperSrc + "\n" +
    runSrc + "\n" +
    "function __fresh(all) {\n" +
    "  return all.filter(function (item) { return item && item.id && !seenShareIds[item.id]; });\n" +
    "}\n" +
    "function __markAll(all) {\n" +
    "  all.forEach(function (item) { if (item && item.id) seenShareIds[item.id] = true; });\n" +
    "}\n" +
    "this.__api = { run: runAutoReply, fresh: __fresh, markAll: __markAll };",
    sandbox
  );
  sandbox.autoReply = pipeline;
  const api = {
    page,
    eagerMarkPresent,
    logged: sandbox.__logged,
    run: (items) => vm.runInContext("__api.run(__items)", Object.assign(sandbox, { __items: items })),
    fresh: (items) => vm.runInContext("__api.fresh(__items)", Object.assign(sandbox, { __items: items })),
    busy: () => vm.runInContext("autoReplyBusy", sandbox),
    // Second-tick wiring: point the page at a (newly ready) pipeline.
    setPipeline: (p) => { sandbox.autoReply = p; },
  };
  // One faithful page tick over the full fetched list.
  api.tick = async (all) => {
    const freshNow = api.fresh(all);
    if (api.eagerMarkPresent) {
      vm.runInContext("__api.markAll(__all)", Object.assign(sandbox, { __all: all }));
    }
    const res = await api.run(freshNow);
    return { res, freshAfter: api.fresh(all) };
  };
  return api;
}

async function postPhoto(caption) {
  const res = await fetch(
    `${base}/mock/incoming-photo?kind=post&caption=${encodeURIComponent(caption)}`,
    { method: "POST", headers: { ...authHeaders(), "Content-Type": "image/png" }, body: PNG_1PX }
  );
  return res.json();
}

async function postText(text) {
  const res = await fetch(`${base}/mock/incoming-text`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return res.json();
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
  // --- A. The page no longer marks the whole fetch seen up front ---------
  const raw = fs.readFileSync(path.join(APP_DIR, "mock-dm.html"), "utf8");
  const eagerMark = /\(parts\[0\]\.items \|\| \[\]\)\.forEach\(function \(item\) \{\s*if \(item && item\.id\) seenShareIds\[item\.id\] = true;\s*\}\);/.test(raw);
  check("backlog: refreshThread does not mark shares seen merely by fetching them", !eagerMark);
  check("backlog: runAutoReply still the single pipeline call site",
    (raw.match(/runAutoReply\(freshItems\)/g) || []).length === 1);

  // --- B. Pipeline layer: backlog injected BEFORE the harness exists -----
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "auto-reply-backlog-"));
  ({ server } = await startServer({
    port: 0,
    token: TOKEN,
    catalogDir: path.join(scratch, "catalog"),
    catalogSecret: "SYNTH_test_catalog_secret (non-secret, never real data)",
  }));
  base = `http://127.0.0.1:${server.address().port}`;

  const p1 = await postPhoto("dress");
  const p2 = await postPhoto("blazer");
  const t1 = await postText("SYNTH backlog hello");
  const backlogIds = [p1.share.id, p2.share.id, t1.share.id];
  check("backlog: three shares pre-exist before any harness",
    backlogIds.every((id) => typeof id === "string"));

  const lines = [];
  const h = AutoReply.createAutoReply({
    base,
    token: TOKEN,
    userKey: "SYNTH_backlog_user",
    userRef: "u_deadbeefdeadbeefdeadbeefdeadbeef",
    storage: fileStorage(path.join(scratch, "localStorage.json")),
    log: (l) => lines.push(l),
  });
  // Mirror the page: the first poll fires WITHOUT awaiting init().
  const firstTick = h.processShares(await getShares());
  const r1 = await firstTick;
  await h.init();
  check("backlog: harness first-ever pass sends every pre-existing share",
    r1.processed === 3 && r1.sent === 3,
    JSON.stringify({ processed: r1.processed, sent: r1.sent }));
  check("backlog: no pre-existing share lost with zero record",
    r1.results.length === 3 && r1.results.every((r) => backlogIds.includes(r.id)));
  let outbound = await getOutbound();
  check("backlog: three automatic replies actually sent",
    outbound.length === 3, `got ${outbound.length}`);
  check("backlog: first pass logged real outcomes (not silence)",
    lines.length > 0 && lines.some((l) => /Sent a reply/.test(l)));

  // --- C. Page layer, stub pipelines: failure never strands an id -------
  // Each tick below replays refreshThread's exact order (fresh -> the page's
  // own mark step -> run -> settle), so a first-tick failure that strands
  // ids fails here exactly as it did live.
  const items = [{ id: "SYNTH_page_a" }, { id: "SYNTH_page_b" }];

  // C1: null pipeline (unavailable on first tick) — ids stay eligible.
  const nullTick = makePageTick(null);
  const tNull = await nullTick.tick(items);
  check("backlog: null pipeline resolves without crashing",
    tNull.res && tNull.res.sent === 0);
  check("backlog: null pipeline strands nothing (both still fresh)",
    tNull.freshAfter.length === 2,
    `freshAfter=${tNull.freshAfter.length}`);
  check("backlog: null pipeline logs nothing misleading",
    nullTick.logged.length === 0);

  // C2: rejecting pipeline — ids stay eligible AND the retry promise is real.
  const rejectTick = makePageTick({ processShares: () => Promise.reject(new Error("SYNTH boom")) });
  const tRej = await rejectTick.tick(items);
  check("backlog: rejected pipeline leaves every id eligible for retry",
    tRej.freshAfter.length === 2,
    `freshAfter=${tRej.freshAfter.length}`);
  check("backlog: rejected pipeline still logs the snag honestly",
    rejectTick.logged.some((l) => /try again on the next check/.test(l)));

  // C3: synchronously-throwing pipeline — busy resets, ids stay eligible.
  const throwTick = makePageTick({ processShares: () => { throw new Error("SYNTH sync"); } });
  let threw = false;
  let tThrow = null;
  try {
    tThrow = await throwTick.tick(items);
  } catch (err) {
    threw = true;
  }
  check("backlog: throwing pipeline does not escape runAutoReply", !threw);
  check("backlog: throwing pipeline resets the busy flag",
    (await throwTick.busy()) === false);
  check("backlog: throwing pipeline leaves every id eligible for retry",
    threw ? throwTick.fresh(items).length === 2 : tThrow.freshAfter.length === 2);

  // C4: mixed results — terminal ids marked, retry ids (and ids with NO
  // result entry at all) stay eligible.
  const mixedTick = makePageTick({
    processShares: (list) => Promise.resolve({
      processed: 2, sent: 1, skipped: 0,
      results: [
        { id: list[0].id, action: "sent", sent: true, retry: false },
        { id: list[1].id, action: "error", sent: false, retry: true },
      ],
    }),
  });
  const trio = [{ id: "SYNTH_m_sent" }, { id: "SYNTH_m_retry" }, { id: "SYNTH_m_missing" }];
  const tMix = await mixedTick.tick(trio);
  const stillFresh = tMix.freshAfter.map((it) => it.id).sort();
  check("backlog: sent id marked seen, retry + result-less ids stay eligible",
    JSON.stringify(stillFresh) === JSON.stringify(["SYNTH_m_missing", "SYNTH_m_retry"]),
    JSON.stringify(stillFresh));

  // --- D. End-to-end page order with the REAL pipeline --------------------
  // First tick: pipeline unavailable (the live failure shape) — nothing
  // may be recorded as seen. Second tick: pipeline ready — all backlog
  // shares are still offered and get sent exactly once.
  const scratch2 = fs.mkdtempSync(path.join(os.tmpdir(), "auto-reply-backlog2-"));
  const q1 = await postPhoto("scarf");
  const q2 = await postText("SYNTH backlog wave");
  const liveBacklog = [q1.share.id, q2.share.id];
  const lines2 = [];
  const realHarness = AutoReply.createAutoReply({
    base,
    token: TOKEN,
    userKey: "SYNTH_backlog_user2",
    userRef: "u_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    storage: fileStorage(path.join(scratch2, "localStorage.json")),
    log: (l) => lines2.push(l),
  });
  await realHarness.init();

  const pageTick = makePageTick(null); // first tick: no pipeline yet
  const allNow = await getShares();
  const mine = allNow.filter((it) => liveBacklog.includes(it.id));
  check("backlog: live backlog shares visible to the page", mine.length === 2);
  const tFirst = await pageTick.tick(mine); // pipeline missing
  check("backlog: first tick offers both pre-existing shares",
    tFirst.res && tFirst.res.sent === 0);
  check("backlog: failed first tick strands nothing (both still fresh)",
    tFirst.freshAfter.length === 2,
    `freshAfter=${tFirst.freshAfter.length}`);

  pageTick.setPipeline(realHarness);
  const tSecond = await pageTick.tick(mine);
  check("backlog: second tick (pipeline ready) processes the backlog",
    tSecond.res.sent === 2,
    JSON.stringify({ sent: tSecond.res.sent, processed: tSecond.res.processed }));
  check("backlog: after success nothing is re-offered (at-most-once holds)",
    tSecond.freshAfter.length === 0,
    `freshAfter=${tSecond.freshAfter.length}`);
  outbound = await getOutbound();
  const mySends = outbound.filter((e) => liveBacklog.includes(e.share_id));
  check("backlog: backlog shares sent exactly once each",
    mySends.length === 2, `got ${mySends.length}`);

  console.log(`\n${passes} passed, ${failures} failed.`);
  server.close();
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.rmSync(scratch2, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  if (server) server.close();
  process.exit(1);
});
