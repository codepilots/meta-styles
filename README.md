# meta-styles — your wardrobe, styled in chat

A hackathon entry for the Meta Global AI Developer Hackathon (Indie
Developer track): an agent that builds a persistent wardrobe from the
photos you share, then styles validated full looks from it — conversing
through an Instagram-DM-style chat thread.

Three Meta models do the heavy lifting, all called through one
local proxy: **SAM 3.1** segments each photo into garments, **Muse
Spark 1.3** classifies them, reasons about assembly, and writes the copy,
and **Muse Image 1.0** renders the look preview. Every proposal passes a
real fit-rule engine (base + exactly one finish; two-layer and shoe
rejections; ≤300-word budget), and every turn leads with the wardrobe
payoff: what was catalogued, what look the catalog produced, what the
validator said, what to buy next. Not a photo classifier in isolation.

## Requirements

- Node 18+ and Python 3 — that's it. There is **no `npm install`**: the
  app has zero JavaScript package dependencies.
- Your own Meta API key (see the next section) — the only requirement for
  the real-model experience. No account, no hosted service, nothing else.

## Quickstart

```sh
git clone <this repo> && cd meta-styles

# with your key in the environment:
MODEL_API_KEY=<your-meta-api-key> sh start.sh

# or with no key at all (everything still runs — see below):
sh start.sh
```

Then open **[http://localhost:8000/mock-dm.html](http://localhost:8000/mock-dm.html)**
in a browser on the same machine. Use the hostname `localhost` exactly —
not `127.0.0.1` — because the demo's API trusts only the `localhost`
origin string (same host, different string, silently blocked). Ctrl-C
stops the whole stack.

Two surfaces ship, both driven by the same four-process stack:

- **[`mock-dm.html`](http://localhost:8000/mock-dm.html) — the demo
  harness**: the chat plus the operator panels — illustrated how-to,
  connection controls, manual Send-as-app / Propose look buttons, and
  the stale-share / duplicate-send demos.
- **[`chat.html`](http://localhost:8000/chat.html) — the chat-only
  page**: just the Instagram-DM-style thread and a composer (type a
  message, share a photo) with everything operator-side hidden and
  non-editable internal defaults. Same conversation loop, polling
  cadence, and live/runtime wiring as the harness; the clean view when
  you want to watch the conversation itself.

## Setting your Meta API key

Get a key from Meta's developer site — see the [Meta Model API quickstart](https://dev.meta.ai/docs/quickstart).
Two supported routes; pick one:

1. **Environment variable** (simplest):

   ```sh
   export MODEL_API_KEY=<your-meta-api-key>
   sh start.sh
   ```

2. **A local secrets file** the launcher parses automatically:

   ```sh
   echo "meta-api-key=<your-meta-api-key>" > .env/secrets
   sh start.sh
   ```

   The whole `.env/` directory is gitignored — the key is never committed,
   never printed, and never reaches the browser.

**No key handy?** The stack still runs: the proxy reports
`keyPresent:false` and the demo falls back to clearly labelled stubs and
cached results instead of failing (table below). Perfect for a first
tour; use a real key for the actual model behavior.

**Keyless-by-design details:** the demo data is synthetic from the start
(`SYNTH_` ids, `example.invalid` URLs — no real Instagram content in this
repo), and the chat needs no Instagram credential at all: a mock bot with
the same API shape as a real Instagram integration runs locally.

## What you'll see (the 2-minute walkthrough)

1. **Share photo 1** (a dress — any local image): it lands as an inbound
   bubble; the assistant catalogues it as the first wardrobe piece and
   answers honestly: a base alone isn't a full look yet — it needs
   exactly one finish (a layer, a scarf, a bag, or a scarf + bag).
2. **Share photo 2** (a layer, e.g. a cardigan): the reply proposes one
   look combining the dress from photo 1 with the layer from photo 2,
   citing both sources, re-validated by the fit rules.
3. **One purchase suggestion:** the thread ends with a single next buy
   (e.g. a second finish for the dress).

Try the loop: type "no bag" and the look is re-proposed minus the bag,
re-validated; ask about fabric or price and the agent says plainly it
doesn't have that data — it never invents a listing. The full 3-minute
narration is in
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
`/api/preview`, `/health`). Automatic replies are sent by the companion
wardrobe service, not the page; the manual Send-as-app panel stays for
operator-composed turns.

## The four processes

`start.sh` starts them together and waits until all answer:

| Port (default) | Process | Role |
|---|---|---|
| `localhost:8000` | static server | the chat page you open |
| `127.0.0.1:8904` | mock-ig-bot | synthetic inbox the chat polls |
| `127.0.0.1:8905` | meta-api-proxy | holds your key, calls Meta models |
| `127.0.0.1:8906` | wardrobe-service | catalogues shares, sends auto-replies |

Ports can be overridden with `STATIC_PORT`, `MOCK_PORT`, `PROXY_PORT`,
`WARDROBE_PORT`. The full launch/verify/restart playbook (including a
same-origin proxy mode that also serves the demo over a Tailscale link)
lives in [`skills/demo-launch/SKILL.md`](skills/demo-launch/SKILL.md).

## Running the tests

```sh
node --test app/test/*.test.js wardrobe-service/test/*.test.js
```

## Live Instagram mode (bot operators only, not part of the judged demo)

The default run is mock-only and never touches Instagram. To point the
same app at the *real* (pre-hackathon, separately-operated, local-only)
Instagram bot instead of the mock:

```sh
LIVE_IG=1 sh start.sh
```

This requires the bot already running on `127.0.0.1:8903`, three local
bearer tokens in `.env/secrets`, and strict respect for the bot's
consent gate — un-consented senders never surface. Automatic replies are
armed in this mode: real DMs go out, so only use it on your own local
setup. The open `localhost` URL is a hard requirement here too: the live
bot trusts exactly one origin (`http://localhost:8000`) and a page
loaded through any other origin fails blocked preflights with no
server-side error. Full setup, what happens, and the boundary story:
[`docs/instagram-bot-api.md`](docs/instagram-bot-api.md) and
[`docs/prior-work-instagram.md`](docs/prior-work-instagram.md).

## Repo map

- [`start.sh`](start.sh) — one-shot install+run (this README's command).
- `app/mock-dm.html` — the judged chat surface (thread + operator panels).
- `app/chat.html` — the chat-only surface: thread + composer, no operator
  panels; same modules, polling cadence, and runtime wiring with internal
  defaults, plus the guide link.
- `wardrobe-service/server.js` — the persistent service that drives the
  chat loop. It wraps `app/turn-loop.js` (per-reply orchestration) with
  the **agentic router + skill set** (`app/router.js`, `app/skills/*`,
  confidence-gated: below 70 it asks for clarification instead of
  guessing) and `app/summariser.js` (per-user rolling preference
  summary). Each inbound share/message becomes exactly one skill
  invocation — catalogue, propose/revise/match a look, explain, evaluate
  a purchase (real 24h hold + expiry), suggest a completion, or decline
  off-topic/no-data — logged per turn.
- `app/turn-loop.js`, `app/wardrobe-catalog.js`, `app/send-client.js`,
  `app/poll-scheduler.js`, `app/auto-reply.js` — the conversation loop,
  per-user wardrobe (with per-piece SAM-cropped photo thumbnails), send
  client (idempotency keys, send-window discipline), polling, and the
  auto-reply wiring.
- `app/index.html` — unlinked dev/debug tool (manual segment/tag/assemble
  without chat); not part of the judged demo.
- `meta-api-proxy/` — key-holding proxy (`server.js` + standalone
  `start.sh` for proxy-only runs).
- `mock-ig-bot/` — synthetic offline bot implementing the real bot's API
  contract so the app runs unchanged against it.
- `live-proxy-server.js` — same-origin relay for live and remote modes.
- `docs/` — specs, plans, the demo-video script, and the prior-work
  boundary (`docs/prior-work-instagram.md`: the pre-hackathon SecondBloom
  Instagram integration is documented there, never vendored into app code
  or demoed as a hackathon feature).

## Boundaries a judge should know

- **New work only:** everything demoed was built during the hackathon
  window (Oct 27 – Nov 4, 2026); prior work is disclosed, dated, and
  separate (see `docs/prior-work-instagram.md`).
- **Synthetic demo data only:** fixtures use `SYNTH_` ids and
  `example.invalid` URLs; no real captured Instagram content is in this
  repo.
- **No secrets in the repo:** keys live in untracked `.env/secrets` or
  the process environment, never in source, commits, or logs.
