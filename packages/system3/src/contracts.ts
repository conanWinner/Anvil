import { experimentPinSchema } from './experiment-config';
import { z } from '@hono/zod-openapi';
import { system3LifecycleActivityIdSchema, system3ResourceTypeSchema } from './activity-resources';
import { modelComparisonConfigSchema } from './model-comparison';
import {
  codeDesignItemSchema,
  datasetUnderstandingSchema,
  extractionQualitySchema,
  moduleDesignSchema,
  pipelineStageSchema,
  problemProfileV2Schema,
  technologySelectionSchema,
  understandingSourcePointerSchema,
  blueprintDecisionSchema,
} from './understanding/schemas';
import { verificationContractSchema } from './verification-contract';

export const system3ProjectStageSchema = z.enum([
  'draft',
  'understanding',
  'workflow_design',
  'approved',
  'executing',
  'verifying',
  'delivery',
  'delivered',
]);
export type System3ProjectStage = z.infer<typeof system3ProjectStageSchema>;

export const system3AttentionSchema = z.enum([
  'none',
  'input_required',
  'decision_required',
  'approval_required',
  'failed',
]);
export type System3Attention = z.infer<typeof system3AttentionSchema>;

export const system3FreshnessSchema = z.enum(['current', 'partially_stale', 'stale']);
export type System3Freshness = z.infer<typeof system3FreshnessSchema>;

/** A user-visible, immutable retry/test cycle for one Project Lifecycle. */
export const system3LifecycleAttemptScopeSchema = z.enum(['full', 'activity', 'downstream']);
export type System3LifecycleAttemptScope = z.infer<typeof system3LifecycleAttemptScopeSchema>;

export const system3LifecycleAttemptInputModeSchema = z.enum(['replay', 'current']);
export type System3LifecycleAttemptInputMode = z.infer<
  typeof system3LifecycleAttemptInputModeSchema
>;

export const system3LifecycleAttemptStatusSchema = z.enum(['active', 'superseded', 'cleaned']);
export type System3LifecycleAttemptStatus = z.infer<typeof system3LifecycleAttemptStatusSchema>;

export const system3LifecycleAttemptRunStatusSchema = z.enum([
  'preparing',
  'running',
  'waiting',
  'completed',
  'failed',
  'unknown',
]);
export type System3LifecycleAttemptRunStatus = z.infer<
  typeof system3LifecycleAttemptRunStatusSchema
>;

export const system3LifecycleAttemptCleanupStatusSchema = z.enum([
  'not_started',
  'running',
  'partial',
  'completed',
  'failed',
]);
export type System3LifecycleAttemptCleanupStatus = z.infer<
  typeof system3LifecycleAttemptCleanupStatusSchema
>;

/**
 * The reproducibility basis is intentionally open-ended: new activity outputs
 * may be pinned without weakening the invariant that every referenced value
 * is persisted on the attempt before a Technical Workflow starts.
 */
export const system3LifecycleAttemptBasisSchema = z.object({
  schemaVersion: z.literal(1),
  sourceVersionIds: z.array(z.string().uuid()),
  sourceHashes: z.array(z.string().startsWith('sha256:')),
  knowledgeSnapshotId: z.string().uuid().nullable(),
  readinessContractId: z.string().uuid().nullable(),
  compilationId: z.string().uuid().nullable(),
  approvalId: z.string().uuid().nullable(),
  executionId: z.string().uuid().nullable(),
  verificationId: z.string().uuid().nullable(),
  baseCommitSha: z.string().nullable(),
  resources: z.record(z.string(), z.unknown()),
});
export type System3LifecycleAttemptBasis = z.infer<typeof system3LifecycleAttemptBasisSchema>;

export const system3SourceKindSchema = z.enum([
  'blueprint',
  'dataset',
  'constraints',
  'data_dictionary',
  'user_brief',
  'supporting_document',
]);
export type System3SourceKind = z.infer<typeof system3SourceKindSchema>;

export const system3ChangeKindSchema = z.enum([
  'first_source',
  'formatting_only',
  'content',
  'requirement',
  'schema',
  'row_only',
  'target',
  'runtime',
  'policy',
  'delivery',
  'unknown',
]);
export type System3ChangeKind = z.infer<typeof system3ChangeKindSchema>;

export const system3ImpactConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type System3ImpactConfidence = z.infer<typeof system3ImpactConfidenceSchema>;

export const system3ImpactChangeSchema = z.object({
  kind: system3ChangeKindSchema,
  changeType: z.enum(['added', 'modified', 'removed', 'unchanged']),
  entityType: z.string().min(1),
  entityKey: z.string().min(1).nullable(),
  summary: z.string().min(1),
  sourcePointers: z.array(z.string().min(1)),
  confidence: system3ImpactConfidenceSchema,
  detector: z.enum(['deterministic', 'llm_candidate', 'conservative_fallback']),
  previousValue: z.string().max(2000).nullable().optional(),
  currentValue: z.string().max(2000).nullable().optional(),
});
export type System3ImpactChange = z.infer<typeof system3ImpactChangeSchema>;

export const system3ImpactResourceSchema = z.object({
  resourceType: system3ResourceTypeSchema,
  resourceId: z.string().min(1).nullable(),
  activityId: system3LifecycleActivityIdSchema,
  reason: z.string().min(1),
  dependencyPath: z.array(z.string().min(1)),
});
export type System3ImpactResource = z.infer<typeof system3ImpactResourceSchema>;

export const system3ImpactManifestSchema = z.object({
  schemaVersion: z.union([z.literal(2), z.literal(3)]),
  detectorVersion: z.enum(['system3-change-detector@2', 'system3-change-detector@3']),
  projectId: z.string().uuid(),
  operationId: z.string().uuid(),
  sourceVersionId: z.string().uuid(),
  previousSourceVersionId: z.string().uuid().nullable(),
  basis: z.object({
    sourceId: z.string().uuid(),
    kind: system3SourceKindSchema,
    currentContentHash: z.string().startsWith('sha256:'),
    previousContentHash: z.string().startsWith('sha256:').nullable(),
    knowledgeSnapshotId: z.string().uuid().nullable(),
    dependencyGraphVersion: z.enum(['system3-dependency-graph@1', 'system3-dependency-graph@2']),
    dependencyGraphHash: z.string().startsWith('sha256:').optional(),
    dependencyNodeCount: z.number().int().nonnegative().optional(),
    dependencyEdgeCount: z.number().int().nonnegative().optional(),
    dependencyCoverage: z.enum(['complete', 'partial']).optional(),
    parserVersion: z.string().min(1),
    policyVersion: z.enum(['system3-impact-policy@2', 'system3-impact-policy@3']),
  }),
  analysisMode: z.enum(['deterministic', 'llm_assisted', 'conservative_fallback', 'legacy_broad']),
  confidence: system3ImpactConfidenceSchema,
  changes: z.array(system3ImpactChangeSchema),
  affectedActivities: z.array(system3LifecycleActivityIdSchema),
  affectedResources: z.array(system3ImpactResourceSchema),
  reusableResources: z.array(system3ImpactResourceSchema),
  proposedRerun: z.object({
    mode: z.enum(['none', 'scoped', 'full']),
    activityIds: z.array(system3LifecycleActivityIdSchema),
    executableScope: z.enum(['none', 'full', 'experiment', 'delivery']),
    reason: z.string().min(1),
  }),
  uncertainties: z.array(z.string().min(1)),
  llmAssistance: z.object({
    used: z.boolean(),
    provider: z.string().min(1).nullable(),
    model: z.string().min(1).nullable(),
    promptVersion: z.string().min(1).nullable(),
    candidateCount: z.number().int().nonnegative(),
    attempts: z.number().int().nonnegative().optional(),
    inputTokens: z.number().int().nonnegative().nullable().optional(),
    outputTokens: z.number().int().nonnegative().nullable().optional(),
    costUsd: z.number().nonnegative().nullable().optional(),
    durationMs: z.number().int().nonnegative().nullable().optional(),
    outcome: z.enum(['not_used', 'succeeded', 'failed']).optional(),
  }),
  summary: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type System3ImpactManifest = z.infer<typeof system3ImpactManifestSchema>;

export const system3SourceRoleSchema = z.enum(['primary', 'supplemental']);
export type System3SourceRole = z.infer<typeof system3SourceRoleSchema>;

export const system3SourceStorageStatusSchema = z.enum(['pending', 'ready', 'failed']);
export type System3SourceStorageStatus = z.infer<typeof system3SourceStorageStatusSchema>;

export const requirementSchema = z.object({
  id: z.string(),
  kind: z.string(),
  priority: z.string().nullable(),
  source: z.string().nullable(),
  statement: z.string(),
  acceptanceCriterion: z.string(),
  sourcePointer: z.string(),
});
export type System3Requirement = z.infer<typeof requirementSchema>;

export const requirementV2Schema = requirementSchema.extend({
  sourcePointers: z.array(understandingSourcePointerSchema).min(1),
});
export type System3RequirementV2 = z.infer<typeof requirementV2Schema>;

export const manualReviewSchema = z.object({
  id: z.string(),
  text: z.string(),
  sourcePointer: z.string(),
});
export type System3ManualReview = z.infer<typeof manualReviewSchema>;

export const manualReviewV2Schema = manualReviewSchema.extend({
  sourcePointers: z.array(understandingSourcePointerSchema).min(1),
});
export type System3ManualReviewV2 = z.infer<typeof manualReviewV2Schema>;

export const datasetProfileSchema = z.object({
  filename: z.string(),
  rowCount: z.number().int().nonnegative(),
  columnCount: z.number().int().nonnegative(),
  columns: z.array(z.string()),
  targetColumn: z.string().nullable(),
  targetExists: z.boolean(),
  targetDistribution: z.record(z.string(), z.number().int().nonnegative()),
});
export type System3DatasetProfile = z.infer<typeof datasetProfileSchema>;

export const blueprintAnalysisV1Schema = z.object({
  schemaVersion: z.literal(1),
  businessGoal: z.string().nullable(),
  technicalObjective: z.string().nullable(),
  targetDefinition: z.string().nullable(),
  runtime: z.object({ cpuOnly: z.boolean(), ramGb: z.number().int().nullable() }),
  requirements: z.array(requirementSchema),
  modules: z.array(z.string()),
  manualReviews: z.array(manualReviewSchema),
  dataset: datasetProfileSchema.nullable(),
});

export const blueprintAnalysisV2Schema = z.object({
  schemaVersion: z.literal(2),
  businessGoal: z.string().nullable(),
  technicalObjective: z.string().nullable(),
  targetDefinition: z.string().nullable(),
  runtime: z.object({ cpuOnly: z.boolean(), ramGb: z.number().int().nullable() }),
  requirements: z.array(requirementV2Schema),
  modules: z.array(z.string()),
  manualReviews: z.array(manualReviewV2Schema),
  dataset: datasetProfileSchema.nullable(),
  problemProfile: problemProfileV2Schema,
  datasetUnderstanding: datasetUnderstandingSchema,
  pipeline: z.array(pipelineStageSchema),
  technologyStack: z.array(technologySelectionSchema),
  moduleDesign: z.array(moduleDesignSchema),
  executionBlueprint: z.array(codeDesignItemSchema),
  extractionQuality: extractionQualitySchema,
  /** Absent for blueprints without one, so their analyses and plan hashes stay unchanged. */
  verificationContract: verificationContractSchema.optional(),
  /** Added when answered reviews are applied; never part of the immutable snapshot itself. */
  blueprintDecisions: z.array(blueprintDecisionSchema).optional(),
});

export const blueprintAnalysisSchema = z.discriminatedUnion('schemaVersion', [
  blueprintAnalysisV1Schema,
  blueprintAnalysisV2Schema,
]);
export type BlueprintAnalysis = z.infer<typeof blueprintAnalysisSchema>;

export const system3ReadinessStatusSchema = z.enum([
  'passed',
  'decision_required',
  'data_required',
  'blocked',
]);
export type System3ReadinessStatus = z.infer<typeof system3ReadinessStatusSchema>;

export const system3ReadinessNextActionSchema = z.enum([
  'continue_compile',
  'answer_decisions',
  'link_dataset',
  'review_understanding',
  'configure_runtime',
]);
export type System3ReadinessNextAction = z.infer<typeof system3ReadinessNextActionSchema>;

export const system3ReadinessCheckSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(['passed', 'failed']),
  message: z.string().min(1),
  nextAction: system3ReadinessNextActionSchema.nullable(),
});
export type System3ReadinessCheck = z.infer<typeof system3ReadinessCheckSchema>;

/** A business outcome from TW-03. A non-passed evaluation is not a workflow failure. */
export const system3ReadinessEvaluationSchema = z.object({
  schemaVersion: z.literal(1),
  status: system3ReadinessStatusSchema,
  knowledgeSnapshotId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  checks: z.array(system3ReadinessCheckSchema),
  blockerReasons: z.array(z.string().min(1)),
  nextAction: system3ReadinessNextActionSchema,
});
export type System3ReadinessEvaluation = z.infer<typeof system3ReadinessEvaluationSchema>;

/** Immutable input contract accepted by OP-04. It exists only for a passed evaluation. */
const system3BaselineReadinessContractBodySchema = z.object({
  schemaVersion: z.literal(2),
  status: z.literal('passed'),
  knowledgeSnapshotId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  requirementIds: z.array(z.string().min(1)).min(1),
  targetDefinition: z.string().min(1),
  targetColumn: z.string().min(1),
  datasetSourceVersionId: z.string().min(1),
  runtime: z.object({ cpuOnly: z.boolean(), ramGb: z.number().int().positive() }),
  decisions: z.array(z.object({ id: z.string().min(1), answer: z.string().min(1) })),
  checks: z.array(system3ReadinessCheckSchema),
});
const system3ComparisonReadinessContractBodySchema = z.object({
  schemaVersion: z.literal(3),
  status: z.literal('passed'),
  knowledgeSnapshotId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  requirementIds: z.array(z.string().min(1)).min(1),
  datasetSourceVersionId: z.string().min(1),
  runtime: z.object({ cpuOnly: z.boolean(), ramGb: z.number().int().positive() }),
  decisions: z.array(z.object({ id: z.string().min(1), answer: z.string().min(1) })),
  checks: z.array(system3ReadinessCheckSchema),
  modelComparison: modelComparisonConfigSchema,
});
const system3ExperimentReadinessContractBodySchema = z.object({
  schemaVersion: z.literal(3),
  status: z.literal('passed'),
  knowledgeSnapshotId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  requirementIds: z.array(z.string().min(1)).min(1),
  datasetSourceVersionId: z.string().min(1),
  runtime: z.object({ cpuOnly: z.boolean(), ramGb: z.number().int().positive() }),
  decisions: z.array(z.object({ id: z.string().min(1), answer: z.string().min(1) })),
  checks: z.array(system3ReadinessCheckSchema),
  experiment: experimentPinSchema,
});
export const system3ReadinessContractBodySchema = z.union([
  system3BaselineReadinessContractBodySchema,
  system3ComparisonReadinessContractBodySchema,
  system3ExperimentReadinessContractBodySchema,
]);
export type System3ReadinessContractBody = z.infer<typeof system3ReadinessContractBodySchema>;

export const system3PhaseStatusSchema = z.enum([
  'completed',
  'active',
  'blocked',
  'ready',
  'waiting',
  'not_started',
  'stale',
  'not_verified',
  'out_of_mvp_scope',
]);
export type System3PhaseStatus = z.infer<typeof system3PhaseStatusSchema>;

export const system3WorkflowStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  kind: z.enum(['input', 'check', 'artifact', 'approval']),
  status: z.enum(['completed', 'running', 'pending', 'blocked']),
  input: z.string(),
  output: z.string(),
});
export type System3WorkflowStep = z.infer<typeof system3WorkflowStepSchema>;

export const system3PhaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  technicalWorkflow: z.string(),
  status: system3PhaseStatusSchema,
  progress: z.number().int().min(0).max(100),
  objective: z.string(),
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
  workflowSteps: z.array(system3WorkflowStepSchema),
});
export type System3Phase = z.infer<typeof system3PhaseSchema>;

export const system3CapabilityPermissionSchema = z.enum([
  'source:read',
  'artifact:read',
  'artifact:write',
  'process:python',
  'process:tar',
]);
export type System3CapabilityPermission = z.infer<typeof system3CapabilityPermissionSchema>;

export const system3CapabilityDescriptorSchema = z.object({
  id: z.string(),
  version: z.string(),
  phaseId: z.enum(['understanding', 'readiness', 'build', 'experiment', 'delivery']),
  permissions: z.array(system3CapabilityPermissionSchema),
  timeoutMs: z.number().int().positive(),
  resourceProfile: z.object({ cpuOnly: z.boolean(), ramGb: z.number().int().nullable() }),
  credentialRequirements: z.array(z.string()),
  inputSchemaId: z.string(),
  outputSchemaId: z.string(),
});
export type System3CapabilityDescriptor = z.infer<typeof system3CapabilityDescriptorSchema>;

export const system3ReusableArtifactSchema = z.object({
  kind: z.literal('delivery_package'),
  storageKey: z.string().min(1),
  contentHash: z.string().startsWith('sha256:'),
  sourceExecutionId: z.string().uuid(),
  /** Optional only so persisted pre-T03 plans remain readable. New compilations require it. */
  sourceVersionIds: z.array(z.string().uuid()).min(1).optional(),
});
export type System3ReusableArtifact = z.infer<typeof system3ReusableArtifactSchema>;

export const system3ExecutionPlanSchema = z.object({
  schemaVersion: z.union([z.literal(2), z.literal(3)]),
  /** Compiler output is immutable and carries its own reproducibility pins. */
  compilerVersion: z.enum(['system3-compiler@2', 'system3-compiler@3']),
  templateId: z.literal('customer-churn-reference@1'),
  productWorkflowVersionId: z.string().uuid(),
  inputSnapshotId: z.string().uuid(),
  capabilityRegistrySnapshotId: z.string().uuid(),
  compilationBasisId: z.string().uuid(),
  executionPlanSnapshotId: z.string().uuid(),
  runtimeProfileVersionId: z.string().uuid(),
  runtimeProfileHash: z.string().startsWith('sha256:'),
  runtimeProfile: z.object({ cpuOnly: z.boolean(), ramGb: z.number().int().nullable() }),
  inputSnapshot: z.object({
    sourceIds: z.array(z.string().uuid()).min(1),
    sourceHashes: z.array(z.string().startsWith('sha256:')).min(1),
  }),
  modelComparison: modelComparisonConfigSchema.optional(),
  /** Experiment mode (plan 13); mutually exclusive with modelComparison. */
  experiment: experimentPinSchema.optional(),
  knowledgeSnapshotId: z.string().uuid(),
  /**
   * Readiness is an immutable domain contract, not an implicit side effect of
   * answering a decision. Older persisted plans may omit this during upgrade,
   * but newly compiled server plans always pin it.
   */
  readinessContract: z
    .object({ id: z.string().uuid(), contractHash: z.string().startsWith('sha256:') })
    .optional(),
  capabilityRegistry: z.array(system3CapabilityDescriptorSchema),
  rerunScope: z.object({
    mode: z.enum(['full', 'scoped']),
    executionMode: z.enum(['full', 'experiment', 'delivery']),
    impactManifestId: z.string().uuid().nullable(),
    impactManifestIds: z.array(z.string().uuid()).optional(),
    affectedPhases: z.array(z.string()).min(1),
    skippedPhases: z.array(z.string()),
    reusedArtifacts: z.array(system3ReusableArtifactSchema),
  }),
  phases: z.array(
    z.object({
      phaseId: z.string(),
      workflow: z.string(),
      nodePath: z.array(z.string()).min(1),
      permissions: z.array(z.string()),
      timeoutMs: z.number().int().positive(),
      resourceProfile: z.object({ cpuOnly: z.boolean(), ramGb: z.number().int().nullable() }),
      /** Present on v3 plans: a readable projection of immutable bundle nodes. */
      dependencies: z.record(z.string(), z.array(z.string())).optional(),
      executors: z.record(z.string(), z.string()).optional(),
    })
  ),
});
export type System3ExecutionPlan = z.infer<typeof system3ExecutionPlanSchema>;

export const system3WorkflowBundleActivityIdSchema = z.enum(['TW-06', 'TW-07', 'TW-09']);
export type System3WorkflowBundleActivityId = z.infer<typeof system3WorkflowBundleActivityIdSchema>;

export const system3RuntimeBindingTypeSchema = z.enum(['string', 'uuid', 'sha256', 'object']);
export type System3RuntimeBindingType = z.infer<typeof system3RuntimeBindingTypeSchema>;

export const system3RuntimeBindingSlotSchema = z.object({
  name: z.string().min(1),
  type: system3RuntimeBindingTypeSchema,
});
export type System3RuntimeBindingSlot = z.infer<typeof system3RuntimeBindingSlotSchema>;

export const system3WorkflowBundleDefinitionSchema = z.object({
  schemaVersion: z.literal(3),
  compilerVersion: z.literal('system3-compiler@3'),
  activityId: system3WorkflowBundleActivityIdSchema,
  executionMode: z.enum(['full', 'experiment', 'delivery']),
  rootWorkflow: z.string().min(1),
  workflows: z.array(z.record(z.string(), z.unknown())).min(1),
  runtimeBindings: z
    .array(system3RuntimeBindingSlotSchema)
    .refine(slots => new Set(slots.map(slot => slot.name)).size === slots.length, {
      message: 'Runtime binding slot names must be unique',
    }),
  capabilityRegistry: z.array(system3CapabilityDescriptorSchema),
  permissions: z.array(system3CapabilityPermissionSchema),
  runtimeProfile: z.object({ cpuOnly: z.boolean(), ramGb: z.number().int().nullable() }),
  dependencies: z.record(z.string(), z.array(z.string())),
  inputMappings: z.record(z.string(), z.unknown()),
  outputMappings: z.record(z.string(), z.unknown()),
  outputSchemas: z.record(z.string(), z.unknown()),
  timeouts: z.record(z.string(), z.number().int().positive()),
});
export type System3WorkflowBundleDefinition = z.infer<typeof system3WorkflowBundleDefinitionSchema>;

export const system3WorkflowBundleSnapshotSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  compilationId: z.string().uuid(),
  activityId: system3WorkflowBundleActivityIdSchema,
  schemaVersion: z.literal(3),
  compilerVersion: z.literal('system3-compiler@3'),
  templateId: z.literal('customer-churn-reference@1'),
  executionMode: z.enum(['full', 'experiment', 'delivery']),
  definition: system3WorkflowBundleDefinitionSchema,
  definitionHash: z.string().startsWith('sha256:'),
});
export type System3WorkflowBundleSnapshot = z.infer<typeof system3WorkflowBundleSnapshotSchema>;

export const system3ApprovedBundleBindingSchema = z.object({
  activityId: system3WorkflowBundleActivityIdSchema,
  bundleSnapshotId: z.string().uuid(),
  bundleHash: z.string().startsWith('sha256:'),
  schemaVersion: z.literal(3),
});
export type System3ApprovedBundleBinding = z.infer<typeof system3ApprovedBundleBindingSchema>;

export const system3ApprovalManifestSchema = z
  .object({
    schemaVersion: z.union([z.literal(2), z.literal(3)]),
    compilationId: z.string().uuid(),
    projectId: z.string().uuid(),
    productWorkflowVersionId: z.string().uuid(),
    inputSnapshotId: z.string().uuid(),
    capabilityRegistrySnapshotId: z.string().uuid(),
    compilationBasisId: z.string().uuid(),
    executionPlanSnapshotId: z.string().uuid(),
    runtimeProfileVersionId: z.string().uuid(),
    compilerVersion: z.enum(['system3-compiler@2', 'system3-compiler@3']),
    approvedBy: z.string().min(1),
    approvedAt: z.string().datetime(),
    templateId: z.literal('customer-churn-reference@1'),
    inputSnapshot: z.object({
      sourceIds: z.array(z.string().uuid()),
      sourceHashes: z.array(z.string()),
    }),
    knowledgeSnapshotId: z.string().uuid(),
    readinessContract: z
      .object({ id: z.string().uuid(), contractHash: z.string().startsWith('sha256:') })
      .optional(),
    capabilityRegistryHash: z.string().startsWith('sha256:'),
    definitionHash: z.string().startsWith('sha256:'),
    executionPlanHash: z.string().startsWith('sha256:'),
    runtimeProfile: z.object({ cpuOnly: z.boolean(), ramGb: z.number().int().nullable() }),
    workflowBundleBindings: z.array(system3ApprovedBundleBindingSchema).length(3).optional(),
  })
  .superRefine((manifest, context) => {
    if (manifest.schemaVersion !== 3) return;
    const bindings = manifest.workflowBundleBindings;
    const activities = new Set(bindings?.map(binding => binding.activityId));
    if (
      bindings === undefined ||
      activities.size !== 3 ||
      !activities.has('TW-06') ||
      !activities.has('TW-07') ||
      !activities.has('TW-09')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Approval Manifest v3 requires one binding for TW-06, TW-07 and TW-09',
        path: ['workflowBundleBindings'],
      });
    }
  });
export type System3ApprovalManifest = z.infer<typeof system3ApprovalManifestSchema>;
