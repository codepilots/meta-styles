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
