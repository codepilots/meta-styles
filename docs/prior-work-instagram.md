# Prior work — Instagram integration (SecondBloom)

**This predates the Meta Global AI Developer Hackathon.** Built and deployed
14 Oct 2026 — twelve days before the hackathon build window opened (26 Oct
2026, 12:00 PM EST). It is background/prior capability, not hackathon-period
work, and it is **not part of this repo's codebase**: it runs as a separate
deployed service outside `~/projects/meta-styles`. Included here only to
document the technical lineage behind meta-styles' photo → outfit pipeline.

## What it is

**SecondBloom** — a live Meta app (app_id `29264663606459560`) with a
DM-share bot on Instagram (receiving IG business account ID
`17841417613087488`). A normal Instagram user shares a post, reel, or photo
to the SecondBloom account via DM; a webhook receiver processes it — no
developer dashboard, Graph Explorer, or account-type change required on the
sending user's side.

## Stack (deployed, outside this repo)

- `~/secure-webserver/igwebhook/app.py` — stdlib-only Python HTTP receiver
  (no framework), run as an unprivileged, read-only, capability-dropped
  Docker container (`python:3.13-alpine`, 128MB mem limit) behind nginx at
  `https://www.codepilots.co.uk/ig/webhook`.
- Verifies Meta's webhook handshake (`hub.verify_token`) and every POST's
  `X-Hub-Signature-256` against the app secret before writing anything.
- Raw verified events append to `data/events.jsonl`; shared
  posts/reels/mentions flatten into `data/shares.jsonl`.
- Media attachments (signed, temporary `lookaside.fbsbx.com` URLs) are
  downloaded immediately to `data/media/` on arrival.
- Downloaded images are run through vision analysis to decompose an outfit
  into base / layer / accessory pieces, the colour links between them, and
  style keywords — the same per-piece decomposition pattern meta-styles'
  Milestone 2 look-card assembler now formalises with explicit fit rules.

## Why it's relevant to meta-styles

SecondBloom proved the hard infrastructure problem — getting a real photo
of a real outfit from an ordinary user's phone into a processing pipeline
without any setup friction (no Creator account switch, no Facebook Page
link, no dashboard). meta-styles reuses that lesson (design for the ordinary
user first) but is a separate, self-contained web app built fresh during the
hackathon window; it does not call into or depend on the SecondBloom
webhook, container, or credentials, and none of SecondBloom's code is
vendored into this repo.

## Full detail

The complete integration runbook (App Review gates, webhook connection
order, payload shapes, pitfalls, Meta Model API usage) lives in the
`meta-instagram-integration` skill, not duplicated here to avoid drift.
