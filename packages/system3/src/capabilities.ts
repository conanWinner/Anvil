import { z } from '@hono/zod-openapi';
import { analyzeBlueprintMarkdown, profileDatasetCsv } from './blueprint';
import { blueprintAnalysisSchema, system3SourceKindSchema } from './contracts';
import type { System3CapabilityDescriptor, System3SourceKind } from './contracts';
import {
  baselineCapabilityDescriptors,
  baselineCapabilityHandlers,
  type BaselineCapabilityId,
} from './baseline-capabilities';

function descriptor<const T extends string>(
  id: T,
  phaseId: System3CapabilityDescriptor['phaseId'],
  permissions: System3CapabilityDescriptor['permissions'],
  timeoutMs = 10_000
): System3CapabilityDescriptor & { id: T } {
  return {
    id,
    version: '1',
    phaseId,
    permissions,
    timeoutMs,
    resourceProfile: { cpuOnly: true, ramGb: null },
    credentialRequirements: [],
    inputSchemaId: `${id}.input@1`,
    outputSchemaId: `${id}.output@1`,
  };
}

export const customerChurnCapabilityDescriptors = [
  descriptor('system3.input-snapshot-verifier', 'understanding', ['source:read']),
  descriptor('system3.blueprint-parser', 'understanding', ['source:read']),
  descriptor('system3.dataset-profiler', 'understanding', ['source:read']),
  descriptor('system3.project-overview', 'understanding', ['artifact:write']),
  descriptor('system3.decision-generator', 'understanding', ['artifact:write']),
  descriptor('system3.readiness-gate-evaluator', 'readiness', ['source:read']),
  descriptor('system3.decision-resolver', 'readiness', ['source:read']),
  descriptor('system3.readiness-contract-builder', 'readiness', ['artifact:write']),
  ...baselineCapabilityDescriptors,
] as const;

export type System3CapabilityId =
  | (typeof customerChurnCapabilityDescriptors)[number]['id']
  | BaselineCapabilityId;

export interface System3CapabilityContext {
  runId: string;
  nodeId: string;
  cwd: string;
  artifactsDir: string;
  signal: AbortSignal;
}

export interface System3CapabilityResult {
  output: string;
  structuredOutput?: unknown;
}

export interface System3CapabilitySourcePort {
  listSourceRefs(
    projectId: string
  ): Promise<{ id: string; kind: System3SourceKind; contentHash: string }[]>;
  readLatestSource(
    projectId: string,
    kind: 'blueprint' | 'dataset'
  ): Promise<{ filename: string; text: string } | null>;
  readArtifact(projectId: string, storageKey: string): Promise<Uint8Array>;
}

type CapabilityHandler = (
  input: Readonly<Record<string, unknown>>,
  context: System3CapabilityContext
) => Promise<System3CapabilityResult>;

const sourceRefSchema = z.object({
  id: z.string().min(1),
  kind: system3SourceKindSchema,
  contentHash: z.string().startsWith('sha256:'),
});

const verifyInputSchema = z.object({ sources: z.array(sourceRefSchema).min(1) });
const parseBlueprintInputSchema = z.object({ markdown: z.string().min(1) });
const profileDatasetInputSchema = z.object({
  filename: z.string().min(1).nullable(),
  csv: z.string().nullable(),
});
const composeOverviewInputSchema = z.object({
  analysis: blueprintAnalysisSchema,
  datasetProfile: z.unknown().nullable(),
});
const decisionsInputSchema = z.object({ analysis: blueprintAnalysisSchema });
const readinessGateInputSchema = z.object({
  analysis: blueprintAnalysisSchema,
  pendingDecisionCount: z.number().int().nonnegative(),
});
const resolvedDecisionsInputSchema = z.object({
  decisions: z.array(
    z.object({
      id: z.string(),
      status: z.enum(['pending', 'answered']),
      answer: z.string().nullable(),
    })
  ),
});
const readinessContractInputSchema = z.object({
  analysis: blueprintAnalysisSchema,
  gates: z.object({ blueprintReady: z.boolean(), decisionsReady: z.boolean() }),
  resolvedDecisions: z.array(z.object({ id: z.string(), answer: z.string() })),
});

function result(value: unknown): System3CapabilityResult {
  return { output: JSON.stringify(value), structuredOutput: value };
}

function assertNotAborted(context: System3CapabilityContext): void {
  if (context.signal.aborted) throw new Error(`Capability '${context.nodeId}' was aborted`);
}

const handlers: Readonly<Record<System3CapabilityId, CapabilityHandler>> = {
  'system3.input-snapshot-verifier': async (raw, context) => {
    assertNotAborted(context);
    const input = verifyInputSchema.parse(raw);
    if (!input.sources.some(source => source.kind === 'blueprint')) {
      throw new Error('Input snapshot requires a blueprint source');
    }
    return result({ verified: true, sources: input.sources });
  },
  'system3.blueprint-parser': async (raw, context) => {
    assertNotAborted(context);
    const input = parseBlueprintInputSchema.parse(raw);
    return result({ analysis: analyzeBlueprintMarkdown(input.markdown, null) });
  },
  'system3.dataset-profiler': async (raw, context) => {
    assertNotAborted(context);
    const input = profileDatasetInputSchema.parse(raw);
    const datasetProfile =
      input.filename !== null && input.csv !== null
        ? profileDatasetCsv(input.filename, input.csv)
        : null;
    return result({ datasetProfile });
  },
  'system3.project-overview': async (raw, context) => {
    assertNotAborted(context);
    const input = composeOverviewInputSchema.parse(raw);
    const analysis = blueprintAnalysisSchema.parse({
      ...input.analysis,
      dataset: input.datasetProfile,
    });
    return result({ analysis });
  },
  'system3.decision-generator': async (raw, context) => {
    assertNotAborted(context);
    const input = decisionsInputSchema.parse(raw);
    return result({
      analysis: input.analysis,
      manualReviews: input.analysis.manualReviews,
      count: input.analysis.manualReviews.length,
    });
  },
  'system3.readiness-gate-evaluator': async (raw, context) => {
    assertNotAborted(context);
    const input = readinessGateInputSchema.parse(raw);
    const gates = {
      blueprintReady: input.analysis.requirements.length > 0,
      decisionsReady: input.pendingDecisionCount === 0,
    };
    return result({ gates, ready: gates.blueprintReady && gates.decisionsReady });
  },
  'system3.decision-resolver': async (raw, context) => {
    assertNotAborted(context);
    const input = resolvedDecisionsInputSchema.parse(raw);
    const unresolved = input.decisions.filter(
      decision => decision.status !== 'answered' || decision.answer === null
    );
    if (unresolved.length > 0) {
      throw new Error(
        `Readiness requires ${unresolved.length.toString()} decision(s) to be resolved`
      );
    }
    return result({
      resolvedDecisions: input.decisions.map(decision => {
        if (decision.answer === null) {
          throw new Error(`Decision '${decision.id}' has no answer`);
        }
        return { id: decision.id, answer: decision.answer };
      }),
    });
  },
  'system3.readiness-contract-builder': async (raw, context) => {
    assertNotAborted(context);
    const input = readinessContractInputSchema.parse(raw);
    if (!input.gates.blueprintReady || !input.gates.decisionsReady) {
      throw new Error('Readiness gates are not satisfied');
    }
    return result({
      contract: {
        schemaVersion: 1,
        requirementIds: input.analysis.requirements.map(requirement => requirement.id),
        targetDefinition: input.analysis.targetDefinition,
        runtime: input.analysis.runtime,
        decisions: input.resolvedDecisions,
      },
    });
  },
  ...baselineCapabilityHandlers,
};

/** Deterministic registry structurally compatible with WorkflowDeps.actionRegistry. */
export class System3CapabilityRegistry {
  constructor(private readonly sourcePort?: System3CapabilitySourcePort) {}

  has(executorId: string): boolean {
    return executorId in handlers;
  }

  async execute(
    executorId: string,
    input: Readonly<Record<string, unknown>>,
    context: System3CapabilityContext
  ): Promise<System3CapabilityResult> {
    const handler = handlers[executorId as System3CapabilityId];
    if (!handler) throw new Error(`Unknown System 3 capability '${executorId}'`);
    const projectId = typeof input.projectId === 'string' ? input.projectId : undefined;
    let resolvedInput = input;
    if (projectId && this.sourcePort) {
      if (executorId === 'system3.input-snapshot-verifier') {
        resolvedInput = { sources: await this.sourcePort.listSourceRefs(projectId) };
      } else if (executorId === 'system3.blueprint-parser') {
        const blueprint = await this.sourcePort.readLatestSource(projectId, 'blueprint');
        if (!blueprint) throw new Error('Blueprint source is missing');
        resolvedInput = { markdown: blueprint.text };
      } else if (executorId === 'system3.dataset-profiler') {
        const dataset = await this.sourcePort.readLatestSource(projectId, 'dataset');
        resolvedInput = {
          filename: dataset?.filename ?? null,
          csv: dataset?.text ?? null,
        };
      } else if (executorId === 'system3.project-scaffolder') {
        const dataset = await this.sourcePort.readLatestSource(projectId, 'dataset');
        if (!dataset) throw new Error('Dataset source is required for baseline execution');
        resolvedInput = {
          ...input,
          datasetFilename: dataset.filename,
          datasetCsv: dataset.text,
        };
      } else if (executorId === 'system3.delivery-artifact-materializer') {
        const storageKey = input.storageKey;
        if (typeof storageKey !== 'string')
          throw new Error('Reusable artifact storage key is missing');
        resolvedInput = {
          ...input,
          archiveBytes: await this.sourcePort.readArtifact(projectId, storageKey),
        };
      }
    }
    return handler(resolvedInput, context);
  }

  snapshot(): System3CapabilityDescriptor[] {
    return customerChurnCapabilityDescriptors.map(capability => ({ ...capability }));
  }
}
