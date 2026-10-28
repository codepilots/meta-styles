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

These appear in other teams' own compiled notes (e.g. the
`meta-ai-hackathon/meta-hack` and `rizonetech/isitlegit` GitHub repos,
paraphrasing an event Discord post), **not** in the Organizers' Official
Rules text above. Flag clearly as provisional if citing them to Autumn, and
prefer the cautious reading until confirmed in-event:

- "New work only" — demo should show only what was built during the event
  window; unclear/pre-existing contribution risks being read as
  non-compliant even though the Official Rules don't say this explicitly.
  (Still not confirmed in writing anywhere seen so far, but treat as likely
  true in spirit given the FAQ's "must use Meta models" requirement.)
- Public repository requirement for submission.
- A specific demo video length (e.g. 3 minutes).

~~A hard pass/fail gate requiring genuine Meta Model API / open-weights
use~~ — **now confirmed** by the Discord FAQ ("your project must use Meta
models"), moved to the confirmed section above.

## Practical checklist for meta-styles

1. **Keep pre-hackathon work clearly separated and dated.** Already done:
   `docs/prior-work-instagram.md` states the SecondBloom Instagram
   integration predates the hackathon by 12 days and is not part of this
   repo's code; git commit timestamps corroborate it. Given the unverified
   "new work only" norm above, keep erring toward over-disclosure rather
   than presenting anything pre-built as hackathon output. If a strict
   cutoff ever matters, use the building-period start (Oct 27 noon ET),
   not the kickoff livestream (Oct 26 noon ET) — meta-styles' own first
   commit (`4afac15`) predates both anyway.
2. **Document AI-agent assistance transparently** — it's explicitly allowed
   by the Official Rules. Don't scrub Muse/Claude commit attribution.
3. **"Use of Meta AI Tooling" is 25% of the score** — the app is currently
   stubbed (classifier/spark/preview all placeholder). Before final
   submission, swap in real Meta Model API calls (Spark/Image/SAM) sourced
   from `.env/secrets` per `docs/decisions.md` §Secrets — but only once
   Autumn says to start using the real key (she asked to hold off as of
   28 Oct 2026).
4. **Before any public submission:** confirm `.env/secrets` stays gitignored
   (`git ls-files | grep -i env` should be empty), grep the repo (including
   `skills/`) for key/token patterns, and confirm no proprietary SecondBloom
   code is vendored in — only docs referencing it.
5. **Budget real time for the Demo (25% of score)** — a working live demo
   plus a polished demo video; this is Milestone 4 ("submission cut") in
   `docs/roadmap.md`.
6. **Nothing shared during the event is confidential** — don't paste real
   client data or other paid-work details into the event Discord, workshops,
   or the submission itself.
7. **Deadline is Nov 4, 9:00 PM ET** — no grace period assumed.
