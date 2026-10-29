# meta-styles · Full-look cards (Meta AI live, Milestone 14)

Minimal zero-install web app: pick a photo, segment garments with SAM 3.1,
classify and assemble complete looks with Muse Spark validated by the
hardcoded fit rules (base + one layer, or scarf + bag — never shoes), then
share a card with Spark copy and a Muse Image preview. Every live call
keeps a labelled stub as its offline fallback.

## Run it

Live mode (two local processes, no build step, no dependencies):

1. From the repo root: `sh meta-api-proxy/start.sh` — the Meta Model API
   proxy on `http://127.0.0.1:8905`. It reads the API key from
   `.env/secrets` into its own process env (never printed, never sent to
   the browser). Check it: open `http://127.0.0.1:8905/health`.
2. From `app/`: `python3 -m http.server 8000`, then open
   [http://localhost:8000](http://localhost:8000) in a browser.

Offline mode: skip step 1. The app still runs end-to-end on its stub
fallbacks and says so (`placeholder:true`). Opening `index.html` via
`file://` works for the core flow; the inbox bridge needs HTTP.

## What's real vs stubbed

- **Real:** image loading (3 cached local demos + your own uploads via file
  picker), canvas rendering, mask overlay display with opacity toggle, manual
  box draw / move / corner-resize with a live coordinate readout.
- **Stubbed:** segmentation itself. `StubSegmentationService` in `app.js`
  returns deterministic placeholder polygons per demo image (generic shape for
  uploads) after a short fake delay. No external AI API is called.
- **Superseded (Milestone 14):** live SAM 3.1 now runs via the proxy —
  see "Live Meta AI" below. This stub remains the offline fallback.

## What's real vs stubbed (Milestone 2)

- **Real:** fit-rule engine (`assembleLook` in `assembler.js`) — base +
  exactly-one-finish validation, two-layer and shoe rejection, ≤300-word
  budget enforcement with trimming; region thumbnail crops; full UI flow
  (tag → wardrobe → look card with validity badge).
- **Stubbed:** classification itself (`classifyRegion` in `classifier.js`
  is a deterministic hint/geometry/hash heuristic — `TODO(model)`); per-piece
  copy is invented placeholder text (`placeholder:true` + provenance note on
  every record, never presented as real listings); segmentation still the
  Milestone 1 stub.
- **Try the rejections:** tag one region as `layer/cardigan` and another as
  `layer/blazer` to see the two-layer flag; add `shoes` to see the exclusion;
  add only a scarf or only a base to see the incomplete-card flags.

## DM-share inbox bridge (Milestone 5 — synthetic fixtures, not a live webhook)

- **Source:** the "Import from DM inbox" button reads the locally created
  `inbox-fixtures/shares.jsonl` plus the placeholder SVGs next to it. Every
  id, url, and caption there is invented for demo/testing; the entries only
  mirror the real SecondBloom payload shape (`ig_post` attachments carry
  `ig_post_media_id`/`title`/`url`, directly-sent photos carry `image`/`url`).
  No real Instagram data is vendored or referenced anywhere in this repo.
- **Alternate source, not a replacement:** picking a fixture entry calls the
  same `loadImage()` path as uploads and demo photos, so the
  mask-viewer/classifier/assembler pipeline downstream is unchanged.
- **Needs HTTP:** `fetch()` can't read the fixture file over `file://` — serve
  with `python3 -m http.server 8000` from `app/` (above) to use the bridge.
- **Future work (not in scope):** wiring this to the real SecondBloom
  webhook's live `shares.jsonl`/media output must only ever happen at runtime
  from a path Autumn configures, never by copying real SecondBloom data into
  this repo.

## Files

| file | purpose |
|---|---|
| `index.html` | single-page UI shell |
| `inbox-bridge.js` | inbox bridge: fixture list UI, feeds picks into `loadImage()` |
| `inbox-fixtures/` | synthetic demo fixtures (`shares.jsonl` + placeholder SVGs) |
| `styles.css` | plain styling, no framework |
| `app.js` | viewer logic + stubbed segmenter + look-card UI wiring |
| `classifier.js` | taxonomy + classifier stub + placeholder copy bank |
| `assembler.js` | fit rules + card assembly + word-budget cap |
| `spark.js` | Spark copy-generator stub (`generateCopy`, `TODO(Spark-API)`) |
| `preview.js` | mock preview-image stub (`generateImage`, `TODO(Image-API)`) |
| `demo-look-*.svg` | locally created placeholder demo photos |

## What's real vs stubbed (Milestone 3)

- **Real:** share-card layout (mock preview image + Spark copy + validity
  badge side by side), client-side **Copy card as text** (Clipboard API with
  `execCommand` fallback) and **Download preview image** (canvas PNG via
  `toDataURL`, no server); word-budget enforcement shared with Milestone 2
  (title + pieces + story + fit note ≤ 300 words, trimmed and flagged).
- **Stubbed:** `generateCopy` in `spark.js` returns invented longer-form
  Y2K x fairycore copy (`placeholder:true`, `source:"stub"` —
  `TODO(Spark-API)`); `generateImage` in `preview.js` draws a canvas collage
  from category swatches + your thumbnail crops, watermarked "mock preview"
  (`placeholder:true` — `TODO(Image-API)`).
- **To go live:** replace the body of `generateCopy` with the Muse Spark
  Model API call and the body of `generateImage` with the image-endpoint
  call. Both keep their return shapes, so the share-card UI needs no
  changes. No live Meta API calls yet; `.env/secrets` is never read —
  Autumn reviews the env plumbing before anything goes live.

## Live Meta AI (Milestone 14 — implemented 2026-10-28)

- **Architecture:** browser → `app/meta-client.js` → local proxy
  (`meta-api-proxy/server.js`, Node stdlib, `127.0.0.1:8905`) → Meta Model
  API (`https://api.meta.ai/v1`, key from the proxy's env only). The
  browser never sees the key. API shapes verified against the official
  docs (dev.meta.ai) and live calls, 2026-10-28.
- **SAM 3.1** (`POST /api/segment`): one noun-phrase call per garment type
  via `/v1/responses`; SAM box records are parsed into normalized
  polygons (mask rasters are reported as metadata — true mask outlines
  via `@meta-sam/parser` are future work). Zero matches falls back to the
  stub/manual box, never a dead end.
- **Muse Spark 1.3** (`/api/classify`, `/api/copy`, `/api/assemble`):
  vision classification onto the fixed taxonomy (Spark proposes, the
  taxonomy + fit rules dispose), look proposals validated by
  `assembleLook` with rejections shown, and ≤300-word copy through
  `generateCopyFromModel`. `placeholder:false` only on live results.
- **Muse Image 1.0** (`/api/preview`): flat-lay look-card preview (never a
  worn try-on), drawn into the share-card canvas; the watermarked canvas
  collage remains the offline fallback.
- **Cached mode:** successful segment/copy results cache in the proxy and
  in `localStorage`; proxy-down replays them labelled `cached:true`.
- **Tests:** `node app/test/milestone14-meta-api.test.js` (39 assertions,
  fake upstream — no key needed). Live proof 2026-10-28: one real call
  per endpoint through the proxy, all 200.
- Also update the file table: `meta-client.js` is the proxy client;
  `../meta-api-proxy/` holds the server (`server.js` + `start.sh`).
