# Anvil Agent Instructions

## Scope and Instruction Priority

- These instructions apply to the Anvil repository.
- Follow higher-priority global and user instructions first.
- Start with read-only inspection. Preserve unrelated and pre-existing worktree changes.
- Treat live code, tests, schemas, and Git state as evidence of current behavior. Documentation may describe target design and is not proof of implementation.
- Keep changes scoped, reversible, and proportionate to the request. Do not publish, merge, or mutate external systems unless the user authorizes it.

## Data Safety

- Never delete files, directories, databases, volumes, branches, worktrees, untracked data, or history without explicit permission in the current conversation.
- General requests such as “clean up”, “redo”, “fix”, or “sync” are not deletion permission.
- Before an authorized deletion, resolve the exact target and explain the affected data.
- Never format, reformat, repartition, recreate a filesystem, secure-erase, factory-reset, or wipe a storage device.
- Never use git clean -fd. Do not bypass these rules through scripts, containers, agents, GUIs, or remote tools.
- If an operation may overwrite or destroy data and its effect is uncertain, stop and ask. Prefer read-only and recoverable operations.

## Product Context and Required Names

**Anvil** is the complete product and platform. It controls AI coding assistants from Web, CLI, Slack, Telegram, GitHub, and other adapters. The repository uses Bun, TypeScript, and SQLite/PostgreSQL.

Anvil is a single-developer tool. Do not introduce multi-tenant complexity without an accepted requirement.

**System 3** is Anvil’s project-lifecycle domain. It is not the product name and is not the generic workflow engine.

Use these names consistently:

- **Anvil**: complete product, platform, repository, UI, CLI, and shared runtime.
- **System 3**: project-lifecycle domain.
- **System 3 Control Plane**: project state, versions, decisions, readiness, invalidation, approval, evidence projection, and delivery semantics.
- **Anvil Workflow Runtime**: reusable workflow engine in packages/workflows.
- **Project Lifecycle**: full journey from Intake to Delivery; never call the whole journey a workflow.
- **Lifecycle Phase**: one of the 6 user-visible stages.
- **Lifecycle Activity**: one of the 10 activities within those stages.
- **Control-plane Operation (OP-\*)**: deterministic backend operation; it does not create a Workflow Run by default.
- **Technical Workflow (TW-\*)**: DAG executed by the Anvil Workflow Runtime.
- **Workflow Run** and **Workflow Node**: one Technical Workflow execution and one step within it.
- **Product Workflow Template** and **Project Workflow Version**: reusable domain process and its immutable project-bound application.
- **Workflow Compilation**: deterministic creation of an Execution Plan; compilation is not approval.
- **Execution Plan**: pinned technical plan for exact inputs, definitions, capabilities, permissions, and order.
- **Source Version**, **Input Snapshot**, and **Knowledge Snapshot** are immutable and provenance-preserving.
- **Decision** is an explicit question for an authorized actor; it is not an LLM response.
- **Readiness Contract** evaluates gates and missing inputs.
- **Approval Manifest** records exactly what an actor approved.
- **Artifact** is a generated result; **Evidence** validates a requirement or result.
- **Provider Session** and **Worktree / Isolation** are runtime state and environment, not project truth or approval state.

Do not introduce “System 3”, “Archon”, or “Remote Agentic Coding Platform” as the product name in new user-facing copy.
Do not expose legacy identifiers such as productWorkflowVersionId as new user-facing terminology; the canonical term is Project Workflow Version.

## System 3 Documentation Routing

For System 3 architecture, lifecycle, UI, API, sources, artifacts, Evidence, or delivery, read in this order:

1. docs/README.md
2. docs/1. Tổng quan hệ thống.md
3. docs/lifecycle_activity/README.md and the relevant activity document
4. docs/technical/README.md and the relevant technical document
5. docs/system_2/DESIGN_B_2.md only when a concrete System 2 example is needed

The current plan, progress and verification record is `docs/technical/13-experiment-execution-plan.md` (experiment mode: builder + reviewer agents, sandboxed variant runs, Anvil-owned scoring, the user chooses the variant).

When adding, moving, or renaming documentation, update the documentation maps and inbound links.

## Canonical Project Lifecycle

Render exactly 6 Lifecycle Phases and reveal exactly these 10 Lifecycle Activities:

| Lifecycle Phase | Canonical Lifecycle Activity           | Vietnamese UI label        | Current implementation                     |
| --------------- | -------------------------------------- | -------------------------- | ------------------------------------------ |
| Intake          | OP-00 Source Intake                    | Tiếp nhận nguồn đầu vào    | Control-plane operation                    |
| Intake          | OP-01 Change Detection                 | Phát hiện thay đổi         | Control-plane operation                    |
| Understanding   | TW-02 Understand Project               | Hiểu dự án                 | system3-understand-project                 |
| Readiness       | TW-03 Readiness                        | Kiểm tra mức độ sẵn sàng   | system3-readiness-contract                 |
| Readiness       | OP-04 Compile                          | Chuẩn bị kế hoạch thực thi | Produces an Execution Plan                 |
| Readiness       | OP-05 Approve                          | Phê duyệt kế hoạch         | Records an Approval Manifest               |
| Build           | TW-06 Execute Project Workflow Version | Thực thi kế hoạch đã duyệt | Orchestrates baseline build and experiment |
| Verify          | TW-07 Verify                           | Xác minh kết quả độc lập   | system3-verify                             |
| Delivery        | OP-08 Delivery Request                 | Yêu cầu bàn giao           | Validates the delivery gate                |
| Delivery        | TW-09 Deliver                          | Tạo gói bàn giao           | system3-delivery                           |

TW-06A Build and TW-06B Data & Experiment are child Technical Workflows, not additional Lifecycle Activities. Legacy sections such as data, features, experiments, and explainability are not extra phases.

## System 3 Architecture and Product Guardrails

Preserve this boundary:

**Anvil Product UI → Anvil Backend API → System 3 Control Plane → Workflow Compiler → Anvil Workflow Runtime → Storage / Artifact / Evidence**

- System 3 owns project and source semantics, versioned knowledge, Product Workflow Templates, Project Workflow Versions, Decisions, readiness, invalidation, compilation, approval, evidence projection, and delivery.
- The Anvil Workflow Runtime owns generic DAG execution, Technical Workflow definitions, Workflow Runs, Workflow Nodes, provider sessions, retry/timeout, events/logs, worktree isolation, and generic artifact storage.
- Keep Customer Churn, dataset, target, SHAP, readiness, and experiment policy out of packages/workflows.
- Preserve immutable versions and provenance. Persist an Input Snapshot before execution; never resolve an unpinned “latest file” during a run.
- A missing dataset during Understanding is valid. Distinguish a System 2 Dataset Declaration from a real Dataset Profile; Readiness must return data_required before data-dependent work.
- A workflow-level provider field is metadata, not proof of an LLM call. Verify the active execution path before describing provider behavior.
- `OP-*` activities are not Workflow Runs. Node and run views apply only to `TW-*` activities.
- Do not autonomously mark non-terminal cross-process work failed, cancelled, or abandoned from a timer or staleness guess. Surface ambiguity and require user action.

## System 3 Lifecycle UI Guardrails

- Derive the UI projection in packages/web/src/features/system3/lifecycle-view.ts and keep legacy backend phase identifiers behind that boundary.
- Use one navigation axis: all activities grouped beneath the 6 phases, with one selected-activity workspace. Make the rail horizontally scrollable on compact screens.
- Keep project context compact. Put status and the next action near the activity title; avoid redundant hero, cards, tabs, and summaries.
- Every activity must show what Anvil does, pinned inputs, outputs, Evidence, blockers, and the next user action.
- Inputs, Outputs, and Evidence must be directly scannable together. Put history, nodes, logs, raw data, hashes, and storage metadata behind progressive disclosure.
- Every resource must open inline without changing route, selected activity, scroll position, or browser tab.
- Use a typed, friendly-first Artifact Presentation Layer. Raw JSON must never be the primary view or automatic renderer fallback.
- Unsupported renderers must show a friendly state with provenance, metadata, and safe download. Optional LLM summaries are labeled non-authoritative.
- Decisions, snapshots, contracts, plans, manifests, approvals, and Evidence retain their domain names; do not label every result an Artifact.
- Treat the Sources route as the OP-00 detail surface. Show the Intake Gate and report history; never synthesize missing legacy provenance.
- Use the canonical blue–cyan–teal application tokens from packages/web/src/index.css. Do not introduce a System 3-specific purple palette.
- Motion must communicate state, remain subtle, and respect prefers-reduced-motion. Status cannot depend on color or motion alone.
- Test the canonical counts, navigation, OP-00 legacy state, inline viewing, friendly/raw views, responsive layout, focus restoration, and keyboard access.
- Before completion, inspect a rendered project with real activity data at desktop and compact widths.

## Two-Stage Astra-to-Sol Workflow

Apply this section only when the user explicitly requests this workflow. It does not itself authorize sub-agents or external writes.

### Planning tab

- Use Astra only for the initial analysis and planning pass.
- Astra produces a durable, self-contained Execution Brief and does not implement or supervise after handoff.
- The brief must include objective, scope, out-of-scope, verified current state, assumptions, decisions, ordered tasks, dependencies, affected areas, acceptance criteria, validation commands, risks, rollback, and repository baseline.
- Separate verified facts from target design and inference.

### Execution tab

- Start a new tab with Sol at medium reasoning effort as the primary coordinator and implementer.
- Sol reads the complete brief, inspects the live repository, and reports material drift before editing.
- Sol may refine implementation details based on code, but must report material scope or architecture changes.
- Do not invoke Astra again unless the user explicitly authorizes it in the current conversation.
- Sol reviews all delegated output against the repository and tests before accepting it.

### Model routing

- Use the least expensive model and lowest reasoning effort that can reliably complete the task.
- Luna low/medium: bounded discovery, inventory, mechanical checks, and repetitive verification.
- Terra medium: well-scoped code, tests, and refactors with clear acceptance criteria.
- Sol medium: default coordination and implementation.
- Sol high: substantial cross-package coupling, concurrency, migrations, security-sensitive logic, hard debugging, or ambiguous failures.
- Sol xhigh: only after high is insufficient or for a concrete high-risk decision.
- Never select max or ultra automatically; they require explicit current-conversation authorization.
- Never use Astra as an execution fallback. Preserve failure evidence, retry safely with an appropriate Sol effort, or ask the user.
- When delegation is authorized, give each subtask a narrow objective, context, constraints, expected output, and acceptance criteria. Parallelize only independent, non-overlapping work.

### Notion, Linear, and Git

- Notion holds durable planning context and human-readable decisions.
- Linear holds executable tasks, dependencies, status, blockers, and per-task Evidence.
- Git and the repository remain the technical source of truth.
- Link Linear issues to the relevant Notion sections instead of duplicating the full plan.
- Version the Execution Brief with its planning date and repository baseline; record material decision changes explicitly.
- Write to Notion or Linear only when the user authorizes those external mutations for the current task.
- A document, task status, or agent report is never proof that code works; validate the live repository.

## Engineering Principles

- Prefer simple, explicit, typed control flow over speculative abstractions.
- Apply YAGNI. Do not add configuration, flags, interfaces, or fallback paths without a current caller.
- Apply the Rule of Three before extracting shared utilities; preserve package boundaries.
- Keep interfaces narrow and modules single-purpose. Separate policy, transport, persistence, and execution.
- Fail fast with actionable errors. Never silently swallow failures, broaden permissions, or invent partial support.
- Keep tests deterministic and network-independent unless explicit guardrails exist.
- Keep changes easy to review and revert. Define rollback before risky changes.
- Every handoff reports completed work, remaining work, changed resources, validation, blockers, and next action.

## TypeScript, Zod, and OpenAPI

- Strict TypeScript is mandatory. Add complete function annotations and do not use any without a documented justification.
- Use z.infer<typeof schema>; never maintain a parallel hand-written type.
- Import z from @hono/zod-openapi. The only current exception is the SDK-only Zod shape in packages/providers/src/claude/native-tools.ts, which imports from zod.
- Use explicit record keys: z.record(z.string(), valueSchema).
- Core row schemas belong in packages/core/src/schemas; route schemas in packages/server/src/routes/schemas; engine schemas in packages/workflows/src/schemas.
- New or modified JSON API routes use registerOpenApiRoute(createRoute(...), handler).
- Raw wildcard non-JSON routes may use app.get with an explanatory comment.
- Multipart-or-JSON routes remain registered but omit request.body from the OpenAPI route config and parse both forms manually.
- Derive constants such as TRIGGER_RULES and WORKFLOW_HOOK_EVENTS from schema options. The web package may keep a local runtime constant because generated API declarations are type-only.
- loader.ts validates nodes with dagNodeSchema.safeParse(); graph cycles, dependencies, and node-output references remain imperative checks.
- The web package must derive server contracts from packages/web/src/lib/api.generated.d.ts and local API re-exports; never import server runtime packages into the browser bundle.

## Package Boundaries

- packages/system3: System 3 domain and control-plane behavior.
- packages/workflows: generic Workflow Runtime; database, AI, and configuration enter through narrow dependencies.
- packages/providers: provider contracts, registry, and SDK integrations.
- packages/core: shared business logic, persistence adapters, and orchestration.
- packages/git and packages/isolation: Git operations and worktree isolation.
- packages/adapters: Slack, Telegram, GitHub, Discord, and other platform adapters implementing IPlatformAdapter.
- packages/server: HTTP, OpenAPI routes, auth boundaries, and Web adapter.
- packages/web: React client and generated API types.
- packages/cli: command-line interface.
- packages/paths: path and logging primitives with minimal dependencies.

Use typed named imports and import type for type-only imports. Avoid broad main-package namespace imports. Use direct package subpaths where the public contract requires them.

## Git and Release Rules

- main is the release branch. Never commit directly to main.
- dev is the working branch. Feature work branches from dev and merges back into dev.
- Preserve existing worktree changes and surface Git conflicts or dirty-state blockers.
- Use @anvil/git for Git operations; if direct Git execution is necessary, use execFileAsync rather than exec.
- Trust Git guardrails. Never force cleanup of uncommitted work or untracked files.
- All pull requests use .github/PULL_REQUEST_TEMPLATE.md and fill every section. Link the issue with Closes, Fixes, or Resolves.
- Use the release skill to merge dev toward main. Follow Semantic Versioning and update the root package.json version plus CHANGELOG.md.

## Validation and Generated Files

Use the smallest relevant check while iterating, then the required gate for the requested outcome.

```bash
bun run type-check
bun run lint
bun run format:check
bun run test
bun run validate
```

- Never run bun test from the repository root. It combines packages in one process and causes mock.module cache pollution. Use bun run test for isolated package runs; a targeted test file is allowed.
- CI allows no ESLint warnings. Fix warnings instead of broadly disabling rules.
- Inline ESLint disables are exceptional and must document an external type defect or a validated assertion. Never add file-level disables.
- Run bun run validate before creating a pull request. It checks bundled assets/schema, types, lint, formatting, and tests.
- If ESLint reaches the heap limit, rerun it with NODE_OPTIONS=--max-old-space-size=4096 and then fix actual errors.
- After changing bundled default workflows or commands, run bun run generate:bundled.
- After changing migrations/000_combined.sql, run bun run generate:bundled-schema.
- The authoritative PostgreSQL schema is migrations/000_combined.sql; keep the generated SQLite schema synchronized.
- Regenerating Web API types requires the server on port 3090, then bun --filter @anvil/web generate:types.

## Development Commands

```bash
bun run dev
bun run dev:server
bun run dev:web
bun run cli doctor
bun run cli validate workflows
bun run cli validate commands
```

SQLite is the default without DATABASE_URL. PostgreSQL is selected when DATABASE_URL is set and converges through the combined migration on startup. Consult package.json scripts and CLI help for the current command catalog instead of duplicating it here.

## Security and Reliability

- Never log or expose API keys, tokens, credentials, message content, or PII. Mask identifiers when logging unauthorized access.
- Verify GitHub webhook signatures against the raw request body.
- Keep credential-serving internal endpoints loopback-only unless the documented reverse-proxy protection is explicitly enabled.
- Authentication and authorization checks belong at the owning boundary; never silently broaden access.
- Log structured start, completion, and failure events with relevant IDs and durations. Preserve raw error detail in logs and return actionable classified errors to users.
- Use retries only for recoverable operations. Do not convert ambiguous ownership or non-terminal state into destructive lifecycle mutation.

## Task-to-Documentation Routing

- System 3 lifecycle or product behavior: follow “System 3 Documentation Routing” above.
- System 3 lifecycle UI: also read docs/technical/07-system3-lifecycle-ui.md.
- Repository setup, contribution, or command usage: read README.md, CONTRIBUTING.md, package.json scripts, and relevant package README files.
- Public documentation changes: inspect packages/docs-web and its local guidance.
- Workflow definitions or execution: inspect packages/workflows schemas, loader, validator, and the relevant tests.
- API changes: inspect packages/server/src/routes/schemas, route registration, generated OpenAPI output, and Web API types.
- Persistence changes: inspect migrations/000_combined.sql, SQLite generation, adapter implementations, and parity tests.
- Provider changes: inspect packages/providers contracts, capability registry, provider parser, and provider-specific tests.
- UI changes: inspect the rendered page at relevant desktop and compact widths; types and DOM assertions alone are insufficient.

Do not preload every referenced document. Read only the route required by the current task, but read required instruction files completely.
