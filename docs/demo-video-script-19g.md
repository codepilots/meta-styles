# Demo video script — Milestone 19g (chat-first pivot, two-photo arc)

Status: **script for the 3-minute judged demo video** (Milestone 19, §8 Q8
two-photo arc, resolved Autumn 2026-10-29). Nothing here changes app code.
All demo content is synthetic: locally made images (`app/demo-look-*.svg`,
`app/inbox-fixtures/`), `SYNTH_`-prefixed ids, `example.invalid` URLs.
No real Instagram photo, account/media id, or DM text appears anywhere in
the demo. Sends shown are mock-only (`mock-ig-bot/server.js`); live Meta
Model API calls run through `meta-api-proxy/` with labelled stub/cached
fallbacks when the key is absent or the network is down.

Spoken budget: **≈390 words ≈ 3 minutes at ~130 wpm.** The montage
(beat 1) is OPTIONAL — record it last and cut it first if the take runs
long; the two-photo arc (beats 2–4) is the judged payoff and must survive
any cut.

Product framing (avoid-list discipline, every beat): the product is the
persistent per-user wardrobe/catalog plus propose → validate → revise
reasoning on top of it — full-look assembly, fit rules, styling /
purchase-suggestion copy. Chat is the delivery surface, never the pitch.
Never lead with the raw classify-a-photo step in isolation, and never
with "the bot remembers what you told it."

## Beat 0 — hook (0:00–0:15, ~30 words, screen: chat thread, empty)

> "meta-styles builds your wardrobe for you, one photo at a time — then
> styles full looks from it, checked against real fit rules. Watch: two
> photos in, one validated look out."

## Beat 1 — OPTIONAL montage (0:15–0:35, ~40 words, screen: quick cuts)

Record only if the 3-minute budget allows; cut first.

> "Earlier: each share gets catalogued — category, visible details, which
> photo it came from. Rejections stay on record too: say no bag, the bag
> is flagged, never silently re-paired."

## Beat 2 — photo 1 → look/suggestion (0:35–1:25, ~110 words)

On screen: operator shares photo 1 (a dress — locally made demo image)
via the chat page; it lands as an inbound bubble.

> "Photo one: a slip dress. The app catalogues it as the first wardrobe
> piece and answers in-thread: here's the dress, and the fit-rule check
> is honest — a base alone isn't a full look yet. It needs exactly one
> finish: a layer, or a scarf plus a bag. So the turn ends with a real
> suggestion, not a dead end: share a layer next, and I'll style the
> complete look."

What the judge sees: inbound photo bubble → outgoing bubble leading with
what was catalogued, the proposal, and the validator's `reasons[]`
("needs one finish") — the propose → validate turn of the agentic loop.

## Beat 3 — photo 2 → cross-piece mix citing BOTH (1:25–2:25, ~130 words)

On screen: operator shares photo 2 (a cardigan); the reply bubble cites
pieces from both shares.

> "Photo two: a cardigan. Now the recall beat — the app doesn't just
> style the new photo. It reaches back across the wardrobe and proposes
> one look combining the dress from photo one with the cardigan from
> photo two — both sources cited in the thread. The fit-rule engine
> re-validates: base plus exactly one layer. Valid full look, check mark.
> That cross-photo mix is the whole demo: the wardrobe persists, the
> reasoning compounds, every proposal passes the same unchanged rules."

What the judge sees: the reply names both piece ids and both source
shares (`turn-loop.js` `proposeLooks` ranks valid cards first, then
widest cross-share span — deterministic, no invented data).

## Beat 4 — ends on one purchase suggestion (2:25–3:00, ~80 words)

On screen: final outgoing bubble; thread holds the full arc.

> "And it ends where a stylist would: one next buy. A bag — so the scarf
> look waiting in the wardrobe completes next. Category-level, no
> invented listing: asked about fabric, price, or vendor, the agent says
> plainly it doesn't have that data. Wardrobe in, validated look out,
> one honest suggestion. That's meta-styles."

Honesty rule for this beat: the purchase suggestion is a FIT-RULE-SHAPED
category step ("a bag completes the scarf pair"), never a vendor, price,
fabric, or listing. Fabric/price/vendor grounding is fully descoped
(§8 Q4) — inventing a listing on camera would be a compliance failure.

## Production notes (not spoken)

- Run path: one command from the repo root, `sh start.sh` (proxy :8905 +
  mock bot :8904 + static server :8000), then open
  `http://localhost:8000/mock-dm.html`. Record on this machine; the mock
  bot and fixtures are local-only by design.
- Meta-model honesty on camera: with a key in `MODEL_API_KEY` (or
  `.env/secrets` `meta-api-key=`), copy/classify/segment/preview calls go
  live through the proxy (Muse Spark 1.3, SAM 3.1, Muse Image 1.0); without
  it the same turns run on explicitly labelled stub/cached fallbacks
  (`placeholder:true` / `cached:true`). Never narrate a fallback turn as
  a live model turn.
- `app/index.html` stays out of frame: it is an unlinked dev/debug tool
  (§8 Q1), not the judged surface. The judged surface is the chat thread.
- Take as many turns as needed; the script's turn texts are illustrative
  of the real reply shape (catalogued-line + Look-line + fit-check line),
  not verbatim strings — quote the actual bubbles the build renders.

## M10-conflict resolution (recorded here per §7 task 7 — §8 Q7)

Milestone 10 parked a bot chat-script API as post-hackathon work for two
stated reasons: it would spend critical-path time on an undifferentiated
guided-chat surface, and it drifted toward the avoid-list's
generic-chatbot shape if framed carelessly. This pivot un-parks a chat
surface anyway — resolved, not ignored, as follows: the M19 chat is NOT
the parked guided-chat surface. It is one interface onto the persistent
wardrobe catalog, and every turn leads with the wardrobe payoff (what was
catalogued, what look the catalog produced, what the validator said, what
to buy next) plus the visible propose → validate → revise loop — which is
exactly the framing the parking rationale said would keep chat off the
avoid-list. The time risk the parking was also guarding is handled by
Autumn's §8 Q7 call: M19 itself absorbs any overrun (ships thinner, or
falls back to the `index.html` panel flow as the demoed surface with chat
as a secondary beat) — M18, M16, and M4 do not give way for it.

## M16/M18 flow updates for the chat surface (proposed — roadmap not edited here)

Per the task, `docs/roadmap.md` / `docs/decisions.md` are Bramble/Autumn's
files and are NOT edited by this milestone; the lines below are proposed
wording for her to land:

- M16 judge path: "delivered as a local one-shot install+run (`sh
  start.sh`: proxy + mock bot + static server; judge supplies only their
  own Meta API key) — not a hosted URL (§8 Q3). Judged surface is the
  `mock-dm.html` chat thread, not the `index.html` panels."
- M18 isolation walk: "re-run against the chat flow (mock bot + static
  server + proxy; Meta Model API calls stay live network dependencies
  with labelled stub/cached fallbacks — explicitly not isolated away)."
