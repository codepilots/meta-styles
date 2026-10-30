"use strict";
/* meta-styles Opus finding #14 — unbounded, collision-prone preview/segment caches.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Covers:
 *   (a) two DIFFERENT synthetic images with the SAME prompt and the SAME
 *       data-URL length must NOT collide on /api/preview (mocked upstream
 *       called twice, responses differ) — the actual reported bug;
 *   (b) the SAME image + SAME prompt twice DOES hit the cache (mocked
 *       upstream called once) — caching itself still works;
 *   (c) the shared server Map never exceeds CACHE_MAX_ENTRIES: after
 *       inserting more distinct keys than the bound, the oldest entry is
 *       evicted (re-request misses) and the newest is kept (re-request hits);
 *   (d) the client layer (app/meta-client.js preview(), which no longer
 *       caches and always round-trips) never collides: two different
 *       same-length images return different data URLs end to end.
 *
 * All fixtures are synthetic strings built in this file (never a real photo:
 * nothing in this cache-key path decodes image bytes). All ids synthetic
 * (SYNTH_ prefix) — never real data. All upstream traffic is a mocked
 * fetchImpl counting stub — never a real Meta Model API call.
 *
 * Run: node app/test/opus-finding-14-cache-keys.test.js
 */

// Localhost must bypass any env HTTP proxy (sandbox sets one for external traffic).
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";

const assert = require("node:assert");
const path = require("node:path");
const proxy = require(path.resolve(__dirname, "../../meta-api-proxy/server.js"));

const PROMPT = "flat lay garments laid out neatly: SYNTH_dress_01 + SYNTH_cardigan_02";
const IMG_PREFIX = "data:image/png;base64,";
// Equal length, different content: under the old (prompt + length) key these
// two collided; under the fixed full-image hash they must not.
const IMG_A = IMG_PREFIX + "A".repeat(64);
const IMG_B = IMG_PREFIX + "B".repeat(64);
assert.strictEqual(IMG_A.length, IMG_B.length, "fixtures must be equal length");
assert.notStrictEqual(IMG_A, IMG_B, "fixtures must differ in content");

function makeUpstream(counter) {
  return function fakePreviewUpstream(url, opts) {
    counter.calls++;
    const body = JSON.parse(opts.body);
    let payload;
    if (url.endsWith("/images/edits") || url.endsWith("/images/generations")) {
      const img = body.images && body.images[0] && body.images[0].image_url
        ? body.images[0].image_url : "";
      // Echo something input-derived so responses for different images differ.
      const tag = "img:" + String(body.prompt).slice(0, 24) + ":" + img.slice(-16);
      payload = { data: [{ b64_json: Buffer.from(tag).toString("base64") }], output_format: "webp" };
    } else {
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("{}") });
    }
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) });
  };
}

function poster(base) {
  return function post(p, b) {
    return fetch(base + p, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
  };
}

async function main() {
  console.log("Opus finding #14 — preview cache keys + LRU bound");

  // --- (a) different images, same prompt, same length: no collision ---
  console.log("\n[(a) different same-length images must not collide]");
  {
    const counter = { calls: 0 };
    const { server } = await proxy.startServer({ port: 0, apiKey: "test-key", fetchImpl: makeUpstream(counter) });
    const post = poster("http://127.0.0.1:" + server.address().port);
    try {
      const r1 = await post("/api/preview", { prompt: PROMPT, image: IMG_A });
      assert.strictEqual(r1.status, 200, "first preview 200, got " + r1.status);
      assert.strictEqual(r1.json.placeholder, false, "preview placeholder false");
      assert.strictEqual(r1.json.source, proxy.IMAGE_MODEL, "preview source is the image model");
      assert.ok(r1.json.dataURL.startsWith("data:image/webp;base64,"), "preview returns image data URL");
      assert.ok(!r1.json.cached, "first preview is not a cache hit");

      const r2 = await post("/api/preview", { prompt: PROMPT, image: IMG_B });
      assert.strictEqual(r2.status, 200, "second preview 200, got " + r2.status);
      assert.ok(!r2.json.cached, "different image must NOT be served from the first image's cache entry");
      assert.notStrictEqual(r2.json.dataURL, r1.json.dataURL, "responses must reflect their own image");
      assert.strictEqual(counter.calls, 2, "upstream must be called twice (once per image), got " + counter.calls);
      console.log("  pass: two different same-length images -> two upstream calls, different data URLs");

      // --- (b) same image + same prompt twice: cache hit ---
      const r3 = await post("/api/preview", { prompt: PROMPT, image: IMG_A });
      assert.strictEqual(r3.status, 200, "repeat preview 200");
      assert.strictEqual(r3.json.cached, true, "repeat of same image+prompt must hit the cache");
      assert.strictEqual(r3.json.dataURL, r1.json.dataURL, "cache hit returns the original image's data URL");
      assert.strictEqual(counter.calls, 2, "upstream still called twice total, got " + counter.calls);
      console.log("  pass: same image + same prompt -> cache hit, upstream untouched");

      // Text-only previews keep working and still cache on the prompt key.
      const t1 = await post("/api/preview", { prompt: PROMPT });
      const t2 = await post("/api/preview", { prompt: PROMPT });
      assert.strictEqual(t1.status, 200, "text-only preview 200");
      assert.ok(!t1.json.cached, "first text-only preview is not a hit");
      assert.strictEqual(t2.json.cached, true, "repeat text-only preview hits the cache");
      assert.strictEqual(counter.calls, 3, "text-only prompt adds exactly one upstream call, got " + counter.calls);
      console.log("  pass: text-only preview caches on the prompt exactly as before");
    } finally { server.close(); }
  }

  // --- (c) shared Map stays bounded: oldest evicted, newest kept ---
  console.log("\n[(c) LRU bound: size never exceeds CACHE_MAX_ENTRIES]");
  {
    assert.ok(Number.isInteger(proxy.CACHE_MAX_ENTRIES) && proxy.CACHE_MAX_ENTRIES > 0,
      "CACHE_MAX_ENTRIES must be exported as a positive int");
    const counter = { calls: 0 };
    const { server } = await proxy.startServer({ port: 0, apiKey: "test-key", fetchImpl: makeUpstream(counter) });
    const post = poster("http://127.0.0.1:" + server.address().port);
    try {
      const total = proxy.CACHE_MAX_ENTRIES + 5;
      for (let i = 0; i < total; i++) {
        const r = await post("/api/preview", { prompt: "SYNTH lru probe " + i });
        assert.strictEqual(r.status, 200, "probe insert " + i + " is 200");
      }
      assert.strictEqual(counter.calls, total, "every distinct prompt misses once, got " + counter.calls);

      const first = await post("/api/preview", { prompt: "SYNTH lru probe 0" });
      assert.ok(!first.json.cached, "oldest entry must have been evicted (re-request misses)");
      assert.strictEqual(counter.calls, total + 1, "evicted re-request hits upstream again");

      const last = await post("/api/preview", { prompt: "SYNTH lru probe " + (total - 1) });
      assert.strictEqual(last.json.cached, true, "newest entry must still be cached");
      assert.strictEqual(counter.calls, total + 1, "newest re-request adds no upstream call");
      console.log("  pass: " + total + " distinct keys bounded to " + proxy.CACHE_MAX_ENTRIES +
        " (oldest evicted, newest kept)");
    } finally { server.close(); }
  }

  // --- (d) client preview() never collides (no client-side cache) ---
  console.log("\n[(d) client preview() round-trips without colliding]");
  {
    const counter = { calls: 0 };
    const { server } = await proxy.startServer({ port: 0, apiKey: "test-key", fetchImpl: makeUpstream(counter) });
    globalThis.__IG_RUNTIME__ = { proxyBase: "http://127.0.0.1:" + server.address().port };
    delete require.cache[require.resolve("../meta-client.js")];
    const Meta = require("../meta-client.js");
    try {
      const c1 = await Meta.preview(PROMPT, IMG_A);
      const c2 = await Meta.preview(PROMPT, IMG_B);
      assert.ok(c1.dataURL && c2.dataURL, "client previews return data URLs");
      assert.notStrictEqual(c2.dataURL, c1.dataURL, "client must not serve image A's edit for image B");
      assert.strictEqual(counter.calls, 2, "client round-trips every preview (no client cache), got " + counter.calls);

      const c3 = await Meta.preview(PROMPT, IMG_A);
      assert.strictEqual(c3.dataURL, c1.dataURL, "repeat returns the same image's data URL via the proxy cache");
      assert.strictEqual(c3.cached, true, "repeat is flagged cached by the proxy");
      assert.strictEqual(counter.calls, 2, "proxy cache absorbs the repeat, got " + counter.calls);
      console.log("  pass: client preview() never collides; repeats served by the proxy cache");
    } finally {
      server.close();
      delete globalThis.__IG_RUNTIME__;
      delete require.cache[require.resolve("../meta-client.js")];
    }
  }

  console.log("\nAll Opus finding #14 tests passed.");
}

main().catch((e) => { console.error(e.stack || e); process.exit(1); });
