"use strict";
/* meta-styles Milestone 19h — mock-bot catalog persistence + encryption parity.
 *
 * NEW hackathon work (building period Oct 27 – Nov 4, 2026). Fresh,
 * independent implementation mirroring ONLY the route contract of the
 * real (prior-work, out-of-repo) bot's local-only catalog API — never a
 * port of that service's source, never touching it.
 *
 * Covers, against mock-ig-bot/server.js started in-process on an
 * ephemeral port with an isolated temp data dir:
 *   a. PUT/GET round-trip: stored array comes back exactly.
 *   b. Last-write-wins: two PUTs, GET returns only the second payload.
 *   c. Malformed user_ref rejected with 4xx, never silently accepted
 *      (empty, traversal-looking, wrong shape) — and stores nothing.
 *   d. On-disk file is raw ciphertext (not JSON, no plaintext piece
 *      data), yet GET still decrypts it back; same payload for two
 *      users yields different bytes (per-user keys).
 * Plus the app-side M11 seam: wardrobe-catalog save()/load() persist
 * and restore through the store client, stay memory-only with no store,
 * and refuse corrupt stored arrays without touching memory.
 *
 * All ids/refs are synthetic (SYNTH_ payload ids, u_+hex demo refs,
 * example.invalid URLs) — never real Instagram data or secrets.
 *
 * Run: node app/test/milestone19h-catalog-persistence.test.js
 */

process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { startServer } = require("../../mock-ig-bot/server.js");
const Catalog = require("../wardrobe-catalog.js");

const TOKEN = "SYNTH_mock_token";
const ORIGIN = "http://localhost:8000";
const SECRET = "SYNTH_test_secret_19h (non-secret test value)";

// Valid-shape but clearly synthetic user_refs (u_ + 32 hex, never real).
const REF_A = "u_" + "a".repeat(32);
const REF_B = "u_" + "b".repeat(32);
const REF_C = "u_" + "c".repeat(32);

let server;
let base;
let dir;
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

function deepSame(a, b) {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch (err) {
    return false;
  }
}

function authHeaders(extra) {
  return { Authorization: "Bearer " + TOKEN, ...(extra || {}) };
}

function synthPieces(tag) {
  return [
    {
      piece_id: "SYNTH_piece_" + tag + "_01",
      category: "base/top",
      attributes: { color: "washed lilac", silhouette: "cami", layer_role: "base" },
      source_share_id: "SYNTH_share_photo_" + tag,
      added_at: "2026-10-29T12:00:00.000Z",
      copy_preview_keys: { copy: null, preview: null },
      status: "active",
    },
    {
      piece_id: "SYNTH_piece_" + tag + "_02",
      category: "bag",
      attributes: { color: "silver", silhouette: "mini shoulder", layer_role: "finish" },
      source_share_id: "SYNTH_share_photo_" + tag,
      added_at: "2026-10-29T13:00:00.000Z",
      copy_preview_keys: { copy: "SYNTH_copy_" + tag, preview: "SYNTH_prev_" + tag },
      status: "rejected",
    },
  ];
}

async function putJson(refPath, value, headers) {
  return fetch(`${base}${refPath}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(headers || authHeaders()) },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

async function main() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-catalog-19h-"));
  ({ server } = await startServer({
    port: 0, token: TOKEN, allowOrigin: ORIGIN, catalogDir: dir, catalogSecret: SECRET,
  }));
  base = `http://127.0.0.1:${server.address().port}`;

  // --- GET before anything stored: [] (never 404 for "no data") ---------
  {
    const res = await fetch(`${base}/ig/catalog/${REF_A}`, { headers: authHeaders() });
    const body = await res.json();
    check("19h: GET unknown user_ref -> 200 [] (no 404 for no-data)",
      res.status === 200 && Array.isArray(body) && body.length === 0,
      `got ${res.status} ${JSON.stringify(body).slice(0, 80)}`);
  }

  // --- (c) malformed user_ref rejected, stores nothing -------------------
  const badRefs = [
    ["empty segment", "/ig/catalog/", 400],
    ["bare prefix", "/ig/catalog", 400],
    ["plain word", "/ig/catalog/not-a-ref", 400],
    ["app-style key", "/ig/catalog/SYNTH_user_001", 400],
    ["short hex", "/ig/catalog/u_abc123", 400],
    ["non-hex", "/ig/catalog/u_" + "z".repeat(32), 400],
    ["uppercase hex", "/ig/catalog/u_" + "A".repeat(32), 400],
    ["too long", "/ig/catalog/u_" + "a".repeat(33), 400],
    ["encoded slash", "/ig/catalog/" + encodeURIComponent("a/b"), 400],
    ["traversal", "/ig/catalog/../../etc", null], // normalised by URL -> still 4xx
  ];
  for (const [label, p, want] of badRefs) {
    const res = await fetch(`${base}${p}`, { headers: authHeaders() });
    const okStatus = want === null
      ? res.status >= 400 && res.status < 500
      : res.status === want;
    let errName = "";
    try { errName = (await res.json()).error || ""; } catch (err) { errName = "unparseable"; }
    check(`19h: malformed user_ref (${label}) rejected with 4xx`,
      okStatus && (want === null || errName.length > 0),
      `got ${res.status} ${errName}`);
  }
  {
    const res = await putJson(`/ig/catalog/not-a-ref`, synthPieces("bad"), authHeaders());
    check("19h: PUT malformed user_ref -> 4xx, not stored",
      res.status >= 400 && res.status < 500, `got ${res.status}`);
  }
  check("19h: malformed refs stored no files on disk",
    fs.readdirSync(dir).length === 0,
    `files: ${fs.readdirSync(dir).join(",")}`);

  // --- auth still enforced on the catalog routes -------------------------
  {
    const res = await putJson(`/ig/catalog/${REF_A}`, synthPieces("noauth"), {});
    check("19h: PUT without token -> 401", res.status === 401, `got ${res.status}`);
    const res2 = await fetch(`${base}/ig/catalog/${REF_A}`);
    check("19h: GET without token -> 401", res2.status === 401, `got ${res2.status}`);
  }

  // --- body must be a JSON array ------------------------------------------
  {
    const res = await putJson(`/ig/catalog/${REF_A}`, { pieces: [] }, authHeaders());
    check("19h: PUT non-array JSON -> 400", res.status === 400, `got ${res.status}`);
    const res2 = await putJson(`/ig/catalog/${REF_A}`, "not json{{{", authHeaders());
    check("19h: PUT invalid JSON -> 400", res2.status === 400, `got ${res2.status}`);
  }

  // --- (a) round-trip ------------------------------------------------------
  const payloadA = synthPieces("A");
  {
    const res = await putJson(`/ig/catalog/${REF_A}`, payloadA, authHeaders());
    check("19h: PUT full array -> 204", res.status === 204, `got ${res.status}`);
    const got = await fetch(`${base}/ig/catalog/${REF_A}`, { headers: authHeaders() });
    const body = await got.json();
    check("19h: (a) GET returns the PUT catalog exactly",
      got.status === 200 && deepSame(body, payloadA),
      `status=${got.status} match=${deepSame(body, payloadA)}`);
  }

  // --- (b) last-write-wins --------------------------------------------------
  const payloadB = [synthPieces("B")[0]];
  {
    await putJson(`/ig/catalog/${REF_B}`, synthPieces("B"), authHeaders());
    await putJson(`/ig/catalog/${REF_B}`, payloadB, authHeaders());
    const got = await fetch(`${base}/ig/catalog/${REF_B}`, { headers: authHeaders() });
    const body = await got.json();
    check("19h: (b) last-write-wins: GET returns only the second payload",
      got.status === 200 && deepSame(body, payloadB),
      `got ${JSON.stringify(body).slice(0, 120)}`);
  }

  // --- (d) on-disk proof: ciphertext, yet decrypts correctly ----------------
  {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".bin"));
    check("19h: stored catalogs are .bin files (2 users so far)",
      files.length === 2, `files: ${files.join(",")}`);
    const raw = fs.readFileSync(path.join(dir, files[0]));
    let parsesAsJson = true;
    try { JSON.parse(raw.toString("utf8")); } catch (err) { parsesAsJson = false; }
    check("19h: (d) on-disk file is NOT valid JSON",
      parsesAsJson === false, `first bytes: ${raw.slice(0, 32).toString("latin1")}`);
    check("19h: (d) on-disk file holds NO plaintext piece data",
      !raw.includes(Buffer.from("SYNTH_piece")) && !raw.includes(Buffer.from("piece_id")),
      "plaintext marker found in stored file");
    // Same payload, second user -> different bytes (per-user keys + fresh IV).
    await putJson(`/ig/catalog/${REF_C}`, payloadA, authHeaders());
    const blobs = fs.readdirSync(dir).filter((f) => f.endsWith(".bin"))
      .map((f) => fs.readFileSync(path.join(dir, f)));
    const pairwiseDistinct = blobs.length === 3 &&
      !blobs[0].equals(blobs[1]) && !blobs[0].equals(blobs[2]) && !blobs[1].equals(blobs[2]);
    check("19h: (d) same payload for two users stores different bytes",
      pairwiseDistinct, // REF_A and REF_C hold identical plaintext
      `sizes: ${blobs.map((b) => b.length).join(",")}`);
    const got = await fetch(`${base}/ig/catalog/${REF_C}`, { headers: authHeaders() });
    check("19h: (d) GET still decrypts back to the exact original",
      got.status === 200 && deepSame(await got.json(), payloadA));
  }

  // --- app-side M11 seam: store client + save()/load() ----------------------
  {
    const store = Catalog.createCatalogStore({ base, token: TOKEN, userRef: REF_A });
    check("19h: createCatalogStore exposes save/load (send-client conventions)",
      !!store && typeof store.save === "function" && typeof store.load === "function" &&
      store.base === base && store.userRef === REF_A);
    const before = await store.load();
    check("19h: store.load() returns the pieces PUT over HTTP",
      before.ok === true && deepSame(before.pieces, payloadA),
      `ok=${before.ok} err=${before.error}`);
  }
  {
    // Memory-only catalog: unchanged behaviour, honest no_store errors.
    const mem = Catalog.createCatalog({ userKey: "SYNTH_user_019h" });
    check("19h: no store attached -> store is null, memory-only by default",
      mem.store === null);
    mem.addPiece({
      category: "scarf",
      attributes: { color: "opal", silhouette: "neck wrap", layer_role: "finish" },
      source_share_id: "SYNTH_share_mem",
    });
    const s = await mem.save();
    const l = await mem.load();
    check("19h: memory-only save()/load() resolve honest no_store, keep memory",
      s.ok === false && s.error === "no_store" && l.ok === false && l.error === "no_store" &&
      mem.getPieces().length === 1);
  }
  {
    // Store-backed: save() PUTs on update, fresh catalog load() GETs back.
    const store = Catalog.createCatalogStore({ base, token: TOKEN, userRef: REF_B });
    const w1 = Catalog.createCatalog({ userKey: "SYNTH_user_019h_B", store });
    w1.addPiece({
      category: "dress",
      attributes: { color: "sage", silhouette: "wrap midi", layer_role: "base" },
      source_share_id: "SYNTH_share_B1",
    });
    w1.addPiece({
      category: "bag",
      attributes: { color: "tan", silhouette: "tote", layer_role: "finish" },
      source_share_id: "SYNTH_share_B2",
    });
    w1.rejectPiece(w1.getPieces()[1].piece_id);
    const saved = await w1.save();
    check("19h: catalog.save() PUTs current pieces (whole array)",
      saved.ok === true, `ok=${saved.ok} err=${saved.error}`);
    const w2 = Catalog.createCatalog({
      userKey: "SYNTH_user_019h_B",
      store: Catalog.createCatalogStore({ base, token: TOKEN, userRef: REF_B }),
    });
    const loaded = await w2.load();
    check("19h: fresh catalog load() restores pieces incl. statuses",
      loaded.ok === true && loaded.count === 2 &&
      deepSame(w2.getPieces(), w1.getPieces()),
      `ok=${loaded.ok} count=${loaded.count}`);
    const next = w2.addPiece({
      category: "scarf",
      attributes: { color: "opal", silhouette: "neck wrap", layer_role: "finish" },
      source_share_id: "SYNTH_share_B3",
    });
    check("19h: id counter advances past loaded ids (no collision)",
      next.piece_id !== "SYNTH_piece_001" && next.piece_id !== "SYNTH_piece_002" &&
      w2.getPieces().length === 3, `new id=${next.piece_id}`);
  }
  {
    // Corrupt stored array: raw PUT of schema-breaking data, load refuses.
    await putJson(`/ig/catalog/${REF_C}`, [{ bogus: "SYNTH_nope" }], authHeaders());
    const w3 = Catalog.createCatalog({
      userKey: "SYNTH_user_019h_C",
      store: Catalog.createCatalogStore({ base, token: TOKEN, userRef: REF_C }),
    });
    w3.addPiece({
      category: "dress",
      attributes: { color: "sage", silhouette: "wrap midi", layer_role: "base" },
      source_share_id: "SYNTH_share_C1",
    });
    const bad = await w3.load();
    check("19h: load() of schema-breaking stored data fails closed, memory kept",
      bad.ok === false && w3.getPieces().length === 1, `ok=${bad.ok} err=${bad.error}`);
  }

  server.close();
  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  try { server && server.close(); } catch (err2) { /* ignore */ }
  process.exit(1);
});
