# Milestone 20 — persistent Node service (spec, planning only)

Status: **SPEC ONLY 2026-10-29 — nothing built.** This doc creates no code
under `wardrobe-service/`, `app/`, `mock-ig-bot/`, or `meta-api-proxy/`.
Build is delegated to Muse Code only after Autumn resolves the open
questions in §6 and the critical-path ordering in §4.

**Problem (verified today):** nothing processes an incoming Instagram share
into the wardrobe catalog unless a human has the chat page open in a browser
tab with JavaScript actively polling. A real photo + text arrived on the
live bot, was visible via `GET /ig/shares`, but the catalog stayed empty
because no browser tab was running the poll loop (`app/mock-dm.html`
`refreshThread` + `scheduleNextPoll` driven by `app/poll-scheduler.js`
cadence). This milestone specs a persistent server-side loop that closes
that gap.

**New-work boundary (critical):** this service is NEW hackathon-built
app-side code that CALLS the real bot's existing local-only API. It does
not modify `~/secure-webserver/igwebhook` in any way, and it must not
vendor or restate that bot's internal implementation. Same boundary as the
existing `app/inbox-bridge.js` client. The judged path stays mock-only per
`docs/decisions.md` #8(2); anything live is personal-use/stretch.

**Product framing (decisions #7–#8 apply unchanged):** the product is the
persistent per-user wardrobe/catalog; chat is one interface onto it. No
catalog schema work may couple itself to IG-specific fields, and
fabric/price/vendor grounding stays fully descoped — the agent says it
does not have that data rather than inventing a listing.

## 1. Architecture

New standalone Node process, stdlib-only (same convention as
`mock-ig-bot/server.js` and `meta-api-proxy/server.js` — no npm
dependency). Proposed layout:

- `wardrobe-service/server.js` — the service entry: poll loop, pipeline
  driver, lightweight status endpoint, static thin-client serving.
- `wardrobe-service/config.js` — dual-mode base/token resolution (mock
  8904 default; live 8903 when `LIVE_IG=1`, same flag semantics as
  `start.sh`), user key, poll cadence constants. Secrets from the
  process environment only, never written to a browser-readable file.
- Reuse `app/*.js` pure modules in place (required, not re-implemented
  — see §1.2). No forked copies.
- Tests: `wardrobe-service/test/*.test.js`, `node`-runnable, same style
  as `app/test/milestone19*.test.js`.

### 1.1 Loop (server-side, no browser required)

1. Poll `GET /ig/shares?since=<cursor>&limit=<n>` on the configured bot
   (mock `127.0.0.1:8904` for the judged demo; real `127.0.0.1:8903` in
   live mode) using the SAME contract `app/inbox-bridge.js` already
   calls (`buildSharesUrl`/`fetchAllShares` semantics, `isValidShareItem`
   incl. the 19e text shape, `is_echo` skip per the M7 rule).
2. For each new photo share: `GET /ig/media/<id>` → bytes (data URL for
   the proxy) → segment + classify via `meta-api-proxy`
   (`127.0.0.1:8905`, `POST /api/segment`, `POST /api/classify`) →
   `catalog.addPiece({ category, attributes, source_share_id })`.
   For each new text share: `textOf(item)` → `turn-loop` text trigger
   (revise / grounding-gated answer — never an invented listing).
3. `turn-loop` propose (from the FULL catalogued pool, cross-share
   recall) → unchanged `assembleLive` validate → Spark copy via proxy
   `POST /api/copy` (+ `generateCopyFromModel` mapping) → preview via
   proxy `POST /api/preview` (live image path, not the canvas collage).
4. Record the turn in the catalog (`recordTurn`/`recordSentTurn`), persist
   via catalog PUT (see §1.3), and send the reply via `POST /ig/send`
   with a fresh per-turn idempotency key (`confirm:true`,
   `401`/`409`/`422` surfaced, retries as replays — the 19b rules).
5. Media ack: `DELETE /ig/media/<id>` only after bytes are in hand and
   catalogued (the inbox-bridge rule), never before.

Cadence: reuse the §4-designed `poll-scheduler` state machine (5s active
→ 30s after 10 min idle → stop after 30 min idle). `document.hidden`
has no meaning server-side, so the "stop when hidden" arm is dropped and
replaced by: keep polling while the service process lives (that IS the
point — no tab to hide), with the idle backoff arms retained to spare
the bot/proxy. Resume-on-focus becomes resume-on-new-inbound/restart.

### 1.2 Module reuse map (required, not re-implemented)

| Module | Server-side reuse | Verdict |
|---|---|---|
| `app/assembler.js` (`assembleLook`) | Pure function, no DOM/fetch | Reuse as-is via `require` |
| `app/classifier.js` (`classifyRegion`, hint/geometry rules) | Pure, no DOM | Reuse as-is for the offline-fallback path; live path calls proxy `POST /api/classify` directly |
| `app/spark.js` (`generateCopy`, `generateCopyFromModel`) | Pure string/word-budget logic, no DOM | Reuse as-is |
| `app/turn-loop.js` (`createTurnLoop`, `handlePhotoShare`, text triggers) | Already `require`-tolerant (`wardrobe-catalog`, `assembler`, `spark` lazy `require` fallbacks); no DOM | Reuse as-is, with `o.propose`/`o.copy` injected to call the proxy live path |
| `app/wardrobe-catalog.js` (`createCatalog`, `createCatalogStore`) | `require`-able; store uses `root.fetch` (Node 18+ has global `fetch`) | Reuse as-is; pass `store` wired to the PUT/GET catalog contract |
| `app/send-client.js` (`createSendClient`) | `require`-able; uses `root.fetch` | Reuse as-is |
| `app/poll-scheduler.js` (`createPollScheduler`, `checkSendWindow`) | `require`-able, issues no requests itself | Reuse the state machine + window gate; drop the `document.hidden` arm (no DOM server-side) |
| `app/inbox-bridge.js` (pure part: `isValidShareItem`, `textOf`, `buildSharesUrl`, `parseJsonLines`) | Guarded: pure top half is `module.exports`; DOM/fetch wiring below the `document` guard never loads in Node | Reuse the pure contract helpers as-is; do NOT reuse the browser wiring |
| `app/meta-client.js` (proxy client) | Uses bare global `fetch` (fine in Node) + optional `root.localStorage` cache (guarded — degrades to no-cache in Node, never throws) | Reusable with a caveat: file/local cache should be added or caching accepted as best-effort in-memory only |
| `app/preview.js` (`generateImage`) | **Browser-only — CANNOT run in plain Node.** Takes a `<canvas>`, calls `canvas.getContext("2d")`, `new Image()`, `canvas.toDataURL()`. No dependency-free server path. | Do NOT reuse. Server-side preview goes through the proxy `POST /api/preview` (Muse Image live path) and stores the returned image/bytes; the canvas collage stays a browser-only offline fallback |
| `app/app.js` (`loadImage`, segment/tag/assemble button wiring) | Pervasive `document`/`canvas`/`Image` usage | Do NOT reuse. The service replaces this entry point: bytes → proxy → catalog, headless |
| `app/mock-dm.html` thread/poll wiring | DOM page | Do NOT reuse as logic. It becomes (or gains a successor) thin client — see §1.4 |

Photo ingest note: the service never needs canvas/mask polygons in Node.
Segmentation arrives as proxy JSON (`POST /api/segment` with a data URL
built from fetched media bytes); classification maps onto the fixed
taxonomy the same way the browser path does. The only legitimately
browser-only step is the offline preview collage, which the service
simply does not use.

### 1.3 Persistence

Persist via the existing `wardrobe-catalog` PUT/GET contract, not a new
store: `PUT /ig/catalog/<user_ref>` (whole-array replace,
last-write-wins) / `GET /ig/catalog/<user_ref>` (mock 8904 or real
8903's encrypted catalog API), through `createCatalogStore` + injected
`store` + `catalog.save()`/`catalog.load()` exactly as 19h wired it for
the browser. State survives restarts because the catalog lives
bot-side, and what the browser UI reads (`GET /ig/catalog`) is byte for
byte what the service wrote — no second schema, no sync protocol.

### 1.4 Thin client: how the browser learns about processed turns

Three options, with tradeoffs stated plainly:

- **(a) Browser polls a lightweight service status endpoint**
  (e.g. `GET /wardrobe/status` → `{ last_processed_share, pieces,
  last_turn_text, updated_at }`). Simplest; reuses existing poll
  thinking; slightly stale (bounded by the status poll interval);
  trivially debuggable with curl. Recommended default.
- **(b) Long-poll / SSE from the service to the browser.** Fresher
  (push on each processed turn); more moving parts (connection
  lifecycle, reconnect, single-user vs multi-listener semantics) for a
  6-day window. Only if (a)'s staleness visibly hurts the demo.
- **(c) Browser keeps reading `GET /ig/shares` + `GET /ig/catalog`
  directly for display while ONLY the service writes.** Least new code
  (display path unchanged); but two readers poll the bot, ack
  ownership gets confusing (service alone must DELETE-ack — the
  browser must never ack), and the browser still needs read tokens.
  Viable fallback, not the default.

Whichever ships, the browser does no heavy work: no polling loop that
writes, no pipeline, no sends. Display only.

### 1.5 Credential handling (genuine security improvement)

Moving this logic server-side REMOVES the need for `start.sh`'s
`LIVE_IG=1` runtime-config-to-browser pattern for sends, catalog, and
read tokens. The service holds all three tokens in its own process
environment (parsed from `.env/secrets` the way the proxy launcher
already does — never sourced, never printed, never written to disk),
and the browser never receives any of them. The generated
`app/ig-runtime-config.js` path shrinks to (at most) a display-only
status URL or disappears entirely. This is a real reduction in secret
exposure in live mode, not just an architecture preference — and it
should be described that way in the submission if built.

### 1.6 Which bot by default (recommendation)

**Additive only: the judged demo path stays mock-only and exactly
as-is.** The service defaults to the mock bot (8904) with the same
`LIVE_IG=1` opt-in flag pattern as `start.sh` for the real bot (8903).
Nothing about the judged one-shot install+run changes: same three
processes, same fixtures, same video beats. The service is layered on
as a "live personal use" capability (Autumn's machine, real bot,
no browser tab needed), never as a replacement demo path. Rationale:
with 6 days left, any change to the judged path risks the only thing
judges actually score; an additive layer can only be left out if it
slips, never break what already works.

## 2. Scope boundary

Restated explicitly: this service is new hackathon-built app-side code
that CALLS the real bot's existing local-only API. It does not modify
`~/secure-webserver/igwebhook` in any way, and it must not vendor or
restate that bot's internal implementation. Prior-work docs
(`docs/prior-work-instagram.md`) stay accurate: if the bot gains API
surface as prior-work maintenance, that is recorded there as
prior-work, never shown as a meta-styles feature.

## 3. Deadline risk (stated plainly)

M18 (live isolation proof + browser E2E), M16 (judge-ready one-shot
install+run + README), and M4 (submission cut: 3-minute video,
rehearsal, repo-public checks) are still outstanding ahead of this,
against the hard **Nov 4, 9pm ET, no grace period** deadline.
**Building Milestone 20 before those three are closed is a bad idea on
the critical path — do not do it.** Recommendation: spec now (this
doc), then decide build timing ONLY after M18/M16/M4 are either done or
explicitly time-boxed. Do not start this half-built against their
time. And even then, build it ONLY if it clearly strengthens the demo
(a real "it catalogued my share with no tab open" beat on video);
otherwise keep it as specced post-hackathon hardening of a
hackathon-built prototype. A thinner M19 that ships + a closed
critical path beats a persistent service that jeopardizes submission.

## 4. Acceptance criteria (for an eventual build)

Serve-and-curl verification with NO browser open anywhere (a
self-report from the service's own logs is not verification):

1. Start mock bot + proxy + service only (no static server, no browser).
   `POST /mock/incoming-photo` a synthetic photo + `POST
   /mock/incoming-text` a "no bag" revise. Within N poll intervals,
   `GET /ig/catalog/<user_ref>` shows the catalogued piece(s) and
   `GET /ig/shares` shows the assistant's sent turn(s), including the
   revised re-validated look. The two-photo cross-piece mix (share 2
   proposes combining share 1 + share 2 pieces, citing both) works
   headless.
2. Kill and restart the service; `GET /ig/catalog/<user_ref>` returns
   the identical array (restart-survives-catalog-persistence), and the
   service resumes polling from its cursor without re-processing or
   double-sending (idempotency replay, no `duplicate_send` storm).
3. Dual mode: the same flow passes against mock 8904 by default and
   against real 8903 under `LIVE_IG=1` (read/catalog/send tokens from
   process env; browser receives none — assert no token material in
   any browser-served file or status response).
4. Existing suites stay green unmodified: all `app/test/milestone19*`
   suites (19c catalog, 19d turn loop, 19e text-turn, 19f
   polling/window), the M13 parity suites, and M14 proxy tests.
5. New coverage required: service lifecycle (start → process → stop),
   restart-survives-catalog-persistence, dual mock/live mode selection,
   no-token-leak-to-browser assertion, idle backoff without
   `document.hidden`, and the serve-and-curl end-to-end above as a
   committed `node` test (same style as the 19f suite: fake clock
   where timing matters, live localhost servers where the contract
   matters; `SYNTH_` ids only, never real DM data).

## 5. Suggested build order (only once §3's gate opens)

1. `wardrobe-service/server.js` skeleton: config + poll loop against
   the mock bot calling only `inbox-bridge` pure helpers (no pipeline
   yet) + status endpoint. Verify: shares drain headless, cursor
   advances, status endpoint reflects it.
2. Wire catalog + turn-loop + send (19c/19d/19b requires) with the
   offline fallbacks first (heuristic classify, stub copy). Verify:
   headless photo → catalogued piece → sent turn, text revise works.
3. Wire the proxy live path (`/api/segment` → `/api/classify` →
   `/api/copy` → `/api/preview`) behind the same entries, keeping
   labelled fallbacks. Verify: `placeholder:false` end-to-end with the
   key present; labelled fallback with it absent.
4. Persistence + restart test + dual-mode flag + no-token-leak
   assertion. Verify: §4 items 2–3.
5. Thin client (option (a) default): status-poll display in
   `app/mock-dm.html` or a successor page; browser polling that writes
   anything is removed or gated off when the service owns the loop.
   Verify: no double-processing and no double-sends with both running.

## 6. Open questions for Autumn (listed, not resolved here)

1. Does this REPLACE the browser polling entirely or run alongside it
   (with ack/send ownership rules so they never double-process)?
2. Should the judged demo ever use this service, or stay client-only
   (recommendation in §1.6 is client-only judges + additive service)?
3. Is this in scope for the hackathon submission at all, or better
   framed as post-hackathon hardening of a hackathon-built prototype
   (recommendation in §3 is the latter until M18/M16/M4 close)?
4. Single-user assumption: keep the injected constant user key (§8.9
   option (a)) for the service too, or does headless operation force
   the opaque per-sender ref (option (b)) sooner?
5. Status endpoint shape: minimal status poll (a), SSE (b), or
   direct-read display (c) — and does the thin client replace
   `app/mock-dm.html` or extend it?
6. Live-mode credential source: `.env/secrets` parse in the service
   launcher (proxy pattern), or a separate service env file?
