# meta-styles — your wardrobe, styled in chat

A hackathon entry for the Meta Global AI Developer Hackathon (Indie
Developer track): an agent that builds a persistent wardrobe from the
photos you share, then styles validated full looks from it — conversing
through an Instagram-DM-style chat thread. Every proposal passes a real
fit-rule engine (base + exactly one finish; two-layer and shoe
rejections; ≤300-word budget), and every turn leads with the wardrobe
payoff: what was catalogued, what look the catalog produced, what the
validator said, what to buy next. Not a photo classifier in isolation.

## Run the judged demo (one command)

Your **only** requirement is your own Meta API key. No other credential,
account, or hosted service is needed.

```sh
# from the repo root, with your key in the environment:
MODEL_API_KEY=<your-meta-api-key> sh start.sh
```

No key handy? `sh start.sh` still starts — the proxy reports
`keyPresent:false` and the demo runs on explicitly labelled stub/cached
fallbacks. (Alternatively, put a `meta-api-key=<key>` line in
`.env/secrets` — that file is gitignored and never committed.)

Then open this URL in a browser:

**[http://localhost:8000/mock-dm.html](http://localhost:8000/mock-dm.html)**

`start.sh` starts three local processes together and waits until all
three answer: the Meta-model proxy (`127.0.0.1:8905`), the mock DM bot
(`127.0.0.1:8904`), and the static server (`localhost:8000`). Ctrl-C
stops all three. Ports can be overridden with `PROXY_PORT`, `MOCK_PORT`,
`STATIC_PORT`.

### Live Instagram bot mode (local-only, for Autumn's machine)

The default judged path is mock-only (synthetic data). To test against
the already-running real Instagram bot at `127.0.0.1:8903`:

```sh
LIVE_IG=1 sh start.sh
# Optional: LIVE_BOT_BASE=http://127.0.0.1:8903 LIVE_IG=1 sh start.sh
```

**Prerequisites:**

- The real bot must already be running on `127.0.0.1:8903` (local-only,
  no nginx/public route — see `docs/instagram-bot-api.md` §As implemented).
  Verify: `curl --noproxy '*' http://127.0.0.1:8903/healthz` → `ok`.
- Your `.env/secrets` must contain the three local-only bearer tokens
  (never committed, never printed): `ig-bot-token` (read, `IG_API_TOKEN`),
  `ig-storage-token` (catalog, `IG_API_STORAGE_TOKEN`), and `ig-send-token`
  (send, `IG_API_SEND_TOKEN`). The read token is the same var the bot's
  own `secrets.env` calls `IG_API_TOKEN`; catalog/send use their separate
  tokens — the Graph token `IG_GRAPH_SEND_TOKEN` is never used for reads.
  If the file only has `ig-bot-token`, `start.sh` falls back to
  `~/secure-webserver/igwebhook/secrets.env` for the other two (same
  machine, same local-only scope).
- No token value is printed in logs or in the browser; `start.sh` emits
  only endpoint URLs.

**What happens:**

- `start.sh` generates `app/ig-runtime-config.js` from local secrets
  (gitignored, browser-readable) mapping the three clients to `127.0.0.1:8903`
  with their separate bearer credentials. The file is removed on exit
  (if you had a hand-written `app/ig-runtime-config.js` before, it is left
  untouched).
- Only two processes start: proxy + static (no mock bot on 8904). The app at
  `http://localhost:8000/mock-dm.html` then reads from / writes to the real
  bot: inbox shares/media via `IG_API_TOKEN`, catalog via
  `IG_API_STORAGE_TOKEN`, sends via `IG_API_SEND_TOKEN`.
- Readiness checks `GET /health` (proxy), `GET /mock-dm.html` (static), and
  `GET http://127.0.0.1:8903/healthz` (live bot). No bearer token appears in
  any `curl` command line, process arg, stdout, or stderr.

**What to do in Instagram:**

- DM the connected account (SecondBloom / `17841417613087488`) — a photo, a
  shared post/reel, or a plain text message. The share appears in the app
  inbox after the next poll.
- Since the live bot is consent-gated (see
  `~/secure-webserver/igwebhook/docs/data-management-and-consent.md`),
  the sending Instagram account must be onboarded/granted before items
  appear: new senders receive a ToS/privacy/Meta-API-use disclosure and
  must reply `YES` / agree within 24 h, or their data is scrubbed.
  Un-consented shares never surface in `GET /ig/shares`.
- The `user_ref` / catalog flow works for that account: `user_ref` is the
  stable per-sender id on every `GET /ig/shares` item; `PUT /ig/catalog/<user_ref>`
  and `GET /ig/catalog/<user_ref>` persist the wardrobe scoped to that
  `user_ref` (per-user AES-256-GCM at rest on the bot).

**Warning — real sends:**

- In live mode the app's `Send as app` button and the `Propose look`
  path route to the real bot's `POST /ig/send` (local-only,
  `IG_API_SEND_TOKEN` + `IG_GRAPH_SEND_TOKEN` + 24 h window). **They only
  fire on explicit user clicks** — no automatic sends, no background sends.
  The mock's window/duplicate behaviour (422, 409) is enforced identically
  on the live bot. Do not click Send unless you intend a real DM.
- The judged demo (`sh start.sh` without `LIVE_IG`) never touches the live
  bot and never sends a real DM — mock-only by default.

## The 2-minute judge walkthrough (the video arc)

1. **Share photo 1** (a dress — use any local image): it lands as an
   inbound bubble. The assistant turn catalogues it as the first wardrobe
   piece and answers honestly: a base alone isn't a full look yet — it
   needs exactly one finish (a layer, or a scarf + bag).
2. **Share photo 2** (a layer, e.g. a cardigan): the reply reaches back
   across the wardrobe and proposes one look combining the dress from
   photo 1 with the layer from photo 2, citing both sources — re-validated
   by the fit rules (valid full look).
3. **One purchase suggestion:** the thread ends with a single next buy
   (e.g. a bag, so the scarf look in the wardrobe completes next).

Try the loop: type "no bag" as a user text turn and the look is
re-proposed minus the bag and re-validated; ask about fabric or price and
the agent says plainly it doesn't have that data — it never invents a
listing. The full 3-minute narration is in
[`docs/demo-video-script-19g.md`](docs/demo-video-script-19g.md).

## What's real vs stub/cached fallback (honest table)

| Surface | Live (with your key) | Without key / offline |
|---|---|---|
| Segmentation | SAM 3.1 via proxy | Deterministic stub polygons / manual box |
| Classification + copy + assembly | Muse Spark 1.3 via proxy | Labelled heuristic + placeholder copy (`placeholder:true`) |
| Look preview image | Muse Image 1.0 via proxy | Watermarked canvas collage |
| Repeat calls | Proxy + `localStorage` cache, labelled `cached:true` | Same cache replays |
| DM thread + sends | Local mock bot (synthetic data only) | Identical — the mock is the judged path |

The browser never sees your key: `meta-api-proxy/server.js` holds it
server-side from the process environment and exposes only narrow local
routes (`/api/segment`, `/api/classify`, `/api/copy`, `/api/assemble`,
`/api/preview`, `/health`). The demo chat is mock-only — real Instagram
DM sends are an explicit stretch goal, not wired in.

## Repo map

- [`start.sh`](start.sh) — one-shot install+run (this README's command).
- `app/mock-dm.html` — the judged chat surface (thread + operator panels).
- `app/turn-loop.js`, `app/wardrobe-catalog.js`, `app/send-client.js`,
  `app/poll-scheduler.js` — the conversation loop, per-user wardrobe,
  mock-only send client, and polling/window discipline (all synthetic
  `SYNTH_` ids; `node --test app/test/*.test.js` runs the suite).
- `app/index.html` — unlinked dev/debug tool (manual segment/tag/assemble
  without chat); not part of the judged demo.
- `meta-api-proxy/` — key-holding proxy (`server.js` + standalone
  `start.sh` for proxy-only runs).
- `mock-ig-bot/` — synthetic offline bot implementing the real bot's API
  contract so the app runs unchanged against it.
- `docs/` — specs and plans, including the video script and the
  prior-work boundary (`docs/prior-work-instagram.md`: the pre-hackathon
  SecondBloom integration is documented there, never vendored into app
  code or demoed as a hackathon feature).

## Boundaries a judge should know

- **New work only:** everything demoed was built during the hackathon
  window (Oct 27 – Nov 4, 2026); prior work is disclosed, dated, and
  separate (see `docs/prior-work-instagram.md`).
- **Synthetic demo data only:** fixtures use `SYNTH_` ids and
  `example.invalid` URLs; no real captured Instagram content is in this
  repo.
- **No secrets in the repo:** keys live in untracked `.env/secrets` or
  the process environment, never in source, commits, or logs.
