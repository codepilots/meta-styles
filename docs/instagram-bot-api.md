# Instagram bot read API — contract spec (Milestone 9; bot side IMPLEMENTED 2026-10-28 as prior-work maintenance, outside this repo)

Status: **implemented on the bot** (2026-10-28) — Autumn had the API added
to the existing SecondBloom `igwebhook` deployment, as
maintenance of that prior-work project, authenticated via a bearer token
stored in `.env/secrets`. That bot-side work is **not** part of this repo
and must never be presented as hackathon-built — `docs/prior-work-instagram.md`
stays the source of truth on that boundary and should be updated once the
bot API is live. The hackathon's own new work is strictly the meta-styles-
side client module in `app/` that calls this API, replacing the Milestone
5 fixture-only bridge. The SecondBloom webhook receiver's existing logic
(handshake, signature verification, events.jsonl/shares.jsonl writers,
media download) stays unchanged; only new read-only routes are added on
top.

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

Base: ~~`https://www.codepilots.co.uk/ig`~~ — **superseded (Autumn,
2026-10-28): the API is local-only at `http://127.0.0.1:8903`**, not on
the public host. See "As implemented" below.

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

## Auth — RESOLVED (Autumn, 2026-10-28)

Bearer token. The bot issues a pre-shared bearer token; meta-styles sends
`Authorization: Bearer <token>` on every `GET /ig/shares` / `GET
/ig/media/<id>` call. Stored in `.env/secrets` under its own name — **not**
reusing `meta-api-key`, per the reasoning above (different service,
different owner/quota). Proposed var name: `ig-bot-token=...` (same
`key=value` convention as the existing file). Issuance/rotation mechanics
(how the bot generates it, whether it expires) are still Autumn's call when
she builds the bot side — not blocking the client module's design, since
the client only needs to know the header shape and the env var name.

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
- IMPLEMENTED 2026-10-28 (hackathon work, this repo): the client module is
  `app/inbox-bridge.js` — live `GET /ig/shares` paging, `GET /ig/media/<id>`
  bytes as object URLs, `DELETE /ig/media/<id>` only after use, Bearer token
  from untracked `app/ig-bot-token.local.json` (see `.gitignore`), per-section
  error handling above, and the Milestone 5 fixture file as offline fallback.

## Open questions for Autumn

**Resolved (Autumn, 2026-10-28):** the bot-side API is approved — Autumn
will build it on `igwebhook` herself as prior-work maintenance, outside
this repo, never claimed as hackathon-built. The hackathon's new work is
only the meta-styles client that consumes it (replacing the Milestone 5
fixture bridge). `docs/prior-work-instagram.md` needs an update once the
bot API is live, to describe it there as prior-work infrastructure.

**Resolved (Autumn, 2026-10-28): auth is a bearer token in `.env/secrets`**
(see Auth section above) — retires the item that was the biggest blocker.

1. ~~Sender identity~~ — resolved: not exposed. ~~Media retention~~ — resolved (Autumn, 2026-10-28): the bot deletes its copy once the client acknowledges collection with DELETE /ig/media/<id>; uncollected media stays until collected.

## As implemented (bot side) — differences from the draft

Source of truth: `~/secure-webserver/igwebhook/app.py` (prior-work service, not in this repo; 118 unit tests there).

- **Local-only (Autumn, 2026-10-28):** the API is served **only** at `http://127.0.0.1:8903` on the machine running the bot. It is not reachable via `www.codepilots.co.uk`, Cloudflare, the tailnet or the LAN (no nginx route; port bound to 127.0.0.1; requests carrying proxy headers get `404`). This supersedes the draft's public base URL above. Consequence: the live Instagram input path only works when meta-styles runs on that same machine; anywhere else (incl. a judge's browser) the Milestone 5 fixture bridge is the fallback.

- **Cursor** is the 0-based line offset into the bot's append-only `shares.jsonl`, as a decimal string (treat as opaque). First call omits `since`. No new items → `200` with `"items": []` and the same cursor.
- **Item shape** adds `media_available: bool` (false until the background download finishes or if it failed). `id` = Instagram message `mid`; `received_at` = ISO-8601 UTC (`2026-10-14T20:08:56Z`). **Omitted for privacy:** sender IGSID, account id, Meta's timestamp, and the text that accompanies an attachment share — resolves open question 1 (sender identity: not exposed, raw).
- **Text turns (Autumn, 2026-10-29) — a deliberate, scoped privacy reversal:** a DM with non-empty text and no recorded attachment is now a `type: "text"` item, `attachment: {"type": "text", "payload": {"text": "<the DM text>"}}`, `media_id: null`, `media_available: false`. This is the ONE place message text is ever exposed — text that comes with a shared post/photo is still withheld, as is sender IGSID/account id/timestamp on every item. Needed for the M19 chat-first pivot's free-text turns. Not backfilled: text DMs that arrived before this change exist only in `events.jsonl`.
- **`user_ref` (Autumn, 2026-10-29):** every item now also carries `user_ref`, a stable opaque per-sender id — `"u_" + HMAC-SHA256(IG_USER_REF_SECRET, "ig-user-ref:<sender_igsid>")[:32 hex]`. Deterministic (same sender → same ref, across restarts), not invertible to the real IGSID without the bot's secret. `null` if the secret is unset. This is the answer to M19's §8.9 open question — meta-styles now has a real per-user key to build the wardrobe catalog against, instead of the single-user placeholder assumption. Full design: `~/secure-webserver/igwebhook/docs/user-ref-and-storage-api.md` (not in this repo).
- **Storage API (Autumn, 2026-10-29), local-only like the read API:** `PUT /ig/catalog/<user_ref>` (body: JSON array, → `204`) and `GET /ig/catalog/<user_ref>` (→ `200 {"pieces": [...]}`, `{"pieces": []}` if nothing stored yet, never `404` for "no data"). Separate bearer token `IG_API_STORAGE_TOKEN` (own name in `.env/secrets`, not `ig-bot-token`). Whole-array replace, last-write-wins, opaque bytes — the bot never inspects piece contents or validates the M19 catalog schema; that stays meta-styles' job. This is the real build behind M19's M11 contract sketch.
- **Direct photos are now recorded** (`attachment.type == "image"`); their `media_id` is `img_` + first 24 hex chars of `sha256("<mid>:<attachment index>")`.
- **Media** is downloaded on receipt (10 s timeout, 15 MB cap) to the bot's `data/media/<media_id>`; `GET /ig/media/<id>` returns it with a sniffed `Content-Type`, `404` if absent. The expiring `lookaside` URL in `payload.url` is informational only.
- **Status codes:** `503` API disabled (no token configured), `401` + `WWW-Authenticate: Bearer realm="ig"`, `400` bad paging (`limit` 1–50), `404`, `413` (>15 MB).
- **CORS:** only the origin in the bot's `IG_API_ALLOW_ORIGIN` (default `http://localhost:8000`, the demo origin). Preflight `204`; other origins `403`.
- **Caching:** `Cache-Control: no-store` (JSON) / `private, no-store` (media).
- **Collect-then-delete (Autumn, 2026-10-28):** new endpoint `DELETE /ig/media/<id>` → `204`. The client must call it **after** it has stored or used the image (e.g. once the look-card pipeline has the bytes in hand), never before; the bot then deletes its copy, `GET /ig/media/<id>` returns `404`, and the item's `media_available` becomes `false`. Unknown id → `404`. Same auth, local-only and proxy rules as the GETs; CORS preflight allows `DELETE`. Nothing is deleted on GET alone — an image the client never acknowledges stays on the bot.
- **Client credential:** `ig-bot-token` in `.env/secrets`. A static browser app cannot keep a secret — the Milestone 9 client must decide how the token reaches the browser (see plan risks). The token can read shares/media and delete collected media; it is usable only on this machine.

## Cross-references

- Milestones: `docs/roadmap.md` (Milestone 9 entry).
- Build/reuse split per milestone: `docs/instagram-integration-plan.md`.
- Prior-work boundary: `docs/prior-work-instagram.md`.
- Payload truth: `skills/meta-instagram-integration/SKILL.md` (Pitfalls,
  "Real payloads") and `references/access-routes.md`.
