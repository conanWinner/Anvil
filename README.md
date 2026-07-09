<p align="center">
  <img src="assets/logo.png" alt="Anvil" width="160" />
</p>

<h1 align="center">Anvil</h1>

<p align="center">
  The first open-source harness builder for AI coding. Make AI coding deterministic and repeatable.
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/13964" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13964" alt="conanWinner%2FAnvil | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://github.com/conanWinner/Anvil/actions/workflows/test.yml"><img src="https://github.com/conanWinner/Anvil/actions/workflows/test.yml/badge.svg" alt="CI" /></a>
  <a href="https://anvil.diy/docs/"><img src="https://img.shields.io/badge/docs-anvil.diy-blue" alt="Docs" /></a>
</p>

---

Anvil is a workflow engine for AI coding agents. Define your development processes as YAML workflows - planning, implementation, validation, code review, PR creation - and run them reliably across all your projects.

Like what Dockerfiles did for infrastructure and GitHub Actions did for CI/CD - Anvil does for AI coding workflows. Think n8n, but for software development.

## Why Anvil?

When you ask an AI agent to "fix this bug", what happens depends on the model's mood. It might skip planning. It might forget to run tests. It might write a PR description that ignores your template. Every run is different.

Anvil fixes this. Encode your development process as a workflow. The workflow defines the phases, validation gates, and artifacts. The AI fills in the intelligence at each step, but the structure is deterministic and owned by you.

- **Repeatable** - Same workflow, same sequence, every time. Plan, implement, validate, review, PR.
- **Isolated** - Every workflow run gets its own git worktree. Run 5 fixes in parallel with no conflicts.
- **Fire and forget** - Kick off a workflow, go do other work. Come back to a finished PR with review comments.
- **Composable** - Mix deterministic nodes (bash scripts, tests, git ops) with AI nodes (planning, code generation, review). The AI only runs where it adds value.
- **Portable** - Define workflows once in `.anvil/workflows/`, commit them to your repo. They work the same from CLI, Web UI, Slack, Telegram, or GitHub.

## What It Looks Like

Here's an example of an Anvil workflow that plans, implements in a loop until tests pass, gets your approval, then creates the PR:

```yaml
# .anvil/workflows/build-feature.yaml
nodes:
  - id: plan
    prompt: "Explore the codebase and create an implementation plan"

  - id: implement
    depends_on: [plan]
    loop:                                      # AI loop - iterate until done
      prompt: "Read the plan. Implement the next task. Run validation."
      until: ALL_TASKS_COMPLETE
      fresh_context: true                      # Fresh session each iteration

  - id: run-tests
    depends_on: [implement]
    bash: "bun run validate"                   # Deterministic - no AI

  - id: review
    depends_on: [run-tests]
    prompt: "Review all changes against the plan. Fix any issues."

  - id: approve
    depends_on: [review]
    loop:                                      # Human approval gate
      prompt: "Present the changes for review. Address any feedback."
      until: APPROVED
      interactive: true                        # Pauses and waits for human input

  - id: create-pr
    depends_on: [approve]
    prompt: "Push changes and create a pull request"
```

Tell your coding agent what you want, and Anvil handles the rest:

```
You: Use anvil to add dark mode to the settings page

Agent: I'll run the anvil-idea-to-pr workflow for this.
       → Creating isolated worktree on branch anvil/task-dark-mode...
       → Planning...
       → Implementing (task 1/4)...
       → Implementing (task 2/4)...
       → Tests failing - iterating...
       → Tests passing after 2 iterations
       → Code review complete - 0 issues
       → PR ready: https://github.com/you/project/pull/47
```

## Previous Version

Looking for the original Python-based Anvil (task management + RAG)? It's fully preserved on the [`archive/v1-task-management-rag`](https://github.com/conanWinner/Anvil/tree/archive/v1-task-management-rag) branch.

## Getting Started

> **Most users should start with the [Full Setup](#full-setup-5-minutes)** - it walks you through credentials, installs the Anvil skill into your projects, and gives you the web dashboard.
>
> **Already have Claude Code and just want the CLI?** Jump to the [Quick Install](#quick-install-30-seconds).

### Full Setup (5 minutes)

Clone the repo and use the guided setup wizard. This configures credentials, platform integrations, and copies the Anvil skill into your target projects.

<details>
<summary><b>Prerequisites</b> - Bun, Claude Code, and the GitHub CLI</summary>

**Bun** - [bun.sh](https://bun.sh)

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
irm bun.sh/install.ps1 | iex
```

**GitHub CLI** - [cli.github.com](https://cli.github.com/)

```bash
# macOS
brew install gh

# Windows (via winget)
winget install GitHub.cli

# Linux (Debian/Ubuntu)
sudo apt install gh
```

**Claude Code** - [claude.ai/code](https://claude.ai/code)

```bash
# macOS/Linux/WSL
curl -fsSL https://claude.ai/install.sh | bash

# Windows (PowerShell)
irm https://claude.ai/install.ps1 | iex
```

</details>

```bash
git clone https://github.com/conanWinner/Anvil
cd Anvil
bun install
claude
```

Then say: **"Set up Anvil"**

The setup wizard walks you through everything: CLI installation, authentication, platform selection, and copies the Anvil skill to your target repo.

### Quick Install (30 seconds)

Already have Claude Code set up? Install the standalone CLI binary and skip the wizard.

**macOS / Linux**
```bash
curl -fsSL https://anvil.diy/install | bash
```

**Windows (PowerShell)**
```powershell
irm https://anvil.diy/install.ps1 | iex
```

**Homebrew**
```bash
brew install coleam00/anvil/anvil
```

> **Compiled binaries need a `CLAUDE_BIN_PATH`.** The quick-install binaries
> don't bundle Claude Code. Install it separately, then point Anvil at it:
>
> ```bash
> # macOS / Linux / WSL
> curl -fsSL https://claude.ai/install.sh | bash
> export CLAUDE_BIN_PATH="$HOME/.local/bin/claude"
>
> # Windows (PowerShell)
> irm https://claude.ai/install.ps1 | iex
> $env:CLAUDE_BIN_PATH = "$env:USERPROFILE\.local\bin\claude.exe"
> ```
>
> Or set `assistants.claude.claudeBinaryPath` in `~/.anvil/config.yaml`.
> The Docker image ships Claude Code pre-installed. See [AI Assistants → Binary path configuration](https://anvil.diy/getting-started/ai-assistants/#binary-path-configuration-compiled-binaries-only) for details.

### Start Using Anvil

Once you've completed either setup path, go to your project and start working:

```bash
cd /path/to/your/project
claude
```

```
Use anvil to fix issue #42
```

```
What anvil workflows do I have? When would I use each one?
```

The coding agent handles workflow selection, branch naming, and worktree isolation for you. Projects are registered automatically the first time they're used.

> **Important:** Always run Claude Code from your target repo, not from the Anvil repo. The setup wizard copies the Anvil skill into your project so it works from there.

## Web UI

Anvil includes a web dashboard for chatting with your coding agent, running workflows, and monitoring activity. Binary installs: run `anvil serve` to download and start the web UI in one step. From source: ask your coding agent to run the frontend from the Anvil repo, or run `bun run dev` from the repo root yourself.

Register a project by clicking **+** next to "Project" in the chat sidebar - enter a GitHub URL or local path. Then start a conversation, invoke workflows, and watch progress in real time.

**Key pages:**
- **Chat** - Conversation interface with real-time streaming and tool call visualization
- **Dashboard** - Mission Control for monitoring running workflows, with filterable history by project, status, and date
- **Workflow Builder** - Visual drag-and-drop editor for creating DAG workflows with loop nodes
- **Workflow Execution** - Step-by-step progress view for any running or completed workflow

**Monitoring hub:** The sidebar shows conversations from **all platforms** - not just the web. Workflows kicked off from the CLI, messages from Slack or Telegram, GitHub issue interactions - everything appears in one place.

See the [Web UI Guide](https://anvil.diy/adapters/web/) for full documentation.

## What Can You Automate?

Anvil ships with workflows for common development tasks:

| Workflow | What it does |
|----------|-------------|
| `anvil-assist` | General Q&A, debugging, exploration - full Claude Code agent with all tools |
| `anvil-fix-github-issue` | Classify issue → investigate/plan → implement → validate → PR → smart review → self-fix |
| `anvil-create-issue` | Classify problem → gather context → investigate → create GitHub issue |
| `anvil-issue-review-full` | Comprehensive fix + full multi-agent review pipeline for GitHub issues |
| `anvil-piv-loop` | Guided Plan-Implement-Validate loop with human review between iterations |
| `anvil-idea-to-pr` | Feature idea → plan → implement → validate → PR → 5 parallel reviews → self-fix |
| `anvil-plan-to-pr` | Execute existing plan → implement → validate → PR → review → self-fix |
| `anvil-feature-development` | Implement feature from plan → validate → create PR |
| `anvil-adversarial-dev` | Build a complete application from scratch using adversarial development |
| `anvil-smart-pr-review` | Classify PR complexity → run targeted review agents → synthesize findings |
| `anvil-comprehensive-pr-review` | Multi-agent PR review (5 parallel reviewers) with automatic fixes |
| `anvil-validate-pr` | Thorough PR validation testing both main and feature branches |
| `anvil-architect` | Architectural sweep, complexity reduction, codebase health improvement |
| `anvil-refactor-safely` | Safe refactoring with type-check hooks and behavior verification |
| `anvil-interactive-prd` | Create a PRD through guided conversation |
| `anvil-ralph-dag` | PRD implementation loop - iterate through stories until done |
| `anvil-workflow-builder` | Generate a new Anvil workflow YAML for your project |
| `anvil-remotion-generate` | Generate or modify Remotion video compositions with AI |
| `anvil-resolve-conflicts` | Detect merge conflicts → analyze both sides → resolve → validate → commit |

Anvil ships 19 default workflows - run `anvil workflow list` or describe what you want and the router picks the right one.

**Or define your own.** Default workflows are great starting points - copy one from `.anvil/workflows/defaults/` and customize it. Workflows are YAML files in `.anvil/workflows/`, commands are markdown files in `.anvil/commands/`. Same-named files in your repo override the bundled defaults. Commit them - your whole team runs the same process.

See [Authoring Workflows](https://anvil.diy/guides/authoring-workflows/) and [Authoring Commands](https://anvil.diy/guides/authoring-commands/).

## Add a Platform

The Web UI and CLI work out of the box. Optionally connect a chat platform for remote access:

| Platform | Setup time | Guide |
|----------|-----------|-------|
| **Telegram** | 5 min | [Telegram Guide](https://anvil.diy/adapters/telegram/) |
| **Slack** | 15 min | [Slack Guide](https://anvil.diy/adapters/slack/) |
| **GitHub Webhooks** | 15 min | [GitHub Guide](https://anvil.diy/adapters/github/) |
| **Discord** | 5 min | [Discord Guide](https://anvil.diy/adapters/community/discord/) |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Platform Adapters (Web UI, CLI, Telegram, Slack,       │
│                    Discord, GitHub)                     │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                     Orchestrator                        │
│          (Message Routing & Context Management)         │
└─────────────┬───────────────────────────┬───────────────┘
              │                           │
      ┌───────┴────────┐          ┌───────┴────────┐
      │                │          │                │
      ▼                ▼          ▼                ▼
┌───────────┐  ┌────────────┐  ┌──────────────────────────┐
│  Command  │  │  Workflow  │  │    AI Assistant Clients  │
│  Handler  │  │  Executor  │  │   (Claude / Codex / Pi)  │
│  (Slash)  │  │  (YAML)    │  │                          │
└───────────┘  └────────────┘  └──────────────────────────┘
      │              │                      │
      └──────────────┴──────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│          SQLite / PostgreSQL (14 core tables)           │
│  Codebases • Conversations • Sessions • Workflow Runs   │
│   Isolation Environments • Messages • Workflow Events   │
│    Users • User Identities • Workflow Node Sessions     │
│         Codebase Env Vars • User GitHub Tokens          │
│           User Provider Keys • User AI Prefs            │
│          (+ Better Auth tables, Postgres only)          │
└─────────────────────────────────────────────────────────┘
```

## Documentation

Full documentation is available at **[anvil.diy/docs](https://anvil.diy/docs/)**.

| Topic | Description |
|-------|-------------|
| [Getting Started](https://anvil.diy/getting-started/overview/) | Setup guide (Web UI or CLI) |
| [The Book of Anvil](https://anvil.diy/book/) | 10-chapter narrative tutorial |
| [CLI Reference](https://anvil.diy/reference/cli/) | Full CLI reference |
| [Authoring Workflows](https://anvil.diy/guides/authoring-workflows/) | Create custom YAML workflows |
| [Authoring Commands](https://anvil.diy/guides/authoring-commands/) | Create reusable AI commands |
| [Configuration](https://anvil.diy/reference/configuration/) | All config options, env vars, YAML settings |
| [AI Assistants](https://anvil.diy/getting-started/ai-assistants/) | Claude, Codex, and Pi setup details |
| [Deployment](https://anvil.diy/deployment/) | Docker, VPS, production setup |
| [Architecture](https://anvil.diy/reference/architecture/) | System design and internals |
| [Troubleshooting](https://anvil.diy/reference/troubleshooting/) | Common issues and fixes |

**For AI tools:** Point your LLM at [`/llms.txt`](https://anvil.diy/llms.txt) for an index of all documentation, [`/llms-full.txt`](https://anvil.diy/llms-full.txt) for the complete docs in a single file, or [`/llms-small.txt`](https://anvil.diy/llms-small.txt) for a condensed version.

## Telemetry

Anvil sends a few anonymous events so maintainers can see which workflows get real usage, on what platforms, and whether runs succeed — and prioritize accordingly. **No PII, ever.** Events: `anvil_started` (once per CLI invocation / server boot), `anvil_active` (daily heartbeat while a server is running, so long-running installs stay counted), `chat_turn_handled` (each direct AI chat turn — platform, provider, model, duration, and usage totals; never message content), `workflow_invoked` (each workflow start), `workflow_completed` / `workflow_failed` (each run outcome), `workflow_approval_resolved` (each human approve/reject decision — the binary resolution only, never comments or reasons), and `codebase_registered` (a pure count when a project is registered — no name, path, or URL).

**What's collected (categorical only):**
- **Workflow name** — the real name for *bundled* (Anvil-authored) workflows; `"custom"` for your own workflows, so private names never leave your machine.
- **Run shape & outcome** — platform (`cli`/`web`/`slack`/…), provider id (plus the model id on `workflow_invoked`), node count, which node types and features are used (loop/approval/script/bash, structured output, persisted sessions, MCP, skills, fresh-context loops), success/failure, duration, a categorical failure reason, and a fixed-enum failure class (`fatal`/`transient`/`unknown` — never raw error text) plus the failed node's type.
- **Chat activity** — one event per direct-chat AI turn with platform, provider, model, duration, and completed/failed. Message content, prompts, and conversation ids are never sent.
- **Aggregate usage** — provider-reported token counts and cost (USD) per workflow run and chat turn, plus total loop iterations per run. Numeric totals only — never the content the tokens represent.
- **Machine context** — OS, architecture, Anvil version, runtime, whether it's a binary build, and a CI flag.
- **Deployment shape** (server only) — which adapters are enabled (booleans), database kind (`sqlite`/`postgresql`), whether web auth and multi-user mode are on, and the GitHub auth mode. Configuration *values* (tokens, URLs, hosts) are never sent.
- A random install UUID stored at `~/.anvil/telemetry-id`. Nothing else.

**What's *not* collected:** your code, prompts, messages, custom workflow names, workflow descriptions, git remotes, file paths, usernames, tokens, AI output, error message text, your IP address, your geographic location — none of it.

**Opt out:** set any of these in your environment:

```bash
ANVIL_TELEMETRY_DISABLED=1
DO_NOT_TRACK=1        # de facto standard honored by Astro, Bun, Prisma, Nuxt, etc.
POSTHOG_API_KEY=off   # off | 0 | false | disabled | "" all disable
```

CI environments (`CI=true`) are auto-disabled — forks running fixtures in GitHub Actions, CircleCI, etc. do not send events.

**Check the current state:** run `anvil telemetry status` to see whether telemetry is enabled, why (if not), the install UUID, and the active host. Run `anvil telemetry reset` to rotate the install UUID. `anvil doctor` also surfaces the current state in its check list.

Self-host PostHog or use a different project by setting `POSTHOG_API_KEY` and `POSTHOG_HOST`.

## Contributing

Contributions welcome! See the open [issues](https://github.com/conanWinner/Anvil/issues) for things to work on.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=conanWinner/Anvil&type=date&legend=top-left)](https://www.star-history.com/?repos=conanWinner%2FAnvil&type=date&legend=top-left)

## License

[MIT](LICENSE)
