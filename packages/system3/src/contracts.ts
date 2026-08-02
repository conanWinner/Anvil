import { z } from '@hono/zod-openapi';
import { system3LifecycleActivityIdSchema, system3ResourceTypeSchema } from './activity-resources';

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

export const manualReviewSchema = z.object({
  id: z.string(),
  text: z.string(),
  sourcePointer: z.string(),
});
export type System3ManualReview = z.infer<typeof manualReviewSchema>;

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

export const blueprintAnalysisSchema = z.object({
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
export type BlueprintAnalysis = z.infer<typeof blueprintAnalysisSchema>;

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
});
export type System3ReusableArtifact = z.infer<typeof system3ReusableArtifactSchema>;

export const system3ExecutionPlanSchema = z.object({
  schemaVersion: z.literal(2),
  /** Compiler output is immutable and carries its own reproducibility pins. */
  compilerVersion: z.literal('system3-compiler@2'),
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
    })
  ),
});
export type System3ExecutionPlan = z.infer<typeof system3ExecutionPlanSchema>;

export const system3ApprovalManifestSchema = z.object({
  schemaVersion: z.literal(2),
  compilationId: z.string().uuid(),
  projectId: z.string().uuid(),
  productWorkflowVersionId: z.string().uuid(),
  inputSnapshotId: z.string().uuid(),
  capabilityRegistrySnapshotId: z.string().uuid(),
  compilationBasisId: z.string().uuid(),
  executionPlanSnapshotId: z.string().uuid(),
  runtimeProfileVersionId: z.string().uuid(),
  compilerVersion: z.literal('system3-compiler@2'),
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
});
export type System3ApprovalManifest = z.infer<typeof system3ApprovalManifestSchema>;
