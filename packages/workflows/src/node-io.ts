import { mkdir, readdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { DagNode, NodeOutput } from './schemas';
import {
  isApprovalNode,
  isBashNode,
  isCancelNode,
  isLoopNode,
  isScriptNode,
  isWorkflowNode,
} from './schemas';

const OUTPUT_PREVIEW_LIMIT = 4096;

export interface NodeIoManifest {
  version: 1;
  runId: string;
  nodeId: string;
  attempt: number;
  kind: string;
  declaredInputs: Record<string, unknown>;
  resolvedInputs: Record<string, unknown>;
  output: {
    value?: unknown;
    preview: string;
    truncated: boolean;
    artifactPath?: string;
  };
  artifacts: {
    inputs: Record<string, string>;
    outputs: Record<string, string>;
  };
  startedAt: string;
  completedAt?: string;
}

function nodeKind(node: DagNode): string {
  if (isWorkflowNode(node)) return 'workflow';
  if (isBashNode(node)) return 'bash';
  if (isScriptNode(node)) return 'script';
  if (isLoopNode(node)) return 'loop';
  if (isApprovalNode(node)) return 'approval';
  if (isCancelNode(node)) return 'cancel';
  if ('command' in node) return 'command';
  return 'prompt';
}

function declaredInputs(node: DagNode): Record<string, unknown> {
  if (isWorkflowNode(node)) {
    return {
      inputs: node.workflow.inputs ?? {},
      artifactInputs: node.workflow.artifacts?.inputs ?? {},
    };
  }
  if (isBashNode(node)) return { bash: node.bash };
  if (isScriptNode(node))
    return { script: node.script, runtime: node.runtime, deps: node.deps ?? [] };
  if (isLoopNode(node)) return { loop: node.loop };
  if (isApprovalNode(node)) return { approval: node.approval };
  if (isCancelNode(node)) return { reason: node.cancel };
  if ('command' in node) return { command: node.command };
  return { prompt: node.prompt };
}

function parseOutputValue(output: NodeOutput): unknown {
  if ('structuredOutput' in output && output.structuredOutput !== undefined) {
    return output.structuredOutput;
  }
  try {
    return JSON.parse(output.output) as unknown;
  } catch {
    return output.output;
  }
}

function artifactOutputs(output: NodeOutput): Record<string, string> {
  if (!('structuredOutput' in output)) return {};
  const structured = output.structuredOutput;
  if (structured === null || typeof structured !== 'object' || Array.isArray(structured)) return {};
  const artifacts = (structured as Record<string, unknown>).artifacts;
  if (artifacts === null || typeof artifacts !== 'object' || Array.isArray(artifacts)) return {};
  return Object.fromEntries(
    Object.entries(artifacts).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

async function nextAttempt(nodeDir: string): Promise<number> {
  try {
    const entries = await readdir(join(nodeDir, 'attempts'), { withFileTypes: true });
    const attempts = entries
      .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map(entry => Number(entry.name));
    return attempts.length === 0 ? 1 : Math.max(...attempts) + 1;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 1;
    throw error;
  }
}

export async function writeNodeIoManifest(options: {
  artifactsDir: string;
  runId: string;
  node: DagNode;
  output: NodeOutput;
  dependencyOutputs: ReadonlyMap<string, NodeOutput>;
  startedAt: string;
  completedAt?: string;
}): Promise<string> {
  const { artifactsDir, runId, node, output, dependencyOutputs, startedAt, completedAt } = options;
  const nodeSegment = /^[A-Za-z0-9_-]+$/.test(node.id)
    ? node.id
    : Buffer.from(node.id).toString('base64url');
  const nodeDir = join(artifactsDir, 'execution', 'nodes', nodeSegment);
  const attempt = await nextAttempt(nodeDir);
  const attemptDir = join(nodeDir, 'attempts', String(attempt));
  await mkdir(attemptDir, { recursive: true });

  const outputValue = parseOutputValue(output);
  const serialized = typeof outputValue === 'string' ? outputValue : JSON.stringify(outputValue);
  const preview = serialized.slice(0, OUTPUT_PREVIEW_LIMIT);
  const truncated = serialized.length > OUTPUT_PREVIEW_LIMIT;
  const outputArtifactPath = truncated
    ? `execution/nodes/${nodeSegment}/attempts/${String(attempt)}/output.json`
    : undefined;
  if (outputArtifactPath !== undefined) {
    await writeFile(join(artifactsDir, outputArtifactPath), serialized, 'utf8');
  }

  const resolvedInputs = Object.fromEntries(
    (node.depends_on ?? []).map(id => {
      const dependency = dependencyOutputs.get(id);
      return [id, dependency === undefined ? null : parseOutputValue(dependency)];
    })
  );
  const artifactInputs = isWorkflowNode(node) ? (node.workflow.artifacts?.inputs ?? {}) : {};
  const manifest: NodeIoManifest = {
    version: 1,
    runId,
    nodeId: node.id,
    attempt,
    kind: nodeKind(node),
    declaredInputs: declaredInputs(node),
    resolvedInputs,
    output: {
      ...(!truncated ? { value: outputValue } : {}),
      preview,
      truncated,
      ...(outputArtifactPath !== undefined ? { artifactPath: outputArtifactPath } : {}),
    },
    artifacts: {
      inputs: artifactInputs,
      outputs: artifactOutputs(output),
    },
    startedAt,
    ...(completedAt !== undefined ? { completedAt } : {}),
  };
  const relativePath = `execution/nodes/${nodeSegment}/attempts/${String(attempt)}/io.json`;
  await writeFile(join(artifactsDir, relativePath), JSON.stringify(manifest, null, 2), 'utf8');
  return relativePath;
}
