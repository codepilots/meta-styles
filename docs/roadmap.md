# roadmap

Last critical review: **2026-10-28** (7 days to the hard deadline,
**Nov 4, 9:00 PM ET, no grace period**). Deadline and the Meta-model
pass/fail gate are from `skills/meta-hackathon-compliance/SKILL.md`;
if this file and that skill disagree, the skill wins.

How to read this file: `DONE` means built and verified in this repo.
`STUB-DONE` means the UI/flow exists but the AI behind it is a
placeholder — it does **not** satisfy the hackathon's Meta-model gate.
Nothing is called done on the strength of a plan doc alone.

## Critical path (in order)

1. ~~**M14 — real Meta Model API integration**~~ **DONE 2026-10-28**
   (pass/fail gate closed; see the M14 status note below).
2. **M18 — finish M13's live isolation proof** (blocks a trustworthy demo).
3. **M16 — judge-ready hosted product** (blocks Demo 25%: judges assess
   the live product, not only the video).
4. **M4 — submission cut** (video, public repo, package; start the
   script early, finish last).

Everything else is optional, parked, or descoped below. Do not start a
parked item before the critical path is green.

## Done / verified

- Milestone 0: application draft. **Status unverified in-repo** — no
  submission receipt is recorded here. See the open check in M4.
- Milestone 1 — STUB-DONE: photo → mask viewer + manual-box fallback
  (cached demo set). Real: image loading, canvas, box draw/move/resize.
  Stub: `StubSegmentationService` in `app/app.js` returns deterministic
  polygons (`TODO(SAM-3.1)`). Superseded by M14b.
- Milestone 2 — part real, part STUB-DONE: garment classifier + look-card
  assembler with fit rules. Real: `assembleLook` in `app/assembler.js`
  (base + exactly-one finish, two-layer/shoe rejection, ≤300-word cap)
  — this fit-rule engine is the project's strongest real component.
  Stub: `classifyRegion` in `app/classifier.js` is a hint/geometry/hash
  heuristic (`TODO(model)`); per-piece copy is invented placeholder
  (`placeholder:true`). Superseded in part by M14c/M15.
- Milestone 3 — STUB-DONE: Spark copy generator + Image preview + share
  card. Real: share-card layout, copy-as-text, PNG download, word budget.
  Stub: `generateCopy` in `app/spark.js` (`TODO(Spark-API)`) and
  `generateImage` in `app/preview.js` (canvas collage,
  `TODO(Image-API)`). Superseded by M14d/M14e.
- Milestone 5 — DONE: DM-share inbox bridge with synthetic fixtures
  (`app/inbox-fixtures/`, `SYNTH_` ids only; no real DM data).
- Milestone 6 — VERIFIED 2026-10-28: no separate pipeline code was
  needed; Milestone 5+9's shared `loadImage()` entry point already wires
  every inbox source through the same mask/classify/assemble pipeline as
  uploads, proven by `app/test/milestone6-pipeline-wiring.test.js`.
- Milestone 9 — DONE (client only): bot read-API client in
  `app/inbox-bridge.js` (live `GET /ig/shares` + `/ig/media` with Bearer
  auth from untracked `app/ig-bot-token.local.json`, DELETE-after-use
  acknowledgement, Milestone 5 fixtures as offline fallback). The bot
  API itself is prior-work maintenance outside this repo (see
  `docs/instagram-bot-api.md`, `docs/prior-work-instagram.md`) and must
  never be presented as hackathon-built.
- Milestone 13 — BUILT, live proof pending (see M18): standalone demo
  path with zero Instagram dependency — same-API mock DM chat + mock
  bot server (`mock-ig-bot/server.js`, stdlib-only, port 8904;
  `app/mock-dm.html`; `app/inbox-bridge.js` `BOT_BASE` defaults to the
  mock, one-line edit back to `:8903` for the real bot, no query
  override). Tasks 1–9 committed; contract-parity checklist at
  `docs/milestone-13-contract-parity.md` (known divergences: no
  502/429/503 families, mock-local token format, no host hardening).
  Static isolation is test-enforced (`app/test/milestone13-*.test.js`);
  the live browser + hosts-file walk (plan §5) still needs a human pass.
  Demo: run `node mock-ig-bot/server.js` and (from `app/`) `python3 -m
  http.server 8000`, then open `http://localhost:8000/mock-dm.html`.
  Scope note: this isolates the Instagram/igwebhook dependency only —
  the Meta Model API calls in M14 stay live network dependencies and
  are explicitly not isolated away here.

Test state (run 2026-10-28, all green): 181 assertions —
`milestone13-mock-bot` (74), `milestone13-mock-dm-page` (32),
`milestone6-pipeline-wiring` (36), `milestone14-meta-api` (39, includes
the direct `assembleLook` fit-rule and copy-budget tests). Remaining
gap: no browser end-to-end test — closed by M18.

## Superseded, parked, or descoped (do not build as written)

- Milestone 7 — SUPERSEDED by Milestone 12 + M17: reply-back share card
  via DM is the same send path as M12's general-purpose send. Do not
  build a second, automatic-reply implementation. The `is_echo` skip
  rule still applies to whichever send client ships.
- Milestone 8 — DESCOPED for this submission (needs Autumn's explicit
  confirmation, recorded in `docs/decisions.md`): production hardening /
  App Review for `instagram_business_manage_messages`. App Review takes
  days and the judged demo path is the local/mock one (M13/M16), which
  needs no new review scope. Revisit post-hackathon only. If Autumn
  instead wants the real-Instagram path judged, this descope is wrong
  and M8 becomes critical-path — flag that before M16.
- Milestone 10 — PARKED (post-hackathon, not designed): bot chat-script
  API. No contract doc exists. Building it now would spend critical-path
  time on an undifferentiated guided-chat surface; it also drifts
  toward the avoid-list's generic-chatbot shape if framed carelessly.
- Milestone 11 — PARKED (post-hackathon, not designed): bot data-storage
  API. No contract doc, and the replace-vs-supplement localStorage
  question is still unanswered. Not needed for the demo.
- Milestone 12 — BOT SIDE LIVE, CLIENT NOT BUILT: bot write API
  (`POST /ig/send`, public outbound-media host, fail2ban+Cloudflare —
  see `docs/instagram-bot-send-api.md` "As implemented"/"Applied").
  Two blockers remain before any real DM can be sent: (a) no client
  module exists in `app/`; (b) `IG_GRAPH_SEND_TOKEN` on the bot is a
  placeholder with no real Meta credential, so real sends still `502`.
  Whether to close either blocker for this submission is M17's
  decision, not an assumption. The bot side is prior-work maintenance
  and must never be demoed as hackathon-built.

## Gap-closing milestones

### Milestone 14 (P0 — pass/fail gate): real Meta Model API integration

**Status: IMPLEMENTED 2026-10-28** (Autumn's go recorded as decision #6
in `docs/decisions.md`). Live-verified the same day: one real call per
proxy endpoint against `api.meta.ai`, all 200 — SAM 3.1 segmentation,
Spark vision classification, Spark copy, Spark assembly, Muse Image
preview. Tests: `app/test/milestone14-meta-api.test.js` (39, fake
upstream). Known limitation: SAM polygons are SAM box rectangles; mask
rasters are metadata only until a `@meta-sam/parser` pass decodes them.
Original gap analysis kept below for the record.

**Gap:** the submission must "meaningfully use Meta Model API and/or
Meta open-weight models" — a pass/fail gate before scoring (compliance
skill). Today every AI surface is a stub (M1–M3 above), so as it stands
the project fails the gate regardless of polish. `docs/decisions.md`
records the real key as provisioned in `.env/secrets`, held until
Autumn says go. **This milestone needs that explicit go, recorded in
`docs/decisions.md`, before any task below starts.**

- **14a — API spike + backend architecture (do first, time-boxed).**
  Check the Meta Model API cookbook (compliance skill, Learning
  resources) for the actual Spark/Image/SAM endpoints and response
  shapes; do not design against the `TODO` comments' guesses. Decide
  where calls run: the app is a static browser page, so the key must
  never ship to the browser or appear in source/network-visible
  requests from judge machines. Smallest compliant shape wins (e.g. a
  thin local/hosted proxy reading the key from the process environment,
  per `docs/decisions.md` §Secrets — parse `.env/secrets`, never
  `source` it, never print it). Record the decision in
  `docs/decisions.md`. Acceptance: one authenticated Spark call from
  the chosen runtime with the key sourced from env, and a grep showing
  no key material in tracked files.
- **14b — SAM 3.1 segmentation.** Replace `StubSegmentationService`
  behind the existing `segment(imageEl, sourceId) -> {polygons, boxes}`
  contract in `app/app.js`; keep the manual-box fallback and the cached
  demo set as the failure path. Acceptance: a real photo (not an SVG
  demo) returns real polygons; API-down shows the manual-box path, not
  an error dead-end.
- **14c — Spark garment classification.** Replace/augment
  `classifyRegion`'s heuristic with a Muse Spark call behind the same
  `{category, method, confidence, placeholder}` shape; keep the fixed
  taxonomy and the tie-blouse/shrug = layer rule as a validation layer
  (Spark proposes, fit rules dispose). Keep the heuristic only as an
  explicitly-labelled offline fallback. Acceptance: `placeholder`
  flips to false only on a real model response.
- **14d — Spark look assembly + copy.** This closes the pitch gap:
  today a human manually tags every piece and `generateCopy` fills a
  canned bank. Wire Spark to propose 2–3 complete looks from the
  wardrobe/resale candidates (see M15 for the candidate data), pass
  every proposal through `assembleLook` unchanged as the validator,
  and generate the per-piece copy through `generateCopy`'s existing
  shape and ≤300-word budget. Frame this as agentic reasoning
  (propose → validate against fit rules → revise/flag orphans, never
  silently re-pair) — that framing is both honest and the "Best
  Agentic Use-Case" angle. Acceptance: one photo yields at least one
  `valid:true` card whose copy came from the API, with invalid
  proposals visibly rejected by the existing rules, not hidden.
- **14e — Muse Image preview.** Replace `generateImage`'s canvas
  collage behind its existing return shape; present output as a look
  card, never as a fake worn try-on (pitch risk note). Keep the collage
  as the labelled fallback when image generation fails.
- **14f — Cached/offline demo mode.** Precompute and cache real-API
  results for the demo set (masks, classifications, copy, previews) so
  the video and live demo survive an API outage or quota limit
  (`docs/pitch.md` Demo fallbacks). Cached results must be labelled
  as cached in the UI/logs used for rehearsal, and the live path must
  be the default. Acceptance: full demo runs with the network to the
  Model API blocked, using cached results, and with it open, using
  live results — both recorded in rehearsal notes for M4.

### Milestone 15 (P1): resale-grounded candidate data

**Gap:** the differentiator is "resale-grounded, vendor-grounded copy
(measurement, fabric, flaw, price)", but all copy today is invented
placeholder with no candidate inventory behind it, and the pitch's
stale-stock handling does not exist. Invented copy must never be
presented as real listings.

- Build a small, clearly-synthetic demo inventory in-repo (structured
  records: category, measurements, fabric, flaw, price, vendor name,
  snapshotted-at date) that M14d's assembly selects from; label it
  synthetic demo inventory wherever it surfaces.
- Snapshot price/vendor at card creation and mark stale entries
  (snapshot older than a stated threshold shows a stale flag, per
  `docs/pitch.md` risks).
- Acceptance: every per-piece line on a demo card traces to an
  inventory record's fields; removing/aging a record changes the card
  (flagged stale or re-assembled), never silently stale.

### Milestone 16 (P0 for Demo 25%): judge-ready hosted product

**Gap:** judges assess video, code, **and the live product**. Today
the live product only runs on Autumn's machine (static server + local
Node mock on `127.0.0.1:8904`); a remote judge who opens the repo gets
no runnable product, and there is no root `README.md` at all.

- **16a — Hosted live URL.** Deploy the static app somewhere a judge
  can open with one link and no local processes (e.g. GitHub Pages or
  equivalent static host). The hosted build must run the full judged
  flow self-contained: cached/M14f demo mode and the fixture inbox work
  without the local mock or the real bot. If M14's proxy is needed for
  live calls, host that too or make the hosted build cached-first with
  live calls clearly optional. Acceptance: fresh browser, logged out,
  one URL → complete look card, no console errors, no `127.0.0.1`
  dependency in the primary flow.
- **16b — Root README + judge framing.** Add `README.md` at repo root:
  one-line pitch centred on full-look assembly + fit rules +
  resale-grounded copy (**not** the classify-a-photo mechanic — the
  avoid-list bans "simple image analyzers"; see AGENTS.md rule 4),
  how to run locally and the hosted link, architecture (what calls
  which Meta model, where the key lives), what's real vs cached vs
  fallback, and the prior-work boundary summary linking
  `docs/prior-work-instagram.md`. Update the stale status in
  `docs/overview.md` (still dated 2026-10-14, "Not yet applied") and
  `docs/brief.md` in the same pass.
- **16c — Product-surface polish.** `app/index.html` still titles
  itself "Milestone 3", leads with "tag regions with the
  garment-classifier stub", and footers a list of stubs. Retitle and
  reframe around the full-look outcome; `placeholder` tags may remain
  only where a fallback genuinely produced the content. Replace or
  supplement the SVG demo photos with realistic wardrobe/mirror photos
  that are synthetic or Autumn's own (never real DM captures — see
  compliance skill, synthetic-data rule). Check the flow on a phone-
  width viewport: the input story is a mirror selfie.
- **16d — Close stale decisions.** Record in `docs/decisions.md`:
  boutique-ui vs Next.js is settled de facto (vanilla static app in
  `app/` — strike the open question with that reasoning), and the
  M8 descope + M17 send decision outcomes.

### Milestone 17 (P2 — decision first): real send path, or descope it

**Gap:** M12's bot side is live but unusable end-to-end (no client,
placeholder Graph token), while M13's mock already proves the send
contract visually. Building the real client is the highest-risk item
left (it messages a real external person — explicit go-ahead required
before even drafting the client contract, per compliance skill).

- **Decision (Autumn, before any build):** (i) build the client +
  provision a real `IG_GRAPH_SEND_TOKEN`, demo the real send only as
  prior-work infrastructure being *called* by new client code; or
  (ii) descope the real send for this submission and demo sends
  exclusively through the M13 mock. Default to (ii) unless the real
  send materially helps the demo — the mock already shows the flow
  with zero platform risk.
- If (i): client module in `app/` calling `POST /ig/send` with the
  confirmation UI the spec requires (exact text+image shown, single
  `confirm:true` gate, fresh idempotency key per deliberate action),
  typed error surfacing (`422 reply_window_expired`, `409
  duplicate_send`/`idempotency_key_reused`, 401 credential, bot-
  unavailable keeps an unsent draft — never queued blindly), `is_echo`
  skipped, sender IGSID never exposed (reference the opaque `share_id`
  only). Acceptance includes the stale-share and duplicate demos
  against the **mock first**, then one consented real send.

### Milestone 18 (P0): M13 live isolation proof + browser end-to-end

**Gap:** M13 is "built" on static tests and a docs-based parity diff
(`docs/milestone-13-contract-parity.md` compared codes against spec
text, not a live bot). The claim judges would rely on — the demo runs
with zero Instagram dependency — is not yet proven live.

- Run `docs/milestone-13-mock-dm-plan.md` §5 steps 1–6 verbatim with a
  human at a real browser: real bot stopped, `/etc/hosts` block on the
  real hosts, mock + static server only, the four-beat chat flow
  (share photo → inbox → pipeline → send-as-app bubble), console +
  Network-tab capture filtered on the blocked hosts (must be empty, no
  multi-second stalls), then restore and re-run the swap-back walk
  against the real backend. Record results in the parity doc's
  Isolation section; any fallback/"bot unavailable" noise in the
  primary flow is a bug to fix, not a note to file.
- In the same pass, add the missing direct tests: `assembleLook` fit
  rules (valid layer finish, valid scarf+bag finish, two-layer
  rejection, shoe rejection, lone-scarf/lone-bag/base-only rejection,
  ≤300-word trim) and `generateCopy`'s budget/placeholder flags, as
  `node`-runnable tests in `app/test/` matching the existing style.
- Acceptance: parity doc's live half signed off with evidence noted,
  and the full test suite (existing 142 + new) green in one run.

### Milestone 4: submission cut (was one line; now the checklist)

**Gap:** this was "video, cached mode, live rehearsal" with no owner,
date, or package checklist, against a hard deadline with Demo at 25%
and a pass/fail Meta-model gate in front of it.

- **Application/submission status check (immediately):** confirm the
  Cerebral Valley application/submission state and record it in
  `docs/decisions.md` — Milestone 0 has no receipt in-repo, and the
  submission is one project, solo, via the Cerebral Valley submit
  page with **public repo link + 3-minute demo video + every
  contributor's name**.
- **Video (3 minutes, script drafted as soon as M14d lands, not after
  all polish):** centre full-look assembly + fit-rule reasoning +
  resale-grounded copy and the agentic propose→validate loop; never
  lead with the classify-a-photo mechanic; only showcase features
  built during the hackathon window — the real Instagram bot is prior
  work and must not be shown as a meta-styles feature (the M13 mock
  path is the demoable surface). Optional: post the video to X for
  Most Viral (engagement counts through Nov 8 EOD).
- **Live rehearsal:** full run against the hosted URL (M16a) and the
  cached mode (M14f), timed, with the API-down fallback exercised once.
- **Repo goes public (before submitting):** re-run the key/token grep
  across the whole tree, confirm `.env/secrets` is gitignored and
  absent from `git ls-files`, confirm no SecondBloom code is vendored
  in (docs references only). Record the grep date/result here when done
  (last clean run before this review: 28 Oct 2026).
- **Final compliance re-check:** re-fetch the Official Rules waiver URL
  (Organizers may modify terms at any time) and re-check the compliance
  skill's "Unverified" section for new FAQ content.
- **Submit before Nov 4, 9:00 PM ET** (no grace period); test both the
  repo link and video link resolve logged-out in a fresh browser, and
  confirm the hosted live product still runs after submitting.

## See also

- Build vs reuse vs risks per Instagram milestone:
  `docs/instagram-integration-plan.md` (Milestones 7/8 there are
  superseded/descoped per above; that file needs a pointer update when
  M16d lands).
- Compliance and the pass/fail gate: `skills/meta-hackathon-compliance/SKILL.md`.
