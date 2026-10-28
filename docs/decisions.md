# decisions

| # | Decision | Why | Date |
|---|---|---|---|
| 1 | Enter Indie developer track, theme "Build for Your World" | Solo builder, firsthand fit/sourcing problem; Push the Frontier doesn't fit | 2026-10-14 |
| 2 | Disk folder ~/projects/meta-styles, vault Projects/meta-styles | User-chosed slug; keeps disk + vault aligned | 2026-10-14 |
| 3 | v1 outputs full-look cards (base + layer/scarf/bag, no shoes), natural proportions, ≤300w per-piece vendor-grounded copy | Carries over proven boutique conventions instead of inventing new ones | 2026-10-14 |
| 4 | Meta Model API key lives at `.env/secrets` as `meta-api-key=...`, sourced into the process environment (never read/printed by agents, never committed) | Autumn supplied real credentials for Milestone 3+; `.env/` is gitignored at repo root | 2026-10-28 |
| 5 | Milestones 5-8 (Instagram DM-share integration) reuse SecondBloom's existing receiving IG account (`17841417613087488`) and app (`29264663606459560`) — no separate account/app | Already-deployed, already-verified identity; avoids a second App Review process | 2026-10-28 |

## Secrets / environment
- `.env/secrets` holds `meta-api-key=<value>` for the Meta Model API (Muse Spark / Muse Image / SAM 3.1).
- `.env/` is gitignored (see `.gitignore`) — never commit it, never cat/print its contents in a chat, log, or agent transcript.
- To use it: source the file into the shell/process env before running code that needs it, e.g. `set -a; source .env/secrets; set +a` (or load it in Node/Python via a dotenv-style loader), then read `process.env['meta-api-key']` / `os.environ['meta-api-key']` from code. Code should reference the env var name, never the literal key value.
- Any agent (including Muse Code) working in this repo should treat `.env/secrets` as read-only-by-reference: wire real API calls to pull from env, don't inline keys into source, don't echo the file.

## Options rejected / parked
- Startup track (parked): needs production-readiness story + team; revisit only if co-founder joins.
- Generic retail affiliate styling (rejected): crowded, wrong body model, contradicts resale-first taste.

## Open questions
- [x] Which open-weights base to build on before Meta Model API access lands? — resolved 2026-10-28: real Meta API key now provisioned (see Secrets section above); Milestone 3 can call the live API instead of an open-weights fallback.
- [ ] Reuse boutique-ui as the frontend shell or fresh minimal Next.js app?
- [ ] Application Q&A: paste each form question as it appears (login-gated) for per-field drafting.
- [ ] Discord thread from earlier today: import the styling-app details agreed there.
