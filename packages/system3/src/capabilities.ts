import { z } from '@hono/zod-openapi';
import { createHash } from 'node:crypto';
import { analyzeBlueprintMarkdown, profileDatasetCsv } from './blueprint';
import {
  blueprintAnalysisSchema,
  system3ReadinessCheckSchema,
  system3ReadinessContractBodySchema,
  system3ReadinessEvaluationSchema,
  system3SourceKindSchema,
} from './contracts';
import type {
  BlueprintAnalysis,
  System3CapabilityDescriptor,
  System3SourceKind,
} from './contracts';
import {
  understandProjectSources,
  verifyPinnedUnderstandingSourceStream,
  type PinnedUnderstandingSource,
  type StreamedPinnedUnderstandingSource,
  type UnderstandingSemanticFallback,
} from './understanding';
import {
  baselineCapabilityDescriptors,
  baselineCapabilityHandlers,
  type BaselineCapabilityId,
} from './baseline-capabilities';
import {
  modelCandidateInputSchema,
  modelComparisonInputSchema,
  packageModelComparison,
  runModelCandidate,
} from './model-comparison-runner';
import { modelComparisonConfigSchema, parsePinnedModelComparisonConfig } from './model-comparison';
import {
  EXPERIMENT_CONFIG_FILENAME,
  experimentPinSchema,
  parsePinnedExperimentConfig,
} from './experiment-config';
import { deriveExperimentPlan, hashExperimentPlan } from './experiment-plan';
import { resolveMlRuntime } from './ml-runtime';
import { executeExperiment, verifyExperiment } from './experiment-capabilities';
import type { ExperimentProgressEvent } from './experiment-progress';

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
  descriptor(
    'system3.understanding-analyzer',
    'understanding',
    ['source:read', 'artifact:write'],
    120_000
  ),
  descriptor('system3.blueprint-parser', 'understanding', ['source:read']),
  descriptor('system3.dataset-profiler', 'understanding', ['source:read']),
  descriptor('system3.project-overview', 'understanding', ['artifact:write']),
  descriptor('system3.decision-generator', 'understanding', ['artifact:write']),
  descriptor('system3.readiness-gate-evaluator', 'readiness', ['source:read']),
  descriptor('system3.decision-resolver', 'readiness', ['source:read']),
  descriptor('system3.readiness-contract-builder', 'readiness', ['artifact:write']),
  descriptor(
    'system3.model-candidate',
    'build',
    ['source:read', 'artifact:read', 'artifact:write', 'process:python'],
    150_000
  ),
  descriptor(
    'system3.model-comparison-packager',
    'experiment',
    ['source:read', 'artifact:read', 'artifact:write', 'process:tar'],
    120_000
  ),
  descriptor(
    'system3.model-comparison-validator',
    'delivery',
    ['artifact:read', 'process:python'],
    150_000
  ),
  descriptor(
    'system3.model-comparison-evidence',
    'delivery',
    ['artifact:read', 'artifact:write', 'process:python'],
    150_000
  ),
  descriptor(
    'system3.experiment-execute',
    'build',
    ['source:read', 'artifact:read', 'artifact:write', 'process:python', 'process:tar'],
    4 * 60 * 60_000
  ),
  descriptor(
    'system3.experiment-verify',
    'delivery',
    ['artifact:read', 'artifact:write', 'process:python'],
    30 * 60_000
  ),
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
  readSourceVersion?(
    projectId: string,
    sourceVersionId: string
  ): Promise<PinnedUnderstandingSource | null>;
  streamSourceVersion?(
    projectId: string,
    sourceVersionId: string
  ): Promise<StreamedPinnedUnderstandingSource | null>;
  getActiveUnderstandingAnalysis?(projectId: string): Promise<BlueprintAnalysis | null>;
  createUnderstandingSemanticFallback?(
    projectId: string
  ): Promise<UnderstandingSemanticFallback | undefined>;
  generateModelCode?(input: {
    projectId: string;
    model: string;
    prompt: string;
    signal: AbortSignal;
  }): Promise<unknown>;
  generateStructured?(input: {
    projectId: string;
    model: string;
    prompt: string;
    schema: Record<string, unknown>;
    maxResponseBytes: number;
    signal: AbortSignal;
  }): Promise<unknown>;
  readArtifact(projectId: string, storageKey: string): Promise<Uint8Array>;
  /** Live experiment trace sink; see `ExperimentCapabilityPort.recordProgress`. */
  recordProgress?(runId: string, event: ExperimentProgressEvent): void;
}

type CapabilityHandler = (
  input: Readonly<Record<string, unknown>>,
  context: System3CapabilityContext
) => Promise<System3CapabilityResult>;

const sourceRefSchema = z.object({
  id: z.string().min(1),
  kind: system3SourceKindSchema,
  filename: z.string().min(1).optional(),
  mediaType: z.string().min(1).optional(),
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
  modelComparison: modelComparisonConfigSchema.optional(),
  experiment: experimentPinSchema.optional(),
  pendingDecisionCount: z.number().int().nonnegative(),
  knowledgeSnapshotId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  datasetSourceVersionId: z.string().min(1).nullable(),
  requiredCapabilityIds: z.array(z.string().min(1)),
  availableCapabilityIds: z.array(z.string().min(1)),
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
  modelComparison: modelComparisonConfigSchema.optional(),
  experiment: experimentPinSchema.optional(),
  evaluation: system3ReadinessEvaluationSchema,
  datasetSourceVersionId: z.string().min(1).nullable(),
  resolvedDecisions: z.array(z.object({ id: z.string(), answer: z.string() })),
});
const pinnedDatasetInputSchema = z.object({
  projectId: z.string().min(1),
  datasetSourceVersionId: z.string().uuid(),
  datasetContentHash: z.string().startsWith('sha256:'),
});

async function resolvePinnedDataset(
  sourcePort: System3CapabilitySourcePort,
  raw: Readonly<Record<string, unknown>>
): Promise<{ bytes: Uint8Array; filename: string }> {
  const input = pinnedDatasetInputSchema.parse(raw);
  if (!sourcePort.readSourceVersion) {
    throw new Error('Pinned Source Version reads are unavailable');
  }
  const source = await sourcePort.readSourceVersion(input.projectId, input.datasetSourceVersionId);
  if (source?.id !== input.datasetSourceVersionId || source.kind !== 'dataset') {
    throw new Error(
      `Pinned dataset Source Version '${input.datasetSourceVersionId}' is unavailable`
    );
  }
  const actualHash = `sha256:${createHash('sha256').update(source.bytes).digest('hex')}`;
  if (source.contentHash !== input.datasetContentHash || actualHash !== input.datasetContentHash) {
    throw new Error(
      `Pinned dataset Source Version '${input.datasetSourceVersionId}' failed its content hash check`
    );
  }
  return {
    bytes: source.bytes,
    filename: source.filename,
  };
}

function result(value: unknown): System3CapabilityResult {
  return { output: JSON.stringify(value), structuredOutput: value };
}

function assertNotAborted(context: System3CapabilityContext): void {
  if (context.signal.aborted) throw new Error(`Capability '${context.nodeId}' was aborted`);
}

function readinessCheck(input: {
  id: string;
  label: string;
  passed: boolean;
  passedMessage: string;
  failedMessage: string;
  nextAction: 'answer_decisions' | 'link_dataset' | 'review_understanding' | 'configure_runtime';
}): z.infer<typeof system3ReadinessCheckSchema> {
  return {
    id: input.id,
    label: input.label,
    status: input.passed ? 'passed' : 'failed',
    message: input.passed ? input.passedMessage : input.failedMessage,
    nextAction: input.passed ? null : input.nextAction,
  };
}

const handlers: Readonly<Partial<Record<System3CapabilityId, CapabilityHandler>>> = {
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
    const dataset =
      input.analysis.schemaVersion === 2
        ? input.analysis.datasetUnderstanding.profile
        : input.analysis.dataset;
    const extractionStatus =
      input.analysis.schemaVersion === 2 ? input.analysis.extractionQuality.status : 'passed';
    const extractionReady =
      extractionStatus === 'passed' ||
      (extractionStatus === 'decision_required' && input.pendingDecisionCount === 0);
    const datasetLinked =
      input.datasetSourceVersionId !== null &&
      dataset !== null &&
      (input.analysis.schemaVersion === 1 ||
        input.analysis.datasetUnderstanding.availability === 'linked');
    const datasetNeedsLink =
      input.analysis.schemaVersion === 2
        ? input.analysis.datasetUnderstanding.availability === 'not_linked'
        : dataset === null;
    const datasetConsistent =
      input.analysis.schemaVersion === 1 ||
      (input.analysis.datasetUnderstanding.availability !== 'inaccessible' &&
        input.analysis.datasetUnderstanding.comparisonStatus !== 'mismatch');
    const comparisonRequirementsReady =
      input.modelComparison === undefined ||
      input.modelComparison.requirementIds.every(id =>
        input.analysis.requirements.some(requirement => requirement.id === id)
      );
    const experimentPlan =
      input.experiment === undefined ? null : deriveExperimentPlan(input.analysis);
    const experimentGaps = experimentPlan?.gaps.filter(gap => gap.blocking) ?? [];
    const experimentPlanCurrent =
      input.experiment === undefined ||
      (experimentPlan !== null &&
        hashExperimentPlan(experimentPlan) === input.experiment.planHash &&
        input.experiment.variantIds.every(id =>
          experimentPlan.variants.some(variant => variant.id === id)
        ));
    let runtimeInstalled = input.experiment === undefined;
    if (input.experiment !== undefined) {
      try {
        runtimeInstalled = (await resolveMlRuntime()).lockHash === input.experiment.runtimeLockHash;
      } catch {
        // Reported as a failed readiness check below; installing the runtime is the fix.
        runtimeInstalled = false;
      }
    }
    const targetReady =
      input.modelComparison !== undefined ||
      // Experiment mode: the data-preparation stage builds the target from the blueprint's
      // requirements; a classification protocol is what readiness can check here.
      (input.experiment !== undefined && experimentPlan?.protocol !== null) ||
      (input.analysis.targetDefinition !== null &&
        input.analysis.targetDefinition.trim().length > 0 &&
        dataset?.targetExists === true &&
        dataset.targetColumn !== null);
    const missingCapabilities = input.requiredCapabilityIds.filter(
      capabilityId => !input.availableCapabilityIds.includes(capabilityId)
    );
    const runtimeReady =
      input.analysis.runtime.cpuOnly &&
      input.analysis.runtime.ramGb !== null &&
      input.analysis.runtime.ramGb > 0;
    const checks = [
      readinessCheck({
        id: 'requirements',
        label: 'Mục tiêu và yêu cầu',
        passed: input.analysis.requirements.length > 0 && comparisonRequirementsReady,
        passedMessage: 'Có yêu cầu đã chuẩn hóa để kiểm chứng.',
        failedMessage: comparisonRequirementsReady
          ? 'Bản hiểu dự án chưa có yêu cầu có thể kiểm chứng.'
          : 'Model comparison tham chiếu requirement ID không có trong Bản hiểu dự án.',
        nextAction: 'review_understanding',
      }),
      readinessCheck({
        id: 'extraction_quality',
        label: 'Chất lượng bản hiểu',
        passed: extractionReady,
        passedMessage:
          extractionStatus === 'decision_required'
            ? 'Các Decision từ kiểm tra chất lượng đã được trả lời.'
            : 'Bản hiểu dự án đã vượt kiểm tra chất lượng.',
        failedMessage:
          extractionStatus === 'decision_required'
            ? 'Bản hiểu dự án còn nội dung cần người dùng quyết định.'
            : 'Bản hiểu dự án cần được chỉnh sửa hoặc phân tích lại.',
        nextAction:
          extractionStatus === 'decision_required' ? 'answer_decisions' : 'review_understanding',
      }),
      readinessCheck({
        id: 'decisions',
        label: 'Decision của Knowledge Snapshot',
        passed: input.pendingDecisionCount === 0,
        passedMessage: 'Không còn Decision đang chờ trong Knowledge Snapshot hiện hành.',
        failedMessage: `Còn ${input.pendingDecisionCount.toString()} Decision đang chờ trong Knowledge Snapshot hiện hành.`,
        nextAction: 'answer_decisions',
      }),
      readinessCheck({
        id: 'dataset_profile',
        label: 'Dataset Profile',
        passed: datasetLinked,
        passedMessage: 'Dataset thật và profile của nó đã được ghim.',
        failedMessage: 'Cần liên kết và kiểm tra Dataset thật trước công việc phụ thuộc dữ liệu.',
        nextAction: datasetNeedsLink ? 'link_dataset' : 'review_understanding',
      }),
      readinessCheck({
        id: 'dataset_compatibility',
        label: 'Tính nhất quán của Dataset',
        passed: datasetConsistent,
        passedMessage: 'Dataset khớp với khai báo trong bản hiểu dự án.',
        failedMessage: 'Dataset không thể đọc hoặc không khớp với khai báo hiện hành.',
        nextAction: 'review_understanding',
      }),
      readinessCheck({
        id: 'target',
        label: input.modelComparison ? 'Kiểu thực thi' : 'Target dữ liệu',
        passed: targetReady,
        passedMessage: input.modelComparison
          ? 'Comparison chạy các yêu cầu đã chọn, không cần target dự đoán.'
          : input.experiment
            ? 'Blueprint mô tả bài toán phân loại; bước chuẩn bị dữ liệu sẽ tạo cột target.'
            : 'Target đã được xác định và tồn tại trong Dataset Profile.',
        failedMessage: 'Target chưa rõ hoặc không tồn tại trong Dataset Profile hiện hành.',
        nextAction: datasetNeedsLink ? 'link_dataset' : 'review_understanding',
      }),
      ...(input.experiment === undefined
        ? []
        : [
            readinessCheck({
              id: 'experiment_plan',
              label: 'Phương án thí nghiệm',
              passed: experimentGaps.length === 0 && experimentPlanCurrent,
              passedMessage: `${input.experiment.variantIds.length.toString()} phương án và giao thức đánh giá đã được xác định từ blueprint.`,
              failedMessage:
                experimentGaps.length > 0
                  ? experimentGaps.map(gap => gap.message).join(' ')
                  : 'Kế hoạch thí nghiệm đã đổi so với cấu hình được ghim; hãy chạy lại Readiness.',
              nextAction: 'review_understanding',
            }),
            readinessCheck({
              id: 'ml_runtime',
              label: 'Runtime thí nghiệm',
              passed: runtimeInstalled,
              passedMessage: 'Runtime ML có khóa phiên bản đã được cài.',
              failedMessage:
                'Runtime ML chưa được cài hoặc khác phiên bản khóa. Chạy `bun run system3:ml-runtime` trên máy chủ.',
              nextAction: 'configure_runtime',
            }),
          ]),
      readinessCheck({
        id: 'runtime',
        label: 'Runtime Profile',
        passed: runtimeReady,
        passedMessage: 'Runtime CPU/RAM đã được xác định.',
        failedMessage: 'Runtime Profile chưa có CPU-only và giới hạn RAM hợp lệ.',
        nextAction: 'configure_runtime',
      }),
      readinessCheck({
        id: 'capabilities',
        label: 'Capability theo activity',
        passed: missingCapabilities.length === 0,
        passedMessage: 'Các capability bắt buộc cho Build, Verify và Delivery đều khả dụng.',
        failedMessage: `Thiếu capability bắt buộc: ${missingCapabilities.join(', ')}.`,
        nextAction: 'configure_runtime',
      }),
    ];
    const failedChecks = checks.filter(check => check.status === 'failed');
    const failedActions = new Set(failedChecks.map(check => check.nextAction));
    const status = failedActions.has('answer_decisions')
      ? 'decision_required'
      : failedActions.has('link_dataset')
        ? 'data_required'
        : failedChecks.length > 0
          ? 'blocked'
          : 'passed';
    const nextAction =
      status === 'passed'
        ? 'continue_compile'
        : status === 'decision_required'
          ? 'answer_decisions'
          : status === 'data_required'
            ? 'link_dataset'
            : (failedChecks[0]?.nextAction ?? 'review_understanding');
    const evaluation = system3ReadinessEvaluationSchema.parse({
      schemaVersion: 1,
      status,
      knowledgeSnapshotId: input.knowledgeSnapshotId,
      projectVersion: input.projectVersion,
      checks,
      blockerReasons: failedChecks.map(check => check.message),
      nextAction,
    });
    return result({ evaluation });
  },
  'system3.decision-resolver': async (raw, context) => {
    assertNotAborted(context);
    const input = resolvedDecisionsInputSchema.parse(raw);
    const unresolved = input.decisions.filter(
      decision => decision.status !== 'answered' || decision.answer === null
    );
    return result({
      resolvedDecisions: input.decisions.flatMap(decision =>
        decision.status === 'answered' && decision.answer !== null
          ? [{ id: decision.id, answer: decision.answer }]
          : []
      ),
      pendingDecisionCount: unresolved.length,
    });
  },
  'system3.readiness-contract-builder': async (raw, context) => {
    assertNotAborted(context);
    const input = readinessContractInputSchema.parse(raw);
    if (input.evaluation.status !== 'passed') {
      return result({ evaluation: input.evaluation, contract: null });
    }
    if (input.datasetSourceVersionId === null) {
      throw new Error('Passed readiness evaluation is missing its pinned Dataset Source Version');
    }
    const targetDefinition = input.analysis.targetDefinition;
    const dataset =
      input.analysis.schemaVersion === 2
        ? input.analysis.datasetUnderstanding.profile
        : input.analysis.dataset;
    const targetColumn = dataset?.targetColumn ?? null;
    const ramGb = input.analysis.runtime.ramGb;
    if (ramGb === null) {
      throw new Error('Passed readiness evaluation is inconsistent with its frozen inputs');
    }
    if (input.experiment !== undefined) {
      return result({
        evaluation: input.evaluation,
        contract: system3ReadinessContractBodySchema.parse({
          schemaVersion: 3,
          status: 'passed',
          knowledgeSnapshotId: input.evaluation.knowledgeSnapshotId,
          projectVersion: input.evaluation.projectVersion,
          requirementIds: input.analysis.requirements.map(requirement => requirement.id),
          datasetSourceVersionId: input.datasetSourceVersionId,
          runtime: { cpuOnly: input.analysis.runtime.cpuOnly, ramGb },
          decisions: input.resolvedDecisions,
          checks: input.evaluation.checks,
          experiment: input.experiment,
        }),
      });
    }
    if (input.modelComparison !== undefined) {
      const unknownIds = input.modelComparison.requirementIds.filter(
        id => !input.analysis.requirements.some(requirement => requirement.id === id)
      );
      if (unknownIds.length > 0) {
        throw new Error(
          `Model comparison references unknown requirement IDs: ${unknownIds.join(', ')}`
        );
      }
      return result({
        evaluation: input.evaluation,
        contract: system3ReadinessContractBodySchema.parse({
          schemaVersion: 3,
          status: 'passed',
          knowledgeSnapshotId: input.evaluation.knowledgeSnapshotId,
          projectVersion: input.evaluation.projectVersion,
          requirementIds: input.modelComparison.requirementIds,
          datasetSourceVersionId: input.datasetSourceVersionId,
          runtime: { cpuOnly: input.analysis.runtime.cpuOnly, ramGb },
          decisions: input.resolvedDecisions,
          checks: input.evaluation.checks,
          modelComparison: input.modelComparison,
        }),
      });
    }
    if (targetDefinition === null || targetColumn === null) {
      throw new Error('Passed readiness evaluation is inconsistent with its frozen inputs');
    }
    const contract = system3ReadinessContractBodySchema.parse({
      schemaVersion: 2,
      status: 'passed',
      knowledgeSnapshotId: input.evaluation.knowledgeSnapshotId,
      projectVersion: input.evaluation.projectVersion,
      requirementIds: input.analysis.requirements.map(requirement => requirement.id),
      targetDefinition,
      targetColumn,
      datasetSourceVersionId: input.datasetSourceVersionId,
      runtime: { cpuOnly: input.analysis.runtime.cpuOnly, ramGb },
      decisions: input.resolvedDecisions,
      checks: input.evaluation.checks,
    });
    return result({
      evaluation: input.evaluation,
      contract,
    });
  },
  ...baselineCapabilityHandlers,
};

/** Deterministic registry structurally compatible with WorkflowDeps.actionRegistry. */
export class System3CapabilityRegistry {
  constructor(private readonly sourcePort?: System3CapabilitySourcePort) {}

  has(executorId: string): boolean {
    return customerChurnCapabilityDescriptors.some(descriptor => descriptor.id === executorId);
  }

  async execute(
    executorId: string,
    input: Readonly<Record<string, unknown>>,
    context: System3CapabilityContext
  ): Promise<System3CapabilityResult> {
    const projectId = typeof input.projectId === 'string' ? input.projectId : undefined;
    if (
      executorId === 'system3.model-comparison-validator' ||
      executorId === 'system3.model-comparison-evidence'
    ) {
      if (!input.modelComparison)
        throw new Error('Approved comparison verification pins are missing');
      return baselineCapabilityHandlers[
        executorId === 'system3.model-comparison-validator'
          ? 'system3.artifact-schema-validator'
          : 'system3.evidence-map-builder'
      ](input, context);
    }
    if (executorId === 'system3.experiment-execute') {
      const readSourceVersion = this.sourcePort?.readSourceVersion?.bind(this.sourcePort);
      const generateStructured = this.sourcePort?.generateStructured?.bind(this.sourcePort);
      const readArtifact = this.sourcePort?.readArtifact.bind(this.sourcePort);
      if (!readSourceVersion || !generateStructured || !readArtifact)
        throw new Error('Experiment execution needs pinned source reads and model access');
      const recordProgress = this.sourcePort?.recordProgress?.bind(this.sourcePort);
      const executed = await executeExperiment(input, context, {
        readSourceVersion,
        generateStructured,
        readArtifact,
        ...(recordProgress ? { recordProgress } : {}),
      });
      // Archive the self-contained package exactly like the baseline flow does.
      const archive = await baselineCapabilityHandlers['system3.baseline-artifact-packager'](
        { projectDir: executed.projectDir },
        context
      );
      const archiveOutput = z.object({ packagePath: z.string() }).parse(archive.structuredOutput);
      return result({ ...executed, ...archiveOutput });
    }
    if (executorId === 'system3.experiment-verify') {
      return result(await verifyExperiment(input, context));
    }
    if (
      executorId === 'system3.model-candidate' ||
      executorId === 'system3.model-comparison-packager'
    ) {
      const parsed = modelComparisonInputSchema.parse(input);
      if (!this.sourcePort) throw new Error('Pinned model comparison sources are unavailable');
      const dataset = await resolvePinnedDataset(this.sourcePort, {
        projectId: parsed.projectId,
        datasetSourceVersionId: parsed.datasetSource.id,
        datasetContentHash: parsed.datasetSource.contentHash,
      });
      if (executorId === 'system3.model-candidate') {
        modelCandidateInputSchema.parse(input);
        const generate = this.sourcePort.generateModelCode?.bind(this.sourcePort);
        if (!generate) throw new Error('9router code generation is unavailable');
        return runModelCandidate(
          input,
          dataset.bytes,
          generation => generate({ ...generation, projectId: parsed.projectId }),
          context
        );
      }
      const packaged = await packageModelComparison(input, dataset.bytes, context);
      const output = z.object({ projectDir: z.string() }).parse(packaged.structuredOutput);
      const archive = await baselineCapabilityHandlers['system3.baseline-artifact-packager'](
        output,
        context
      );
      const archiveOutput = z.object({ packagePath: z.string() }).parse(archive.structuredOutput);
      const combined = {
        ...z.record(z.string(), z.unknown()).parse(packaged.structuredOutput),
        ...archiveOutput,
      };
      return result(combined);
    }
    if (
      executorId === 'system3.input-snapshot-verifier' &&
      projectId !== undefined &&
      this.sourcePort?.readSourceVersion !== undefined &&
      Array.isArray(input.sources)
    ) {
      const refs = z.array(sourceRefSchema).min(1).parse(input.sources);
      const sources: PinnedUnderstandingSource[] = [];
      for (const ref of refs) {
        if (this.sourcePort.streamSourceVersion) {
          const source = await this.sourcePort.streamSourceVersion(projectId, ref.id);
          if (!source) throw new Error(`Pinned Source Version '${ref.id}' does not exist`);
          if (source.contentHash !== ref.contentHash)
            throw new Error(`Pinned Source Version '${ref.id}' hash does not match its snapshot`);
          await verifyPinnedUnderstandingSourceStream(source);
        } else {
          const source = await this.sourcePort.readSourceVersion(projectId, ref.id);
          if (!source) throw new Error(`Pinned Source Version '${ref.id}' does not exist`);
          if (source.contentHash !== ref.contentHash)
            throw new Error(`Pinned Source Version '${ref.id}' hash does not match its snapshot`);
          sources.push(source);
        }
      }
      if (!refs.some(source => source.kind === 'blueprint')) {
        throw new Error('Input snapshot requires a blueprint source');
      }
      return result({ verified: true, sources: refs });
    }
    if (
      executorId === 'system3.understanding-analyzer' &&
      projectId !== undefined &&
      this.sourcePort?.readSourceVersion !== undefined &&
      Array.isArray(input.sources)
    ) {
      const refs = z.array(sourceRefSchema).min(1).parse(input.sources);
      const sources: PinnedUnderstandingSource[] = [];
      let datasetSource: StreamedPinnedUnderstandingSource | undefined;
      for (const ref of refs) {
        if (ref.kind === 'dataset' && this.sourcePort.streamSourceVersion) {
          const source = await this.sourcePort.streamSourceVersion(projectId, ref.id);
          if (!source) throw new Error(`Pinned Source Version '${ref.id}' does not exist`);
          datasetSource = source;
          continue;
        }
        const source = await this.sourcePort.readSourceVersion(projectId, ref.id);
        if (!source) throw new Error(`Pinned Source Version '${ref.id}' does not exist`);
        sources.push(source);
      }
      const comparisonSources = sources.filter(
        source => source.kind === 'constraints' && source.filename === 'model-comparison.json'
      );
      if (comparisonSources.length > 1)
        throw new Error(
          'Understanding input contains multiple model-comparison.json Source Versions'
        );
      const comparisonSource = comparisonSources[0];
      const pinnedModelComparison = comparisonSource
        ? parsePinnedModelComparisonConfig(comparisonSource.bytes, comparisonSource.contentHash)
        : undefined;
      const suppliedModelComparison = input.modelComparison
        ? modelComparisonConfigSchema.parse(input.modelComparison)
        : undefined;
      if (JSON.stringify(pinnedModelComparison) !== JSON.stringify(suppliedModelComparison)) {
        throw new Error('Understanding model comparison does not match its pinned Source Version');
      }
      const experimentSources = sources.filter(
        source => source.kind === 'constraints' && source.filename === EXPERIMENT_CONFIG_FILENAME
      );
      if (experimentSources.length > 1)
        throw new Error(
          `Understanding input contains multiple ${EXPERIMENT_CONFIG_FILENAME} files`
        );
      const experimentSource = experimentSources[0];
      if (experimentSource)
        parsePinnedExperimentConfig(experimentSource.bytes, experimentSource.contentHash);
      if (experimentSource && pinnedModelComparison)
        throw new Error('A project cannot pin both model comparison and experiment configs');
      const semanticFallback =
        await this.sourcePort.createUnderstandingSemanticFallback?.(projectId);
      const previousAnalysis = await this.sourcePort.getActiveUnderstandingAnalysis?.(projectId);
      return result(
        await understandProjectSources({
          sources,
          ...(datasetSource ? { datasetSource } : {}),
          ...(pinnedModelComparison ? { modelComparison: pinnedModelComparison } : {}),
          ...(experimentSource ? { targetFromPreparation: true } : {}),
          ...(previousAnalysis ? { previousAnalysis } : {}),
          ...(semanticFallback ? { semanticFallback } : {}),
          signal: context.signal,
        })
      );
    }
    const handler = handlers[executorId as System3CapabilityId];
    if (!handler) throw new Error(`Unknown System 3 capability '${executorId}'`);
    let resolvedInput = input;
    if (projectId && this.sourcePort) {
      if (executorId === 'system3.input-snapshot-verifier') {
        const suppliedSources = input.sources;
        resolvedInput = {
          sources: Array.isArray(suppliedSources)
            ? suppliedSources
            : await this.sourcePort.listSourceRefs(projectId),
        };
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
      } else if (
        executorId === 'system3.project-scaffolder' ||
        executorId === 'system3.pinned-dataset-materializer'
      ) {
        const dataset = await resolvePinnedDataset(this.sourcePort, input);
        resolvedInput = {
          ...input,
          datasetFilename: dataset.filename,
          datasetBytes: dataset.bytes,
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
