---
name: muse-code
description: "Use when delegating a task to Meta's Muse Code CLI."
---

# Muse Code delegation

`muse` (~/.local/bin/muse, a launcher that auto-updates `muse-bin-<ver>`) is Meta's terminal coding agent, Muse Code. Default model `muse-spark-1.3`, provider `meta`, auth already stored in ~/.config/muse/auth.json (never read or print it). Plan: "Muse Code Everyday Usage" with a rolling window + weekly allowance; check with `muse usage`.

## How to delegate

Always go through the wrapper -- it fixes the flags that otherwise hang or fail:

    python3 ~/.hermes/profiles/verdant-companion/skills/autonomous-ai-agents/muse-code/scripts/muse_delegate.py \
        --mode readonly|edit|full --workspace /path/to/repo [--effort low] [--max-steps 40] [--timeout 900] \
        "self-contained task prompt"

- readonly: no shell, no writes (review, explain, plan). Default.
- edit: file edits, no shell. Verify the change yourself afterwards.
- full: edits + shell inside Muse's bwrap sandbox: writes only to workspace, /tmp, $TMPDIR; network via Muse's proxy (public HTTPS works). Use in a git repo / scratch dir so changes are reviewable -- `git init && git add -A && git commit` the workspace yourself FIRST if it isn't a repo yet; Muse does not init one, and a pre-existing baseline commit is what makes its own commit diffable afterward.
- unsandboxed: edits + shell with --disable-sandbox (runs as autumn, anywhere). Only when a task genuinely needs paths outside the workspace; say so to Autumn.
- Other flags: --prompt-file, --worktree (muse makes its own git worktree; untested here), --model, --schema FILE (structured final answer), --image PATH, --no-web.
- Run from the terminal tool with timeout >= the wrapper's --timeout + 30. For long jobs use background=true, notify=true.

The report gives STATUS, FINAL ANSWER, per-tool outcomes, workspace `git status`, allowance %, and the JSONL log path (cache/muse-runs/). Exit 0 completed, 1 failed, 2 timeout.

After it returns: treat the answer as a self-report. Check `git log`/`git diff` against the pre-task commit and re-run tests yourself before telling Autumn it worked. When the task has no test suite (e.g. a static web app), verify by serving and curling it instead of trusting the summary: launch `python3 -m http.server <port>` via the terminal tool with `background=true` (never shell-level `&`/`nohup`/`disown` -- the terminal tool rejects those and tracks background procs itself), then `curl -s -o /dev/null -w '%{http_code}'` each file Muse claims to have created, and `grep` for the markers it claims exist (a TODO stub, a function name).

Grepping for a function name only proves the stub is present, not that the logic is right. For any non-trivial logic Muse wrote (a validator, assembler, parser, rule engine), read the source first to learn the exact input/output shape it documents, then actually execute it against a few representative inputs -- for a browser-only module with no test runner, load it with Node's `vm.runInNewContext(fs.readFileSync(file,'utf8'), ctx)` and call the exported function directly -- and confirm both the accept and the reject paths behave as specified. A syntax check (`node --check`) only proves it parses.

If the module touches `canvas`/DOM APIs (drawing a preview, a collage, anything with `getContext('2d')`), read the source for every context method it calls (`fillRect`, `createLinearGradient`, `measureText`, ...) before writing the mock context object, and pass the exact arguments the function signature expects (e.g. `generateImage(canvas, lookCard)`, not just the card) -- a mock missing one method throws a generic TypeError that looks like a bug in Muse's code but is really just an incomplete stub, and costs a retry to tell apart.

Before granting `full` mode in a workspace that holds (or will hold) credentials, confirm a `.gitignore` already excludes the secret path -- Muse commits its own work automatically and will stage whatever sits in the workspace, including a key file it stumbles on, unless it's already ignored. Add/verify the `.gitignore` entry yourself before the next delegation, not after. Also tell Muse in the task prompt itself never to read or print the secret file and to reference the credential only by its env-var name (wire a `generateX()`-style interface to pull from `process.env`/`os.environ` later) -- the gitignore stops a commit, but only the prompt stops Muse from cat-ing the file into its own transcript or inlining the value into source while building toward it.

For a multi-milestone project, delegate one roadmap milestone per call rather than the whole backlog at once: git-init and baseline-commit the workspace, delegate milestone N in `full` mode with the fit/format rules spelled out explicitly in the prompt (Muse has no project memory between calls), verify independently as above, then queue milestone N+1 referencing what's already committed.

## Prompting

Muse has no context from this conversation. Give: the goal, the files/paths, constraints, how to verify, and the reply format ("reply in one line" keeps output small). Low effort is fine for small edits; default is high (slower, heavier on allowance -- each run used ~50-200k tokens, mostly cached).

## Pitfalls (verified 28 Oct 2026, Muse Code 1.4.14)

- Headless `--approval-mode on-request` (the default) hangs forever on the first shell command: there is no one to approve. Wrapper always passes `--approval-mode never --disable-request-user-input`.
- Sandbox needs the AppArmor profile /etc/apparmor.d/muse-code (installed 28 Oct 2026 from scripts/muse-code.apparmor via `sudo bash scripts/install-apparmor.sh`). Why: Muse runs its *embedded* bwrap (via /proc/self/exe), and Ubuntu's `kernel.apparmor_restrict_unprivileged_userns=1` only exempts /usr/bin/bwrap, so without the profile every sandboxed shell call fails with `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. `TBH_BWRAP_EXE=/usr/bin/bwrap` is no workaround: system bwrap 0.11.1 lacks `--ro-bind-symlink`. The profile globs `~/.local/bin/muse-bin-*`, so auto-updates stay covered; if the launcher ever moves the binary, the RTM_NEWADDR error returns (wrapper prints a WARNING) -- check `grep muse-code /sys/kernel/security/apparmor/profiles` and fix the path.
- Plain `muse exec` (no --json) prints only the final answer on stdout; skill/delegation diagnostics go to stderr.
- "Agent delegation: auto unavailable: workspace is untrusted" on stderr is normal; `--trust-workspace` would load the repo's own muse skills/rules (not passed by default).
- Final text is in the `run.terminal.*` event (`payload.text`, `payload.terminal` = completed/failed); streamed text in `run.output.delta`; tool outcomes in `tool.result.correlation_facts`.
- `--max-model-steps` exhaustion ends the run as failed ("did not reach a terminal state within N step(s)").
- Sessions persist under ~/.local/share/muse/sessions; `muse export --session <id> --out f.json` dumps one; `muse resume <id>` is interactive TUI only.
- Muse's *own* sandboxed bash calls fail the same way the terminal tool rejects unmanaged backgrounding: if its self-verification step tries `setsid -f` / `&` / `nohup` to start a test server, that specific bash call errors out inside the sandbox. This doesn't abort the run -- Muse works around it and still reports completed -- so don't chase it; just do the serve-and-curl verification yourself afterward instead of trusting that Muse's internal smoke test ran at all.
