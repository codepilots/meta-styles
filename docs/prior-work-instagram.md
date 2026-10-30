# Prior work — Instagram integration (SecondBloom)

**This predates the Meta Global AI Developer Hackathon.** Built and deployed
14 Oct 2026 — twelve days before the hackathon build window opened (26 Oct
2026, 12:00 PM EST). It is background/prior capability, not hackathon-period
work, and it is **not part of this repo's codebase**: it runs as a separate
deployed service outside `~/projects/meta-styles`. Included here only to
document the technical lineage behind meta-styles' photo → outfit pipeline.

## What it is

**SecondBloom** — a live Meta app (app_id `29264663606459560`) with a
DM-share bot on Instagram (receiving IG business account ID
`17841417613087488`). A normal Instagram user shares a post, reel, or photo
to the SecondBloom account via DM; a webhook receiver processes it — no
developer dashboard, Graph Explorer, or account-type change required on the
sending user's side.

## Stack (deployed, outside this repo)

- `~/secure-webserver/igwebhook/app.py` — stdlib-only Python HTTP receiver
  (no framework), run as an unprivileged, read-only, capability-dropped
  Docker container (`python:3.13-alpine`, 128MB mem limit) behind nginx at
  `https://www.codepilots.co.uk/ig/webhook`.
- Verifies Meta's webhook handshake (`hub.verify_token`) and every POST's
  `X-Hub-Signature-256` against the app secret before writing anything.
- Raw verified events append to `data/events.jsonl`; shared
  posts/reels/mentions flatten into `data/shares.jsonl`.
- Media attachments (signed, temporary `lookaside.fbsbx.com` URLs) are
  downloaded immediately to `data/media/` on arrival.
- Downloaded images are run through vision analysis to decompose an outfit
  into base / layer / accessory pieces, the colour links between them, and
  style keywords — the same per-piece decomposition pattern meta-styles'
  Milestone 2 look-card assembler now formalises with explicit fit rules.

- Read API added 2026-10-28 (prior-work maintenance, not hackathon work): bearer-token `GET /ig/shares` + `GET /ig/media/<id>` + `DELETE /ig/media/<id>` (bot deletes its copy once meta-styles has collected an image), served **only on this machine** at `127.0.0.1:8903` (never via Cloudflare); direct photos now recorded and all attachments downloaded on receipt by the receiver itself (before this, downloads were done by hand). Spec: `docs/instagram-bot-api.md`.

## Why it's relevant to meta-styles

SecondBloom proved the hard infrastructure problem — getting a real photo
of a real outfit from an ordinary user's phone into a processing pipeline
without any setup friction (no Creator account switch, no Facebook Page
link, no dashboard). meta-styles reuses that lesson (design for the ordinary
user first) and is a separate, self-contained web app built fresh during
the hackathon window.

**Extension (built 2026-10-28 as maintenance of this prior-work project,
outside this repo):** Autumn had a local-only API (`GET /ig/shares`,
`GET /ig/media/<id>`, `DELETE /ig/media/<id>` — full spec in
`docs/instagram-bot-api.md`) added to this existing SecondBloom deployment,
along with two receiver fixes (direct photos are now recorded; media is
downloaded on arrival). All of that is **maintenance of this prior-work
project**, lives outside this repo, and must never be presented in the
hackathon submission/demo as something built during the hackathon window.
meta-styles' Milestone 9 client module (new, hackathon-built, lives in
`app/inbox-bridge.js`, implemented 2026-10-28) calls it to replace the
Milestone 5 fixture-only bridge — this repo depends on the bot's API at runtime, which
is fine: a thin client calling a documented API is the new work; the bot
remains prior work. Because the API is local-only, that live path works
only on the machine running the bot; elsewhere the fixture bridge is the
fallback.

**Extension (built 2026-10-30 as maintenance of this prior-work project,
outside this repo):** closed the real-image-send gap and fixed a
production bug discovered while verifying it live. Three changes to
`~/secure-webserver/igwebhook/app.py` (all prior-work maintenance, never
vendored into this repo):

1. `POST /ig/outbound-stage/<share_id>` — local-only (same
   `IG_API_SEND_TOKEN` auth as `POST /ig/send`) route that accepts raw
   image bytes, validates them (Content-Type + magic-byte sniff,
   `MAX_MEDIA` size cap), and encrypts+writes them to
   `data/outbound/<share_id>.jpg` using the bot's existing
   `encrypt_bytes()`/`dek_for_igsid()` helpers (the same scheme
   `GET /ig/outbound-media/<token>` already decrypted with). This closes
   the gap `outbound_path()`'s old docstring named directly: "a future
   client module puts it there."
2. `HEAD /ig/outbound-media/<token>` — the server had no `do_HEAD` at
   all (bare `501`); added, sharing `_outbound_media`'s validation path
   with GET, never counting toward or starting the serve-limit window
   below.
3. **Root-cause fix, found via a live test send with Autumn's explicit
   go-ahead:** the outbound-media token was single-use (burn on first
   GET). Real Instagram Graph API sends fetch the same attachment URL
   2-3 times (different Meta-infrastructure IPs, within ~2s) before
   confirming delivery — every real send failed with a generic Graph
   "attachment format not supported" error because fetch #2/#3 hit the
   already-burned token. Fixed by bounding reuse instead of removing it:
   a token now serves up to 5 successful GETs within 60s of its first
   GET, then burns permanently — tolerates Meta's real behavior
   (observed max 3 fetches) with a safety margin, while keeping the
   original single-use *security intent* (a leaked token is only live
   for ~1 minute, not its full 24h TTL).

Live-verified end-to-end 2026-10-30: a real test image was staged,
sent via `POST /ig/send` with `image:true`, and landed in Autumn's
actual Instagram DMs (two separate confirmed `image_message_id`
deliveries, one before and one after the final reviewed/tested commit
landed). meta-styles' hackathon-built `wardrobe-service` (new work, this
repo) now calls the staging route in live mode exactly as it already
called the mock bot's staging route — the client wiring is new,
hackathon-built work; the bot-side route, HEAD support, and multi-fetch
fix are prior-work maintenance, same split as every other extension
above.

## Full detail

The complete integration runbook (App Review gates, webhook connection
order, payload shapes, pitfalls, Meta Model API usage) lives in the
`meta-instagram-integration` skill, not duplicated here to avoid drift.
