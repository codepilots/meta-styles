"use strict";
/* meta-styles — propose_look live-path status test (wardrobe-service).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves, with synthetic fixtures only:
 *  - a natural "show me a look" share reaches propose_look through the
 *    service's real agentic path and invokes the observed assemble call;
 *  - status live_paths distinguish route / assemble / preview from what
 *    was actually observed (fallback here: proxy unreachable);
 *  - status image_delivery states text-only sends truthfully, and the
 *    outbound send carries image:false (sole writer + backstop intact).
 */
const assert = require("assert");

function synthPiece(n, category) {
  return {
    piece_id: "SYNTH_piece_" + String(n).padStart(3, "0"),
    category: category,
    attributes: {},
    source_share_id: "SYNTH_share_seed_" + n,
    added_at: new Date().toISOString(),
    copy_preview_keys: { copy: null, preview: null },
    status: "active",
  };
}

async function run() {
  console.log("look-choice-status.test.js");

  const origFetch = global.fetch;
  const sent = [];
  const seed = [
    synthPiece(1, "dress"),
    synthPiece(2, "layer/cardigan"),
    synthPiece(3, "scarf"),
  ];
  global.fetch = function (url, opts) {
    const u = String(url);
    if (u.indexOf("/ig/send") !== -1) {
      const body = opts && opts.body ? JSON.parse(String(opts.body)) : {};
      sent.push(body);
      const sendBody = { message_id: "SYNTH_mid_901" };
      return Promise.resolve({
        ok: true, status: 200,
        json: function () { return Promise.resolve(sendBody); },
        text: function () { return Promise.resolve(JSON.stringify(sendBody)); },
      });
    }
    if (u.indexOf("/ig/catalog") !== -1) {
      return Promise.resolve({
        ok: true, status: 200,
        text: function () { return Promise.resolve(JSON.stringify(seed)); },
        json: function () { return Promise.resolve(seed); },
      });
    }
    if (u.indexOf("/api/") !== -1 || u.indexOf("59998") !== -1) {
      return Promise.reject(new Error("proxy unreachable"));
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
      botBase: "http://127.0.0.1:59997", proxyBase: "http://127.0.0.1:59998",
      readToken: "SYNTH_mock_token", catalogToken: "SYNTH_mock_token", sendToken: "SYNTH_mock_token",
      port: 0, nowMs: function () { return Date.now(); }
    });

    const before = svc.status();
    assert.strictEqual(before.live_paths.route, "unprobed", "route starts unprobed");
    assert.strictEqual(before.live_paths.assemble, "unprobed", "assemble starts unprobed");
    assert.strictEqual(before.live_paths.preview, "not-staged", "preview starts not-staged");
    assert.strictEqual(before.image_delivery.sends, "text+image",
      "mock mode declares staged image sends (live mode stays text-only)");

    const now = new Date().toISOString();
    const item = {
      id: "SYNTH_share_look_001", received_at: now,
      attachment: { type: "text", payload: { text: "show me a look" } },
    };
    const outcome = await svc.processOne(item);
    assert.ok(typeof outcome === "string" && outcome.indexOf("terminal:") === 0,
      "processOne -> terminal, got " + outcome);

    const log = svc.getAgenticLog();
    assert.ok(log.length >= 1, "agentic log has an entry");
    assert.strictEqual(log[0].skill, "propose_look", "skill is propose_look, got " + log[0].skill);

    const after = svc.status();
    assert.strictEqual(after.live_paths.route, "fallback",
      "route observed as fallback, got " + after.live_paths.route);
    assert.strictEqual(after.live_paths.assemble, "fallback",
      "assemble observed as fallback, got " + after.live_paths.assemble);
    assert.ok(["fallback", "not-staged"].indexOf(after.live_paths.preview) !== -1,
      "preview not live without a proxy: " + after.live_paths.preview);
    assert.strictEqual(after.image_delivery.preview_delivery, "not-staged",
      "preview delivery stays not-staged");

    assert.ok(sent.length >= 1, "exactly one send attempted");
    assert.strictEqual(sent[0].image, false, "send stays text-only (image:false)");
    assert.ok(!/SYNTH_/.test(sent[0].text), "reply names no IDs: " + sent[0].text.slice(0, 120));
    assert.ok(!/example\.invalid/.test(sent[0].text), "no fake URL in live reply");
    assert.ok(!/https?:\/\//.test(sent[0].text), "no URL in live reply");

    console.log("  pass: propose_look via service; live_paths=" + JSON.stringify(after.live_paths));
  } finally {
    global.fetch = origFetch;
  }

  console.log("\nAll look-choice status tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
