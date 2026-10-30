# Critical review — meta-styles (2026-10-30)

Reviewer: Claude Opus 5.5 (read-only pass, requested via Bramble). Nothing in
the repo was edited; this file is the only output.

**Scope and method.** Read `docs/decisions.md`, `docs/roadmap.md` (incl. the
uncommitted M24 edits), the compliance skill, `app/agentic-loop.js`,
`app/router.js`, `app/wardrobe-catalog.js`, `app/summariser.js`,
`app/assembler.js`, `app/meta-client.js`, every `app/skills/*/handler.js`,
`wardrobe-service/server.js`, `meta-api-proxy/server.js`, and the demo
script. Grepped the test suites for coverage of each finding.

**Line numbers are against `HEAD` (`e936eb1`).** A concurrent M24 delegation
is editing `agentic-loop.js`, `wardrobe-catalog.js`, and the
`catalogue_piece`/`describe_wardrobe`/`revise_look`/`propose_look`/
`Evaluate_prospective_purchase` handlers. Line numbers in those files may
shift slightly in the working tree. I did **not** run the test suite: it
starts servers on fixed ports and could collide with the delegation's own
test runs. I ran one throwaway `node -e` script from `/tmp` (no file writes)
to confirm finding 1. Its output is quoted there.

Known M22/M23/M24 issues are not re-reported. Where a finding touches one of
them, it says what is new.

---

## Critical

### 1. M22's image-honesty fix never reaches the user for `revise_look`, `Match_look`, `Complete_the_look`. They stage a preview, it is never sent, and the caveat is suppressed.

- **File:line:** `wardrobe-service/server.js:785-789` (send gate) vs
  `app/skills/revise_look/handler.js:58`, `app/skills/Match_look/handler.js:49`,
  `app/skills/Complete_the_look/handler.js:52` (return shape); compare
  `app/skills/propose_look/handler.js:424-427`.
- **What's wrong:** The service sends `withImage:true` only when
  `hr.meta.imageDelivery.delivered === true`. `propose_look` returns
  `meta.imageDelivery`. The other three return `imageDelivery` at the **top
  level** with no `meta`, so `withImage` is always `false` for them. But
  inside the handler `delivered` is already `true` once staging succeeds, so
  the "can't tuck preview pictures into chat" caveat is skipped. The user
  gets a text-only reply. A Muse Image call was paid for and staged, then
  thrown away. Verified with a scratch script (real handlers, fake
  preview/stage):
  ```
  revise_look       delivered(top-level)= true  server withImage= false  caveat in text= false
  Match_look        delivered(top-level)= true  server withImage= false  caveat in text= false
  Complete_the_look delivered(top-level)= true  server withImage= false  caveat in text= false
  ```
- **Why it matters:** This is the same honesty class M22 called "highest
  priority". M22 passed only because its tests check the handler, not the
  service. It also removes the Muse Image moments from three of the four
  look-producing skills in the demo, which hurts the Use of Meta AI Tooling
  score (25%).
- **Fix direction:** Pick one result contract (`meta.imageDelivery`, which
  the service and `restart-dedupe-image.test.js` already use) and move the
  three skills onto it. Add a service-level test per skill asserting
  `image:true` reaches the mock bot's outbound log.
- **Severity:** critical

### 2. The live agentic flow can't produce the scripted demo arc, and its photo replies look like a "simple image analyzer" (avoid-list risk)

- **File:line:** `app/skills/catalogue_piece/handler.js:96`;
  `app/skills/propose_look/handler.js:227-237, 350-351`;
  `docs/demo-video-script-19g.md:38-85`; acceptance text at
  `docs/roadmap.md:189-191`.
- **What's wrong:** The demo script (beats 2–4) was written for the M19
  `turn-loop.js` path. In that path every photo turn carried a proposal plus
  the validator's `reasons[]`, cited piece ids and source shares, and ended
  on a fit-rule-shaped buy. That path is now dead code
  (`processPhotoShare`/`processTextShare`, `server.js:812-879`). In the M21
  agentic path:
  - Photo 1 gets "Got your dress — noted, loveling! … Want me to put a look
    together?" There is no look and no validator verdict. That is a classifier
    answer in a nice voice.
  - Photo 2 gets the same canned line. No cross-photo mix happens unless the
    user types an explicit look request.
  - Replying "yes" to that question routes to clarification (see finding 13).
  - When a look is produced, the reply never mentions the fit-rule check. When
    Spark proposals are rejected, the rejections go only to `console.log`
    (`propose_look/handler.js:229`). M14d's acceptance said "invalid proposals
    visibly rejected by the existing rules, not hidden".
- **Why it matters:** The compliance skill names this exact risk: a demo that
  leads with classify-a-photo reads as a "simple image analyzer", which is an
  explicit disqualification category. The judged surface currently hides the
  propose → validate → reject loop, which is the project's best argument
  against that label and its "Best Agentic Use-Case" angle.
- **Fix direction:** After `catalogue_piece`, run `propose_look` in the same
  turn when a valid look becomes possible. Otherwise state the fit-rule gap
  ("a dress alone isn't a full look yet — needs one layer or a scarf + bag").
  Surface one short "Spark suggested X; fit rules rejected it because Y" line
  in replies when a rejection happened. Then re-walk the demo script against
  the real agentic replies and rewrite beats 2–4 to match what the code says.
- **Severity:** critical (disqualification-adjacent plus Demo 25%)

---

## High

### 3. Inbound photo media is DELETEd even when the reply failed to send, so the reply is silently lost and later logged as "already answered"

- **File:line:** `wardrobe-service/server.js:790-794` (ack runs on every
  outcome, including `"retry"`), `server.js:922-944` (media-gone replay
  path).
- **What's wrong:** `acknowledgeMedia(item.media_id)` runs after
  `sendComposed` no matter what it resolved to. Take a transport failure,
  401, a generic 5xx, or a staged-image Graph failure: the outcome is
  `"retry"`, but the media is deleted anyway. On the next tick the share has
  `media_available:false`. If the skill had already added a piece
  (`catalogue_piece`, or `Evaluate`'s held piece), the replay matches
  `source_share_id` and goes terminal as "That photo was already answered
  earlier". The user never got a reply. For `What_suits`/`Match_look` photos
  (no piece added), the share retries five times and then `gave_up`. The
  comment at `server.js:791` says "ONLY after bytes were in hand and
  catalogued". The code doesn't gate on that.
- **Why it matters:** Silent loss of a user-facing reply, plus a status line
  that says the opposite. In live mode, `IG_GRAPH_SEND_TOKEN` is still a
  placeholder (roadmap M12), so failed sends are the normal case there.
- **Fix direction:** Acknowledge only when the outcome is
  `terminal:sent`/`terminal:duplicate` (or another terminal outcome),
  never on `retry`. Add a test: bot returns 503 on send → media still
  present → the next tick sends exactly once.
- **Severity:** high

### 4. If the media fetch fails, the agentic path swallows the error. `catalogue_piece` then claims "tucked safely in your wardrobe" with nothing catalogued, and the photo is deleted

- **File:line:** `wardrobe-service/server.js:354-358` (fetch failure →
  `return null`), `app/skills/catalogue_piece/handler.js:71, 95-96`.
- **What's wrong:** `runAgenticTurn` swallows a `fetchMediaBytes` rejection,
  leaving `imageDataUrl = null` while `hasImage` stays `true`. The router
  still picks `catalogue_piece` (heuristic confidence 94). The handler skips
  cataloguing (`if(catalog && imageDataUrl)`) but still returns "Got your
  piece — noted, loveling! ✨ It's tucked safely in your wardrobe." Then
  finding 3 deletes the media. The legacy path handled this correctly by
  throwing `media_unavailable` and retrying (`server.js:596-598, 869-875`).
  The agentic path lost that behaviour. The same null-image turn sends
  `What_suits` to its generic "From what I can see…" fallback (finding 9).
- **Why it matters:** A false claim to the user (M22 class, new call site)
  plus permanent loss of the photo.
- **Fix direction:** In `runAgenticTurn`, make a media fetch failure for a
  `hasImage` share reject with `media_unavailable` so the existing retry
  branch at `server.js:797-803` handles it. In `catalogue_piece`, return
  honest copy when `pieces.length === 0`.
- **Severity:** high

### 5. One failed catalog load at first contact means the next save overwrites the user's whole stored wardrobe

- **File:line:** `wardrobe-service/server.js:439-452` (`ctx.loaded = true`
  before load, failure "degrades to memory-only", never retried);
  `app/wardrobe-catalog.js:713-716` (`save()` PUTs the full in-memory array);
  `app/wardrobe-catalog.js:721-737` (fail-closed load leaves memory empty).
- **What's wrong:** If `load()` fails for any reason, the catalog stays empty
  in memory and `loaded` is pinned true. Possible reasons include a transient
  network error, a 5xx, or a schema rejection: one stored piece carrying a
  key that `PIECE_KEYS` doesn't know, which is likely while the schema keeps
  growing (`photo_thumb`, `held_until`, now M24 fields) or if the real bot
  adds a field. The next `catalogue_piece` → `save()` then does a whole-array
  PUT of just the new piece. The mock/real bot treats that as last-write-wins
  and replaces the user's entire stored wardrobe. The fail-closed validation
  is meant to protect the data, but combined with whole-array replace it
  causes the loss.
- **Why it matters:** Silent, unrecoverable data loss of the product itself
  (decision 7: "the wardrobe is the product"). The only trace is one
  "starting fresh" activity line.
- **Fix direction:** Track `loadedOk` separately and refuse to `save()`
  until a load has succeeded (retry the load on the next turn). At minimum,
  never PUT after a failed load. No test covers this today
  (`milestone19h` only checks that memory is untouched on a bad load).
- **Severity:** high

### 6. `lastTurns` is always empty in production, so M23's explain_fit context path and M24's router-prompt instruction both do nothing

- **File:line:** `wardrobe-service/server.js:346-350` (lastTurns from
  `catalog.getTurns()`), no `recordTurn` call anywhere in the agentic path
  (only `app/turn-loop.js:248,262,324`, which the service no longer calls);
  `app/skills/explain_fit/handler.js:84-100, 105-114`;
  `meta-api-proxy/server.js:409, 418, 426`; `app/router.js:34` (`lastTurns`
  computed, never used).
- **What's wrong:** No skill records a turn, so `getTurns()` returns `[]`
  and `lastTurns` is `[]` on every live turn. Even if turns were recorded,
  `server.js:349` keeps only `userText`, never the bot's own question. So:
  - M24's proxy prompt ("FIRST check Recent turns: if the assistant just
    asked the user to share a photo…") can never fire. The assistant's
    question is never in the context. The `askQuestion` mechanism is the only
    thing actually working.
  - explain_fit's M23 steps 1–2 (latest proposal, text hints) are
    unreachable live. It always falls through to `lookFromActive`, which
    (a) concatenates **every** base in the wardrobe ("Your top + top + dress
    + bottom + cardigan work because…") and (b) returns `null` whenever the
    wardrobe has two layers and no scarf+bag pair. In case (b), "why does
    this work?" asked right after a valid look gets "I don't have a look to
    read just yet".
  - M23's tests pass because they inject turns that production never
    produces.
- **Why it matters:** explain_fit is the natural "show the reasoning" beat
  in a live demo, and it will either list the whole wardrobe or say there's
  no look. Two milestones are marked verified on behaviour that doesn't
  happen live.
- **Fix direction:** Have `propose_look`/`revise_look` call
  `catalog.recordTurn({ userText, proposal:{pieces, title, note:"valid:"+finish}, verdict, reasons })`.
  Build `lastTurns` from both the user's text and the bot's sent text
  (`getSentTurns()` already exists). Add one service-level test:
  propose → "why does this work?" names exactly the proposed pieces.
- **Severity:** high

### 7. `revise_look` permanently rejects every piece of the named category, then "re-weaves" by listing and validating the whole wardrobe

- **File:line:** `app/skills/revise_look/handler.js:22` (rejectPiece on all
  active pieces of `cat`), `:28-35` (assembleLook over **all** active
  pieces).
- **What's wrong:**
  - "No bag" / "skip the scarf" is a request about one look. The handler
    calls `rejectPiece` on **every** active bag. `rejected` is a terminal
    status: nothing reactivates it, `getActivePieces()` hides it, and the
    reply says "set aside … for now". The user's bags are gone from all
    future looks.
  - There is no record of "the last look" (see finding 6), so the
    "re-woven" look is `assembleLook(<entire active wardrobe>)`. The copy
    lists every remaining piece ("Your dress + cardigan + scarf are looking
    darling together"). For any wardrobe with more than one layer or a stray
    accessory the result is invalid, and the reply just leaves out the fit
    check without saying why. The scratch run produced
    `Your dress + cardigan + scarf are looking darling together. Fit check: valid ✔`,
    which also shows finding 11.
  - The Muse Image preview prompt names the whole wardrobe, not a look.
- **Why it matters:** "Drop the bag" is the most natural follow-up in a live
  demo. It destroys catalog data and shows a non-look. It also misses
  `propose_look`'s validation stack (strictShape + Spark + fallback) that
  already exists.
- **Fix direction:** Treat a revision as a constraint on the next proposal.
  Exclude the category for this turn (or record it as a preference), then
  call `propose_look`'s selection logic on the remaining pieces. Reserve
  `rejectPiece` for an explicit "remove this from my wardrobe".
- **Severity:** high

### 8. Every off-topic reply links a guide under the prior-work SecondBloom path

- **File:line:** `app/skills/off_topic/handler.js:7`,
  `app/agentic-loop.js:152`, `app/skills/off_topic/prompt.md:8-9`.
- **What's wrong:** The deflection text includes
  `https://codepilots.co.uk/secondbloom/guide.html`. That page isn't in the
  repo, so I can't tell whether it is meta-styles-built content or
  SecondBloom-branded prior work. Either way, a judge sees the prior-work
  product name in the hackathon bot's most frequent fallback reply.
- **Why it matters:** AGENTS.md hard rule 1 and the FAQ: the submission must
  "clearly identify — and only showcase" hackathon-built work. Unclear
  boundaries "can lead to disqualification". This could be fine, but it
  should be a deliberate decision, not an accident.
- **Fix direction:** Autumn should confirm what that page is. Safest option:
  serve a guide from this repo (e.g. `app/guide.html` on the local static
  server) or drop the link. Record the call in `decisions.md`.
- **Severity:** high (compliance, needs a human decision)

---

## Medium

### 9. Fallback copy still claims to have seen the photo when no vision call ran, and promises photo storage/deletion that doesn't exist

- **File:line:** `app/skills/What_suits/handler.js:54` (fallback),
  `:34, 50, 54` (encryption/delete promises);
  `app/skills/Match_look/handler.js:21`.
- **What's wrong:** M22 item 2 left the generic fallback "word-for-word".
  It still says "From what I can see, soft lilac, sage and warm cream…".
  That fallback runs whenever `palette()` fails, and with no key (the README's
  documented keyless judge path) it fails every time. `Match_look`'s fallback
  says "I see soft Y2K x fairycore vibes" with the same problem. Separately,
  all three What_suits texts say the photos are "stored encrypted" and "you
  can say 'delete my photos' anytime". Nothing stores the What_suits photo:
  the media is DELETEd after reply (finding 3) and no piece is added. No
  router rule or skill handles "delete my photos" (it routes to off_topic).
- **Why it matters:** A judge running without a key gets an "I can see you"
  claim with no model call behind it. The consent and deletion promise is a
  privacy statement with no mechanism, in a project whose decision 9 makes
  consent and deletion a first-class concern.
- **Fix direction:** Fallback copy should say it's general advice
  ("I couldn't read the photo just now, so here's a general palette…").
  Either drop the storage/delete promise (photos aren't kept, which is the
  better privacy story anyway) or implement it.
- **Severity:** medium

### 10. The summariser's "persistence" is a no-op that reports success, and the rolling summary stops changing after ~4 turns

- **File:line:** `app/summariser.js:54-71` (`persistViaStore` builds a URL
  and returns `{ok:true}` without any request), `:33-35` and `:42-44`
  (`truncateTokens(prev + addition)` keeps the **first** 400 chars);
  claim at `wardrobe-service/server.js:306-307`.
- **What's wrong:** (a) Summary and preferences live only in `ctx`
  memory, so they are lost on restart. The comments say they are PUT to
  the bot, and the result says `ok:true`. (b) The new turn is appended and
  then the string is cut from the front. Once it reaches ~400 chars, every
  later addition is cut off, so the "rolling" summary and preferences freeze
  at the first few turns. (c) `preferencesDelta` ("Prefers without bag.",
  palette words) goes only to the router prompt. `propose_look` never reads
  preferences, so a stated preference never changes a look.
- **Why it matters:** The M21 summary/preferences story is part of the
  agentic claim. As built, it's a stale, non-persisted string, and the code
  reports it as persisted.
- **Fix direction:** Keep the tail (`slice(-maxChars)`) or summarise
  properly. Either persist for real or change `ok:true` to an honest
  `not_persisted`. Feed preferences into `propose_look`'s Spark prompt.
- **Severity:** medium

### 11. The fit engine accepts layer + lone scarf (or layer + lone bag) as valid, which contradicts its own header rule

- **File:line:** `app/assembler.js:9-10` (rule: "a lone scarf or a lone
  bag is flagged, not silently accepted") vs `:83-96` (lone scarf/bag is
  only flagged when there is **no** layer finish);
  `app/skills/propose_look/handler.js:88-94` (strictShape has the same
  gap).
- **What's wrong:** `{dress, cardigan, scarf}` → `finish:"layer"`,
  `valid:true`, no note. The extra scarf is silently accepted (the scratch
  run's revise reply shows "Fit check: valid ✔" for exactly this set).
  Either an accessory on a layer look is allowed, in which case the header
  and decision 3 ("base + layer/scarf/bag") need saying so, or the rule is
  wrong.
- **Why it matters:** The fit-rule engine is "the project's strongest real
  component" (roadmap). A judge who reads the code will check the stated
  rules against the behaviour.
- **Fix direction:** Ask Autumn which is intended. Then either flag stray
  accessories (as a reason, or a note like the dress+separates one) or
  update the header and tests. M18's planned "lone-scarf rejection" test
  should cover the with-layer case too.
- **Severity:** medium

### 12. `Complete_the_look` and `Evaluate_prospective_purchase` give outfit/buy advice that skips the fit engine and sometimes contradicts it

- **File:line:** `app/skills/Complete_the_look/handler.js:22-26`;
  `app/skills/Evaluate_prospective_purchase/handler.js:59-66, 126`.
- **What's wrong:**
  - `Complete_the_look` suggests a scarf by default. That includes a user
    who has a layer but no bag (a lone scarf is an "incomplete finish" by
    the app's own rule) and a user who already owns a scarf+bag pair (it
    suggests another scarf). It never calls `assembleLook`.
  - `Evaluate` always claims "could unlock 3 lovely outfits". The three are
    template strings over `active.slice(0,2)` (which can read "your top and
    top"). Outfit 3 is "Layered open over what you've got" whatever the item
    is, including a bag. Nothing is validated.
  - `Evaluate` ends with "Want a preview image too?", but no code path
    produces a preview for a held item, and the M24 work doesn't list this
    as a follow-up.
  - Beat 4's honesty rule in the demo script says "never a vendor", yet
    `Complete_the_look` links a `vinted.co.uk` search. It's arguably
    category-level, but that should be decided, not left to chance.
- **Why it matters:** Beat 4 (the one-purchase ending) depends on this
  skill. Advice that breaks the fit rules on camera undercuts the core
  pitch.
- **Fix direction:** Derive the gap from `fallbackChoose`/`strictShape`:
  pick the cheapest single addition that turns an invalid best look valid.
  Validate Evaluate's outfits with `assembleLook` and count the real ones.
  Remove or implement the preview offer.
- **Severity:** medium

### 13. Heuristic router gaps that matter on the keyless judge path (beyond M24's list)

- **File:line:** `app/router.js:49-51` vs `:82-84`; `:105-107`;
  `meta-api-proxy/server.js:410, 412`.
- **What's wrong:**
  - Photo + "is this worth it?" / "should I get this?" returns
    `catalogue_piece`. The text-only Evaluate trigger sits after the
    `if (hasImage)` catch-all, so an item the user is only **considering**
    gets catalogued as owned.
  - Any text shorter than 4 chars returns confidence 45 and the generic
    clarification. "yes", "no", "ok" and "the" all get "did you mean to share
    a piece, see a look, or tweak one?". M24 says "yes" falls to
    `off_topic`; on the heuristic path it actually hits this clarification.
    Same root cause, but the M24 tests should assert the right branch.
  - The live router prompt lists "find the bag" as an example for **both**
    `propose_look` and `describe_wardrobe`.
- **Why it matters:** With no key, the heuristic router is the router, and
  these are natural demo inputs.
- **Fix direction:** Move the text-only Evaluate trigger above the image
  catch-all. Make the length/greeting guard defer to a satisfied pending
  expectation (M24 work in progress). De-duplicate the prompt example.
- **Severity:** medium

### 14. Preview caching is keyed on a categories-only prompt plus image length, is unbounded, and can serve one user's image-edit to another

- **File:line:** `app/meta-client.js:137-143` (`memCache`, key =
  prompt + image length); `meta-api-proxy/server.js:367-368, 385` (same key
  shape in the proxy's `cache` Map); prompts built from nouns only, e.g.
  `propose_look/handler.js:372-374`.
- **What's wrong:** The preview prompt is just "…garments laid out neatly:
  dress + cardigan…". With no thumb, every "dress + cardigan" look for every
  user in the process gets the **same** cached image. With a thumb, the key
  includes only the thumb's length, so two different garments whose PNG
  thumbs happen to be the same length collide. User B could then receive an
  image-edit derived from user A's garment photo. Both caches are plain Maps
  of multi-MB data URLs that never evict, inside long-lived processes. The
  segment/classify/palette keys use the first 4096 chars + length (lower
  risk, same pattern).
- **Why it matters:** Stale or wrong previews are judge-visible. The
  cross-user case is a (low-probability) privacy leak in live mode. Memory
  grows without limit.
- **Fix direction:** Hash the full image (sha256 of ≤12 MB is
  milliseconds) plus the piece ids. Bound both caches (simple LRU, or drop
  the client-side preview cache in Node).
- **Severity:** medium

### 15. The proxy has no upstream timeout, and the service's single serialized tick means one hung Meta call stalls every user

- **File:line:** `meta-api-proxy/server.js:170-192` (no `AbortController`
  on `fetchImpl`); `wardrobe-service/server.js:994-1038` (`tickInFlight`,
  items processed strictly in sequence); client timeouts at
  `app/meta-client.js:63, 96, 107, 140` (30–180 s).
- **What's wrong:** The only bounds are client-side: 60 s classify plus
  180 s segment for a photo, and 60 s assemble plus 120 s preview for a
  look. One slow upstream holds the entire poll loop for minutes, and the
  proxy keeps the abandoned request open after the client gives up.
  Malformed-but-200 upstream bodies are handled well everywhere I checked
  (`parseJsonText` → null → 502 → skill fallback). Hangs are the gap.
- **Why it matters:** In a live demo, a slow Muse Image call looks like the
  bot is dead for everyone.
- **Fix direction:** Add a per-route upstream timeout in the proxy
  (shorter than the client's), and consider a per-turn wall-clock budget in
  `runAgenticTurn`.
- **Severity:** medium

---

## Low / nitpick

16. **`Evaluate` confirms the oldest live hold, not the newest; text-only
    evaluations fabricate holds; holds are never pruned.**
    `Evaluate_prospective_purchase/handler.js:77-79` takes the first live
    `held` piece in insertion order. With two evaluations in 24 h, "I bought
    it" activates the older one. A text-only "should I get this?" (no image)
    still `addPiece`s a held item, defaulting to "dress"
    (`:28-40, 100-113`). Expired holds stay in the catalog forever (only
    hidden). Fix: pick the most recent live hold, require an image for a new
    hold, prune expired holds on save. *low*

17. **Only pieces persist. Turns, sent turns, pending questions and the
    reply-window anchor are memory-only.** `wardrobe-catalog.js:713-716`
    PUTs `getPieces()` only. A service restart between What_suits' consent
    prompt and the photo loses the M24 expectation (the 24 h TTL suggests
    restarts were in mind). Resolved questions also accumulate in
    `pendingQuestions` indefinitely. Fix: persist a small `meta` document
    alongside pieces, or document the restart behaviour. *low*

18. **Schema validators check keys, not values.** `ATTRIBUTE_KEYS` and
    `COPY_PREVIEW_KEYS` (`wardrobe-catalog.js:90-91, 451, 461, 361, 369`)
    reject unknown keys but accept any value type and size for `color`,
    `silhouette`, `layer_role`, `copy` and `preview`, on both `addPiece` and
    the stored-load path. Today every caller passes `attributes:{}`, so this
    isn't exploitable. But the first Spark-filled attribute would flow
    unbounded into prompts and the 1 MB catalog PUT. Fix: require short
    strings (or null). *low*

19. **`handleTurn` dereferences `result.image` without the null guard used
    one line earlier.** `agentic-loop.js:178` guards `result &&`, but `:193`
    reads `result.image`. A handler resolving `undefined` throws a TypeError
    and becomes a generic retry. *nitpick*

20. **README process count is stale.** `README.md:31-35` says `start.sh`
    starts three processes. It also starts `wardrobe-service` on `:8906`
    (`start.sh:262-264`), which is the judged backend. This overlaps the
    roadmap's open M16 item ("README architecture should mention the M21
    router"). *nitpick*

---

## Test-coverage gaps (untested behaviour, not file-size comparisons)

Each of these would have caught a finding above:

- No service-level test that `revise_look`/`Match_look`/`Complete_the_look`
  previews arrive at the bot with `image:true` (finding 1). The M22 tests are
  handler-only.
- No test that a failed send keeps the inbound media and retries to exactly
  one successful send (finding 3).
- No test of a photo share whose media fetch fails in the agentic path
  (finding 4).
- No test of "load fails → no destructive save" (finding 5).
- No end-to-end propose → explain_fit test through the service (finding 6).
  The M23 tests inject `lastTurns` objects that production never builds.
- No test that `revise_look` keeps the user's other pieces of that category
  available for later looks (finding 7).
- No summariser test beyond a single turn. A 10-turn test would show the
  freeze (finding 10).
- No `assembleLook` test for layer + lone scarf/bag (finding 11).

---

## Areas in genuinely good shape

- **The DM page escapes output.** `app/mock-dm.html` uses `textContent`
  or `esc()` for every bot- or user-supplied string I traced. I found no
  `new RegExp` built from user input anywhere in the app or the service.
- **Proxy input validation for the newer routes is fine.**
  `/api/segment`, `/api/palette`, `/api/preview` and `/api/route` all
  type-check, require `data:image/` where relevant, slice text inputs, sit
  behind the 12 MB `MAX_BODY` cap, and enforce the CORS origin allow-list.
  Malformed upstream JSON degrades to a 502 that every caller turns into a
  labelled fallback.
- **`propose_look`'s Spark → strictShape → assembler → deterministic
  fallback chain is solid.** Its `imageDelivery` truth-telling is the model
  the other skills should copy (finding 1 is about them not copying it).
- **The send-idempotency design in `wardrobe-service`** (stable per-share
  key, 409 handling, cursor-advances-only-when-all-terminal) is careful and
  well-commented. Findings 3 and 5 sit at its edges, not in its core.
- **Secrets hygiene in the code I read is clean.** The key is only read
  from `process.env.MODEL_API_KEY` and never logged
  (`meta-api-proxy/server.js:164, 481` prints only a boolean).

## Suggested order if time is short

1 → 2 → 3 → 4 → 6 → 7 → 5 → 8. Findings 1, 3, 4 and 6 are small, contained
changes. Finding 2 is mostly a demo-script and reply-copy pass once 6 and 7
are in. Finding 8 needs Autumn's decision rather than code.
