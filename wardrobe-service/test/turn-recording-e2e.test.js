"use strict";
/* meta-styles Opus finding #6 — propose -> explain_fit end-to-end test.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Regression test Opus explicitly asked for: through the real
 * wardrobe-service/server.js mock-mode path (same harness style as
 * look-choice-status.test.js, synthetic fixtures only, no network):
 *   1. seed a wardrobe bigger than any one look (dress, top, bottom,
 *      cardigan, scarf, bag);
 *   2. "show me a look" routes to propose_look and records the turn;
 *   3. "why does this work?" routes to explain_fit and the reply names
 *      the ACTUAL proposed pieces (dress + cardigan, "worn open") —
 *      not the honest "I don't have a look" fallback, and not every
 *      piece in the wardrobe concatenated together.
 * Before the fix this failed: nothing ever called recordTurn, so
 * getTurns() was always [] and explain_fit fell through to
 * lookFromActive (all bases + finish) or the no-look fallback.
 *
 * Also covers the richer lastTurns builder (server.js buildLastTurns):
 * user text AND the bot's own sent reply appear, in order.
 *
 * Run: node wardrobe-service/test/turn-recording-e2e.test.js
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

function textItem(id, text) {
  return {
    id: id, received_at: new Date().toISOString(),
    attachment: { type: "text", payload: { text: text } },
  };
}

async function run() {
  console.log("turn-recording-e2e.test.js (Opus finding #6)");

  const origFetch = global.fetch;
  const sent = [];
  const seed = [
    synthPiece(1, "dress"),
    synthPiece(2, "base/top"),
    synthPiece(3, "base/bottom"),
    synthPiece(4, "layer/cardigan"),
    synthPiece(5, "scarf"),
    synthPiece(6, "bag"),
  ];
  global.fetch = function (url, opts) {
    const u = String(url);
    if (u.indexOf("/ig/send") !== -1) {
      const body = opts && opts.body ? JSON.parse(String(opts.body)) : {};
      sent.push(body);
      const sendBody = { message_id: "SYNTH_mid_tr_001" };
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

    // --- lastTurns builder unit checks (exported helper) ---
    console.log("\n[buildLastTurns helper]");
    {
      assert.strictEqual(typeof Service.buildLastTurns, "function", "buildLastTurns exported");
      assert.deepStrictEqual(Service.buildLastTurns(null), [], "null catalog -> []");
      const Wardrobe = require("../../app/wardrobe-catalog.js");
      const cat = Wardrobe.createCatalog({ userKey: "SYNTH_tr_e2e_helper" });
      assert.deepStrictEqual(Service.buildLastTurns(cat), [], "empty catalog -> []");
      cat.recordTurn({ userText: "show me a look", proposal: null, verdict: false, reasons: ["x"] });
      cat.recordSentTurn({ text: "Here is a look for you", in_reply_to_share: "SYNTH_s1" });
      cat.recordTurn({ userText: "why does this work?", proposal: null, verdict: false, reasons: ["x"] });
      const lines = Service.buildLastTurns(cat);
      assert.deepStrictEqual(lines, [
        "User: show me a look",
        "Bot: Here is a look for you",
        "User: why does this work?",
      ], "user + bot texts interleaved in order, got " + JSON.stringify(lines));
      // A catalog without sent-turn support (old shape) must not throw.
      const lines2 = Service.buildLastTurns({ getTurns: function () { return []; } });
      assert.deepStrictEqual(lines2, [], "missing getSentTurns -> [] not a throw");
      console.log("  pass: buildLastTurns interleaves User/Bot lines in order");
    }

    // --- end-to-end propose -> explain_fit through the service ---
    console.log("\n[propose -> explain_fit via processOne]");
    const svc = Service.createService({
      botBase: "http://127.0.0.1:59997", proxyBase: "http://127.0.0.1:59998",
      readToken: "SYNTH_mock_token", catalogToken: "SYNTH_mock_token", sendToken: "SYNTH_mock_token",
      port: 0, nowMs: function () { return Date.now(); }
    });

    const o1 = await svc.processOne(textItem("SYNTH_share_tr_look", "show me a look"));
    assert.ok(typeof o1 === "string" && o1.indexOf("terminal:") === 0, "turn 1 terminal, got " + o1);
    const log1 = svc.getAgenticLog();
    assert.ok(log1.length >= 1 && log1[log1.length - 1].skill === "propose_look",
      "turn 1 -> propose_look, got " + JSON.stringify(log1.map(function (e) { return e.skill; })));

    const o2 = await svc.processOne(textItem("SYNTH_share_tr_why", "why does this work?"));
    assert.ok(typeof o2 === "string" && o2.indexOf("terminal:") === 0, "turn 2 terminal, got " + o2);
    const log2 = svc.getAgenticLog();
    assert.ok(log2.length >= 2 && log2[log2.length - 1].skill === "explain_fit",
      "turn 2 -> explain_fit, got " + JSON.stringify(log2.map(function (e) { return e.skill; })));

    assert.ok(sent.length >= 2, "two sends, got " + sent.length);
    const reply = sent[sent.length - 1].text;
    assert.ok(typeof reply === "string" && reply.length > 0, "explain reply present");
    assert.ok(!/don't have a look|no look/i.test(reply),
      "must NOT fall back to no-look honesty — a look WAS proposed: " + reply.slice(0, 200));
    assert.ok(/cardigan/.test(reply), "names the proposed layer: " + reply.slice(0, 200));
    assert.ok(/worn open/.test(reply), "layer mechanic for the proposed look: " + reply.slice(0, 200));
    assert.ok(/Your dress \+ cardigan work/.test(reply),
      "noun list is exactly the recorded look, not the whole wardrobe: " + reply.slice(0, 200));
    assert.ok(!/tied high/.test(reply), "no scarf mechanic for a layer look: " + reply.slice(0, 200));
    assert.ok(!/SYNTH_/.test(reply), "no id leak: " + reply.slice(0, 120));
    console.log("  pass: explain_fit names the recorded look (dress + cardigan, worn open)");

    console.log("\nAll turn-recording e2e tests passed.");
  } finally {
    global.fetch = origFetch;
  }
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
