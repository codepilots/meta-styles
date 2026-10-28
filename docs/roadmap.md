# roadmap

- Milestone 0 (one session): application draft ready. Paste each Cerebral Valley form question here → per-field answers (150–230w), technical-skill answer grounded in a real repo (use a different project than the pitch, e.g. boutique sourcing scanner or rail-data), all links curl-checked. Done = applied before the 20k cap.
- Milestone 1: photo → SAM mask viewer + manual-box fallback (cached demo set).
- Milestone 2: garment classifier + look-card assembler with fit rules.
- Milestone 3: Spark copy generator + Image preview + share card.
- Milestone 4: submission cut — video, cached mode, live rehearsal.
- Milestone 5: DM-share inbox bridge — import SecondBloom shares.jsonl + media/ drop into meta-styles inbox as alternate input to Milestone 1 picker (draws from skills/meta-instagram-integration/SKILL.md §5, docs/prior-work-instagram.md).
- Milestone 6: DM photo → look-card pipeline — feed inbox images through classifier.js / assembler.js with immediate-download rule for expiring signed URLs (draws from skills/meta-instagram-integration/SKILL.md §7, references/access-routes.md).
- Milestone 7: reply-back share card — return spark.js / preview.js output via DM within 24h window, skipping is_echo events (draws from skills/meta-instagram-integration/SKILL.md Pitfalls, references/access-routes.md).
- Milestone 8: production hardening — App Review for instagram_business_manage_messages + published-app / webhook-subscription checklist (draws from skills/meta-instagram-integration/SKILL.md §4/§6, docs/prior-work-instagram.md).
- Milestone 9: bot read-API client — meta-styles-side integration against the API in docs/instagram-bot-api.md (approved for Autumn to build on the bot, as prior-work maintenance, outside this repo — not claimed as hackathon-built). The new work here is only the client module in app/, replacing the Milestone 5 fixture bridge. Unblocks Milestones 6-8.
- See docs/instagram-integration-plan.md for per-milestone build vs reuse vs risks.
