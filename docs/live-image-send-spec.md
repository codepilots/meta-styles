# Live Instagram image send — precise spec (investigation only)

Status: **SPEC/INVESTIGATION ONLY — no code changed.** Task scope forbade
writing application code and touching `wardrobe-service/server.js`,
`app/skills/*`, and any `.js` under `app/` or `wardrobe-service/`.
This doc is the single new file the task produced.

Scope: what it takes to make **LIVE** image sending work end-to-end —
the real `igwebhook` bot at `127.0.0.1:8903` plus the real Meta
Instagram Graph API behind it. **Not** mock mode: the mock
(`mock-ig-bot/server.js` on `127.0.0.1:8904`, staged in commit `c8c47fc`)
already does full image delivery and is used below only as the
comparison baseline.

Method note: shell execution was disabled for this session, so the
`docker inspect igwebhook` / `docker exec igwebhook find /app` checks
the task suggested could **not** be run. The real bot's source location
below is therefore taken from this repo's own docs
(`~/secure-webserver/igwebhook/app.py`), not from a live container
inspection. Every repo claim cites `file:line`. Every external Meta
API claim is labeled **general knowledge — verify against Meta's
current published developer docs**. No secret *values* were read or
quoted anywhere; only key *names* from code and docs. `.env/secrets`
and `secrets.env` contents were never opened.

## 1. What the real bot supports for OUTBOUND images today

Real-bot source location (repo-reported, not live-verified this
session):

- `docs/prior-work-instagram.md:21` names the service as
  `~/secure-webserver/igwebhook/app.py`, a "stdlib-only Python HTTP
  receiver" run as a Docker container (`python:3.13-alpine`) behind
  nginx at `https://www.codepilots.co.uk/ig/webhook`.
- `docs/instagram-bot-send-api.md:93` restates the source of truth as
  `~/secure-webserver/igwebhook/app.py` ("prior-work service, not in
  this repo; 89 unit tests there, Graph always stubbed").
- `skills/meta-instagram-integration/SKILL.md:33-37` places the same
  container in `~/secure-webserver`, with the verify token and app
  secret in `~/secure-webserver/igwebhook/secrets.env` (mode 600),
  raw events in `igwebhook/data/events.jsonl`, and the read API at
  `http://127.0.0.1:8903`.
- No `igwebhook/` or `webhook/` source directory exists inside this
  repo; the bot is documented everywhere as out-of-repo prior work
  (e.g. `mock-ig-bot/server.js:6`, `docs/instagram-bot-send-api.md:5`).

What the real bot implements for outbound image sends (per this repo's
"As implemented" record, since the bot code itself lives outside the
repo):

- `POST /ig/send` exists on the real bot, local-only at
  `http://127.0.0.1:8903`; "no nginx route, port bound to 127.0.0.1,
  and requests carrying proxy headers … get `404`"
  (`docs/instagram-bot-send-api.md:95`).
- The request shape adds `"image": true|false` (optional, default
  `false`) to the draft contract:
  `{"share_id", "text", "idempotency_key", "confirm": true, "image"}`
  with "`text` is required even with an image"
  (`docs/instagram-bot-send-api.md:97`).
- Image convention: "with `"image": true` the bot sends the file
  `data/outbound/<share_id>.jpg` on the bot host. The future client
  module must put it there first (how it gets there is that
  milestone's design question); missing file → `400`"
  (`docs/instagram-bot-send-api.md:98`).
- Text + image is **two Graph messages**, not one: "Graph takes `text`
  *or* an `attachment` per message. The text goes first; then an
  `attachment` of `type: image` with
  `payload.url = IG_PUBLIC_BASE_URL/ig/outbound-media/<token>`"
  (`docs/instagram-bot-send-api.md:99`). Success returns
  `200 {"message_id", "recipient_ref": "<share_id>"}` plus
  `"image_message_id"` when an image went out; a text-ok/image-failed
  split returns
  `502 {"error": "image_send_failed", "message_id", "recipient_ref"}`,
  "recorded under the idempotency key so a retry never re-sends the
  text" (`docs/instagram-bot-send-api.md:99`).
- The public fetch route exists in the bot's code:
  `GET /ig/outbound-media/<token>` where the token is
  "`base64url(share_id).<expiry>.<hex HMAC-SHA256(IG_APP_SECRET,
  "ig-outbound-media:<share_id>:<expiry>")>`, 24h TTL, single use …,
  no `Authorization` header" (`docs/instagram-bot-send-api.md:106`).
  "Every refusal is the same bare `404`" with the reason only in the
  server log (`IGWEBHOOK_OUTBOUND_PROBE …`), and the route is verified
  live: "verified with a real minted token served once over the actual
  public Cloudflare route (200, then 404 on reuse)" while
  "`/ig/shares`, `/ig/media`, `/ig/send` stayed 404 publicly"
  (`docs/instagram-bot-send-api.md:106-110`). The fail2ban jail that
  guards it is likewise "installed … reloaded, and the Cloudflare
  blocking chain genuinely verified live" including a found-and-fixed
  `cftoken` forwarding bug (`docs/instagram-bot-send-api.md:108-110`).

The critical live-vs-mock gap — there is **no staging route** on the
real bot:

- "Live mode stays text-only because the real bot has no staging route
  (its `image:true` path needs the file pre-placed on the bot host,
  which no client route provides) and its Graph send credential is
  still a placeholder" (`wardrobe-service/server.js:24-27`).
- "Image staging is mock-mode only: the mock bot stages preview bytes
  via `POST /mock/stage-outbound-image`, while the real bot has no
  staging route (its `image:true` path needs the file pre-placed on
  the bot host). Live mode therefore gets no `stageImage` and stays
  honestly text-only" (`wardrobe-service/server.js:362-367`).
- `app/send-client.js:199-254` documents the same asymmetry on the
  `stageOutboundImage` helper: "MOCK-ONLY: the real bot has no staging
  route … so against a live base this 404s and resolves `{ok:false}` —
  the caller then falls back to an honest text-only send, never a fake
  claim."

Mock baseline for comparison (working per commit `c8c47fc`):

- `POST /mock/stage-outbound-image/<share_id>` takes raw bytes and
  stores them in-memory keyed by share: 404 on unknown share, 413 when
  too large, else `200 {share_id, content_type}`
  (`mock-ig-bot/server.js:560-576`).
- `POST /ig/send` then requires a staged entry when `image === true`:
  `if (image === true && !store.outboundStaged.has(share_id)) return
  { status: 400, body: { error: "image_not_staged" } }`
  (`mock-ig-bot/server.js:247-248`); the image leg mints a mock-local
  single-use token `SYNTH_outbound_NNN` (24h TTL, same-window semantics,
  different format from the real HMAC token) and returns both
  `message_id` and `image_message_id` (`mock-ig-bot/server.js:267-292`,
  divergence noted at `mock-ig-bot/server.js:23-28`).
- The mock serves the staged bytes at
  `GET /ig/outbound-media/<token>`, single-use burn, bare-404 refusals
  (`mock-ig-bot/server.js:446-464`); the client stages-then-sends via
  `stageOutboundImage` + `sendTurn({withImage: true})` with the same
  five-key payload shape `{share_id, text, idempotency_key, confirm,
  image}` (`app/send-client.js:67-77,158-172,209-254`).
- Net: mock image delivery is one HTTP `POST` (stage) + one `POST
  /ig/send`; live image delivery today has only the second half — the
  file must already exist at `data/outbound/<share_id>.jpg` on the bot
  host, and **no client-reachable route in this repo can put it
  there**.

## 2. Credential(s): present vs. placeholder vs. absent (key names only)

No secret values were read. What follows is key-name state reconstructed
from this repo's code and docs; live container env was not inspected
(shell disabled), so the "is it set on the running bot" column is the
repo's own last-reported state, flagged where it needs a host check.

Bot-side env (names from `docs/instagram-bot-send-api.md:96`, plus the
read-API doc):

- `IG_API_SEND_TOKEN` — **present by design.** The send-scoped bearer
  for `POST /ig/send` ("the spec's `ig-bot-send-token`; the read token
  is refused here and vice versa"). Missing/unset → `503`
  (`docs/instagram-bot-send-api.md:96,103`).
- `IG_GRAPH_SEND_TOKEN` — **placeholder, the headline blocker.** "The
  Graph access token the bot sends with (the bot had never sent before,
  so this is new; currently a random placeholder with no Meta
  credential behind it — sends return `502` until it is replaced)"
  (`docs/instagram-bot-send-api.md:96`). Confirmed again: "Still open:
  `IG_GRAPH_SEND_TOKEN` is a random placeholder with no real Meta
  credential behind it — any actual send attempt still `502`s until
  Autumn provisions a real Instagram Graph access token and recreates
  the `igwebhook` container" (`docs/instagram-bot-send-api.md:110`).
  `docs/roadmap.md:108-110` repeats both blockers: "(a) no client
  module exists … (b) `IG_GRAPH_SEND_TOKEN` on the bot is a placeholder
  … so real sends still `502`."
- `IG_PUBLIC_BASE_URL=https://www.codepilots.co.uk` — **present**
  ("origin Meta fetches outbound images from")
  (`docs/instagram-bot-send-api.md:96`); required for image sends
  (missing → `503` for images, `docs/instagram-bot-send-api.md:103`).
- `IG_APP_SECRET` — **present, reused.** The outbound-media token HMAC
  "reuses the existing `IG_APP_SECRET` (resolved question 8)" — no
  separate token secret was minted (`docs/instagram-bot-send-api.md:96`
  and resolved question 8 at `docs/instagram-bot-send-api.md:84`).
- Read/catalog siblings for context: `IG_API_TOKEN` (read bearer;
  meta-styles copy is `ig-bot-token`), `IG_API_STORAGE_TOKEN`
  (catalog bearer), `IG_API_ALLOW_ORIGIN` (CORS origin), and
  `IG_USER_REF_SECRET` (backs the opaque `user_ref` HMAC when set,
  else `user_ref` is `null`) — see `docs/instagram-bot-api.md:111,126,130`
  and `docs/instagram-bot-api.md:125`, plus
  `skills/meta-instagram-integration/SKILL.md:37`.
- Client-side env plumbing (names only, values never read):
  `start.sh:131-134` picks `read_tok` from
  `ig-bot-token | ig_api_token | IG_API_TOKEN`, `storage_tok` from
  `ig-storage-token | ig_storage_token | ig-store-token |
  IG_API_STORAGE_TOKEN | ig_catalog_token`, and `send_tok` from
  `ig-send-token | ig_send_token | IG_API_SEND_TOKEN`, falling back to
  `~/secure-webserver/igwebhook/secrets.env` when `.env/secrets` lacks
  a key (`start.sh:115-123,184-260`). `wardrobe-service/config.js:62-76`
  resolves the same three tokens from `WARDROBE_READ_TOKEN | IG_API_TOKEN`,
  `WARDROBE_CATALOG_TOKEN | IG_API_STORAGE_TOKEN`, and
  `WARDROBE_SEND_TOKEN | IG_API_SEND_TOKEN` in live mode (mock default
  is the documented non-secret `SYNTH_mock_token`,
  `wardrobe-service/config.js:39`).
- What is absent: no live image-staging credential or upload token
  exists anywhere in the repo because the design needs none — the
  public fetch route is deliberately headerless (signed path token, not
  a bearer) since "Meta's media-fetcher cannot be given custom headers"
  (`docs/instagram-bot-send-api.md:42`). Do not invent one.

Host check still needed (could not run here): confirm on the machine
that runs the bot which of the above names are actually exported in the
running `igwebhook` container (e.g. a boolean-presence probe in the
style of `skills/meta-instagram-integration/SKILL.md:46`, which prints
only `bool(...)`), and confirm `.env/secrets` key names without
printing values. Do not `cat`, `print`, log, or paste any value.

## 3. Meta / Instagram Graph API capability for sending an image DM

Everything in this section is **general knowledge — verify against
Meta's current published developer docs before implementation**,
except where a repo file is explicitly cited. Meta's Send API shape,
permission names, and limits drift; do not treat the field names below
as pinned.

- This is Instagram DM send, not a feed post: the repo's confirmed
  mechanic is `POST https://graph.instagram.com/v26.0/me/messages`
  with a Bearer Graph token and body
  `{"recipient":{"id":IGSID},"message":{"text":...}}`, returning
  `{recipient_id, message_id}` — the skill's Pitfalls section states it
  verbatim (`skills/meta-instagram-integration/SKILL.md:58`), and the
  send spec records "the confirmed text-send mechanics
  (`POST graph.instagram.com/v26.0/me/messages`, token-from-env, 24h
  window)" (`docs/instagram-bot-send-api.md:31,68`).
- Image variant (repo-recorded, same labeling caveat): `POST` to "the
  same `/<IG_ID>/messages` endpoint already used for text, with
  `{"recipient":{"id":"<IGSID>"},"message":{"attachment":{"type":
  "image","payload":{"url":"<IMAGE_URL>"}}}}`", same response shape;
  "up to 10 images can be sent via an `"attachments"` array instead of
  singular `"attachment"`; `type` can also be `audio`/`video`/`file`"
  (`docs/instagram-bot-send-api.md:34`; repeated as resolved question 3
  at `docs/instagram-bot-send-api.md:78` and implemented as the
  two-message split at `docs/instagram-bot-send-api.md:99`).
- Scopes/permissions (repo-recorded names): the access token needs
  `instagram_business_basic` + `instagram_business_manage_messages`
  on the Instagram-Login variant (the family this bot uses), or
  `instagram_basic` + `instagram_manage_messages` (+
  `pages_manage_metadata`) on the Facebook-Login variant
  (`skills/meta-instagram-integration/references/access-routes.md:19,24`;
  App Review gating at `skills/meta-instagram-integration/SKILL.md:32`).
  **General knowledge, verify:** confirm the exact scope strings and
  which login variant the provisioned token was minted under before
  requesting or debugging anything — the repo reuses one existing app
  (`29264663606459560`) and receiving account (`17841417613087488`)
  precisely to avoid a second review (`docs/decisions.md:5`).
- 24-hour window (repo-recorded): "Replies are only allowed within 24
  hours of the user's last message, and each reply comes back to the
  webhook as an `is_echo` event, which must be skipped"
  (`skills/meta-instagram-integration/SKILL.md:58`); the bot checks
  eligibility from its own event timestamps and maps Graph's
  outside-window subcodes (recorded as 2018278, 2534022) to the same
  `422 {"error": "reply_window_expired"}`
  (`docs/instagram-bot-send-api.md:101`). **General knowledge,
  verify:** whether Meta still exposes exactly those subcodes and
  whether any persistent-menu / human-agent exception exists for this
  app type — the repo assumes the plain 24h rule with no exception
  path, so do not assume an exception without a doc citation.
- Attachment flow shape (repo-recorded): it is a **hosted-URL reference
  flow, not a two-step upload and not inline multipart** — the bot
  sends `payload.url` pointing at its own public host and "Meta's own
  servers" fetch it (`docs/instagram-bot-send-api.md:36-42`). That is
  why the public-host, signed-token, logging, and fail2ban work exists
  at all. **General knowledge, verify:** confirm Meta still requires a
  publicly fetchable `https` URL (no auth headers, no `127.0.0.1`) and
  re-check size/format/dimension constraints — the repo pins only a
  `1 MB` send-body cap and `413` (`docs/instagram-bot-send-api.md:103`)
  plus a `15 MB` inbound-media cap (`docs/instagram-bot-api.md:129`),
  **not** outbound image byte/dimension/type limits, so those limits
  are **needs verification against Meta's current docs**, not quoted
  here.

## 4. Infrastructure blockers this repo's own docs already state

- Outbound-image staging is declared mock-only with no live
  counterpart. Header comment: "Preview delivery follows each mode's
  real capability, declared openly rather than forked silently: mock
  mode stages the generated `dataURL` via
  `POST /mock/stage-outbound-image` and attaches it to the send
  (`image:true`); live mode stays text-only because the real bot has
  no staging route" (`wardrobe-service/server.js:22-27`). Status
  endpoint repeats it: "Live mode stays text-only: the real bot has no
  staging route for the image file, and its Graph send is not yet
  credentialed" (`wardrobe-service/server.js:473-489`), and the
  per-mode `image_delivery` block reports `sends: "text+image"` in mock
  vs. `sends: "text-only"` in live with the note "the real bot has no
  staging route for the image file, and its Graph send is not yet
  credentialed" (`wardrobe-service/server.js:481-489`).
- The mock's own header lists the deliberate divergences: "no 502
  `graph_*` family", "outbound-media tokens are mock-local opaque ids
  (same 24h TTL + single-use semantics, different format)", "no
  fail2ban/nginx/TLS/proxy-header hardening"
  (`mock-ig-bot/server.js:23-28`); the parity doc adds that
  "`image:true` with no staged file → `400`" matches but "staging is
  `POST /mock/stage-outbound-image/<share_id>` (in-memory) instead of
  the bot-host file `data/outbound/<share_id>.jpg`"
  (`docs/milestone-13-contract-parity.md:34`) and that tokens are
  "`SYNTH_outbound_NNN` rather than HMAC-signed"
  (`docs/milestone-13-contract-parity.md:49`).
- Roadmap parks the whole live-send path: "Milestone 8 — DESCOPED …
  App Review for `instagram_business_manage_messages`. App Review takes
  days and the judged demo path is the local/mock one (M13/M16), which
  needs no new review scope. Revisit post-hackathon only"
  (`docs/roadmap.md:87-93`); "Milestone 12 — BOT SIDE LIVE, CLIENT NOT
  BUILT … Two blockers remain before any real DM can be sent: (a) no
  client module exists in `app/`; (b) `IG_GRAPH_SEND_TOKEN` on the bot
  is a placeholder … so real sends still `502`"
  (`docs/roadmap.md:105-113`); Milestone 17 defaults to descoping the
  real send — "Default to (ii) unless the real send materially helps
  the demo — the mock already shows the flow with zero platform risk"
  (`docs/roadmap.md:254-260`).
- Product decisions lock mock-only for the submission: "sends stay
  mock-only (`mock-ig-bot/`) for this submission. Real Instagram DM
  sends are a stretch goal only" (`docs/decisions.md:8`, decision 8(2));
  "M16 judge delivery is a **local one-shot install+run** … Hosted
  live Instagram integration is a stretch goal, not required"
  (`docs/decisions.md:8`, decision 8(3)). The M19 pivot restates the
  send gate: "Anything that sends to a real person (live-DM agent
  replies, not mock sends) needs Autumn's explicit go-ahead **before a
  send contract spec is even drafted**" and "the M17 decision (whether
  to close the `IG_GRAPH_SEND_TOKEN` placeholder that makes real sends
  `502` today) stays the gate. Real Instagram DM integration is a
  stretch goal, not required"
  (`docs/milestone-19-chat-first-pivot.md:379-387`; same resolution at
  `docs/milestone-19-chat-first-pivot.md:538-548`).
- The persistent-service spec keeps the same boundary: "this service is
  NEW hackathon-built app-side code that CALLS the real bot's existing
  local-only API. It does not modify `~/secure-webserver/igwebhook` in
  any way" (`docs/milestone-20-persistent-node-service.md:17-22`,
  repeated at `docs/milestone-20-persistent-node-service.md:162-170`),
  "the judged demo path stays mock-only and exactly as-is" with
  `LIVE_IG=1` only an opt-in live layer
  (`docs/milestone-20-persistent-node-service.md:149-160`), and
  "Building Milestone 20 before [M18/M16/M4] are closed is a bad idea …
  do not do it" (`docs/milestone-20-persistent-node-service.md:172-185`).

## 5. Ordered build list for a future Muse delegation (human steps flagged)

Do not start item 2–4 until item 1's human action is done; do not start
any of it until Autumn gives the explicit send go-ahead the compliance
skill requires (the stricter send gate:
`skills/meta-hackathon-compliance/SKILL.md:176`).

1. **Human-only credential + permission step (not buildable by an
   agent).** In the Meta App Dashboard for the existing SecondBloom app
   (`29264663606459560`, receiving account `17841417613087488` —
   reuse recorded at `docs/decisions.md:5`): (a) mint a real Instagram
   Graph send token with `instagram_business_manage_messages` (+
   `instagram_business_basic`) on the Instagram-Login variant the bot
   already uses (variant/scope names per
   `skills/meta-instagram-integration/references/access-routes.md:19,24`
   — **verify current names in Meta's docs before minting**); connect
   and publish per the skill's §6 order (professional account →
   Connected-tools access → use case → token → secret → webhook toggle
   → published app), with App Review started "well before any
   non-tester traffic" (`skills/meta-instagram-integration/SKILL.md:32`)
   if any recipient lacks an app role. (b) Autumn places the real token
   as `IG_GRAPH_SEND_TOKEN` in the bot's `secrets.env` /
   `docker-compose.yml` and recreates the `igwebhook` container
   (the one remaining step at
   `docs/instagram-bot-send-api.md:110`); keep `IG_API_SEND_TOKEN`
   (client bearer) and `IG_GRAPH_SEND_TOKEN` (Graph bearer) distinct —
   the read token is refused on send and vice versa
   (`docs/instagram-bot-send-api.md:96`). No agent should handle, print,
   or commit any token value (`AGENTS.md` rule 2).
2. **Real-bot route gap: give `image:true` a client-reachable staging
   path (prior-work maintenance, outside this repo, never
   hackathon-claimed).** Options the delegation spec must choose
   between: (a) add a local-only authenticated upload route mirroring
   the mock's `POST /mock/stage-outbound-image/<share_id>` that writes
   `data/outbound/<share_id>.jpg` (keeps the local-only posture of
   `POST /ig/send` at `docs/instagram-bot-send-api.md:95`); or (b)
   document a `docker cp` / host-side drop as the human-operated
   alternative. Either way the contract must preserve the mock's
   semantics the service already codes against: unknown share → 404,
   missing file on send → `400` (`docs/instagram-bot-send-api.md:98`
   vs. `mock-ig-bot/server.js:247-248`), serialised sends, same
   idempotency/duplicate rules (`docs/instagram-bot-send-api.md:102`),
   and the `image_message_id` / `image_send_failed` split
   (`docs/instagram-bot-send-api.md:99`). Then flip the live branch
   that today hard-codes `stageImage = null` and "honestly text-only"
   (`wardrobe-service/server.js:362-370`) to stage-then-send with the
   same `withImage` proof the agentic path already requires
   (`wardrobe-service/server.js:754-764`).
3. **Webhook / App Review gate (honestly uncertain — verify with Meta
   and the event Discord before promising).** Sending-media scope is
   repo-recorded as `instagram_business_manage_messages`
   (`docs/roadmap.md:87-93`,
   `skills/meta-instagram-integration/SKILL.md:32`), descoped for the
   submission precisely because "App Review takes days." What is **not
   fully certain from this repo alone**: whether image-DM send needs
   any *additional* review scope, business-verification step, or
   rate-limit tier beyond what text send already needs, and whether
   the 24h-window / `is_echo` / consent-gated intake
   (`~/secure-webserver/igwebhook/docs/data-management-and-consent.md`,
   cited at `docs/milestone-19-chat-first-pivot.md:506-525` and
   `README.md:95-100`) imposes extra approval for media. Flag both as
   open questions for Meta's current docs (and `@CV` on the event
   Discord per `AGENTS.md`), not as settled fact.
4. **Order of operations — what scaffolds now vs. what is blocked.**
   Now (no credential needed): contract-parity tests for the future
   staging route against the mock; the live-branch caller that stays
   text-only until staging + `IG_GRAPH_SEND_TOKEN` both prove out;
   consent-gate and 24h-window handling already in the service
   (`wardrobe-service/server.js:700-702` window-closed terminal,
   `README.md:95-100` consent onboarding). Blocked until Autumn acts:
   any real `POST /ig/send` with `image:true`, any nginx/fail2ban
   change (already applied — `docs/instagram-bot-send-api.md:110`),
   and any demo that shows a real DM. Suggested delegation order:
   (i) Autumn's explicit send go-ahead recorded in `docs/decisions.md`;
   (ii) human mints + installs `IG_GRAPH_SEND_TOKEN`; (iii) prior-work
   staging route lands + host-verified; (iv) hackathon-side live
   stage-and-send wired behind the existing `withImage` proof and
   proven with one consented real send, mock demo unchanged.

Open verification checklist (all **needs verification against Meta's
current docs / host**, not assumed above): live `docker inspect` /
`env` presence check for `IG_GRAPH_SEND_TOKEN`; exact Graph endpoint +
  attachment field names at implementation time; outbound image
  byte/dimension/mime limits; current App Review scope for media sends;
  token-mint flow for the Instagram-Login variant.


