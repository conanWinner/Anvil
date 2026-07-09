---
title: Getting Started
description: Everything you need to go from zero to a working Anvil setup.
category: getting-started
audience: [user]
status: current
sidebar:
  order: 0
---

Everything you need to go from zero to a working Anvil setup — whether you prefer the Web UI or the CLI.

---

## Prerequisites

Before you start, make sure you have:

| Requirement                      | How to check       | How to install                                                                                                      |
| -------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Git**                          | `git --version`    | [git-scm.com](https://git-scm.com/)                                                                                 |
| **Bun** (replaces Node.js + npm) | `bun --version`    | Linux/macOS: `curl -fsSL https://bun.sh/install \| bash` — Windows: `powershell -c "irm bun.sh/install.ps1 \| iex"` |
| **Claude Code CLI**              | `claude --version` | [docs.claude.com/claude-code/installation](https://docs.claude.com/en/docs/claude-code/installation) — in compiled Anvil binaries, also set `CLAUDE_BIN_PATH` ([details](/getting-started/ai-assistants/#binary-path-configuration-compiled-binaries-only)) |
| **GitHub account**               | —                  | [github.com](https://github.com/)                                                                                   |

> **Do not run as root.** Anvil (and the Claude Code CLI it depends on) does not work when run as the `root` user. If you're on a VPS or server that only has root, create a regular user first:
>
> ```bash
> adduser anvil          # create user (Debian/Ubuntu)
> usermod -aG sudo anvil # give sudo access
> su - anvil             # switch to the new user
> ```
>
> Then follow this guide from within that user's session.

> **Windows users:** Anvil runs natively on Windows — no WSL2 required. Install [Git for Windows](https://git-scm.com/) (which includes Git Bash) and [Bun for Windows](https://bun.sh/docs/installation#windows). One caveat: DAG workflow `bash:` nodes need a bash executable — Git Bash provides this automatically.

> **Bun replaces Node.js** — you do not need Node.js or npm installed. Bun is the runtime, package manager, and test runner for this project. If you already have Node.js, that's fine, but Anvil won't use it.

---

## Step 1: Clone and Install

First, pick where to put the Anvil server code:

**Option A: Home directory** (personal use, single user)

Linux/macOS:

```bash
cd ~  # or your preferred directory
git clone https://github.com/conanWinner/Anvil
cd Anvil
```

Windows (PowerShell):

```powershell
cd $HOME  # or your preferred directory
git clone https://github.com/conanWinner/Anvil
cd Anvil
```

**Option B: /opt** (Linux/macOS server installs — keeps things tidy)

```bash
sudo mkdir -p /opt/anvil
sudo chown $USER:$USER /opt/anvil
git clone https://github.com/conanWinner/Anvil /opt/anvil
cd /opt/anvil
```

Then install dependencies:

```bash
bun install
```

This installs all dependencies across the monorepo. Takes about 30 seconds.

---

## Step 2: Set Up Authentication

You need two things: a GitHub token (for cloning repos) and Claude authentication (for the AI assistant).

### GitHub Token

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **"Generate new token (classic)"**
3. Select scope: **`repo`**
4. Copy the token (starts with `ghp_...`)

### Claude Authentication

If you already use Claude Code, you're probably already authenticated. Check with:

```bash
claude --version
```

If not authenticated:

```bash
claude /login
```

Follow the browser flow to log in. This stores credentials globally — no API keys needed.

---

## Step 3: Create Your .env File

> **Required for Web UI / server mode. Optional for CLI-only usage** — the CLI uses your existing Claude authentication by default.

```bash
cp .env.example .env
```

Open `.env` in your editor and set these two values:

```ini
# Paste your GitHub token in both (they serve different parts of the system)
GH_TOKEN=ghp_your_token_here
GITHUB_TOKEN=ghp_your_token_here

# Use your existing Claude Code login
CLAUDE_USE_GLOBAL_AUTH=true
```

That's it. Everything else has sensible defaults:

- **Database:** SQLite at `~/.anvil/anvil.db` (auto-created, zero setup)
- **Port:** 3090 for the API server, 5173 for the Web UI dev server
- **AI assistant:** Claude (default)

> **Why two GitHub token variables?** `GH_TOKEN` is used by the GitHub CLI (`gh`), and `GITHUB_TOKEN` is used by Anvil's GitHub adapter. Set them to the same value.

---

## Choose Your Path

### Path A: Web UI (Server)

**Step 4: Start the Server**

```bash
bun run dev
```

This starts two things simultaneously:

- **Backend API server** on `http://localhost:3090`
- **Web UI** on `http://localhost:5173`

You should see output like:

```
[server] Hono server listening on port 3090
[web] VITE ready in Xms
[web] Local: http://localhost:5173/
```

> **Homelab / remote server?** The backend API already binds to `0.0.0.0` by default, so it's reachable from other machines. However, the Vite dev server (Web UI) only listens on `localhost`. To expose the Web UI on your network:
>
> ```bash
> bun run dev:web -- --host 0.0.0.0
> ```
>
> Then start the backend separately with `bun run dev:server`. The Web UI will be reachable at `http://<server-ip>:5173`. Make sure your firewall allows ports `5173` and `3090`.

**Step 5: Verify It Works**

Open **http://localhost:5173** in your browser. You should see the Anvil Web UI.

**Quick verification checklist:**

1. **Health check** — In a new terminal:

   ```bash
   curl http://localhost:3090/health
   # Expected: {"status":"ok"}
   ```

2. **Database check:**

   ```bash
   curl http://localhost:3090/health/db
   # Expected: {"status":"ok","database":"connected"}
   ```

3. **Send a test message** — In the Web UI, create a new conversation and type:
   ```
   /status
   ```
   You should see a status response showing the platform type and session info.

If all three work, you're up and running.

**Step 6: Clone a Repository and Start Coding**

In the Web UI chat, clone a repo to work with:

```
/clone https://github.com/user/your-repo
```

Then just talk to the AI:

```
What's the structure of this repo?
```

The AI will analyze the codebase and respond. You can also use workflows:

```
/workflow list
```

This shows all available workflows. Try one:

```
Help me understand the authentication module
```

The AI router automatically picks the right workflow based on your message.

---

### Path B: CLI (No Server)

**Step 4: Install the CLI globally**

```bash
cd packages/cli && bun link && cd ../..
```

This registers the `anvil` command globally so you can run it from any repository.

You'll see output like `Success! Registered "@anvil/cli"` followed by a message about `bun link @anvil/cli` — **ignore that second part**, it's for adding Anvil as a dependency in another project.

Bun installs linked binaries to `~/.bun/bin/`. If the `anvil` command isn't found, that directory is not in your `PATH` yet. Fix it:

```bash
# Add to your shell profile (~/.bashrc, ~/.zshrc, etc.)
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

Verify it works:

```bash
anvil version
```

**Step 5: Run workflows from your repository**

```bash
cd /path/to/your/repository

# See available workflows
anvil workflow list

# Ask a question about the codebase
anvil workflow run anvil-assist "How does the auth module work?"

# Plan a feature on an isolated branch
anvil workflow run anvil-feature-development --branch feat/dark-mode "Add dark mode"

# Fix a GitHub issue
anvil workflow run anvil-fix-github-issue --branch fix/issue-42 "Fix issue #42"
```

That's it. The CLI auto-detects the git repo, uses SQLite for state tracking (`~/.anvil/anvil.db`), and streams output to stdout.

> **The target directory must be a git repository.** Anvil uses git worktrees for isolation, so it needs a `.git` folder. If your project isn't a git repo yet, run `git init && git add . && git commit -m "initial commit"` first.

---

## CLI Reference

### Workflows

```bash
# List all available workflows
anvil workflow list

# Run a workflow
anvil workflow run <name> "<message>"

# Run with worktree isolation (recommended for code changes)
anvil workflow run <name> --branch <branch-name> "<message>"

# Run directly in the live checkout without worktree isolation
anvil workflow run <name> --no-worktree "<message>"

# Run against a different directory
anvil workflow run <name> --cwd /path/to/repo "<message>"
```

### CLI Commands

| Command | What It Does |
|---------|-------------|
| `anvil chat <message>` | Send a message to the orchestrator |
| `anvil setup` | Interactive setup wizard for credentials and config |
| `anvil doctor` | Verify your setup (Claude binary, gh auth, DB, adapters) |
| `anvil workflow list` | List available workflows |
| `anvil workflow run <name> [msg]` | Run a workflow (`--detach` to background it) |
| `anvil workflow status` | Show active runs (running + paused) |
| `anvil workflow runs` | List recent runs of every status for this project |
| `anvil workflow get <id>` | Show detail for a single run (any status) |
| `anvil workflow resume <id>` | Resume a failed workflow |
| `anvil workflow abandon <id>` | Abandon a run (running, paused, or failed) |
| `anvil workflow approve <id> [comment]` | Approve an interactive loop gate |
| `anvil workflow reject <id> [--reason "..."]` | Reject an approval gate |
| `anvil workflow cleanup [days]` | Delete old run records (default: 7 days) |
| `anvil workflow event emit` | Emit a workflow event |
| `anvil isolation list` | List active worktrees |
| `anvil isolation cleanup [days]` | Remove stale environments |
| `anvil isolation cleanup --merged` | Remove merged branches |
| `anvil isolation cleanup --merged --include-closed` | Also remove closed (abandoned) PR branches |
| `anvil complete <branch>` | Complete branch lifecycle |
| `anvil validate workflows [name]` | Validate workflow definitions |
| `anvil validate commands [name]` | Validate command files |
| `anvil version` | Show version info |

### Worktree Management

```bash
anvil isolation list              # show active worktrees
anvil isolation cleanup           # remove stale (>7 days)
anvil isolation cleanup 14        # custom staleness threshold
anvil isolation cleanup --merged            # remove merged branches (deletes remote too)
anvil isolation cleanup --merged --include-closed  # also remove closed/abandoned PR branches
anvil complete <branch>           # complete branch lifecycle (worktree + branches)
anvil complete <branch> --force   # skip uncommitted-changes check
```

### Available Workflows

| Workflow | What It Does |
|----------|-------------|
| `anvil-assist` | General Q&A, debugging, exploration, CI failures — catch-all |
| `anvil-fix-github-issue` | Investigate, root cause analysis, implement fix, validate, PR |
| `anvil-create-issue` | Classify problem, gather context, investigate, create GitHub issue |
| `anvil-issue-review-full` | Comprehensive fix + full multi-agent review for GitHub issues |
| `anvil-piv-loop` | Guided Plan-Implement-Validate development with human-in-the-loop |
| `anvil-idea-to-pr` | Feature idea, plan, implement, validate, PR, parallel reviews, self-fix |
| `anvil-plan-to-pr` | Execute existing plan, implement, validate, PR, review |
| `anvil-feature-development` | Implement feature from plan, validate, create PR |
| `anvil-adversarial-dev` | Build a complete application from scratch using adversarial development |
| `anvil-smart-pr-review` | Complexity-adaptive PR review — routes to relevant agents only |
| `anvil-comprehensive-pr-review` | Multi-agent PR review (5 parallel reviewers) with automatic fixes |
| `anvil-validate-pr` | Thorough PR validation testing both main and feature branches |
| `anvil-architect` | Architectural sweep, complexity reduction, codebase health |
| `anvil-refactor-safely` | Safe refactoring with type-check hooks and behavior verification |
| `anvil-interactive-prd` | Create a PRD through guided conversation |
| `anvil-ralph-dag` | PRD implementation loop (iterate through stories until done) |
| `anvil-workflow-builder` | Generate a new Anvil workflow YAML for your project |
| `anvil-remotion-generate` | Generate or modify Remotion video compositions with AI |
| `anvil-resolve-conflicts` | Detect, analyze, and resolve merge conflicts in PRs |

These bundled workflows work for most projects. To customize, copy one from `.anvil/workflows/defaults/` into `.anvil/workflows/` and modify it — same-named files override the defaults.

> **Auto-selection:** You don't need to remember workflow names. Just describe what you want — the router reads all workflow descriptions and picks the best match. For example, "fix issue #42" routes to `anvil-fix-github-issue`, while "review this PR" routes to `anvil-smart-pr-review`. If nothing matches clearly, it falls back to `anvil-assist`.

---

## Customize Your Target Repo

Add an `.anvil/` directory to your target repo for repo-specific behavior:

```
your-repo/
└── .anvil/
    ├── config.yaml         # AI assistant, worktree copy rules
    ├── commands/            # Custom commands (.md files)
    └── workflows/           # Custom multi-step workflows (.yaml files)
```

**Example `.anvil/config.yaml`:**

```yaml
assistant: claude
commands:
  folder: .claude/commands/anvil    # additional command search path
worktree:
  copyFiles:                         # gitignored files/dirs to copy into worktrees
    - .env                           # (`.anvil/` is copied automatically — no need to list it)
    - plans/
```

Without any `.anvil/` config, the platform uses sensible defaults (bundled commands and workflows).

### Custom Commands

Place `.md` files in your repo's `.anvil/commands/`:

```markdown
---
description: Run the full test suite
argument-hint: <module>
---

# Test Runner

Run tests for: $ARGUMENTS
```

Variables available: `$1`, `$2`, `$3` (positional), `$ARGUMENTS` (all args), `$ARTIFACTS_DIR` (workflow artifacts directory), `$WORKFLOW_ID` (run ID), `$BASE_BRANCH` (base branch), `$nodeId.output` (DAG node output).

### Custom Workflows

Place `.yaml` files in your repo's `.anvil/workflows/`:

```yaml
name: my-workflow
description: Plan then implement a feature
model: sonnet

nodes:
  - id: plan
    command: plan

  - id: implement
    command: implement
    depends_on: [plan]
    context: fresh
```

Workflows chain multiple commands as DAG nodes, support parallel execution, conditional branching, and carry context between nodes via `$nodeId.output` substitution.

> **Where are commands and workflows loaded from?**
>
> Commands and workflows are loaded at runtime from the current working directory — not from a fixed global location.
>
> - **CLI:** Reads from wherever you run the `anvil` command. If you run from your local repo, it picks up uncommitted changes immediately.
> - **Server (Telegram/Slack/GitHub):** Reads from the workspace clone at `~/.anvil/workspaces/owner/repo/`. This clone only syncs from the remote before worktree creation, so you need to **commit and push** changes for the server to see them.
>
> In short: the CLI sees your local files, the server sees what's been pushed.

---

## Isolation (Worktrees)

When you use the `--branch` flag, the CLI creates a git worktree so your work happens in an isolated directory. This prevents parallel tasks from conflicting with each other or your main branch.

```
~/.anvil/
├── anvil.db              # SQLite database (auto-created)
└── workspaces/            # Project-centric layout
    └── owner/repo/
        ├── source/        # Clone or symlink to local path
        ├── worktrees/     # Isolated working copies per task
        │   ├── fix/issue-42/
        │   └── feat/dark-mode/
        ├── artifacts/     # Workflow artifacts (never in git)
        └── logs/          # Workflow execution logs
```

---

## Using With Claude Code (Skill)

If you want Claude Code to be able to invoke Anvil workflows on your behalf, install the
Anvil skill into your project. The setup wizard handles this automatically — just run
`anvil setup` and accept the skill installation prompt.

To install manually instead, run `anvil skill install /path/to/your/repo` (which writes both the `anvil` and `manage-run` skills), or copy them by hand:

```bash
cp -r Anvil/.claude/skills/anvil /path/to/your/repo/.claude/skills/
cp -r Anvil/.claude/skills/manage-run /path/to/your/repo/.claude/skills/
```

Then in Claude Code, say things like "use anvil to fix issue #42" and it will invoke the appropriate workflow. The `manage-run` skill lets it inspect and control runs (`anvil workflow runs`/`get`/`approve`...).

---

## Running the Full Platform (Server + Chat Adapters)

The CLI is standalone, but if you also want to interact via Telegram, Slack, Discord, or GitHub webhooks, see the [README Server Setup](https://github.com/conanWinner/Anvil#quickstart) or run the setup wizard by opening Claude Code in the Anvil repo and saying "set up anvil".

---

## Troubleshooting

### "Cannot create worktree: repository registration failed" (stale workspace symlink)

This happens when `~/.anvil/workspaces/<owner>/<repo>/source` is a symlink pointing at a previous checkout (common after moving or renaming the repo). The error message includes the exact cleanup path to follow:

```
Cannot create worktree: repository registration failed.
Error: Source symlink at ~/.anvil/workspaces/<owner>/<repo>/source already points to <old-path>, expected <new-path>
Hint: Remove the stale workspace entry at ~/.anvil/workspaces/<owner>/<repo> and retry, or use --no-worktree to skip isolation.
```

Follow the hint — delete the stale workspace folder and re-run, or pass `--no-worktree` to skip isolation for one run.

> On Anvil versions before this fix, the same root cause surfaced as the misleading "Cannot create worktree: not in a git repository" (even though the repo was valid). If you see that string, upgrade and you'll get the actionable message above.

---

### "command not found: bun"

Install Bun: `curl -fsSL https://bun.sh/install | bash`, then restart your terminal (or `source ~/.bashrc`).

### "command not found: claude"

Install Claude Code CLI: see [docs.claude.com/claude-code/installation](https://docs.claude.com/en/docs/claude-code/installation).

### Port 3090 already in use

Something else is using the port. Either stop it or override:

```bash
PORT=4000 bun run dev
```

### Web UI shows "disconnected"

Make sure the backend is running (`bun run dev` starts both). Check the terminal for errors. Try refreshing the browser.

### Clone command fails with 401/403

Your GitHub token is missing or invalid. Verify:

```bash
# Test your token
curl -H "Authorization: token $(grep GH_TOKEN .env | cut -d= -f2)" https://api.github.com/user
```

If it returns your GitHub profile, the token works. If not, regenerate it.

### AI doesn't respond

Check that Claude authentication is working:

```bash
claude --version   # Should show version
claude /login      # Re-authenticate if needed
```

### "Cannot find module" or dependency errors

```bash
bun install
```

If that doesn't fix it, delete the `node_modules` folder and reinstall:

```bash
bun install
```

---

## Quick Reference

| Action              | Command                             |
| ------------------- | ----------------------------------- |
| Start everything    | `bun run dev`                       |
| Start backend only  | `bun run dev:server`                |
| Start frontend only | `bun run dev:web`                   |
| Run tests           | `bun run test`                      |
| Type check          | `bun run type-check`                |
| Full validation     | `bun run validate`                  |
| Web UI              | http://localhost:5173               |
| API server          | http://localhost:3090               |
| Health check        | `curl http://localhost:3090/health` |

---

## What's Next?

### Add a chat platform (optional)

Want to message Anvil from your phone? Pick one:

| Platform            | Difficulty      | Guide                                                                 |
| ------------------- | --------------- | --------------------------------------------------------------------- |
| **Telegram**        | Easy (5 min)    | [Adapter Setup](/adapters/telegram/) |
| **Discord**         | Easy (5 min)    | [Adapter Setup](/adapters/community/discord/)  |
| **Slack**           | Medium (15 min) | [Adapter Setup](/adapters/slack/)                                 |
| **GitHub Webhooks** | Medium (15 min) | [Adapter Setup](/adapters/github/)   |

### Create custom commands and workflows

Add AI prompts to your repo that Anvil can execute:

```
your-repo/
└── .anvil/
    ├── commands/        # Markdown files with AI instructions
    └── workflows/       # YAML files chaining commands together
```

See [Authoring Workflows](/guides/authoring-workflows/) and [Authoring Commands](/guides/authoring-commands/).

### Deploy to a server

For always-on access from any device, see the [Docker Deployment Guide](/deployment/docker/).

---

## Further Reading

- [Configuration](/getting-started/configuration/) — All configuration options
- [AI Assistants](/getting-started/ai-assistants/) — Claude, Codex, and Pi setup details
- [CLI Reference](/reference/cli/) — Full CLI documentation
- [Authoring Workflows](/guides/authoring-workflows/) — Creating custom workflows
