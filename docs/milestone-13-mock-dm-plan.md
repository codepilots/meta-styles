# Milestone 13 — mock Instagram-DM chat + mock bot server (standalone demo path, zero Instagram dependency)

Status: **plan only (2026-10-28)** — nothing here is built yet. This doc is the
build plan; implementation is a future TDD-style pass following the task
breakdown in §7.

**New-work boundary:** everything in this milestone — the mock server, the chat
UI page, and any seeded demo content — is **genuinely new hackathon work built
inside this repo during the building period (Oct 27 – Nov 4, 2026)**. It never
touches real Instagram, Meta's Graph API, the SecondBloom `igwebhook`
deployment, or any prior-work code or data. Unlike Milestones 5–9/12, which
carry a prior-work boundary (see `docs/prior-work-instagram.md`), this
milestone has no prior-work-adjacent content at all: it is 100% synthetic and
offline. Nothing here may be presented as anything other than a demo harness,
and nothing here replaces or re-presents the real Instagram integration.

**Contract sources (read in full before building):**
`docs/instagram-bot-api.md` (read API — routes, cursor, item shape,
`media_available`, auth, CORS, status codes — including the "As implemented"
section describing the bot as actually built and now live),
`docs/instagram-bot-send-api.md` (send API — `POST /ig/send` shape,
`confirm` gate, idempotency rules, 24h window, outbound-media token route —
including the "As implemented"/"Applied" sections), and
`app/inbox-bridge.js` (the client that must work unchanged — `BOT_BASE` at
line 45, `TOKEN_URL`, token handling, paging, collect-then-delete).

## 1. Direction / rationale

The original M13 wording ("harden the existing fixture fallback") keeps two
separate client code paths: a live-bot path and a fixture path that only runs
when the bot is unreachable. A fallback path that judges never exercise on
Autumn's machine and that developers never exercise against the live bot can
silently rot — a fixture file can drift out of shape, the fallback renderer
can break, and nobody notices until the demo that depends on it.

This plan replaces that with a **same-API mock**: a tiny local server that
implements the exact API contract of the real `igwebhook` bot (same routes,
same request/response shapes, same status codes, same auth-header and CORS
behavior), driven live by a mock Instagram-DM chat UI. `app/inbox-bridge.js`
points at the mock by changing **only** its `BOT_BASE` constant (currently
`http://127.0.0.1:8903`, line 45) — no branching, no `isMock` flag, no second
renderer. The exact same client code path (paging, media fetch,
collect-then-delete, error handling) runs against both backends, so a green
demo against the mock proves the client logic itself, not a parallel
implementation of it.

How this serves the judging criteria:

- **Demo (25%).** Judges assess the video, the code, *and the live product* —
  the app must actually run live, not just look good on video (compliance
  skill §"Submission package"). The real Instagram chain is deliberately
  local-only (both API specs: no nginx route, port bound to 127.0.0.1), so it
  can never answer for a judge's browser. The mock-backed demo runs anywhere
  with zero network dependencies, and it is visual and interactive — a live
  chat thread on screen where shares arrive and sends appear — rather than a
  flat fixture list. That is a materially better 3-minute-video subject and a
  live product that actually works when opened.
- **Technical depth & execution (20%).** A contract-faithful mock with a
  host-block verification (see §5) is sound, refined engineering — the kind of
  thing that reads as craft, not scaffolding — provided the demo framing stays
  on full-look assembly + fit rules + resale-grounded copy (avoid-list
  discipline per `AGENTS.md` rule 4), not on the chat harness in isolation.

## 2. Chat UI design

**Recommendation: a new page, `app/mock-dm.html`, sitting alongside the
existing inbox panel — not replacing it.** Rationale:

- The existing inbox panel in `index.html` (`#inboxPanel`, fed by
  `app/inbox-bridge.js`) is the **demo under test**: it must stay byte-identical
  regardless of backend so the "same client code path" claim holds. Reworking
  its UI for chat duty would entangle the thing being proven with the harness
  proving it.
- A separate page keeps the operator harness (chat thread, seed controls,
  send-as-app panel) out of the judged product surface. The judged flow stays:
  open `index.html`, import from inbox, assemble a look card.
- Cost is low: the chat page is throwaway demo chrome (plain HTML/CSS matching
  `styles.css` conventions), while all contract-critical behavior lives in the
  mock server, which is fully testable without the page.

What the judge sees (under-a-minute click-through):

1. `app/mock-dm.html` open in one window: an Instagram-DM-styled thread —
   incoming bubbles on one side (shares "from the user"), outgoing bubbles on
   the other (sends "from the app"). Autumn plays both sides.
2. Autumn drags/drops (or picks) a photo into the chat box and hits share:
   the photo lands in the mock's data as if a real webhook event had arrived,
   and appears as a new incoming bubble. In the other window, `index.html`'s
   inbox (pointed at the mock) now lists the new share; "Use this photo"
   loads it into the viewer and the collect-then-delete acknowledgement fires
   (the mock's `media_available` flips to `false`, matching the real bot).
3. Autumn clicks "Send share card as app" (operator panel): the page issues a
   byte-identical `POST /ig/send` (same JSON shape the future M12 client will
   send, including `"confirm": true`), and the text appears as an outgoing
   bubble in the thread — fed by the mock's own send handler, proving the
   send path end to end.
4. Optional beat: a pre-seeded stale share (older than 24h) demonstrates the
   `422 reply_window_expired` path honestly, and a re-send demonstrates the
   `409 duplicate_send` guard.

The chat page talks to two kinds of mock endpoint: the **replicated contract
routes** (identical to the real bot, shared with `inbox-bridge.js`) for reads
and sends, and clearly-namespaced **operator-only routes** (`/mock/...`,
documented in §3 as *not* part of the replicated contract) for injecting
inbound events and reading the outbound log. Operator routes must never be
called from `inbox-bridge.js` or any judged surface.

## 3. Mock server design

**Tech choice: plain Node `http` module, zero dependencies, as a second tiny
process alongside the existing `python3 -m http.server` static server.**
Justification against the project's zero-build-step, zero-dependency ethos
(`app/README.md`): both candidate stdlibs qualify, but Node fits this repo's
existing conventions better — the repo's own tests already run under Node
(`node app/test/milestone6-pipeline-wiring.test.js`), so Node is already a
de-facto dev requirement while Python is only used as a static file server.
One language (JS) for client + mock also lets the mock share the pure
validation helpers' *logic* (shape checks mirroring `isValidShareItem`) and
keeps the whole demo runnable with two commands and no installs. Default port
**`8904`** (one digit off the real bot's `8903`, avoiding clashes when both
run on Autumn's machine for side-by-side comparison).

Suggested layout (new files only, all hackathon-built):

- `mock-ig-bot/server.js` — the mock server (single file, stdlib only).
- `mock-ig-bot/seed.json` — canned demo conversation loaded on start so the
  chat is never empty on first view (synthetic ids, `SYNTH_…` convention per
  the send-API spec; placeholder images generated locally, never real DMs).
- `app/mock-dm.html` (+ minimal inline/CSS reuse from `styles.css`) — the chat
  UI from §2.

**State/storage: in-memory, reseeded from `seed.json` on every start.**
Justification: this is a demo harness, not infrastructure — restart-to-clean
is a feature (every demo starts from the same known conversation), there is
no cross-host persistence need, and it removes an entire class of file-format
drift between mock and real bot. The seed file is the only durable artifact,
and it is checked in as synthetic demo content.

**Route-by-route behavior (mirror the real specs exactly — shapes below are
reminders, the two spec docs are authoritative):**

- `GET /ig/shares?since=&limit=` → `200 {"items", "next_cursor"}`. Cursor is
  the opaque decimal-string line offset, first call omits `since`, `limit`
  defaults 20 / max 50, empty → `200 {"items": []}`. Item shape: `id`,
  `received_at` (ISO-8601 UTC), `attachment` (exactly the `ig_post` or
  `image` shapes — no author/permalink fields), `media_id`,
  `media_available` bool. Malformed `since`/`limit` → `400`.
- `GET /ig/media/<id>` → `200` image bytes with sniffed `Content-Type`;
  `404` if absent (including after collect-then-delete). `Cache-Control`
  mirrors the real bot (`private, no-store`); JSON routes send `no-store`.
- `DELETE /ig/media/<id>` → `204`, deletes the bytes, flips the item's
  `media_available` to `false`; unknown id → `404`. Nothing is deleted on GET.
- `POST /ig/send` → full replication of the implemented (not just proposed)
  contract: required `share_id`/`text`/`idempotency_key`/`confirm:true`
  (missing or non-`true` confirm → `400`, nothing sent); optional
  `"image": true|false` (default `false`), with the image bytes staged via
  the operator route below (missing file → `400`); unknown `share_id` →
  `404`; body > 1 MB → `413`. **24h window** checked from the share's own
  timestamp → `422 {"error": "reply_window_expired", "share_id"}`. **Idempotency
  store** (in-memory, pruned to 24h on access): same key + same payload
  replays the stored result; same key + different payload →
  `409 {"error": "idempotency_key_reused"}`; same `share_id` + same
  whitespace-normalised text with a different key →
  `409 {"error": "duplicate_send"}`. Success → `200 {"message_id",
  "recipient_ref"}` (+ `"image_message_id"` when an image was sent), and the
  sent text is appended to the mock's outbound log so the chat UI renders it
  as an outgoing bubble. Outbound sends are serialised (no double-click race).
  Since there is no real Graph backend, the mock records sends locally instead
  of calling Graph — the `502 graph_*` family therefore never fires from the
  mock (document this divergence; an operator toggle to force `429`/`502`
  responses for client error-path demonstrations is optional, not required).
- `GET /ig/outbound-media/<token>` → single-use token image serving for the
  image-send path. The token is opaque to the client; the mock mints its own
  format (documented as mock-local) with the same semantics: 24h TTL,
  single-use (second fetch → same bare `404` as the real bot), no
  `Authorization` header. The fail2ban/IP-blocking hardening of the real bot
  is **explicitly out of scope** — it is host security infrastructure, not API
  contract, and a local demo server must not touch firewall rules.
- **Auth headers:** `Authorization: Bearer <token>` required on every route
  except the outbound-media token URL; missing/wrong → `401` with the same
  `WWW-Authenticate: Bearer [REDACTED]"ig"` challenge the real bot sends. The mock
  compares against a configured `MOCK_TOKEN` (documented non-secret demo
  value, e.g. supplied via argv/env with a checked-in default) — never the
  real `ig-bot-token`, which must not appear anywhere in this harness. The
  401 path is thereby exercisable (wrong token in the UI → identical "check
  bot credential" status), which is part of proving behavioral sameness.
- **CORS:** same single-origin policy as the real bot (configurable allow
  origin, default `http://localhost:8000`); preflight `204`, other origins
  `403`, preflight on `/ig/send` allows `POST` with
  `Authorization, Content-Type`, and preflight allows `DELETE`.
- **Error-shape parity:** every status code above must match the real bot's
  code *and* JSON error body key-for-key (`reply_window_expired`,
  `duplicate_send`, `idempotency_key_reused`, `rate_limited`), so client
  error-handling branches trigger identically.

**Operator-only routes (mock-local, `/mock/...` namespace — never part of the
replicated contract, never called by `inbox-bridge.js`):**

- `POST /mock/incoming-text {text}` — inject an inbound text event (appears
  as an incoming bubble; advances the shares cursor).
- `POST /mock/incoming-photo` (multipart or raw bytes + caption fields) —
  inject an inbound photo share: stores bytes, mints `media_id`, sets
  `media_available: true` (mirrors the real bot's completed background
  download; a `?pending=1` variant may stage `media_available: false` to demo
  the not-yet-ready UI state).
- `POST /mock/stage-outbound-image/<share_id>` (raw bytes) — stages the image
  file the mock's `POST /ig/send {"image": true}` path reads, mirroring the
  real bot's `data/outbound/<share_id>.jpg` convention in memory.
- `GET /mock/outbound` — the outbound log feeding the chat UI's outgoing
  bubbles (the real bot needs no such route; this is display plumbing for the
  harness only).
- `GET /mock/state` (optional, debug) — cursor position, idempotency keys
  held, burned tokens; handy for the verification pass in §5.

Chat-UI → mock-state mapping: typing + share = `POST /mock/incoming-text` or
`/mock/incoming-photo` → new item appended to the shares list (cursor
advances, `GET /ig/shares` reflects it on next poll); "use photo" in
`index.html` = real `GET /ig/media` + real `DELETE /ig/media` against the
mock; "send as app" = real `POST /ig/send` → outbound log → outgoing bubble
via `GET /mock/outbound`. Every arrow crossing the client↔server boundary
uses the replicated contract; only harness chrome uses `/mock/...`.

## 4. Swap mechanism

**Recommendation: the one-line `BOT_BASE` edit stays the primary, documented
swap; add an optional `?bot=` query-param override read once at load as a
judge convenience.** Tradeoffs:

| Option | How | Pros | Cons |
|---|---|---|---|
| One-line `BOT_BASE` edit (primary) | Change line 45 to `http://127.0.0.1:8904` | Zero client branching — the strongest form of the "same code path" claim; trivially reviewable in a diff | Requires an edit + reload; two annual states of one line |
| `?bot=` query override (convenience) | `index.html?bot=http://127.0.0.1:8904`, read once at startup, defaults to `BOT_BASE` | Judges/Autumn flip backends without editing; bookmarkable demo link | Adds (small, additive) client code; must be carefully behavior-neutral — same fetch path, only the base string differs |
| UI toggle button | A switch in the inbox panel | Discoverable | Most client code, most risk of backend-specific branching creeping in; rejected |

Rules for whichever is built: the override may only supply the base-URL
string — no per-backend headers, shapes, or renderers. `TOKEN_URL`/token
handling is unchanged (Autumn drops a mock-token file or uses the existing
"Set bot token" button; the mock validates it per §3). The demo's default
state must be decided once (recommend: default to the mock in any checked-in
demo link, real bot only on Autumn's machine) and written down so the video
and the live product agree.

## 5. Verification plan for the "zero Instagram dependency" claim

The claim is: *the full demo runs end to end with no network route to
Instagram, Meta's Graph API, or the real bot's host — and nothing in the
mock-backed flow references, waits on, or degrades without them.* Procedure:

1. **Isolate.** Stop the real `igwebhook` container/bot process. Then make the
   real hosts literally unreachable: add `127.0.0.1 www.codepilots.co.uk` (and
   `graph.instagram.com` for completeness) to `/etc/hosts`, or equivalent
   firewall rule, during the test. Start only the mock (`node
   mock-ig-bot/server.js`, default port 8904) and the static server (`python3
   -m http.server 8000` from `app/`).
2. **Contract sweep.** For each replicated route, issue the real-spec request
   shapes (good + error cases: bad cursor, unknown media id, `DELETE` before
   `GET`, unconfirmed send, duplicate send, stale-share send → `422`) against
   the mock and diff status codes + body shapes against the spec docs'
   "As implemented" sections. Every code must match; record any deliberate
   divergence (the known `502`-never-fires item from §3) in the plan doc.
3. **Client-parity walk.** With `BOT_BASE` pointed at the mock: open
   `index.html`, import from the inbox, use a photo (confirm the mock logs
   the `DELETE` and flips `media_available`), assemble a look card through to
   the share card. Repeat the identical walk with `BOT_BASE` at the real bot
   (bot running, isolation lifted). The client-visible behavior must be
   identical except data content; capture both runs' console logs.
4. **Chat-driven end-to-end (the visual proof).** With isolation still on:
   share a photo from `mock-dm.html`, watch it appear in `index.html`'s
   inbox, load it into the pipeline, send-as-app from the operator panel,
   watch the outgoing bubble land. Screenshot/record each step for the demo
   video.
5. **Negative checks (the actual "zero dependency" evidence).** During step 4,
   with the hosts block in place: assert no console errors, no failed fetches
   to any `codepilots.co.uk` / `graph.instagram.com` / `lookaside.fbsbx.com`
   URL (Network tab filtered on those hosts must be empty), no "bot
   unavailable" status text in the primary demo flow, and nothing visibly
   waiting on a timeout (all mock responses local — sub-millisecond; any
   multi-second stall is a leaked external dependency and fails the test).
   `grep -r` the mock + chat-page sources for `codepilots`, `graph.instagram`,
   `lookaside`, and `8903` — all must be absent (except in comments explicitly
   naming what is *not* contacted).
6. **Restore.** Remove the hosts block, restart the real bot, re-run the
   client walk against the real backend to confirm the swap-back is clean.

Pass bar: steps 2–5 all green in one session, recorded (console logs +
network-tab capture noted in the verification notes), before M13 is called
done. If anything in the primary flow shows fallback/bot-unavailable noise
under isolation, that is a bug in scope to fix — the mock path must read as
first-class, not degraded.

## 6. Scope boundaries

- **Not** replacing Milestones 5–9/12's real Instagram integration, which
  stays as-is for when the bot's own machine runs the demo. The mock is an
  **additional always-works path**, not a removal of the real one. Both
  backends remain supported; §4's swap is the only coupling.
- **Not** a send-client module: the operator "send as app" panel issues raw
  `POST /ig/send` requests in the spec's shape, but the real M12 client
  module in `app/` (confirmation UI, error surfacing) is still a separate
  future milestone and is not built here.
- **Not** Meta-model work: per the roadmap scope note, the pass/fail gate
  requires real Meta Model API calls (Spark/Image/SAM) — those stay live
  network dependencies and are explicitly **not** isolated by this milestone.
  The "zero dependency" claim covers Instagram/igwebhook only.
- **Not** host hardening: fail2ban, nginx, TLS, and IP-blocking from the send
  spec are real-bot infrastructure and are not replicated in the mock.
- **Not** data migration: no real DM content, media, tokens, or secrets enter
  this harness. Seed content is synthetic (`SYNTH_…` ids, locally made
  placeholder images); the mock's demo token is a non-secret documented
  value, never the real `ig-bot-token` (which lives only in `.env/secrets`
  and the untracked local token file, per `docs/decisions.md` §Secrets).

## 7. Task breakdown

Granularity note: no shell is available in this planning session, so the
Milestone 9 commit history could not be re-read to copy its exact task sizes;
the breakdown below instead matches the repo's established verification
style — small pure-helper modules with `node`-runnable self-tests in
`app/test/`, e.g. `app/test/milestone6-pipeline-wiring.test.js` (`node
app/test/<name>.test.js`), plus manual browser walks. Each task is
independently verifiable and lands in dependency order.

1. **Seed content + placeholder images.** Write `mock-ig-bot/seed.json`
   (3–4 synthetic shares covering `ig_post` + `image` shapes, one with
   `media_available: false`, one older than 24h for the `422` demo) and 2–3
   locally generated placeholder images. Verify: JSON parses, every entry
   passes the same shape rules as `isValidShareItem`, ids all `SYNTH_…`.
2. **Mock shares + media routes.** Implement `GET /ig/shares` (cursor paging,
   `limit` validation/defaults) and `GET /ig/media/<id>` (bytes,
   `Content-Type`, `404`, cache headers) over the in-memory store seeded
   from `seed.json`. Verify: `node`-driven HTTP assertions for paging walk,
   empty page, `400` on bad `limit`, `404` on unknown media.
3. **Mock auth + CORS parity.** Bearer-token check (configurable `MOCK_TOKEN`)
   with identical `401` + `WWW-Authenticate` challenge; single-origin CORS
   with `204` preflight / `403` otherwise, `DELETE`-allowing preflight.
   Verify: unauthenticated, wrong-token, and cross-origin requests get the
   spec's exact codes; correct token passes.
4. **Mock collect-then-delete.** `DELETE /ig/media/<id>` → `204`, bytes gone,
   `media_available` flips, `GET` now `404`s; unknown id → `404`; `GET` alone
   deletes nothing. Verify: full collect lifecycle per media id.
5. **Mock send route.** `POST /ig/send` with the full implemented rule set
   from the send spec's "As implemented" section (confirm gate, `404`, `400`,
   `400` image-missing, `413`, `422` window check, idempotency trio
   replay/`idempotency_key_reused`/`duplicate_send`, serialised sends,
   `200` shape + `image_message_id`, outbound-log append). Verify: one
   assertion per rule — this is the largest test batch and may land as two
   commits (validation rules, then idempotency/window).
6. **Mock outbound-media token route.** Mint-on-send single-use tokens, 24h
   TTL, bare-`404` refusals, burn-on-first-fetch. Verify: fetch-once-then-404,
   expired-token 404, no-auth-header-required.
7. **Mock operator routes.** `/mock/incoming-text`, `/mock/incoming-photo`
   (incl. `?pending=1`), `/mock/stage-outbound-image/<share_id>`,
   `/mock/outbound`, (optional) `/mock/state`. Verify: each injection is
   visible through the corresponding contract route; operator routes are
   absent from every client-called path (grep).
8. **Chat UI page.** Build `app/mock-dm.html`: thread view (incoming/outgoing
   bubbles via contract reads + `/mock/outbound`), text box, drag/drop-or-pick
   photo share, send-as-app operator panel (byte-identical `POST /ig/send`
   incl. `confirm:true`), stale-share + duplicate-send demo affordances.
   Verify: manual click-through of the §2 four-beat flow against the mock.
9. **Swap wiring.** One-line `BOT_BASE` retarget + optional `?bot=` override
   (behavior-neutral per §4 rules) and a documented default-backend decision.
   Verify: identical inbox behavior against mock vs real bot (side-by-side
   walk per §5 step 3); override supplies only the base string (code review).
10. **Contract-parity sweep.** Diff every mock route's codes + body shapes
    against the two specs' "As implemented" sections (good + error cases).
    Verify: written checklist with per-route pass marks; known divergences
    (no `502` family, mock-local token format, no fail2ban) recorded in §3.
11. **Zero-dependency isolation test.** Run §5 steps 1–6 verbatim (hosts
    block, console + network-tab capture, forbidden-host grep). Verify: the
    §5 pass bar, recorded in verification notes.
12. **Docs close-out.** Update this plan's Status line to built/verifying,
    refresh the M13 roadmap entry, note the default-backend decision and the
    demo URL (`?bot=` link if adopted) for the video script. Verify: roadmap
    + plan agree, no secret or real-bot credential appears in any new file
    (key/token grep clean).

## 8. Open questions for Autumn

1. **Default backend for the checked-in demo:** should `index.html` (and the
   demo-video link) default to the mock so the live product always works for
   judges, with the real bot only on your machine — or default to the real
   bot with the mock as the documented fallback link? (Recommendation in §4
   is mock-default; your call before task 9.)
2. **Replace or alongside:** §2 recommends `app/mock-dm.html` as a separate
   page leaving the inbox panel untouched. If you would rather the chat thread
   *replace* the inbox panel inside `index.html`, say so — it changes tasks
   8–9 materially, so this needs settling before implementation starts.
3. **Seeded conversation on load:** should the mock auto-load a canned demo
   thread (a half-finished styling conversation, e.g. two shares + one prior
   app reply) so the chat is lively on first view — or start empty/minimal so
   every bubble on screen is something you created live during the demo?
   (Plan assumes a small seeded thread per task 1; easy to trim.)
4. **Swap mechanism:** is the optional `?bot=` query override welcome
   convenience or unwanted extra surface — is the one-line `BOT_BASE` edit
   alone enough for how you will actually run the demo and record the video?
5. **Scope confirmation:** this milestone builds no M12 send-client module and
   replicates no fail2ban/nginx hardening (see §6). Confirm that matches your
   expectation, or flag anything in §6 you want pulled into scope now rather
   than discovered mid-build.

## Cross-references

- Milestones: `docs/roadmap.md` (Milestone 13 entry).
- Contracts mocked here: `docs/instagram-bot-api.md`, `docs/instagram-bot-send-api.md`.
- Client proven unchanged: `app/inbox-bridge.js` (`BOT_BASE` line 45).
- Prior-work boundary (untouched by this milestone): `docs/prior-work-instagram.md`.
- Build/reuse split per milestone: `docs/instagram-integration-plan.md`.
- Compliance: `skills/meta-hackathon-compliance/SKILL.md`, `AGENTS.md`.
