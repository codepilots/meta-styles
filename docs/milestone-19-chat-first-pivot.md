# Milestone 19 — chat-first pivot plan (wardrobe-first, chat as interface)

Status: **PROPOSED 2026-10-29 (Bramble spec; nothing built)** — revised
in place 2026-10-29 per Autumn's answers to all 8 open questions in §8.
Per `docs/roadmap.md` convention, nothing is called done on the strength
of a plan doc alone. This doc is planning only: it creates no code under
`app/`, `mock-ig-bot/`, or `meta-api-proxy/`. Build is delegated to
Muse Code only after this revision lands (the §8 answers it was waiting
on are now recorded; the one NEW open question in §8.9 is flagged, not
blocking the plan itself).

**Product thesis (Autumn, 2026-10-29 — applies to every section below):
"the product is the wardrobe, not the chat."** Chat (via the Instagram
DM bot) is ONE interface onto a persistent per-user wardrobe/catalog the
agent builds and maintains over time. The catalog plus the
styling/mix-match/purchase-suggestion logic on top of it is the real IP
and the real "agentic" work (cataloguing what is extracted from photos,
scripting the propose/validate/revise reasoning, persisting and
recalling it) — not the chat UI mechanics. Every milestone description
below therefore leads with the wardrobe/styling/purchase-suggestion
payoff of each turn, never with "the bot remembers what you told it."
The chat/IG surface is the hackathon's chosen demo interface, not the
product boundary: the same catalog could sit behind a retailer's website
widget or any other interface, and no milestone design below may couple
the catalog schema to Instagram-specific fields it does not need.

**New-work boundary:** everything this milestone proposes — the
conversation loop, the user-keyed catalog module, any new send-client
module, any chat-shell changes — is genuinely new hackathon work to be
built inside the building period (Oct 27 – Nov 4, 2026). It never touches
real Instagram, Meta's Graph API, the SecondBloom `igwebhook` deployment,
or prior-work code or data (see `docs/prior-work-instagram.md`). Demo/test
content stays synthetic (`SYNTH_` ids, locally made images, never real
DM captures). Unlike Milestones 5–9/12, which carry a prior-work
boundary, the chat harness side of this milestone is 100% synthetic and
offline — except the Meta Model API calls (M14), which stay live network
dependencies and are explicitly not mocked here.

**Contract sources (read in full before building):**
`app/inbox-bridge.js` (bot read-client: `BOT_BASE` line 50,
`isValidShareItem` lines 90–111, `buildSharesUrl` lines 131–137,
`fetchSharesPage`/`fetchAllShares` lines 212–277,
`fetchMediaObjectURL`/`acknowledgeMedia` lines 386–419, fixture
fallback lines 279–306), `mock-ig-bot/server.js` (mock contract:
`createStore` lines 37–48, `publicShare` lines 83–91, `doSend` lines
156–220, paging lines 66–81, operator routes lines 335–425),
`app/assembler.js` (`assembleLook` → `{valid, finish, baseIds,
reasons, notes, pieces, fitNote, wordCount, trimmed, placeholder}`
lines 40–126), `app/spark.js` (`generateCopy`/`generateCopyFromModel`
→ `{title, perPiece, lookStory, …}` lines 104–164; M14d agentic
framing), `app/preview.js` (`generateImage(canvas, lookCard)` lines
66–201, `buildPreviewPrompt` lines 205–211), `app/meta-client.js`
(proxy client: `PROXY_BASE` line 16, `copy`/`assemble`/`preview`
lines 90–120), `app/mock-dm.html` (chat shell: incoming/outgoing merge
in `refreshThread` lines 231–265, `sendAsApp` lines 332–392, 5s
`autoPoll` lines 431–442), `docs/instagram-bot-api.md` ("As
implemented": sender IGSID / account id / message text **omitted for
privacy**, line 123),
`docs/instagram-bot-send-api.md` (privacy-preserving `share_id` →
recipient resolution; `recipient_ref` echoes `share_id`, never a raw
IGSID), `app/index.html` (panel UI to be retired: §§19–99, share card
§§101–130).

## 1. What's kept vs retired

**Kept as-is, unchanged (logic, not UI):** `app/assembler.js`
(`assembleLook` fit-rule validator — base+exactly-one-finish,
two-layer/shoe rejection, ≤300-word cap) is the turn validator;
`app/classifier.js` (`classifyRegion`/`classifyFromSpark`, fixed
taxonomy, tie-blouse/shrug = layer rule) + `app/spark.js`
(`generateCopy`/`generateCopyFromModel`) + `app/preview.js`
(`generateImage`/`buildPreviewPrompt`) + `app/meta-client.js` (proxy
calls with labelled stub/cached fallbacks) are the Meta-model layer
behind `meta-api-proxy/` (127.0.0.1:8905); `app/inbox-bridge.js`'s
read path (fixtures fallback + live bot) stays the photo-ingest
contract.

**Kept and extended (the new primary surface):**
`app/mock-dm.html`'s chat shell — thread rendering
(`renderIncoming`/`renderOutgoing`), bubble CSS, share-photo and
send-as-app operator flows — is the base to extend, not rebuilt from
scratch. The judged surface becomes this thread, not `index.html`.
The thread is the delivery vehicle; the judged substance is the
wardrobe catalog it reads/writes plus the fit-rule-validated
styling turns on top.

**Retired as the primary demoed surface:** `app/index.html`'s panel UI
(pick-photo → segment → manual box → tag region → wardrobe →
assemble → look card → share card, lines 19–130) stops being the demo
path. ~~Whether it is deleted or kept as a dev/debug tool is open
question §8.1 — the plan assumes it stays in-repo but unlinked from
the demo until Autumn decides; no deletion happens on assumption.~~
**Resolved (Autumn, 2026-10-29): `app/index.html` stays in-repo as an
unlinked dev/debug tool** (manual segment/tag/assemble without chat).
Not deleted, not part of the judged demo; no video-script beat may
depend on it.

What "retired" concretely means for build: the pipeline entry points
that `index.html`'s buttons call (`loadImage`, segment, tag, assemble,
share-card render in `app/app.js`) are reused headlessly by the
conversation loop — the buttons/panels go, the functions stay.

## 2. Turn-taking design

Two triggers, both arriving through the bot API the way M13's mock
chat already does:

- **Photo-share trigger.** A photo arrives as an inbound share
  (`POST /mock/incoming-photo` on the mock; webhook-originated
  `GET /ig/shares` item live) and is ingested exactly as today
  (`GET /ig/media/<id>` → bytes → `loadImage`-equivalent, then
  DELETE-after-use ack). The assistant's reply turn is: one
  clarifying question OR one proposed look, never a panel update.
  **Catalog angle (new):** a photo-share turn now also means
  "extract garment(s), add to this user's catalog" — the turn proposes
  a look AND records the extracted piece(s) in the per-user wardrobe
  (§3), citing the source share.
- **Text-message trigger.** Free-text user turns ("no bag", "show
  fabric", "cheaper option?") arrive as inbound text and each one
  opens exactly one assistant turn: revise, re-validate, or answer
  from this user's accumulated wardrobe/conversation (§3).

**Assistant reply shape:** text + optional image bubble. The look card
(the assembled card + Spark copy + Muse Image preview currently
rendered in `#lookCard`/`#shareCard`) becomes a chat bubble — text
part first (title + fit note + per-piece lines within the shared
≤300-word budget), image part attached the way `sendAsApp` already
stages share-card images (`/mock/stage-outbound-image/<share_id>` +
`POST /ig/send {"image": true}`). No separate page section; the
thread is the product surface. **Every reply leads with the
wardrobe/styling/purchase-suggestion payoff** (what was catalogued,
what look is proposed from the catalog, what the fit validator said,
what to buy) — never with the raw classify-a-photo step in isolation.

**The M14d agentic loop mapped onto turns** (this is the "Best
Agentic Use-Case" angle — kept explicit in every milestone
description, not a single-shot Q&A):

1. `propose` — Spark proposes 1–2 complete looks from **this user's
   catalogued pieces** (existing `meta-client.copy`/`assemble`
   shapes). The catalogued pool includes previously extracted pieces
   from earlier shares, not only the piece just shared — that recall
   is the agentic beat the video must show (see §8.8 two-photo arc).
2. `validate(assembleLook)` — every proposal passes through the
   unchanged fit-rule engine; `valid:false` cards surface their
   `reasons[]` honestly in chat ("the scarf needs its bag partner —
   want me to add one or switch to a layer?"), never silently
   re-paired.
3. `revise-or-flag` — the user's next text turn selects the branch:
   accept, drop a piece ("no bag" → re-propose with the bag removed
   and re-validated), or ask a grounding question ("show fabric" →
   answered plainly as "I don't have that data" per §8.4 — the agent
   never invents a listing).

Rejections and revisions are first-class turns, not error states —
that visible propose → validate → revise loop over a persistent
wardrobe is what makes the demo agentic reasoning rather than
form-filling, and it is also what keeps the demo off the avoid-list
(see §5).

## 3. Where conversation state lives: a user-keyed wardrobe catalog

REVISED 2026-10-29 per §8.5: **one user keeps one evolving
wardrobe/conversation across many shared photos over time — NOT
one-thread-per-share-id.** The original share_id-keyed design below is
superseded; it is kept visible (struck) so the rejected option stays on
record.

~~So a **new state module owns "what have we discussed in this thread"**
(proposed looks + their `assembleLook` verdicts, accepted/rejected
pieces, pending clarifying questions, per-piece copy/preview cache
keys). It reads the bot API through the existing contracts and writes
nothing back to the bot except via `POST /ig/send`. It does not fork
`inbox-bridge.js`'s read path — photo ingest stays on the proven
`GET /ig/shares` → `GET /ig/media` → DELETE-ack walk. Concretely the
state module keys each conversation off the originating `share_id`
(see §8.5 for the one-share-one-thread assumption to confirm) and
accumulates turn records `{turn, userText, proposal, verdict,
reasons[]}` that the next turn's prompt is built from.~~
**Superseded by the user-keyed design below.**

Per the compliance skill's rule (check existing wiring before
assigning a milestone), the existing thread model was traced first —
and it is **not enough**, for grepped reasons:

- `app/inbox-bridge.js` keeps only `lastGood[]` (last rendered
  entries), `lastSource`, and `cursor` (the opaque `next_cursor`
  string, lines 62–66). There is no per-thread history, no record of
  what was proposed/accepted/rejected, and no memory of user
  preferences across turns. The fetch walk (`fetchAllShares`, lines
  248–277) re-reads shares; it never records conversation.
- `mock-ig-bot/server.js` `createStore` (lines 37–48) holds a flat
  `shares[]` list plus an `outbound[]` log — no thread ids, no
  linkage between a user text turn and the share it replies to.
- The only incoming+outgoing merge is display-only inside
  `app/mock-dm.html`'s `refreshThread` (lines 231–265): it sorts both
  lists by timestamp for rendering and keeps nothing.

So a **new catalog module owns "this user's wardrobe + what we have
discussed with them"** (catalogued pieces, proposed looks + their
`assembleLook` verdicts, accepted/rejected pieces, pending clarifying
questions, per-piece copy/preview cache keys). It reads the bot API
through the existing contracts and writes nothing back to the bot
except via `POST /ig/send`. It does not fork `inbox-bridge.js`'s read
path — photo ingest stays on the proven `GET /ig/shares` →
`GET /ig/media` → DELETE-ack walk. Concretely the catalog module keys
each wardrobe off a **stable per-user key** and accumulates two record
kinds: piece records (below) and turn records `{turn, userText,
proposal, verdict, reasons[]}` that the next turn's prompt is built
from. Multi-share is the point: a turn in share N's aftermath may draw
on pieces catalogued from shares 1..N-1.

**What a catalogued piece record holds** (interface-agnostic — see the
framing rule below; no fabric/price/vendor fields, descoped per §8.4):

- `piece_id` (app-assigned, e.g. `SYNTH_piece_001`),
- `category` (the fixed classifier taxonomy term),
- `attributes` (what the photo actually showed: color/silhouette/
  layer role — visible evidence only, never inferred fabric),
- `source_share_id` (provenance pointer to the share it was
  extracted from — app-local linkage, not product data),
- `added_at` (ISO timestamp of the cataloguing turn),
- `copy_preview_keys` (cache keys for generated copy/preview, so
  repeats do not re-call the proxy),
- `status` (`active` / `rejected` / `superseded` — rejections update
  flags, never delete history).

**Interface-agnostic infrastructure (hard framing rule):** the catalog
module is described and built as "a user's wardrobe model that this
submission happens to expose through an Instagram DM chat interface
first" — NOT as "the Instagram chat's memory." The piece schema above
carries no Instagram-specific fields (no IGSID, no mid semantics, no
Graph shapes — `source_share_id` is an opaque provenance string only),
so the same catalog could sit behind a retailer's website widget or any
other interface without schema changes. Any milestone design that
couples the catalog schema to IG fields it does not need is out of
scope by definition.

**The per-user identifier finding (grepped, not assumed): no stable
per-sender identifier exists anywhere in the contract today.** Checked
both code paths: `mock-ig-bot/server.js` `createStore` (lines 37–48)
stores `{id, received_at, attachment, media_id, media_available}` with
no sender/user field; `publicShare` (lines 83–91) exposes exactly those
fields and nothing more; the send result's `recipient_ref` (line 197)
echoes `share_id`, it is share-anchored, not user-anchored. The live
contract agrees deliberately: `docs/instagram-bot-api.md` line 123 —
"**Omitted for privacy:** sender IGSID, account id, message text."
Solving the text-message gap (§4 Gap 1) does NOT produce this
identifier (see §4) — they are independent gaps. Until a bot-side
opaque user ref exists, the build proceeds on the documented
single-user assumption (one demo user; all inbound shares belong to
one wardrobe), and the catalog module takes the user key as an injected
parameter so a future opaque ref slots in without rework. The missing
identifier is recorded as NEW open question §8.9 — flagged, not
invented.

**M11 bot-side storage contract — short sketch only (not a build).**
For a future milestone to implement, the bot-managed DB needs to expose
per-user catalog persistence, loosely coupled from the app: sketch
shape only — `store(user_ref, pieces[])` / `retrieve(user_ref) →
{pieces[]}` over opaque refs, with the bot resolving the ref to the
real recipient server-side (the same privacy pattern the send API
already uses: client references an opaque id, bot resolves the IGSID
internally — `docs/instagram-bot-send-api.md`). The piece payload is
the interface-agnostic schema above, never IG shapes. No M19 task
implements this; 19c only leaves the seam (the injected user key + the
piece schema) that a future milestone would persist.

## 4. Bot-API fit — does free-text back-and-forth fit today?

Mostly, with four named gaps. Compared route-by-route against the
grepped contract:

| Contract piece (grepped) | Chat use | Fit? |
|---|---|---|
| `GET /ig/shares?since=&limit=` (bridge lines 205–244; mock lines 267–281; cursor = decimal offset, `limit` 1–50) | Poll for new user turns (photo + text) for this user's wardrobe | Yes, unchanged |
| `GET /ig/media/<id>` + `DELETE /ig/media/<id>` → `media_available:false` (bridge lines 386–419; mock lines 426–445) | One-shot photo ingest, then ack | Yes, unchanged — but re-reads across turns must reuse the cached bytes/`_objectURL` (bridge line 526), never re-GET after ack (now 404 by design) |
| `POST /ig/send {share_id, text, idempotency_key, confirm:true}` + `image` flag, 24h window, idempotency trio (`duplicate_send`, `idempotency_key_reused`, replay), `422 reply_window_expired` (mock `doSend` lines 156–220) | One send per assistant turn, keyed per turn | Yes, with per-turn fresh `idempotency_key`s (mock-dm.html send panel + `lastKey` pattern, line 128); re-sends with a new key and same text hit `409 duplicate_send` by design, so retries must be replays, not rewrites |
| `is_echo` skip (roadmap M7 note) | Agent must ignore its own sends when polling | Carried over: whichever send client ships applies the skip |
| `GET /ig/outbound-media/<token>` single-use, 24h TTL, bare-404 refusals (mock lines 282–300) | Look-card image bubble fetch | Yes, unchanged; note the mock preview (`outboundPreview` in mock-dm.html line 126) is browser-local only and never crosses the contract |

**Gap 1 (hard blocker for text turns): `isValidShareItem` rejects
text attachments.** `POST /mock/incoming-text` mints
`attachment: {type: "text", …}` (mock lines 347–356), but the
client's shape check (bridge lines 90–111) accepts only `ig_post` and
`image` — a text turn filtered through `inbox-bridge.js` is silently
dropped. Free-text back-and-forth therefore does **not** fit the
existing receive contract as-is: either the bot API gains a text
message type the client accepts, or the conversation loop reads text
turns through a path that does not apply the photo-share filter. This
is a server-contract decision (mock + real bot in lockstep), not a
client fork — the "same code path" claim from M13 must survive it.
**Independence note (new, grepped): resolving Gap 1 does NOT yield
the per-user identifier §3/§8.9 needs.** Both code paths were checked:
the text-item shape minted at mock lines 347–353 carries
`{id, received_at, attachment, media_id: null, media_available: false}`
— no sender/user field — and the live contract omits sender IGSID by
privacy design (`docs/instagram-bot-api.md` line 123). A text-message
type and a per-user key are two independent gaps; do not assume one
fix delivers the other.

**Gap 2 (no send path in the judged client):** `inbox-bridge.js` can
only read (shares/media) + DELETE-ack; the only `POST /ig/send`
caller is `mock-dm.html`'s operator panel (lines 332–392), which is
explicitly demo chrome ("send as app (operator)"), not a module. The
agent needs a real send-client module in `app/` (M12-client-shaped:
`confirm:true`, per-turn idempotency keys, `401`/`409`/`422`
surfacing) — this is new code, sized in §7. Sends stay **mock-only
for this submission** per §8.2; the compliance skill's stricter
send-gate still applies unchanged if real-DM sends ever become a
stretch goal (explicit go-ahead before even drafting a send spec,
window/rate-limit/consent risks as open questions).

**Gap 3 (polling cadence — DESIGNED NOW, no longer an open question,
per §8.6):** the driver is **automatic polling** (option (a)). The app
polls the bot continuously; webhook-based push is a future tightening,
not required for this submission. Designed cadence: poll
`GET /ig/shares` every **5s while the conversation is active** (reuse
the proven `autoPoll` 5s rhythm, mock-dm.html lines 431–442); after
**10 minutes** with no new inbound items and no pending assistant
turn, back off to **30s**; after **30 minutes** idle or when
`document.hidden`, **stop polling entirely**; resume on next
visibility/focus or on any operator/user action. The 24h reply window
(`WINDOW_MS`, mock line 95) is now measured against **this user's
latest inbound `received_at`** (user-keyed, not per-`share_id` —
§3's rework changes the anchor); each turn checks the window before
sending and says so honestly on `422`.

**Gap 4 (thread assembly is display-only, now user-scoped):** merging
inbound shares with the `outbound` log into one chronological thread
exists only in `mock-dm.html`'s `refreshThread`, fed by the
operator-only `GET /mock/outbound` (mock line 407–410, never part of
the replicated contract). The catalog module (§3) needs that merge as
a real data function **scoped to this user's wardrobe** (all inbound
items + own sent turns, ordered by time); the live side has no
outbound-log route at all, so the agent records its own sent turns
locally.

## 5. Compliance framing (avoid-list discipline)

REVISED 2026-10-29 per the product-framing correction and §8.4: the
old "resale-grounded copy" anchor language is superseded — fabric,
price, and vendor details are FULLY DESCOPED for this submission (no
M15/M15-lite synthetic inventory build; see §8.4). The anti-avoid-list
anchor is now **wardrobe/styling/purchase-suggestion**, stated
explicitly so no reader has to infer it:

- Lead with the **wardrobe-and-styling engine** (catalog → propose →
  validate against fit rules → purchase suggestion), surfaced
  conversationally — never with the raw classify-a-photo mechanic in
  isolation, and never with "the bot remembers what you told it"
  framing. The chat is the delivery surface; the judged substance is
  still full-look assembly + fit rules + styling/purchase-suggestion
  copy. **Say this explicitly: because the product is a persistent
  wardrobe model with propose/validate/revise reasoning on top, this
  is NOT the avoid-list's "generic chatbot" shape** (compliance skill
  §§Avoid-list, AGENTS.md rule 4) — every milestone description and
  the video script must keep leading with the wardrobe payoff of each
  turn (what was catalogued, what look the catalog produced, what the
  validator said, what to buy next).
- Fabric/price questions ("show fabric", "cheaper option?") are
  answered plainly — **the agent says it does not have that data
  rather than inventing a listing**. No inventory record fields exist
  (no M15 build), and the §3 piece schema deliberately carries no
  fabric/price/vendor fields, so there is nothing to "look up." An
  invented listing presented as real would be a compliance failure;
  flagging unknown is the designed behavior. A real
  boutique-sourcing database integration is a SEPARATE future stretch
  goal, explicitly out of scope for build here — see "future work"
  below. It is blocked on: (a) hosting — the DB would need to be
  reachable, which collides with the local-install judge path (§8.3);
  that tension is noted here and NOT resolved; (b) a PII-scrub pass on
  any photos pulled from that source before they could ever appear in
  this repo or demo.
- The M14d agentic loop (propose → validate against fit rules →
  revise-or-flag) stays the simultaneous "Best Agentic Use-Case"
  bonus-prize angle (compliance skill: fits "the fit-rule assembler +
  Spark copy generator pipeline if framed as agentic reasoning").
- Anything that sends to a real person (live-DM agent replies, not
  mock sends) needs Autumn's explicit go-ahead **before a send
  contract spec is even drafted**, with messaging-window/rate-limit/
  consent risks as explicit open questions, per the compliance
  skill's stricter send-gate standing rule — recorded as resolved
  §8.2 (mock-only for this submission), and the M17 decision (whether
  to close the `IG_GRAPH_SEND_TOKEN` placeholder that makes real
  sends `502` today) stays the gate. Real Instagram DM integration is
  a stretch goal, not required.

**Future direction, not in scope:** the same wardrobe model (knowing a
user's sizes/pieces) could, in a later version, help match a seller's
listed item to a buyer's known size/fit profile (a resale-matching use
case). This is an explored-later idea ONLY — not a sub-milestone, not
something the M19 build touches, no schema work for it here.

## 6. Risk/cost — 6 days to deadline (Nov 4, 9 PM ET, no grace period)

REVISED 2026-10-29: scope GREW relative to the original single-share
design this table was sized against. Be honest about that: the
multi-share persistent catalog (§3 rewrite), the M11 bot-side storage
contract sketch, and the two-photo video arc's cross-piece mix-match
requirement (§8.8) are more work than the per-`share_id` thread the
original sizes assumed. The table below re-sizes upward accordingly.

**Reusable as-is:** `assembleLook` validator; Spark
classify/copy/assemble + Image preview via proxy (`meta-client.js`)
with labelled stub/cached fallbacks; photo ingest
(`GET /ig/shares` → `GET /ig/media` → DELETE-ack); `POST /ig/send`
rule set (window, idempotency, duplicate guard); `mock-dm.html` chat
shell + bubble CSS + 5s poll + operator send panel as the build base;
M14f cached mode (demo survives an outage); all M13 parity tests.

**At risk of rework:** `app/index.html` panel flow (retired as demo
path — every video-script beat referencing panels is void; it stays
only as the unlinked debug tool per §8.1); the M16 hosted-build plan
(now SIMPLER — a one-shot local install script, not a hosted URL; see
§8.3); any M4 video-script draft written against panels; M18's
isolation walk (re-run against the chat flow); the M10 parked
rationale ("no chat surface" — this pivot un-parks a chat surface, so
the M10 conflict must be resolved in 19g, not ignored).

Sizing (S < 1 day, M = 1–2 days, L = 2+ days of the remaining 6):

| Sub-milestone | Size | Notes |
|---|---|---|
| 19a chat shell promotion (thread as judged surface, look card → bubble) | M | Extends `mock-dm.html`; share-card render becomes a bubble |
| 19b send-client module (`confirm:true`, per-turn keys, `401`/`409`/`422` surfacing, `is_echo` skip) | S–M | M12-client-shaped; operator panel is the reference impl; mock-only |
| 19c user-keyed catalog module (piece records + turn history + verdicts + pending questions + own-sent-turn log) + M11 contract sketch seam | L (was M) | UPSIZED: persistent multi-share wardrobe, interface-agnostic schema, injected user key, M11 sketch — the largest new-build item |
| 19d turn loop (photo trigger incl. extract-and-catalog, text trigger, propose→validate→revise with catalog recall + cross-piece mix-match) | M–L (was M) | UPSIZED: recall across shares + two-photo-arc mix logic must exist for 19g acceptance |
| 19e text-turn contract (Gap 1: text message type end-to-end) | S | Server-contract call; mock + real bot in lockstep |
| 19f polling/window discipline (Gap 3: §4 cadence as designed, idle stop, user-anchored `422` honesty) | S | Mostly decisions (now made) + small code |
| 19g demo + video re-script for the two-photo arc, M16 one-shot install script + README, M18 re-run, M10 resolution | M | Re-runs isolation walk on the chat flow; judge path is local install, not hosted |

**Deadline triage (decided, §8.7): M19 ITSELF is what gets
time-boxed/descoped if it runs long** — it ships thinner (fewer turn
types, smaller catalog surface), or the app falls back to
`index.html`'s panel flow as the demoed surface with chat as a
secondary beat. M18 (live isolation proof), M16 (now a simpler
one-shot install script), and M4 (submission cut) do NOT give way for
this pivot. Do not start M19 half-built against M18/M16/M4's time.

## 7. Task breakdown (for delegation to Muse Code, in order)

REVISED 2026-10-29 for the user-keyed catalog + automatic polling +
two-photo video arc. Order matters: contract first, then catalog, then
the loop that reads it, then the surface and the tape.

1. **19e (text-turn contract) first** — **DONE 2026-10-29** (37 assertions
   in `app/test/milestone19e-text-turn.test.js`, full suite green):
   the text message shape is `attachment: {type: "text",
   payload: {text}}` with `media_id: null` / `media_available: false`
   (mock minted it already; documented in place), the client's accepted
   shapes are extended without forking the read path (`isTextItem()` /
   `textOf()` added to `app/inbox-bridge.js`), and the
   `POST /mock/incoming-text` → client-visible text turn round-trip is
   proven. Real-bot parity is a spec note only
   (`docs/milestone-13-contract-parity.md`, "Text-turn contract" section —
   Autumn's prior-work maintenance, outside this repo). (Does NOT deliver
   the §8.9 user identifier — independent gap, do not conflate.)
2. **19b (send client)** — new `app/` module issuing byte-identical
   `POST /ig/send` per turn (per-turn fresh keys, replay-on-retry,
   `409`/`422`/`401` surfaced in-thread, `is_echo` skip on poll).
   Mock-only sends. Verify: one assertion per `doSend` rule
   (mirroring the M13 send task batch); duplicate-text re-send
   returns `409`, replay returns stored `message_id`.
3. **19c (user-keyed catalog module)** — per-user wardrobe: piece
   records per the §3 schema (category, attributes, source share,
   added-at, cache keys, status flags), turn history (turns,
   proposals, `assembleLook` verdicts + `reasons[]`, pending
   questions), own-sent-turn log (Gap 4 — no live outbound route);
   user key injected as a parameter (single-user assumption until
   §8.9 resolves); M11 sketch seam only (no bot DB build). Verify:
   `node`-runnable self-tests (multi-share accumulation across two
   photos, reject-then-revise flagging, user-anchored window
   flagging); schema carries no IG-specific fields.
4. **19a (chat shell promotion)** — look card → bubble (text part +
   staged-image part via `/mock/stage-outbound-image`), keep
   `index.html` untouched-but-unlinked per §8.1. Verify: manual
   click-through of the §2 triggers against the mock.
5. **19d (turn loop)** — wire triggers → extract-and-catalog on photo
   shares → Spark propose (drawing on previously catalogued pieces,
   not just the new share) → unchanged `assembleLook` validate → in-
   thread revise-or-flag replies; fabric/price answers gated on §8.4
   (say plainly no data, never invent). Verify: one photo yields ≥1
   `valid:true` card via chat AND a catalogued piece record; an
   invalid proposal surfaces its `reasons[]` in-thread; "no bag"
   revises and re-validates; **cross-piece mix-match acceptance (for
   19g): a second photo turn proposes a look combining a piece from
   share 1 with a piece from share 2 and cites both.**
6. **19f (polling/window)** — implement the §4 designed cadence (5s
   active → 30s after 10 min idle → stop after 30 min idle or
   `document.hidden`, resume on focus/action) + pre-send user-anchored
   window check with honest `422` surfacing. Verify: isolation walk
   shows no leaked external dependency; stale-user turn returns the
   `422` path in-thread.
7. **19g (demo + video + judge path)** — re-script the 3-minute video
   around the §8.8 two-photo arc (share photo 1 → look/suggestion,
   share photo 2 → cross-piece mix referencing BOTH, ends on one
   purchase suggestion; montage of earlier turns first only if the
   3-minute budget allows); build the M16 one-shot local
   install+run (proxy + mock bot + static server together, e.g. one
   `start.sh`/`npm run demo`) plus a README that walks a judge
   through it in one read (judge's only requirement: their own Meta
   API key); update M16/M18 flows to the chat surface; roadmap + plan
   status lines agree. Verify: key/token grep clean; no real-DM data
   in fixtures; M10-conflict resolution recorded (see §8.7).
8. **19h (added 2026-10-29, after the original 7) — mock-bot catalog
   persistence + encryption parity.** `app/wardrobe-catalog.js` (19c)
   only holds its per-user wardrobe in browser memory today — the M11
   seam was left as a sketch comment, no backing store. The real bot
   (`igwebhook`, prior work, NOT this repo) just gained a local-only
   `PUT/GET /ig/catalog/<user_ref>` API plus a planned per-user-derived-
   key encryption layer (Milestones A/B in
   `~/secure-webserver/igwebhook/docs/data-management-and-consent.md`).
   This milestone mirrors ONLY that contract onto `mock-ig-bot/server.js`
   — same `user_ref` shape, whole-array-replace semantics, and per-user
   AES-256-GCM encryption via Node's built-in `crypto` (no new npm
   dependency, unlike the real bot's pending `cryptography` PyPI
   question) — then wires `wardrobe-catalog.js`'s M11 seam to call it
   instead of staying memory-only. Does NOT touch `igwebhook` at all —
   that stays Claude's/Autumn's track per the compliance skill's
   prior-work boundary. Verify: `node`-runnable store/retrieve
   round-trip, last-write-wins, malformed-`user_ref` rejection, and
   proof the on-disk file is ciphertext (read it raw, confirm it is NOT
   valid JSON/plaintext piece data) with correct decrypt-on-read. Full
   suite stays green.

## 8. Open questions for Autumn — ALL 8 RESOLVED 2026-10-29, plus one NEW

Convention: resolved items stay visible (struck), never deleted, per
the compliance skill's rule on not deleting rejected/resolved options.

1. ~~**Retire or keep `app/index.html`?** Delete it, or keep it as an
   unlinked dev/debug tool (segment/tag/assemble without chat)?
   Genuinely undecided — do not assume deletion.~~ — **Resolved
   (Autumn, 2026-10-29): keep in-repo as an unlinked dev/debug tool**
   (manual segment/tag/assemble without chat). Not deleted, not part
   of the judged demo.
2. ~~**Real-DM agent replies: go or no-go?** Per the compliance
   skill's send gate, agent sends to a real person need your explicit
   go-ahead before a send spec is even drafted — plus the M17 call on
   the `IG_GRAPH_SEND_TOKEN` placeholder (real sends `502` today)
   and App Review scope (M8, descoped). Default assumed: mock-only
   sends for the submission.~~ — **Resolved (Autumn, 2026-10-29):
   mock-only** (`mock-ig-bot/server.js`) for this submission. Real
   Instagram DM sends are a stretch goal only if time allows — and if
   pursued, the compliance skill's stricter send-gate still applies
   unchanged at that point (explicit go-ahead before drafting a send
   spec; window/rate-limit/consent risks as open questions).
3. ~~**Hosted judge build (M16): can the chat run one-URL with no local
   processes?** Today the chat needs `node mock-ig-bot/server.js` on
   `127.0.0.1:8904`. Options: hosted static + cached/fixture mode,
   host the mock too, or judge-local-only with video carrying the
   demo. M16's acceptance ("no `127.0.0.1` dependency") collides
   with a live chat loop — needs your call.~~ — **Resolved (Autumn,
   2026-10-29): LOCAL ONE-SHOT INSTALL+RUN is the primary judge
   path, not a hosted URL.** The judge's only requirement is their
   own Meta API key. Build a single install/run script (proxy + mock
   bot + static server started together, e.g. one `start.sh`/`npm run
   demo`) and a README that walks a judge through it in one read.
   Hosted live Instagram integration is a stretch goal, not required.
4. ~~**Fabric/price turns: in scope without M15?** No candidate
   inventory exists (roadmap M15 gap); per-piece copy is invented
   placeholder. Either scope these turns to "flag unknown / M15-lite
   mini-inventory" or descope them to fit-rule + styling answers
   only. The agent must not invent listings either way.~~ —
   **Resolved (Autumn, 2026-10-29): FULLY DESCOPED.** No M15/M15-lite
   synthetic inventory build. Chat/styling turns never quote fabric,
   price, or vendor details; if asked, the agent says plainly it does
   not have that data rather than inventing a listing. A real
   boutique-sourcing database integration is a SEPARATE future
   stretch goal, explicitly out of scope for build here, blocked on:
   (a) hosting (the DB would need to be reachable, which collides
   with the "local install" judge path — tension noted, not
   resolved); (b) a PII-scrub pass on any photos from that source
   before they could ever appear in this repo or demo. Mentioned in
   future-work framing (§5) only — NOT a sub-milestone.
5. ~~**Thread scope: one share = one conversation?** The state module
   (§3) keys threads off the originating `share_id`. Confirm — or
   specify the multi-share / multi-photo-thread rule instead.~~ —
   **Resolved (Autumn, 2026-10-29): MULTI-SHARE, persistent
   conversation per user — NOT one-thread-per-share-id.** One user
   keeps one evolving wardrobe/conversation across many shared photos
   over time. This required the §3 rewrite (share_id-keyed →
   user-keyed). Needs a real per-user identifier that survives across
   shares — see NEW §8.9.
6. ~~**Who drives the loop: automatic agent poll or
   operator-assisted?** Options: (a) the page auto-polls and
   auto-replies like a real agent (needs the §4 Gap-3 cadence +
   idle-stop), or (b) Autumn clicks "reply" per turn in the demo
   (simpler, less agentic-looking on video). This materially changes
   19d/19f.~~ — **Resolved (Autumn, 2026-10-29): AUTOMATIC POLLING
   (option (a)).** The app polls the bot continuously; webhook-based
   push is a future tightening, not required. The
   polling-cadence/idle-stop decision is now DESIGNED in §4 Gap 3, no
   longer an open question.
7. ~~**Triage against the deadline: what slips?** 19a+19c+19d are
   ~2×M inside 6 days shared with M18/M16/M4, and this pivot
   contradicts M10's parked rationale ("no chat surface"). Confirm the
   pivot outranks M10-parked + which critical-path item (M18, M16, M4
   polish) gives way — or pick the fallback (panels for submission,
   chat as tech-preview beat).~~ — **Resolved (Autumn, 2026-10-29):
   M19 ITSELF absorbs any overrun** (ships thinner, or the app falls
   back to `index.html`'s panel flow as the demoed surface with chat
   as a secondary beat). M18, M16 (now simpler), and M4 do NOT give
   way. (M10 conflict is resolved in 19g, not ignored.)
8. ~~**Demo-video thread script: who plays the user, and which turns?**
   Fix the 3-minute chat script (photo → question → proposal → "no
   bag" revise → look card) so 19g builds to it; confirm whether the
   video shows mock-only or the live bot.~~ — **Resolved (Autumn,
   2026-10-29): TWO-PHOTO ARC** — share photo 1 → look/suggestion,
   share photo 2 → the app references BOTH and suggests a cross-piece
   mix, ends on one purchase suggestion. If time allows within the
   3-minute budget, open with a quick montage of earlier turns before
   the two-photo arc's payoff, showing the outfit coming together
   over the conversation. (Mock-only vs live-bot capture follows the
   §8.2/§8.3 resolutions: mock-first; live only as a stretch.)
9. **NEW (falls out of the §3/§4 rewrite, 2026-10-29): no stable
   per-user identifier exists in the contract — how is "which user"
   keyed?** Grepped finding: `mock-ig-bot/server.js`
   `createStore`/`publicShare` (lines 37–48/83–91) and the live
   contract (`docs/instagram-bot-api.md` line 123, sender IGSID
   deliberately omitted for privacy) expose no sender/user field on
   ANY item, and Gap 1's text-message fix does not add one (§4).
   Options (not decided — do NOT assume): (a) single-user assumption
   for this submission (all inbound shares = one wardrobe; catalog
   key injected but constant); (b) bot mints an opaque per-sender ref
   server-side (mock + real bot in lockstep, same privacy pattern as
   the send API's `share_id`→IGSID resolution) and exposes it on
   items. Needed before multi-user correctness can be claimed; the
   plan proceeds on (a) with the seam left for (b).

## Cross-references

- Milestones: `docs/roadmap.md` (M14d agentic framing, M16 hosted→
  one-shot-install lines 202–238, M7 `is_echo`/M12-client, M10
  parked, M15 inventory gap lines 183–200, M11 bot storage, M18
  isolation, M4 submission cut). NOTE: `docs/roadmap.md` and
  `docs/decisions.md` themselves are NOT touched by this revision —
  Bramble handles those separately.
- Contracts read: `app/inbox-bridge.js`, `mock-ig-bot/server.js`,
  `docs/instagram-bot-api.md` (line 123 sender omission),
  `docs/instagram-bot-send-api.md` (opaque recipient resolution),
  `app/assembler.js`, `app/spark.js`, `app/preview.js`,
  `app/meta-client.js`, `app/mock-dm.html`, `app/index.html`.
- Plans: `docs/milestone-13-mock-dm-plan.md` (format/rigor model;
  M13 parity `docs/milestone-13-contract-parity.md`).
- Compliance: `skills/meta-hackathon-compliance/SKILL.md`,
  `AGENTS.md`.
