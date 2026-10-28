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

Everything previously listed here (new-work-only, public repo, the Meta
model usage gate) is now confirmed above by the event Discord FAQs. The one
remaining unconfirmed detail from third-party notes (e.g.
`meta-ai-hackathon/meta-hack`, `rizonetech/isitlegit` GitHub repos):

- A specific demo video length (e.g. 3 minutes) — not seen yet in any
  organizer-posted text; still just a common hackathon convention.

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
   SecondBloom code is vendored in — only docs referencing it.
6. **Budget real time for the Demo (25% of score)** — a working live demo
   plus a polished demo video; this is Milestone 4 ("submission cut") in
   `docs/roadmap.md`.
7. **Nothing shared during the event is confidential** — don't paste real
   client data or other paid-work details into the event Discord, workshops,
   or the submission itself.
8. **Deadline is Nov 4, 9:00 PM ET** — no grace period assumed.
