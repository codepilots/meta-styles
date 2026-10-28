"use strict";
/* meta-styles Milestone 13 — mock-DM page static tests (tasks 1, 8, 9, 11).
 *
 * Pure file-content assertions on app/mock-dm.html (and, for swap wiring,
 * app/inbox-bridge.js): no server, no browser needed. The page must stay
 * genuinely static-renderable — its usage instructions are visible with the
 * mock server stopped.
 *
 * Run: node app/test/milestone13-mock-dm-page.test.js
 */

const fs = require("fs");
const path = require("path");

const APP_DIR = path.resolve(__dirname, "..");
const pagePath = path.join(APP_DIR, "mock-dm.html");
const bridgePath = path.join(APP_DIR, "inbox-bridge.js");

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

const page = fs.readFileSync(pagePath, "utf8");

// --- Task 1: instructions panel renders with no server ----------------------
check("task1: page explains how to share a photo",
  /share a photo|incoming-photo/i.test(page));
check("task1: page explains send-as-app",
  /send[- ]as[- ]app|POST \/ig\/send/i.test(page));
check("task1: page explains how to point index.html at the mock",
  /index\.html.*mock|BOT_BASE|8904/i.test(page));
check("task1: page states the chat starts empty (no seed)",
  /starts? empty|no seed|blank/i.test(page));
check("task1: page never references a seed.json",
  !/seed\.json/i.test(page));

// --- Task 8: chat UI wiring (static — no browser needed) ----------------------
const vm = require("vm");
const scriptBodies = [...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
check("task8: page has inline UI script", scriptBodies.length > 0);
let syntaxOk = false;
try {
  for (const body of scriptBodies) new vm.Script(body);
  syntaxOk = true;
} catch (err) {
  console.log("  script syntax error: " + err.message);
}
check("task8: inline script is syntax-valid JS", syntaxOk);
const script = scriptBodies.join("\n");
check("task8: thread view container exists", /id="thread"/.test(page));
check("task8: text box + share-text control exist",
  /id="(chatText|sendTextBtn)"/.test(page) && /mock\/incoming-text/.test(script));
check("task8: photo share control exists (file pick and/or drag-drop)",
  /id="photo(File|Input|Drop)"|type="file"|dragover|drop/i.test(page) && /mock\/incoming-photo/.test(script));
check("task8: send-as-app panel posts byte-identical /ig/send with confirm:true",
  /id="send(Panel|Share|Text|Btn)"/.test(page) && /\/ig\/send/.test(script) && /confirm/.test(script));
check("task8: operator panel can stage an outbound image",
  /mock\/stage-outbound-image/.test(script));
check("task8: thread renders contract reads + outbound log",
  /\/ig\/shares/.test(script) && /\/ig\/media\//.test(script) && /mock\/outbound/.test(script));
check("task8: stale-share demo affordance (backdated injection)",
  /age_hours|stale/i.test(page));
check("task8: duplicate-send demo affordance (key reuse or re-send)",
  /duplicat|reuse.*key|re-send|resend/i.test(page));
check("task8: no real-Instagram hosts anywhere in the page",
  !/codepilots|graph\.instagram|lookaside/i.test(page));
check("task8: no live-bot port except the one documented real-bot switch line",
  (page.match(/8903/g) || []).length <= 1 && /8904/.test(page));
check("task8: no external fetches (only same-origin + 127.0.0.1:8904)",
  ![...script.matchAll(/fetch\(\s*[`'"]([^`'"]+)/g)].some((m) => /^https?:\/\/(?!127\.0\.0\.1:8904)/.test(m[1])));

// --- Task 7 (grep half): operator routes stay out of client-called paths -----
const bridge = fs.readFileSync(bridgePath, "utf8");
check("task7: inbox-bridge.js never calls /mock/... operator routes",
  !/\/mock\//.test(bridge));

// --- Task 9: swap wiring (one-line BOT_BASE edit, no override) ---------------
check("task9: BOT_BASE defaults to the mock (:8904)",
  /var BOT_BASE = "http:\/\/127\.0\.0\.1:8904"/.test(bridge));
check("task9: switch-back to the real bot (:8903) is documented in a comment",
  /8903/.test(bridge) && /real .*bot|switch/i.test(bridge));
check("task9: no query-param override in the bridge",
  !/location\.search|URLSearchParams|\?bot=/.test(bridge));
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^\S\n])\/\/[^\n]*/g, "$1");
}
const bridgeCode = stripComments(bridge);
check("task9: live bridge code never points at :8903 (comment only)",
  !/8903/.test(bridgeCode));
check("task9: bridge fetches only BOT_BASE-relative or same-origin URLs",
  ![...bridgeCode.matchAll(/fetch\(\s*[`'"]([^`'"]+)/g)]
    .some((m) => /^https?:\/\//.test(m[1])));

// --- Task 11: zero-dependency isolation (static half) -------------------------
// The live half (real browser walk with a hosts-file block) still needs a
// human — see docs/milestone-13-contract-parity.md §Isolation. What CAN be
// proven here: no code path in the mock server, the chat page, or the bridge
// references a real-Instagram host or issues an outbound request to anything
// but 127.0.0.1:8904 / same-origin.
const serverPath = path.join(__dirname, "..", "..", "mock-ig-bot", "server.js");
const server = fs.readFileSync(serverPath, "utf8");
const serverCode = stripComments(server);
const pageCode = stripComments(page);
for (const [label, src] of [["mock server", serverCode], ["chat page", pageCode], ["bridge", bridgeCode]]) {
  check(`task11: no real-Instagram host in ${label} code (codepilots/graph/lookaside/fbsbx)`,
    !/codepilots|graph\.instagram|lookaside|fbsbx/i.test(src));
}
check("task11: :8903 appears in mock server comments only, never in live code",
  !/8903/.test(serverCode));
check("task11: mock server requires no network-client module (https/net/tls/dns/child_process)",
  ![...serverCode.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)]
    .some((m) => /^(https|http2|net|tls|dgram|dns|child_process|worker_threads)$/.test(m[1])));
check("task11: mock server never issues an outbound request (no http.request/get, fetch, socket connect)",
  !/http\.(request|get)\s*\(|fetch\s*\(|net\.connect|tls\.connect|new WebSocket|XMLHttpRequest/.test(serverCode));
check("task11: mock server binds loopback only",
  /listen\([^)]*"127\.0\.0\.1"/.test(serverCode));
check("task11: chat page mock-base field defaults to 127.0.0.1:8904",
  /value="http:\/\/127\.0\.0\.1:8904"/.test(page));

console.log(`\n${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
