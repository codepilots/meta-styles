# wardrobe-service (Milestone 20)

Persistent server-side wardrobe processor — the SOLE writer/sender.
One process owns the poll loop, so "already handled this share" is decided
in exactly one place (the duplicate-send incident of 2026-10-30 was two
browser tabs each believing they hadn't sent yet).

## Run

Via the repo launcher (starts the service with the other processes):

```sh
sh start.sh                 # mock bot 8904 (judged path; service included)
LIVE_IG=1 sh start.sh       # real local bot 8903 (personal use)
```

Standalone (same env contract `start.sh` exports):

```sh
node wardrobe-service/server.js
LIVE_IG=1 WARDROBE_READ_TOKEN=... WARDROBE_CATALOG_TOKEN=... \
  WARDROBE_SEND_TOKEN=... node wardrobe-service/server.js
```

Optional: `WARDROBE_PORT` (default 8906), `WARDROBE_BOT_BASE`,
`WARDROBE_PROXY_BASE`. Mock token defaults to the documented non-secret
`SYNTH_mock_token`. Secrets come from the process environment only —
never a file, never a log line.

## Contract

- Polls `GET /ig/shares`, catalogues photos (classify: live Spark vision
  via the proxy, labelled on-device fallback), answers text turns, sends
  exactly one reply per share via `POST /ig/send`, persists pieces via
  `PUT /ig/catalog/<user_ref>`. No local store for wardrobe data.
- Mock mode: one fixed demo wardrobe. Live mode: one wardrobe per real
  sender, keyed by the bot's per-share `item.user_ref`.
- Status for the thin client: `GET /wardrobe/status` — counts,
  timestamps, and plain-language activity lines only. Never a token, id,
  or user_ref. The browser polls this for display; it issues no `/ig/send`
  calls of its own (manual Send-as-app / Propose-look buttons excepted).
