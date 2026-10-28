# meta-styles · Milestone 1 — Mask viewer

Minimal zero-install web app: pick a photo, view a garment-segmentation mask
overlay, or draw a manual rectangle box as a fallback selection.

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

## Files

| file | purpose |
|---|---|
| `index.html` | single-page UI shell |
| `styles.css` | plain styling, no framework |
| `app.js` | viewer logic + stubbed segmenter |
| `demo-look-*.svg` | locally created placeholder demo photos |
