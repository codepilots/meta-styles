"use strict";
/* meta-styles — multi-attachment pipeline regression test.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Guards the 2026-10-31 incident: one Instagram DM carried 9 image
 * attachments; the bot's /ig/shares previously gave every attachment the
 * same item id (the message mid), so the wardrobe's per-share handled map
 * collapsed the batch — 1 photo catalogued, 8 silently skipped. The bot
 * now emits per-attachment ids: "<mid>:<media_id>" (distinct per image,
 * duplicate webhooks still collide intentionally), text items keep the
 * bare mid.
 *
 * This test proves the wardrobe poll loop honours that contract:
 *   1. 9 image items sharing the SAME mid but 9 DISTINCT ids are all
 *      processed (catalogued and replied), none silently skipped; 9 replies.
 *   2. The same id replayed across polls is deduped — second occurrence
 *      skipped, no second reply.
 *   3. A text item keeps a bare mid id and is processed on its own.
 *   4. No user ref/id string leaks into any activity line.
 *
 * All ids are SYNTH_-prefixed; media bytes are tiny synthetic PNGs served
 * by a fetch stub — no real network, no secrets, stdlib only.
 */

const assert = require("assert");

const MID = "SYNTH_mid_multi";
const PROXY_BASE = "http://127.0.0.1:59999";
const TOKEN = "SYNTH_mock_token";

// Reuse helper name from deletion-reconcile.test.js for the leak check.
function assertNoLeak(activity) {
  const blob = activity.join("\n");
  assert.ok(blob.indexOf("SYNTH_") === -1,
    "activity must not leak SYNTH_ ids, got " + JSON.stringify(activity));
  assert.ok(blob.indexOf("SYNTH_mid_multi") === -1,
    "activity must not leak mid, got " + JSON.stringify(activity));
  assert.ok(blob.indexOf("SYNTH_media_") === -1,
    "activity must not leak media ids, got " + JSON.stringify(activity));
}

function imageItem(n) {
  const mediaId = "SYNTH_media_" + n;
  return {
    id: MID + ":" + mediaId,
    received_at: new Date().toISOString(),
    attachment: { type: "image", payload: { url: "mock-local:image" } },
    media_id: mediaId,
    media_available: true,
  };
}

function textItem(id, text) {
  return {
    id: id,
    received_at: new Date().toISOString(),
    attachment: { type: "text", payload: { text: text } },
  };
}

async function run() {
  console.log("multi-attachment-pipeline.test.js (2026-10-31 per-attachment id contract)");

  const origFetch = global.fetch;
  const sent = [];

  const seed = [];
  // Minimal catalog so propose_look etc have something if needed, but
  // catalogue_piece path does not require it.

  global.fetch = function (url, opts) {
    const u = String(url);
    if (u.indexOf("/ig/send") !== -1) {
      const body = opts && opts.body ? JSON.parse(String(opts.body)) : {};
      sent.push(body);
      const sendBody = { message_id: "SYNTH_msg_" + String(sent.length).padStart(3, "0") };
      return Promise.resolve({
        ok: true, status: 200,
        json: function () { return Promise.resolve(sendBody); },
        text: function () { return Promise.resolve(JSON.stringify(sendBody)); },
      });
    }
    if (u.indexOf("/ig/media/") !== -1) {
      // Serve fake bytes for every media_id the batch references.
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: function () { return "image/jpeg"; } },
        arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(8)); },
      });
    }
    if (u.indexOf("/ig/catalog") !== -1) {
      return Promise.resolve({
        ok: true, status: 200,
        text: function () { return Promise.resolve(JSON.stringify(seed)); },
        json: function () { return Promise.resolve(seed); },
      });
    }
    if (u.indexOf("/mock/stage-outbound-image/") !== -1 || u.indexOf("/ig/outbound-stage/") !== -1) {
      return Promise.resolve({
        ok: true, status: 200,
        json: function () { return Promise.resolve({ share_id: u.split("/").pop() }); },
        text: function () { return Promise.resolve("{}"); },
      });
    }
    if (u.indexOf(PROXY_BASE) !== -1 || u.indexOf("/api/") !== -1) {
      return Promise.reject(new Error("proxy unreachable (stub)"));
    }
    return Promise.resolve({
      ok: true, status: 200,
      text: function () { return Promise.resolve("{}"); },
      json: function () { return Promise.resolve({}); },
    });
  };

  try {
    delete require.cache[require.resolve("../server.js")];
    const Service = require("../server.js");
    const svc = Service.createService({
      botBase: "http://127.0.0.1:59997", proxyBase: PROXY_BASE,
      readToken: TOKEN, catalogToken: TOKEN, sendToken: TOKEN,
      port: 0, nowMs: function () { return Date.now(); }
    });

    // --- 1. 9 image items sharing the SAME mid, 9 DISTINCT ids ---
    console.log("\n[batch of 9 image items, same mid, distinct ids]");
    const batch = [];
    for (let i = 1; i <= 9; i++) batch.push(imageItem(i));

    // Sanity: same mid prefix, distinct full ids.
    assert.strictEqual(batch[0].id, "SYNTH_mid_multi:SYNTH_media_1");
    assert.strictEqual(batch[8].id, "SYNTH_mid_multi:SYNTH_media_9");
    const ids = batch.map(function (it) { return it.id; });
    assert.strictEqual(new Set(ids).size, 9, "9 distinct ids");
    assert.ok(ids.every(function (id) { return id.indexOf(MID + ":") === 0; }),
      "every id carries the shared mid prefix");
    // All share the same mid prefix extraction
    const mids = ids.map(function (id) { return id.split(":")[0]; });
    assert.ok(mids.every(function (m) { return m === MID; }), "same mid for all 9");

    const outcomes = [];
    for (let i = 0; i < batch.length; i++) {
      const out = await svc.processOne(batch[i]);
      outcomes.push(out);
      assert.ok(typeof out === "string" && out.indexOf("terminal:") === 0,
        "batch item " + (i + 1) + " terminal, got " + out);
      // No silently skipped — terminal must not be skipped/unsupported
      assert.ok(out.indexOf("terminal:skipped") === -1 && out.indexOf("terminal:unsupported") === -1,
        "batch item " + (i + 1) + " not silently skipped, got " + out);
    }
    // All 9 processed, none skipped.
    assert.strictEqual(svc.status().counts.processed, 9,
      "9 processed, got " + svc.status().counts.processed);
    assert.strictEqual(sent.length, 9,
      "9 replies sent, got " + sent.length);

    // Replies carry distinct per-attachment keys (no collapse).
    const keys = sent.map(function (b) { return b.idempotency_key; });
    assert.strictEqual(new Set(keys).size, 9, "9 distinct idempotency keys, got " + JSON.stringify(keys));
    assert.ok(keys.every(function (k) { return k === "wardrobe-send-v1:" + batch[keys.indexOf(k)].id; }) ||
      keys.every(function (k) { return k.indexOf("wardrobe-send-v1:" + MID + ":") === 0; }),
      "keys derived from distinct per-attachment ids");

    // No id leak into replies or activity.
    sent.forEach(function (b) {
      assert.ok(!/SYNTH_/.test(b.text), "no SYNTH_ in reply text: " + b.text.slice(0, 120));
    });
    assertNoLeak(svc.status().activity);
    console.log("  pass: all 9 distinct-attachment items processed, 9 replies, no leak");

    // --- 2. Same id replayed across polls -> deduped, no second reply ---
    console.log("\n[duplicate id across polls -> skipped]");
    const sentBefore = sent.length;
    const processedBefore = svc.status().counts.processed;
    const dupOut = await svc.processOne(batch[0]); // SYNTH_mid_multi:SYNTH_media_1 again
    assert.ok(typeof dupOut === "string" && dupOut.indexOf("terminal:") === 0,
      "duplicate terminal, got " + dupOut);
    assert.strictEqual(sent.length, sentBefore,
      "no second reply on duplicate, sent=" + sent.length + " expected " + sentBefore);
    // Handled map should have suppressed it.
    assert.strictEqual(svc.status().counts.skipped + svc.status().counts.duplicates >= 1, true,
      "duplicate counted as skipped/duplicate");
    // Processed count must not grow on dedupe (second occurrence not re-processed).
    assert.strictEqual(svc.status().counts.processed, processedBefore,
      "processed unchanged on duplicate, got " + svc.status().counts.processed);
    assertNoLeak(svc.status().activity);
    console.log("  pass: duplicate id deduped, no second reply");

    // --- 3. Text item keeps bare mid id and is processed on its own ---
    console.log("\n[text item keeps bare mid id]");
    const text = textItem(MID, "show me a look");
    assert.strictEqual(text.id, MID, "text id is bare mid");
    assert.ok(text.id.indexOf(":") === -1, "bare mid has no colon suffix");
    const textOut = await svc.processOne(text);
    assert.ok(typeof textOut === "string" && textOut.indexOf("terminal:") === 0,
      "text item terminal, got " + textOut);
    assert.strictEqual(sent.length, sentBefore + 1,
      "text item produced its own reply, sent=" + sent.length);
    assert.strictEqual(sent[sent.length - 1].idempotency_key, "wardrobe-send-v1:" + MID,
      "text key is bare mid, got " + sent[sent.length - 1].idempotency_key);
    assertNoLeak(svc.status().activity);
    console.log("  pass: text item with bare mid processed independently");

    // --- 4. No user ref/id string leaks into any activity line ---
    console.log("\n[activity leak check: full status shape]");
    const status = svc.status();
    const statusBlob = JSON.stringify(status);
    // Status JSON must not contain the synthetic ids or mid as data;
    // only the counts/activity plain-language lines.
    assert.ok(statusBlob.indexOf("SYNTH_mid_multi") === -1,
      "status JSON must not contain mid, got leak in " + statusBlob.slice(0, 500));
    assert.ok(statusBlob.indexOf("SYNTH_media_") === -1,
      "status JSON must not contain media ids");
    assertNoLeak(status.activity);
    // Also check that none of the sent reply texts leaked ids (already checked per-send, sweep again).
    const allReplyText = sent.map(function (b) { return b.text; }).join("\n");
    assert.ok(!/SYNTH_/.test(allReplyText), "no SYNTH_ in any reply text");
    console.log("  pass: no ref/id leak in activity or status");

    console.log("\nAll multi-attachment pipeline tests passed.");
  } finally {
    global.fetch = origFetch;
  }
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
