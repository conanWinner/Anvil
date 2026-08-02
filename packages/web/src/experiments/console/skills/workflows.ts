import { requestJson } from '../lib/http';
import { toWorkflow, type Workflow } from '../primitives/workflow';
import type { WorkflowGraphNode } from '../primitives/workflow-graph';
import type { WireWorkflowDefinition } from '../builder/types';

interface RawNode {
  id: string;
  depends_on?: string[];
  prompt?: string;
  bash?: string;
  command?: string;
  cancel?: string;
  approval?: unknown;
  loop?: unknown;
  script?: unknown;
  workflow?: unknown;
}

interface RawWorkflow {
  name: string;
  description?: string;
  intake?: Workflow['intake'];
  nodes?: RawNode[];
}

interface WorkflowListEntry {
  workflow: RawWorkflow;
  filename?: string;
  source: string;
}

interface WorkflowsResponse {
  workflows: WorkflowListEntry[];
  /** Repo-curated workflow names to pin on top, in declared order (PR #1929). */
  recommended?: string[];
  errors?: unknown[];
}

/** Discovered workflows plus the repo-curated recommended names (declared order). */
export interface WorkflowListResult {
  workflows: Workflow[];
  recommended: string[];
}

export async function listWorkflows(cwd?: string): Promise<WorkflowListResult> {
  const qs = cwd !== undefined ? `?cwd=${encodeURIComponent(cwd)}` : '';
  const res = await requestJson<WorkflowsResponse>(`/api/workflows${qs}`);
  return { workflows: res.workflows.map(toWorkflow), recommended: res.recommended ?? [] };
}

function nodeKind(n: RawNode): WorkflowGraphNode['kind'] {
  if (n.workflow !== undefined) return 'workflow';
  if (n.loop !== undefined) return 'loop';
  if (n.approval !== undefined) return 'approval';
  if (n.cancel !== undefined) return 'cancel';
  if (n.bash !== undefined) return 'bash';
  if (n.command !== undefined) return 'command';
  if (n.script !== undefined) return 'script';
  return 'prompt';
}

/**
 * Get a workflow's DAG structure (nodes + dependencies) for the graph panel.
 *
 * We route through the list endpoint and filter by name rather than calling
 * `/api/workflows/:name` directly because the single-fetch route doesn't
 * recurse into `.anvil/workflows/<subdir>/` while the list route does. Both
 * carry the full DAG, so this trades one extra row of JSON for correctness
 * across subfoldered workflows.
 */
export async function getWorkflowGraph(name: string, cwd?: string): Promise<WorkflowGraphNode[]> {
  const qs = cwd !== undefined ? `?cwd=${encodeURIComponent(cwd)}` : '';
  const res = await requestJson<WorkflowsResponse>(`/api/workflows${qs}`);
  const match = res.workflows.find(w => w.workflow.name === name);
  if (match === undefined) {
    throw new Error(`Workflow not found: ${name}`);
  }
  const nodes = match.workflow.nodes ?? [];
  return nodes.map(
    (n): WorkflowGraphNode => ({
      id: n.id,
      dependsOn: n.depends_on ?? [],
      kind: nodeKind(n),
    })
  );
}

interface GetWorkflowResponse {
  workflow: WireWorkflowDefinition;
  filename: string;
  source: 'project' | 'global' | 'bundled';
}

/** Fetch a single workflow definition by name (for the builder edit flow). */
export async function getWorkflow(name: string, cwd?: string): Promise<GetWorkflowResponse> {
  const qs = cwd !== undefined ? `?cwd=${encodeURIComponent(cwd)}` : '';
  return requestJson<GetWorkflowResponse>(`/api/workflows/${encodeURIComponent(name)}${qs}`);
}

interface SaveWorkflowResponse {
  saved: boolean;
}

/** Save (create or update) a workflow definition to the project's .anvil/workflows/ dir. */
export async function saveWorkflow(
  name: string,
  definition: WireWorkflowDefinition,
  cwd?: string
): Promise<void> {
  const qs = cwd !== undefined ? `?cwd=${encodeURIComponent(cwd)}` : '';
  await requestJson<SaveWorkflowResponse>(`/api/workflows/${encodeURIComponent(name)}${qs}`, {
    method: 'PUT',
    body: JSON.stringify({ definition }),
  });
}
