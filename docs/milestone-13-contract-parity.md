# Milestone 13 — contract-parity checklist (mock vs real bot)

Status: **written 2026-10-28 (task 10 done)** — static diff only. Method:
`mock-ig-bot/server.js` (plus `app/mock-dm.html` and `app/inbox-bridge.js`)
read in full and compared route-by-route against the authoritative real
contract: `docs/instagram-bot-api.md` and `docs/instagram-bot-send-api.md`,
"As implemented"/"Applied" sections. No live bot was reachable from this
sandbox, so codes/shapes are compared against the docs' text, not a live
probe. Legend: ✅ parity · ⚠️ client-neutral difference (documented) ·
❌ deliberate divergence (documented, by design).

## Read API (`docs/instagram-bot-api.md`, "As implemented")

| Real contract | Mock behavior | Verdict |
|---|---|---|
| `GET /ig/shares` → `200 {items, next_cursor}`; cursor is an opaque decimal line offset; first call omits `since` | Same; cursor is the decimal line offset into the in-memory shares list | ✅ |
| `limit` defaults 20, max 50; bad `since`/`limit` → `400` | Same; non-numeric `since`/`limit`, or `limit` < 1 / > 50 → `400 {error:"bad_paging"}` | ✅ code parity · ⚠️ the spec names the code, not the body key; the client branches on status only |
| Empty page → `200 {items: []}` + the same cursor | Same, except an empty store with no `since` returns `next_cursor: null` | ⚠️ client-neutral (`inbox-bridge.js` treats a non-string cursor as null) |
| `since` past the end | Unspecified by the spec; the mock `400`s (`bad_paging`) | ⚠️ mock-local choice; exercises the client's drop-cursor-and-refetch path by design |
| Item shape: `id`, `received_at` (ISO-8601 UTC), `attachment` exactly `ig_post {ig_post_media_id, title, url}` or `image {url}`, `media_id`, `media_available` bool | Same; the operator photo route mints both real shapes | ✅ |
| `GET /ig/media/<id>` → `200` sniffed `Content-Type`; `404` if absent | Same; `404 {error:"media_not_found"}` (spec names the code only) | ✅ |
| `DELETE /ig/media/<id>` → `204`, bytes gone, `media_available` flips to `false`, later `GET` → `404`; unknown id → `404`; `GET` alone deletes nothing | Same, exactly | ✅ |
| `401` + `WWW-Authenticate: Bearer [REDACTED]"ig"` on every route except the outbound-media token URL | Same; body `{error:"unauthorized"}` (spec names code + challenge only) | ✅ |
| CORS: single origin, default `http://localhost:8000`; preflight `204`; other origins `403`; preflight allows `DELETE` | Same; preflight `204` with `Allow-Methods: GET, POST, DELETE, OPTIONS`; wrong origin → `403 {error:"forbidden_origin"}` (spec names the code only) | ✅ |
| `Cache-Control: no-store` (JSON) / `private, no-store` (media) | Same on all matching routes | ✅ |

## Send API (`docs/instagram-bot-send-api.md`, "As implemented"/"Applied")

| Real contract | Mock behavior | Verdict |
|---|---|---|
| `POST /ig/send`, local-only; `200 {message_id, recipient_ref}` plus `image_message_id` when an image was sent | Same shape; ids are `SYNTH_msg_NNN` / `SYNTH_imgmsg_MMM` per the synthetic-data convention | ✅ |
| Request `share_id`/`text`/`idempotency_key`/`confirm:true`, optional `image` bool default `false` | Same, validated identically | ✅ |
| `confirm` not exactly `true`, or bad/missing fields → `400`, nothing sent | Same; `{error:"bad_request"}` (spec names the code only) | ✅ |
| `image:true` with no staged file → `400` | Same `{error:"image_not_staged"}`; staging is `POST /mock/stage-outbound-image/<share_id>` (in-memory) instead of the bot-host file `data/outbound/<share_id>.jpg` | ⚠️ mechanism is mock-local, semantics identical |
| Unknown `share_id` → `404` | Same `{error:"unknown_share"}` | ✅ |
| Body > 1 MB → `413` | Same `{error:"body_too_large"}` (spec names the code only) | ✅ |
| 24h window from the share's own timestamp → `422 {error:"reply_window_expired", share_id}` | Same, exact shape including `share_id` | ✅ |
| Idempotency: same key + same payload replays the stored `200`; same key + different payload → `409 {error:"idempotency_key_reused"}`; same `share_id` + same whitespace-normalised text with a different key → `409 {error:"duplicate_send"}`; keys pruned to 24h on access; sends serialised | Same on all five points (normalised-text comparison is equivalent to the spec's text hash) | ✅ |
| Only Graph-accepted attempts are stored | The mock stores every success — unobservable, since the mock never fails downstream | ✅ equivalent |
| `401` + challenge; preflight on `/ig/send` allows `POST` with `Authorization, Content-Type` | Same | ✅ |
| Text + image = two Graph messages | The mock mints both ids and appends one outbound-log entry carrying both | ✅ shape parity |

## Deliberate divergences (mock differs by design — none is client-visible in the demo flow)

1. ❌ The `502 graph_error` / `graph_unreachable` / `image_send_failed` family never fires — there is no Graph backend to fail; sends are recorded locally (plan §3's known item).
2. ❌ `429 rate_limited` never fires — same reason (no Graph/quota backend).
3. ❌ `503` never fires — the mock has no disabled state; it always starts with a configured token.
4. ❌ One shared `MOCK_TOKEN` on all routes — the real bot uses separate read/send tokens and refuses each at the other's route. The `401` path is still exercisable with a wrong token, and the client sends a single token either way, so this is client-neutral.
5. ❌ Outbound-media tokens are mock-local (`SYNTH_outbound_NNN`) rather than HMAC-signed; semantics match (24h TTL, single-use burn, no `Authorization` header, bare empty-`404` refusals). Restart amnesia matches the real bot's accepted tradeoff.
6. ❌ No proxy-header `404`s, no fail2ban/nginx/TLS — host hardening is explicitly out of scope (plan §3/§6); the mock binds `127.0.0.1` only.
7. ❌ No durable per-send stdout log line — observability only, invisible to the client.
8. ❌ `/mock/*` operator routes and `text`-type injections are harness-only, never called by `inbox-bridge.js` (enforced by test). `text`-type shares are skipped by the judged client's shape filter and render only in the chat page; only photo injections use real shapes.

## Isolation (task 11) — static half done, live half needs a human

Static verification (done 2026-10-28, enforced by `app/test/milestone13-mock-dm-page.test.js`, 32 passing):

- Forbidden-host grep (`codepilots`, `graph.instagram`, `lookaside`, `fbsbx`): absent from the live code of all three files (`mock-ig-bot/server.js`, `app/mock-dm.html`, `app/inbox-bridge.js`) — confirmed by reading, not just grepping.
- `8903` appears in comments/docs only: the server header ("one off the real bot's 8903"), the bridge's documented switch-back comment (task 9), and one page doc line. No live code path points at it.
- `server.js` requires `http` only (no `https`/`net`/`tls`/`dns`/`child_process`); no `http.request`/`http.get`, `fetch`, socket-connect, or `WebSocket` call anywhere — the process physically cannot issue an outbound request. It binds `127.0.0.1` only, and `new URL(req.url, "http://127.0.0.1")` is a parse base, not a request target.
- The chat page's only `fetch` calls are `base() + path` (the editable field defaulting to `http://127.0.0.1:8904`) — no absolute-URL fetch literals. The bridge fetches only `BOT_BASE`-relative or same-origin-relative URLs and never touches `/mock/*`.

Live verification (still needs a human — Bramble/Autumn — because this sandbox can neither edit `/etc/hosts` nor drive a real browser): run the plan's §5 steps 1–6 verbatim — stop the real bot, add the hosts block for `www.codepilots.co.uk` / `graph.instagram.com`, start only the mock + static server, do the chat-driven end-to-end (§2 four-beat flow), capture console logs + a Network-tab filter on those hosts (must be empty, no multi-second stalls), then restore and re-run the swap-back walk against the real backend.
