# pitch

## Firsthand problem
Autumn is 6'2", tall/curvy (18 top / 12 bottom). Standard styling apps assume sample sizes and full-price retail links. Her real workflow — curated resale sourcing (soft-Y2K × fairycore), fit-conscious review, full-look cards with per-piece grounded copy, shared with friends pre-drop — has no tool that respects fit constraints or secondhand stock. She already runs this by hand across upcycled-boutique, boutique-ui, and the Outfits log.

## What it does (v1)
1. Upload a mirror selfie or garment photo.
2. SAM 3.1 segments garments; Muse Spark classifies (base / layer / scarf / bag; tie-blouses + shrugs = layers over cami, never stacked; no shoes).
3. Spark assembles 2–3 complete look cards from wardrobe + resale candidates, keeping natural image proportions, with per-piece copy ≤300 words vendor-grounded (measurement, fabric, flaw, price).
4. Muse Image renders a clean look-card preview (optional visualisation, not a fake try-on).
5. Shareable look card for friends pre-drop.

## Differentiator vs crowded category
AI stylists are crowded; fit-first resale stylists are not. Competition optimises affiliate retail for standard bodies. meta-styles optimises: tall/curvy fit rules, secondhand-first sourcing, stable curated pairings (auto-remixing orphans flagged, not silently re-paired), collapsed-by-default evidence deep-links. The taste model is Autumn's own reviewed ledger, not generic fashion data.

## Risks
- SAM segmentation quality on mirror selfies (mitigation: crop/pose guidance + manual box fallback).
- Muse Image "try-on" looking fake (mitigation: present as look card, not worn render).
- Resale stock links rotting (mitigation: snapshot price/vendor at card creation, mark stale).
- Sponsor-model API availability pre-event (mitigation: build segmentation + card UI on open weights first, swap in Meta Model API during build window).

## Day-by-day plan (26 Oct – 4 Nov)
- Days 1–2: photo → SAM masks → garment classifier; card UI skeleton.
- Days 3–4: Spark look assembly + fit rules + copy generator.
- Days 5–6: Muse Image previews + share cards + stale-stock handling.
- Days 7–8: polish, cached-demo mode, video.
- Days 9–10: buffer, submission, live-demo rehearsal.

## Demo fallbacks
Cached wardrobe + precomputed masks/cards if live inference fails; non-generative preview (layout with original crops) if image gen is down.
