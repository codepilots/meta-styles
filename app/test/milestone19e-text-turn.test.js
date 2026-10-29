"use strict";
/* meta-styles Milestone 19e — text-turn contract tests.
 *
 * First step of the M19 chat-first pivot (docs/milestone-19-chat-first-pivot.md
 * §4 Gap 1, §7 task 1): free-text user turns must survive the
 * POST /mock/incoming-text -> GET /ig/shares -> inbox-bridge.js read path
 * instead of being silently dropped by the shape filter. No turn business
 * logic here (no catalog/propose/validate/revise — that is 19c/19d); this
 * file only proves the round-trip of a correctly shaped text item.
 *
 * All ids/tokens/text below are synthetic (SYNTH_ prefix, example.invalid
 * URLs) — never real Instagram data.
 *
 * Run: node app/test/milestone19e-text-turn.test.js
 */

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Sandbox sets an HTTP proxy; the mock is local-only, so bypass it here.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const { startServer } = require("../../mock-ig-bot/server.js");

const TOKEN = "SYNTH_mock_token";

// Load app/inbox-bridge.js pure helpers via vm (browser wiring is guarded;
// same technique as app/test/milestone6-pipeline-wiring.test.js).
const APP_DIR = path.resolve(__dirname, "..");
const bridgeSrc = fs.readFileSync(path.join(APP_DIR, "inbox-bridge.js"), "utf8");
const bridgeSandbox = {};
vm.createContext(bridgeSandbox);
vm.runInContext(bridgeSrc, bridgeSandbox, { filename: "inbox-bridge.js" });
const Bridge = bridgeSandbox.InboxBridge;

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

function textItem(id, text) {
  return {
    id,
    received_at: "2026-10-29T12:00:00Z",
    attachment: { type: "text", payload: { text } },
    media_id: null,
    media_available: false,
  };
}

async function main() {
  check("inbox-bridge.js exposes isTextItem/textOf pure helpers via vm",
    !!(Bridge && typeof Bridge.isTextItem === "function" && typeof Bridge.textOf === "function"));

  // --- Shape accept: a well-formed text item --------------------------------
  {
    const item = textItem("SYNTH_mid_text_001", "SYNTH no bag");
    check("19e: well-formed text item accepted by isValidShareItem",
      Bridge.isValidShareItem(item) === true);
    check("19e: well-formed text item recognised by isTextItem",
      Bridge.isTextItem(item) === true);
    check("19e: textOf returns the chat text",
      Bridge.textOf(item) === "SYNTH no bag",
      JSON.stringify(Bridge.textOf(item)));
    check("19e: kindFor labels a text turn",
      Bridge.kindFor(item) === "text message", Bridge.kindFor(item));
  }

  // --- Shape reject: malformed text items -----------------------------------
  for (const [label, entry] of [
    ["missing payload", { id: "SYNTH_x1", attachment: { type: "text" }, media_available: false }],
    ["null payload", { id: "SYNTH_x2", attachment: { type: "text", payload: null }, media_available: false }],
    ["missing text", { id: "SYNTH_x3", attachment: { type: "text", payload: {} }, media_available: false }],
    ["non-string text", { id: "SYNTH_x4", attachment: { type: "text", payload: { text: 42 } }, media_available: false }],
    ["empty text", { id: "SYNTH_x5", attachment: { type: "text", payload: { text: "" } }, media_available: false }],
    ["unknown type", { id: "SYNTH_x6", attachment: { type: "video", payload: { text: "SYNTH hi" } }, media_available: false }],
    ["null entry", null],
    ["array entry", []],
  ]) {
    check(`19e: malformed text item rejected (${label})`,
      Bridge.isValidShareItem(entry) === false);
    check(`19e: malformed text item not a text item (${label})`,
      Bridge.isTextItem(entry) === false);
  }
  // isTextItem checks the attachment shape only; the share-level id
  // requirement is enforced by isValidShareItem, not here.
  check("19e: text-shaped attachment without share id rejected by isValidShareItem only",
    Bridge.isValidShareItem({ attachment: { type: "text", payload: { text: "SYNTH hi" } }, media_available: false }) === false &&
    Bridge.isTextItem({ attachment: { type: "text", payload: { text: "SYNTH hi" } }, media_available: false }) === true);
  check("19e: textOf returns empty string for non-text entries",
    Bridge.textOf(null) === "" &&
    Bridge.textOf({ id: "SYNTH_x", attachment: { type: "image", payload: { url: "https://example.invalid/s.png" } }, media_id: "SYNTH_m" }) === "");

  // --- Regression: ig_post/image validation unchanged -----------------------
  {
    const post = {
      id: "SYNTH_mid_post_001",
      received_at: "2026-10-29T12:00:00Z",
      attachment: { type: "ig_post", payload: { ig_post_media_id: "SYNTH_post_001", title: "SYNTH look", url: "https://example.invalid/synth-media/SYNTH_live.jpg" } },
      media_id: "SYNTH_media_post_001",
      media_available: true,
    };
    const photo = {
      id: "SYNTH_mid_img_001",
      received_at: "2026-10-29T12:00:00Z",
      attachment: { type: "image", payload: { url: "https://example.invalid/synth-media/SYNTH_live.png" } },
      media_id: "SYNTH_media_img_001",
      media_available: true,
    };
    check("19e: valid ig_post item still accepted", Bridge.isValidShareItem(post) === true);
    check("19e: valid image item still accepted", Bridge.isValidShareItem(photo) === true);
    check("19e: ig_post/photo items are not text items",
      Bridge.isTextItem(post) === false && Bridge.isTextItem(photo) === false);
    check("19e: ig_post item missing ig_post_media_id still rejected",
      Bridge.isValidShareItem({ ...post, attachment: { type: "ig_post", payload: { title: "SYNTH x", url: "https://example.invalid/y" } } }) === false);
    check("19e: image item missing url still rejected",
      Bridge.isValidShareItem({ ...photo, attachment: { type: "image", payload: {} } }) === false);
    check("19e: photo item without any media locator still rejected",
      Bridge.isValidShareItem({ ...photo, media_id: null }) === false);
    check("19e: text item needs NO media locator (no media for a text turn)",
      Bridge.isValidShareItem({ ...textItem("SYNTH_mid_text_002", "SYNTH cheaper option?") }) === true);
    check("19e: parseJsonLines keeps text lines, skips malformed ones",
      (() => {
        const lines = [
          JSON.stringify(textItem("SYNTH_mid_text_003", "SYNTH show fabric")),
          "{not json",
          JSON.stringify({ id: "SYNTH_bad", attachment: { type: "text", payload: {} } }),
          JSON.stringify(photo),
        ].join("\n");
        const out = Bridge.parseJsonLines(lines);
        return out.length === 2 && out[0].id === "SYNTH_mid_text_003" && out[1].id === photo.id;
      })());
  }

  // --- Live round-trip: POST /mock/incoming-text -> GET /ig/shares -----------
  ({ server, store } = await startServer({ port: 0, token: TOKEN }));
  base = `http://127.0.0.1:${server.address().port}`;

  async function postText(text, query) {
    return fetch(`${base}/mock/incoming-text${query || ""}`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  }

  {
    const cursorBefore = (await (await fetch(`${base}/ig/shares`, { headers: authHeaders() })).json()).next_cursor;
    const res = await postText("SYNTH no bag");
    const created = await res.json();
    check("19e: POST /mock/incoming-text -> 200 + share",
      res.status === 200 && typeof created.share.id === "string", `got ${res.status}`);
    check("19e: minted share carries the text-turn shape (no media fields needed)",
      created.share.attachment &&
      created.share.attachment.type === "text" &&
      created.share.attachment.payload &&
      created.share.attachment.payload.text === "SYNTH no bag" &&
      created.share.media_id === null &&
      created.share.media_available === false,
      JSON.stringify(created.share).slice(0, 200));
    const after = await (await fetch(
      `${base}/ig/shares${cursorBefore !== null ? `?since=${cursorBefore}` : ""}`,
      { headers: authHeaders() })).json();
    check("19e: text turn visible via GET /ig/shares paging (same list, no new route)",
      after.items.length === 1 && after.items[0].id === created.share.id,
      JSON.stringify(after).slice(0, 160));
    const live = after.items[0];
    check("19e: client accepts the live text item (no longer silently dropped)",
      Bridge.isValidShareItem(live) === true &&
      Bridge.isTextItem(live) === true &&
      Bridge.textOf(live) === "SYNTH no bag");
    check("19e: text turn needs no GET /ig/media step (media_id is null)",
      live.media_id === null || live.media_id === undefined);
    const emptyRes = await postText("");
    const missingRes = await fetch(`${base}/mock/incoming-text`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    check("19e: incoming-text with empty/missing text -> 400",
      emptyRes.status === 400 && missingRes.status === 400,
      `got ${emptyRes.status}/${missingRes.status}`);
  }

  console.log(`\n${passes} passed, ${failures} failed.`);
  server.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  if (server) server.close();
  process.exit(1);
});
