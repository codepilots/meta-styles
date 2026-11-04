---
name: meta-hackathon-compliance
description: "Use when working on meta-styles' Meta hackathon entry."
version: 1.1.0
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

## When to Use

Work on meta-styles: app code in `~/projects/meta-styles` (direct or
delegated), its commits and deploys, the prior-work IG bot integration that
feeds it, and live debugging of the bot/wardrobe/proxy stack. Not other
projects.

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
- **Commit attribution must be honest and resolve correctly.** The repo's `git config user.name/email` defaults to `claude-code`, so committing is never a no-op on authorship — decide first: changes to `app/`, `meta-api-proxy/`, `mock-ig-bot/`, or any other hackathon-code path get authored as `muse-code` (or `opencode-spark` when OpenCode did the work) (even when Bramble is just staging/committing code Muse already wrote in an earlier pass, not authoring it fresh); changes confined to `docs/`, `skills/`, or Bramble's own analysis get `claude-code`. Override per-commit rather than touching repo config: `git -c user.name="muse-code" -c user.email="muse-code@noreply.invalid" commit -m "..."` (swap for `claude-code <noreply@anthropic.com>` on docs-only commits). The author email must not belong to a different GitHub account (GitHub links commits by email) — see `muse-code` pitfalls. **Before every `git push` on this repo, check authors first**, not just at commit time: run `git log origin/master..master --format='%h %an <%ae>'` over the whole unpushed range (not just HEAD) and confirm each commit matches app-code-vs-docs rule above and uses a safe placeholder email (`noreply@anthropic.com`, `*@noreply.invalid`), never an email that resolves to a real GitHub account. This catches a stale identity or a mis-attributed commit that slipped in from an earlier session before it goes public. A non-fast-forward rejection right after your own pushes landed usually means a stale local remote-tracking ref, not real upstream work: `git fetch` then check `master..origin/master` — your own commits on that list = fetch staleness; fetch + `git pull --rebase` + push, and the `skipped previously applied commit` notes the rebase prints are harmless duplicates. If commits you made seem missing from `git log` entirely, check commit DATES and `git log --all --grep='<subject words>'` before diagnosing dropped work — this repo is developed continuously by parallel delegate sessions and cron lanes, so a history that looks 'past your session' can simply mean the repo moved on, and re-committing the working tree blind would double-land someone else's landed feature.
- **Hold real API keys until Autumn says go**; record each go/hold in `docs/decisions.md`. `.env/secrets` keys are hyphenated (`meta-api-key`, `ig-bot-token`) — parse the file, don't `source` it.
- **Every agent working in the repo is bound by `AGENTS.md`**, which points here; when a rule changes, update this skill, then re-copy it to `skills/meta-hackathon-compliance/SKILL.md` in the repo. **Don't trust that the last session actually did this** — the repo copy drifted significantly out of sync (missing a whole section) because the re-copy step was easy to skip under task pressure. At the start of any session touching this repo, diff the repo's checked-in copy against this master skill's current content and resync if they differ, before relying on either as authoritative for an agent that reads the repo copy instead of this one.
- **Open decisions go to Autumn, recorded as resolved/struck in the doc** (decisions.md, the spec's open-questions list) rather than deleted, so the rejected option stays visible.
- **Before assigning a roadmap milestone to Muse (or building it yourself), check whether it's already satisfied by existing wiring.** Grep for the shared integration point the new milestone would add to (e.g. a milestone that says "feed X through the existing pipeline" may already work if X already calls the same entry point other inputs use) before spending a delegation on it. Report "already done, here's why" instead of assigning busywork — the milestone list can lag what the code already does, especially right after a prior milestone's implementation changed the data flow.
- **A decisions.md/roadmap.md row marked OPEN or unresolved may already be fixed in code — the cron pipeline lands commits without always flipping the row's status.** Before treating any such row as a live blocker (or reporting it to Autumn as outstanding), grep the actual repo for the thing the row says is missing (the linked file, the handler, the workflow, the live URL) and check recent commit log / `gh run list` for a matching fix, not just the doc text. If the fix is already live, close the row with a RESOLVED note citing the commit/URL that proves it, rather than re-opening a dead task or re-delegating already-done work.
- **Before "launching"/"exposing"/"setting up" anything operational for this project (the local app stack, a public guide, a tailnet link), check live state first rather than assuming a fresh setup is needed — this project accumulates long-running infra across sessions.** `ss -ltnp` for the three local ports already listening (proxy/mock-bot/static), `ps -o pid,etimes,cmd` on those PIDs to see how long they've been up, `gh api repos/codepilots/meta-styles/pages` for an existing Pages deployment, and `tailscale serve status --json` for an existing tailnet proxy route are each a 5-second check that can turn "build this" into "here's the link, already live" — verify with a real `curl` against the candidate URL/port before reporting it as working either way. **A port being up and healthy does NOT tell you which MODE it's serving — a prior LIVE_IG=1 session leaves `:8000` bound by `live-proxy-server.js` (relaying to the real bot at `:8903` with real bearer tokens pushed into the browser) and that is indistinguishable from mock mode by a bare health/port check.** Before calling a running instance "the mock"/"the demo", check the `cmd` field from `ps` on the `:8000` process (`python3 -m http.server` = mock; `node live-proxy-server.js --bot ...` = live) and whether `app/ig-runtime-config.js` exists (present = live, generated by `start.sh LIVE_IG=1`; absent = mock). If a session asked for "the mock"/"simulates Instagram" and the running instance is actually live, kill the proxy/live-proxy/wardrobe-service PIDs, delete the stale `app/ig-runtime-config.js`, and relaunch with plain `MODEL_API_KEY=<key> sh start.sh` (no `LIVE_IG`) — don't just reuse what's already listening. **The mock bot's CORS allowlist trusts the exact origin `http://localhost:8000` and rejects `http://127.0.0.1:8000`** (same host, different origin string) — every link, browser test, or `curl -H Origin:` check against the mock/judged path must use `localhost`, never the bare IP, or requests silently fail client-side with no server-visible error.
- **To give the MOCK demo a working remote/Tailscale link (not just the local-only judged path), repurpose `live-proxy-server.js` to target the mock bot instead of the real one — don't accept "remote access doesn't work" as final, and don't improvise a different tunnel.** `start.sh` only wires the same-origin proxy under `LIVE_IG=1` (pointed at the real bot); for mock mode, launch it by hand instead of the plain `python3 -m http.server`: `node live-proxy-server.js --port 8000 --bot http://127.0.0.1:8904 --proxy http://127.0.0.1:8905 --wardrobe http://127.0.0.1:8906 --dir app`, plus a hand-written, gitignored `app/ig-runtime-config.js` setting `{ mode: "mock-remote", botBase: "/ig", proxyBase: "/api", statusBase: "/wardrobe" }` (no tokens needed — the client's own hardcoded mock token already matches what the mock bot expects). This needs three fixes — see `references/wiring-pitfalls.md` §Remote access via same-origin proxy for the full detail, confirmed necessary again on a from-scratch rediscovery: the proxy must rewrite the outbound `Origin` header rather than relay the browser's real one, the mock-only `/mock/*` operator routes need their `/ig` prefix stripped specifically on that branch, and any client page must gate its "am I live" checks on an explicit `mode` field rather than inferring liveness from `botBase` being set. **A skill bullet claiming a fix is "already landed in the repo" is a claim, not a guarantee — `search_files`/`git diff` the actual current file for it before trusting that or re-deriving it from scratch; this exact bug was fully fixed once, documented here, and still had to be rediscovered and re-fixed from zero in a later session because nobody checked this reference first.**
- **A capability that writes/sends to a real external user (not just reads) is a stricter case of the prior-work gate, not the same one.** Read-only bot extensions (like the Milestone 9 API) only needed Autumn's go-ahead to build; anything that can act on a real person on the other end (send a DM, post, notify) needs her explicit go-ahead before a contract spec is even drafted, must surface the platform-specific risk (messaging windows, rate limits, consent) as explicit open questions rather than assumptions, and must preserve any privacy decision already made on the read side (e.g. if a recipient identifier is never exposed to the client, design the write/send request to reference the existing opaque id instead of a raw identifier, not re-expose it "just for this one feature").
- **When a Muse-written plan doc comes back with a numbered open-questions list, walk Autumn through them one at a time (one question, her answer, next question) rather than dumping the list** — matches how she drives multi-item decisions generally. Record every resolved answer into `docs/decisions.md` yourself as a new numbered row (Bramble's job, not Muse's, per the rule above); only after all questions are resolved, build ONE consolidated revision prompt for Muse that restates each answer against the open-question number it resolves, and re-delegate as a single `edit`-mode call — don't dribble out one micro-delegation per answered question.
- **If resolving one open question implies un-parking or reversing an earlier parked/descoped/avoid-list-flagged decision (e.g. an answer that needs a previously-descoped milestone), say so explicitly to Autumn before folding it into the next delegation prompt — don't silently adopt the implication.** The original parking reason (often an avoid-list risk) doesn't evaporate just because a later answer needs that capability; restate the risk and how the new framing still mitigates it, in the same breath as recording the decision.
- **Multi-row edits to the numbered decision tables in `docs/decisions.md` (or `docs/roadmap.md`): append the new row(s) after the last existing row, never insert before/between existing rows** — inserting mid-table risks renumbering drift and, if the replacement string is built programmatically, a literal `\n` two-character sequence landing in the table instead of a real line break. **When using a find-and-replace patch tool for this, make `old_string` match ONLY the exact boundary text you want to anchor on (e.g. the start of the next unrelated section), and make sure `new_string` still contains every original line your match spans** — anchoring `old_string` on the last existing row's own text and then writing a `new_string` that doesn't repeat that row's content silently deletes it, which is exactly how a row disappeared even though the edit was logically an append. After any such edit, immediately `read_file` the result (don't trust the diff summary alone) and confirm every original row is still present, in order, with no literal backslash-n in the rendered text, before moving on.

- **Fence every delegation prompt against deletions, and check `git status` after each run — OpenCode/Muse Spark once `rm -rf`'d an unrelated untracked directory (`.cron-prompts/`) that no instruction mentioned.** Add "do not delete or modify anything outside the named files; do not run rm" to every delegation prompt regardless of how clearly bounded it seems. Untracked-file deletion is unrecoverable (never in git history, no filesystem copy) — verify the tree diff before celebrating a green test run.

- **After every delegation run, `git status --short` for UNTRACKED files and `git add` them by exact path before committing — then re-run the full suite yourself.** A timed-out or partially-finished Muse/OpenCode run leaves its new test files on disk untracked; a `git add` list containing one unmatched glob pathspec stages NOTHING (git aborts the whole add, then the commit reports "up to date" as if done) — a commit has shipped without the delegate's tests this way. The delegate's final "all green" is a self-report: mid-run failures it quietly fixed afterwards still happened in the transcript, and the final count must come from an independent run before the push. When a run outlives the call's timeout, the client dies but its edits persist — after a timeout check `ps` for a still-running client and `git diff --stat` for what landed, then re-delegate ONLY the missing remainder as a new run stating "implementation already applied (commit <hash>, files <list>); skip implementation, add tests only" — re-running the full prompt on a half-applied tree produces double-drifted edits and churned tests.

- **Product scope decided 2026-10-29 (Autumn) — governs every M19-and-later task:** the product is the persistent per-user wardrobe/catalog, not the chat — Instagram DM chat is one interface onto it, not the product boundary, so no catalog schema work may couple itself to IG-specific fields. Fabric/price/vendor grounding is fully descoped (a boutique-sourcing-DB integration is a separate future stretch, blocked on hosting + a PII photo-scrub pass, not to be folded into the current build). Judge delivery is a local one-shot install+run (judge supplies only their own Meta API key) — not a hosted URL; hosted live Instagram integration and real-DM sends are stretch goals only, both still gated by this skill's send-approval rule if pursued. If a build step runs long, the step itself gets time-boxed/descoped — the submission's existing critical-path milestones (isolation proof, packaging, submission cut) do not give way for a scope addition. Full detail: `docs/milestone-19-chat-first-pivot.md`.

- **Live wiring pitfalls (Oct 30, verified live):** sibling() lookups, origin checks, and dedup scope all have distinct failure modes that Node tests mask — see `references/wiring-pitfalls.md`.
- **An automatic (server-initiated) reply that includes a generated image is a distinct display path from an operator manually attaching a file in the browser — don't assume the former works just because the latter renders.** If a page's "show the staged image" logic only ever populates from a browser-local upload (never fetched from the server), every auto-sent look/image reply silently degrades to placeholder text with no image, even though the image really was generated and "sent" server-side. Same class as the other "claims delivery that didn't happen" bugs in this skill — see `references/wiring-pitfalls.md` §remote access via same-origin proxy for the exact fix shape (a debug-only read route plus an async-fetch-then-patch client pattern mirroring how incoming photos are already fetched).
- **Agentic interaction design (Oct 30, Muse Spark):** proscriptive router + skill set, persona, and memory rules distilled from Autumn's edits — see `references/interaction-design.md`.
- **User-data deletion is only real when every holder of the data observes it; deletion logic stays hard-coded in the prior-work IG bot.** Downstream stores reconcile against the bot's deletion-truth endpoint and drop state only on a definite truth — 404/5xx/bad-JSON fails open, so a transient outage can never wipe a wardrobe; deleting a file alone is not deletion, and any new user-scoped store must join the story. Phrases stay in lockstep with the consent copy plus bare DELETE/FORGET ME, and the YES check precedes any punctuation stripping. Detail: `references/wiring-pitfalls.md` §deletion reconciliation.
- **Grounding: look references render at ~384px from stored per-piece originals (≤1 MB), falling back to the 96px thumb for pre-original pieces.** Verify three separate seams: the right catalogue record is selected, the derived reference is actually present in the provider request, and the generated result preserves the supplied garment. A green delivery counter or captured input payload never proves garment-following; inspect source/result dimensions and visible content, and validate the provider's documented image-edit request shape before blaming the model. `references/wiring-pitfalls.md` §grounding.
- **Keep personal render references separate from wardrobe pieces.** Headshots and full-body photos belong in a user-scoped profile-reference store, never in the piece-array schema or garment catalogue. For a render-on-user request, require explicit consent before persistence, ask only for missing reference types, route pending uploads to profile storage rather than `catalogue_piece`, and pass both references to the image model only when the user explicitly requested a worn render. A normal look request must remain flat-lay and must not demand profile photos. Implement a real delete path for profile references and verify both the storage layer and downstream model payload observe deletion; never claim identity-preserving rendering or encrypted storage unless the bytes actually reached the model/storage contract.
- **Test the privacy boundary as a reachable flow, not just a helper.** Cover fresh render intent with no references (no preview call/no image), one-reference-missing prompts, sequential labelled or bare uploads, explicit-consent persistence, delete-and-reask, and the ordinary flat-lay path. Include a browser-shaped or VM test whenever production code has both `root.MetaStyles` and `require` resolution, because Node-only tests can leave the real upload/router path unexercised. Test the separate profile API as well as the handler: use a valid production-shaped user reference, prove encrypted-at-rest persistence plus idempotent deletion, and assert status/debug responses contain presence metadata only—not profile bytes. A passing handler test with an invalid user-ref fixture can miss the real route entirely.
- **Model answers coerce into the closed vocabulary at the integration seam — a fail-closed validator downstream plus an unconstrained prompt upstream is a silent fail-soft failure chain.** Exact match passes; synonyms coerce; deliberately-untracked answers return the honest `placeholder:true` fallback (which callers treat as classify-unavailable, never as a confident label); caches store post-coercion values. `references/wiring-pitfalls.md` §coercion seam.
- **Cataloguing is one photo → every garment: detections accumulate into one pending bag per user, one combined ask per batch, add on yes with per-region attribution and crop-fingerprint dedupe; single-region findings keep instant auto-add; a stray or repeated yes gets its own honest nothing-pending reply.** §multi-detect in `references/wiring-pitfalls.md`.
- **The pending-add branch gates on the DURABLE bag, never on a consumable marker another layer resolves first (a pre-skill expectation mechanism consumes the recorded yes/no question before the handler runs — a handler gated on the question list treats an answered yes as nothing-pending and never touches the bag); and the collected source is acked only when the processing landed — a failure reply is a successful send, not progress.** Gates read structured result fields, never trace strings; retained media stays discoverable via the pending state. §multi-detect, §media retention.
- **A catch chain that swallows must surface a classified failure kind into the result; telemetry records the verified outcome, never the skill's name; the status surface carries a minimized per-turn trail.** Trace strings are diagnostics for humans, never gate conditions. §failure telemetry.
- **Per-share identity is per ATTACHMENT (`<mid>:<media_id>`, bare mid for texts; a duplicate delivery intentionally collides into the same id) — and every consumer must accept it: send, staging, record lookups, AND id-derived strings with their own caps and encodings.** §id contracts in `references/wiring-pitfalls.md`.
- **Trace every hop from live telemetry before reading code, in the real input format not the fixture format; when the tool trail can't separate branches, instrument + probe per `references/live-debugging.md`** — the loop's tool recorder logs calls BEFORE applying, so an absent tool call is definitive proof it never ran, while a present one proves nothing about success. For an "isn't replying" report, split outbound-sent / inbound-arrived / perception-gap and canary the deployed public webhook path (read the REAL path from the deploy README; a guessed path's 404 proves nothing).
- **A contract fix is not live until both running processes execute it — the redeploy is part of the fix.** Bind-mount ≠ module reload; restart, then verify currency (StartedAt postdates the edit; the new symbol greps in the running process); never queue a foreground `sleep N; curl` readiness chain (the approval gate holds it silently) — verify from the background session's output or a bare status curl; and never trust a `pkill -f` exit code (the pattern can kill the invoking shell) over a fresh process listing.
- **A share catalogues at most once, even across failed-send retries — the guard checks its source id before adding; never dedup/wipe at load time (the owner's deletion-path reset is the auditable story); the idempotent reply is per-PIECE distinctive, deterministic from a stable stored field (never a mid/user_ref in the text), so identical guard texts across different pieces can't trip the same-text backstop while the same piece still replays byte-identically.
- **User-facing pages (guides, landing/about surfaces) use this project's hand-drawn system: the guide palette (paper `#f7f5f2`, ink `#14171a`, rule `#ded9d2`, accent `#0d5c52`), illustrations as single-fine-weight line-drawn SVG (round caps/joins, hand feel, dashed only for selection/motion, one heavier accent tier for hero emphasis — normalize stray stroke widths to that two-tier grammar before shipping), real reply copy quoted from the shipped skills, title phrasing matching the parent page, self-contained/no-JS, and a contents nav with anchors.** Reuse the parent guide's header/nav structure rather than inventing a new one.**

## Running-process staleness after a delegation lands

- **A Muse delegation editing `app/`, `wardrobe-service/server.js`,
  `mock-ig-bot/server.js`, or `meta-api-proxy/server.js` does NOT take
  effect in the already-running demo stack — Node requires() files once
  at process startup and never reloads them.** Static `.html`/`.js` files
  served by the python/live-proxy static server ARE read fresh per
  request (no restart needed for those), but any change to a `server.js`
  that's already running as a background process needs that process
  killed and relaunched before you test it live — this bit the same
  session three times in a row across the view/delete/occasion-aware-look
  features. After every full-mode Muse run that touches a server file,
  check `ps aux` for that file's running pid, confirm its start time
  predates the new commit, and restart it (same launch command used
  before) BEFORE doing any live browser verification — don't just assume
  a clean `git log`/green test suite means the live demo reflects it.
- **Verify browser/UI changes against the SERVED URL, not the source
  file, and verify structurally when the data surface is empty.** `curl`
  the running page URL and grep for the new CSS/logic string — a stale
  proxy or restarted-wrong static server passes source greps while
  serving old markup. When history was cleared/tombstoned (e.g. after a
  delete-all) the thread renders nothing, so behavior can't be demoed:
  assert the cap/anchor structurally instead — inject an oversized
  element into the live page's DOM and measure its computed size via
  `js('(() => {...})()')`, verify the scroll-into-view code exists in the
  served page, and let the first real interaction prove the behavior.
- Restarting `wardrobe-service/server.js` resets its in-memory cursor and
  re-walks the mock bot's share history from scratch on the next poll —
  harmless for a demo, but expect a burst of "catalogued a piece"/
  idempotent "already went out" activity lines before it catches up to
  genuinely new messages; don't mistake this for a bug.

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
   artifact directory absent on the fresh runner. Pages deploys only `site/`
   — links inside published pages must be site-relative or fully absolute:
   `../docs/...` links render 404 live, so policy pages (privacy, terms,
   data-deletion) get their absolute URLs — the same ones the consent copy
   names. Grep the PUBLISHED page's URL content, not just the source tree,
   for relative-link breakage after any new site/ page.
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
