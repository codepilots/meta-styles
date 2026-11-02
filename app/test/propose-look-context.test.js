"use strict";
/* meta-styles — propose_look occasion/style-aware context threading tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Covers: (a) "make me a fairycore look for a wet day" over a wardrobe
 * with 2+ valid combos passes a non-empty context string through to a
 * mocked metaClient.assemble (stub asserts it received that context);
 * (b) a baseline trigger with no occasion wording passes no occasion
 * content (context is exactly the raw user text; all-empty input yields
 * ""); (c) the same context augments (never replaces) the preview
 * prompt's Y2K/fairycore base framing; (d) the proxy folds context into
 * the Spark prompt as a soft preference and keys the cache on it, so two
 * different occasion asks never share a cached result.
 * All fixtures synthetic (SYNTH_ prefix) — never real data. No network.
 *
 * Run: node app/test/propose-look-context.test.js
 */
const assert = require("node:assert");
// Localhost must bypass any env HTTP proxy (sandbox sets one for external traffic).
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";
const Wardrobe = require("../wardrobe-catalog.js");
const Handler = require("../skills/propose_look/handler.js");
const proxy = require("../../meta-api-proxy/server.js");

function seedMulti() {
  const cat = Wardrobe.createCatalog({ userKey: "SYNTH_ctx_" + Math.floor(Math.random() * 1e9) });
  ["dress", "layer/cardigan", "layer/blazer", "scarf", "bag"].forEach(function (c, i) {
    cat.addPiece({ category: c, attributes: {}, source_share_id: "SYNTH_share_ctx_" + i });
  });
  return cat;
}

function noIds(text, label) {
  assert.ok(!/SYNTH_/.test(text), label + " must not leak IDs: " + text.slice(0, 160));
}

async function run() {
  console.log("propose-look-context.test.js");

  // --- (a) occasion wording reaches assemble as context ---
  console.log("\n[(a) wet-day context threaded to assemble]");
  {
    const cat = seedMulti();
    const active = cat.getActivePieces();
    const dressId = active[0].piece_id;
    const cardiId = active[1].piece_id;
    let seenPieces = null;
    let seenContext = "UNSET";
    const mc = {
      assemble: async function (pieces, context) {
        seenPieces = pieces;
        seenContext = context;
        return { looks: [{ pieceIds: [dressId, cardiId], rationale: "Drapes long for a wet day." }] };
      },
      preview: async function () { throw new Error("no proxy in unit test"); }
    };
    const r = await Handler.handle({
      catalog: cat, metaClient: mc,
      text: "can you make me a fairycore look for a wet day", preferences: ""
    });
    assert.strictEqual(r.meta.source, "spark", "valid Spark output used, got " + r.meta.source);
    assert.ok(typeof seenContext === "string" && seenContext.length > 0,
      "assemble received a non-empty context string");
    assert.ok(/wet day/.test(seenContext), "context carries the occasion wording: " + seenContext);
    assert.ok(Array.isArray(seenPieces) && seenPieces.length === 5,
      "assemble still sees all five catalog pieces");
    noIds(r.text, "occasion reply");
    console.log("  pass: context=" + JSON.stringify(seenContext));
  }

  // --- (b) baseline trigger carries no occasion content ---
  console.log("\n[(b) baseline trigger: no occasion content in context]");
  {
    const cat = seedMulti();
    const active = cat.getActivePieces();
    let seenContext = "UNSET";
    const mc = {
      assemble: async function (pieces, context) {
        seenContext = context;
        return { looks: [{ pieceIds: [active[0].piece_id, active[1].piece_id], rationale: "Soft layers." }] };
      }
    };
    await Handler.handle({ catalog: cat, metaClient: mc, text: "show me a look", preferences: "" });
    assert.strictEqual(seenContext, "show me a look",
      "context is exactly the raw trigger text, nothing occasion-like added: " + JSON.stringify(seenContext));
    // All-empty input yields an empty context string (omitted by the client).
    const cat2 = seedMulti();
    const active2 = cat2.getActivePieces();
    let seenEmpty = "UNSET";
    const mc2 = {
      assemble: async function (pieces, context) {
        seenEmpty = context;
        return { looks: [{ pieceIds: [active2[0].piece_id, active2[1].piece_id], rationale: "Soft." }] };
      }
    };
    await Handler.handle({ catalog: cat2, metaClient: mc2, text: "", preferences: "" });
    assert.strictEqual(seenEmpty, "", "all-empty input yields empty context, got " + JSON.stringify(seenEmpty));
    console.log("  pass: baseline context exact, empty context empty");
  }

  // --- (c) preview prompt: base framing kept, brief appended ---
  console.log("\n[(c) preview prompt augmented, not replaced]");
  {
    const cat = seedMulti();
    const active = cat.getActivePieces();
    let seenPrompt = "";
    const mc = {
      assemble: async function () {
        return { looks: [{ pieceIds: [active[0].piece_id, active[1].piece_id], rationale: "Drape." }] };
      },
      preview: async function (prompt) {
        seenPrompt = prompt;
        throw new Error("no proxy in unit test");
      }
    };
    await Handler.handle({
      catalog: cat, metaClient: mc,
      text: "can you make me a fairycore look for a wet day", preferences: ""
    });
    assert.ok(/^Y2K fairycore flat-lay look card/.test(seenPrompt),
      "hardcoded Y2K/fairycore base framing kept: " + seenPrompt.slice(0, 60));
    assert.ok(/Styling brief from the wearer: .*wet day/.test(seenPrompt),
      "wearer context appended to preview prompt");
    console.log("  pass: base kept + brief appended");
  }

  // --- (d) proxy: context in prompt + cache key ---
  console.log("\n[(d) proxy folds context in, caches per context]");
  {
    let upstreamCalls = 0;
    let lastPrompt = "";
    function fakeUpstream(url, opts) {
      const body = JSON.parse(opts.body);
      if (url.endsWith("/responses")) {
        upstreamCalls += 1;
        lastPrompt = String((body.input && body.input[0] && body.input[0].content[0] || {}).text || "");
        const payload = { output: [{ content: [{ type: "output_text", text: '{"looks":[{"pieceIds":["a","b"],"rationale":"ok"}]}' }] }] };
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("{}") });
    }
    const { server } = await proxy.startServer({ port: 0, apiKey: "test-key", fetchImpl: fakeUpstream });
    const base = "http://127.0.0.1:" + server.address().port;
    const post = (p, b) => fetch(base + p, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
    try {
      const pieces = [{ id: "a", category: "dress" }, { id: "b", category: "layer/cardigan" }];
      const r1 = await post("/api/assemble", { pieces: pieces, context: "for a wet day" });
      assert.strictEqual(r1.status, 200, "assemble with context accepted");
      assert.ok(/wet day/.test(lastPrompt), "context folded into Spark prompt");
      assert.ok(/never pick an invalid combination/.test(lastPrompt),
        "soft-preference guard present in prompt");
      const callsAfterFirst = upstreamCalls;
      const r2 = await post("/api/assemble", { pieces: pieces, context: "for a sunny day" });
      assert.strictEqual(r2.status, 200, "second context accepted");
      assert.strictEqual(upstreamCalls, callsAfterFirst + 1,
        "different context is a cache miss (never shares a cached result)");
      const r3 = await post("/api/assemble", { pieces: pieces, context: "for a wet day" });
      assert.strictEqual(r3.status, 200, "repeat context accepted");
      assert.strictEqual(upstreamCalls, callsAfterFirst + 1,
        "identical context hits the cache (no new upstream call)");
      assert.strictEqual(r3.json.cached, true, "repeat flagged cached");
    } finally {
      server.close();
    }
    console.log("  pass: prompt folded + cache keyed on context");
  }

  console.log("\nAll propose-look context tests passed.");
}

run().catch((e) => { console.error(e.stack || e); process.exit(1); });
