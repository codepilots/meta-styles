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

console.log(`\n${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
