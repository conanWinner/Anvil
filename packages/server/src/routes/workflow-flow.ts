import type { Dirent } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { join, normalize, sep } from 'path';
import { loadConfig } from '@anvil/core';
import * as codebaseDb from '@anvil/core/db/codebases';
import * as workflowDb from '@anvil/core/db/workflows';
import * as workflowEventDb from '@anvil/core/db/workflow-events';
import { getAnvilHome, resolveRegisteredProjectRoot } from '@anvil/paths';
import { discoverWorkflowsWithConfig } from '@anvil/workflows/workflow-discovery';
import type { DagNode, WorkflowDefinition, WorkflowRun } from '@anvil/workflows/schemas';
import type { ApprovalContext } from '@anvil/workflows/schemas/workflow-run';
import {
  isApprovalNode,
  isActionNode,
  isBashNode,
  isCancelNode,
  isLoopNode,
  isScriptNode,
  isWorkflowNode,
} from '@anvil/workflows/schemas';
import type { WorkflowEventRow } from '@anvil/core/schemas/workflow-event';
import { workflowNodeIoAttemptSchema } from './schemas/workflow.schemas';

export type FlowStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'inconsistent';

export interface FlowUi {
  label?: string;
  phase?: string;
  phaseLabel?: string;
  gate?: string;
}

export interface FlowNodeView {
  nodePath: string;
  runId: string | null;
  nodeId: string;
  label: string;
  kind:
    | 'prompt'
    | 'command'
    | 'bash'
    | 'script'
    | 'approval'
    | 'loop'
    | 'cancel'
    | 'workflow'
    | 'action';
  dependsOn: string[];
  persistedStatus: FlowStatus;
  effectiveStatus: FlowStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  attemptCount: number;
  provider: string | null;
  model: string | null;
  costUsd: number | null;
  inputCount: number;
  outputCount: number;
  declaredInputs: Record<string, unknown>;
  declaredOutputs: Record<string, unknown>;
  artifactCount: number;
  ioAvailable: boolean;
  partialTelemetry: boolean;
  error: string | null;
  childRunId: string | null;
  childWorkflowName: string | null;
  actions: ('continue' | 'approve' | 'reject' | 'resume' | 'cancel' | 'abandon')[];
  transition: { status: 'awaiting_continue' | 'continued'; nextNodeIds: string[] } | null;
  ui: FlowUi;
}

export interface FlowTreeView {
  runId: string | null;
  parentNodePath: string | null;
  workflowName: string;
  persistedStatus: FlowStatus;
  effectiveStatus: FlowStatus;
  ui: FlowUi;
  nodes: FlowNodeView[];
}

export interface FlowInconsistency {
  runId: string;
  nodePath: string | null;
  message: string;
}

interface RunContext {
  run: WorkflowRun;
  artifactsDir: string;
}

interface SnapshotResult {
  definitions: Map<string, WorkflowDefinition>;
  source: 'snapshot' | 'current_definition';
  hash: string | null;
  warning: string | null;
}

function uiView(ui: WorkflowDefinition['ui']): FlowUi {
  return {
    ...(ui?.label !== undefined ? { label: ui.label } : {}),
    ...(ui?.phase !== undefined ? { phase: ui.phase } : {}),
    ...(ui?.phase_label !== undefined ? { phaseLabel: ui.phase_label } : {}),
    ...(ui?.gate !== undefined ? { gate: ui.gate } : {}),
  };
}

function kindOf(node: DagNode): FlowNodeView['kind'] {
  if (isWorkflowNode(node)) return 'workflow';
  if (isActionNode(node)) return 'action';
  if (isBashNode(node)) return 'bash';
  if (isScriptNode(node)) return 'script';
  if (isLoopNode(node)) return 'loop';
  if (isApprovalNode(node)) return 'approval';
  if (isCancelNode(node)) return 'cancel';
  if ('command' in node) return 'command';
  return 'prompt';
}

function previewText(value: string): string {
  return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
}

function definitionInputs(node: DagNode): Record<string, unknown> {
  if (isWorkflowNode(node)) {
    return { inputs: node.workflow.inputs ?? {}, artifacts: node.workflow.artifacts?.inputs ?? {} };
  }
  if (isActionNode(node)) {
    return { executor: node.action.executor, input: node.action.input ?? {} };
  }
  if (isBashNode(node)) return { bash: previewText(node.bash) };
  if (isScriptNode(node))
    return { script: previewText(node.script), runtime: node.runtime, deps: node.deps ?? [] };
  if (isLoopNode(node)) return { loop: node.loop };
  if (isApprovalNode(node)) return { approval: node.approval };
  if (isCancelNode(node)) return { reason: node.cancel };
  if ('command' in node) return { command: node.command };
  return { prompt: previewText(node.prompt) };
}

function definitionOutputs(node: DagNode): Record<string, unknown> {
  return {
    ...(node.output_format !== undefined ? { schema: node.output_format } : {}),
    ...(node.output_type !== undefined ? { type: node.output_type } : {}),
    ...(isWorkflowNode(node) ? { artifacts: node.workflow.artifacts?.outputs ?? {} } : {}),
  };
}

function flowStatus(status: WorkflowRun['status']): FlowStatus {
  return status;
}

function nodeStatus(events: WorkflowEventRow[], nodeId: string): FlowStatus {
  let status: FlowStatus = 'pending';
  for (const event of events) {
    if (event.step_name !== nodeId) continue;
    if (event.event_type === 'node_started') status = 'running';
    else if (event.event_type === 'approval_requested') status = 'paused';
    else if (event.event_type === 'node_completed') status = 'completed';
    else if (event.event_type === 'node_failed') status = 'failed';
    else if (
      event.event_type === 'node_skipped' ||
      event.event_type === 'node_skipped_prior_success'
    ) {
      if (status !== 'completed') status = 'skipped';
    }
  }
  return status;
}

function eventValue(event: WorkflowEventRow | undefined, key: string): unknown {
  return event?.data[key];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const PRIVATE_ARTIFACT_SEGMENTS = new Set(['codex-home', 'pi-home']);

async function countPublicArtifactFiles(root: string): Promise<number> {
  async function walk(dir: string): Promise<number> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    let count = 0;
    for (const entry of entries) {
      if (entry.name.startsWith('.') || PRIVATE_ARTIFACT_SEGMENTS.has(entry.name)) continue;
      if (entry.isDirectory()) count += await walk(join(dir, entry.name));
      else if (entry.isFile()) count += 1;
    }
    return count;
  }
  return walk(root);
}

function terminalReason(events: WorkflowEventRow[]): string | null {
  const terminal = [...events]
    .reverse()
    .find(event =>
      ['workflow_cancelled', 'workflow_failed', 'node_failed'].includes(event.event_type)
    );
  return (
    stringValue(eventValue(terminal, 'reason')) ??
    stringValue(eventValue(terminal, 'error')) ??
    stringValue(eventValue(terminal, 'message'))
  );
}

function actionsFor(status: FlowStatus): FlowNodeView['actions'] {
  if (status === 'paused') return ['approve', 'reject', 'abandon'];
  if (status === 'failed' || status === 'inconsistent') return ['resume', 'abandon'];
  if (status === 'running') return ['cancel', 'abandon'];
  return [];
}

function transitionFor(run: WorkflowRun, nodeId: string): FlowNodeView['transition'] {
  const approval = run.metadata.approval as ApprovalContext | undefined;
  if (
    run.status !== 'paused' ||
    approval?.type !== 'phase_transition' ||
    approval.nodeId !== nodeId
  ) {
    return null;
  }
  const nextNodeIds = Array.isArray(approval.nextNodeIds)
    ? approval.nextNodeIds.filter((value): value is string => typeof value === 'string')
    : [];
  return { status: 'awaiting_continue', nextNodeIds };
}

async function resolveRootArtifactsDir(run: WorkflowRun): Promise<string> {
  const declared = run.metadata.artifacts_dir;
  if (typeof declared === 'string' && declared.length > 0) return declared;
  const codebase = run.codebase_id ? await codebaseDb.getCodebase(run.codebase_id) : null;
  const projectRoot = codebase
    ? resolveRegisteredProjectRoot(codebase.name, codebase.default_cwd)
    : null;
  if (projectRoot) return join(projectRoot, 'artifacts', 'runs', run.id);
  return join(run.working_path ?? '.', '.anvil', 'artifacts', 'runs', run.id);
}

async function discoverCurrentDefinitions(
  run: WorkflowRun
): Promise<Map<string, WorkflowDefinition>> {
  const codebase = run.codebase_id ? await codebaseDb.getCodebase(run.codebase_id) : null;
  const cwd = codebase?.default_cwd ?? run.working_path ?? process.cwd();
  const discovered = await discoverWorkflowsWithConfig(cwd, loadConfig);
  return new Map(discovered.workflows.map(item => [item.workflow.name, item.workflow]));
}

async function loadDefinitions(run: WorkflowRun, artifactsDir: string): Promise<SnapshotResult> {
  const compositionDir = join(artifactsDir, 'composition');
  try {
    const manifestRaw = JSON.parse(
      await readFile(join(compositionDir, 'manifest.json'), 'utf8')
    ) as unknown;
    if (manifestRaw === null || typeof manifestRaw !== 'object' || Array.isArray(manifestRaw)) {
      throw new Error('invalid manifest object');
    }
    const manifest = manifestRaw as Record<string, unknown>;
    if (!Array.isArray(manifest.workflows)) throw new Error('missing workflows');
    const definitions = new Map<string, WorkflowDefinition>();
    let rootHash: string | null = null;
    for (const entry of manifest.workflows) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.name !== 'string' || typeof item.snapshot !== 'string') continue;
      const definition = JSON.parse(
        await readFile(join(compositionDir, item.snapshot), 'utf8')
      ) as WorkflowDefinition;
      definitions.set(item.name, definition);
      if (item.name === run.workflow_name && typeof item.hash === 'string') rootHash = item.hash;
    }
    if (!definitions.has(run.workflow_name)) throw new Error('root workflow snapshot missing');
    return { definitions, source: 'snapshot', hash: rootHash, warning: null };
  } catch {
    const definitions = await discoverCurrentDefinitions(run);
    return {
      definitions,
      source: 'current_definition',
      hash: null,
      warning:
        'This legacy run has no composition snapshot; the graph uses the current workflow definition.',
    };
  }
}

function safeArtifactPath(root: string, relativePath: string): string | null {
  const candidate = normalize(join(root, relativePath));
  const normalizedRoot = normalize(root);
  if (candidate !== normalizedRoot && !candidate.startsWith(normalizedRoot + sep)) return null;
  const anvilHome = normalize(getAnvilHome());
  if (
    candidate !== anvilHome &&
    !candidate.startsWith(anvilHome + sep) &&
    !candidate.startsWith(normalizedRoot + sep)
  ) {
    return null;
  }
  return candidate;
}

async function readIoSummary(
  events: WorkflowEventRow[],
  nodeId: string,
  artifactsDir: string
): Promise<{
  inputCount: number;
  outputCount: number;
  artifactCount: number;
  attemptCount: number;
  available: boolean;
}> {
  const ioEvents = events.filter(
    event => event.step_name === nodeId && event.event_type === 'node_io_recorded'
  );
  let inputCount = 0;
  let outputCount = 0;
  let artifactCount = 0;
  let available = false;
  for (const event of ioEvents) {
    const relativePath = stringValue(event.data.io_manifest_path);
    if (relativePath === null) continue;
    const path = safeArtifactPath(artifactsDir, relativePath);
    if (path === null) continue;
    try {
      const parsed = workflowNodeIoAttemptSchema.safeParse(
        JSON.parse(await readFile(path, 'utf8'))
      );
      if (!parsed.success) continue;
      available = true;
      inputCount = Math.max(
        inputCount,
        Object.keys(parsed.data.declaredInputs).length +
          Object.keys(parsed.data.resolvedInputs).length
      );
      outputCount = Math.max(outputCount, parsed.data.output.preview.length > 0 ? 1 : 0);
      artifactCount = Math.max(
        artifactCount,
        Object.keys(parsed.data.artifacts.inputs).length +
          Object.keys(parsed.data.artifacts.outputs).length
      );
    } catch {
      // Missing/corrupt telemetry is surfaced as partial rather than failing the run view.
    }
  }
  return { inputCount, outputCount, artifactCount, attemptCount: ioEvents.length, available };
}

async function buildRunTree(options: {
  context: RunContext;
  definition: WorkflowDefinition;
  definitions: Map<string, WorkflowDefinition>;
  parentNodePath: string | null;
  workflows: FlowTreeView[];
  inconsistencies: FlowInconsistency[];
  contexts: Map<string, RunContext>;
}): Promise<void> {
  const { context, definition, definitions, parentNodePath, workflows, inconsistencies, contexts } =
    options;
  contexts.set(context.run.id, context);
  const events = await workflowEventDb.listWorkflowEvents(context.run.id);
  const children = await workflowDb.listChildWorkflowRuns(context.run.id);
  const childByNode = new Map(children.map(child => [child.parent_node_id ?? '', child]));
  const nodes: FlowNodeView[] = [];

  for (const node of definition.nodes) {
    const nodePath = `${context.run.id}:${node.id}`;
    const child = childByNode.get(node.id);
    const childEvents = child ? await workflowEventDb.listWorkflowEvents(child.id) : [];
    const started = [...events]
      .reverse()
      .find(event => event.step_name === node.id && event.event_type === 'node_started');
    const terminal = [...events]
      .reverse()
      .find(
        event =>
          event.step_name === node.id &&
          ['node_completed', 'node_failed', 'node_skipped', 'node_skipped_prior_success'].includes(
            event.event_type
          )
      );
    const io = await readIoSummary(events, node.id, context.artifactsDir);
    const persisted = child ? flowStatus(child.status) : nodeStatus(events, node.id);
    let effective = persisted;
    if (child !== undefined) {
      if (
        context.run.status === 'running' &&
        ['failed', 'cancelled', 'paused'].includes(child.status)
      ) {
        effective = 'inconsistent';
        inconsistencies.push({
          runId: context.run.id,
          nodePath,
          message: `Parent is running while child '${child.workflow_name}' is ${child.status}.`,
        });
      }
    }
    const nodeStartedCount = events.filter(
      event => event.step_name === node.id && event.event_type === 'node_started'
    ).length;
    const errorEvent = [...events]
      .reverse()
      .find(event => event.step_name === node.id && event.event_type === 'node_failed');
    const transition = transitionFor(context.run, node.id);
    const childArtifactsDir = child
      ? typeof child.metadata.artifacts_dir === 'string'
        ? child.metadata.artifacts_dir
        : join(context.artifactsDir, 'children', node.id, child.id)
      : null;
    const actualArtifactCount = isWorkflowNode(node)
      ? childArtifactsDir === null
        ? 0
        : await countPublicArtifactFiles(childArtifactsDir)
      : io.artifactCount;
    nodes.push({
      nodePath,
      runId: context.run.id,
      nodeId: node.id,
      label: node.ui?.label ?? node.id,
      kind: kindOf(node),
      dependsOn: node.depends_on ?? [],
      persistedStatus: persisted,
      effectiveStatus: effective,
      startedAt: started?.created_at ?? null,
      completedAt: terminal?.created_at ?? null,
      durationMs: numberValue(eventValue(terminal, 'duration_ms')),
      attemptCount: Math.max(io.attemptCount, nodeStartedCount),
      provider: stringValue(eventValue(started, 'provider')),
      model: stringValue(eventValue(started, 'model')),
      costUsd: numberValue(eventValue(terminal, 'cost_usd')),
      inputCount: io.inputCount,
      outputCount:
        io.outputCount > 0 || stringValue(eventValue(terminal, 'node_output')) !== null ? 1 : 0,
      declaredInputs: definitionInputs(node),
      declaredOutputs: definitionOutputs(node),
      artifactCount: actualArtifactCount,
      ioAvailable: io.available,
      partialTelemetry: !io.available,
      // Preserve failed attempts in the Events tab, but do not keep showing a
      // recovered error after a later retry completed or paused at a valid gate.
      error:
        effective === 'failed' || effective === 'cancelled' || effective === 'inconsistent'
          ? (terminalReason(childEvents) ??
            stringValue(eventValue(errorEvent, 'error')) ??
            (child?.status === 'failed' || child?.status === 'cancelled'
              ? stringValue(child.metadata.error)
              : null))
          : null,
      childRunId: child?.id ?? null,
      childWorkflowName: isWorkflowNode(node) ? node.workflow.name : null,
      actions: transition ? ['continue', 'abandon'] : actionsFor(effective),
      transition,
      ui: uiView(node.ui),
    });

    if (child !== undefined && isWorkflowNode(node)) {
      const childDefinition = definitions.get(child.workflow_name);
      if (childDefinition !== undefined && childArtifactsDir !== null) {
        await buildRunTree({
          context: { run: child, artifactsDir: childArtifactsDir },
          definition: childDefinition,
          definitions,
          parentNodePath: nodePath,
          workflows,
          inconsistencies,
          contexts,
        });
      }
    }
  }

  let effectiveStatus = flowStatus(context.run.status);
  if (nodes.some(node => node.effectiveStatus === 'inconsistent')) effectiveStatus = 'inconsistent';
  workflows.push({
    runId: context.run.id,
    parentNodePath,
    workflowName: definition.name,
    persistedStatus: flowStatus(context.run.status),
    effectiveStatus,
    ui: uiView(definition.ui),
    nodes,
  });
}

export async function buildWorkflowFlow(runId: string): Promise<{
  rootRun: WorkflowRun;
  snapshot: {
    source: 'snapshot' | 'current_definition';
    hash: string | null;
    warning: string | null;
  };
  tree: { rootRunId: string; workflows: FlowTreeView[] };
  inconsistencies: FlowInconsistency[];
  contexts: Map<string, RunContext>;
}> {
  const requested = await workflowDb.getWorkflowRun(runId);
  if (!requested) throw new Error('Workflow run not found');
  const rootRun = (await workflowDb.getRootWorkflowRun(runId)) ?? requested;
  const rootArtifactsDir = await resolveRootArtifactsDir(rootRun);
  const snapshot = await loadDefinitions(rootRun, rootArtifactsDir);
  const rootDefinition = snapshot.definitions.get(rootRun.workflow_name);
  if (!rootDefinition) throw new Error(`Workflow definition not found: ${rootRun.workflow_name}`);
  const workflows: FlowTreeView[] = [];
  const inconsistencies: FlowInconsistency[] = [];
  const contexts = new Map<string, RunContext>();
  await buildRunTree({
    context: { run: rootRun, artifactsDir: rootArtifactsDir },
    definition: rootDefinition,
    definitions: snapshot.definitions,
    parentNodePath: null,
    workflows,
    inconsistencies,
    contexts,
  });
  return {
    rootRun,
    snapshot: { source: snapshot.source, hash: snapshot.hash, warning: snapshot.warning },
    tree: { rootRunId: rootRun.id, workflows },
    inconsistencies,
    contexts,
  };
}

function definitionTree(
  definition: WorkflowDefinition,
  definitions: Map<string, WorkflowDefinition>,
  parentNodePath: string | null,
  workflows: FlowTreeView[],
  ancestors: string[]
): void {
  const nodes: FlowNodeView[] = definition.nodes.map(node => ({
    nodePath: `definition:${definition.name}:${node.id}`,
    runId: null,
    nodeId: node.id,
    label: node.ui?.label ?? node.id,
    kind: kindOf(node),
    dependsOn: node.depends_on ?? [],
    persistedStatus: 'pending',
    effectiveStatus: 'pending',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    attemptCount: 0,
    provider: node.provider ?? definition.provider ?? null,
    model: node.model ?? definition.model ?? null,
    costUsd: null,
    inputCount: isWorkflowNode(node) ? Object.keys(node.workflow.inputs ?? {}).length : 1,
    outputCount: node.output_format === undefined ? 0 : 1,
    declaredInputs: definitionInputs(node),
    declaredOutputs: definitionOutputs(node),
    artifactCount: isWorkflowNode(node)
      ? Object.keys(node.workflow.artifacts?.inputs ?? {}).length +
        Object.keys(node.workflow.artifacts?.outputs ?? {}).length
      : 0,
    ioAvailable: false,
    partialTelemetry: false,
    error: null,
    childRunId: null,
    childWorkflowName: isWorkflowNode(node) ? node.workflow.name : null,
    actions: [],
    transition: null,
    ui: uiView(node.ui),
  }));
  workflows.push({
    runId: null,
    parentNodePath,
    workflowName: definition.name,
    persistedStatus: 'pending',
    effectiveStatus: 'pending',
    ui: uiView(definition.ui),
    nodes,
  });
  for (const node of definition.nodes.filter(isWorkflowNode)) {
    const child = definitions.get(node.workflow.name);
    if (child === undefined || ancestors.includes(child.name)) continue;
    definitionTree(child, definitions, `definition:${definition.name}:${node.id}`, workflows, [
      ...ancestors,
      definition.name,
    ]);
  }
}

export async function buildWorkflowComposition(
  name: string,
  cwd: string
): Promise<{
  rootWorkflow: string;
  workflows: FlowTreeView[];
}> {
  const discovered = await discoverWorkflowsWithConfig(cwd, loadConfig);
  const definitions = new Map(
    discovered.workflows.map(item => [item.workflow.name, item.workflow])
  );
  const root = definitions.get(name);
  if (!root) throw new Error(`Workflow definition not found: ${name}`);
  const workflows: FlowTreeView[] = [];
  definitionTree(root, definitions, null, workflows, []);
  return { rootWorkflow: name, workflows };
}

export async function getWorkflowNodeIo(
  runId: string,
  nodePath: string
): Promise<{
  partialTelemetry: boolean;
  attempts: unknown[];
  events: WorkflowEventRow[];
}> {
  const flow = await buildWorkflowFlow(runId);
  const separator = nodePath.indexOf(':');
  if (separator <= 0) throw new Error('Invalid node path');
  const targetRunId = nodePath.slice(0, separator);
  const nodeId = nodePath.slice(separator + 1);
  const context = flow.contexts.get(targetRunId);
  if (context === undefined || nodeId.length === 0) throw new Error('Node not found in run tree');
  const events = (await workflowEventDb.listWorkflowEvents(targetRunId)).filter(
    event => event.step_name === nodeId
  );
  const attempts = [];
  for (const event of events) {
    if (event.event_type !== 'node_io_recorded') continue;
    const relativePath = stringValue(event.data.io_manifest_path);
    if (relativePath === null) continue;
    const path = safeArtifactPath(context.artifactsDir, relativePath);
    if (path === null) continue;
    try {
      const parsed = workflowNodeIoAttemptSchema.safeParse(
        JSON.parse(await readFile(path, 'utf8'))
      );
      if (parsed.success) attempts.push(parsed.data);
    } catch {
      // Missing/corrupt files are represented by partialTelemetry below.
    }
  }
  if (attempts.length === 0) {
    const completed = [...events].reverse().find(event => event.event_type === 'node_completed');
    const started = events.find(event => event.event_type === 'node_started');
    const output = stringValue(completed?.data.node_output) ?? '';
    if (started !== undefined || completed !== undefined) {
      attempts.push({
        version: 0,
        runId: targetRunId,
        nodeId,
        attempt: 1,
        kind: stringValue(started?.data.type) ?? 'unknown',
        declaredInputs: {},
        resolvedInputs: {},
        output: { value: output, preview: output.slice(0, 4096), truncated: output.length > 4096 },
        artifacts: { inputs: {}, outputs: {} },
        startedAt: started?.created_at ?? completed?.created_at ?? new Date(0).toISOString(),
        ...(completed !== undefined ? { completedAt: completed.created_at } : {}),
      });
    }
  }
  return {
    partialTelemetry: attempts.some(attempt => (attempt as { version: number }).version === 0),
    attempts,
    events,
  };
}
