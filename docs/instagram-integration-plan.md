# Instagram integration plan (DM-share → look-card pipeline)

Input path alternative to the Milestone 1 in-app upload/demo picker: user shares a wardrobe photo to an IG account via DM, it flows into classifier.js / assembler.js / spark.js / preview.js.

## Milestone 5 — DM-share inbox bridge
- Build: file-drop importer in this repo reading a copy of SecondBloom `shares.jsonl` + `data/media/` into a meta-styles inbox dir.
- Reuse as-is: `igwebhook` receiver container + nginx at `.../ig/webhook`, handshake + `X-Hub-Signature-256` verify, `events.jsonl`/`shares.jsonl` writers (docs/prior-work-instagram.md; skills/meta-instagram-integration/SKILL.md §5).
- Risk: polling a foreign service's data dir is fragile; no new webhook yet keeps this independently shippable.

## Milestone 6 — DM photo → look-card pipeline
- Build: wire inbox images into classifier.js / assembler.js (base/layer/accessory + colour links + style keywords).
- Reuse as-is: immediate-download rule for expiring `lookaside.fbsbx.com` signed URLs, `ig_post` vs `image` payload shapes (SKILL.md §7; references/access-routes.md).
- Risk: signed URLs die fast — anything not downloaded on arrival is lost; carousels give first image only.

## Milestone 7 — reply-back share card — SUPERSEDED/DESCOPED 2026-10-31

**Superseded.** Decision #8(2) (M19 pivot, Autumn, 2026-10-29) settled this
submission's sends as mock-only (`mock-ig-bot/`); a real reply-back send is
a stretch goal only, gated by the compliance skill's send-approval rule if
ever pursued. Leaving the original plan below for record — do not build it
for this submission without Autumn reopening it.

- Build: send spark.js / preview.js output back via `POST graph.instagram.com/me/messages` within the 24h reply window.
- Reuse as-is: token-from-env reply script pattern, skip `is_echo` events (SKILL.md Pitfalls; references/access-routes.md).
- Risk: replies outside 24h fail; echoes must be filtered or the bot loops on itself.

## Milestone 8 — production hardening — SUPERSEDED/DESCOPED 2026-10-31

**Superseded.** Same decision #8(2)/(3): this submission ships as a local
one-shot judge install+run with mock sends only, so App Review/production
hardening for real Instagram traffic is out of scope here — it would only
matter for a future real-send stretch goal, not this submission. Leaving
the original plan below for record.

- Build: App Review request for `instagram_business_manage_messages`, published-app + per-account webhook-subscription checklist (SKILL.md §4/§6).
- Reuse as-is: SecondBloom live app + privacy/terms/deletion pages as the reference submission.
- Risk: App Review takes days — start early; non-tester traffic is gated until approval.

## Decision (Autumn, 2026-10-28)
Reuse SecondBloom's existing receiving IG account (ID `17841417613087488`) and app (`29264663606459560`) for meta-styles — no separate account/app. Milestones 5-8 build on that existing deployment as-is; no new App Review scope beyond what SecondBloom already has unless a milestone specifically needs it.
