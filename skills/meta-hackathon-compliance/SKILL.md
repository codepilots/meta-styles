---
name: meta-hackathon-compliance
description: "Use when working on meta-styles' Meta hackathon entry."
version: 1.0.0
author: Bramble
license: MIT
metadata:
  hermes:
    tags: [hackathon, meta, compliance, meta-styles, rules]
    related_skills: [meta-instagram-integration, muse-code, project-design-docs]
---

# Meta Global AI Developer Hackathon — compliance

For Autumn's **meta-styles** entry (Indie Developer track, theme "Build for
Your World" — see `~/projects/meta-styles/docs/decisions.md`). Event runs
Oct 26 – Nov 4, 2026 (Cerebral Valley x Meta).

## Source and verification

The Organizers' own **Official Rules / Event Waiver** text (not a summary)
was fetched 28 Oct 2026 from
`https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver` via
`web_extract` — this bypasses the client-side login wall that blocks a
plain browser view of that page. Full saved text:
`~/.hermes/profiles/verdant-companion/cache/web/cerebralvalley.ai-ff6be7c2a9.md`.
The Organizers can modify these terms at any time ("Modifications" clause)
— re-fetch the waiver URL before final submission to catch changes.

## Confirmed facts (from the event Discord FAQ "Submissions, prizes and resources", pasted by Autumn 28 Oct 2026)

- **Demo video length confirmed: 3 minutes** — retires the last item that
  was still unverified below.
- **Submission package:** one project per team/startup, submitted by the
  team Representative via
  https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit,
  containing a 3-minute demo video, a public repo link, and every
  contributor's name. Judges assess video, code, and the live product —
  so the app needs to actually run live, not just look good on video.
  **Check both links resolve before submitting.**
- **Deadline is hard:** Nov 4, 9 PM ET, late submissions not considered —
  no grace period, confirmed explicitly (not just assumed).
- **Bonus prizes, now itemised** (on top of the five per-track placements):
  Most Viral Project $20k, Best Build on Meta Open Weight Models $10k,
  Community Vote $10k, Best Agentic Use-Case $5k, Best Creative Build $5k.
  **meta-styles angles:** "Best Agentic Use-Case" fits the fit-rule
  assembler + Spark copy generator pipeline if it's framed as agentic
  reasoning, not just a form-filler; "Best Creative Build" fits the
  Y2K-x-fairycore styling angle.
- **Most Viral Project:** post the demo on X, submit the post link through
  the platform; engagement counts through **Nov 8 EOD**.
- **Community Vote:** opens Nov 9, one vote per verified account, winner
  announced Nov 16 (already noted above).
- **Learning resources:** Quickstart (dev.meta.ai/docs/quickstart), model
  list (dev.meta.ai/docs/models), API cookbook
  (github.com/meta-models/meta-model-cookbook), open-weight cookbook
  (github.com/meta-models/meta-oss-cookbook) — check the API cookbook
  before wiring the real Meta Model API calls into spark.js/preview.js.
- **Live workshops, noon–1 PM ET:** Oct 27 Agents 101, Oct 28 Agents 102,
  Oct 30 Fireworks inference/training — the Fireworks one is relevant
  given Autumn's unrelated Fireworks/Muse Glimmer training-credits thread.

## Confirmed facts (from the event Discord FAQ "Project rules", pasted by Autumn 28 Oct 2026)

- **New work only, now fully confirmed:** you may build on an existing
  project/startup, but the submission and demo "must clearly identify —
  and only showcase — the features, code and functionality built during
  the hackathon. Unclear original contributions can lead to
  disqualification." This retires the earlier "unverified" flag —
  `docs/prior-work-instagram.md`'s approach (explicit pre-hackathon
  disclosure, nothing from SecondBloom shown as a meta-styles feature) is
  exactly the compliant pattern.
- **Public repo, now fully confirmed:** "Your repository must be publicly
  accessible." Before making the repo public: re-run the key/token grep
  across the whole tree (last done 28 Oct 2026, clean) and confirm
  `.env/secrets` is still gitignored and not in `git ls-files`.
- **Judging gate, now fully confirmed:** projects must first fit a theme
  AND "meaningfully use Meta Model API and/or Meta open-weight models" —
  this is a pass/fail gate before the four equally-weighted scoring
  criteria (Impact, Use of Meta AI tooling, Technical depth and execution,
  Demo quality) apply. Retires the last "unverified" item from that list.
- **Avoid-list (explicit disqualification risk):** the guide names AI
  medical advice / mental-health advisors / skin-condition detectors,
  **basic RAG apps, simple image analyzers**, generic education chatbots,
  job-application screeners, nutrition coaches, personality analyzers,
  sports analyzers/coaches, and anything political or war-related.
  **Risk for meta-styles:** a garment classifier + segmentation viewer
  could read as a "simple image analyzer" if the demo leads with the raw
  classify-a-photo mechanic. Mitigate by keeping the pitch and demo framed
  around the full-look assembly + fit-rule reasoning + resale-grounded copy
  (the part no "simple image analyzer" does), not the SAM/classifier step
  in isolation. Flag any doubt to @CV on the event Discord per the FAQ's
  own suggestion rather than guessing.
- **Only top 5 projects per track advance to finals** (indie track has up
  to 20,000 participants per the application cap, so this is a steep cut).
- Disqualification also covers using code/data/assets without permission —
  reinforces why `docs/prior-work-instagram.md` draws a hard line around
  SecondBloom rather than quietly reusing its code.

## Confirmed facts (from the event Discord FAQ, pasted by Autumn 28 Oct 2026)

- **Project must use Meta models** and address one of the two themes (Build
  for Your World / Push the Frontier) — this upgrades the "hard pass/fail
  gate requiring genuine Meta model use" item from unverified to confirmed:
  the FAQ states it as a requirement, not just a scoring factor.
- **Full model list confirmed:** Muse Spark, Muse Wonder, Muse Image, Muse
  Voice Transcribe, SAM 3.1 (via Meta Model API), plus open-weight Muse
  Glimmer and Muse Spark Open. **Muse Code is explicitly named as available
  "to help you code"** — organizer-sanctioned, not just inferable from the
  Official Rules' third-party-assistance clause.
- **Building period is Oct 27 – Nov 4** (kickoff itself is Oct 26 at noon,
  separate from the building period start) — sharpens the earlier "kickoff
  Oct 26" note; if "new work only" is enforced, Oct 27 noon ET may be the
  safer cutoff for "work done before the hackathon" rather than Oct 26.
- **Community vote winner announced Nov 16** (later than the Nov 9 main
  closing ceremony / winners announcement).
- Solo entry explicitly confirmed fine; teams up to 4; team-forming and
  intro channels exist on the event Discord.

## Confirmed facts (from the Official Rules text itself)

- **Track:** Indie Developer — teams of up to 4, one Representative submits
  and must identify all other team members. (meta-styles is solo.)
- **Dates:** kickoff Oct 26 (livestream), workshops Oct 27–Nov 4, submission
  due **Nov 4, 9:00 PM ET**, judging Nov 4–8, winners Nov 9.
- **Hackathon submission judging** (distinct from the application-stage
  criteria, which are idea clarity + technical skill only): **Impact 30%**
  (real-world potential, who benefits, fits a problem statement), **Use of
  Meta AI Tooling 25%** (creativity beyond a basic integration, unexpected
  capabilities), **Technical Depth & Execution 20%** (sound, refined
  engineering, real craft), **Demo 25%** (working/impressive live demo +
  demo video quality).
- **Third-party technical assistance is explicitly allowed:** "Participants
  may contract with a third party for technical assistance, provided the
  Submission components remain the Participant's own work and the
  Participant owns all rights to them." This directly covers delegating
  implementation to Muse Code and to Bramble (Claude) — Autumn directs and
  owns the result, so it's compliant. Keep doing this openly (commit
  authors `claude-code`/`muse-code` are fine, not something to hide).
- **Open source is allowed** if applicable licenses are followed and the
  submission "enhances or builds upon" the open-source component (not just
  a repackage).
- **IP:** Autumn retains ownership of the submission; by submitting she
  grants Organizers a broad perpetual license to use/display/adapt it
  (marketing, demos, etc.) — expect no confidentiality for anything shared
  during the event (Discord, workshops, screen shares, the submission
  itself are all explicitly non-confidential and may be recorded).
- **Credits:** $150 in Meta Model API credits for a 10-day window if
  selected — read the linked Credit Terms PDF before spending any of it.
- **Eligibility:** 18+, not in a sanctioned country/org, not a Meta/Cerebral
  Valley employee/contractor/intern or their immediate family.
- Judges' decisions are final and binding; winners go through eligibility
  verification before payout (30 days after verification, W-9/W-8BEN
  required).

## Unverified / community-sourced — do not treat as binding

All previously tracked unverified items (new-work-only, public repo, the
Meta model usage gate, and the 3-minute demo video length) are now
confirmed above by the event Discord FAQs. Nothing outstanding here as of
28 Oct 2026 — re-check this section before final submission in case new
FAQ content lands.

## Standing rules for every task on this project

- **All hackathon code (anything in `app/`, `mock-ig-bot/`, etc. — new work claimed as built during the hackathon, including any genuinely executable new file regardless of its path, e.g. a root-level install script) is implemented by delegating to Muse Code or OpenCode/Muse Spark, not written directly by Bramble/Claude.** This governs IMPLEMENTATION only — a read-only critical-review pass (no edits, no commits, one output markdown file) is fine to delegate to a Claude Code/Opus subagent on the same hackathon-code paths, same as it's fine for Bramble to review them directly; keep that subagent's instructions explicitly read-only so it can't slide from reviewing into implementing. (Autumn, 28 and 29 Oct 2026 — confirmed OpenCode satisfies the same rule). Commit identity by delegate: Muse Code work as `muse-code <muse-code@noreply.invalid>`; OpenCode/Muse Spark work as `opencode-spark <opencode@noreply.invalid>`; Bramble's own docs-only analysis as `claude-code <noreply@anthropic.com>`. Bramble's role on this repo is: write/review specs and docs, construct the delegation prompt, verify the delegate's output (tests, diffs, leak-grepping, attribution), fix commit attribution, and push — not hand-edit the app code itself, even for a one-line change. If a quick fix seems easier to just make directly, delegate it instead (edit mode is fine for something that small) and review as usual. Docs-only edits that are Bramble's own analysis/decisions-recording (not new hackathon functionality) are unaffected by this rule.

- **Prior work stays prior work.** SecondBloom/`igwebhook` (and anything else predating the build window) is documented in `docs/prior-work-*.md`. Autumn may *extend* it — that counts as maintenance of the old project: build it outside the meta-styles repo, never vendor its code in, never demo it as hackathon-built, and update the prior-work doc in the same change. **The Muse-Code-only rule above applies to hackathon-code paths inside the meta-styles repo — it does not extend to the separate prior-work repo.** Maintenance there (a new route, a bugfix) may be delegated directly via Claude Code/Opus (see the `claude-code` skill) rather than Muse, since it is a different, non-hackathon codebase with its own git history and no-remote/low-risk posture to confirm first; still delegate non-trivial changes rather than hand-editing, scope any infra-touching change per the `claude-code` skill's safety split (new public routes/firewall changes get drafted not executed), and keep ALL real-send/live-credential actions gated by the send-approval rule below regardless of which tool built the code. Only the meta-styles-side client/integration code is new work. **When the prior-work service gains a capability the hackathon demo should mirror (e.g. a new storage contract), the hackathon-side build is a fresh, independent implementation of the same CONTRACT (same routes/shapes) delegated to Muse like any other hackathon code — never a port of the prior-work service's actual source.** Cross-reference the prior-work design doc for the contract shape; don't copy its code.
- **Demo/test data is synthetic.** Never copy real captured data (DM photos, shares.jsonl rows, real account/media IDs) into the repo — create fixtures from scratch that match the real schema (`SYNTH_` ids, `example.invalid` URLs) and say so in comments. Check after any delegation: grep the diff for the real app/account/media IDs.
- **Prior-work services that feed the app stay off the internet** — local-only on this machine (see `meta-instagram-integration`). Consequence for judging: any feature fed by such a service works only on this machine, so the client must fall back cleanly to synthetic fixtures when the local endpoint is unreachable, and the demo video should be recorded here. Say this tradeoff out loud whenever a plan adds such a dependency. A local live-testing switch may point the client at the real prior-work bot, but it must be explicit (for example `LIVE_IG=1`), preserve the mock default, generate ignored runtime configuration without printing credentials, and never send externally during startup or polling.
- **Commit attribution must be honest and resolve correctly.** The repo's `git config user.name/email` defaults to `claude-code`, so committing is never a no-op on authorship — decide first: changes to `app/`, `meta-api-proxy/`, `mock-ig-bot/`, or any other hackathon-code path get authored as `muse-code` (or `opencode-spark` when OpenCode did the work) (even when Bramble is just staging/committing code Muse already wrote in an earlier pass, not authoring it fresh); changes confined to `docs/`, `skills/`, or Bramble's own analysis get `claude-code`. Override per-commit rather than touching repo config: `git -c user.name="muse-code" -c user.email="muse-code@noreply.invalid" commit -m "..."` (swap for `claude-code <noreply@anthropic.com>` on docs-only commits). The author email must not belong to a different GitHub account (GitHub links commits by email) — see `muse-code` pitfalls. **Before every `git push` on this repo, check authors first**, not just at commit time: run `git log origin/master..master --format='%h %an <%ae>'` over the whole unpushed range (not just HEAD) and confirm each commit matches app-code-vs-docs rule above and uses a safe placeholder email (`noreply@anthropic.com`, `*@noreply.invalid`), never an email that resolves to a real GitHub account. This catches a stale identity or a mis-attributed commit that slipped in from an earlier session before it goes public.
- **Hold real API keys until Autumn says go**; record each go/hold in `docs/decisions.md`. `.env/secrets` keys are hyphenated (`meta-api-key`, `ig-bot-token`) — parse the file, don't `source` it.
- **Every agent working in the repo is bound by `AGENTS.md`**, which points here; when a rule changes, update this skill, then re-copy it to `skills/meta-hackathon-compliance/SKILL.md` in the repo. **Don't trust that the last session actually did this** — the repo copy drifted significantly out of sync (missing a whole section) because the re-copy step was easy to skip under task pressure. At the start of any session touching this repo, diff the repo's checked-in copy against this master skill's current content and resync if they differ, before relying on either as authoritative for an agent that reads the repo copy instead of this one.
- **Open decisions go to Autumn, recorded as resolved/struck in the doc** (decisions.md, the spec's open-questions list) rather than deleted, so the rejected option stays visible.
- **Before assigning a roadmap milestone to Muse (or building it yourself), check whether it's already satisfied by existing wiring.** Grep for the shared integration point the new milestone would add to (e.g. a milestone that says "feed X through the existing pipeline" may already work if X already calls the same entry point other inputs use) before spending a delegation on it. Report "already done, here's why" instead of assigning busywork — the milestone list can lag what the code already does, especially right after a prior milestone's implementation changed the data flow.
- **A capability that writes/sends to a real external user (not just reads) is a stricter case of the prior-work gate, not the same one.** Read-only bot extensions (like the Milestone 9 API) only needed Autumn's go-ahead to build; anything that can act on a real person on the other end (send a DM, post, notify) needs her explicit go-ahead before a contract spec is even drafted, must surface the platform-specific risk (messaging windows, rate limits, consent) as explicit open questions rather than assumptions, and must preserve any privacy decision already made on the read side (e.g. if a recipient identifier is never exposed to the client, design the write/send request to reference the existing opaque id instead of a raw identifier, not re-expose it "just for this one feature").
- **When a Muse-written plan doc comes back with a numbered open-questions list, walk Autumn through them one at a time (one question, her answer, next question) rather than dumping the list** — matches how she drives multi-item decisions generally. Record every resolved answer into `docs/decisions.md` yourself as a new numbered row (Bramble's job, not Muse's, per the rule above); only after all questions are resolved, build ONE consolidated revision prompt for Muse that restates each answer against the open-question number it resolves, and re-delegate as a single `edit`-mode call — don't dribble out one micro-delegation per answered question.
- **If resolving one open question implies un-parking or reversing an earlier parked/descoped/avoid-list-flagged decision (e.g. an answer that needs a previously-descoped milestone), say so explicitly to Autumn before folding it into the next delegation prompt — don't silently adopt the implication.** The original parking reason (often an avoid-list risk) doesn't evaporate just because a later answer needs that capability; restate the risk and how the new framing still mitigates it, in the same breath as recording the decision.
- **Multi-row edits to the numbered decision tables in `docs/decisions.md` (or `docs/roadmap.md`): append the new row(s) after the last existing row, never insert before/between existing rows** — inserting mid-table risks renumbering drift and, if the replacement string is built programmatically, a literal `\n` two-character sequence landing in the table instead of a real line break. **When using a find-and-replace patch tool for this, make `old_string` match ONLY the exact boundary text you want to anchor on (e.g. the start of the next unrelated section), and make sure `new_string` still contains every original line your match spans** — anchoring `old_string` on the last existing row's own text and then writing a `new_string` that doesn't repeat that row's content silently deletes it, which is exactly how a row disappeared even though the edit was logically an append. After any such edit, immediately `read_file` the result (don't trust the diff summary alone) and confirm every original row is still present, in order, with no literal backslash-n in the rendered text, before moving on.

- **Fence every delegation prompt against deletions, and check `git status` after each run — OpenCode/Muse Spark once `rm -rf`'d an unrelated untracked directory (`.cron-prompts/`) that no instruction mentioned.** Add "do not delete or modify anything outside the named files; do not run rm" to every delegation prompt regardless of how clearly bounded it seems. Untracked-file deletion is unrecoverable (never in git history, no filesystem copy) — verify the tree diff before celebrating a green test run.

- **Product scope decided 2026-10-29 (Autumn) — governs every M19-and-later task:** the product is the persistent per-user wardrobe/catalog, not the chat — Instagram DM chat is one interface onto it, not the product boundary, so no catalog schema work may couple itself to IG-specific fields. Fabric/price/vendor grounding is fully descoped (a boutique-sourcing-DB integration is a separate future stretch, blocked on hosting + a PII photo-scrub pass, not to be folded into the current build). Judge delivery is a local one-shot install+run (judge supplies only their own Meta API key) — not a hosted URL; hosted live Instagram integration and real-DM sends are stretch goals only, both still gated by this skill's send-approval rule if pursued. If a build step runs long, the step itself gets time-boxed/descoped — the submission's existing critical-path milestones (isolation proof, packaging, submission cut) do not give way for a scope addition. Full detail: `docs/milestone-19-chat-first-pivot.md`.

- **Live wiring pitfalls (Oct 30, verified live):** sibling() lookups, origin checks, and dedup scope all have distinct failure modes that Node tests mask — see `references/wiring-pitfalls.md`.
- **Agentic interaction design (Oct 30, Muse Spark):** proscriptive router + skill set, persona, and memory rules distilled from Autumn's edits — see `references/interaction-design.md`.
- **User-data deletion is only real when every holder of the data observes it; deletion logic stays hard-coded in the prior-work IG bot.** The bot's `_scrub_locked` already purges everything it holds (catalog file, media, outbound, consent, user-linked idempotency, share tombstones, redacted events) — the failure mode is downstream: wardrobe-service keeps per-user state in memory and persists THROUGH the bot's catalog API, so it kept serving deleted pieces and could PUT the catalog back (resurrection), and the catalog GET cannot distinguish deleted from empty (`{"pieces": []}` for both). Required contract, verified live and regression-tested on both sides: the bot answers `GET /ig/deletion-status/<user_ref>` with `scrubbed:true` iff both the consent record AND the catalog file are absent; wardrobe-service reconciles at every poll tick and before every status response and drops the in-memory user context ONLY on a definite `200 + scrubbed:true`, failing open on any other outcome (404/5xx/bad JSON = keep state). Any new user-scoped store on either side must join this story — deleting a file alone is not deletion. Phrase-set note: the bot's `DELETE_PHRASES` must stay in lockstep with the consent copy users are actually shown ("delete my photos") plus bare `DELETE`/`forget me`; punctuation-tolerant matching applies to deletion phrases only — the YES check must run BEFORE any punctuation stripping or "YES!" grants consent.
- **Look references render at ~384px from stored per-piece `image_original` (≤1 MB), falling back to the 96px thumb for pre-original pieces — reference SIZE is part of the grounding contract (M25 / decisions #11).** The thumb (≤96px) stays the status/collage surface; edit-model grounding failed live at 96px with delivery confirmed green, so a green image-delivery counter does not mean garment-following — assert the reference byte band (e.g. ~25 KB for 384px) when debugging "not using my clothes", before blaming the model. Originals die with the catalog file (deletion story intact).
- **Per-share identity must be per ATTACHMENT, not per message — one DM can carry many garment photos.** A message-level share id collapses every attachment onto the first: the downstream per-share handled map silently skips the rest (no duplicates counter, no activity line — the batch just vanishes). Contract, verified live and regression-tested on both sides: attachment items carry id `<mid>:<media_id>` (distinct per image, and stable across reads because it derives only from stored fields), while text items keep the bare mid so already-stored reply-idempotency keys keep matching; a duplicate webhook delivery lands as a second record that intentionally collides into the same id — that collision IS the dedupe. When a user suspects "it only looked at the first", compare the share-record count against the wardrobe's processed counter before suspecting classification or the model.
- **Every consumer of a share id must accept the exact shape the /ig/shares API emits — changing one half of a two-way contract 400s the other (bit live).** After item ids became `<mid>:<media_id>`, `POST /ig/send` and `POST /ig/outbound-stage/<share_id>` still validated mid-only and looked up shares by bare mid, so every reply 400'd (`send share=- status=400`) and the batch gave up unsigned. Fix shape: composed `SHARE_ID_RE` (mid, optional `:media_id` segment) and a `find_share` that mid-matches plus media-matches when a media segment is present (bare mid still returns the first mid-match for legacy clients). When touching an id contract, grep every regex and record-lookup that consumes that id before shipping.
- **Before declaring an "it's still not using my data" bug fixed, trace every hop of the data path with a probe in the real input format, not the fixture format — layered causes are the norm. Localize the failing layer from its own telemetry before reading code: parse the live share log with a privacy filter (record counts and opaque ids only, never sender ids, message text or captions), set media-file mtimes beside the share records, and read the service's processed/skipped/duplicates counters plus its anonymous activity lines, which name the layer that dropped the batch.** The wardrobe-grounding complaint took three sequential fixes: the look skill delivered only the first reference thumbnail (multi-reference payload added), the Node thumbnailer silently returned null for JPEG — all real IG photos are JPEG — so pieces catalogued WITHOUT thumbnails and looks degraded to text-only category words, and finally the deletion/resurrection gap above. A fail-soft null that still lets the item catalogue (thumbnail null, piece recorded) passes every PNG-fixture test while breaking live.
- **A contract fix is not live until both running processes execute it — the redeploy is part of the fix, not an afterthought.** The IG bot container bind-mounts `app.py`, but Python keeps serving the module it imported — the file changing on disk does nothing until `docker compose restart igwebhook`; verify the running process, not the file (a new route should answer auth-guarded 401 where the old code answered a bare 404). Restart the live wardrobe stack after wardrobe changes too — that also deliberately clears its in-memory state, which is itself the recovery path for a stale handled map. A `pkill -f` pattern can match the invoking terminal command's own args and kill the session shell mid-command; verify with a fresh process/port listing rather than trusting the kill's exit code.
- **A share must catalogue at most once even across failed-send retries — retries re-run the whole turn and silently multiply wardrobe pieces (bit live: 8 garments became 40 pieces).** Guard: `catalogue_piece` scans already-loaded pieces for the same `source_share_id` before `addPiece` and answers honestly ("already in your wardrobe — keeping one copy") without adding. Never repair the aftermath by dedup/wiping at load time — the owner resets via the deletion path, which is the auditable story.

## Practical checklist for meta-styles

1. **Keep pre-hackathon work clearly separated and dated — now a hard
   rule, confirmed by the Discord FAQ** ("must clearly identify — and only
   showcase — features/code/functionality built during the hackathon").
   Already done: `docs/prior-work-instagram.md` states the SecondBloom
   Instagram integration predates the hackathon by 12 days and is not part
   of this repo's code; git commit timestamps corroborate it. Use the
   building-period start (Oct 27 noon ET) as the strict cutoff if it ever
   matters, not the kickoff livestream (Oct 26 noon ET) — meta-styles' own
   first commit (`4afac15`) predates both anyway.
2. **Watch the "simple image analyzer" overlap risk.** The avoid-list
   explicitly bans basic RAG apps and simple image analyzers. Keep the
   pitch/demo centred on full-look assembly + fit rules + resale-grounded
   copy, not the SAM/classifier step in isolation. Ask on the event
   Discord (@CV) if genuinely unsure before investing more build time.
3. **Document AI-agent assistance transparently** — it's explicitly
   allowed by the Official Rules. Don't scrub Muse/Claude commit
   attribution.
4. **"Use of Meta AI Tooling" is 25% of the score, and using Meta models is
   now a pass/fail gate too** — the app is currently stubbed
   (classifier/spark/preview all placeholder). Before final submission,
   swap in real Meta Model API calls (Spark/Image/SAM) sourced from
   `.env/secrets` per `docs/decisions.md` §Secrets — but only once Autumn
   says to start using the real key (she asked to hold off as of 28 Oct
   2026). This is no longer optional polish — without it the submission
   fails the gate.
5. **Repo must go public before final submission — confirmed requirement,
   not yet done.** Before flipping visibility: re-run the key/token grep
   across the whole tree (last clean run 28 Oct 2026), confirm
   `.env/secrets` isn't in `git ls-files`, and confirm no proprietary
   SecondBloom code is vendored in — only docs referencing it. If the
   submission includes a static public guide, deploy it as a separate GitHub
   Pages artifact and verify both the Actions deployment and a logged-out
   HTTP request to the final URL; omitting `actions/checkout` leaves the
   artifact directory absent on the fresh runner.
6. **Budget real time for the Demo (25% of score)** — a working live demo
   plus a polished demo video; this is Milestone 4 ("submission cut") in
   `docs/roadmap.md`.
7. **Nothing shared during the event is confidential** — don't paste real
   client data or other paid-work details into the event Discord, workshops,
   or the submission itself.
8. **Deadline is Nov 4, 9:00 PM ET** — no grace period assumed.
9. **Submission mechanics, confirmed:** exactly one project submission for
   meta-styles (solo, no team ambiguity), via the Cerebral Valley submit
   page, with public repo link, 3-minute demo video, and contributor name
   listed. Test both links resolve (logged out, in a fresh browser) before
   hitting submit — Judges watch the live product too, so it should still
   run after submission.
