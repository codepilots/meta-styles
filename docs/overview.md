# overview

Pitch: meta-styles is Autumn's entry for the Meta Global AI Developer Hackathon (Cerebral Valley, remote, 26 Oct – 4 Nov 2026 EST). A styling app that turns a mirror selfie / wardrobe photo into complete look cards — base + layer/scarf/bag, no shoes — with per-piece, vendor-grounded copy, tuned for tall/curvy fit (6'2", size 18 top / 12 bottom) and Y2K × fairycore taste.

Status (2026-10-30): Milestone 14 (real Meta Model API — Spark, Image, SAM
3.1) is live via `meta-api-proxy/`, not a stub. Milestone 19's chat-first
pivot (decision #8) made the persistent wardrobe + Instagram-style DM chat
(`wardrobe-service/`, `mock-dm.html`) the live product surface; the old
`app/index.html` panel UI stays in-repo only as an unlinked dev/debug tool
(decision 8(1)), not demoed. Milestone 21's router + agentic skill set is
built and wired into the chat loop; Milestones 22–23 (stub/honesty audits —
fake image URLs, a vision-less `What_suits`, an unenforced purchase hold,
context-blind `explain_fit`, a wrong-for-half-of-looks `FIT_NOTE`) are all
landed and tested. Judge delivery is a **local one-shot install+run**
(judge supplies only their own Meta API key) per decision 8(3) — a hosted
live URL is explicitly a stretch goal, not required. Fabric/price/vendor
grounding is fully descoped per decision 8(4). Submission cut is
Milestone 4 in `docs/roadmap.md`. Application submission state is not
recorded in this repo — see the Milestone 4 check.

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
