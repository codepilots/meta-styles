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

console.log(`\n${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
