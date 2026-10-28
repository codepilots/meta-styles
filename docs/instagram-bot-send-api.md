# Instagram bot send API — contract spec (Milestone 12)

Status: **design fully resolved (Autumn, 2026-10-28) — still NOT implemented, needs Autumn's explicit go-ahead to start the build.** All ten open questions below are answered. No bot-side endpoint exists for this today, and no client module exists in this repo. This doc is a contract proposal only, following the Milestone 9 spec-first process in `docs/instagram-bot-api.md`.

**Prior-work boundary:** any bot-side endpoint this spec proposes would be Autumn's prior-work maintenance on the separate `igwebhook` deployment (the SecondBloom receiver, outside this repo) — built outside this repo, never presented as hackathon-built. Nothing here is hackathon-built until a client module is written later; that client module is a future milestone, not this task. See `docs/prior-work-instagram.md` as the source of truth on that boundary.

## Direction: meta-styles asks the bot to send (bot exposes a send API)

Milestone 7 (`docs/instagram-integration-plan.md`) already plans the reply-back share card: finished output from `spark.js` (text copy) / `preview.js` (mock image) goes back to the Instagram user who shared the photo. meta-styles is a static front-end with no Graph API credential of its own, so it cannot send Instagram DMs directly — the send must happen through the bot, which already holds the page-scoped send path. This mirrors the Milestone 9 direction decision: the bot stays a separate prior-work service, this repo only gains a thin client, and polling/request-response keeps the compliance boundary intact.

This write API is about triggering a **new** send. Echo handling is not in scope: the bot's own sent messages already come back to the receiver as `is_echo: true` events, which the receiver already skips (skill Pitfalls §"Send replies from a script…").

## Proposed contract (all NEW — none of this exists on the bot today)

Base: `http://127.0.0.1:8903` — **local-only, same constraint as the read API** (`docs/instagram-bot-api.md`, "As implemented"). No nginx route, no public exposure, not reachable via `www.codepilots.co.uk`, Cloudflare, the tailnet, or the LAN. Consequence, same as M9: the live send path only works when meta-styles runs on the machine running the bot.

- `POST /ig/send` → `200` (accepted and sent) with `{ "message_id": "<graph message id>", "recipient_ref": "<opaque, same form as request share_id>" }`, or a typed error (see Error handling). The response carries the Graph `message_id` for tracing; it never carries a raw IGSID.

Request shape (privacy-preserving — client references the share, bot resolves the recipient):

```json
{
  "share_id": "SYNTH_mid_001",
  "text": "SYNTH look-card copy here",
  "idempotency_key": "SYNTH_uuid_001",
  "confirm": true
}
```

- `share_id` (required): the opaque `id` field from `GET /ig/shares` (i.e. the message mid). The bot looks up the correct recipient IGSID **server-side** from its own `shares.jsonl`/`events.jsonl` — the client never sees, holds, or sends a raw IGSID. This preserves the privacy constraint already resolved for the read API (sender IGSID never exposed to meta-styles).
- `text` (required for v1): the message text. The bot forwards it with the confirmed send mechanics: `POST https://graph.instagram.com/v26.0/me/messages` with Bearer [REDACTED] from env and body `{"recipient":{"id":IGSID},"message":{"text":...}}`; Graph returns `{recipient_id, message_id}` (skill Pitfalls §"Send replies from a script…", skill "Meta Model API" section context, plan Milestone 7).
- `idempotency_key` (required): client-generated unique key per intended send (see Error handling / idempotency).
- `confirm` (required, must be `true`): explicit human-in-the-loop acknowledgement (see design decision below). Requests without `"confirm": true` are rejected with `400`, nothing is sent.
- Image attachments (e.g. the `preview.js` mock image): send mechanics ARE confirmed (verified via Meta's own developer docs, via the "Instagram API with Instagram Login" variant — `graph.instagram.com`, the same API family the bot already uses for text, NOT the Facebook-Page-linked Messenger Platform variant which needs a separate Attachment Upload API). Sending an image needs NO separate upload step: `POST` to the same `/<IG_ID>/messages` endpoint already used for text, with `{"recipient":{"id":"<IGSID>"},"message":{"attachment":{"type":"image","payload":{"url":"<IMAGE_URL>"}}}}`. Same response shape as text: `{"recipient_id":"<IGSID>","message_id":"<MESSAGE_ID>"}`. Up to 10 images can be sent via an `"attachments"` array instead of singular `"attachment"`; `type` can also be `audio`/`video`/`file`. **Resolved (Autumn, 2026-10-28): v1 scope is text AND image**, accepting the public-host requirement below as the cost of that scope.

## Public image host for outbound sends (new infrastructure, higher risk)

THE CATCH on the confirmed image mechanics above: `payload.url` must be a URL Meta's own servers can fetch over the public internet — it cannot be `127.0.0.1` (the bot's existing read/send API is local-only and stays that way for everything else). Today the `preview.js` generated share-card image is a client-side `<canvas>` render that is never persisted or hosted anywhere, so sending it means something must briefly host that image at a public URL first.

Autumn's explicit design decision (incorporated exactly, not softened): the brief public host for outbound share-card images lives ALONGSIDE the existing LIVE `igwebhook` public endpoint — the same domain that already serves `https://www.codepilots.co.uk/ig/webhook` — reusing that existing nginx/TLS/Cloudflare-tunnel front door rather than standing up new infrastructure. This is a NEW, narrow, deliberately-public nginx location (e.g. `GET /ig/outbound-media/<token>`), kept entirely separate from the M9 read API's local-only routes (`/ig/shares`, `/ig/media`, `DELETE /ig/media`), which remain `127.0.0.1`-only and unchanged.

Auth for this new public route does NOT reuse the `ig-bot-token` credential — Meta's media-fetcher cannot be given custom headers — it is a per-send, single-use, short-TTL signed token embedded directly in the URL path itself, generated by the bot at send time. The token is HMAC-based, using a secret already held by the bot — the same "shared secret" pattern already used for the webhook's `X-Hub-Signature-256` verification. **Resolved (Autumn, 2026-10-28): reuse that one existing shared secret with Meta — do not mint a separate token secret.** **Resolved (Autumn, 2026-10-28): the token is single-use and expires after 24 hours** — chosen to match the IG reply window the whole send flow already operates within, so nothing in this spec needs a second, shorter-lived clock to reason about. Example shape only (synthetic): `GET /ig/outbound-media/SYNTH_signed_token_001`.

Security hardening — HARD REQUIREMENT, not a suggestion: every request to this new public path must be logged durably (method, path, source IP, token validity outcome — per the docker-webserver-deploy skill's durable-logging guidance: stdout/journald, not an ephemeral tmpfs log). Any request presenting a missing, malformed, or expired token must be treated as a probe/attack, not merely rejected with `403` — the source IP must be blocked at the firewall/network level IMMEDIATELY (not after repeated failures), since the only legitimate caller is Meta's own media-fetching infrastructure which will always present a valid token; there is no legitimate "almost right" caller to tolerate. **Resolved (Autumn, 2026-10-28): the blocking mechanism is fail2ban watching the durable access log, not an iptables/ufw call triggered from inside the app**, and the block is **permanent, not time-boxed**. Reasoning: the receiver sidecar is deliberately hardened (`cap_drop: [ALL]`, `no-new-privileges`, read-only filesystem — see `docker-webserver-deploy` skill); having it shell out to `iptables` itself would need either privileged/`CAP_NET_ADMIN` mode (undoing that hardening) or would only mutate the container's own isolated network namespace rather than the host firewall actually facing the internet. Fail2ban watching the already-required access log sits outside the container, needs no extra privilege inside it, and only trades a sub-second log-tail delay for keeping the sidecar's hardening intact — an acceptable trade since the only caller who can ever be legitimately "almost right" here is Meta's fetcher, which never sends a bad token in the first place. A permanent ban is correct for the same reason: there's no legitimate retry-with-a-fixed-token case to protect against false-positive lockout.

Scope flag for Autumn: this public-host requirement is NEW infrastructure risk compared to M9 (which added zero new public surface) — consistent with how M12 already flags itself as higher-risk than M9, this is a further scope increase to weigh before giving the go-ahead. Any bot-side work here (endpoint, token minting/verification, logging, blocking) is Autumn's prior-work maintenance on the separate `igwebhook` deployment, outside this repo, never hackathon-built.

## Auth — same pattern as the read API

`Authorization: Bearer <ig-bot-send-token>` on `POST /ig/send`, same header shape and same credential store (`.env/secrets`, never committed, never inlined). **Resolved (Autumn, 2026-10-28): a separate send-scoped token**, distinct from the existing read-only `ig-bot-token` — least-privilege reasoning: a leaked read token can only expose share metadata/media; a leaked send token could message real people as the bot, so capping that blast radius is worth a second env var. Proposed name: `ig-bot-send-token` (same `.env/secrets` file/convention).

## Error handling (client contract for the future client module)

- **Expired 24-hour window → distinct error, never silent.** Replies only work within 24 hours of the recipient's last inbound message (skill Pitfalls). A send attempt outside the window must return a dedicated status. **Resolved (Autumn, 2026-10-28): `422` with `{ "error": "reply_window_expired", "share_id": "…" }`, as originally proposed — no change.** The bot must check window eligibility from its own event timestamps before calling Graph; a Graph-side rejection is mapped to the same code.
- **Double-send protection → idempotency.** The bot stores seen `idempotency_key` values; a repeat POST with the same key returns the original result (`200` with the stored `message_id`) instead of sending again. **Resolved (Autumn, 2026-10-28): a repeat POST for the same `share_id` with a *different* key but substantively identical text is also rejected as a duplicate**, `409` with `{ "error": "duplicate_send" }` (exact match rule: same `share_id` + same text hash within the retention window). **Resolved (Autumn, 2026-10-28): idempotency keys are retained 24 hours, then purged daily.** Reasoning: this matches the IG reply window the whole send flow already lives inside — once that window has passed, re-sending to the same share is a window-expired error anyway (see above), so there's no case where a key needs to outlive it; bounding retention to 24h also keeps the store from growing unbounded without needing a separate, unrelated retention policy to track (the same pattern Stripe uses for its own idempotency keys). The client generates a fresh key per deliberate user action, never retries a send with a new key.
- `401/403`: same "check bot credential" status as the read API; no silent retry loop.
- `400`: missing/unknown `share_id`, missing `text`, or missing/false `confirm` — nothing sent.
- `404`: `share_id` the bot has no record of.
- `429`: rate-limited — back off, do not retry in a loop (same posture as the Model API quota rule in the skill).
- Bot down / unreachable: client keeps its state, shows a plain "bot unavailable" status, backs off; sending is never queued blindly for later — an unsent card stays an unsent draft until the user explicitly re-confirms.

## Design decision: human-in-the-loop confirmation (recommended)

Unlike the read-only M9 API, this endpoint sends a message to a **real external person**. The spec therefore requires an explicit confirmation step before anything goes out: the future client MUST show the exact text (and, now, image) to the user for review, and only `POST /ig/send` with `"confirm": true` once the user approves. The bot rejects unconfirmed requests. **Resolved (Autumn, 2026-10-28): the single-request `"confirm": true` gate is sufficient — no separate two-step preview-then-commit endpoint pair.**

## NEW vs REUSE

- REUSE as-is (prior work, untouched): `igwebhook` receiver — handshake, `X-Hub-Signature-256` verify, `events.jsonl`/`shares.jsonl` writers, immediate media download, `is_echo` skip; SecondBloom app (`29264663606459560`) and receiving IG account (`17841417613087488`); the confirmed text-send mechanics (`POST graph.instagram.com/v26.0/me/messages`, token-from-env, 24h window). See `docs/prior-work-instagram.md` and `skills/meta-instagram-integration/SKILL.md` (Pitfalls, "Meta Model API" section).
- NEW (Autumn's prior-work maintenance, outside this repo — needs her go-ahead): the `POST /ig/send` endpoint itself, server-side IGSID lookup from `share_id`, idempotency store, window-eligibility check; plus the new public image host (`GET /ig/outbound-media/<token>` alongside the live `igwebhook` endpoint) with its signed path-token auth, durable request logging, and immediate IP-blocking on invalid-token requests — all bot-side, all needing her go-ahead.
- NEW (hackathon work, future milestone, not this task): a small client module in this repo calling `POST /ig/send`, with the confirmation UI and the error handling above. Nothing in `app/` is touched by this design task.

## Open questions for Autumn — ALL RESOLVED (2026-10-28)

All ten items below are now answered; kept visible with their original numbering and the rejected/superseded wording struck through, per project convention (resolved decisions stay visible rather than being deleted).

1. ~~Expired-window error behavior~~ — **Resolved: `422` + `reply_window_expired` as originally proposed. No change.**
2. ~~Idempotency approach~~ — **Resolved: reject duplicates.** Same `idempotency_key` replays the stored result; same `share_id` + substantively identical text but a *different* key is also rejected (`409 duplicate_send`). **Retention: 24 hours, then purged daily** — matches the reply window the whole flow already lives inside (nothing needs a key to outlive it, since a stale attempt is a window-expired error anyway), and keeps the store bounded without a separate retention policy to track (the pattern Stripe uses for its own idempotency keys).
3. ~~Payload scope: text-only, image, or both?~~ — **Resolved: text AND image in v1.** Image-send mechanics are confirmed (`POST graph.instagram.com/<IG_ID>/messages`, `message.attachment.type=image` + `payload.url`, up to 10 via an `attachments` array), accepting the new public-host requirement ("Public image host for outbound sends") as the cost of that scope.
4. ~~Send confirmation step~~ — **Resolved: single-request `"confirm": true` gate is sufficient.** No two-step preview-then-commit pair.
5. ~~Token scope~~ — **Resolved: a separate send-scoped token** (`ig-bot-send-token`), distinct from the read-only `ig-bot-token`. Least-privilege reasoning: capping the blast radius of a leaked credential matters more here than the convenience of one token, since this one can message real people as the bot.
6. Same split confirmation as M9 — not a question, stands as written: the endpoint itself is Autumn's prior-work maintenance on `igwebhook`, outside this repo, never claimed as hackathon-built; only the future client module counts as new work. `docs/prior-work-instagram.md` will need an update once/if the send API goes live.
7. ~~Signed path-token TTL and use rule~~ — **Resolved: single-use, 24-hour TTL.** Chosen to match the IG reply window already governing the rest of the flow, so there's no second, independent clock to reason about.
8. ~~Which secret backs the token HMAC~~ — **Resolved: reuse the one existing shared secret with Meta** (the webhook's `X-Hub-Signature-256` secret) — no separate token secret is minted.
9. ~~Blocking mechanism~~ — **Resolved: fail2ban watching the durable access log**, not an iptables/ufw call triggered from inside the app. Reasoning: the receiver sidecar is deliberately hardened (`cap_drop: [ALL]`, `no-new-privileges`, read-only filesystem); having it shell out to `iptables` itself would need privileged/`CAP_NET_ADMIN` mode (undoing that hardening) or would only mutate its own isolated network namespace rather than the host firewall actually facing the internet. Fail2ban sits outside the container, needs no extra privilege inside it, and only trades a sub-second log-tail delay for keeping the sidecar's hardening intact — acceptable since the only caller who can ever be "almost right" here is Meta's own fetcher, which never sends a bad token in the first place.
10. ~~Block duration~~ — **Resolved: permanent, not time-boxed.** There's no legitimate retry-with-a-fixed-token case to protect against false-positive lockout, so there's nothing a time-box would be trading off against.

All example ids in this doc are synthetic (`SYNTH_…`) per project convention — never a real IGSID or mid.

## Cross-references

- Milestones: `docs/roadmap.md` (Milestone 12 entry); build/reuse split per milestone: `docs/instagram-integration-plan.md` (Milestone 7 entry).
- Read-API precedent: `docs/instagram-bot-api.md` (Direction/Auth/error-handling pattern this spec follows; privacy constraint it preserves).
- Prior-work boundary: `docs/prior-work-instagram.md`.
- Send-mechanics truth: `skills/meta-instagram-integration/SKILL.md` (Pitfalls §"Send replies from a script…", "Meta Model API" section) and `references/access-routes.md`.
