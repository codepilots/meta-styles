# Instagram bot read API — contract spec (Milestone 9, APPROVED for bot-side build, by Autumn — not part of this repo)

Status: **approved, with a scope boundary** (Autumn, 2026-10-28) — Autumn
will add this API to the existing SecondBloom `igwebhook` deployment
herself, as maintenance of that prior-work project. That bot-side work is
**not** part of this repo and must never be presented as hackathon-built —
`docs/prior-work-instagram.md` stays the source of truth on that boundary
and should be updated once the bot API is live. The hackathon's own new
work is strictly the meta-styles-side client module in `app/` that calls
this API, replacing the Milestone 5 fixture-only bridge. The SecondBloom
webhook receiver's existing logic (handshake, signature verification,
events.jsonl/shares.jsonl writers, media download) stays unchanged; only
new read-only routes are added on top.

## Direction: meta-styles polls the bot (bot exposes a read API)

meta-styles is a static front-end with no inbound endpoint, so
webhook-to-webhook push would require a new always-on server on our side.
A shared data store is impossible across hosts (bot data dir lives on the
`codepilots.co.uk` server) and fragile by the integration plan's own
assessment (`docs/instagram-integration-plan.md` Milestone 5 risk note).
Polling matches the skill's standing pattern — webhook as the main intake,
a read API for catch-up (`references/access-routes.md`, Conversations API
section) — and keeps the compliance boundary intact: the bot stays a
separate prior-work service, this repo only gains a thin client.

## Proposed contract (all NEW — none of this exists on the bot today)

Base: `https://www.codepilots.co.uk/ig` (same host as the existing
`/ig/webhook` receiver; path prefix only, not a live endpoint).

- `GET /ig/shares?since=<cursor>&limit=<n>` → `200`
  `{ "items": [<share>], "next_cursor": "<opaque>" }`.
  `since` is an opaque cursor the bot issued as a previous `next_cursor`
  (implemented server-side as `received_at` + message id). First call omits
  `since`. `limit` defaults to 20, max 50. No new items → `200` with
  `"items": []`, never an error.
- `GET /ig/media/<media_id>` → `200` with image bytes (`Content-Type:
  image/*`), served from the bot's already-downloaded `data/media/` files.
  meta-styles must never fetch the raw `lookaside.fbsbx.com` signed URLs
  itself — they expire fast (skill §7 / Milestone 6 immediate-download
  rule); the bot's local copy is the canonical source.

## Item shape (reuses the real verified payloads, skill Pitfalls §"Real payloads")

```json
{
  "id": "<bot-assigned share id, e.g. message MID>",
  "received_at": "2026-10-26T12:00:00Z",
  "attachment": { "type": "ig_post", "payload": { "ig_post_media_id": "...", "title": "...", "url": "<expiring lookaside URL, informational only>" } },
  "media_id": "<id for GET /ig/media/<media_id>>"
}
```

`attachment` is exactly one of the two real shapes: `ig_post` with
`{ig_post_media_id, title, url}`, or direct-photo `image` with `{url}` only.
No author username or permalink exists on either shape — the client must not
expect them. `title` is the post caption. Carousel shares carry the first
image only (upstream limit, not this API's choice).

## Auth (OPEN QUESTION — see below)

Do NOT reuse the `meta-api-key` in `.env/secrets`: it authorises the Meta
Model API (Spark/Image/SAM), a different service with a different owner and
quota. The bot API needs its own credential. Proposed: a bot-issued bearer
token sent as `Authorization: Bearer <token>`, read from the process
environment on both sides, never committed. Exact scheme, issuance, and
rotation are undecided — flagged below.

## Error handling (client contract for the future client module)

- Bot down / unreachable: client keeps the last good list, shows a plain
  "bot unavailable" status, backs off (e.g. 30s, then 5min); fixture file
  remains the offline demo fallback.
- `401/403`: distinct "check bot credential" status; no silent retry loop.
- `400` (bad `since`/`limit`): client drops the cursor and re-fetches from
  the start of the window.
- Malformed item in `items`: skip that item, keep the rest (same rule as the
  current fixture parser in `app/inbox-bridge.js`).

## NEW vs REUSE

- REUSE as-is (prior work, untouched): `igwebhook` receiver — handshake,
  `X-Hub-Signature-256` verify, `events.jsonl`/`shares.jsonl` writers,
  immediate media download; SecondBloom app (`29264663606459560`) and
  receiving IG account (`17841417613087488`); payload shapes and the
  immediate-download rule. See `docs/prior-work-instagram.md`.
- NEW (hackathon work, Milestone 9+): this read API on the bot side; a small
  client module in this repo replacing the `FIXTURE_URL` fetch (fixture stays
  as offline fallback); the bot credential above.

## Open questions for Autumn

**Resolved (Autumn, 2026-10-28):** the bot-side API is approved — Autumn
will build it on `igwebhook` herself as prior-work maintenance, outside
this repo, never claimed as hackathon-built. The hackathon's new work is
only the meta-styles client that consumes it (replacing the Milestone 5
fixture bridge). `docs/prior-work-instagram.md` needs an update once the
bot API is live, to describe it there as prior-work infrastructure.

1. Auth scheme: pre-shared bearer token vs short-lived issued tokens — and
   where does the meta-styles side store it (same `.env/secrets` file under
   a new name, or separate)? **Still the biggest open item — blocks the
   client module.**
2. Do share items need sender identity at all (privacy: currently no sender
   field is specified), and how long should the bot retain `data/media/`
   files for re-fetch?

## Cross-references

- Milestones: `docs/roadmap.md` (Milestone 9 entry).
- Build/reuse split per milestone: `docs/instagram-integration-plan.md`.
- Prior-work boundary: `docs/prior-work-instagram.md`.
- Payload truth: `skills/meta-instagram-integration/SKILL.md` (Pitfalls,
  "Real payloads") and `references/access-routes.md`.
