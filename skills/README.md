# skills/

Reference copies of Hermes agent skills relevant to this project, mirrored
from `~/.hermes/profiles/verdant-companion/skills/` for repo-local context
(e.g. hackathon judges/reviewers, or Muse Code reading `--trust-workspace`).
These are **copies for documentation purposes**, not the live skills Bramble
actually runs from — edits here don't propagate back, and these don't update
automatically when the live skills change.

- `meta-instagram-integration/` — Meta/Instagram Graph API + webhook
  integration patterns, access-route decision table, Meta Model API (Muse
  Spark/Image/SAM) usage notes. Backs `docs/prior-work-instagram.md` (the
  pre-hackathon SecondBloom work) and is also the reference for calling the
  real Meta Model API in later meta-styles milestones.
- `muse-code/` — how Bramble delegates implementation work to Meta's Muse
  Code CLI (the agent that built Milestones 1–3 of this app): wrapper
  script, sandbox/AppArmor notes, prompting guidance, pitfalls.

Contain no credentials (checked before commit) — real keys stay in
`.env/secrets` (gitignored), never in a skill file.
