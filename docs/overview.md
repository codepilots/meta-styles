# overview

Pitch: meta-styles is Autumn's entry for the Meta Global AI Developer Hackathon (Cerebral Valley, remote, 26 Oct – 4 Nov 2026 EST). A styling app that turns a mirror selfie / wardrobe photo into complete look cards — base + layer/scarf/bag, no shoes — with per-piece, vendor-grounded copy, tuned for tall/curvy fit (6'2", size 18 top / 12 bottom) and Y2K × fairycore taste.

Status (2026-10-28): Milestones 1–3 built as stub-backed UI/flow (no real Meta
Model API calls yet — that integration is the pass/fail gate, see Milestone 14
in `docs/roadmap.md`), Milestones 5/6/9 and the Milestone 13 mock demo path
built; submission cut is Milestone 4 in `docs/roadmap.md`. Application
submission state is not recorded in this repo — see the Milestone 4 check.

Platform: web app (likely Next.js static export, reusing boutique-ui patterns). AI layer: Meta Model API — Muse Spark (outfit reasoning/copy), Muse Image (look visualisation / background cleanup), SAM 3.1 (garment segmentation from photos). Open-weights fallback noted for offline demo.

Inspirations: existing [[Upcycled Boutique]] sourcing/review pipeline, [[Boutique UI]] frontend, [[Outfits]] personal log. Differentiator: fit-first + resale-grounded, not generic "shop this look".

## Doc map

| file | contents |
|---|---|
| docs/overview.md | this index: pitch, status, platform |
| docs/brief.md | hackathon facts: dates, tracks, themes, scoring |
| docs/pitch.md | firsthand problem, differentiator, risks, build plan, demo fallbacks |
| docs/decisions.md | numbered decisions log |
| docs/roadmap.md | milestones, milestone 0 buildable in one session |
| docs/prior-work-instagram.md | SecondBloom Instagram DM-share bot — prior work, built pre-hackathon, not part of this repo's code |
| skills/meta-hackathon-compliance/SKILL.md | compliance notes sourced from the Organizers' Official Rules (judging criteria, IP terms, eligibility) |
| AGENTS.md | repo root — mandatory rules for any AI agent working here, requires reading the compliance skill first |
