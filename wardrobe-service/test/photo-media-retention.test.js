"use strict";
/* meta-styles — photo media retention + truthful activity line (2026-11-03 live bug).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Live bug: after propose_look's no-valid-look reply ("share one more
 * piece"), the user's follow-up photo was routed to propose_look (which
 * cannot catalogue it, so it ignored the bytes) and the service then
 * acknowledged (deleted) the media although nothing used it. The
 * activity line also claimed "Replied to your message with a full
 * look." although no look was produced.
 *
 * End-to-end through the service (processOne + a REAL mock bot,
 * genuine send/media semantics, proxy stubbed unreachable so the
 * heuristic router + local fallback run — fully deterministic):
 *
 *  Case A (bug replay): seed top + scarf via two catalogued photos;
 *  text "show me a look" gets the honest no-valid-look reply; the next
 *  1-garment photo (jacket) is catalogued (piece added, reply sent)
 *  and its media acked.
 *  Case B (imageConsumed ack): a "should I buy this" photo is evaluated
 *  (hold stored) and its media acked via the explicit imageConsumed
 *  flag — a non-catalogue skill that really used the bytes.
 *  Case C (retention): a photo captioned "I bought it" confirms the
 *  hold but the photo itself is never consumed — its media must NOT be
 *  deleted (media_available stays true), the "kept" activity line
 *  appears, and counts.media_kept bumps.
 *  Case D (truthful activity): the no-valid-look propose_look turn
 *  never logs "with a full look" — it logs "Replied — no full look
 *  yet." derived from the verified outcome (selectedCount 0).
 *
 * All ids are SYNTH_-prefixed; no real account/media ids anywhere. No
 * real network traffic: the mock bot runs on loopback and only the
 * configured PROXY_BASE stub rejects.
 */
const assert = require("assert");
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;
const fs = require("fs");
const os = require("os");
const path = require("path");

const MockBot = require("../../mock-ig-bot/server.js");

const TOKEN = "SYNTH_mock_token";
const DEMO_REF = "u_deadbeefdeadbeefdeadbeefdeadbeef";
const PROXY_BASE = "http://127.0.0.1:59999";

async function run() {
  console.log("photo-media-retention.test.js");

  const realFetch = global.fetch;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-styles-photo-retain-"));
  const { server: botServer } = await MockBot.startServer({
    port: 0, token: TOKEN, catalogDir: tmpDir, catalogSecret: "SYNTH_test_catalog_secret",
  });
  const botBase = "http://127.0.0.1:" + botServer.address().port;

  // Proxy unreachable: live Spark route/assemble/preview all fall back
  // to the local heuristic — deterministic offline behavior.
  global.fetch = function (url, opts) {
    if (String(url).indexOf(PROXY_BASE) === 0) {
      return Promise.reject(new Error("proxy unreachable (stub)"));
    }
    return realFetch(url, opts);
  };

  // 1x1 PNG bytes: the mock bot stores real decodable media so the
  // service fetches genuine dataURLs (same fixture as
  // image-delivery-contract.test.js).
  const TINY_PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  async function botJson(method, urlPath, body, rawBody, contentType) {
    const headers = { Authorization: "Bearer " + TOKEN };
    let payload;
    if (rawBody !== undefined) {
      headers["Content-Type"] = contentType || "image/png";
      payload = rawBody;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await realFetch(botBase + urlPath, { method: method, headers: headers, body: payload });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = null; }
    return { status: res.status, body: parsed };
  }

  async function shares() {
    const res = await realFetch(botBase + "/ig/shares?limit=50", {
      headers: { Authorization: "Bearer " + TOKEN },
    });
    assert.strictEqual(res.status, 200, "shares readable");
    return (await res.json()).items;
  }

  async function catalog() {
    const res = await realFetch(botBase + "/ig/catalog/" + DEMO_REF, {
      headers: { Authorization: "Bearer " + TOKEN },
    });
    assert.strictEqual(res.status, 200, "catalog readable");
    return await res.json();
  }

  async function outbound() {
    const res = await botJson("GET", "/mock/outbound");
    assert.strictEqual(res.status, 200, "outbound readable");
    return res.body.outbound;
  }

  async function postPhoto(caption) {
    // kind=post carries the caption as the share title (the service's
    // captionHint), so caption words drive category sniffing; the JSON
    // body form carries no caption and no decodable bytes.
    const inc = await botJson("POST",
      "/mock/incoming-photo?kind=post&caption=" + encodeURIComponent(caption),
      undefined, Buffer.from(TINY_PNG_B64, "base64"), "image/png");
    assert.strictEqual(inc.status, 200, "incoming-photo accepted (" + caption + ")");
    const items = await shares();
    const item = items.filter(function (s) { return s.id === inc.body.share.id; })[0];
    assert.ok(item && item.media_id, "photo share carries media_id");
    assert.strictEqual(item.media_available, true, "media available at first");
    return item;
  }

  async function mediaAvailable(shareId) {
    const items = await shares();
    const hit = items.filter(function (s) { return s.id === shareId; })[0];
    assert.ok(hit, "share still listed: " + shareId);
    return hit.media_available;
  }

  delete require.cache[require.resolve("../server.js")];
  const Service = require("../server.js");
  const svc = Service.createService({
    botBase: botBase, proxyBase: PROXY_BASE,
    readToken: TOKEN, catalogToken: TOKEN, sendToken: TOKEN,
    port: 0, nowMs: function () { return Date.now(); },
  });

  try {
    const put = await botJson("PUT", "/ig/catalog/" + DEMO_REF, []);
    assert.ok(put.status === 200 || put.status === 204, "catalog seed PUT, got " + put.status);

    // --- Case A1: two photos catalogue a top and a scarf (no valid look) ---
    console.log("\n[two photos catalogue top + scarf]");
    const photoTop = await postPhoto("SYNTH my new top");
    const outTop = await svc.processOne(photoTop);
    assert.ok(outTop.indexOf("terminal:") === 0, "top photo terminal, got " + outTop);
    const photoScarf = await postPhoto("SYNTH a scarf for winter");
    const outScarf = await svc.processOne(photoScarf);
    assert.ok(outScarf.indexOf("terminal:") === 0, "scarf photo terminal, got " + outScarf);
    let pieces = await catalog();
    assert.strictEqual(pieces.length, 2, "two pieces catalogued, got " + pieces.length);
    assert.ok(pieces.some(function (p) { return p.category === "base/top"; }), "top present");
    assert.ok(pieces.some(function (p) { return p.category === "scarf"; }), "scarf present");

    // --- Case A2 + D: "show me a look" -> honest no-valid-look reply ---
    console.log("\n[no-valid-look reply + truthful activity line]");
    const txt = await botJson("POST", "/mock/incoming-text", { text: "show me a look" });
    assert.strictEqual(txt.status, 200, "incoming-text accepted");
    const items = await shares();
    const textItem = items.filter(function (s) { return s.id === txt.body.share.id; })[0];
    const outLook = await svc.processOne(textItem);
    assert.ok(outLook.indexOf("terminal:") === 0, "look text terminal, got " + outLook);
    const ob = await outbound();
    const lastReply = ob[ob.length - 1];
    assert.ok(/share one more piece/.test(lastReply.text),
      "honest no-valid-look reply, got " + lastReply.text.slice(0, 160));
    const activity = svc.status().activity.join("\n");
    assert.ok(!/with a full look/.test(activity),
      "no-valid-look turn never logs 'with a full look', activity=" + JSON.stringify(svc.status().activity));
    assert.ok(/Replied \u2014 no full look yet\./.test(activity),
      "truthful no-look line present, activity=" + JSON.stringify(svc.status().activity));
    console.log("  pass: honest reply + 'Replied — no full look yet.', no 'with a full look'");

    // --- Case A3: follow-up jacket photo is catalogued AND acked ---
    console.log("\n[follow-up photo catalogued, media acked]");
    const photoJacket = await postPhoto("SYNTH my new jacket");
    const outJacket = await svc.processOne(photoJacket);
    assert.ok(outJacket.indexOf("terminal:") === 0, "jacket photo terminal, got " + outJacket);
    pieces = await catalog();
    assert.strictEqual(pieces.length, 3, "jacket added (3 pieces), got " + pieces.length);
    assert.ok(pieces.some(function (p) { return p.category === "layer/blazer"; }),
      "jacket catalogued as layer/blazer, got " + JSON.stringify(pieces.map(function (p) { return p.category; })));
    assert.strictEqual(await mediaAvailable(photoJacket.id), false,
      "consumed photo media acknowledged");
    console.log("  pass: 1-garment photo catalogued (piece added, reply sent), media acked");

    // --- Case B: Evaluate photo is consumed (imageConsumed) -> acked ---
    console.log("\n[evaluated photo acked via imageConsumed]");
    const photoBuy = await postPhoto("SYNTH should I buy this");
    const outBuy = await svc.processOne(photoBuy);
    assert.ok(outBuy.indexOf("terminal:") === 0, "evaluate photo terminal, got " + outBuy);
    const logBuy = svc.getAgenticLog();
    assert.strictEqual(logBuy[logBuy.length - 1].skill, "Evaluate_prospective_purchase",
      "purchase phrasing routes to Evaluate, got " + logBuy[logBuy.length - 1].skill);
    pieces = await catalog();
    assert.ok(pieces.some(function (p) { return p.status === "held"; }), "hold stored");
    assert.strictEqual(await mediaAvailable(photoBuy.id), false,
      "evaluated (consumed) photo media acknowledged");
    console.log("  pass: Evaluate consumed the photo -> media acked");

    // --- Case C: "I bought it" photo confirms the hold, photo kept ---
    console.log("\n[unconsumed photo kept, 'kept' line + counter]");
    const keptBefore = svc.status().counts.media_kept;
    const photoBought = await postPhoto("SYNTH I bought it");
    const outBought = await svc.processOne(photoBought);
    assert.ok(outBought.indexOf("terminal:") === 0, "confirmation photo terminal, got " + outBought);
    const ob2 = await outbound();
    assert.ok(/officially yours/.test(ob2[ob2.length - 1].text), "hold confirmed into wardrobe");
    pieces = await catalog();
    assert.ok(pieces.some(function (p) { return p.status === "active" && p.category === "dress"; }),
      "held dress now active");
    assert.strictEqual(await mediaAvailable(photoBought.id), true,
      "unconsumed photo media NOT deleted (media_available stays true)");
    const st = svc.status();
    assert.ok(st.activity.some(function (l) { return /Kept your photo \u2014 I didn't use it this time\./.test(l); }),
      "'kept' activity line present, activity=" + JSON.stringify(st.activity));
    assert.ok(st.counts.media_kept > keptBefore,
      "media_kept bumped (" + keptBefore + " -> " + st.counts.media_kept + ")");
    console.log("  pass: photo kept (media_available true) + 'kept' line + media_kept=" + st.counts.media_kept);

    console.log("\n  pass: bug replay catalogued+acked; consumed evaluation acked; unconsumed kept; activity truthful");
  } finally {
    global.fetch = realFetch;
    await new Promise(function (resolve) { botServer.close(resolve); });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("\nAll photo-media-retention tests passed.");
}

run().catch(function (e) { console.error(e.stack || e); process.exit(1); });
