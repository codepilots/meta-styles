# AGENTS.md

Instructions for any AI agent (Muse Code, Claude/Bramble, or other) working
in this repository — `meta-styles`, a Meta Global AI Developer Hackathon
entry (Indie Developer track).

## Mandatory: read the compliance skill first

Before editing anything in this repo, read
[`skills/meta-hackathon-compliance/SKILL.md`](skills/meta-hackathon-compliance/SKILL.md)
in full. It is sourced from the event's own Official Rules and Discord FAQs
(not third-party guesses) and is kept current as new FAQ content lands. Every
rule below is a summary of that skill — if anything here and the skill
disagree, the skill wins; it's the one that gets updated.

## Hard rules (compliance-breaking — do not violate even if asked)

1. **New work only.** Only features/code/functionality built during the
   hackathon window (kickoff Oct 26, building period Oct 27 – Nov 4, 2026)
   may be presented as part of this submission. Anything that predates the
   hackathon — e.g. the SecondBloom Instagram integration referenced in
   `docs/prior-work-instagram.md` — must stay clearly marked as prior work
   and must never be vendored into this repo's app code or shown as a
   meta-styles feature.
2. **This repo must stay public, clean, and free of secrets.** Never commit
   `.env/` or any API key/token. `.env/secrets` holds `meta-api-key=...` for
   the Meta Model API — reference it only via the process environment
   (`os.environ`/`process.env`), never read or print its contents, never
   inline the literal key into source, a commit, or a chat/log message.
   Before any commit: a quick grep for key/token patterns across changed
   files is good hygiene.
3. **The project must meaningfully use Meta models** (Muse Spark, Muse
   Image, SAM 3.1 via Meta Model API, and/or Meta open-weight models). This
   is a pass/fail gate before scoring, not optional polish. Real API calls
   should only be wired in once Autumn explicitly says to start using the
   real key — check `docs/decisions.md` for the latest status before
   assuming it's time.
4. **Avoid-list:** do not build or ship anything resembling AI medical
   advice/mental-health advisors/skin-condition detectors, a basic RAG app,
   a *simple image analyzer*, a generic education chatbot, a job-application
   screener, a nutrition coach, a personality analyzer, a sports
   analyzer/coach, or anything political or war-related. meta-styles sits
   close to the "simple image analyzer" line — keep framing and features
   centred on full-look assembly, fit rules, and resale-grounded copy, not
   the raw classify-a-photo mechanic in isolation.
5. **Third-party technical assistance (including AI agents) is allowed and
   should be visible, not hidden.** Commits authored by `claude-code` or
   `muse-code` are fine and expected — don't rewrite history to obscure
   agent involvement. The submission just has to remain Autumn's own work,
   which she directs.
6. **Submission package needs:** a public repo (this one), a 3-minute demo
   video, and every contributor's name. Deadline Nov 4, 9:00 PM ET — no
   grace period.

## When in doubt

Don't guess on anything that risks disqualification (scope, Meta model
usage, the avoid-list). Flag it to Autumn, or point her to the event
Discord (`@CV`) per the FAQ's own suggestion.
