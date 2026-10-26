---
title: Getting Started
description: Start the Web UI or CLI, then open the reference for the feature you need.
category: getting-started
audience: [user]
status: current
sidebar:
  order: 0
---

Anvil controls AI coding assistants through a shared runtime. This site documents the CLI, YAML workflows, providers, and adapters. For the repository's current multi-LLM project flow and development status, start with the [repository README](https://github.com/conanWinner/Anvil/blob/dev/README.md).

## Prerequisites

- Git and [Bun 1.3+](https://bun.sh) for running from source.
- At least one [configured AI assistant](/getting-started/ai-assistants/). Install and authenticate the provider you use; Claude Code is required only for the Claude path.
- A GitHub token only when the feature needs it, such as cloning a private GitHub repository or creating a PR.

Claude Code's permission-bypass mode cannot run as root; use a regular user for that path. Multi-LLM generated-code execution has separate Linux sandbox requirements documented in the repository.

## Start the Web UI from source

```bash
git clone https://github.com/conanWinner/Anvil
cd Anvil
bun install
```

Configure your provider before sending AI requests. Keep credentials in the process environment or Anvil-owned `~/.anvil/.env` / `<repo>/.anvil/.env`; a target repository's root `.env` is stripped at boot. See [configuration and environment file locations](/reference/configuration/#env-file-locations).

Run these in separate terminals from the Anvil repository:

```bash
# API: http://localhost:3090
HOST=127.0.0.1 bun run dev:server

# Web: http://localhost:5173
bun run dev:web
```

SQLite is the default; PostgreSQL is optional. Open **http://localhost:5173** for the console, or **http://localhost:5173/console/projects** for the project-lifecycle workspace. Use an SSH tunnel when accessing a VPS; see [deployment](/deployment/) for a persistent setup.

## Use the CLI

For binary installs, follow [Installation](/getting-started/installation/), then [Quick Start](/getting-started/quick-start/).

From a source checkout, inspect the available commands without a global install:

```bash
bun run cli doctor
bun run cli workflow list
```

The [CLI reference](/reference/cli/) covers running against a target Git repository, isolation, approvals, and recovery. Install the Anvil skill with `anvil skill install /path/to/your/repo` if you want your coding assistant to invoke Anvil from that repository.

## Available Workflows

Use `anvil workflow list` for the definitions installed in your environment. The [bundled workflow catalog](/guides/#bundled-workflows) lists the defaults; repository-local definitions can override them. You do not need the Workflow Builder or a chat adapter to start.

## Read next

| Need                                            | Guide                                               |
| ----------------------------------------------- | --------------------------------------------------- |
| Provider authentication and model configuration | [AI Assistants](/getting-started/ai-assistants/)    |
| Settings and environment variables              | [Configuration](/reference/configuration/)          |
| Write a YAML workflow                           | [Authoring Workflows](/guides/authoring-workflows/) |
| Understand isolation                            | [Core Concepts](/getting-started/concepts/)         |
| Connect Slack, Telegram, or GitHub              | [Adapters](/adapters/)                              |
| Diagnose a failure                              | [Troubleshooting](/reference/troubleshooting/)      |

Telemetry can be disabled with `ANVIL_TELEMETRY_DISABLED=1`; see [what is collected](/reference/security/#anonymous-telemetry).
