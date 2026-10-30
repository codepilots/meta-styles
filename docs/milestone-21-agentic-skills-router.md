# Milestone 21 — Agentic wardrobe skills + router (Muse Spark)

Status: **SPEC — ready to delegate to Muse (Muse Spark).** Builds on vault `05` + `06` skill cards refined with Muse Spark on 2026-10-30.

Related: `vault/Projects/meta-styles/05 Agentic interaction design — skills + router` (principles) + `06 Skill cards — detailed prompts` (per-skill cards). Product reframing: decisions #7-#8 (wardrobe is the product, chat is one interface). Depends on persistent catalog + consent-gating already in place.

## Goal

Replace the current single-prompt chat turn with a true proscriptive agentic loop:

```
incoming DM → router (intent → skill, confidence 0-100) → [clarification if <70 else skill card] → skill executes → rolling summary + preferences update → reply
```

Every reply must be the result of invoking exactly one of 11 bounded skills (each skill may itself loop up to 20 tool steps, logging count for analysis). No free-chat outside this list. Router decision + skill choice are logged for provenance (judges: Best Agentic Use-Case).

## Skills (11)

| # | Skill | Trigger |
|---|-------|---------|
| 1 | `catalogue_piece` | Photo(s) shared |
| 2 | `propose_look` | "show me a look" / auto after catalogue |
| 3 | `revise_look` | "no bag", "without blazer" |
| 4 | `describe_wardrobe` | "what do I have?" |
| 5 | `explain_fit` | "why does this work?" |
| 6 | `answer_no_data` | fabric/price/vendor (descoped) |
| 7 | `off_topic` | anything else → friendly deflection + guide link |
| 8 | `Match_look` | "Can you help me do this look?" + inspiration photo (read-only) |
| 9 | `Complete_the_look` | "what could I buy to complete the look" → Vinted search URL |
| 10 | `What_suits` | "what would suit me?" → colour/style advice from head+body shots |
| 11 | `Evaluate_prospective_purchase` | photo of item they could buy → fit assessment + sample outfits (text first) |

Detailed per-skill prompts: vault `06` — each card defines trigger, input (wardrobe + history + summary + preferences + image), steps, tools, output format, and "never do".

## Key design decisions (from 05 §7, 2026-10-30)

- **Persona:** cheery good green witch, cosy boutique tea room, warm complimentary, fairy-core whimsical, never shaming, never long IDs.
- **Match_look (8):** inspiration photo read-only, describe style/aesthetic/colours, delete immediately, propose only from user's wardrobe + preview of user's items.
- **Complete_the_look (9):** generic Vinted search URL only, never specific listing.
- **Evaluate_prospective_purchase (11):** text-first, preview on request, 24hr temp hold then discard unless purchased.
- **What_suits (10):** requires head + full-body shot, explicit consent, encrypted via bot API, deletable ("delete my photos").
- **Photo consent:** all retained user photos via encrypted `PUT /ig/catalog/<user_ref>`, deletable.
- **Memory:** per-user rolling 100-token summary (updated each turn) + separate 100-token long-lived preferences, both via bot catalog API, never user-facing — used as next-turn context.
- **Off-topic:** mobile-first per-skill guide at `codepilots.co.uk/secondbloom/guide.html`, friendly/grounded.
- **Router:** <70 confidence → single clarification question, else best skill.
- **IG-ready look cards:** image carries Second Bloom logo + handle overlay; caption text separate for sharing.

## Build spec (for Muse delegate)

**New files:**
- `app/router.js` — intent classifier → `{ skill, confidence, reason }` via Muse Spark (structured output). Input: user message + last 2-3 turns + wardrobe summary + preferences + image presence flag. Threshold 70.
- `app/skills/` — 11 skill modules, each: `prompt.md` (card from vault 06) + `handler.js` (tool calls: catalog API, SAM 3.1, Spark, Image, assembler/validator). Shared `persona.md` base.
- `app/summariser.js` — after each turn, generate fixed-length summary + preferences delta, `PUT` to catalog API.

**Wiring:**
- `wardrobe-service/server.js` (M20, in progress) is the runtime: polls `GET /ig/shares`, drives `router → skill → summariser → POST /ig/send`. Browser becomes thin client reading `GET /wardrobe/status`.
- If M20 not yet landed, Muse may build against a test harness calling router/skills directly with synthetic fixtures (`SYNTH_` ids, `example.invalid` URLs).

**Persistence:**
- Wardrobe + summaries + preferences: `PUT /ig/catalog/<user_ref>` only — no local file/DB for piece data (same constraint as M20). Router decisions logged alongside for provenance.

**Testing:**
- Unit: router classification (each skill + off-topic + <70 clarification) with synthetic messages.
- E2E serve-and-curl: inject photo/text via `POST /mock/incoming-photo|text`, assert skill chosen, reply sent, summary persisted, no invented listings.
- Existing 14 test files stay green; add `wardrobe-service/test/` + `app/test/router-skills.test.js`.
- Demo data synthetic only (`SYNTH_` prefix) — never real DM data.

**Submission note:** This is the "agentic" story for judging — frame as bounded tool-use, not a generic chatbot. Each skill is auditable, logged, and testable.

## Acceptance

- [ ] Router correctly classifies all 11 skills + off-topic in tests
- [ ] Clarification path fires at <70 confidence (single question, no skill execution)
- [ ] Each skill's card prompt produces IG-ready output per spec (image + separate caption where applicable)
- [ ] Rolling summary + preferences persist per-user via catalog API and are used as next-turn context
- [ ] Off-topic links to per-skill mobile guide, friendly/grounded copy
- [ ] Full test suite green, no long IDs in user-facing replies

## Open questions

- Hosted guide: single-page vs per-skill deep links? (Autumn leans per-skill, mobile-first — confirm URL structure on build.)
- Should `Match_look` inspiration description be stored anywhere (e.g. in summary) or fully discarded?
