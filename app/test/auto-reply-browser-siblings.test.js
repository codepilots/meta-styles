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


/* meta-styles — regression test for the real browser-only dependency-
 * resolution bugs found live on 30 Oct 2026 debugging why auto-reply.js
 * never sent a single real reply despite the backlog-stranding fix
 * landing cleanly.
 *
 * Both bugs were INVISIBLE to every existing Node test because
 * `require("../auto-reply.js")` in Node never exercises auto-reply.js's
 * browser-only `sibling()` lookup through `root.MetaStyles[name]` --
 * Node's `typeof require !== "undefined"` fallback path finds every
 * sibling module correctly regardless of naming convention, masking both
 * bugs completely. This file simulates the REAL browser registration
 * shape (a single shared `MetaStyles` object with no Node `require`
 * available) to catch regressions in that path specifically.
 *
 * Bug 1: auto-reply.js's sibling() looked up root.MetaStyles[name] using
 * this module's own hyphenated filename ("wardrobe-catalog", "turn-loop",
 * "send-client", "meta-client", "poll-scheduler") but every sibling
 * module registers itself under a camelCase key (MetaStyles.wardrobeCatalog,
 * .turnLoop, .sendClient, .metaClient, .pollScheduler) -- sibling() always
 * resolved to null for every multi-word dependency, and createAutoReply's
 * very first dependency check threw synchronously, silently swallowed by
 * createAutoReplyClient()'s catch-all in mock-dm.html.
 *
 * Bug 2: classifier.js registered its functions FLAT on MetaStyles
 * (MetaStyles.classifyRegion, .classifyFromSpark, ...) with no nested
 * "classifier" key at all -- so even after fixing Bug 1's camelCase
 * conversion, sibling("classifier") still found nothing (there's no
 * camelCase form of a single word), classifyPhoto()'s fallback() called
 * null.classifyRegion(), the TypeError was swallowed by its own
 * try/catch, and every real photo resolved to category:null forever.
 *
 * Run: node app/test/auto-reply-browser-siblings.test.js
 */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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

const APP_DIR = path.resolve(__dirname, "..");

// Build a browser-shaped sandbox: a shared `MetaStyles` object on a fake
// `window`/`globalThis`, no Node `require` reachable from inside the vm
// context (matching a real <script> tag), and every sibling module loaded
// in registration order exactly as mock-dm.html's <script> tags do.
function freshBrowserSandbox() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  sandbox.fetch = async () => { throw new Error("no network in this sandbox"); };
  sandbox.localStorage = (function () {
    const store = {};
    return {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
  })();
  vm.createContext(sandbox);
  for (const mod of [
    "inbox-bridge.js", "wardrobe-catalog.js", "classifier.js", "assembler.js",
    "spark.js", "send-client.js", "meta-client.js", "turn-loop.js", "auto-reply.js",
  ]) {
    const src = fs.readFileSync(path.join(APP_DIR, mod), "utf8");
    vm.runInContext(src, sandbox, { filename: mod });
  }
  return sandbox;
}

// --- Bug 1 + 2 regression: every sibling resolves in a pure browser shape ---
{
  const sandbox = freshBrowserSandbox();
  const MS = sandbox.MetaStyles;
  check("siblings: MetaStyles.wardrobeCatalog registered (camelCase)",
    !!(MS && MS.wardrobeCatalog && typeof MS.wardrobeCatalog.createCatalog === "function"));
  check("siblings: MetaStyles.turnLoop registered (camelCase)",
    !!(MS && MS.turnLoop && typeof MS.turnLoop.createTurnLoop === "function"));
  check("siblings: MetaStyles.sendClient registered (camelCase)",
    !!(MS && MS.sendClient && typeof MS.sendClient.createSendClient === "function"));
  check("siblings: MetaStyles.metaClient registered (camelCase)",
    !!(MS && MS.metaClient));
  check("siblings: MetaStyles.classifier nested alias registered (Bug 2)",
    !!(MS && MS.classifier && typeof MS.classifier.classifyRegion === "function" &&
       typeof MS.classifier.classifyFromSpark === "function"));
  check("siblings: MetaStyles.classifyRegion flat form still present (back-compat for app.js)",
    typeof MS.classifyRegion === "function");

  // The actual regression: createAutoReply must NOT throw in this
  // pure-browser shape (no Node require fallback available at all).
  let created = null;
  let threw = null;
  try {
    created = MS.autoReply.createAutoReply({
      base: "http://localhost:8000/ig",
      token: "SYNTH_test_token",
      sendBase: "http://localhost:8000/ig",
      sendToken: "SYNTH_test_send_token",
      catalogBase: "http://localhost:8000/ig",
      catalogToken: "SYNTH_test_catalog_token",
      userKey: "SYNTH_test_user",
      userRef: "u_deadbeefdeadbeefdeadbeefdeadbeef",
      storage: sandbox.localStorage,
      log: () => {},
    });
  } catch (err) {
    threw = err;
  }
  check("siblings: createAutoReply does not throw in a pure browser shape (no require)",
    !threw && !!created, threw ? threw.message : "createAutoReply returned falsy");

  // Bug 2's exact failure mode: fallback-path classify must reach the
  // real classifyRegion function, not throw on a null Classifier.
  let classifyThrew = null;
  try {
    MS.classifier.classifyRegion({ kind: "box", rect: [0.2, 0.2, 0.6, 0.6], labelHint: "dress" });
  } catch (err) {
    classifyThrew = err;
  }
  check("siblings: MetaStyles.classifier.classifyRegion is directly callable",
    !classifyThrew, classifyThrew ? classifyThrew.message : "");
}

console.log(`\n${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
