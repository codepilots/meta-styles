#!/usr/bin/env python3
"""Delegate one task to Meta's Muse Code CLI (`muse exec`) headlessly and summarise the result.

Usage:
  muse_delegate.py [--mode readonly|edit|full|unsandboxed] [--workspace DIR] [--worktree]
                   [--effort LEVEL] [--model ID] [--max-steps N] [--timeout S]
                   [--schema FILE] [--image PATH ...] (PROMPT | --prompt-file FILE)

Modes (approval is always 'never' -- headless on-request approval hangs forever):
  readonly  no shell, no file writes          (analysis, review, Q&A)
  edit      file edits allowed, no shell      (code changes you will test yourself)
  full         file edits + SANDBOXED shell (writes limited to workspace, /tmp,
               $TMPDIR; network via muse's proxy). Needs the muse-code AppArmor profile.
  unsandboxed  file edits + shell with NO sandbox (runs as this user, anywhere)

Prints a plain-text report: status, final answer, tool calls, workspace git changes,
allowance usage, and the path of the full JSONL event log.
Exit code: 0 completed, 1 failed/cancelled, 2 timeout, 3 usage error.
"""
import argparse, json, os, shutil, subprocess, sys, time
from pathlib import Path

LOG_DIR = Path(os.environ.get("MUSE_DELEGATE_LOG_DIR",
               Path.home() / ".hermes/profiles/verdant-companion/cache/muse-runs"))
SANDBOX_BROKEN = "loopback: Failed RTM_NEWADDR"


def git_status(ws):
    try:
        r = subprocess.run(["git", "-C", ws, "status", "--short"], capture_output=True, text=True, timeout=20)
        return r.stdout if r.returncode == 0 else None
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("prompt", nargs="?")
    ap.add_argument("--prompt-file")
    ap.add_argument("--mode", choices=["readonly", "edit", "full", "unsandboxed"], default="readonly")
    ap.add_argument("--workspace", default=os.getcwd())
    ap.add_argument("--worktree", action="store_true", help="muse creates a session git worktree")
    ap.add_argument("--effort", help="none|minimal|low|medium|high|xhigh|max|ultra")
    ap.add_argument("--model")
    ap.add_argument("--max-steps", type=int, default=40)
    ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--schema", help="JSON schema file for the final answer")
    ap.add_argument("--image", action="append", default=[])
    ap.add_argument("--no-web", action="store_true", help="disable muse web tools")
    a = ap.parse_args()

    if not (a.prompt or a.prompt_file):
        ap.error("give PROMPT or --prompt-file")
    muse = shutil.which("muse")
    if not muse:
        print("ERROR: muse not on PATH (expected ~/.local/bin/muse)"); sys.exit(3)
    ws = str(Path(a.workspace).expanduser().resolve())

    cmd = [muse, "exec", "--json", "--workspace", ws,
           "--approval-mode", "never", "--disable-request-user-input",
           "--max-model-steps", str(a.max_steps)]
    if a.mode == "readonly":
        cmd += ["--disable-shell", "--disable-write"]
    elif a.mode == "edit":
        cmd += ["--disable-shell"]
    elif a.mode == "unsandboxed":
        cmd += ["--disable-sandbox"]
    if a.worktree: cmd += ["--worktree", "create"]
    if a.effort: cmd += ["--reasoning-effort", a.effort]
    if a.model: cmd += ["--model", a.model]
    if a.schema: cmd += ["--output-schema", a.schema]
    if a.no_web: cmd += ["--disable-web-tools"]
    for img in a.image: cmd += ["--image", img]
    cmd += ["--prompt-file", a.prompt_file] if a.prompt_file else [a.prompt]

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    log, errlog = LOG_DIR / f"{stamp}.jsonl", LOG_DIR / f"{stamp}.stderr"
    before = git_status(ws)
    t0 = time.time()
    timed_out = False
    with open(log, "w") as out, open(errlog, "w") as err:
        p = subprocess.Popen(cmd, cwd=ws, stdout=out, stderr=err, stdin=subprocess.DEVNULL)
        try:
            p.wait(timeout=a.timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            p.terminate()
            try: p.wait(timeout=15)
            except subprocess.TimeoutExpired: p.kill()
    dur = time.time() - t0

    session = terminal = reason = None
    final, deltas, tools, usage, sandbox_hit = None, [], [], None, False
    for line in log.read_text().splitlines():
        try: e = json.loads(line)
        except ValueError: continue
        t, pl = e.get("payload_type", ""), e.get("payload", {})
        if session is None and e.get("stream", {}).get("kind") == "session":
            session = e["stream"]["id"]
        if t == "run.output.delta": deltas.append(pl.get("text", ""))
        elif t == "tool.result":
            cf = pl.get("correlation_facts") or {}
            txt = pl.get("text", "")
            if SANDBOX_BROKEN in txt: sandbox_hit = True
            tools.append((cf.get("tool_name", "?"), cf.get("outcome", "error"), txt))
        elif t == "run.usage": usage = pl
        elif t.startswith("run.terminal"):
            terminal, reason, final = pl.get("terminal"), pl.get("reason"), pl.get("text")
    if final is None: final = "".join(deltas).strip() or None

    status = "timeout" if timed_out else (terminal or f"exit {p.returncode}")
    print(f"STATUS: {status}" + (f" ({reason})" if reason else "") + f"  [{dur:.0f}s, mode={a.mode}]")
    print(f"SESSION: {session}")
    print("\nFINAL ANSWER:\n" + (final or "(none)"))
    if tools:
        print(f"\nTOOL CALLS ({len(tools)}):")
        for name, outcome, txt in tools:
            flag = "" if outcome == "success" else "  <-- " + txt[:160].replace("\n", " ")
            print(f"  {name}: {outcome}{flag}")
    after = git_status(ws)
    if after is not None:
        print("\nGIT STATUS (workspace, after):\n" + (after.rstrip() or "  clean"))
        if before is not None and before != after:
            print("  (changed during run)")
    if usage:
        w = (usage.get("allowance") or {}).get("window") or {}
        wk = (usage.get("allowance") or {}).get("weekly") or {}
        toks = sum(m.get("input_tokens", 0) + m.get("output_tokens", 0) for m in usage.get("models", []))
        print(f"\nUSAGE: {usage.get('calls')} model calls, ~{toks} tokens; allowance window {w.get('used_percent')}%, weekly {wk.get('used_percent')}%")
    if sandbox_hit:
        print("\nWARNING: Muse's bwrap sandbox failed (AppArmor userns restriction). "
              "Shell commands did not run. Is the muse-code AppArmor profile loaded? "
              "(grep muse-code /sys/kernel/security/apparmor/profiles; reinstall with scripts/install-apparmor.sh)")
    errs = [l for l in errlog.read_text().splitlines() if "error" in l.lower() or "failed" in l.lower()]
    if errs: print("\nSTDERR:\n  " + "\n  ".join(errs[-5:]))
    print(f"\nLOG: {log}")
    sys.exit(2 if timed_out else (0 if terminal == "completed" else 1))


if __name__ == "__main__":
    main()
