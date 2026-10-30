"use strict";
/* meta-styles — live outbound-stage contract test (app/send-client.js).
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Proves the send client's LIVE staging path against a FAKE live bot that
 * implements the real bot's documented POST /ig/outbound-stage/<share_id>
 * contract — same shapes, locally, with zero prior-work source involved:
 * the fake below is a fresh independent implementation written only from
 * the contract shapes in the task brief (200 {share_id, bytes} on
 * success; 404 {"error":"unknown share_id"}; 413 over the media cap; 415
 * on non-image Content-Type or body; idempotent overwrite on re-stage;
 * Bearer IG_API_SEND_TOKEN auth; staged bytes then unlock image:true on
 * POST /ig/send exactly like the mock flow).
 *
 * This is a MOCKED-CONTRACT test, not a live network proof: the fake
 * listens on an ephemeral loopback port, never 8903/8905, and no test
 * here contacts the real bot. Real round-trip verification against the
 * actual bot is a human step (Bramble), done outside this suite.
 *
 * Also pins the mock-mode default as unchanged: a client built WITHOUT
 * opts.mode still stages via /mock/stage-outbound-image/<share_id>.
 *
 * All ids/keys/bytes are synthetic (SYNTH_ prefix); image fixtures are a
 * 1x1 PNG plus minimal magic-byte headers, never real media.
 *
 * Run: node app/test/live-outbound-stage.test.js
 */

const assert = require("node:assert/strict");
const http = require("node:http");

// Sandbox sets an HTTP proxy; the fake is local-only, so bypass it here
// (same pattern as milestone19b-send-client.test.js).
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const SendClient = require("../send-client.js");

const TOKEN = "SYNTH_live_stage_token";
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const TINY_PNG = Buffer.from(TINY_PNG_B64, "base64");
// Minimal magic-byte headers for the other accepted types (body bytes are
// synthetic; only the sniffed prefix matters to the fake, as documented).
const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 7)]);
const FAKE_GIF = Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.alloc(16, 7)]);
const FAKE_WEBP = Buffer.concat(
  [Buffer.from("RIFF", "latin1"), Buffer.from([20, 0, 0, 0]), Buffer.from("WEBP", "latin1"), Buffer.alloc(12, 7)]
);
const NOT_AN_IMAGE = Buffer.from("SYNTH just some words, not pixels", "utf8");

// The fake's own media cap (documented here, not the real bot's value —
// the client treats any 413 the same whatever the cap is).
const FAKE_MAX_MEDIA = 32 * 1024;

function sniffKind(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
      bytes[6] === 0x1a && bytes[7] === 0x0a) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 6 && bytes.slice(0, 6).toString("latin1") === "GIF87a") return "gif";
  if (bytes.length >= 6 && bytes.slice(0, 6).toString("latin1") === "GIF89a") return "gif";
  if (bytes.length >= 12 && bytes.slice(0, 4).toString("latin1") === "RIFF" &&
      bytes.slice(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

// Fresh independent fake of the documented live contract (see header).
function startFakeLiveBot() {
  const shares = new Set([
    "SYNTH_share_live_stage_1",
    "SYNTH_share_live_stage_2",
    "SYNTH_share_live_stage_3", // known but never staged (unstaged-send case)
  ]);
  const staged = new Map(); // shareId -> Buffer (re-stage overwrites)
  const seenPaths = [];
  let msgCounter = 0;
  let graphFail = false;

  function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    seenPaths.push(req.method + " " + url.pathname);
    if (req.headers.authorization !== "Bearer " + TOKEN) {
      req.resume();
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    if (req.method === "POST" && url.pathname.indexOf("/ig/outbound-stage/") === 0) {
      const sid = decodeURIComponent(url.pathname.slice("/ig/outbound-stage/".length));
      if (!shares.has(sid)) {
        req.resume();
        sendJson(res, 404, { error: "unknown share_id" });
        return;
      }
      const chunks = [];
      let size = 0;
      let tooLarge = false;
      req.on("data", (c) => {
        if (tooLarge) return;
        size += c.length;
        if (size > FAKE_MAX_MEDIA) { tooLarge = true; return; }
        chunks.push(c);
      });
      req.on("end", () => {
        if (tooLarge) { sendJson(res, 413, { error: "body_too_large" }); return; }
        const bytes = Buffer.concat(chunks);
        const ct = String(req.headers["content-type"] || "");
        if (ct.indexOf("image/") !== 0 || !sniffKind(bytes)) {
          sendJson(res, 415, { error: "unsupported_media" });
          return;
        }
        staged.set(sid, bytes);
        sendJson(res, 200, { share_id: sid, bytes: bytes.length });
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/ig/send") {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        let payload = null;
        try { payload = JSON.parse(raw); } catch (e) { payload = null; }
        if (!payload || typeof payload.share_id !== "string" || !shares.has(payload.share_id)) {
          sendJson(res, 404, { error: "unknown share_id" });
          return;
        }
        if (payload.image === true && !staged.has(payload.share_id)) {
          sendJson(res, 400, { error: "image_not_staged" });
          return;
        }
        msgCounter += 1;
        const out = {
          message_id: "SYNTH_msg_live_" + msgCounter,
          recipient_ref: payload.share_id,
        };
        if (payload.image === true) {
          if (graphFail) {
            sendJson(res, 502, {
              error: "image_send_failed",
              message_id: out.message_id,
              recipient_ref: out.recipient_ref,
            });
            return;
          }
          msgCounter += 1;
          out.image_message_id = "SYNTH_imgmsg_live_" + msgCounter;
        }
        sendJson(res, 200, out);
      });
      return;
    }
    req.resume();
    sendJson(res, 404, { error: "not_found" });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      server,
      base: "http://127.0.0.1:" + server.address().port,
      shares, staged, seenPaths,
      setGraphFail: (v) => { graphFail = !!v; },
    }));
  });
}

async function main() {
  const fake = await startFakeLiveBot();
  assert.ok(fake.base.indexOf(":8903") === -1 && fake.base.indexOf(":8905") === -1,
    "fake bot never binds the real bot/proxy ports, got " + fake.base);
  console.log("live-outbound-stage.test.js (fake live bot at " + fake.base + ")");

  const live = SendClient.createSendClient({ base: fake.base, token: TOKEN, mode: "live" });
  const pngURL = "data:image/png;base64," + TINY_PNG_B64;

  // 1. Live stage success: 200 {share_id, bytes}, correct image Content-Type.
  {
    const r = await live.stageOutboundImage("SYNTH_share_live_stage_1", pngURL);
    assert.equal(r.ok, true, "stage 200 resolves ok:true, got " + JSON.stringify(r));
    assert.equal(r.staged, true, "staged:true");
    assert.deepEqual(r.body, { share_id: "SYNTH_share_live_stage_1", bytes: TINY_PNG.length });
    assert.ok(fake.seenPaths.indexOf("POST /ig/outbound-stage/SYNTH_share_live_stage_1") !== -1,
      "live client hits the live route, saw " + JSON.stringify(fake.seenPaths));
    assert.ok(fake.staged.get("SYNTH_share_live_stage_1").equals(TINY_PNG), "stored bytes match");
  }

  // 2. Idempotent re-stage overwrites the same share_id.
  {
    const jpegURL = "data:image/jpeg;base64," + FAKE_JPEG.toString("base64");
    const r = await live.stageOutboundImage("SYNTH_share_live_stage_1", jpegURL);
    assert.equal(r.ok, true, "re-stage 200 ok:true");
    assert.equal(r.body.bytes, FAKE_JPEG.length, "byte count follows the new body");
    assert.ok(fake.staged.get("SYNTH_share_live_stage_1").equals(FAKE_JPEG), "overwrite wins");
  }

  // 3. Unknown share_id -> 404 {"error":"unknown share_id"} -> {ok:false}.
  {
    const r = await live.stageOutboundImage("SYNTH_share_live_nope", pngURL);
    assert.equal(r.ok, false, "unknown share not ok");
    assert.equal(r.status, 404, "status 404, got " + r.status);
    assert.equal(r.error, "unknown share_id", "bot error surfaced, got " + r.error);
    assert.equal(r.staged, false, "staged:false");
  }

  // 4. Body over the cap -> 413 -> {ok:false} (honest fallback, never a crash).
  {
    const big = Buffer.concat([TINY_PNG, Buffer.alloc(FAKE_MAX_MEDIA, 1)]);
    const r = await live.stageOutboundImage(
      "SYNTH_share_live_stage_2", "data:image/png;base64," + big.toString("base64"));
    assert.equal(r.ok, false, "oversize not ok");
    assert.equal(r.status, 413, "status 413, got " + r.status);
    assert.equal(r.staged, false, "staged:false");
  }

  // 5. Non-image Content-Type -> 415 -> {ok:false}.
  {
    const r = await live.stageOutboundImage(
      "SYNTH_share_live_stage_2",
      "data:text/plain;base64," + NOT_AN_IMAGE.toString("base64"));
    assert.equal(r.ok, false, "non-image content-type not ok");
    assert.equal(r.status, 415, "status 415, got " + r.status);
    assert.equal(r.staged, false, "staged:false");
  }

  // 6. Image Content-Type but non-image bytes (magic-byte check) -> 415.
  {
    const r = await live.stageOutboundImage(
      "SYNTH_share_live_stage_2",
      "data:image/png;base64," + NOT_AN_IMAGE.toString("base64"));
    assert.equal(r.ok, false, "bad magic bytes not ok");
    assert.equal(r.status, 415, "status 415, got " + r.status);
  }

  // 7. Wrong Bearer [REDACTED] 401 -> {ok:false}.
  {
    const badAuth = SendClient.createSendClient({ base: fake.base, token: "SYNTH_wrong", mode: "live" });
    const r = await badAuth.stageOutboundImage("SYNTH_share_live_stage_1", pngURL);
    assert.equal(r.ok, false, "bad auth not ok");
    assert.equal(r.status, 401, "status 401, got " + r.status);
  }

  // 8. Unreachable base -> bot_unreachable {ok:false}, never throws.
  {
    const dead = SendClient.createSendClient({ base: "http://127.0.0.1:59991", token: TOKEN, mode: "live" });
    const r = await dead.stageOutboundImage("SYNTH_share_live_stage_1", pngURL);
    assert.equal(r.ok, false, "unreachable not ok");
    assert.equal(r.status, 0, "status 0, got " + r.status);
    assert.equal(r.error, "bot_unreachable", "bot_unreachable, got " + r.error);
  }

  // 9. Malformed dataURL -> bad_data_url with no network attempt.
  {
    const before = fake.seenPaths.length;
    const r = await live.stageOutboundImage("SYNTH_share_live_stage_1", "not-a-data-url");
    assert.equal(r.ok, false, "bad data url not ok");
    assert.equal(r.error, "bad_data_url", "bad_data_url, got " + r.error);
    assert.equal(fake.seenPaths.length, before, "no HTTP attempted for a bad dataURL");
  }

  // 10. Full live mirror of the mock flow: staged share sends image:true
  // and the bot confirms an image_message_id.
  {
    await live.stageOutboundImage("SYNTH_share_live_stage_2", pngURL);
    const sent = await live.sendTurn({
      shareId: "SYNTH_share_live_stage_2", text: "SYNTH live look",
      key: "SYNTH_key_live_001", withImage: true,
    });
    assert.equal(sent.ok, true, "staged image send 200, got " + JSON.stringify(sent.body));
    assert.ok(typeof sent.body.image_message_id === "string", "image_message_id confirms delivery");
  }

  // 11. image:true with nothing staged -> 400 image_not_staged, surfaced.
  {
    const fresh = SendClient.createSendClient({ base: fake.base, token: TOKEN, mode: "live" });
    const sent = await fresh.sendTurn({
      shareId: "SYNTH_share_live_stage_3", text: "SYNTH unstaged",
      key: "SYNTH_key_live_002", withImage: true,
    });
    assert.equal(sent.ok, false, "unstaged image send not ok");
    assert.equal(sent.status, 400, "status 400, got " + sent.status);
    assert.equal(sent.error, "image_not_staged", "bot error surfaced, got " + sent.error);
    const sent2 = await fresh.sendTurn({
      shareId: "SYNTH_share_live_stage_3", text: "SYNTH unstaged retry",
      key: "SYNTH_key_live_003", withImage: false,
    });
    assert.equal(sent2.ok, true, "text-only send still works, got " + sent2.status);
    assert.ok(!("image_message_id" in sent2.body), "no image proof without image:true");
  }

  // 12. Mock-mode default unchanged: no opts.mode stages via the mock route.
  {
    const def = SendClient.createSendClient({ base: fake.base, token: TOKEN });
    const before = fake.seenPaths.length;
    const r = await def.stageOutboundImage("SYNTH_share_live_stage_1", pngURL);
    assert.equal(r.ok, false, "fake has no mock route, so default-mode stage 404s");
    assert.equal(r.status, 404, "status 404, got " + r.status);
    assert.equal(fake.seenPaths[before],
      "POST /mock/stage-outbound-image/SYNTH_share_live_stage_1",
      "default client still uses the mock route, saw " + fake.seenPaths[before]);
  }

  // 13. Staged-but-Graph-failed split surfaces honestly (502 image_send_failed).
  {
    fake.setGraphFail(true);
    try {
      const sent = await live.sendTurn({
        shareId: "SYNTH_share_live_stage_2", text: "SYNTH graph fails",
        key: "SYNTH_key_live_004", withImage: true,
      });
      assert.equal(sent.ok, false, "502 not ok");
      assert.equal(sent.status, 502, "status 502, got " + sent.status);
      assert.equal(sent.error, "image_send_failed", "split error surfaced, got " + sent.error);
      assert.ok(typeof sent.body.message_id === "string", "text leg id still returned");
    } finally {
      fake.setGraphFail(false);
    }
  }

  // 14. Other accepted image types stage (gif + webp magic).
  {
    const g = await live.stageOutboundImage(
      "SYNTH_share_live_stage_2", "data:image/gif;base64," + FAKE_GIF.toString("base64"));
    assert.equal(g.ok, true, "gif stages, got " + JSON.stringify(g.body));
    const w = await live.stageOutboundImage(
      "SYNTH_share_live_stage_2", "data:image/webp;base64," + FAKE_WEBP.toString("base64"));
    assert.equal(w.ok, true, "webp stages, got " + JSON.stringify(w.body));
  }

  console.log("\nAll live-outbound-stage contract tests passed.");
  fake.server.close();
}

main().catch((err) => {
  console.error("FATAL:", err && err.stack || err);
  process.exit(1);
});
