# meta-styles · Milestone 2 — Look cards

Minimal zero-install web app: pick a photo, view a garment-segmentation mask
overlay (or draw a manual box), tag regions with the garment-classifier stub,
and assemble a full look card under the hardcoded fit rules (base + one layer,
or scarf + bag — never shoes).

## Run it

No build step, no dependencies. Either:

- Open `index.html` directly in a browser (double-click it), or
- Serve the folder: `python3 -m http.server 8000` from `app/`, then open
  [http://localhost:8000](http://localhost:8000) in a browser.

## What's real vs stubbed

- **Real:** image loading (3 cached local demos + your own uploads via file
  picker), canvas rendering, mask overlay display with opacity toggle, manual
  box draw / move / corner-resize with a live coordinate readout.
- **Stubbed:** segmentation itself. `StubSegmentationService` in `app.js`
  returns deterministic placeholder polygons per demo image (generic shape for
  uploads) after a short fake delay. No external AI API is called.
- **To go live:** implement the `TODO(SAM-3.1)` in `app.js` — POST the image
  to the SAM 3.1 API and return `{ polygons, boxes }` in normalized 0–1
  coordinates. The UI needs no other changes.

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

## Files

| file | purpose |
|---|---|
| `index.html` | single-page UI shell |
| `styles.css` | plain styling, no framework |
| `app.js` | viewer logic + stubbed segmenter + look-card UI wiring |
| `classifier.js` | taxonomy + classifier stub + placeholder copy bank |
| `assembler.js` | fit rules + card assembly + word-budget cap |
| `demo-look-*.svg` | locally created placeholder demo photos |
