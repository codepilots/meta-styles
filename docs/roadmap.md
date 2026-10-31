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
   **Note (Bramble, 2026-10-30):** M18 as literally written targets the
   old `app/app.js` static-panel path, which decision #8(1) parked as an
   unlinked dev/debug tool, not demoed. The actually-judged surface per
   decision #7/#8 is the chat-first `wardrobe-service` + M21/M22 skills.
   `start.sh` already wires `wardrobe-service/server.js` into the one-
   command judged demo (`README.md`), so M18's real remaining ask is a
   live isolation/E2E pass against *that* surface (mock bot stopped is
   N/A here since the chat flow already defaults to the mock bot by
   design) — not the M13 static-panel walk as scoped in 2026-10-28.
   **Status: LANDED 2026-10-31.** `wardrobe-service/test/network-isolation-e2e.test.js`
   wraps global `fetch` plus `http`/`https.request` to record every outbound target, runs
   the real mock bot + keyless meta-api-proxy in-process on ephemeral loopback ports, and
   drives a 4-turn conversation (photo → photo → "show me a look" → purchase question)
   through the real `wardrobe-service` `processOne` path. Verdict: all 43 outbound attempts
   to 127.0.0.1, 4 real bot replies in `/mock/outbound` (no vacuous pass). Commit 9ef4774,
   author `muse-code <muse-code@noreply.invalid>` — correct per the app-code attribution rule.
   Verified: new test green standalone and under `node --test`; full suite 49/50 (1
   pre-existing environmental fail, `live-proxy` static-serve 502 in sandbox, fails on the
   clean tree too); `git show` diff clean of secrets.
3. **M16 — judge-ready local install+run** (blocks Demo 25%: judges
   assess the live product, not only the video). **Status update
   (Bramble, 2026-10-30):** per decision #8(3), M16 is a local one-shot
   install+run, not a hosted URL — M16a's "hosted static URL" sub-task is
   superseded by that decision, not outstanding. M16b (root `README.md` +
   judge framing) is substantially done: `README.md` documents the
   one-command `start.sh` path, which already launches the real
   `wardrobe-service` chat product, not just the old static panel.
   **Status 2026-10-31: M16 closed.** `README.md`'s architecture section
   (lines ~157-165) already names the "M21 agentic router + 11 skills"
   and per-turn skill dispatch — satisfies the remaining confirm-check.
   M16d's stale-decision cleanup is also closed (see Milestone 17 and
   the `docs/instagram-integration-plan.md` pointer update, both done
   2026-10-31). Nothing further under M16 before submission.
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
  (2026-10-29: M19h un-parks the MOCK side only — `mock-ig-bot/server.js`
  now persists per-user catalogs via `PUT/GET /ig/catalog/<user_ref>`
  with per-user AES-256-GCM at rest, wired to `app/wardrobe-catalog.js`
  `save()`/`load()`; the real-bot side stays parked per the compliance skill.)
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

- **16a — Hosted live URL — SUPERSEDED 2026-10-30, not required.**
  Decision #8(3) (M19 pivot, Autumn, 2026-10-29) settled judge delivery
  as a **local one-shot install+run** (judge supplies only their own
  Meta API key); a hosted live URL is an explicit stretch goal, not a
  submission requirement. Leaving this item's original text below for
  record, but do not spend build time on it before the deadline unless
  Autumn reopens it.
  ~~Deploy the static app somewhere a judge can open with one link and
  no local processes (e.g. GitHub Pages or equivalent static host). The
  hosted build must run the full judged flow self-contained: cached/M14f
  demo mode and the fixture inbox work without the local mock or the
  real bot. If M14's proxy is needed for live calls, host that too or
  make the hosted build cached-first with live calls clearly optional.
  Acceptance: fresh browser, logged out, one URL → complete look card,
  no console errors, no `127.0.0.1` dependency in the primary flow.~~
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
- **16d — Close stale decisions. CLOSED 2026-10-31.** Recorded in
  `docs/decisions.md`: boutique-ui vs Next.js was already settled de
  facto (struck 2026-10-29); the M8 descope and M17 send decision
  outcomes are both already covered by decision #8(2)/(3) — this pass
  added explicit "RESOLVED"/"SUPERSEDED" cross-reference notes at
  Milestone 17 above and at `docs/instagram-integration-plan.md`'s
  Milestones 7/8 (now marked superseded/descoped, pointing back to
  decision #8), so neither reads as an open gap any more.

### Milestone 17 (P2 — decision first): real send path, or descope it — RESOLVED 2026-10-31

**Resolved via decision #8(2)/(3) (Autumn, 2026-10-29): option (ii) — sends
stay mock-only (`mock-ig-bot/`) for this submission.** Real Instagram DM
sends are a stretch goal only, still gated by the compliance skill's
send-approval rule if ever pursued. Nothing further to build here before
submission. Leaving the original gap/options text below for record.

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
  `docs/instagram-integration-plan.md` (Milestones 7/8 there are now
  marked superseded/descoped, pointing back to decision #8 — update
  landed 2026-10-31 with M16d).
- Compliance and the pass/fail gate: `skills/meta-hackathon-compliance/SKILL.md`.

## Milestone 21 — Agentic wardrobe skills + router (MUSE SPARK)

**Status: core loop built (router/skills/loop wired into wardrobe-service); propose_look server-side Spark choice + preview-delivery truth landed 2026-10-30.** See `docs/milestone-21-agentic-skills-router.md` + vault `05` + `06` (skill cards).

2026-10-30 service fix (unplanned M20 maintenance): collected shares whose media is gone after the reply no longer retry-forever — a read-only `source_share_id` catalog match resolves them terminal as already-answered, and media-gone shares past the 24h window resolve `window_closed` at once (both need the catalogue skill's new real-share-id provenance, same change). Failed catalog saves are now loud (activity line + `counts.catalog_save_failed`) instead of silent. Suite that day: 22 files, 21 pass, 1 pre-existing environmental fail (`live-proxy` static-serve 502 in sandbox; fails on the clean tree too).

11 bounded skills (catalogue → propose → revise → describe → explain → no-data → off-topic + Match_look, Complete_the_look, What_suits, Evaluate_prospective_purchase) behind a router (Muse Spark, confidence 0-100, <70 → clarification). Every reply is one skill invocation, logged. Base persona: cheery green witch, fairy-core whimsical. Per-user rolling 100t summary + 100t preferences via bot catalog API. IG-ready look cards (logo+handle on image, caption separate). Builds on M20's persistent service; synthesises cleanly with existing assembler/validator/SAM/Spark stack.

Delegate to Muse (Muse Spark): `app/router.js` + `app/skills/` + `app/summariser.js`, wired through `wardrobe-service/server.js` polling loop. See milestone doc for full build spec.

## Milestone 22 — Skill stub audit (Bramble, 2026-10-30): real gaps found in the M21 skills

Full-codebase grep for `stub`/`placeholder`/`TODO` across `app/`, `wardrobe-service/`, `meta-api-proxy/`. Most hits are intentional, already-honest offline fallbacks (classifier.js/spark.js/preview.js's labelled `placeholder:true` stub banks for when the live Meta API is down — working as designed, not a gap) or belong to `app/app.js`/`app/index.html`, the panel UI explicitly parked as an "unlinked dev/debug tool, not deleted, not demoed" (decision 8(1)) — not worth further build time. The items below are genuine gaps in the LIVE M21 skill set (reachable via the router, confirmed each skill name is in `SKILL_NAMES` in `meta-api-proxy/server.js`'s `/api/route`), in priority order:

1. **`revise_look` and `Match_look` fabricate a fake image URL instead of generating a real one — an active honesty bug, same class already fixed in `propose_look` (commit `29518df`).** `app/skills/revise_look/handler.js:18` and `app/skills/Match_look/handler.js` both construct `image: { url: "https://example.invalid/SYNTH_..." }` — a non-existent placeholder domain, never generated, never staged, never sent. Unlike `propose_look`, neither skill calls `metaClient.preview()`, has any `imageDelivery` honesty struct, or appends an honest "can't send pictures" caveat — they silently claim an image shipped when nothing happened. Fix: give both skills the same real preview → stage → send pipeline `propose_look` already has (same `imageDelivery: {requested, generated, delivered, reason}` shape), reusing the real piece thumbnails per the photo-reference work (M21 cont'd) once that lands. **Highest priority — this is a user-facing lie, not just a missing feature.**
2. **`What_suits` never actually looks at the shared photo.** `app/skills/What_suits/handler.js` claims "from what I can see..." and promises encrypted photo storage, but the reply text is a hardcoded generic palette regardless of what the photo shows — no `metaClient.classify()` or vision call happens at all (contrast with `Match_look`, which does call classify). Fix: either call a real vision prompt against the actual photo for genuine personalised colour advice, or honestly soften the copy to not claim it analysed something it didn't. **FIXED 2026-10-30:** new `POST /api/palette` Spark-vision route + `metaClient.palette()`; handler uses the real returned palette words/note and falls back to the exact original generic reply only when the call fails (tests: `app/test/what-suits-vision.test.js`, `meta-api-proxy/test/palette.test.js`).
3. **`Evaluate_prospective_purchase` promises a "24-hour hold" that doesn't exist anywhere in the catalog schema.** The skill's copy says "I'll hold this one for 24 hours... say 'I bought it' to catalogue it" but there is no stored hold-state, no expiry mechanism, and no code path that actually catalogues the item if the user later says they bought it — the promise is conversational only. Fix: either build the actual hold-state (a new allowed piece/turn field, fail-closed schema per `wardrobe-catalog.js`'s existing pattern, with real expiry) or rewrite the copy to not promise a mechanism that isn't there. **FIXED 2026-10-30:** real hold-state — new evaluations store a `held` piece with `held_until` (+24h ISO) hidden from `getActivePieces()` until an "I bought it" router trigger + `activatePiece()` confirmation flips it `active` (tests: `app/test/evaluate-purchase-hold.test.js`).
4. **`Complete_the_look` has no real image at all (lower priority, not dishonest — it never claims one).** Text-only gap-suggestion + a generic Vinted search link. Could eventually get a real preview too, but isn't lying about it today — lowest priority of this list.

Acceptance: each fix needs a real `metaClient`/vision call (or an honest copy rewrite if no call is warranted), the same `imageDelivery` truth-telling shape `propose_look` established, and tests proving the fixed skill never claims a delivery that didn't happen (mirror `propose_look`'s own test coverage for this). Full suite green after each.

## Milestone 23 — second stub-audit pass (Bramble, 2026-10-30): two more real gaps, below M22's priority

With M22 fully landed and verified (30/30 tests on the last item, clean secret grep, correct `muse-code` authorship on all four), a fresh pass over `app/assembler.js`, `app/skills/explain_fit/handler.js`, `app/router.js`, `app/summariser.js` and `app/skills/catalogue_piece/handler.js` found two more real (lower-stakes, no active lie) gaps:

1. **`explain_fit` ignores the real look/catalog context it's given and always returns identical boilerplate.** `app/agentic-loop.js:141` passes every skill `catalog`, `lastTurns`, `wardrobeSummary` and `preferences` — `describe_wardrobe`, `Match_look`, `Complete_the_look` and `Evaluate_prospective_purchase` all use this data to tailor their replies to the user's actual pieces. `app/skills/explain_fit/handler.js` receives the exact same data and uses none of it: `handle(opts)` never reads `opts.catalog` or `opts.lastTurns`, just returns one fixed paragraph every time regardless of which look or pieces the user is actually asking about. Fix: look up the most recent proposed/revised look (via `lastTurns` or the catalog's active pieces) and name the actual pieces and finish type in the explanation, the way `Match_look`'s reply already does.
2. **`assembleLook`'s `FIT_NOTE` is a single fixed string that is factually wrong for half of all valid looks.** `app/assembler.js`'s `FIT_NOTE` constant always says "...layers are worn open so nothing pulls at the bust; accessories sit high..." — but a valid assembled look can have EITHER a layer finish OR a scarf+bag finish (never both, per the same file's own fit rules just above it), and the note is attached to every card regardless of which finish the actual look has. A scarf+bag look gets a note claiming it has "layers worn open," which is simply untrue of that look. Fix: branch `FIT_NOTE` on `finish` (`"layer"` vs `"scarf+bag"`, both already computed in `assembleLook`) into two short, accurate variants — not one. Minor/separate cleanup while touching this: the comment calls it a "placeholder" fit note, but the 6'2\"/18-top/12-bottom measurements it states are Autumn's real confirmed specs, not invented — the "(placeholder)" label is now stale and should be dropped once the note is corrected (do not confuse this with the per-piece resale-listing copy, which genuinely is invented/placeholder and stays that way — decision 8(4), out of scope).

Acceptance: both fixes need tests proving the output varies correctly with input (explain_fit: different text for a layer-finish vs scarf+bag-finish look; assembler: `assembleLook` returns the correct `FIT_NOTE` variant per `finish`, and the old single-string constant export some code may still import is either removed with callers updated or kept as a safe default — check callers before deleting). No image/network/honesty-struct work needed here, this is plain logic correctness. Full suite green after each. Priority below M22 — these are stale/generic-output bugs, not user-facing lies.

**Status: LANDED (cron pipeline), verified 2026-10-31.** Commit `e913af2` ("M23: per-finish fit notes + context-aware explain_fit"), author `muse-code <muse-code@noreply.invalid>` — correct per the app-code attribution rule. `app/assembler.js` now has `FIT_NOTE_LAYER`/`FIT_NOTE_SCARF_BAG`/`fitNoteFor(finish)`, with the old `FIT_NOTE` kept only as a safe-default export for any caller that still imports it (points at the layer variant); the stale "(placeholder)" comment on the real measurements was dropped. `app/skills/explain_fit/handler.js` now reads the most recent proposed/revised look via `lastTurns`/catalog active pieces (with user-text finish hints cross-checked against real catalog data — never inventing piece names) before falling back to an honest no-guess reply when there's no look/catalog data. Full suite green at 50/50 on this cron tick's run. This status note was the only thing missing — the code itself had already landed in an earlier tick that didn't record it.

## Milestone 24 — confirmed live bug (Autumn hit this for real, 2026-10-30): a photo reply to a pending consent question gets mis-routed to catalogue_piece

Autumn reported: she asked something that triggered `What_suits`'s consent prompt ("...you can share a head shot and a full-body photo... Would you like to share them?"), replied with the photo, and the bot didn't handle it as a `What_suits` answer. Root cause confirmed in BOTH routing paths, not just a heuristic-only edge case:

- `app/router.js`'s `heuristicSkill()`: `What_suits`'s own trigger rule is TEXT-only (`/\b(what suits|what would suit|my colours|...)\b/`), checked *before* the catch-all `if (hasImage) return catalogue_piece` rule — but a bare photo reply with no "what suits me" text in it never matches the What_suits regex, falls through, and hits `catalogue_piece` at confidence 94 instead.
- `meta-api-proxy/server.js`'s live `/api/route` system prompt has the identical gap: `catalogue_piece`'s listed trigger is literally "Photo(s) shared (image present, no other trigger)" and nothing in the prompt tells Spark to check `lastTurns` for a just-asked pending question before defaulting a bare photo to `catalogue_piece`. `lastTurns` IS passed to the prompt, but the system prompt never instructs the model to use it for continuation-detection — this is a genuine architectural gap, not something the model is likely to infer reliably on its own, and real traffic proves it doesn't.
- This is NOT a `What_suits`-only risk: any skill that asks a yes/no or "please share X" follow-up (e.g. a future consent gate) has the same exposure — the router classifies every turn fresh with no notion of "we are mid-flow, awaiting a specific kind of reply." **Confirmed by a full pass over every skill's own follow-up question (2026-10-30):**
  - `revise_look`'s "which piece would you like to swap or skip?" — a bare answer like "the scarf" (no verb) never matches its own trigger regex (`/\b(no |without |drop |...).*\b(bag|scarf|...)\b/` requires a verb), falls through to `off_topic` instead of continuing the revision. Likely *more* probable to happen than the `What_suits` case — a one-word answer to a direct question is natural.
  - `catalogue_piece` and `describe_wardrobe`'s "Want me to put a look together?" and `propose_look`'s "Want me to tweak anything?" — a plain "yes" matches no heuristic rule (not in the greeting list, not an explicit trigger) and falls to `off_topic`'s generic deflection instead of firing `propose_look`.
  - `Evaluate_prospective_purchase`'s "say 'I bought it'" — only the near-exact phrase matches; "yes"/"done"/"sure" replies miss the trigger and deflect instead of completing the purchase confirmation.
  - Ruled out as NOT bugs: `describe_wardrobe`'s and `propose_look`'s empty-wardrobe "share a photo" prompts correctly want a photo routed to `catalogue_piece` already — no mismatch there, don't touch.

Fix (architectural, not a regex patch — a one-off regex fix for this single case would just leave the same class of bug for the next consent-gated skill): add an explicit pending-expectation mechanism, generic enough to cover BOTH failure shapes found above (image-expecting and text-expecting follow-ups), not just `What_suits`. A skill's `handle()` result already has a `persist` field (`summaryDelta`/`preferencesDelta`) — extend it with an optional `pendingExpectation` (e.g. `{ skill: "What_suits", expects: "image" }` or `{ skill: "revise_look", expects: "text" }` or `{ skill: "propose_look", expects: "yes_no" }`), store it in the per-user turn state the same way `Evaluate_prospective_purchase`'s hold-state was just added (M22 item 3's pattern), and have `app/agentic-loop.js` check it BEFORE calling the router: if a pending expectation exists and this turn satisfies it (image present for `expects: "image"`; any non-empty text for `expects: "text"`; a yes-like word for `expects: "yes_no"`), route straight back to that skill deterministically, skipping the router guess entirely, and clear the pending state afterward. Wire this to all five call sites found above: `What_suits` (image), `revise_look`'s "which piece" follow-up (text), `catalogue_piece`/`describe_wardrobe`'s "want a look?" and `propose_look`'s "want me to tweak anything?" (yes_no → route to `propose_look`), and `Evaluate_prospective_purchase`'s "say I bought it" (yes_no → treat as purchase confirmation, not just the exact phrase). This also needs a timeout/expiry (don't let a stale pending-expectation from days ago hijack an unrelated later message) and must still fall through to normal routing when the pending turn ISN'T satisfied (e.g. user says "no thanks," or changes topic entirely — test: a declining/unrelated reply clears the pending state and routes normally, not back into the waiting skill).

Acceptance: a test proving the exact scenario Autumn hit (What_suits consent prompt → bare photo reply → routed to What_suits, not catalogue_piece), a test proving `revise_look`'s "the scarf" bare-piece-name reply continues the revision instead of deflecting, a test proving "yes" after "want a look together?" fires `propose_look`, and a test proving a non-matching reply (declining, or an unrelated text message) correctly falls through to normal routing instead of getting stuck. Full suite green. This is higher priority than M23 (a confirmed live failure a real user hit, not a theoretical logic bug) — delegate this before M23's two items.

**Status: LANDED 2026-10-30 (cron pipeline), verified by cron tick 20:2x.** `wardrobe-catalog.js` `askQuestion` now takes `{ text, skill, expects }` (`expects: "image"` only, fail-closed; bare-string form kept for existing callers) with a 24h ISO-8601 `expires_at` mirroring the M22 hold pattern. `What_suits`'s consent prompt records `{ skill: "What_suits", expects: "image" }` on the catalog (single source of truth). `agentic-loop.js` `handleTurn()` checks unresolved pending expectations BEFORE the router: satisfied (image present) routes straight back deterministically and resolves; unsatisfied or expired clears and falls through to normal routing. `meta-api-proxy/server.js` `/api/route` prompt now instructs Spark to check `lastTurns` for a just-asked pending question before defaulting a bare photo to `catalogue_piece`. Tests: `app/test/pending-expectation-routing.test.js` (exact Autumn scenario, decline fall-through, expiry, fail-closed contract, handler recording). Commit `df127eb`, author `muse-code <muse-code@noreply.invalid>` — correct per the app-code attribution rule. Verified: full suite 33/33 green, `git show` diff clean of secrets, system-prompt fix confirmed present in `meta-api-proxy/server.js`.

**Extended 2026-10-30 (cron pipeline) to the four remaining confirmed cases, per Autumn's direct request:** `revise_look`'s "which piece?" fallback (`expects:"text"`), `catalogue_piece`/`describe_wardrobe`'s "want a look?" closers and `propose_look`'s "want me to tweak anything?" (`expects:"yes_no"` → `propose_look`/`revise_look`), and `Evaluate_prospective_purchase`'s "say I bought it" (`expects:"yes_no"`, conservative whole-reply affirmative match, double-gated on a live hold so "maybe"/"I'll think about it" never confirms). `EXPECTS_VALUES` now `["image","text","yes_no"]`; `agentic-loop.js` gained a shared `isAffirmativeReply()`/`YES_NO_AFFIRMATIVE` matcher. Commit `5cbcc1e`, author `muse-code <muse-code@noreply.invalid>`. Verified: full suite 33/33 green, author correct, diff clean of secrets. Autumn also asked for a repo skill documenting this integration pattern for future skills — added as `skills/wardrobe-skill-integration/SKILL.md` (Bramble, docs-only, `claude-code` authorship).
