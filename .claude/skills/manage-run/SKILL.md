---
name: manage-run
description: |
  Use when: User wants to INSPECT, MONITOR, START, APPROVE, or CONTROL Anvil
  workflow RUNS in the current project — driven through the `anvil` CLI over bash.
  Triggers (inspect): "what's running", "list runs", "show recent runs", "run status",
            "did the review pass", "check run <id>", "show me run <id>", "what happened in that run".
  Triggers (control): "approve the plan", "approve run <id>", "reject that run", "cancel that run",
            "abandon run <id>", "resume run <id>", "continue that run".
  Triggers (start): "start <workflow> in the background", "kick off <workflow> detached".
  Capability: Drives `anvil workflow runs/get/status/run --detach/approve/reject/abandon/resume`
            with machine-readable `--json` output, scoped to the current project by cwd.
  NOT for: Authoring workflows/commands, or Anvil setup/config — use the broader `anvil` skill.
argument-hint: "[run-id or workflow] [comment]"
---

# Manage Anvil Runs

A focused skill for **managing workflow runs** through the `anvil` CLI. It assumes
Anvil is already installed and you are working **inside the project repo** — the
current directory scopes every command to that project automatically. For authoring
workflows, setup, or config, use the broader **`anvil`** skill instead.

## Recent runs (live)

!`anvil workflow runs --limit 10 2>&1 || echo "Anvil CLI not installed. (This skill needs the anvil CLI on PATH.)"`

## How output works

- Add `--json` to any command for a **single clean JSON object on stdout** (logs are
  suppressed automatically in `--json` mode). Prefer `--json` when you will parse the result.
- Without `--json` you get human-readable text. Diagnostics/warnings always go to stderr.
- The current directory (cwd) determines which project's runs you see. Run from the repo.

## Verbs

| Goal | Command |
|------|---------|
| **List recent runs** (all statuses, this project) | `anvil workflow runs --json` |
| List across **all** projects | `anvil workflow runs --all --json` |
| Filter by status / cap rows | `anvil workflow runs --status running --limit 50 --json` |
| **Show one run** (status, error) | `anvil workflow get <run-id> --json` |
| One run **with per-node detail** | `anvil workflow get <run-id> --verbose --json` |
| **Active** runs only (running/paused) | `anvil workflow status --json` |
| **Start** a run, non-blocking | `anvil workflow run <workflow> "<message>" --detach` |
| **Approve** a paused gate | `anvil workflow approve <run-id> "looks good" --json` |
| **Reject** a paused gate | `anvil workflow reject <run-id> "fix X first" --json` |
| **Cancel** a non-terminal run | `anvil workflow abandon <run-id> --json` |

> There is no separate `cancel` verb — `abandon` cancels a non-terminal run by id.

## Patterns

### Monitor a run to completion
```bash
anvil workflow runs --json                 # find the run id
anvil workflow get <run-id> --json         # poll status: running | completed | failed | paused
```
A run is finished when `status` is `completed`, `failed`, or `cancelled`.

### Start work without blocking
```bash
anvil workflow run anvil-assist "Investigate the flaky test" --detach
# returns immediately; the run then appears in `anvil workflow runs`
```
`--detach` runs the workflow in a background child. The parent can't print the new
run id (it's created in the child) — find it with `anvil workflow runs`. If the run
never appears, check the child log path printed by the command (or the `logPath`
field in `--detach --json`).

> **Console UI note:** a detached run appears in the web console's Workflow dock
> (the dock lists runs by project) **and updates live** — even though it executes in a
> separate process. A server-side poller tails the workflow-event table and replays new
> rows to the console's live feed (on PostgreSQL a `NOTIFY` trigger pushes them within
> the same second; on SQLite the poller picks them up on its short interval). No refresh
> is needed.

### Approve or reject a paused run (two steps)
`--json` approve/reject/resume **record the decision** (the run becomes resumable) but
do **not** execute the workflow — execution streams output that would corrupt the JSON.
So:
```bash
anvil workflow approve <run-id> "ship it" --json   # records the approval (resumable: true)
anvil workflow resume <run-id>                      # execute it — run this as a BACKGROUND task
anvil workflow get <run-id> --json                  # poll until completed/failed
```
If you only need to record the decision (e.g. cancel via reject) and don't need to
drive the run forward, the `--json` step alone is enough. To approve **and** continue
in one blocking call, drop `--json`: `anvil workflow approve <run-id> "ship it"`
auto-resumes (run it as a background task).

## Reference

For the full flag list and JSON shapes of each verb: read `references/commands.md`.
