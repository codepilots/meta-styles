"use strict";
/* meta-styles — mock bot /ig/profile route contract tests.
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026).
 *
 * Spins up mock-ig-bot/server.js in-process on an ephemeral port with an
 * isolated temp data dir and asserts the wearer-profile companion to the
 * /ig/catalog persistence route:
 *  (a) PUT then GET round-trips the full record;
 *  (b) the record is encrypted at rest (raw file bytes carry no plaintext
 *      photo data or data-URL marker);
 *  (c) GET for an unknown ref returns the empty record (never 404);
 *  (d) DELETE removes the record idempotently (204 twice; GET after reads
 *      empty), and the file is gone from disk;
 *  (e) auth (401 without/wrong Bearer [REDACTED] and forbidden origin (403) match the
 *      catalog route's guards;
 *  (f) malformed refs and shapes are 400 (bad_user_ref, bad_request);
 *  (g) debug/status surfaces (/mock/state, /mock/outbound) never carry
 *      profile bytes, even right after a PUT.
 * All ids/tokens/bytes synthetic (SYNTH_ prefix, locally generated 1px
 * PNGs) — never real user data.
 *
 * Run: node app/test/profile-api-routes.test.js
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Localhost must bypass any env HTTP proxy (sandbox sets one for external traffic).
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const { startServer } = require("../../mock-ig-bot/server.js");

const TOKEN = "SYNTH_mock_token_profile";
const ORIGIN = "http://localhost:8000";
const REF = "u_" + "b".repeat(32);
const OTHER_REF = "u_" + "c".repeat(32);

// Locally generated 1x1 PNG data URLs — synthetic fixture bytes only.
const HS = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const FB = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMINAAAABJRU5ErkJggg==";

const RECORD = {
  headshot: HS,
  full_body: FB,
  consent: true,
  updated_at: "2026-11-02T00:00:00.000Z",
};

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log("PASS: " + name);
  } else {
    failures++;
    console.log("FAIL: " + name + (detail ? " — " + detail : ""));
  }
}

function authHeaders(extra) {
  return Object.assign({ Authorization: "Bearer " + TOKEN }, extra || {});
}

async function run() {
  console.log("profile-api-routes.test.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "SYNTH-profile-"));
  const started = await startServer({
    port: 0, token: TOKEN, allowOrigin: ORIGIN,
    catalogDir: dir, catalogSecret: "SYNTH_profile_secret",
  });
  const server = started.server;
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const url = function (p) { return base + p; };

    // --- (c first) GET unknown ref: empty record, never 404 ---
    console.log("\n[(c) GET unknown ref reads empty]");
    {
      const res = await fetch(url("/ig/profile/" + OTHER_REF), { headers: authHeaders() });
      check("GET unknown -> 200", res.status === 200, "got " + res.status);
      const body = await res.json();
      check("empty record shape",
        body.headshot === null && body.full_body === null && body.consent === false && body.updated_at === null,
        JSON.stringify(body).slice(0, 160));
    }

    // --- (a) PUT then GET round-trip ---
    console.log("\n[(a) PUT/GET round-trip]");
    {
      const put = await fetch(url("/ig/profile/" + REF), {
        method: "PUT", headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(RECORD),
      });
      check("PUT -> 204", put.status === 204, "got " + put.status);
      const get = await fetch(url("/ig/profile/" + REF), { headers: authHeaders() });
      check("GET -> 200", get.status === 200, "got " + get.status);
      const body = await get.json();
      check("record round-trips intact",
        body.headshot === HS && body.full_body === FB && body.consent === true &&
        body.updated_at === RECORD.updated_at,
        JSON.stringify(body).slice(0, 160));
    }

    // --- (b) encrypted at rest ---
    console.log("\n[(b) encrypted at rest]");
    {
      const files = fs.readdirSync(dir).filter(function (f) { return /\.profile\.bin$/.test(f); });
      check("exactly one profile file on disk", files.length === 1, JSON.stringify(files));
      const raw = fs.readFileSync(path.join(dir, files[0]));
      check("raw bytes carry no data-URL marker", !raw.includes("data:image"), "plaintext photo bytes on disk");
      check("raw bytes carry no base64 photo payload", !raw.includes("iVBORw0KGgo"), "payload visible on disk");
      check("raw bytes are binary (not JSON)", (function () {
        try { JSON.parse(raw.toString("utf8")); return false; } catch (e) { return true; }
      })(), raw.toString("utf8").slice(0, 80));
    }

    // --- (g) debug/status surfaces carry no profile bytes ---
    console.log("\n[(g) no profile bytes in debug/status]");
    {
      const st = await fetch(url("/mock/state"), { headers: authHeaders() });
      const stBody = await st.text();
      check("GET /mock/state -> 200", st.status === 200, "got " + st.status);
      check("/mock/state has no photo bytes", !stBody.includes("data:image") && !stBody.includes("iVBORw0KGgo"),
        stBody.slice(0, 160));
      const ob = await fetch(url("/mock/outbound"), { headers: authHeaders() });
      const obBody = await ob.text();
      check("GET /mock/outbound -> 200", ob.status === 200, "got " + ob.status);
      check("/mock/outbound has no photo bytes", !obBody.includes("data:image") && !obBody.includes("iVBORw0KGgo"),
        obBody.slice(0, 160));
    }

    // --- (e) auth + origin guards ---
    console.log("\n[(e) auth and origin guards]");
    {
      const noAuth = await fetch(url("/ig/profile/" + REF));
      check("no token -> 401", noAuth.status === 401, "got " + noAuth.status);
      const wrong = await fetch(url("/ig/profile/" + REF), { headers: authHeaders() });
      // sanity: right token still 200 (guard above proves nothing changed)
      check("right token -> 200", wrong.status === 200, "got " + wrong.status);
      const badToken = await fetch(url("/ig/profile/" + REF), {
        headers: { Authorization: "Bearer SYNTH_wrong_token" },
      });
      check("wrong token -> 401", badToken.status === 401, "got " + badToken.status);
      const badOrigin = await fetch(url("/ig/profile/" + REF), {
        headers: authHeaders({ Origin: "http://evil.invalid" }),
      });
      check("forbidden origin -> 403", badOrigin.status === 403, "got " + badOrigin.status);
    }

    // --- (f) malformed refs and shapes ---
    console.log("\n[(f) malformed refs and shapes]");
    {
      const badRef = await fetch(url("/ig/profile/not-a-ref"), { headers: authHeaders() });
      check("bad ref -> 400", badRef.status === 400, "got " + badRef.status);
      const badShape = await fetch(url("/ig/profile/" + REF), {
        method: "PUT", headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ headshot: 123, consent: "yes" }),
      });
      check("bad shape -> 400", badShape.status === 400, "got " + badShape.status);
      const badKeys = await fetch(url("/ig/profile/" + REF), {
        method: "PUT", headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ headshot: HS, injected: true }),
      });
      check("unknown keys -> 400", badKeys.status === 400, "got " + badKeys.status);
      const notJson = await fetch(url("/ig/profile/" + REF), {
        method: "PUT", headers: authHeaders({ "Content-Type": "application/json" }),
        body: "this is not json",
      });
      check("non-JSON body -> 400", notJson.status === 400, "got " + notJson.status);
      // The stored record survives the rejected PUTs untouched.
      const again = await (await fetch(url("/ig/profile/" + REF), { headers: authHeaders() })).json();
      check("rejected PUTs change nothing", again.headshot === HS && again.consent === true,
        JSON.stringify(again).slice(0, 120));
    }

    // --- (d) DELETE removes the record idempotently ---
    console.log("\n[(d) DELETE idempotent]");
    {
      const del1 = await fetch(url("/ig/profile/" + REF), { method: "DELETE", headers: authHeaders() });
      check("first DELETE -> 204", del1.status === 204, "got " + del1.status);
      const after = await (await fetch(url("/ig/profile/" + REF), { headers: authHeaders() })).json();
      check("GET after DELETE reads empty",
        after.headshot === null && after.full_body === null && after.consent === false,
        JSON.stringify(after).slice(0, 120));
      const files = fs.readdirSync(dir).filter(function (f) { return /\.profile\.bin$/.test(f); });
      check("profile file gone from disk", files.length === 0, JSON.stringify(files));
      const del2 = await fetch(url("/ig/profile/" + REF), { method: "DELETE", headers: authHeaders() });
      check("second DELETE -> 204 (idempotent)", del2.status === 204, "got " + del2.status);
    }
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nAll profile-api-routes tests passed." : "\n" + failures + " FAILURES");
  if (failures > 0) process.exitCode = 1;
}

run().catch(function (e) { console.error((e && e.stack) || e); process.exit(1); });
