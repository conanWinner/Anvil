---
title: Guides
description: How-to guides for authoring workflows, commands, and configuring node features in Anvil.
category: guides
area: workflows
audience: [user]
status: current
sidebar:
  order: 0
---

How-to guides for building and running AI coding workflows with Anvil.

## Workflow Authoring

- [Authoring Workflows](/guides/authoring-workflows/) — Create multi-step YAML workflows with DAG nodes, conditional branching, and parallel execution
- [Authoring Commands](/guides/authoring-commands/) — Write prompt templates that serve as building blocks for workflow nodes

## Node Types

- [Loop Nodes](/guides/loop-nodes/) — Iterative AI execution with completion conditions and deterministic exit checks
- [Approval Nodes](/guides/approval-nodes/) — Human review gates with optional AI rework on rejection
- [Script Nodes](/guides/script-nodes/) — TypeScript/JavaScript (bun) or Python (uv) as a deterministic DAG node, without AI

## Node Features (Claude only)

- [Per-Node Hooks](/guides/hooks/) — Attach Claude SDK hooks for tool control, context injection, and input modification
- [Per-Node MCP Servers](/guides/mcp-servers/) — Connect external tools (GitHub, Postgres, etc.) to individual nodes
- [Per-Node Skills](/guides/skills/) — Preload specialized knowledge into node agents

## Bundled Workflows

Anvil ships with ready-to-use workflows that cover common coding tasks. You do not need to write any YAML to use these -- just describe what you want and the router picks the right one.

| Workflow | What It Does |
|----------|-------------|
| `anvil-assist` | General Q&A, debugging, exploration -- the catch-all |
| `anvil-fix-github-issue` | Investigate, root cause, implement fix, validate, PR |
| `anvil-create-issue` | Investigate a problem and create a GitHub issue |
| `anvil-issue-review-full` | Comprehensive fix + full multi-agent review for GitHub issues |
| `anvil-piv-loop` | Guided Plan-Implement-Validate with human-in-the-loop |
| `anvil-idea-to-pr` | Feature idea, plan, implement, validate, PR, parallel reviews |
| `anvil-plan-to-pr` | Execute existing plan, implement, validate, PR, review |
| `anvil-feature-development` | Implement feature from plan, validate, create PR |
| `anvil-adversarial-dev` | Build a complete application from scratch using adversarial development |
| `anvil-smart-pr-review` | Complexity-adaptive PR review |
| `anvil-comprehensive-pr-review` | Multi-agent PR review (5 parallel reviewers) |
| `anvil-validate-pr` | Thorough PR validation testing |
| `anvil-architect` | Architectural sweep, complexity reduction, codebase health |
| `anvil-refactor-safely` | Safe refactoring with type-check hooks and behavior verification |
| `anvil-interactive-prd` | Create a PRD through guided conversation |
| `anvil-ralph-dag` | PRD implementation loop (iterate through stories until done) |
| `anvil-workflow-builder` | Generate a new Anvil workflow YAML for your project |
| `anvil-remotion-generate` | Generate or modify Remotion video compositions with AI |
| `anvil-resolve-conflicts` | Detect and resolve merge conflicts in PRs |

Run `anvil workflow list` to inspect the workflows installed in your environment, including repository-local overrides.

To customize any bundled workflow, copy it from `.anvil/workflows/defaults/` into your project's `.anvil/workflows/` and modify it -- same-named files override the defaults.

## Advanced

- [Global Workflows](/guides/global-workflows/) — User-level workflows that apply to every project
- [Remotion Video Generation](/guides/remotion-workflow/) — End-to-end video creation with skills and bash render nodes
