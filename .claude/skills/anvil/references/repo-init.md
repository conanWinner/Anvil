# Initializing Anvil in a Repository

Set up the `.anvil/` directory structure in any git repository to enable custom workflows and commands.

## Directory Structure

Create the following in your repository root:

```
.anvil/
├── commands/         # Custom command files (.md)
├── workflows/        # Workflow definitions (.yaml)
├── scripts/          # Named scripts for script: nodes (.ts/.js for bun, .py for uv) — optional
├── mcp/              # MCP server config files (.json) — optional
├── state/            # Cross-run workflow state — gitignored, never committed
├── config.yaml       # Repo-specific configuration — optional
└── .env              # Repo-scoped Anvil env (optional; do NOT commit)
```

```bash
mkdir -p .anvil/commands .anvil/workflows .anvil/scripts
```

**What each directory is for:**

- `commands/` — Reusable prompt templates used by `command:` workflow nodes. Committed to git.
- `workflows/` — YAML workflow definitions. Committed to git.
- `scripts/` — Named TypeScript/JavaScript (bun) or Python (uv) scripts referenced by `script:` nodes. Extension determines runtime: `.ts`/`.js` → bun, `.py` → uv. Committed to git.
- `mcp/` — MCP server JSON configs. Usually checked in with `$ENV_VAR` references; avoid hardcoding secrets. Some teams gitignore this and rely entirely on env expansion.
- `state/` — Workflow-written cross-run state (e.g. the `repo-triage` dedup log). **Always gitignore** — these are runtime artifacts, not source.
- `config.yaml` — Repo-specific defaults (assistant, worktree settings, etc.). Committed to git.
- `.env` — Repo-scoped Anvil env (loaded with `override: true` at boot). **Do NOT commit.** This is different from the target repo's top-level `.env` — that file belongs to the target project, and Anvil strips its auto-loaded keys from subprocess env before spawning AI to prevent leakage. See **Three-Path Env Model** below.

## Minimal config.yaml

Create `.anvil/config.yaml` only if you need to override defaults:

```yaml
# AI provider for this repo (default: inherited from global config)
assistant: claude                 # Repo-level key. In ~/.anvil/config.yaml, use 'defaultAssistant' instead

# Worktree settings
worktree:
  baseBranch: main                # Branch to create worktrees from (default: auto-detected)
  copyFiles:                      # Git-ignored files to copy into new worktrees
    - .env
    - .env.local

# Control whether bundled defaults are loaded
defaults:
  loadDefaultCommands: true       # Include bundled default commands (default: true)
  loadDefaultWorkflows: true      # Include bundled default workflows (default: true)
```

## How Bundled Defaults Work

Anvil ships with built-in commands and workflows (like `anvil-assist`, `anvil-fix-github-issue`). These are loaded at runtime automatically — no files need to be copied into your repo.

- **To see bundled workflows**: `anvil workflow list`
- **To override a default**: Create a file with the same name in your repo's `.anvil/workflows/` or `.anvil/commands/`. Repo files take priority.
- **To disable defaults**: Set `defaults.loadDefaultWorkflows: false` or `defaults.loadDefaultCommands: false` in config.

## .gitignore Considerations

Add to your `.gitignore`:

```gitignore
# Anvil runtime artifacts — NEVER commit
.anvil/state/        # Cross-run workflow state, runtime-only
.anvil/.env          # Repo-scoped Anvil env (secrets)

# Optional — gitignore if your MCP configs hardcode secrets
.anvil/mcp/
```

`.anvil/commands/`, `.anvil/workflows/`, and `.anvil/scripts/` **should be committed** — they are part of your project's workflow definitions. `.anvil/config.yaml` should be committed unless it contains secrets (use `.anvil/.env` for those instead).

## Three-Path Env Model

Anvil loads env from three distinct paths at boot, with different trust levels and precedence:

| Path | Scope | Trust | Loaded? |
|------|-------|-------|---------|
| `~/.anvil/.env` | User (home) | Trusted — user owns it | Yes, with `override: true` |
| `<cwd>/.anvil/.env` | Repo (per-project, Anvil-owned) | Trusted — user owns it | Yes, with `override: true` (overrides home) |
| `<cwd>/.env` | Target repo | **Untrusted** — belongs to the project being worked on | **Stripped from `process.env`** before subprocess spawn to prevent secret leakage (see [anvil.diy/reference/security/](https://anvil.diy/reference/security/#target-repo-env-isolation) for the full trust model) |

Boot behavior emits observable log lines:

```
[anvil] loaded N keys from ~/.anvil/.env
[anvil] loaded M keys from /path/to/repo/.anvil/.env
[anvil] stripped K keys from /path/to/repo (ANTHROPIC_API_KEY, OPENAI_API_KEY, ...)
```

**Where should you put what?**

- **API keys for Anvil itself** (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `DATABASE_URL`, `SLACK_BOT_TOKEN`, etc.) → `~/.anvil/.env` (shared across all repos) or `<cwd>/.anvil/.env` (per-repo override).
- **Target-project env that a workflow needs** (`GH_TOKEN`, `DOTENV_PRIVATE_KEY`, etc.) → see [Per-Project Env Injection](#per-project-env-injection) below.
- **Target-project env that Anvil should NOT touch** → leave it in `<cwd>/.env` where the project already expects it. Anvil strips it from subprocess env but doesn't delete the file.

The `anvil setup --scope home|project [--force]` wizard writes to the right file for you and produces a timestamped backup on every rewrite.

## Per-Project Env Injection

For env vars a workflow's `bash:` and `script:` subprocesses need (`GH_TOKEN` for `gh` calls, `DATABASE_URL` for a migration script, etc.), use one of the two **managed injection** surfaces — both inject into subprocess env at workflow execution time, after the target-repo `.env` strip:

**Option 1: `.anvil/config.yaml` `env:` block** (checked into git; values can be `$REF_NAME` expansions from Anvil env):

```yaml
env:
  GH_TOKEN: $GH_TOKEN             # expanded from ~/.anvil/.env at runtime
  BUILD_TARGET: production        # literal value
```

**Option 2: Web UI Settings → Projects → Env Vars** — per-codebase, stored in the Anvil DB, values never returned over the API (only keys are listed). Use this for values that should NOT appear in git.

Both surfaces inject into: Claude/Codex/Pi subprocess env, `bash:` node subprocess env, `script:` node subprocess env, and direct chat messages that run against the codebase. The worktree isolation layer propagates them as well.

> **About keys in the target repo's `<cwd>/.env`**: Anvil unconditionally strips the keys auto-loaded from `<cwd>/.env` out of `process.env` at boot (see the Three-Path Env Model above) and the Bun subprocess is invoked with `--no-env-file`, so those values do NOT reach AI / bash / script subprocesses. If a workflow needs a value that currently lives in the target repo's `.env`, surface it through one of the two managed injection options above — don't expect the target `.env` to leak through.

## Global Configuration

The global config at `~/.anvil/config.yaml` applies to all repositories. Use `guides/config.md` for interactive config editing, or create it manually:

```yaml
botName: Anvil
defaultAssistant: claude

assistants:
  claude:
    model: sonnet
  codex:
    model: gpt-5.3-codex
    modelReasoningEffort: medium

concurrency:
  maxConversations: 10
```

## Verification

After setting up, verify with:

```bash
# Confirm Anvil sees your repo
anvil workflow list

# Should show bundled workflows + any custom ones you've added
```
