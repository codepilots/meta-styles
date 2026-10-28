# decisions

| # | Decision | Why | Date |
|---|---|---|---|
| 1 | Enter Indie developer track, theme "Build for Your World" | Solo builder, firsthand fit/sourcing problem; Push the Frontier doesn't fit | 2026-10-14 |
| 2 | Disk folder ~/projects/meta-styles, vault Projects/meta-styles | User-chosed slug; keeps disk + vault aligned | 2026-10-14 |
| 3 | v1 outputs full-look cards (base + layer/scarf/bag, no shoes), natural proportions, ≤300w per-piece vendor-grounded copy | Carries over proven boutique conventions instead of inventing new ones | 2026-10-14 |
| 4 | Meta Model API key lives at `.env/secrets` as `meta-api-key=...`, sourced into the process environment (never read/printed by agents, never committed) | Autumn supplied real credentials for Milestone 3+; `.env/` is gitignored at repo root | 2026-10-28 |
| 5 | Milestones 5-8 (Instagram DM-share integration) reuse SecondBloom's existing receiving IG account (`17841417613087488`) and app (`29264663606459560`) — no separate account/app | Already-deployed, already-verified identity; avoids a second App Review process | 2026-10-28 |

## Secrets / environment
- `.env/secrets` holds `meta-api-key=<value>` for the Meta Model API (Muse Spark / Muse Image / SAM 3.1), and also holds `ig-bot-token=<value>` (added 2026-10-28) for the local-only Instagram bot API — a separate credential for a separate service, never reused across the two.
- `.env/` is gitignored (see `.gitignore`) — never commit it, never cat/print its contents in a chat, log, or agent transcript.
- To use it: **don't `source` it** — `meta-api-key` / `ig-bot-token` contain hyphens, which are not valid shell variable names (bash prints `command not found`). Parse it instead (split each line on the first `=`), e.g. Python: `dict(l.rstrip("\n").split("=", 1) for l in open(".env/secrets") if "=" in l)`, and pass values to code via env vars with valid names. Code should reference the key name, never the literal value.
- Any agent (including Muse Code) working in this repo should treat `.env/secrets` as read-only-by-reference: wire real API calls to pull from env, don't inline keys into source, don't echo the file.

## Decision (Autumn, 2026-10-28, updated same day)
The SecondBloom Instagram bot/webhook deployment (`igwebhook`, app `29264663606459560`) is treated entirely as **prior work** — it predates the hackathon and nothing added to it counts toward this submission's "built during the hackathon" claim. **Update:** Autumn will add the Muse-designed read API (`docs/instagram-bot-api.md`) to that deployment herself, as maintenance of the existing prior-work project — not as hackathon-built functionality, and not inside this repo. This resolves `docs/instagram-bot-api.md` open question #2: adding the API to the bot is fine *as prior-work maintenance*; it must never be presented in the submission/demo as something built during the hackathon window.

**Consequence for the roadmap:** Milestone 9 is **un-blocked on the bot side** (Autumn builds the API there, outside this repo, not claimed as new work) but the **hackathon's own new work is only the meta-styles-side client** that calls it — the integration module in `app/` replacing the Milestone 5 fixture-only bridge. `docs/prior-work-instagram.md` must stay accurate: once the bot gains the new API, update its description there too, still dated/labelled as prior-work infrastructure, not a meta-styles feature. Milestones 6-8 can proceed once the bot API is live.
- Startup track (parked): needs production-readiness story + team; revisit only if co-founder joins.
- Generic retail affiliate styling (rejected): crowded, wrong body model, contradicts resale-first taste.

## Open questions
- [x] Which open-weights base to build on before Meta Model API access lands? — resolved 2026-10-28: real Meta API key now provisioned (see Secrets section above); Milestone 3 can call the live API instead of an open-weights fallback.
- [ ] Reuse boutique-ui as the frontend shell or fresh minimal Next.js app?
- [ ] Application Q&A: paste each form question as it appears (login-gated) for per-field drafting.
- [ ] Discord thread from earlier today: import the styling-app details agreed there.
