---
title: Project Flow
description: Inspect workflow definitions and exact project execution state, including child workflows and node I/O.
category: guides
area: workflows
audience: [user]
status: current
sidebar:
  order: 2
---

Project Flow is the execution map for a project. Open the **FLOW** tab to inspect either the latest root run or a workflow definition before it has run.

## Run and Definition modes

- **Run** uses the workflow snapshot captured when execution started. The run selector contains root runs only.
- **Definition** resolves the current workflow using project, global, then bundled precedence.
- Legacy runs without a snapshot or node I/O remain visible with a partial telemetry warning.

Child workflows are collapsed initially. Expand a workflow block to see its child run and atomic nodes. The URL preserves the selected run and node, so a block can be deep-linked.

## Status semantics

Flow uses `pending`, `running`, `paused`, `completed`, `failed`, `skipped`, `cancelled`, and `inconsistent`. A waiting approval pauses its child and ancestors. If persisted parent and child states disagree, Flow reports `inconsistent` without changing historical data.

Readiness values such as `passed`, `conditional_pass`, `blocked`, and `not_evaluated` are gate badges, not workflow statuses.

## Node I/O manifest

Each completed node attempt writes:

```text
<run-artifacts>/execution/nodes/<node-id>/attempts/<attempt>/io.json
```

The versioned manifest retains typed declared/resolved inputs, output preview, artifact mappings, timing, node kind, and attempt number. Large output is stored separately and linked from the manifest. The recorder does not read or persist environment credentials or provider tokens.

The graph endpoint returns summaries only. Opening the inspector lazily requests full node I/O:

```text
GET /api/workflows/runs/:runId/flow
GET /api/workflows/runs/:runId/nodes/:nodePath/io
GET /api/workflows/:name/composition?cwd=<project-cwd>
```

Valid approval, rejection, resume, cancel, and abandon actions are sent with the root run ID. The backend resolves the active child leaf before applying the action.
