---
name: wardrobe-skill-integration
description: "Use when adding or wiring a new M21-style agentic wardrobe skill (app/skills/*)."
version: 1.0.0
author: Bramble
license: MIT
metadata:
  hermes:
    tags: [meta-styles, agentic-loop, router, skills, pending-expectation]
    related_skills: [meta-hackathon-compliance, muse-code]
---

# Wardrobe skill integration pattern

How a new bounded skill plugs into meta-styles' router + agentic loop
(`app/router.js`, `app/agentic-loop.js`, `wardrobe-service/server.js`),
distilled from the M21 skill set and the M24 pending-expectation fix
(commits `df127eb`, `5cbcc1e`). This is a documentation/architecture note
(Bramble-authored, `docs/`-equivalent) — the actual skill code it
describes is implemented by Muse Code per
`skills/meta-hackathon-compliance/SKILL.md`, not by hand-editing.

## Anatomy of a skill

Each skill lives at `app/skills/<Skill_Name>/`:

- `handler.js` — `exports.handle(opts)` (or `root.MetaStyles.skills.<Name>`
  for browser parity). Receives `catalog`, `lastTurns`, `wardrobeSummary`,
  `preferences`, `message`, `imageDataUrl` from `agentic-loop.js`. Returns
  `{ text, image?, imageDelivery?, persist?: { summaryDelta, preferencesDelta, pendingExpectation } }`.
- `prompt.md` — the Spark system-prompt fragment describing when the live
  router should pick this skill (trigger description, example phrasing).
- Registered in `SKILL_NAMES` in `meta-api-proxy/server.js`'s `/api/route`
  (live Spark routing) AND in `app/router.js`'s `heuristicSkill()` (offline/
  mock fallback routing) — both paths must know the skill or it is
  unreachable in one of the two modes.

## Two routing paths, kept in parity

1. **Live:** `meta-api-proxy/server.js` `/api/route` — a Spark prompt
   classifies the turn by skill name, using `lastTurns` as context.
2. **Heuristic/offline fallback:** `app/router.js`'s `heuristicSkill()` —
   regex/keyword rules, same skill set, used when the live API is down or
   in mock/offline mode.

Any change to routing logic (a new trigger, a new pending-expectation
case) must be made in **both** places or the two modes diverge — this is
exactly how the M24 bug happened (`catalogue_piece`'s heuristic trigger
said "image present, no other trigger" and the live prompt had the
identical gap; neither checked `lastTurns` for a pending question).

## Honesty structs: never claim a delivery that didn't happen

If a skill can send an image, it must use the same shape `propose_look`
established (commit `29518df`):

```js
imageDelivery: { requested: true, generated: <bool>, delivered: <bool>, reason: <string|null> }
```

Never construct a fake `image: { url: "https://example.invalid/..." }`
placeholder and claim it shipped — `revise_look` and `Match_look` did this
until M22 item 1 fixed it. If no real image call is warranted, say so in
the reply text instead of silently implying one happened.

## Pending-expectation mechanism (M24) — use this, don't reinvent

When a skill's reply ends in a follow-up question ("which piece?", "want
me to put a look together?", "say 'I bought it'"), the user's one-word
reply to it must not be left to the router to guess cold — the router
classifies every turn fresh with no notion of "we're mid-flow." Instead:

1. In the skill's `handle()`, when asking the follow-up, call
   `catalog.askQuestion({ text, skill, expects })` where `skill` is the
   name of the skill that should receive the next turn if satisfied, and
   `expects` is one of the fail-closed `EXPECTS_VALUES` in
   `app/wardrobe-catalog.js` (currently `"image"`, `"text"`, `"yes_no"` —
   extend this array, never bypass it, if a new kind is genuinely needed).
2. `app/agentic-loop.js`'s `handleTurn()` checks unresolved pending
   questions **before** calling the router. If the new turn satisfies the
   expectation (`hasImage` for `"image"`; any non-empty `message` for
   `"text"`; `isAffirmativeReply(message)` for `"yes_no"` — a deliberately
   narrow whole-reply word list, see the comment above it in
   `agentic-loop.js`), it routes straight back to the named skill at
   confidence 96, skipping the router entirely, then resolves/clears the
   pending question.
3. An unsatisfied, declined, or expired (24h default TTL,
   `PENDING_EXPECTATION_TTL_MS`) pending question clears itself and falls
   through to normal routing — never leaves the conversation stuck
   waiting forever.

**For `"yes_no"` specifically: match conservatively.** A false-positive
"yes" can have a real side effect (e.g. confirming a purchase activates a
held piece into the wardrobe — `Evaluate_prospective_purchase`). Use the
shared `isAffirmativeReply()` / `YES_NO_AFFIRMATIVE` whole-reply list
exported from `agentic-loop.js` rather than a loose substring match, and
write a test proving a hedged reply ("maybe", "I'll think about it")
does **not** satisfy the expectation.

## Testing checklist for a new/extended skill

Mirror `app/test/pending-expectation-routing.test.js`'s structure:

- Satisfying reply routes to the correct target skill.
- Declining/unrelated reply falls through to normal routing untouched
  (does not get stuck waiting).
- Expiry: a pending question past its TTL is cleared and does not hijack
  a later unrelated message.
- Fail-closed: an unknown `expects` value throws rather than silently
  matching.
- If the skill sends images: both the delivered and the honest-fallback
  path (staging/send failure) are covered, matching `propose_look`'s own
  test coverage.
- Full suite stays green: `node --test app/test/*.test.js wardrobe-service/test/*.test.js`.

## Compliance reminders specific to this pattern

- Implementation (handler.js, router.js, agentic-loop.js changes) is
  delegated to Muse Code, never hand-edited — see
  `skills/meta-hackathon-compliance/SKILL.md`.
- No real network calls in tests; mock `metaClient`.
- Commit author: `muse-code <muse-code@noreply.invalid>` for any commit
  touching `app/`, `meta-api-proxy/`, or `wardrobe-service/`.
