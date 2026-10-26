import { createHash, randomUUID } from 'node:crypto';
import type {
  BlueprintAnalysis,
  System3ApprovalManifest,
  System3Attention,
  System3ExecutionPlan,
  System3Freshness,
  System3Phase,
  System3ProjectStage,
  System3ReadinessEvaluation,
  System3SourceKind,
  System3SourceRole,
  System3SourceStorageStatus,
  System3ImpactManifest,
  System3LifecycleAttemptBasis,
  System3LifecycleAttemptCleanupStatus,
  System3LifecycleAttemptInputMode,
  System3LifecycleAttemptRunStatus,
  System3LifecycleAttemptScope,
  System3LifecycleAttemptStatus,
  System3WorkflowBundleActivityId,
  System3WorkflowBundleSnapshot,
} from './contracts';
import type {
  ExtractionQuality,
  UnderstandingDecisionBinding,
  UnderstandingReport,
} from './understanding';
import {
  system3ImpactManifestSchema,
  system3ReadinessContractBodySchema,
  system3ReadinessEvaluationSchema,
} from './contracts';
import { affectedPhasesForSource, system3PhaseOrder, type System3PhaseId } from './invalidation';

export interface System3Database {
  readonly dialect: 'postgres' | 'sqlite';
  query(sql: string, params?: unknown[]): Promise<{ rows: readonly unknown[]; rowCount: number }>;
  withTransaction<T>(fn: (query: System3Query) => Promise<T>): Promise<T>;
}

type System3Query = (
  sql: string,
  params?: unknown[]
) => Promise<{ rows: readonly unknown[]; rowCount: number }>;

function typedRows<T>(result: { rows: readonly unknown[] }, decode: (row: unknown) => T): T[] {
  return result.rows.map(decode);
}

export interface System3ProjectRecord {
  id: string;
  codebaseId: string;
  name: string;
  description: string;
  stage: System3ProjectStage;
  attention: System3Attention;
  freshness: System3Freshness;
  version: number;
  templateId: string;
  activeKnowledgeSnapshotId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface System3LifecycleAttemptRecord {
  id: string;
  projectId: string;
  sequence: number;
  baseAttemptId: string | null;
  startActivityId: string;
  scope: System3LifecycleAttemptScope;
  inputMode: System3LifecycleAttemptInputMode;
  basis: System3LifecycleAttemptBasis;
  previewHash: string;
  conversationId: string | null;
  isolationEnvironmentId: string | null;
  branchName: string | null;
  workingPath: string | null;
  lifecycleStatus: System3LifecycleAttemptStatus;
  runStatus: System3LifecycleAttemptRunStatus;
  cleanupStatus: System3LifecycleAttemptCleanupStatus;
  checkpointActivityId: string | null;
  nextActivityId: string | null;
  cleanupManifest: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cleanedAt: string | null;
}

export interface System3LifecycleAttemptReplayInput {
  projectId: string;
  expectedVersion: number;
  baseAttemptId?: string | null;
  startActivityId: string;
  scope: System3LifecycleAttemptScope;
  inputMode: System3LifecycleAttemptInputMode;
  previewHash: string;
  idempotencyKey: string;
}

export interface System3LifecycleAttemptBeginInput extends System3LifecycleAttemptReplayInput {
  basis: System3LifecycleAttemptBasis;
  createdBy?: string | null;
}

export interface System3SourceRecord {
  id: string;
  sourceId: string;
  projectId: string;
  kind: System3SourceKind;
  role: System3SourceRole;
  filename: string;
  originalFilename: string;
  mediaType: string;
  version: number;
  contentHash: string;
  sizeBytes: number;
  storageKey: string;
  storageStatus: System3SourceStorageStatus;
  validationReport: System3SourceValidationReport;
  createdBy: string | null;
  origin: string;
  operationId: string | null;
  intakeReportArtifactId: string | null;
  createdAt: string;
}

export interface System3SourceValidationCheck {
  id: string;
  label: string;
  status: 'passed' | 'warning' | 'failed';
  message: string;
}

export interface System3SourceValidationReport {
  schemaVersion: 1;
  outcome: 'accepted' | 'unchanged' | 'rejected';
  checks: System3SourceValidationCheck[];
  warnings: string[];
}

export interface System3SourceIntakeStoreResult {
  outcome: 'created_source' | 'created_version' | 'unchanged';
  source: System3SourceRecord;
  previousVersionId: string | null;
}

export interface System3SourceIntakeReport {
  schemaVersion: 1;
  artifactKind: 'source_intake_report';
  operationId: string;
  outcome: 'created_source' | 'created_version' | 'unchanged' | 'rejected';
  projectId: string;
  sourceId: string | null;
  sourceVersionId: string | null;
  previousVersionId: string | null;
  kind: System3SourceKind;
  role: System3SourceRole;
  originalFilename: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  contentHash: string | null;
  storageStatus: System3SourceStorageStatus | 'not_stored';
  actorId: string | null;
  origin: string;
  validationReport: System3SourceValidationReport;
  changeDetection: {
    operationId: string | null;
    status: 'not_required' | 'succeeded' | 'failed';
    error: string | null;
  };
  nextAction: 'retry_intake' | 'retry_change_detection' | 'review_and_continue';
  createdAt: string;
}

export interface System3SourceIntakeReportRecord {
  id: string;
  projectId: string;
  operationId: string;
  sourceVersionId: string | null;
  artifactKey: string;
  report: System3SourceIntakeReport;
  createdAt: string;
}

export interface System3KnowledgeSnapshotRecord {
  id: string;
  projectId: string;
  analysis: BlueprintAnalysis;
  artifactKey: string;
  workflowRunId: string | null;
  inputSnapshotId: string | null;
  schemaVersion: number;
  lifecycleStatus: 'candidate' | 'active' | 'superseded' | 'stale';
  qualityStatus: ExtractionQuality['status'] | null;
  qualityReport: ExtractionQuality | null;
  activatedAt: string | null;
  activatedBy: string | null;
  createdAt: string;
}

/** Exact immutable basis persisted before TW-02 starts. */
export interface System3UnderstandingInputSnapshotRecord {
  id: string;
  projectId: string;
  operationId: string;
  knowledgeSnapshotId: string | null;
  workflowRunId: string | null;
  sourceIds: string[];
  sourceHashes: string[];
  sourceRefs: {
    sourceVersionId: string;
    kind: System3SourceKind;
    filename: string;
    mediaType: string;
    contentHash: string;
  }[];
  parserVersion: string;
  extractionPolicyVersion: string;
  capabilityRegistryHash: string;
  runtimeProfile: Record<string, unknown>;
  createdAt: string;
}

/** Immutable result of the explicit readiness workflow. */
export interface System3ReadinessContractRecord {
  id: string;
  projectId: string;
  knowledgeSnapshotId: string;
  workflowRunId: string;
  contract: Record<string, unknown>;
  contractHash: string;
  artifactKey: string;
  createdAt: string;
}

export interface System3DecisionRecord {
  id: string;
  projectId: string;
  knowledgeSnapshotId: string;
  title: string;
  question: string;
  why: string;
  recommendation: string;
  options: string[];
  binding: UnderstandingDecisionBinding | null;
  affectedPhases: string[];
  status: 'pending' | 'answered';
  answer: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface System3CompilationRecord {
  id: string;
  projectId: string;
  knowledgeSnapshotId: string;
  plan: System3ExecutionPlan;
  definitionHash: string;
  capabilityRegistryHash: string;
  createdAt: string;
}

/** Immutable executable definition pinned to one compilation and activity. */
export interface System3WorkflowBundleSnapshotRecord extends System3WorkflowBundleSnapshot {
  createdAt: string;
}

/** Immutable product-workflow snapshot used by the project history API. */
export interface System3WorkflowVersionRecord {
  id: string;
  projectId: string;
  templateId: string;
  definitionHash: string;
  status: 'fixed_mvp';
  createdAt: string;
}

export interface System3ProjectTransitionRecord {
  id: string;
  projectId: string;
  fromStage: System3ProjectStage | null;
  toStage: System3ProjectStage;
  actorId: string | null;
  operationId: string | null;
  workflowRunId: string | null;
  entityType: string | null;
  entityId: string | null;
  fromAttention: System3Attention | null;
  toAttention: System3Attention | null;
  fromFreshness: System3Freshness | null;
  toFreshness: System3Freshness | null;
  projectVersion: number | null;
  metadata: Record<string, unknown>;
  reason: string;
  createdAt: string;
}

export interface System3ApprovalRecord {
  id: string;
  projectId: string;
  compilationId: string;
  idempotencyKey: string;
  manifest: System3ApprovalManifest;
  createdAt: string;
}

export type System3ExecutionStatus = 'accepted' | 'running' | 'completed' | 'failed';
export type System3OperationStatus = 'accepted' | 'running' | 'succeeded' | 'failed' | 'abandoned';
/**
 * Operations are deliberately product-level.  An operation may have no
 * workflow run (for example compilation) and must therefore not be modelled
 * as an execution-only record.
 */
export type System3OperationType =
  | 'source_intake'
  | 'change_detection'
  | 'analyze'
  | 'activate_understanding'
  | 'readiness'
  | 'compile'
  | 'execute'
  | 'verify'
  | 'delivery';

export interface System3ExecutionRecord {
  id: string;
  projectId: string;
  approvalId: string;
  workflowRunId: string;
  definitionHash: string;
  bundleSnapshotId?: string | null;
  bundleHash?: string | null;
  runtimeBindings?: Record<string, unknown> | null;
  status: System3ExecutionStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface System3OperationRecord {
  id: string;
  projectId: string;
  executionId: string | null;
  workflowRunId: string | null;
  type: System3OperationType;
  status: System3OperationStatus;
  idempotencyKey: string;
  requestFingerprint: string;
  projectVersion: number;
  result: Record<string, unknown> | null;
  ownerInstanceId: string | null;
  heartbeatAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface System3EvidenceRecord {
  id: string;
  projectId: string;
  executionId: string;
  verificationId: string | null;
  requirementId: string | null;
  status: 'passed' | 'failed' | 'not_verified' | 'out_of_mvp_scope';
  validatorVersion: string;
  basisHash: string;
  evidence: string[];
  reason: string | null;
  createdAt: string;
}

export interface System3VerificationRecord {
  id: string;
  projectId: string;
  executionId: string;
  workflowRunId: string;
  inputArtifactId: string;
  status: System3ExecutionStatus;
  validatorVersion: string;
  basisHash: string;
  bundleSnapshotId?: string | null;
  bundleHash?: string | null;
  runtimeBindings?: Record<string, unknown> | null;
  evidenceMap: Record<string, unknown> | null;
  gate: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface System3DeliveryRecord {
  id: string;
  projectId: string;
  executionId: string;
  verificationId: string | null;
  packageStorageKey: string;
  packageFilename: string;
  contentHash: string;
  sizeBytes: number;
  bundleSnapshotId?: string | null;
  bundleHash?: string | null;
  runtimeBindings?: Record<string, unknown> | null;
  manifest: Record<string, unknown>;
  createdAt: string;
}

export interface System3ImpactManifestRecord {
  id: string;
  projectId: string;
  sourceVersionId: string;
  affectedPhases: System3PhaseId[];
  reason: string;
  operationId: string | null;
  previousSourceVersionId: string | null;
  schemaVersion: 1 | 2 | 3;
  detectorVersion: string;
  basisHash: string;
  manifestHash: string;
  manifest: System3ImpactManifest | null;
  createdAt: string;
}

export interface System3DependencyEdgeRecord {
  fromKind: string;
  fromId: string;
  toKind: string;
  toId: string;
  reason: string;
}

export interface System3ArtifactVersionRecord {
  id: string;
  projectId: string;
  executionId: string | null;
  knowledgeSnapshotId: string | null;
  sourceVersionId: string | null;
  operationId: string | null;
  artifactKey: string;
  artifactKind: string;
  version: number;
  contentHash: string;
  sizeBytes: number;
  activityId: string | null;
  workflowRunId: string | null;
  workflowNodeId: string | null;
  displayName: string | null;
  summary: string | null;
  mediaType: string | null;
  schemaId: string | null;
  schemaVersion: string | null;
  visibility: 'user' | 'technical' | null;
  status: 'pending' | 'current' | 'stale' | 'superseded' | 'failed' | null;
  staleReason: string | null;
  sourceVersionIds: string[];
  parentResourceIds: string[];
  createdAt: string;
}

export interface System3TraceabilitySummary {
  requirements: number;
  knowledgeFacts: number;
  openIssues: number;
  dependencyEdges: number;
  artifactVersions: number;
}

export interface System3PrecreatedWorkflowRun {
  id: string;
  workflow_name: string;
  conversation_id: string;
  parent_conversation_id: null;
  parent_workflow_run_id: null;
  parent_node_id: null;
  codebase_id: string;
  status: 'pending';
  user_message: string;
  metadata: Record<string, unknown>;
  started_at: Date;
  completed_at: null;
  last_activity_at: Date | null;
  working_path: string;
  user_id: string | null;
}

interface ProjectRow {
  id: string;
  codebase_id: string;
  name: string;
  description: string | null;
  stage: System3ProjectStage;
  attention: System3Attention;
  freshness: System3Freshness;
  version: number | string;
  template_id: string;
  active_knowledge_snapshot_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SourceRow {
  id: string;
  source_id: string | null;
  project_id: string;
  kind: System3SourceKind;
  role: System3SourceRole | null;
  filename: string;
  original_filename: string | null;
  media_type: string | null;
  version: number | string;
  lineage_version: number | string | null;
  content_hash: string;
  size_bytes: number | string;
  storage_key: string;
  storage_status: System3SourceStorageStatus | null;
  validation_report: System3SourceValidationReport | string | null;
  created_by_user_id: string | null;
  origin: string | null;
  operation_id: string | null;
  intake_report_artifact_id: string | null;
  created_at: Date | string;
}

interface SourceIntakeReportRow {
  id: string;
  project_id: string;
  operation_id: string;
  source_version_id: string | null;
  artifact_key: string;
  report: System3SourceIntakeReport | string;
  created_at: Date | string;
}

interface SnapshotRow {
  id: string;
  project_id: string;
  analysis: BlueprintAnalysis | string;
  artifact_key: string;
  workflow_run_id: string | null;
  input_snapshot_id: string | null;
  schema_version: number | string | null;
  lifecycle_status: 'candidate' | 'active' | 'superseded' | 'stale' | null;
  quality_status: ExtractionQuality['status'] | null;
  quality_report: ExtractionQuality | string | null;
  activated_at: Date | string | null;
  activated_by_user_id: string | null;
  created_at: Date | string;
}

interface UnderstandingInputSnapshotRow {
  id: string;
  project_id: string;
  operation_id: string;
  knowledge_snapshot_id: string | null;
  workflow_run_id: string | null;
  source_ids: string[] | string;
  source_hashes: string[] | string;
  source_refs: System3UnderstandingInputSnapshotRecord['sourceRefs'] | string | null;
  parser_version: string;
  extraction_policy_version: string;
  capability_registry_hash: string;
  runtime_profile: Record<string, unknown> | string;
  created_at: Date | string;
}

interface ReadinessContractRow {
  id: string;
  project_id: string;
  knowledge_snapshot_id: string;
  workflow_run_id: string;
  contract: Record<string, unknown> | string;
  contract_hash: string;
  artifact_key: string;
  created_at: Date | string;
}

interface DecisionRow {
  id: string;
  project_id: string;
  knowledge_snapshot_id: string;
  title: string;
  question: string;
  why: string;
  recommendation: string;
  options: string[] | string;
  binding: UnderstandingDecisionBinding | string | null;
  affected_phases: string[] | string;
  status: 'pending' | 'answered';
  answer: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CompilationRow {
  id: string;
  project_id: string;
  knowledge_snapshot_id: string;
  plan: System3ExecutionPlan | string;
  definition_hash: string;
  capability_registry_hash: string;
  created_at: Date | string;
}

interface WorkflowBundleSnapshotRow {
  id: string;
  project_id: string;
  compilation_id: string;
  activity_id: System3WorkflowBundleActivityId;
  schema_version: number | string;
  compiler_version: string;
  template_id: string;
  execution_mode: 'full' | 'experiment' | 'delivery';
  definition: System3WorkflowBundleSnapshot['definition'] | string;
  definition_hash: string;
  created_at: Date | string;
}

interface ApprovalRow {
  id: string;
  project_id: string;
  compilation_id: string;
  idempotency_key: string;
  manifest: System3ApprovalManifest | string;
  created_at: Date | string;
}

interface ExecutionRow {
  id: string;
  project_id: string;
  approval_id: string;
  workflow_run_id: string;
  definition_hash: string;
  bundle_snapshot_id?: string | null;
  bundle_hash?: string | null;
  runtime_bindings?: Record<string, unknown> | string | null;
  status: System3ExecutionStatus;
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface OperationRow {
  id: string;
  project_id: string;
  execution_id: string | null;
  workflow_run_id: string | null;
  operation_type: System3OperationType;
  status: System3OperationStatus;
  idempotency_key: string;
  request_fingerprint: string;
  project_version: number | string;
  result: Record<string, unknown> | string | null;
  owner_instance_id: string | null;
  heartbeat_at: Date | string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface EvidenceRow {
  id: string;
  project_id: string;
  execution_id: string;
  verification_id: string | null;
  requirement_id: string | null;
  status: 'passed' | 'failed' | 'not_verified' | 'out_of_mvp_scope';
  validator_version: string;
  basis_hash: string;
  evidence: string[] | string;
  reason: string | null;
  created_at: Date | string;
}

interface VerificationRow {
  id: string;
  project_id: string;
  execution_id: string;
  workflow_run_id: string;
  input_artifact_id: string;
  status: System3ExecutionStatus;
  validator_version: string;
  basis_hash: string;
  bundle_snapshot_id?: string | null;
  bundle_hash?: string | null;
  runtime_bindings?: Record<string, unknown> | string | null;
  evidence_map: Record<string, unknown> | string | null;
  gate: Record<string, unknown> | string | null;
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DeliveryRow {
  id: string;
  project_id: string;
  execution_id: string;
  verification_id: string | null;
  package_storage_key: string;
  package_filename: string;
  content_hash: string;
  size_bytes: number | string;
  bundle_snapshot_id?: string | null;
  bundle_hash?: string | null;
  runtime_bindings?: Record<string, unknown> | string | null;
  manifest: Record<string, unknown> | string;
  created_at: Date | string;
}

interface ImpactRow {
  id: string;
  project_id: string;
  source_version_id: string;
  affected_phases: string[] | string;
  reason: string;
  operation_id?: string | null;
  previous_source_version_id?: string | null;
  schema_version?: number | string | null;
  detector_version?: string | null;
  basis_hash?: string | null;
  manifest_hash?: string | null;
  manifest?: Record<string, unknown> | string | null;
  created_at: Date | string;
}

interface ArtifactVersionRow {
  id: string;
  project_id: string;
  execution_id: string | null;
  knowledge_snapshot_id: string | null;
  source_version_id: string | null;
  operation_id: string | null;
  artifact_key: string;
  artifact_kind: string;
  version: number | string;
  content_hash: string;
  size_bytes: number | string;
  activity_id?: string | null;
  workflow_run_id?: string | null;
  workflow_node_id?: string | null;
  display_name?: string | null;
  summary?: string | null;
  media_type?: string | null;
  schema_id?: string | null;
  schema_version?: string | null;
  visibility?: 'user' | 'technical' | null;
  status?: 'pending' | 'current' | 'stale' | 'superseded' | 'failed' | null;
  stale_reason?: string | null;
  source_version_ids?: string[] | string | null;
  parent_resource_ids?: string[] | string | null;
  created_at: Date | string;
}

interface LifecycleAttemptRow {
  id: string;
  project_id: string;
  sequence: number | string;
  base_attempt_id: string | null;
  start_activity_id: string;
  scope: System3LifecycleAttemptScope;
  input_mode: System3LifecycleAttemptInputMode;
  basis: System3LifecycleAttemptBasis | string;
  preview_hash: string;
  conversation_id: string | null;
  isolation_environment_id: string | null;
  branch_name: string | null;
  working_path: string | null;
  lifecycle_status: System3LifecycleAttemptStatus;
  run_status: System3LifecycleAttemptRunStatus;
  cleanup_status: System3LifecycleAttemptCleanupStatus;
  checkpoint_activity_id: string | null;
  next_activity_id: string | null;
  cleanup_manifest: Record<string, unknown> | string | null;
  created_by_user_id: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  cleaned_at: Date | string | null;
}

function iso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  // SQLite CURRENT_TIMESTAMP is UTC but omits both the T separator and zone.
  // Parse that canonical storage form as UTC instead of the host's local zone.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  return new Date(normalized).toISOString();
}

function jsonObject<T>(value: T | string): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function precreatedSystem3Run(
  input: {
    projectId: string;
    executionId: string;
    conversationId: string;
    codebaseId: string;
    userId?: string;
    workingPath: string;
    bundleSnapshotId?: string;
    bundleHash?: string;
    runtimeBindings?: Record<string, unknown>;
  },
  workflowRunId: string,
  kind: 'verification' | 'delivery'
): System3PrecreatedWorkflowRun {
  const now = new Date();
  const title = kind === 'verification' ? 'Verify' : 'Deliver';
  return {
    id: workflowRunId,
    workflow_name: `system3-customer-churn-${kind}`,
    conversation_id: input.conversationId,
    parent_conversation_id: null,
    parent_workflow_run_id: null,
    parent_node_id: null,
    codebase_id: input.codebaseId,
    status: 'pending',
    user_message: `${title} System 3 execution ${input.executionId}`,
    metadata: {
      system3ProjectId: input.projectId,
      system3ExecutionId: input.executionId,
      system3OperationType: kind,
      ...(input.bundleSnapshotId
        ? {
            system3BundleSnapshotId: input.bundleSnapshotId,
            system3BundleHash: input.bundleHash,
            system3RuntimeBindings: input.runtimeBindings,
          }
        : {}),
    },
    started_at: now,
    completed_at: null,
    last_activity_at: now,
    working_path: input.workingPath,
    user_id: input.userId ?? null,
  };
}

function asProject(row: ProjectRow): System3ProjectRecord {
  return {
    id: row.id,
    codebaseId: row.codebase_id,
    name: row.name,
    description: row.description ?? '',
    stage: row.stage,
    attention: row.attention,
    freshness: row.freshness,
    version: Number(row.version),
    templateId: row.template_id,
    activeKnowledgeSnapshotId: row.active_knowledge_snapshot_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function asSource(row: SourceRow): System3SourceRecord {
  return {
    id: row.id,
    sourceId: row.source_id ?? row.id,
    projectId: row.project_id,
    kind: row.kind,
    role: row.role ?? 'primary',
    filename: row.filename,
    originalFilename: row.original_filename ?? row.filename,
    mediaType: row.media_type ?? 'application/octet-stream',
    version: Number(row.lineage_version ?? row.version),
    contentHash: row.content_hash,
    sizeBytes: Number(row.size_bytes),
    storageKey: row.storage_key,
    storageStatus: row.storage_status ?? 'ready',
    validationReport:
      row.validation_report === null
        ? { schemaVersion: 1, outcome: 'accepted', checks: [], warnings: [] }
        : jsonObject<System3SourceValidationReport>(row.validation_report),
    createdBy: row.created_by_user_id,
    origin: row.origin ?? 'legacy',
    operationId: row.operation_id,
    intakeReportArtifactId: row.intake_report_artifact_id,
    createdAt: iso(row.created_at),
  };
}

function asSnapshot(row: SnapshotRow): System3KnowledgeSnapshotRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    analysis: jsonObject<BlueprintAnalysis>(row.analysis),
    artifactKey: row.artifact_key,
    workflowRunId: row.workflow_run_id ?? null,
    inputSnapshotId: row.input_snapshot_id ?? null,
    schemaVersion: Number(row.schema_version ?? 1),
    lifecycleStatus: row.lifecycle_status ?? 'superseded',
    qualityStatus: row.quality_status ?? null,
    qualityReport:
      row.quality_report === null ? null : jsonObject<ExtractionQuality>(row.quality_report),
    activatedAt: row.activated_at === null ? null : iso(row.activated_at),
    activatedBy: row.activated_by_user_id ?? null,
    createdAt: iso(row.created_at),
  };
}

function asUnderstandingInputSnapshot(
  row: UnderstandingInputSnapshotRow
): System3UnderstandingInputSnapshotRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    operationId: row.operation_id,
    knowledgeSnapshotId: row.knowledge_snapshot_id,
    workflowRunId: row.workflow_run_id,
    sourceIds: jsonObject<string[]>(row.source_ids),
    sourceHashes: jsonObject<string[]>(row.source_hashes),
    sourceRefs:
      row.source_refs === null
        ? jsonObject<string[]>(row.source_ids).map((sourceVersionId, index) => ({
            sourceVersionId,
            kind: 'supporting_document' as const,
            filename: 'Nguồn lịch sử',
            mediaType: 'application/octet-stream',
            contentHash: jsonObject<string[]>(row.source_hashes)[index] ?? 'sha256:legacy',
          }))
        : jsonObject<System3UnderstandingInputSnapshotRecord['sourceRefs']>(row.source_refs),
    parserVersion: row.parser_version,
    extractionPolicyVersion: row.extraction_policy_version,
    capabilityRegistryHash: row.capability_registry_hash,
    runtimeProfile: jsonObject<Record<string, unknown>>(row.runtime_profile),
    createdAt: iso(row.created_at),
  };
}

function asReadinessContract(row: ReadinessContractRow): System3ReadinessContractRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    knowledgeSnapshotId: row.knowledge_snapshot_id,
    workflowRunId: row.workflow_run_id,
    contract: jsonObject<Record<string, unknown>>(row.contract),
    contractHash: row.contract_hash,
    artifactKey: row.artifact_key,
    createdAt: iso(row.created_at),
  };
}

function asDecision(row: DecisionRow): System3DecisionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    knowledgeSnapshotId: row.knowledge_snapshot_id,
    title: row.title,
    question: row.question,
    why: row.why,
    recommendation: row.recommendation,
    options: jsonObject<string[]>(row.options),
    binding: row.binding === null ? null : jsonObject<UnderstandingDecisionBinding>(row.binding),
    affectedPhases: jsonObject<string[]>(row.affected_phases),
    status: row.status,
    answer: row.answer,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function asCompilation(row: CompilationRow): System3CompilationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    knowledgeSnapshotId: row.knowledge_snapshot_id,
    plan: jsonObject<System3ExecutionPlan>(row.plan),
    definitionHash: row.definition_hash,
    capabilityRegistryHash: row.capability_registry_hash,
    createdAt: iso(row.created_at),
  };
}

function asWorkflowBundleSnapshot(
  row: WorkflowBundleSnapshotRow
): System3WorkflowBundleSnapshotRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    compilationId: row.compilation_id,
    activityId: row.activity_id,
    schemaVersion: Number(row.schema_version) as 3,
    compilerVersion: row.compiler_version as 'system3-compiler@3',
    templateId: row.template_id as 'customer-churn-reference@1',
    executionMode: row.execution_mode,
    definition: jsonObject<System3WorkflowBundleSnapshot['definition']>(row.definition),
    definitionHash: row.definition_hash,
    createdAt: iso(row.created_at),
  };
}

function asApproval(row: ApprovalRow): System3ApprovalRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    compilationId: row.compilation_id,
    idempotencyKey: row.idempotency_key,
    manifest: jsonObject<System3ApprovalManifest>(row.manifest),
    createdAt: iso(row.created_at),
  };
}

function asExecution(row: ExecutionRow): System3ExecutionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    approvalId: row.approval_id,
    workflowRunId: row.workflow_run_id,
    definitionHash: row.definition_hash,
    bundleSnapshotId: row.bundle_snapshot_id ?? null,
    bundleHash: row.bundle_hash ?? null,
    runtimeBindings:
      row.runtime_bindings === null || row.runtime_bindings === undefined
        ? null
        : jsonObject<Record<string, unknown>>(row.runtime_bindings),
    status: row.status,
    error: row.error,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function asOperation(row: OperationRow): System3OperationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    executionId: row.execution_id,
    workflowRunId: row.workflow_run_id,
    type: row.operation_type,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint ?? '',
    projectVersion: Number(row.project_version ?? 0),
    result: row.result == null ? null : jsonObject<Record<string, unknown>>(row.result),
    ownerInstanceId: row.owner_instance_id ?? null,
    heartbeatAt:
      row.heartbeat_at === null || row.heartbeat_at === undefined ? null : iso(row.heartbeat_at),
    startedAt: row.started_at === null || row.started_at === undefined ? null : iso(row.started_at),
    finishedAt:
      row.finished_at === null || row.finished_at === undefined ? null : iso(row.finished_at),
    error: row.error,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function asEvidence(row: EvidenceRow): System3EvidenceRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    executionId: row.execution_id,
    verificationId: row.verification_id ?? null,
    requirementId: row.requirement_id,
    status: row.status,
    validatorVersion: row.validator_version ?? 'system3-validator@1',
    basisHash: row.basis_hash ?? 'legacy',
    evidence: jsonObject<string[]>(row.evidence),
    reason: row.reason,
    createdAt: iso(row.created_at),
  };
}

function asVerification(row: VerificationRow): System3VerificationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    executionId: row.execution_id,
    workflowRunId: row.workflow_run_id,
    inputArtifactId: row.input_artifact_id,
    status: row.status,
    validatorVersion: row.validator_version,
    basisHash: row.basis_hash,
    bundleSnapshotId: row.bundle_snapshot_id ?? null,
    bundleHash: row.bundle_hash ?? null,
    runtimeBindings:
      row.runtime_bindings === null || row.runtime_bindings === undefined
        ? null
        : jsonObject<Record<string, unknown>>(row.runtime_bindings),
    evidenceMap:
      row.evidence_map === null ? null : jsonObject<Record<string, unknown>>(row.evidence_map),
    gate: row.gate === null ? null : jsonObject<Record<string, unknown>>(row.gate),
    error: row.error,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function asDelivery(row: DeliveryRow): System3DeliveryRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    executionId: row.execution_id,
    verificationId: row.verification_id ?? null,
    packageStorageKey: row.package_storage_key,
    packageFilename: row.package_filename,
    contentHash: row.content_hash,
    sizeBytes: Number(row.size_bytes),
    bundleSnapshotId: row.bundle_snapshot_id ?? null,
    bundleHash: row.bundle_hash ?? null,
    runtimeBindings:
      row.runtime_bindings === null || row.runtime_bindings === undefined
        ? null
        : jsonObject<Record<string, unknown>>(row.runtime_bindings),
    manifest: jsonObject<Record<string, unknown>>(row.manifest),
    createdAt: iso(row.created_at),
  };
}

function asImpact(row: ImpactRow): System3ImpactManifestRecord {
  const storedPhases = jsonObject<string[]>(row.affected_phases);
  const rawManifest =
    row.manifest === null || row.manifest === undefined ? null : jsonObject<unknown>(row.manifest);
  const parsedManifest =
    rawManifest === null ? null : system3ImpactManifestSchema.safeParse(rawManifest);
  return {
    id: row.id,
    projectId: row.project_id,
    sourceVersionId: row.source_version_id,
    affectedPhases: system3PhaseOrder.filter(phase => storedPhases.includes(phase)),
    reason: row.reason,
    operationId: row.operation_id ?? null,
    previousSourceVersionId: row.previous_source_version_id ?? null,
    schemaVersion: parsedManifest?.success === true ? parsedManifest.data.schemaVersion : 1,
    detectorVersion: row.detector_version ?? 'system3-change-detector@1',
    basisHash: row.basis_hash ?? `legacy:${row.id}`,
    manifestHash: row.manifest_hash ?? `legacy:${row.id}`,
    manifest: parsedManifest?.success === true ? parsedManifest.data : null,
    createdAt: iso(row.created_at),
  };
}

function asArtifactVersion(row: ArtifactVersionRow): System3ArtifactVersionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    executionId: row.execution_id,
    knowledgeSnapshotId: row.knowledge_snapshot_id,
    sourceVersionId: row.source_version_id,
    operationId: row.operation_id,
    artifactKey: row.artifact_key,
    artifactKind: row.artifact_kind,
    version: Number(row.version),
    contentHash: row.content_hash,
    sizeBytes: Number(row.size_bytes),
    activityId: row.activity_id ?? null,
    workflowRunId: row.workflow_run_id ?? null,
    workflowNodeId: row.workflow_node_id ?? null,
    displayName: row.display_name ?? null,
    summary: row.summary ?? null,
    mediaType: row.media_type ?? null,
    schemaId: row.schema_id ?? null,
    schemaVersion: row.schema_version ?? null,
    visibility: row.visibility ?? null,
    status: row.status ?? null,
    staleReason: row.stale_reason ?? null,
    sourceVersionIds:
      row.source_version_ids === null || row.source_version_ids === undefined
        ? []
        : jsonObject<string[]>(row.source_version_ids),
    parentResourceIds:
      row.parent_resource_ids === null || row.parent_resource_ids === undefined
        ? []
        : jsonObject<string[]>(row.parent_resource_ids),
    createdAt: iso(row.created_at),
  };
}

function asLifecycleAttempt(row: LifecycleAttemptRow): System3LifecycleAttemptRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    sequence: Number(row.sequence),
    baseAttemptId: row.base_attempt_id,
    startActivityId: row.start_activity_id,
    scope: row.scope,
    inputMode: row.input_mode,
    basis: jsonObject<System3LifecycleAttemptBasis>(row.basis),
    previewHash: row.preview_hash,
    conversationId: row.conversation_id,
    isolationEnvironmentId: row.isolation_environment_id,
    branchName: row.branch_name,
    workingPath: row.working_path,
    lifecycleStatus: row.lifecycle_status,
    runStatus: row.run_status,
    cleanupStatus: row.cleanup_status,
    checkpointActivityId: row.checkpoint_activity_id,
    nextActivityId: row.next_activity_id,
    cleanupManifest:
      row.cleanup_manifest === null
        ? null
        : jsonObject<Record<string, unknown>>(row.cleanup_manifest),
    createdBy: row.created_by_user_id,
    createdAt: iso(row.created_at),
    startedAt: row.started_at === null ? null : iso(row.started_at),
    completedAt: row.completed_at === null ? null : iso(row.completed_at),
    cleanedAt: row.cleaned_at === null ? null : iso(row.cleaned_at),
  };
}

function assertLifecycleAttemptReplayMatches(
  row: LifecycleAttemptRow,
  input: System3LifecycleAttemptReplayInput,
  basis?: System3LifecycleAttemptBasis
): void {
  const attempt = asLifecycleAttempt(row);
  const persistedProjectVersion = attempt.basis.resources.projectVersion;
  const requestMatches =
    attempt.previewHash === input.previewHash &&
    attempt.baseAttemptId === (input.baseAttemptId ?? null) &&
    attempt.startActivityId === input.startActivityId &&
    attempt.scope === input.scope &&
    attempt.inputMode === input.inputMode &&
    persistedProjectVersion === input.expectedVersion &&
    (basis === undefined || canonicalJson(attempt.basis) === canonicalJson(basis));
  if (!requestMatches) {
    throw new System3ConflictError(
      'Idempotency key was already used for a different Lifecycle Attempt'
    );
  }
}

function asSourceIntakeReport(row: SourceIntakeReportRow): System3SourceIntakeReportRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    operationId: row.operation_id,
    sourceVersionId: row.source_version_id,
    artifactKey: row.artifact_key,
    report: jsonObject<System3SourceIntakeReport>(row.report),
    createdAt: iso(row.created_at),
  };
}

export class System3ConflictError extends Error {}

const system3OperationHeartbeatStaleMs = 30_000;

function hasResponsiveOperationOwner(row: OperationRow): boolean {
  if (row.status !== 'running' || row.heartbeat_at === null) return false;
  const heartbeatTime = new Date(iso(row.heartbeat_at)).getTime();
  return (
    Number.isFinite(heartbeatTime) && Date.now() - heartbeatTime <= system3OperationHeartbeatStaleMs
  );
}

export class System3Store {
  private schemaReady: Promise<void> | undefined;

  constructor(private readonly database: System3Database) {}

  /**
   * PostgreSQL needs an explicit row lock because two HTTP workers can begin
   * with the same project version. SQLite's write transaction already provides
   * the equivalent serialization. This protects the check-then-create paths
   * without guessing that another process has stopped.
   */
  private async lockProject(query: System3Query, projectId: string): Promise<void> {
    if (this.database.dialect === 'postgres') {
      await query('SELECT id FROM remote_agent_system3_projects WHERE id = $1 FOR UPDATE', [
        projectId,
      ]);
    }
  }

  private async requireProjectOperationClaim(
    query: System3Query,
    input: {
      operationId: string;
      projectId: string;
      type: System3OperationType;
      ownerClaimToken: string;
    }
  ): Promise<OperationRow> {
    const updated = await query(
      `UPDATE remote_agent_system3_project_operations
       SET updated_at = updated_at
       WHERE id = $1 AND project_id = $2 AND operation_type = $3
         AND status = 'running' AND owner_claim_token = $4`,
      [input.operationId, input.projectId, input.type, input.ownerClaimToken]
    );
    if (updated.rowCount !== 1) {
      throw new System3ConflictError('Project operation claim is no longer current');
    }
    const result = await query(
      `SELECT * FROM remote_agent_system3_project_operations
       WHERE id = $1 AND project_id = $2 AND operation_type = $3
         AND status = 'running' AND owner_claim_token = $4`,
      [input.operationId, input.projectId, input.type, input.ownerClaimToken]
    );
    const operation = typedRows(result, value => value as OperationRow)[0];
    if (!operation) throw new System3ConflictError('Project operation claim is no longer current');
    return operation;
  }

  private async completeProjectOperationClaim(
    query: System3Query,
    input: {
      operationId: string;
      ownerClaimToken: string;
      result: Record<string, unknown>;
      workflowRunId?: string;
      executionId?: string;
    }
  ): Promise<void> {
    const updated = await query(
      `UPDATE remote_agent_system3_project_operations
       SET status = 'succeeded', result = $2, error = NULL,
           workflow_run_id = COALESCE($3, workflow_run_id),
           execution_id = COALESCE($4, execution_id), heartbeat_at = CURRENT_TIMESTAMP,
           finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'running' AND owner_claim_token = $5`,
      [
        input.operationId,
        JSON.stringify(input.result),
        input.workflowRunId ?? null,
        input.executionId ?? null,
        input.ownerClaimToken,
      ]
    );
    if (updated.rowCount !== 1) {
      throw new System3ConflictError('Project operation claim was lost before completion');
    }
  }

  private async transitionProject(
    query: System3Query,
    input: {
      projectId: string;
      fromStage?: System3ProjectStage;
      toStage: System3ProjectStage;
      attention?: System3Attention;
      freshness?: System3Freshness;
      actorId?: string | null;
      operationId?: string | null;
      workflowRunId?: string | null;
      entityType?: string | null;
      entityId?: string | null;
      metadata?: Record<string, unknown>;
      reason: string;
    }
  ): Promise<void> {
    const currentResult = await query(
      `SELECT stage, attention, freshness, version
       FROM remote_agent_system3_projects WHERE id = $1`,
      [input.projectId]
    );
    const current = typedRows(
      currentResult,
      value =>
        value as {
          stage: System3ProjectStage;
          attention: System3Attention;
          freshness: System3Freshness;
          version: number;
        }
    )[0];
    if (!current) throw new System3ConflictError('Project no longer exists');
    if (input.fromStage && current.stage !== input.fromStage) {
      throw new System3ConflictError(
        `Project stage changed from ${input.fromStage} to ${current.stage}`
      );
    }
    const nextAttention = input.attention ?? current.attention;
    const nextFreshness = input.freshness ?? current.freshness;
    const nextVersion = current.version + 1;
    await query(
      `UPDATE remote_agent_system3_projects
       SET stage = $1,
           attention = COALESCE($2, attention),
           freshness = COALESCE($3, freshness),
           version = version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [input.toStage, input.attention ?? null, input.freshness ?? null, input.projectId]
    );
    await query(
      `INSERT INTO remote_agent_system3_project_transitions
        (id, project_id, from_stage, to_stage, actor_id, operation_id,
         workflow_run_id, entity_type, entity_id, from_attention, to_attention,
         from_freshness, to_freshness, project_version, reason, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        randomUUID(),
        input.projectId,
        current.stage,
        input.toStage,
        input.actorId ?? null,
        input.operationId ?? null,
        input.workflowRunId ?? null,
        input.entityType ?? null,
        input.entityId ?? null,
        current.attention,
        nextAttention,
        current.freshness,
        nextFreshness,
        nextVersion,
        input.reason,
        JSON.stringify(input.metadata ?? {}),
      ]
    );
  }

  async ensureSchema(): Promise<void> {
    this.schemaReady ??= this.createSchema();
    return this.schemaReady;
  }

  private async createSchema(): Promise<void> {
    const idType = this.database.dialect === 'postgres' ? 'UUID' : 'TEXT';
    const jsonType = this.database.dialect === 'postgres' ? 'JSONB' : 'TEXT';
    const timeType = this.database.dialect === 'postgres' ? 'TIMESTAMP WITH TIME ZONE' : 'TEXT';
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS remote_agent_system3_projects (
        id ${idType} PRIMARY KEY,
        codebase_id ${idType} NOT NULL UNIQUE REFERENCES remote_agent_codebases(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        description TEXT,
        stage TEXT NOT NULL,
        attention TEXT NOT NULL,
        freshness TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        template_id TEXT NOT NULL,
        active_knowledge_snapshot_id ${idType},
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_lifecycle_attempts (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE RESTRICT,
        sequence INTEGER NOT NULL,
        base_attempt_id ${idType} REFERENCES remote_agent_system3_lifecycle_attempts(id) ON DELETE SET NULL,
        start_activity_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        input_mode TEXT NOT NULL,
        basis ${jsonType} NOT NULL,
        preview_hash TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        conversation_id ${idType},
        isolation_environment_id ${idType},
        branch_name TEXT,
        working_path TEXT,
        lifecycle_status TEXT NOT NULL DEFAULT 'active',
        run_status TEXT NOT NULL DEFAULT 'preparing',
        cleanup_status TEXT NOT NULL DEFAULT 'not_started',
        checkpoint_activity_id TEXT,
        next_activity_id TEXT,
        cleanup_manifest ${jsonType},
        created_by_user_id ${idType} REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at ${timeType},
        completed_at ${timeType},
        cleaned_at ${timeType},
        UNIQUE(project_id, sequence),
        UNIQUE(project_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_system3_lifecycle_attempts_project
        ON remote_agent_system3_lifecycle_attempts(project_id, sequence DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_system3_lifecycle_attempts_one_active
        ON remote_agent_system3_lifecycle_attempts(project_id)
        WHERE lifecycle_status = 'active';
      CREATE TABLE IF NOT EXISTS remote_agent_system3_sources (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        role TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_by_user_id ${idType} REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_source_versions (
        id ${idType} PRIMARY KEY,
        source_id ${idType} NOT NULL REFERENCES remote_agent_system3_sources(id) ON DELETE CASCADE,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        role TEXT NOT NULL,
        filename TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        media_type TEXT NOT NULL,
        version INTEGER NOT NULL,
        lineage_version INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        storage_key TEXT NOT NULL,
        storage_status TEXT NOT NULL DEFAULT 'ready',
        validation_report ${jsonType} NOT NULL,
        created_by_user_id ${idType} REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        origin TEXT NOT NULL DEFAULT 'web',
        operation_id ${idType},
        intake_report_artifact_id ${idType},
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, kind, version),
        UNIQUE(source_id, lineage_version)
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_understanding_input_snapshots (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        operation_id ${idType} NOT NULL UNIQUE,
        knowledge_snapshot_id ${idType},
        workflow_run_id ${idType} REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
        source_ids ${jsonType} NOT NULL,
        source_hashes ${jsonType} NOT NULL,
        source_refs ${jsonType},
        parser_version TEXT NOT NULL,
        extraction_policy_version TEXT NOT NULL,
        capability_registry_hash TEXT NOT NULL,
        runtime_profile ${jsonType} NOT NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_system3_understanding_inputs_project
        ON remote_agent_system3_understanding_input_snapshots(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS remote_agent_system3_knowledge_snapshots (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        analysis ${jsonType} NOT NULL,
        artifact_key TEXT NOT NULL,
        workflow_run_id ${idType} REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
        input_snapshot_id ${idType} REFERENCES remote_agent_system3_understanding_input_snapshots(id) ON DELETE SET NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        lifecycle_status TEXT,
        quality_status TEXT,
        quality_report ${jsonType},
        activated_at ${timeType},
        activated_by_user_id ${idType} REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_readiness_contracts (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        knowledge_snapshot_id ${idType} NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE RESTRICT,
        workflow_run_id ${idType} NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE RESTRICT,
        contract ${jsonType} NOT NULL,
        contract_hash TEXT NOT NULL,
        artifact_key TEXT NOT NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_decisions (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        knowledge_snapshot_id ${idType} NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        question TEXT NOT NULL,
        why TEXT NOT NULL,
        recommendation TEXT NOT NULL,
        options ${jsonType} NOT NULL,
        binding ${jsonType},
        affected_phases ${jsonType} NOT NULL,
        status TEXT NOT NULL,
        answer TEXT,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_compilations (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        knowledge_snapshot_id ${idType} NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE RESTRICT,
        plan ${jsonType} NOT NULL,
        definition_hash TEXT NOT NULL,
        capability_registry_hash TEXT NOT NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_product_workflow_versions (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        template_id TEXT NOT NULL,
        definition_hash TEXT NOT NULL,
        definition ${jsonType} NOT NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_runtime_profile_versions (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        profile_hash TEXT NOT NULL,
        profile ${jsonType} NOT NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, profile_hash)
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_input_snapshots (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        knowledge_snapshot_id ${idType} NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE RESTRICT,
        source_ids ${jsonType} NOT NULL,
        source_hashes ${jsonType} NOT NULL,
        runtime_profile_version_id ${idType} NOT NULL REFERENCES remote_agent_system3_runtime_profile_versions(id) ON DELETE RESTRICT,
        runtime_profile_hash TEXT NOT NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_capability_registry_snapshots (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        registry_hash TEXT NOT NULL,
        registry ${jsonType} NOT NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_compilation_bases (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        compilation_id ${idType} NOT NULL UNIQUE REFERENCES remote_agent_system3_compilations(id) ON DELETE CASCADE,
        product_workflow_version_id ${idType} NOT NULL REFERENCES remote_agent_system3_product_workflow_versions(id) ON DELETE RESTRICT,
        input_snapshot_id ${idType} NOT NULL REFERENCES remote_agent_system3_input_snapshots(id) ON DELETE RESTRICT,
        capability_registry_snapshot_id ${idType} NOT NULL REFERENCES remote_agent_system3_capability_registry_snapshots(id) ON DELETE RESTRICT,
        compiler_version TEXT NOT NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_execution_plan_snapshots (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        compilation_id ${idType} NOT NULL UNIQUE REFERENCES remote_agent_system3_compilations(id) ON DELETE CASCADE,
        definition_hash TEXT NOT NULL,
        plan ${jsonType} NOT NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_workflow_bundle_snapshots (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        compilation_id ${idType} NOT NULL REFERENCES remote_agent_system3_compilations(id) ON DELETE CASCADE,
        activity_id TEXT NOT NULL CHECK (activity_id IN ('TW-06', 'TW-07', 'TW-09')),
        schema_version INTEGER NOT NULL,
        compiler_version TEXT NOT NULL,
        template_id TEXT NOT NULL,
        execution_mode TEXT NOT NULL CHECK (execution_mode IN ('full', 'experiment', 'delivery')),
        definition ${jsonType} NOT NULL,
        definition_hash TEXT NOT NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(compilation_id, activity_id)
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_project_transitions (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        from_stage TEXT,
        to_stage TEXT NOT NULL,
        actor_id ${idType} REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        operation_id ${idType},
        workflow_run_id ${idType} REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
        entity_type TEXT,
        entity_id TEXT,
        from_attention TEXT,
        to_attention TEXT,
        from_freshness TEXT,
        to_freshness TEXT,
        project_version INTEGER,
        metadata ${jsonType} NOT NULL DEFAULT '{}',
        reason TEXT NOT NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_approval_manifests (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        compilation_id ${idType} NOT NULL REFERENCES remote_agent_system3_compilations(id) ON DELETE RESTRICT,
        idempotency_key TEXT NOT NULL,
        manifest ${jsonType} NOT NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_project_executions (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        approval_id ${idType} NOT NULL REFERENCES remote_agent_system3_approval_manifests(id) ON DELETE RESTRICT,
        workflow_run_id ${idType} NOT NULL UNIQUE REFERENCES remote_agent_workflow_runs(id) ON DELETE RESTRICT,
        definition_hash TEXT NOT NULL,
        bundle_snapshot_id ${idType} REFERENCES remote_agent_system3_workflow_bundle_snapshots(id) ON DELETE RESTRICT,
        bundle_hash TEXT,
        runtime_bindings ${jsonType},
        status TEXT NOT NULL,
        error TEXT,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_operations (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        execution_id ${idType} NOT NULL REFERENCES remote_agent_system3_project_executions(id) ON DELETE CASCADE,
        operation_type TEXT NOT NULL,
        status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        error TEXT,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, operation_type, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_project_operations (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        operation_type TEXT NOT NULL,
        execution_id ${idType} REFERENCES remote_agent_system3_project_executions(id) ON DELETE SET NULL,
        workflow_run_id ${idType} REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        project_version INTEGER NOT NULL,
        result ${jsonType},
        error TEXT,
        owner_instance_id TEXT,
        heartbeat_at ${timeType},
        started_at ${timeType},
        finished_at ${timeType},
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, operation_type, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_source_intake_reports (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        operation_id ${idType} NOT NULL UNIQUE REFERENCES remote_agent_system3_project_operations(id) ON DELETE CASCADE,
        source_version_id ${idType} REFERENCES remote_agent_system3_source_versions(id) ON DELETE SET NULL,
        artifact_key TEXT NOT NULL,
        report ${jsonType} NOT NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_verifications (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        execution_id ${idType} NOT NULL REFERENCES remote_agent_system3_project_executions(id) ON DELETE RESTRICT,
        workflow_run_id ${idType} NOT NULL UNIQUE REFERENCES remote_agent_workflow_runs(id) ON DELETE RESTRICT,
        input_artifact_id ${idType} NOT NULL,
        status TEXT NOT NULL,
        validator_version TEXT NOT NULL,
        basis_hash TEXT NOT NULL,
        bundle_snapshot_id ${idType} REFERENCES remote_agent_system3_workflow_bundle_snapshots(id) ON DELETE RESTRICT,
        bundle_hash TEXT,
        runtime_bindings ${jsonType},
        evidence_map ${jsonType},
        gate ${jsonType},
        error TEXT,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_evidence_records (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        execution_id ${idType} NOT NULL REFERENCES remote_agent_system3_project_executions(id) ON DELETE CASCADE,
        verification_id ${idType} REFERENCES remote_agent_system3_verifications(id) ON DELETE RESTRICT,
        requirement_id TEXT,
        status TEXT NOT NULL,
        validator_version TEXT NOT NULL DEFAULT 'system3-validator@1',
        basis_hash TEXT NOT NULL DEFAULT 'legacy',
        evidence ${jsonType} NOT NULL,
        reason TEXT,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_delivery_manifests (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        execution_id ${idType} NOT NULL UNIQUE REFERENCES remote_agent_system3_project_executions(id) ON DELETE CASCADE,
        verification_id ${idType} REFERENCES remote_agent_system3_verifications(id) ON DELETE RESTRICT,
        package_storage_key TEXT NOT NULL,
        package_filename TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        bundle_snapshot_id ${idType} REFERENCES remote_agent_system3_workflow_bundle_snapshots(id) ON DELETE RESTRICT,
        bundle_hash TEXT,
        runtime_bindings ${jsonType},
        manifest ${jsonType} NOT NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_impact_manifests (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        source_version_id ${idType} NOT NULL REFERENCES remote_agent_system3_source_versions(id) ON DELETE CASCADE,
        operation_id ${idType} REFERENCES remote_agent_system3_project_operations(id) ON DELETE SET NULL,
        previous_source_version_id ${idType} REFERENCES remote_agent_system3_source_versions(id) ON DELETE SET NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        detector_version TEXT NOT NULL DEFAULT 'system3-change-detector@1',
        basis_hash TEXT,
        manifest_hash TEXT,
        manifest ${jsonType},
        affected_phases ${jsonType} NOT NULL,
        reason TEXT NOT NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_requirements (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        knowledge_snapshot_id ${idType} NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE CASCADE,
        requirement_key TEXT NOT NULL, kind TEXT NOT NULL, priority TEXT, source TEXT,
        statement TEXT NOT NULL, acceptance_criterion TEXT NOT NULL, source_pointer TEXT NOT NULL,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(knowledge_snapshot_id, requirement_key)
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_knowledge_facts (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        knowledge_snapshot_id ${idType} NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE CASCADE,
        fact_key TEXT NOT NULL, value ${jsonType} NOT NULL, source_pointer TEXT,
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(knowledge_snapshot_id, fact_key)
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_open_issues (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        knowledge_snapshot_id ${idType} NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE CASCADE,
        issue_key TEXT NOT NULL, title TEXT NOT NULL, source_pointer TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(knowledge_snapshot_id, issue_key)
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_dependency_edges (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        from_kind TEXT NOT NULL, from_id TEXT NOT NULL, to_kind TEXT NOT NULL, to_id TEXT NOT NULL,
        reason TEXT NOT NULL, created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, from_kind, from_id, to_kind, to_id)
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_artifact_versions (
        id ${idType} PRIMARY KEY,
        project_id ${idType} NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        execution_id ${idType} REFERENCES remote_agent_system3_project_executions(id) ON DELETE CASCADE,
        knowledge_snapshot_id ${idType} REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE CASCADE,
        source_version_id ${idType} REFERENCES remote_agent_system3_source_versions(id) ON DELETE SET NULL,
        operation_id ${idType} REFERENCES remote_agent_system3_project_operations(id) ON DELETE SET NULL,
        artifact_key TEXT NOT NULL, artifact_kind TEXT NOT NULL, version INTEGER NOT NULL,
        content_hash TEXT NOT NULL, size_bytes INTEGER NOT NULL,
        activity_id TEXT, workflow_run_id ${idType}, workflow_node_id TEXT,
        display_name TEXT, summary TEXT, media_type TEXT, schema_id TEXT, schema_version TEXT,
        visibility TEXT, status TEXT, stale_reason TEXT,
        source_version_ids ${jsonType}, parent_resource_ids ${jsonType},
        created_at ${timeType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, artifact_key, version)
      );
      CREATE INDEX IF NOT EXISTS idx_system3_sources_project_kind
        ON remote_agent_system3_source_versions(project_id, kind, version DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_source_lineage_versions
        ON remote_agent_system3_source_versions(source_id, lineage_version DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_source_intake_reports_project
        ON remote_agent_system3_source_intake_reports(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_snapshots_project
        ON remote_agent_system3_knowledge_snapshots(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_readiness_project
        ON remote_agent_system3_readiness_contracts(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_decisions_project_status
        ON remote_agent_system3_decisions(project_id, status, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_system3_compilations_project
        ON remote_agent_system3_compilations(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_workflow_bundle_snapshots_project
        ON remote_agent_system3_workflow_bundle_snapshots(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_workflow_bundle_snapshots_compilation
        ON remote_agent_system3_workflow_bundle_snapshots(compilation_id, activity_id);
      CREATE INDEX IF NOT EXISTS idx_system3_workflow_versions_project
        ON remote_agent_system3_product_workflow_versions(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_transitions_project
        ON remote_agent_system3_project_transitions(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_executions_project
        ON remote_agent_system3_project_executions(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_operations_project
        ON remote_agent_system3_operations(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_project_operations_project
        ON remote_agent_system3_project_operations(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_project_operations_status
        ON remote_agent_system3_project_operations(status, updated_at ASC);
      CREATE INDEX IF NOT EXISTS idx_system3_evidence_execution
        ON remote_agent_system3_evidence_records(execution_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_system3_impacts_project
        ON remote_agent_system3_impact_manifests(project_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_system3_impacts_source_basis_detector
        ON remote_agent_system3_impact_manifests(source_version_id, basis_hash, detector_version);
      CREATE INDEX IF NOT EXISTS idx_system3_requirements_project
        ON remote_agent_system3_requirements(project_id, knowledge_snapshot_id);
      CREATE INDEX IF NOT EXISTS idx_system3_dependency_edges_project
        ON remote_agent_system3_dependency_edges(project_id, from_kind, from_id);
      CREATE INDEX IF NOT EXISTS idx_system3_artifacts_project
        ON remote_agent_system3_artifact_versions(project_id, created_at DESC);
    `);
    await this.upgradeSourceIntakeSchema();
    await this.upgradeImpactManifestSchema();
    await this.upgradeUnderstandingV2Schema();
    await this.upgradeDecisionSchema();
    await this.upgradeWorkflowBundleSchema();
  }

  private async upgradeWorkflowBundleSchema(): Promise<void> {
    const idType = this.database.dialect === 'postgres' ? 'UUID' : 'TEXT';
    const jsonType = this.database.dialect === 'postgres' ? 'JSONB' : 'TEXT';
    const tables = [
      'remote_agent_system3_project_executions',
      'remote_agent_system3_verifications',
      'remote_agent_system3_delivery_manifests',
    ] as const;
    if (this.database.dialect === 'postgres') {
      for (const table of tables) {
        await this.database.query(`
          ALTER TABLE ${table}
            ADD COLUMN IF NOT EXISTS bundle_snapshot_id ${idType}
              REFERENCES remote_agent_system3_workflow_bundle_snapshots(id) ON DELETE RESTRICT;
          ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS bundle_hash TEXT;
          ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS runtime_bindings ${jsonType};
        `);
      }
      return;
    }
    for (const table of tables) {
      const columnsResult = await this.database.query(
        `SELECT name FROM pragma_table_info('${table}')`
      );
      const columns = new Set(columnsResult.rows.map(value => (value as { name: string }).name));
      if (!columns.has('bundle_snapshot_id')) {
        await this.database.query(`ALTER TABLE ${table} ADD COLUMN bundle_snapshot_id ${idType}`);
      }
      if (!columns.has('bundle_hash')) {
        await this.database.query(`ALTER TABLE ${table} ADD COLUMN bundle_hash TEXT`);
      }
      if (!columns.has('runtime_bindings')) {
        await this.database.query(`ALTER TABLE ${table} ADD COLUMN runtime_bindings ${jsonType}`);
      }
    }
  }

  private async upgradeDecisionSchema(): Promise<void> {
    if (this.database.dialect === 'postgres') {
      await this.database.query(
        'ALTER TABLE remote_agent_system3_decisions ADD COLUMN IF NOT EXISTS binding JSONB'
      );
      return;
    }
    const columnsResult = await this.database.query(
      "SELECT name FROM pragma_table_info('remote_agent_system3_decisions')"
    );
    const columns = new Set(columnsResult.rows.map(value => (value as { name: string }).name));
    if (!columns.has('binding')) {
      await this.database.query(
        'ALTER TABLE remote_agent_system3_decisions ADD COLUMN binding TEXT'
      );
    }
  }

  private async upgradeUnderstandingV2Schema(): Promise<void> {
    if (this.database.dialect === 'postgres') {
      await this.database.query(`
        ALTER TABLE remote_agent_system3_understanding_input_snapshots ADD COLUMN IF NOT EXISTS source_refs JSONB;
        ALTER TABLE remote_agent_system3_knowledge_snapshots ADD COLUMN IF NOT EXISTS input_snapshot_id UUID REFERENCES remote_agent_system3_understanding_input_snapshots(id) ON DELETE SET NULL;
        ALTER TABLE remote_agent_system3_knowledge_snapshots ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE remote_agent_system3_knowledge_snapshots ADD COLUMN IF NOT EXISTS lifecycle_status TEXT;
        ALTER TABLE remote_agent_system3_knowledge_snapshots ADD COLUMN IF NOT EXISTS quality_status TEXT;
        ALTER TABLE remote_agent_system3_knowledge_snapshots ADD COLUMN IF NOT EXISTS quality_report JSONB;
        ALTER TABLE remote_agent_system3_knowledge_snapshots ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
        ALTER TABLE remote_agent_system3_knowledge_snapshots ADD COLUMN IF NOT EXISTS activated_by_user_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL;
        UPDATE remote_agent_system3_knowledge_snapshots snapshot
        SET lifecycle_status = CASE
          WHEN snapshot.id = project.active_knowledge_snapshot_id THEN 'active'
          ELSE 'superseded'
        END
        FROM remote_agent_system3_projects project
        WHERE project.id = snapshot.project_id AND snapshot.lifecycle_status IS NULL;
        UPDATE remote_agent_system3_knowledge_snapshots snapshot
        SET input_snapshot_id = input.id
        FROM remote_agent_system3_understanding_input_snapshots input
        WHERE input.project_id = snapshot.project_id
          AND input.knowledge_snapshot_id = snapshot.id
          AND snapshot.input_snapshot_id IS NULL;
        CREATE INDEX IF NOT EXISTS idx_system3_snapshots_project_lifecycle
          ON remote_agent_system3_knowledge_snapshots(project_id, lifecycle_status, created_at DESC);
      `);
      return;
    }
    const inputColumnsResult = await this.database.query(
      "SELECT name FROM pragma_table_info('remote_agent_system3_understanding_input_snapshots')"
    );
    const inputColumns = new Set(
      inputColumnsResult.rows.map(value => (value as { name: string }).name)
    );
    if (!inputColumns.has('source_refs')) {
      await this.database.query(
        'ALTER TABLE remote_agent_system3_understanding_input_snapshots ADD COLUMN source_refs TEXT'
      );
    }
    const snapshotColumnsResult = await this.database.query(
      "SELECT name FROM pragma_table_info('remote_agent_system3_knowledge_snapshots')"
    );
    const snapshotColumns = new Set(
      snapshotColumnsResult.rows.map(value => (value as { name: string }).name)
    );
    for (const [column, definition] of [
      ['input_snapshot_id', 'TEXT'],
      ['schema_version', 'INTEGER NOT NULL DEFAULT 1'],
      ['lifecycle_status', 'TEXT'],
      ['quality_status', 'TEXT'],
      ['quality_report', 'TEXT'],
      ['activated_at', 'TEXT'],
      ['activated_by_user_id', 'TEXT'],
    ] as const) {
      if (!snapshotColumns.has(column)) {
        await this.database.query(
          `ALTER TABLE remote_agent_system3_knowledge_snapshots ADD COLUMN ${column} ${definition}`
        );
      }
    }
    await this.database.query(
      `UPDATE remote_agent_system3_knowledge_snapshots
       SET lifecycle_status = CASE
         WHEN id = (
           SELECT active_knowledge_snapshot_id FROM remote_agent_system3_projects project
           WHERE project.id = remote_agent_system3_knowledge_snapshots.project_id
         ) THEN 'active' ELSE 'superseded' END
       WHERE lifecycle_status IS NULL`
    );
    await this.database.query(
      `UPDATE remote_agent_system3_knowledge_snapshots
       SET input_snapshot_id = (
         SELECT input.id FROM remote_agent_system3_understanding_input_snapshots input
         WHERE input.project_id = remote_agent_system3_knowledge_snapshots.project_id
           AND input.knowledge_snapshot_id = remote_agent_system3_knowledge_snapshots.id
         ORDER BY input.created_at DESC LIMIT 1
       ) WHERE input_snapshot_id IS NULL`
    );
    await this.database.query(
      'CREATE INDEX IF NOT EXISTS idx_system3_snapshots_project_lifecycle ON remote_agent_system3_knowledge_snapshots(project_id, lifecycle_status, created_at DESC)'
    );
  }

  private async upgradeImpactManifestSchema(): Promise<void> {
    if (this.database.dialect === 'postgres') {
      await this.database.query(`
        ALTER TABLE remote_agent_system3_impact_manifests ADD COLUMN IF NOT EXISTS operation_id UUID REFERENCES remote_agent_system3_project_operations(id) ON DELETE SET NULL;
        ALTER TABLE remote_agent_system3_impact_manifests ADD COLUMN IF NOT EXISTS previous_source_version_id UUID REFERENCES remote_agent_system3_source_versions(id) ON DELETE SET NULL;
        ALTER TABLE remote_agent_system3_impact_manifests ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE remote_agent_system3_impact_manifests ADD COLUMN IF NOT EXISTS detector_version TEXT NOT NULL DEFAULT 'system3-change-detector@1';
        ALTER TABLE remote_agent_system3_impact_manifests ADD COLUMN IF NOT EXISTS basis_hash TEXT;
        ALTER TABLE remote_agent_system3_impact_manifests ADD COLUMN IF NOT EXISTS manifest_hash TEXT;
        ALTER TABLE remote_agent_system3_impact_manifests ADD COLUMN IF NOT EXISTS manifest JSONB;
        UPDATE remote_agent_system3_impact_manifests
        SET basis_hash = COALESCE(basis_hash, 'legacy:' || id::text),
            manifest_hash = COALESCE(manifest_hash, 'legacy:' || id::text)
        WHERE basis_hash IS NULL OR manifest_hash IS NULL;
        DROP INDEX IF EXISTS idx_system3_impacts_source_version;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_system3_impacts_source_basis_detector
          ON remote_agent_system3_impact_manifests(source_version_id, basis_hash, detector_version);
        CREATE INDEX IF NOT EXISTS idx_system3_impacts_operation
          ON remote_agent_system3_impact_manifests(operation_id);
      `);
      return;
    }
    const result = await this.database.query(
      "SELECT name FROM pragma_table_info('remote_agent_system3_impact_manifests')"
    );
    const columns = new Set(result.rows.map(value => (value as { name: string }).name));
    for (const [column, definition] of [
      ['operation_id', 'TEXT'],
      ['previous_source_version_id', 'TEXT'],
      ['schema_version', 'INTEGER NOT NULL DEFAULT 1'],
      ['detector_version', "TEXT NOT NULL DEFAULT 'system3-change-detector@1'"],
      ['basis_hash', 'TEXT'],
      ['manifest_hash', 'TEXT'],
      ['manifest', 'TEXT'],
    ] as const) {
      if (!columns.has(column)) {
        await this.database.query(
          `ALTER TABLE remote_agent_system3_impact_manifests ADD COLUMN ${column} ${definition}`
        );
      }
    }
    await this.database.query(
      `UPDATE remote_agent_system3_artifact_versions
       SET activity_id = COALESCE(activity_id,
             CASE artifact_kind
               WHEN 'source_intake_report' THEN 'OP-00'
               WHEN 'knowledge_snapshot' THEN 'TW-02'
               WHEN 'baseline_package' THEN 'TW-06'
               WHEN 'verification_report' THEN 'TW-07'
               WHEN 'delivery_package' THEN 'TW-09'
               ELSE NULL
             END),
           display_name = COALESCE(display_name,
             CASE artifact_kind
               WHEN 'source_intake_report' THEN 'Báo cáo tiếp nhận nguồn'
               WHEN 'knowledge_snapshot' THEN 'Bản hiểu dự án'
               WHEN 'baseline_package' THEN 'Gói kết quả thực thi'
               WHEN 'delivery_package' THEN 'Gói bàn giao'
               ELSE artifact_kind
             END),
           summary = COALESCE(summary, 'Kết quả lịch sử được giữ lại để kiểm tra.'),
           media_type = COALESCE(media_type,
             CASE WHEN artifact_kind IN ('baseline_package', 'delivery_package')
                  THEN 'application/gzip' ELSE 'application/json' END),
           schema_version = COALESCE(schema_version, 'legacy'),
           visibility = COALESCE(visibility, 'user'),
           status = COALESCE(status, 'current'),
           source_version_ids = COALESCE(source_version_ids, '[]'),
           parent_resource_ids = COALESCE(parent_resource_ids, '[]')`
    );
    await this.database.query(
      `UPDATE remote_agent_system3_artifact_versions
       SET status = CASE
         WHEN knowledge_snapshot_id = (
           SELECT active_knowledge_snapshot_id FROM remote_agent_system3_projects project
           WHERE project.id = remote_agent_system3_artifact_versions.project_id
         ) THEN 'current'
         ELSE 'superseded'
       END
       WHERE artifact_kind = 'knowledge_snapshot'`
    );
    await this.database.query(
      `UPDATE remote_agent_system3_artifact_versions
       SET source_version_ids = COALESCE((
         SELECT input.source_ids
         FROM remote_agent_system3_understanding_input_snapshots input
         WHERE input.project_id = remote_agent_system3_artifact_versions.project_id
           AND input.knowledge_snapshot_id = remote_agent_system3_artifact_versions.knowledge_snapshot_id
         ORDER BY input.created_at DESC LIMIT 1
       ), source_version_ids)
       WHERE artifact_kind = 'knowledge_snapshot'
         AND (source_version_ids IS NULL OR source_version_ids = '[]')`
    );
    await this.database.query(
      "UPDATE remote_agent_system3_impact_manifests SET basis_hash = COALESCE(basis_hash, 'legacy:' || id), manifest_hash = COALESCE(manifest_hash, 'legacy:' || id) WHERE basis_hash IS NULL OR manifest_hash IS NULL"
    );
    await this.database.query('DROP INDEX IF EXISTS idx_system3_impacts_source_version');
    await this.database.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_system3_impacts_source_basis_detector ON remote_agent_system3_impact_manifests(source_version_id, basis_hash, detector_version)'
    );
    await this.database.query(
      'CREATE INDEX IF NOT EXISTS idx_system3_impacts_operation ON remote_agent_system3_impact_manifests(operation_id)'
    );
  }

  private async upgradeSourceIntakeSchema(): Promise<void> {
    if (this.database.dialect === 'postgres') {
      await this.database.query(`
        CREATE TABLE IF NOT EXISTS remote_agent_system3_sources (
          id UUID PRIMARY KEY,
          project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          role TEXT NOT NULL,
          display_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_by_user_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS source_id UUID;
        ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS role TEXT;
        ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS original_filename TEXT;
        ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS media_type TEXT;
        ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS lineage_version INTEGER;
        ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS storage_status TEXT;
        ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS validation_report JSONB;
        ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL;
        ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS origin TEXT;
        ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS operation_id UUID;
        ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS intake_report_artifact_id UUID;
        ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS source_version_id UUID REFERENCES remote_agent_system3_source_versions(id) ON DELETE SET NULL;
        ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS operation_id UUID REFERENCES remote_agent_system3_project_operations(id) ON DELETE SET NULL;
        ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS activity_id TEXT;
        ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS workflow_run_id UUID;
        ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS workflow_node_id TEXT;
        ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS display_name TEXT;
        ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS summary TEXT;
        ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS media_type TEXT;
        ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS schema_id TEXT;
        ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS schema_version TEXT;
        ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS visibility TEXT;
        ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS status TEXT;
        ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS stale_reason TEXT;
        ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS source_version_ids JSONB;
        ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS parent_resource_ids JSONB;
      `);
      const groups = await this.database.query(
        `SELECT DISTINCT version.project_id, version.kind
         FROM remote_agent_system3_source_versions version
         WHERE version.source_id IS NULL`
      );
      for (const value of groups.rows) {
        const group = value as { project_id: string; kind: System3SourceKind };
        const sourceId = randomUUID();
        await this.database.query(
          `INSERT INTO remote_agent_system3_sources
             (id, project_id, kind, role, display_name, status)
           VALUES ($1, $2, $3, 'primary', $3, 'active')`,
          [sourceId, group.project_id, group.kind]
        );
        await this.database.query(
          `UPDATE remote_agent_system3_source_versions
           SET source_id = $1, role = COALESCE(role, 'primary'),
               original_filename = COALESCE(original_filename, filename),
               media_type = COALESCE(media_type, 'application/octet-stream'),
               lineage_version = COALESCE(lineage_version, version),
               storage_status = COALESCE(storage_status, 'ready'),
               validation_report = COALESCE(validation_report, '{"schemaVersion":1,"outcome":"accepted","checks":[],"warnings":[]}'::jsonb),
               origin = COALESCE(origin, 'legacy')
           WHERE project_id = $2 AND kind = $3 AND source_id IS NULL`,
          [sourceId, group.project_id, group.kind]
        );
      }
      await this.database.query(`
        CREATE INDEX IF NOT EXISTS idx_system3_source_lineage_versions
          ON remote_agent_system3_source_versions(source_id, lineage_version DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_system3_source_lineage_version_unique
          ON remote_agent_system3_source_versions(source_id, lineage_version);
      `);
      return;
    }

    await this.database.query(`
      CREATE TABLE IF NOT EXISTS remote_agent_system3_sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        role TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_by_user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const columnsResult = await this.database.query(
      "SELECT name FROM pragma_table_info('remote_agent_system3_source_versions')"
    );
    const columns = new Set(columnsResult.rows.map(value => (value as { name: string }).name));
    const additions: readonly [string, string][] = [
      ['source_id', 'TEXT'],
      ['role', 'TEXT'],
      ['original_filename', 'TEXT'],
      ['media_type', 'TEXT'],
      ['lineage_version', 'INTEGER'],
      ['storage_status', 'TEXT'],
      ['validation_report', 'TEXT'],
      ['created_by_user_id', 'TEXT'],
      ['origin', 'TEXT'],
      ['operation_id', 'TEXT'],
      ['intake_report_artifact_id', 'TEXT'],
    ];
    for (const [column, definition] of additions) {
      if (!columns.has(column)) {
        await this.database.query(
          `ALTER TABLE remote_agent_system3_source_versions ADD COLUMN ${column} ${definition}`
        );
      }
    }
    const artifactColumnsResult = await this.database.query(
      "SELECT name FROM pragma_table_info('remote_agent_system3_artifact_versions')"
    );
    const artifactColumns = new Set(
      artifactColumnsResult.rows.map(value => (value as { name: string }).name)
    );
    for (const [column, definition] of [
      ['source_version_id', 'TEXT'],
      ['operation_id', 'TEXT'],
      ['activity_id', 'TEXT'],
      ['workflow_run_id', 'TEXT'],
      ['workflow_node_id', 'TEXT'],
      ['display_name', 'TEXT'],
      ['summary', 'TEXT'],
      ['media_type', 'TEXT'],
      ['schema_id', 'TEXT'],
      ['schema_version', 'TEXT'],
      ['visibility', 'TEXT'],
      ['status', 'TEXT'],
      ['stale_reason', 'TEXT'],
      ['source_version_ids', 'TEXT'],
      ['parent_resource_ids', 'TEXT'],
    ] as const) {
      if (!artifactColumns.has(column)) {
        await this.database.query(
          `ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN ${column} ${definition}`
        );
      }
    }
    const groups = await this.database.query(
      `SELECT DISTINCT project_id, kind FROM remote_agent_system3_source_versions
       WHERE source_id IS NULL`
    );
    for (const value of groups.rows) {
      const group = value as { project_id: string; kind: System3SourceKind };
      const sourceId = randomUUID();
      await this.database.query(
        `INSERT INTO remote_agent_system3_sources
           (id, project_id, kind, role, display_name, status)
         VALUES ($1, $2, $3, 'primary', $3, 'active')`,
        [sourceId, group.project_id, group.kind]
      );
      await this.database.query(
        `UPDATE remote_agent_system3_source_versions
         SET source_id = $1, role = COALESCE(role, 'primary'),
             original_filename = COALESCE(original_filename, filename),
             media_type = COALESCE(media_type, 'application/octet-stream'),
             lineage_version = COALESCE(lineage_version, version),
             storage_status = COALESCE(storage_status, 'ready'),
             validation_report = COALESCE(validation_report, '{"schemaVersion":1,"outcome":"accepted","checks":[],"warnings":[]}'),
             origin = COALESCE(origin, 'legacy')
         WHERE project_id = $2 AND kind = $3 AND source_id IS NULL`,
        [sourceId, group.project_id, group.kind]
      );
    }
    await this.database.query(
      `CREATE INDEX IF NOT EXISTS idx_system3_source_lineage_versions
       ON remote_agent_system3_source_versions(source_id, lineage_version DESC)`
    );
    await this.database.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_system3_source_lineage_version_unique
       ON remote_agent_system3_source_versions(source_id, lineage_version)`
    );
  }

  async createProject(input: {
    codebaseId: string;
    name: string;
    description?: string;
  }): Promise<System3ProjectRecord> {
    await this.ensureSchema();
    const id = randomUUID();
    const result = await this.database.query(
      `INSERT INTO remote_agent_system3_projects
        (id, codebase_id, name, description, stage, attention, freshness, template_id)
       VALUES ($1, $2, $3, $4, 'draft', 'input_required', 'current', 'customer-churn-reference@1')
       RETURNING *`,
      [id, input.codebaseId, input.name, input.description ?? null]
    );
    const row = typedRows(result, value => value as ProjectRow)[0];
    if (!row) throw new Error('System 3 project creation returned no row');
    return asProject(row);
  }

  async listProjects(): Promise<System3ProjectRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      'SELECT * FROM remote_agent_system3_projects ORDER BY updated_at DESC'
    );
    return typedRows(result, value => asProject(value as ProjectRow));
  }

  async getProject(projectId: string): Promise<System3ProjectRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      'SELECT * FROM remote_agent_system3_projects WHERE id = $1',
      [projectId]
    );
    const row = typedRows(result, value => value as ProjectRow)[0];
    return row ? asProject(row) : null;
  }

  async addSource(input: {
    projectId: string;
    sourceId?: string;
    kind: System3SourceKind;
    role: System3SourceRole;
    filename: string;
    originalFilename: string;
    mediaType: string;
    contentHash: string;
    sizeBytes: number;
    storageKey: string;
    validationReport: System3SourceValidationReport;
    createdBy?: string;
    origin: string;
    operationId: string;
    ownerClaimToken?: string;
    expectedVersion: number;
  }): Promise<System3SourceIntakeStoreResult> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      await this.lockProject(query, input.projectId);
      if (input.ownerClaimToken) {
        await this.requireProjectOperationClaim(query, {
          operationId: input.operationId,
          projectId: input.projectId,
          type: 'source_intake',
          ownerClaimToken: input.ownerClaimToken,
        });
      }
      const preparedResult = await query(
        `SELECT * FROM remote_agent_system3_source_versions
         WHERE project_id = $1 AND operation_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [input.projectId, input.operationId]
      );
      const preparedRow = typedRows(preparedResult, value => value as SourceRow)[0];
      if (preparedRow) {
        const previousResult = await query(
          `SELECT id FROM remote_agent_system3_source_versions
           WHERE source_id = $1 AND storage_status = 'ready' AND id <> $2
           ORDER BY lineage_version DESC LIMIT 1`,
          [preparedRow.source_id, preparedRow.id]
        );
        const previous = typedRows(previousResult, value => value as { id: string })[0];
        return {
          outcome:
            Number(preparedRow.lineage_version ?? 1) === 1 ? 'created_source' : 'created_version',
          source: asSource(preparedRow),
          previousVersionId: previous?.id ?? null,
        };
      }
      const projectResult = await query(
        'SELECT stage, freshness, version FROM remote_agent_system3_projects WHERE id = $1',
        [input.projectId]
      );
      const project = typedRows(
        projectResult,
        value =>
          value as {
            stage: System3ProjectStage;
            freshness: System3Freshness;
            version: number | string;
          }
      )[0];
      if (!project) throw new Error('System 3 project not found');
      if (Number(project.version) !== input.expectedVersion) {
        throw new System3ConflictError('Project đã thay đổi; hãy tải lại trước khi thêm nguồn');
      }

      let sourceId = input.sourceId;
      let createdLineage = false;
      if (sourceId !== undefined) {
        const sourceResult = await query(
          `SELECT id, kind, role FROM remote_agent_system3_sources
           WHERE id = $1 AND project_id = $2 AND status = 'active'`,
          [sourceId, input.projectId]
        );
        const logicalSource = typedRows(
          sourceResult,
          value => value as { id: string; kind: System3SourceKind; role: System3SourceRole }
        )[0];
        if (!logicalSource) throw new System3ConflictError('Nguồn này không còn tồn tại');
        if (logicalSource.kind !== input.kind || logicalSource.role !== input.role) {
          throw new System3ConflictError('Loại hoặc vai trò không khớp với nguồn đã có');
        }
      } else {
        const countResult = await query(
          `SELECT COUNT(*) AS count FROM remote_agent_system3_sources
           WHERE project_id = $1 AND status = 'active'`,
          [input.projectId]
        );
        const count = Number(
          typedRows(countResult, value => value as { count: number | string })[0]?.count ?? 0
        );
        if (count >= 100) throw new System3ConflictError('Project đã có đủ giới hạn 100 nguồn');
        if (input.role === 'primary') {
          const primary = await query(
            `SELECT id FROM remote_agent_system3_sources
             WHERE project_id = $1 AND kind = $2 AND role = 'primary' AND status = 'active'
             LIMIT 1`,
            [input.projectId, input.kind]
          );
          if (primary.rows.length > 0) {
            throw new System3ConflictError(
              'Loại này đã có nguồn chính; hãy tải phiên bản mới cho nguồn đó hoặc chọn nguồn bổ sung'
            );
          }
        }
        sourceId = randomUUID();
        await query(
          `INSERT INTO remote_agent_system3_sources
             (id, project_id, kind, role, display_name, status, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, 'active', $6)`,
          [
            sourceId,
            input.projectId,
            input.kind,
            input.role,
            input.originalFilename,
            input.createdBy ?? null,
          ]
        );
        createdLineage = true;
      }

      if (sourceId === undefined) throw new Error('Source lineage creation returned no id');
      const current = await query(
        `SELECT * FROM remote_agent_system3_source_versions
         WHERE source_id = $1 AND storage_status = 'ready'
         ORDER BY lineage_version DESC LIMIT 1`,
        [sourceId]
      );
      const currentRow = typedRows(current, value => value as SourceRow)[0];
      // Content-addressed source persistence can legitimately return the same
      // storage key on a retried upload. Treat that request as idempotent: do
      // not manufacture a new version or stale an already-current project.
      if (currentRow?.content_hash === input.contentHash) {
        return {
          outcome: 'unchanged',
          source: asSource(currentRow),
          previousVersionId: currentRow.id,
        };
      }
      const storageResult = await query(
        `SELECT COALESCE(SUM(size_bytes), 0) AS total FROM remote_agent_system3_source_versions
         WHERE project_id = $1 AND storage_status IN ('pending', 'ready')`,
        [input.projectId]
      );
      const storedBytes = Number(
        typedRows(storageResult, value => value as { total: number | string })[0]?.total ?? 0
      );
      if (storedBytes + input.sizeBytes > 2 * 1024 * 1024 * 1024) {
        throw new System3ConflictError('Tổng dung lượng nguồn của project sẽ vượt 2 GiB');
      }
      const sequenceResult = await query(
        `SELECT COALESCE(MAX(version), 0) AS version FROM remote_agent_system3_source_versions
         WHERE project_id = $1 AND kind = $2`,
        [input.projectId, input.kind]
      );
      const version =
        Number(
          typedRows(sequenceResult, value => value as { version: number | string })[0]?.version ?? 0
        ) + 1;
      const lineageVersion = Number(currentRow?.lineage_version ?? 0) + 1;
      const id = randomUUID();
      const inserted = await query(
        `INSERT INTO remote_agent_system3_source_versions
          (id, source_id, project_id, kind, role, filename, original_filename, media_type,
           version, lineage_version, content_hash, size_bytes, storage_key, storage_status,
           validation_report, created_by_user_id, origin, operation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending',
                 $14, $15, $16, $17)
         RETURNING *`,
        [
          id,
          sourceId,
          input.projectId,
          input.kind,
          input.role,
          input.filename,
          input.originalFilename,
          input.mediaType,
          version,
          lineageVersion,
          input.contentHash,
          input.sizeBytes,
          input.storageKey,
          JSON.stringify(input.validationReport),
          input.createdBy ?? null,
          input.origin,
          input.operationId,
        ]
      );
      const row = typedRows(inserted, value => value as SourceRow)[0];
      if (!row) throw new Error('Source version creation returned no row');
      return {
        outcome: createdLineage ? 'created_source' : 'created_version',
        source: asSource(row),
        previousVersionId: currentRow?.id ?? null,
      };
    });
  }

  async finalizeSourceVersion(input: {
    projectId: string;
    sourceVersionId: string;
    storageKey: string;
    operationId: string;
    ownerClaimToken?: string;
  }): Promise<System3SourceRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      await this.lockProject(query, input.projectId);
      if (input.ownerClaimToken) {
        await this.requireProjectOperationClaim(query, {
          operationId: input.operationId,
          projectId: input.projectId,
          type: 'source_intake',
          ownerClaimToken: input.ownerClaimToken,
        });
      }
      const sourceResult = await query(
        `SELECT * FROM remote_agent_system3_source_versions
         WHERE id = $1 AND project_id = $2 AND operation_id = $3`,
        [input.sourceVersionId, input.projectId, input.operationId]
      );
      const source = typedRows(sourceResult, value => value as SourceRow)[0];
      if (!source) throw new Error('Pending System 3 source version not found');
      if (source.storage_status === 'ready') return asSource(source);
      if (source.storage_status !== 'pending') {
        throw new System3ConflictError(
          `Source version with storage status '${source.storage_status ?? 'unknown'}' cannot be finalized`
        );
      }
      const projectResult = await query(
        'SELECT stage, freshness FROM remote_agent_system3_projects WHERE id = $1',
        [input.projectId]
      );
      const project = typedRows(
        projectResult,
        value => value as { stage: System3ProjectStage; freshness: System3Freshness }
      )[0];
      if (!project) throw new Error('System 3 project not found');
      const previousResult = await query(
        `SELECT id FROM remote_agent_system3_source_versions
         WHERE source_id = $1 AND storage_status = 'ready' AND id <> $2
         ORDER BY lineage_version DESC LIMIT 1`,
        [source.source_id, source.id]
      );
      const previous = typedRows(previousResult, value => value as { id: string })[0];
      const updatedResult = await query(
        `UPDATE remote_agent_system3_source_versions
         SET storage_key = $2, storage_status = 'ready'
         WHERE id = $1 AND storage_status = 'pending'`,
        [source.id, input.storageKey]
      );
      if (updatedResult.rowCount !== 1)
        throw new Error('Source version finalization updated no row');
      const refreshedResult = await query(
        'SELECT * FROM remote_agent_system3_source_versions WHERE id = $1',
        [source.id]
      );
      const updated = typedRows(refreshedResult, value => value as SourceRow)[0];
      if (!updated) throw new Error('Source version finalization returned no row');
      await this.transitionProject(query, {
        projectId: input.projectId,
        fromStage: project.stage,
        toStage: project.stage,
        attention: 'input_required',
        freshness: project.stage === 'draft' ? project.freshness : 'partially_stale',
        actorId: source.created_by_user_id,
        operationId: input.operationId,
        entityType: 'source_version',
        entityId: source.id,
        reason: previous ? 'Source version changed' : 'Initial source version uploaded',
        metadata: {
          sourceId: source.source_id,
          sourceKind: source.kind,
          sourceVersion: Number(source.lineage_version ?? 1),
        },
      });
      return asSource(updated);
    });
  }

  async listSources(projectId: string): Promise<System3SourceRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_source_versions
       WHERE project_id = $1 AND storage_status = 'ready'
       ORDER BY kind ASC, source_id ASC, lineage_version DESC`,
      [projectId]
    );
    return typedRows(result, value => asSource(value as SourceRow));
  }

  async listActiveSources(projectId: string): Promise<System3SourceRecord[]> {
    const sources = await this.listSources(projectId);
    const active = new Map<string, System3SourceRecord>();
    for (const source of sources) {
      if (!active.has(source.sourceId)) active.set(source.sourceId, source);
    }
    return [...active.values()];
  }

  async getSourceVersion(
    projectId: string,
    sourceVersionId: string
  ): Promise<System3SourceRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_source_versions
       WHERE id = $1 AND project_id = $2 AND storage_status = 'ready'`,
      [sourceVersionId, projectId]
    );
    const row = typedRows(result, value => value as SourceRow)[0];
    return row ? asSource(row) : null;
  }

  /**
   * Internal recovery lookup. Public source registries deliberately expose
   * only ready versions, while an explicit OP-00 retry must also be able to
   * resume the pending row created by the same immutable operation.
   */
  async getSourceVersionForOperation(
    projectId: string,
    operationId: string
  ): Promise<System3SourceRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_source_versions
       WHERE project_id = $1 AND operation_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [projectId, operationId]
    );
    const row = typedRows(result, value => value as SourceRow)[0];
    return row ? asSource(row) : null;
  }

  async recordSourceIntakeReport(input: {
    projectId: string;
    operationId: string;
    sourceVersionId: string | null;
    artifactKey: string;
    report: System3SourceIntakeReport;
    ownerClaimToken?: string;
  }): Promise<System3SourceIntakeReportRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      if (input.ownerClaimToken) {
        await this.requireProjectOperationClaim(query, {
          operationId: input.operationId,
          projectId: input.projectId,
          type: 'source_intake',
          ownerClaimToken: input.ownerClaimToken,
        });
      }
      const existingResult = await query(
        `SELECT * FROM remote_agent_system3_source_intake_reports
         WHERE project_id = $1 AND operation_id = $2`,
        [input.projectId, input.operationId]
      );
      const existing = typedRows(existingResult, value => value as SourceIntakeReportRow)[0];
      if (existing) return asSourceIntakeReport(existing);
      const id = randomUUID();
      const body = Buffer.from(`${JSON.stringify(input.report, null, 2)}\n`);
      const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      await query(
        `INSERT INTO remote_agent_system3_artifact_versions
          (id, project_id, source_version_id, operation_id, artifact_key, artifact_kind,
           version, content_hash, size_bytes, activity_id, display_name, summary, media_type,
           schema_id, schema_version, visibility, status, source_version_ids, parent_resource_ids)
         VALUES ($1, $2, $3, $4, $5, 'source_intake_report', 1, $6, $7,
                 'OP-00', 'Báo cáo tiếp nhận nguồn',
                 'Kết quả kiểm tra và lưu phiên bản nguồn đầu vào.', 'application/json',
                 'system3.source-intake-report', '1', 'user', 'current', $8, '[]')`,
        [
          id,
          input.projectId,
          input.sourceVersionId,
          input.operationId,
          input.artifactKey,
          contentHash,
          body.byteLength,
          JSON.stringify(input.sourceVersionId === null ? [] : [input.sourceVersionId]),
        ]
      );
      const insertedResult = await query(
        `INSERT INTO remote_agent_system3_source_intake_reports
          (id, project_id, operation_id, source_version_id, artifact_key, report)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          id,
          input.projectId,
          input.operationId,
          input.sourceVersionId,
          input.artifactKey,
          JSON.stringify(input.report),
        ]
      );
      if (input.sourceVersionId !== null) {
        await query(
          `UPDATE remote_agent_system3_source_versions
           SET intake_report_artifact_id = COALESCE(intake_report_artifact_id, $2)
           WHERE id = $1`,
          [input.sourceVersionId, id]
        );
      }
      const inserted = typedRows(insertedResult, value => value as SourceIntakeReportRow)[0];
      if (!inserted) throw new Error('Source Intake report creation returned no row');
      return asSourceIntakeReport(inserted);
    });
  }

  async listSourceIntakeReports(projectId: string): Promise<System3SourceIntakeReportRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_source_intake_reports
       WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId]
    );
    return typedRows(result, value => asSourceIntakeReport(value as SourceIntakeReportRow));
  }

  async getSourceIntakeReport(
    projectId: string,
    reportId: string
  ): Promise<System3SourceIntakeReportRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_source_intake_reports
       WHERE id = $1 AND project_id = $2`,
      [reportId, projectId]
    );
    const row = typedRows(result, value => value as SourceIntakeReportRow)[0];
    return row ? asSourceIntakeReport(row) : null;
  }

  async recordSourceImpact(input: {
    projectId: string;
    sourceVersionId: string;
    kind: System3SourceKind;
    affectedPhases?: readonly System3PhaseId[];
    operationId?: string;
    ownerClaimToken?: string;
    previousSourceVersionId?: string | null;
    manifest?: System3ImpactManifest;
  }): Promise<System3ImpactManifestRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      await this.lockProject(query, input.projectId);
      if (input.ownerClaimToken !== undefined && input.operationId === undefined) {
        throw new Error('Change Detection owner claim token requires an operation id');
      }
      if (input.operationId && input.ownerClaimToken) {
        await this.requireProjectOperationClaim(query, {
          operationId: input.operationId,
          projectId: input.projectId,
          type: 'change_detection',
          ownerClaimToken: input.ownerClaimToken,
        });
      }
      const affectedPhases = input.affectedPhases
        ? system3PhaseOrder.filter(phase => input.affectedPhases?.includes(phase))
        : affectedPhasesForSource(input.kind);
      if (input.manifest === undefined && affectedPhases.length === 0) {
        throw new Error('A legacy changed source must invalidate at least one product phase');
      }
      const detectorVersion = input.manifest?.detectorVersion ?? 'system3-change-detector@1';
      const basisHash = input.manifest
        ? `sha256:${createHash('sha256').update(canonicalJson(input.manifest.basis)).digest('hex')}`
        : `legacy:${input.sourceVersionId}`;
      const manifestHash = input.manifest
        ? `sha256:${createHash('sha256').update(canonicalJson(input.manifest)).digest('hex')}`
        : `legacy:${input.sourceVersionId}`;
      const existingResult = await query(
        `SELECT * FROM remote_agent_system3_impact_manifests
         WHERE project_id = $1 AND source_version_id = $2 AND basis_hash = $3 AND detector_version = $4
         ORDER BY created_at DESC LIMIT 1`,
        [input.projectId, input.sourceVersionId, basisHash, detectorVersion]
      );
      const existing = typedRows(existingResult, value => value as ImpactRow)[0];
      if (existing) {
        const impact = asImpact(existing);
        if (input.operationId && input.ownerClaimToken) {
          await this.completeProjectOperationClaim(query, {
            operationId: input.operationId,
            ownerClaimToken: input.ownerClaimToken,
            result: {
              sourceVersionId: input.sourceVersionId,
              impactManifestId: impact.id,
              affectedPhases: impact.affectedPhases,
              impactManifestHash: impact.manifestHash,
              proposedRerun: input.manifest?.proposedRerun ?? null,
            },
          });
        }
        return impact;
      }
      const id = randomUUID();
      const reason =
        input.manifest?.summary ??
        `${input.kind} source changed; dependent snapshots, approvals, evidence, and delivery must be recomputed`;
      const result = await query(
        `INSERT INTO remote_agent_system3_impact_manifests
          (id, project_id, source_version_id, operation_id, previous_source_version_id,
           schema_version, detector_version, basis_hash, manifest_hash, manifest,
           affected_phases, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (source_version_id, basis_hash, detector_version) DO NOTHING
         RETURNING *`,
        [
          id,
          input.projectId,
          input.sourceVersionId,
          input.operationId ?? input.manifest?.operationId ?? null,
          input.previousSourceVersionId ?? input.manifest?.previousSourceVersionId ?? null,
          input.manifest?.schemaVersion ?? 1,
          detectorVersion,
          basisHash,
          manifestHash,
          input.manifest ? JSON.stringify(input.manifest) : null,
          JSON.stringify(affectedPhases),
          reason,
        ]
      );
      const staleActivities = new Set<string>();
      if (input.manifest) {
        for (const activityId of input.manifest.affectedActivities) staleActivities.add(activityId);
      } else {
        for (const phase of affectedPhases) {
          if (phase === 'understanding') staleActivities.add('TW-02');
          if (phase === 'readiness') {
            staleActivities.add('TW-03');
            staleActivities.add('OP-04');
            staleActivities.add('OP-05');
          }
          if (phase === 'data' || phase === 'features' || phase === 'experiments') {
            staleActivities.add('TW-06');
          }
          if (phase === 'explainability') staleActivities.add('TW-07');
          if (phase === 'delivery') {
            staleActivities.add('OP-08');
            staleActivities.add('TW-09');
          }
        }
      }
      const exactResourceIds =
        input.manifest?.affectedResources.flatMap(resource =>
          resource.resourceId === null ? [] : [resource.resourceId]
        ) ?? [];
      if (exactResourceIds.length > 0) {
        const placeholders = exactResourceIds
          .map((_, index) => `$${(index + 3).toString()}`)
          .join(', ');
        await query(
          `UPDATE remote_agent_system3_artifact_versions
           SET status = 'stale', stale_reason = $1
           WHERE project_id = $2 AND status = 'current' AND id IN (${placeholders})`,
          [reason, input.projectId, ...exactResourceIds]
        );
      }
      if (staleActivities.size > 0) {
        const activityIds = [...staleActivities];
        const placeholders = activityIds.map((_, index) => `$${(index + 3).toString()}`).join(', ');
        await query(
          `UPDATE remote_agent_system3_artifact_versions
           SET status = 'stale', stale_reason = $1
           WHERE project_id = $2 AND status = 'current' AND activity_id IN (${placeholders})`,
          [reason, input.projectId, ...activityIds]
        );
      }
      if (input.manifest && !input.manifest.affectedActivities.includes('TW-02')) {
        const projectResult = await query(
          'SELECT * FROM remote_agent_system3_projects WHERE id = $1',
          [input.projectId]
        );
        const project = typedRows(projectResult, value => value as ProjectRow)[0];
        if (!project) throw new Error('System 3 project not found during impact transition');
        await this.transitionProject(query, {
          projectId: input.projectId,
          fromStage: project.stage,
          toStage: project.stage,
          attention: ['approved', 'executing', 'verifying', 'delivery', 'delivered'].includes(
            project.stage
          )
            ? 'approval_required'
            : project.attention,
          freshness: 'current',
          operationId: input.operationId ?? input.manifest.operationId,
          entityType: 'impact_manifest',
          entityId: id,
          reason: 'OP-01 proved the active Knowledge basis can be retained',
          metadata: { impactManifestId: id, proposedRerun: input.manifest.proposedRerun },
        });
      }
      const row = typedRows(result, value => value as ImpactRow)[0];
      if (row) {
        const impact = asImpact(row);
        if (input.operationId && input.ownerClaimToken) {
          await this.completeProjectOperationClaim(query, {
            operationId: input.operationId,
            ownerClaimToken: input.ownerClaimToken,
            result: {
              sourceVersionId: input.sourceVersionId,
              impactManifestId: impact.id,
              affectedPhases: impact.affectedPhases,
              impactManifestHash: impact.manifestHash,
              proposedRerun: input.manifest?.proposedRerun ?? null,
            },
          });
        }
        return impact;
      }
      const racedResult = await query(
        `SELECT * FROM remote_agent_system3_impact_manifests
         WHERE project_id = $1 AND source_version_id = $2 AND basis_hash = $3 AND detector_version = $4`,
        [input.projectId, input.sourceVersionId, basisHash, detectorVersion]
      );
      const raced = typedRows(racedResult, value => value as ImpactRow)[0];
      if (!raced) throw new Error('Impact manifest creation returned no row');
      const impact = asImpact(raced);
      if (input.operationId && input.ownerClaimToken) {
        await this.completeProjectOperationClaim(query, {
          operationId: input.operationId,
          ownerClaimToken: input.ownerClaimToken,
          result: {
            sourceVersionId: input.sourceVersionId,
            impactManifestId: impact.id,
            affectedPhases: impact.affectedPhases,
            impactManifestHash: impact.manifestHash,
            proposedRerun: input.manifest?.proposedRerun ?? null,
          },
        });
      }
      return impact;
    });
  }

  async getPendingImpact(projectId: string): Promise<System3ImpactManifestRecord | null> {
    const impacts = await this.listPendingImpacts(projectId);
    return impacts[0] ?? null;
  }

  async listPendingImpacts(projectId: string): Promise<System3ImpactManifestRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT impact.* FROM remote_agent_system3_impact_manifests impact
       WHERE impact.project_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM remote_agent_system3_dependency_edges edge
           WHERE edge.project_id = impact.project_id
             AND edge.from_kind = 'compilation'
             AND edge.to_kind = 'impact_manifest'
             AND edge.to_id = impact.id
         )
       ORDER BY impact.created_at DESC`,
      [projectId]
    );
    return typedRows(result, value => asImpact(value as ImpactRow));
  }

  async createUnderstandingInputSnapshot(input: {
    projectId: string;
    operationId: string;
    sourceIds: string[];
    sourceHashes: string[];
    sourceRefs?: System3UnderstandingInputSnapshotRecord['sourceRefs'];
    parserVersion: string;
    extractionPolicyVersion: string;
    capabilityRegistryHash: string;
    runtimeProfile: Record<string, unknown>;
  }): Promise<System3UnderstandingInputSnapshotRecord> {
    await this.ensureSchema();
    if (input.sourceIds.length === 0 || input.sourceIds.length !== input.sourceHashes.length) {
      throw new Error('Understanding Input Snapshot requires matching source IDs and hashes');
    }
    const existing = await this.database.query(
      `SELECT * FROM remote_agent_system3_understanding_input_snapshots
       WHERE project_id = $1 AND operation_id = $2`,
      [input.projectId, input.operationId]
    );
    const existingRow = typedRows(existing, value => value as UnderstandingInputSnapshotRow)[0];
    if (existingRow) return asUnderstandingInputSnapshot(existingRow);
    const id = randomUUID();
    const sourceRefs =
      input.sourceRefs ??
      input.sourceIds.map((sourceVersionId, index) => ({
        sourceVersionId,
        kind: 'supporting_document' as const,
        filename: 'Nguồn lịch sử',
        mediaType: 'application/octet-stream',
        contentHash: input.sourceHashes[index] ?? 'sha256:legacy',
      }));
    const inserted = await this.database.query(
      `INSERT INTO remote_agent_system3_understanding_input_snapshots
        (id, project_id, operation_id, source_ids, source_hashes, parser_version,
         extraction_policy_version, capability_registry_hash, runtime_profile, source_refs)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        id,
        input.projectId,
        input.operationId,
        JSON.stringify(input.sourceIds),
        JSON.stringify(input.sourceHashes),
        input.parserVersion,
        input.extractionPolicyVersion,
        input.capabilityRegistryHash,
        JSON.stringify(input.runtimeProfile),
        JSON.stringify(sourceRefs),
      ]
    );
    const row = typedRows(inserted, value => value as UnderstandingInputSnapshotRow)[0];
    if (!row) throw new Error('Understanding Input Snapshot creation returned no row');
    return asUnderstandingInputSnapshot(row);
  }

  async completeUnderstandingInputSnapshot(input: {
    snapshotId: string;
    projectId: string;
    knowledgeSnapshotId: string;
    workflowRunId: string;
  }): Promise<void> {
    await this.ensureSchema();
    const result = await this.database.query(
      `UPDATE remote_agent_system3_understanding_input_snapshots
       SET knowledge_snapshot_id = $1, workflow_run_id = $2
       WHERE id = $3 AND project_id = $4 AND knowledge_snapshot_id IS NULL`,
      [input.knowledgeSnapshotId, input.workflowRunId, input.snapshotId, input.projectId]
    );
    if (result.rowCount === 0) {
      const existing = await this.database.query(
        `SELECT id FROM remote_agent_system3_understanding_input_snapshots
         WHERE id = $1 AND project_id = $2 AND knowledge_snapshot_id = $3 AND workflow_run_id = $4`,
        [input.snapshotId, input.projectId, input.knowledgeSnapshotId, input.workflowRunId]
      );
      if (existing.rowCount === 0) {
        throw new System3ConflictError(
          'Understanding Input Snapshot was already completed differently'
        );
      }
    }
  }

  async listUnderstandingInputSnapshots(
    projectId: string
  ): Promise<System3UnderstandingInputSnapshotRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_understanding_input_snapshots
       WHERE project_id = $1 ORDER BY created_at DESC, id DESC`,
      [projectId]
    );
    return typedRows(result, value =>
      asUnderstandingInputSnapshot(value as UnderstandingInputSnapshotRow)
    );
  }

  async saveUnderstandingCandidate(input: {
    projectId: string;
    analysis: BlueprintAnalysis;
    artifactKey: string;
    workflowRunId: string;
    expectedVersion: number;
    inputSnapshotId: string;
    sourceVersionIds: string[];
    qualityReport: ExtractionQuality;
    reportArtifacts: {
      report: UnderstandingReport;
      markdown: { artifactKey: string; contentHash: string; sizeBytes: number };
      json: { artifactKey: string; contentHash: string; sizeBytes: number };
    }[];
    operation?: { id: string; ownerClaimToken: string };
  }): Promise<System3KnowledgeSnapshotRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      if (input.operation) {
        await this.requireProjectOperationClaim(query, {
          operationId: input.operation.id,
          projectId: input.projectId,
          type: 'analyze',
          ownerClaimToken: input.operation.ownerClaimToken,
        });
      }
      const project = await query(
        'SELECT stage, version FROM remote_agent_system3_projects WHERE id = $1',
        [input.projectId]
      );
      const projectRow = typedRows(
        project,
        value => value as { stage: System3ProjectStage; version: number | string }
      )[0];
      if (!projectRow) throw new Error('System 3 project not found');
      const stale = Number(projectRow.version) !== input.expectedVersion;
      const id = randomUUID();
      const inserted = await query(
        `INSERT INTO remote_agent_system3_knowledge_snapshots
          (id, project_id, analysis, artifact_key, workflow_run_id, input_snapshot_id,
           schema_version, lifecycle_status, quality_status, quality_report)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          id,
          input.projectId,
          JSON.stringify(input.analysis),
          input.artifactKey,
          input.workflowRunId,
          input.inputSnapshotId,
          input.analysis.schemaVersion,
          stale ? 'stale' : 'candidate',
          input.qualityReport.status,
          JSON.stringify(input.qualityReport),
        ]
      );
      for (const requirement of input.analysis.requirements) {
        await query(
          `INSERT INTO remote_agent_system3_requirements
            (id, project_id, knowledge_snapshot_id, requirement_key, kind, priority, source,
             statement, acceptance_criterion, source_pointer)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            randomUUID(),
            input.projectId,
            id,
            requirement.id,
            requirement.kind,
            requirement.priority,
            requirement.source,
            requirement.statement,
            requirement.acceptanceCriterion,
            requirement.sourcePointer,
          ]
        );
        await query(
          `INSERT INTO remote_agent_system3_dependency_edges
            (id, project_id, from_kind, from_id, to_kind, to_id, reason)
           VALUES ($1, $2, 'knowledge_snapshot', $3, 'requirement', $4, $5)`,
          [randomUUID(), input.projectId, id, requirement.id, 'Extracted from immutable snapshot']
        );
      }
      const facts: [string, unknown][] = [
        ['business_goal', input.analysis.businessGoal],
        ['technical_objective', input.analysis.technicalObjective],
        ['target_definition', input.analysis.targetDefinition],
        ['runtime', input.analysis.runtime],
        ['modules', input.analysis.modules],
        ['dataset_profile', input.analysis.dataset],
      ];
      for (const [key, value] of facts) {
        if (value !== null) {
          await query(
            `INSERT INTO remote_agent_system3_knowledge_facts
              (id, project_id, knowledge_snapshot_id, fact_key, value)
             VALUES ($1, $2, $3, $4, $5)`,
            [randomUUID(), input.projectId, id, key, JSON.stringify(value)]
          );
        }
      }
      for (const review of input.analysis.manualReviews) {
        await query(
          `INSERT INTO remote_agent_system3_open_issues
            (id, project_id, knowledge_snapshot_id, issue_key, title, source_pointer)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), input.projectId, id, review.id, review.text, review.sourcePointer]
        );
      }
      const analysisBytes = Buffer.from(JSON.stringify(input.analysis));
      const knowledgeArtifactId = randomUUID();
      await query(
        `INSERT INTO remote_agent_system3_artifact_versions
          (id, project_id, knowledge_snapshot_id, artifact_key, artifact_kind, version,
           content_hash, size_bytes, activity_id, workflow_run_id, display_name, summary,
           media_type, schema_id, schema_version, visibility, status,
           source_version_ids, parent_resource_ids)
         VALUES ($1, $2, $3, $4, 'knowledge_snapshot', 1, $5, $6, 'TW-02', $7,
                 'Bản hiểu dự án', 'Mục tiêu, yêu cầu, dữ liệu và vấn đề Anvil đã hiểu.',
                 'application/json', 'system3.knowledge-snapshot', $10, 'user', $11,
                 $8, $9)`,
        [
          knowledgeArtifactId,
          input.projectId,
          id,
          input.artifactKey,
          `sha256:${createHash('sha256').update(analysisBytes).digest('hex')}`,
          analysisBytes.byteLength,
          input.workflowRunId,
          JSON.stringify(input.sourceVersionIds),
          JSON.stringify([input.inputSnapshotId]),
          input.analysis.schemaVersion.toString(),
          stale ? 'stale' : 'candidate',
        ]
      );
      for (const artifact of input.reportArtifacts) {
        const reportId = randomUUID();
        await query(
          `INSERT INTO remote_agent_system3_artifact_versions
            (id, project_id, knowledge_snapshot_id, artifact_key, artifact_kind, version,
             content_hash, size_bytes, activity_id, workflow_run_id, display_name, summary,
             media_type, schema_id, schema_version, visibility, status,
             source_version_ids, parent_resource_ids)
           VALUES ($1, $2, $3, $4, 'understanding_report', 1, $5, $6, 'TW-02', $7,
                   $8, $9, 'text/markdown', $10, '1', 'user', $11, $12, $13)`,
          [
            reportId,
            input.projectId,
            id,
            artifact.markdown.artifactKey,
            artifact.markdown.contentHash,
            artifact.markdown.sizeBytes,
            input.workflowRunId,
            artifact.report.title,
            `Báo cáo ${artifact.report.title.toLocaleLowerCase('vi')}.`,
            `system3.understanding-report.${artifact.report.id}`,
            stale ? 'stale' : 'candidate',
            JSON.stringify(input.sourceVersionIds),
            JSON.stringify([id]),
          ]
        );
        await query(
          `INSERT INTO remote_agent_system3_artifact_versions
            (id, project_id, knowledge_snapshot_id, artifact_key, artifact_kind, version,
             content_hash, size_bytes, activity_id, workflow_run_id, display_name, summary,
             media_type, schema_id, schema_version, visibility, status,
             source_version_ids, parent_resource_ids)
           VALUES ($1, $2, $3, $4, 'understanding_report', 1, $5, $6, 'TW-02', $7,
                   $8, $9, 'application/json', $10, '1', 'technical', $11, $12, $13)`,
          [
            randomUUID(),
            input.projectId,
            id,
            artifact.json.artifactKey,
            artifact.json.contentHash,
            artifact.json.sizeBytes,
            input.workflowRunId,
            `${artifact.report.title} — dữ liệu kỹ thuật`,
            'Dữ liệu có cấu trúc dùng để tạo báo cáo dễ đọc.',
            `system3.understanding-report.${artifact.report.id}`,
            stale ? 'stale' : 'candidate',
            JSON.stringify(input.sourceVersionIds),
            JSON.stringify([id, reportId]),
          ]
        );
      }
      for (const sourceVersionId of input.sourceVersionIds) {
        await query(
          `INSERT INTO remote_agent_system3_dependency_edges
            (id, project_id, from_kind, from_id, to_kind, to_id, reason)
           VALUES ($1, $2, 'source_version', $3, 'knowledge_snapshot', $4, $5)
           ON CONFLICT (project_id, from_kind, from_id, to_kind, to_id) DO NOTHING`,
          [
            randomUUID(),
            input.projectId,
            sourceVersionId,
            id,
            'Bản hiểu dự án được tạo từ phiên bản nguồn này.',
          ]
        );
        await query(
          `INSERT INTO remote_agent_system3_dependency_edges
            (id, project_id, from_kind, from_id, to_kind, to_id, reason)
           VALUES ($1, $2, 'source_version', $3, 'resource', $4, $5)
           ON CONFLICT (project_id, from_kind, from_id, to_kind, to_id) DO NOTHING`,
          [
            randomUUID(),
            input.projectId,
            sourceVersionId,
            knowledgeArtifactId,
            'Kết quả Hiểu dự án dùng phiên bản nguồn này.',
          ]
        );
      }
      for (const review of input.qualityReport.issues.filter(issue => issue.requiresDecision)) {
        const binding = review.decisionBinding ?? null;
        const options =
          binding?.kind === 'dataset_target_column'
            ? binding.allowedValues
            : ['Đã xem xét và xác nhận'];
        await query(
          `INSERT INTO remote_agent_system3_decisions
            (id, project_id, knowledge_snapshot_id, title, question, why, recommendation, options, binding, affected_phases, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')`,
          [
            randomUUID(),
            input.projectId,
            id,
            review.title,
            review.detail,
            'Bản hiểu nháp có một điểm quan trọng mà Anvil không được tự quyết định.',
            binding?.kind === 'dataset_target_column'
              ? 'Chọn đúng một cột có trong Dataset đã liên kết.'
              : 'Xác nhận rằng bạn đã xem xét nội dung cần quyết định.',
            JSON.stringify(options),
            binding === null ? null : JSON.stringify(binding),
            JSON.stringify(['readiness']),
          ]
        );
      }
      if (!stale) {
        const attention: System3Attention =
          input.qualityReport.status === 'decision_required'
            ? 'decision_required'
            : input.qualityReport.status === 'passed'
              ? 'none'
              : 'input_required';
        await this.transitionProject(query, {
          projectId: input.projectId,
          fromStage: projectRow.stage,
          toStage: 'understanding',
          attention,
          freshness: 'current',
          workflowRunId: input.workflowRunId,
          entityType: 'knowledge_snapshot',
          entityId: id,
          reason: 'Understanding candidate created',
          metadata: { qualityStatus: input.qualityReport.status },
        });
      }
      const row = typedRows(inserted, value => value as SnapshotRow)[0];
      if (!row) throw new Error('Knowledge snapshot creation returned no row');
      const snapshot = asSnapshot(row);
      if (input.operation) {
        const completedInput = await query(
          `UPDATE remote_agent_system3_understanding_input_snapshots
           SET knowledge_snapshot_id = $1, workflow_run_id = $2
           WHERE id = $3 AND project_id = $4 AND knowledge_snapshot_id IS NULL`,
          [snapshot.id, input.workflowRunId, input.inputSnapshotId, input.projectId]
        );
        if (completedInput.rowCount !== 1) {
          const existingInput = await query(
            `SELECT id FROM remote_agent_system3_understanding_input_snapshots
             WHERE id = $1 AND project_id = $2
               AND knowledge_snapshot_id = $3 AND workflow_run_id = $4`,
            [input.inputSnapshotId, input.projectId, snapshot.id, input.workflowRunId]
          );
          if (existingInput.rowCount === 0) {
            throw new System3ConflictError(
              'Understanding Input Snapshot was already completed differently'
            );
          }
        }
        await this.completeProjectOperationClaim(query, {
          operationId: input.operation.id,
          ownerClaimToken: input.operation.ownerClaimToken,
          workflowRunId: input.workflowRunId,
          result: {
            snapshotId: snapshot.id,
            workflowRunId: input.workflowRunId,
            lifecycleStatus: snapshot.lifecycleStatus,
            qualityStatus: snapshot.qualityStatus,
          },
        });
      }
      return snapshot;
    });
  }

  /** Legacy compatibility for callers that still expect immediate publication. */
  async saveUnderstanding(input: {
    projectId: string;
    analysis: BlueprintAnalysis;
    artifactKey: string;
    workflowRunId: string;
    expectedVersion: number;
    inputSnapshotId: string;
    sourceVersionIds: string[];
  }): Promise<System3KnowledgeSnapshotRecord> {
    const quality: ExtractionQuality =
      input.analysis.schemaVersion === 2
        ? input.analysis.extractionQuality
        : {
            status: input.analysis.manualReviews.length > 0 ? 'decision_required' : 'passed',
            parserVersion: 'legacy',
            extractionPolicyVersion: 'legacy',
            headingAliasVersion: 'legacy',
            totalComponents: 0,
            extractedComponents: 0,
            ignoredComponents: 0,
            unsupportedComponents: 0,
            unclassifiedComponents: 0,
            missingChapters: [],
            issues: input.analysis.manualReviews.map(review => ({
              id: review.id,
              kind: 'manual_review',
              severity: 'warning',
              title: 'Cần người dùng xác nhận',
              detail: review.text,
              requiresDecision: true,
              sourcePointers: [],
            })),
            coverage: [],
          };
    const candidate = await this.saveUnderstandingCandidate({
      ...input,
      qualityReport: quality,
      reportArtifacts: [],
    });
    return this.activateUnderstandingCandidate({
      projectId: input.projectId,
      snapshotId: candidate.id,
      expectedVersion: input.expectedVersion + 1,
      actorId: null,
    });
  }

  async getUnderstandingSnapshot(
    projectId: string,
    snapshotId: string
  ): Promise<System3KnowledgeSnapshotRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_knowledge_snapshots
       WHERE id = $1 AND project_id = $2`,
      [snapshotId, projectId]
    );
    const row = typedRows(result, value => value as SnapshotRow)[0];
    return row ? asSnapshot(row) : null;
  }

  async activateUnderstandingCandidate(input: {
    projectId: string;
    snapshotId: string;
    expectedVersion: number;
    actorId: string | null;
    operation?: { id: string; ownerClaimToken: string };
  }): Promise<System3KnowledgeSnapshotRecord> {
    await this.ensureSchema();
    const activation = await this.database.withTransaction(async query => {
      await this.lockProject(query, input.projectId);
      if (input.operation) {
        await this.requireProjectOperationClaim(query, {
          operationId: input.operation.id,
          projectId: input.projectId,
          type: 'activate_understanding',
          ownerClaimToken: input.operation.ownerClaimToken,
        });
      }
      const projectResult = await query(
        'SELECT * FROM remote_agent_system3_projects WHERE id = $1',
        [input.projectId]
      );
      const project = typedRows(projectResult, value => value as ProjectRow)[0];
      if (!project) throw new Error('System 3 project not found');
      if (Number(project.version) !== input.expectedVersion) {
        throw new System3ConflictError('Project changed; refresh before activating understanding');
      }
      const snapshotResult = await query(
        `SELECT * FROM remote_agent_system3_knowledge_snapshots
         WHERE id = $1 AND project_id = $2`,
        [input.snapshotId, input.projectId]
      );
      const row = typedRows(snapshotResult, value => value as SnapshotRow)[0];
      if (!row) throw new Error('Understanding candidate not found');
      if (row.lifecycle_status === 'active') {
        const snapshot = asSnapshot(row);
        if (input.operation) {
          await this.completeProjectOperationClaim(query, {
            operationId: input.operation.id,
            ownerClaimToken: input.operation.ownerClaimToken,
            result: { snapshotId: snapshot.id },
          });
        }
        return snapshot;
      }
      if (row.lifecycle_status !== 'candidate') {
        throw new System3ConflictError('Only a current Understanding candidate can be activated');
      }
      if (!['passed', 'decision_required'].includes(row.quality_status ?? '')) {
        throw new System3ConflictError('Understanding quality does not allow activation');
      }
      const pending = await query(
        `SELECT COUNT(*) AS count FROM remote_agent_system3_decisions
         WHERE project_id = $1 AND knowledge_snapshot_id = $2 AND status = 'pending'`,
        [input.projectId, input.snapshotId]
      );
      const pendingCount = Number(
        typedRows(pending, value => value as { count: number | string })[0]?.count ?? 0
      );
      if (pendingCount > 0) {
        throw new System3ConflictError('Resolve the candidate decisions before activation');
      }
      const inputResult = await query(
        `SELECT source_ids FROM remote_agent_system3_understanding_input_snapshots
         WHERE id = $1 AND project_id = $2`,
        [row.input_snapshot_id, input.projectId]
      );
      const inputRow = typedRows(
        inputResult,
        value => value as { source_ids: string[] | string }
      )[0];
      if (!inputRow) throw new System3ConflictError('Candidate Input Snapshot is missing');
      const sourceIds = jsonObject<string[]>(inputRow.source_ids);
      if (sourceIds.length > 0) {
        const placeholders = sourceIds.map((_, index) => `$${String(index + 2)}`).join(', ');
        const currentResult = await query(
          `SELECT version.id FROM remote_agent_system3_source_versions version
           WHERE version.project_id = $1 AND version.id IN (${placeholders})
             AND version.storage_status = 'ready'
             AND NOT EXISTS (
               SELECT 1 FROM remote_agent_system3_source_versions newer
               WHERE newer.source_id = version.source_id
                 AND newer.storage_status = 'ready'
                 AND newer.lineage_version > version.lineage_version
             )`,
          [input.projectId, ...sourceIds]
        );
        if (currentResult.rowCount !== sourceIds.length) {
          await query(
            `UPDATE remote_agent_system3_knowledge_snapshots
             SET lifecycle_status = 'stale' WHERE id = $1`,
            [input.snapshotId]
          );
          await query(
            `UPDATE remote_agent_system3_artifact_versions
             SET status = 'stale', stale_reason = 'Nguồn đã thay đổi trước khi kích hoạt.'
             WHERE knowledge_snapshot_id = $1`,
            [input.snapshotId]
          );
          return null;
        }
      }
      const previousId = project.active_knowledge_snapshot_id;
      if (previousId) {
        await query(
          `UPDATE remote_agent_system3_knowledge_snapshots
           SET lifecycle_status = 'superseded' WHERE id = $1 AND project_id = $2`,
          [previousId, input.projectId]
        );
        await query(
          `UPDATE remote_agent_system3_artifact_versions
           SET status = 'superseded', stale_reason = NULL
           WHERE knowledge_snapshot_id = $1 AND project_id = $2`,
          [previousId, input.projectId]
        );
      }
      const activated = await query(
        `UPDATE remote_agent_system3_knowledge_snapshots
         SET lifecycle_status = 'active', activated_at = CURRENT_TIMESTAMP,
             activated_by_user_id = $1
         WHERE id = $2 AND project_id = $3`,
        [input.actorId, input.snapshotId, input.projectId]
      );
      if (activated.rowCount !== 1) throw new Error('Understanding activation updated no row');
      await query(
        `UPDATE remote_agent_system3_artifact_versions
         SET status = 'current', stale_reason = NULL
         WHERE knowledge_snapshot_id = $1 AND project_id = $2`,
        [input.snapshotId, input.projectId]
      );
      await query(
        `UPDATE remote_agent_system3_projects
         SET active_knowledge_snapshot_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [input.snapshotId, input.projectId]
      );
      await this.transitionProject(query, {
        projectId: input.projectId,
        fromStage: project.stage,
        toStage: 'workflow_design',
        attention: 'none',
        freshness: 'current',
        actorId: input.actorId,
        workflowRunId: row.workflow_run_id,
        entityType: 'knowledge_snapshot',
        entityId: input.snapshotId,
        reason: 'Understanding candidate activated',
        metadata: { previousKnowledgeSnapshotId: previousId },
      });
      const activatedResult = await query(
        `SELECT * FROM remote_agent_system3_knowledge_snapshots
         WHERE id = $1 AND project_id = $2`,
        [input.snapshotId, input.projectId]
      );
      const activatedRow = typedRows(activatedResult, value => value as SnapshotRow)[0];
      if (!activatedRow) throw new Error('Understanding activation returned no row');
      const snapshot = asSnapshot(activatedRow);
      if (input.operation) {
        await this.completeProjectOperationClaim(query, {
          operationId: input.operation.id,
          ownerClaimToken: input.operation.ownerClaimToken,
          result: { snapshotId: snapshot.id },
        });
      }
      return snapshot;
    });
    if (activation === null) {
      throw new System3ConflictError(
        'Project sources changed; create a new Understanding candidate before activation'
      );
    }
    return activation;
  }

  async getActiveUnderstanding(projectId: string): Promise<System3KnowledgeSnapshotRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT snapshot.* FROM remote_agent_system3_knowledge_snapshots snapshot
       JOIN remote_agent_system3_projects project ON project.active_knowledge_snapshot_id = snapshot.id
       WHERE project.id = $1`,
      [projectId]
    );
    const row = typedRows(result, value => value as SnapshotRow)[0];
    return row ? asSnapshot(row) : null;
  }

  async listUnderstandingSnapshots(projectId: string): Promise<System3KnowledgeSnapshotRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_knowledge_snapshots
       WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId]
    );
    return typedRows(result, value => asSnapshot(value as SnapshotRow));
  }

  async saveReadinessContract(input: {
    projectId: string;
    knowledgeSnapshotId: string;
    workflowRunId: string;
    contract: Record<string, unknown>;
    artifactKey: string;
    expectedVersion: number;
    operation?: {
      id: string;
      ownerClaimToken: string;
      result: Record<string, unknown>;
    };
  }): Promise<System3ReadinessContractRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      await this.lockProject(query, input.projectId);
      if (input.operation) {
        await this.requireProjectOperationClaim(query, {
          operationId: input.operation.id,
          projectId: input.projectId,
          type: 'readiness',
          ownerClaimToken: input.operation.ownerClaimToken,
        });
      }
      const projectResult = await query(
        'SELECT * FROM remote_agent_system3_projects WHERE id = $1',
        [input.projectId]
      );
      const project = typedRows(projectResult, value => value as ProjectRow)[0];
      if (!project) throw new Error('System 3 project not found');
      if (Number(project.version) !== input.expectedVersion) {
        throw new System3ConflictError('Project changed; refresh before saving readiness');
      }
      if (project.active_knowledge_snapshot_id !== input.knowledgeSnapshotId) {
        throw new System3ConflictError('Knowledge snapshot changed; rerun readiness');
      }
      if (project.freshness !== 'current') {
        throw new System3ConflictError('Project inputs changed; rerun readiness');
      }
      const contract = system3ReadinessContractBodySchema.parse(input.contract);
      if (
        contract.knowledgeSnapshotId !== input.knowledgeSnapshotId ||
        contract.projectVersion !== input.expectedVersion
      ) {
        throw new System3ConflictError(
          'Readiness contract basis does not match the active project'
        );
      }
      const pending = await query(
        `SELECT COUNT(*) AS count FROM remote_agent_system3_decisions
         WHERE project_id = $1 AND knowledge_snapshot_id = $2 AND status = 'pending'`,
        [input.projectId, input.knowledgeSnapshotId]
      );
      const pendingCount = Number(
        typedRows(pending, value => value as { count: number | string })[0]?.count ?? 0
      );
      if (pendingCount > 0)
        throw new System3ConflictError('Resolve all decisions before readiness');
      const dataset = await query(
        `SELECT version.id FROM remote_agent_system3_source_versions version
         WHERE version.id = $1 AND version.project_id = $2 AND version.kind = 'dataset'
           AND version.role = 'primary' AND version.storage_status = 'ready'
           AND NOT EXISTS (
             SELECT 1 FROM remote_agent_system3_source_versions newer
             WHERE newer.project_id = version.project_id AND newer.source_id = version.source_id
               AND newer.storage_status = 'ready' AND newer.lineage_version > version.lineage_version
           )`,
        [contract.datasetSourceVersionId, input.projectId]
      );
      if (dataset.rowCount !== 1) {
        throw new System3ConflictError('Pinned Dataset Source Version changed; rerun readiness');
      }
      const serialized = JSON.stringify(contract);
      const id = randomUUID();
      const inserted = await query(
        `INSERT INTO remote_agent_system3_readiness_contracts
          (id, project_id, knowledge_snapshot_id, workflow_run_id, contract, contract_hash, artifact_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          id,
          input.projectId,
          input.knowledgeSnapshotId,
          input.workflowRunId,
          serialized,
          `sha256:${createHash('sha256').update(serialized).digest('hex')}`,
          input.artifactKey,
        ]
      );
      await this.transitionProject(query, {
        projectId: input.projectId,
        fromStage: project.stage,
        toStage: 'workflow_design',
        attention: 'none',
        freshness: 'current',
        workflowRunId: input.workflowRunId,
        entityType: 'readiness_contract',
        entityId: id,
        reason: 'Readiness contract frozen',
      });
      const row = typedRows(inserted, value => value as ReadinessContractRow)[0];
      if (!row) throw new Error('Readiness contract creation returned no row');
      const readiness = asReadinessContract(row);
      if (input.operation) {
        await this.completeProjectOperationClaim(query, {
          operationId: input.operation.id,
          ownerClaimToken: input.operation.ownerClaimToken,
          workflowRunId: input.workflowRunId,
          result: { ...input.operation.result, readinessContractId: readiness.id },
        });
      }
      return readiness;
    });
  }

  async getLatestReadinessContract(
    projectId: string
  ): Promise<System3ReadinessContractRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_readiness_contracts
       WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    );
    const row = typedRows(result, value => value as ReadinessContractRow)[0];
    return row ? asReadinessContract(row) : null;
  }

  async listDecisions(
    projectId: string,
    knowledgeSnapshotId?: string
  ): Promise<System3DecisionRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_decisions
       WHERE project_id = $1${knowledgeSnapshotId ? ' AND knowledge_snapshot_id = $2' : ''}
       ORDER BY created_at ASC`,
      knowledgeSnapshotId ? [projectId, knowledgeSnapshotId] : [projectId]
    );
    return typedRows(result, value => asDecision(value as DecisionRow));
  }

  async answerDecision(input: {
    projectId: string;
    decisionId: string;
    answer: string;
    expectedVersion: number;
  }): Promise<void> {
    await this.ensureSchema();
    await this.database.withTransaction(async query => {
      await this.lockProject(query, input.projectId);
      const project = await query('SELECT * FROM remote_agent_system3_projects WHERE id = $1', [
        input.projectId,
      ]);
      const row = typedRows(project, value => value as ProjectRow)[0];
      if (!row) throw new Error('System 3 project not found');
      if (Number(row.version) !== input.expectedVersion)
        throw new System3ConflictError('Project changed; refresh before responding');
      const existingDecisionResult = await query(
        `SELECT decision.binding, decision.knowledge_snapshot_id, snapshot.lifecycle_status
         FROM remote_agent_system3_decisions decision
         JOIN remote_agent_system3_knowledge_snapshots snapshot
           ON snapshot.id = decision.knowledge_snapshot_id
         WHERE decision.id = $1 AND decision.project_id = $2 AND decision.status = 'pending'`,
        [input.decisionId, input.projectId]
      );
      const existingDecision = typedRows(
        existingDecisionResult,
        value =>
          value as Pick<DecisionRow, 'binding' | 'knowledge_snapshot_id'> & {
            lifecycle_status: 'candidate' | 'active' | 'superseded' | 'stale';
          }
      )[0];
      if (!existingDecision) throw new Error('Pending decision not found');
      if (
        existingDecision.lifecycle_status !== 'candidate' &&
        !(
          existingDecision.lifecycle_status === 'active' &&
          existingDecision.knowledge_snapshot_id === row.active_knowledge_snapshot_id
        )
      ) {
        throw new System3ConflictError(
          'Decision belongs to a stale or superseded Knowledge Snapshot'
        );
      }
      const binding =
        existingDecision.binding === null
          ? null
          : jsonObject<UnderstandingDecisionBinding>(existingDecision.binding);
      if (
        binding?.kind === 'dataset_target_column' &&
        !binding.allowedValues.includes(input.answer)
      ) {
        throw new System3ConflictError(
          'Selected target column is not present in the linked Dataset'
        );
      }
      const decision = await query(
        `UPDATE remote_agent_system3_decisions SET status = 'answered', answer = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND project_id = $3 AND status = 'pending'`,
        [input.answer, input.decisionId, input.projectId]
      );
      if (decision.rowCount === 0) throw new Error('Pending decision not found');
      await query(
        `UPDATE remote_agent_system3_open_issues SET status = 'resolved'
         WHERE project_id = $1 AND title = (
           SELECT question FROM remote_agent_system3_decisions WHERE id = $2 AND project_id = $1
         )`,
        [input.projectId, input.decisionId]
      );
      const pending = await query(
        `SELECT COUNT(*) AS count FROM remote_agent_system3_decisions
         WHERE project_id = $1 AND knowledge_snapshot_id = $2 AND status = 'pending'`,
        [input.projectId, existingDecision.knowledge_snapshot_id]
      );
      const pendingRow = typedRows(pending, value => value as { count: number | string })[0];
      const hasPending = Number(pendingRow?.count ?? 0) > 0;
      await this.transitionProject(query, {
        projectId: input.projectId,
        fromStage: row.stage,
        toStage:
          existingDecision.lifecycle_status === 'active' && !hasPending
            ? 'workflow_design'
            : 'understanding',
        attention: hasPending ? 'decision_required' : 'none',
        entityType: 'decision',
        entityId: input.decisionId,
        reason: 'Manual review decision answered',
      });
    });
  }

  async saveCompilation(input: {
    id: string;
    projectId: string;
    knowledgeSnapshotId: string;
    plan: System3ExecutionPlan;
    definitionHash: string;
    capabilityRegistryHash: string;
    workflowBundleSnapshots: readonly System3WorkflowBundleSnapshot[];
    impactManifestId?: string;
    impactManifestIds?: readonly string[];
    expectedVersion: number;
    operation?: { id: string; ownerClaimToken: string };
  }): Promise<System3CompilationRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      if (input.operation) {
        await this.requireProjectOperationClaim(query, {
          operationId: input.operation.id,
          projectId: input.projectId,
          type: 'compile',
          ownerClaimToken: input.operation.ownerClaimToken,
        });
      }
      const workflowBundleSnapshots = input.workflowBundleSnapshots;
      const bundleActivities = new Set(
        workflowBundleSnapshots.map(snapshot => snapshot.activityId)
      );
      const expectedBundleActivities: readonly System3WorkflowBundleActivityId[] = [
        'TW-06',
        'TW-07',
        'TW-09',
      ];
      const hasCanonicalBundleSet =
        workflowBundleSnapshots.length === expectedBundleActivities.length &&
        expectedBundleActivities.every(activity => bundleActivities.has(activity));
      if (
        (input.plan.schemaVersion === 3 || workflowBundleSnapshots.length > 0) &&
        !hasCanonicalBundleSet
      ) {
        throw new System3ConflictError(
          'Compilation v3 requires exactly one workflow bundle snapshot for TW-06, TW-07 and TW-09'
        );
      }
      if (
        workflowBundleSnapshots.some(
          snapshot =>
            snapshot.projectId !== input.projectId ||
            snapshot.compilationId !== input.id ||
            snapshot.schemaVersion !== 3 ||
            snapshot.compilerVersion !== 'system3-compiler@3'
        )
      ) {
        throw new System3ConflictError(
          'Workflow bundle snapshot lineage does not match compilation'
        );
      }
      const project = await query('SELECT * FROM remote_agent_system3_projects WHERE id = $1', [
        input.projectId,
      ]);
      const projectRow = typedRows(project, value => value as ProjectRow)[0];
      if (!projectRow) throw new Error('System 3 project not found');
      if (Number(projectRow.version) !== input.expectedVersion) {
        throw new System3ConflictError('Project changed; refresh before compiling');
      }
      if (projectRow.active_knowledge_snapshot_id !== input.knowledgeSnapshotId) {
        throw new System3ConflictError('Knowledge snapshot changed; refresh before compiling');
      }
      const inserted = await query(
        `INSERT INTO remote_agent_system3_compilations
          (id, project_id, knowledge_snapshot_id, plan, definition_hash, capability_registry_hash)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          input.id,
          input.projectId,
          input.knowledgeSnapshotId,
          JSON.stringify(input.plan),
          input.definitionHash,
          input.capabilityRegistryHash,
        ]
      );
      await query(
        `INSERT INTO remote_agent_system3_product_workflow_versions
         (id, project_id, template_id, definition_hash, definition)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [
          input.plan.productWorkflowVersionId,
          input.projectId,
          input.plan.templateId,
          input.definitionHash,
          JSON.stringify({ templateId: input.plan.templateId, phases: input.plan.phases }),
        ]
      );
      await query(
        `INSERT INTO remote_agent_system3_runtime_profile_versions
          (id, project_id, profile_hash, profile)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [
          input.plan.runtimeProfileVersionId,
          input.projectId,
          input.plan.runtimeProfileHash,
          JSON.stringify(input.plan.runtimeProfile),
        ]
      );
      await query(
        `INSERT INTO remote_agent_system3_input_snapshots
          (id, project_id, knowledge_snapshot_id, source_ids, source_hashes,
           runtime_profile_version_id, runtime_profile_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.plan.inputSnapshotId,
          input.projectId,
          input.knowledgeSnapshotId,
          JSON.stringify(input.plan.inputSnapshot.sourceIds),
          JSON.stringify(input.plan.inputSnapshot.sourceHashes),
          input.plan.runtimeProfileVersionId,
          input.plan.runtimeProfileHash,
        ]
      );
      await query(
        `INSERT INTO remote_agent_system3_capability_registry_snapshots
         (id, project_id, registry_hash, registry)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [
          input.plan.capabilityRegistrySnapshotId,
          input.projectId,
          input.capabilityRegistryHash,
          JSON.stringify(input.plan.capabilityRegistry),
        ]
      );
      await query(
        `INSERT INTO remote_agent_system3_compilation_bases
          (id, project_id, compilation_id, product_workflow_version_id, input_snapshot_id,
           capability_registry_snapshot_id, compiler_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.plan.compilationBasisId,
          input.projectId,
          input.id,
          input.plan.productWorkflowVersionId,
          input.plan.inputSnapshotId,
          input.plan.capabilityRegistrySnapshotId,
          input.plan.compilerVersion,
        ]
      );
      await query(
        `INSERT INTO remote_agent_system3_execution_plan_snapshots
          (id, project_id, compilation_id, definition_hash, plan)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          input.plan.executionPlanSnapshotId,
          input.projectId,
          input.id,
          input.definitionHash,
          JSON.stringify(input.plan),
        ]
      );
      for (const snapshot of workflowBundleSnapshots) {
        await query(
          `INSERT INTO remote_agent_system3_workflow_bundle_snapshots
            (id, project_id, compilation_id, activity_id, schema_version, compiler_version,
             template_id, execution_mode, definition, definition_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            snapshot.id,
            snapshot.projectId,
            snapshot.compilationId,
            snapshot.activityId,
            snapshot.schemaVersion,
            snapshot.compilerVersion,
            snapshot.templateId,
            snapshot.executionMode,
            JSON.stringify(snapshot.definition),
            snapshot.definitionHash,
          ]
        );
      }
      await this.transitionProject(query, {
        projectId: input.projectId,
        fromStage: projectRow.stage,
        toStage: 'workflow_design',
        attention: 'approval_required',
        entityType: 'compilation',
        entityId: input.id,
        reason: 'Immutable compilation basis created',
      });
      const impactManifestIds = [
        ...(input.impactManifestIds ?? []),
        ...(input.impactManifestId ? [input.impactManifestId] : []),
      ].filter((value, index, values) => values.indexOf(value) === index);
      for (const impactManifestId of impactManifestIds) {
        await query(
          `INSERT INTO remote_agent_system3_dependency_edges
            (id, project_id, from_kind, from_id, to_kind, to_id, reason)
           VALUES ($1, $2, 'compilation', $3, 'impact_manifest', $4, $5)
           ON CONFLICT (project_id, from_kind, from_id, to_kind, to_id) DO NOTHING`,
          [
            randomUUID(),
            input.projectId,
            input.id,
            impactManifestId,
            'Compilation consumes the pending scoped-rerun impact',
          ]
        );
      }
      const row = typedRows(inserted, value => value as CompilationRow)[0];
      if (!row) throw new Error('Compilation creation returned no row');
      const compilation = asCompilation(row);
      if (input.operation) {
        await this.completeProjectOperationClaim(query, {
          operationId: input.operation.id,
          ownerClaimToken: input.operation.ownerClaimToken,
          result: {
            compilationId: compilation.id,
            definitionHash: compilation.definitionHash,
          },
        });
      }
      return compilation;
    });
  }

  async getLatestCompilation(projectId: string): Promise<System3CompilationRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_compilations
       WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    );
    const row = typedRows(result, value => value as CompilationRow)[0];
    return row ? asCompilation(row) : null;
  }

  async getCompilation(
    projectId: string,
    compilationId: string
  ): Promise<System3CompilationRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_compilations
       WHERE id = $1 AND project_id = $2`,
      [compilationId, projectId]
    );
    const row = typedRows(result, value => value as CompilationRow)[0];
    return row ? asCompilation(row) : null;
  }

  async listCompilations(projectId: string): Promise<System3CompilationRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_compilations
       WHERE project_id = $1 ORDER BY created_at DESC, id DESC`,
      [projectId]
    );
    return typedRows(result, value => asCompilation(value as CompilationRow));
  }

  async getWorkflowBundleSnapshot(input: {
    projectId: string;
    compilationId: string;
    activityId: System3WorkflowBundleActivityId;
  }): Promise<System3WorkflowBundleSnapshotRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_workflow_bundle_snapshots
       WHERE project_id = $1 AND compilation_id = $2 AND activity_id = $3`,
      [input.projectId, input.compilationId, input.activityId]
    );
    const row = typedRows(result, value => value as WorkflowBundleSnapshotRow)[0];
    return row ? asWorkflowBundleSnapshot(row) : null;
  }

  async listWorkflowBundleSnapshots(input: {
    projectId: string;
    compilationId: string;
  }): Promise<System3WorkflowBundleSnapshotRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_workflow_bundle_snapshots
       WHERE project_id = $1 AND compilation_id = $2
       ORDER BY activity_id ASC`,
      [input.projectId, input.compilationId]
    );
    return typedRows(result, value => asWorkflowBundleSnapshot(value as WorkflowBundleSnapshotRow));
  }

  async listWorkflowVersions(projectId: string): Promise<System3WorkflowVersionRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT id, project_id, template_id, definition_hash, created_at
       FROM remote_agent_system3_product_workflow_versions
       WHERE project_id = $1 ORDER BY created_at DESC, id DESC`,
      [projectId]
    );
    return typedRows(result, value => {
      const row = value as {
        id: string;
        project_id: string;
        template_id: string;
        definition_hash: string;
        created_at: Date | string;
      };
      return {
        id: row.id,
        projectId: row.project_id,
        templateId: row.template_id,
        definitionHash: row.definition_hash,
        status: 'fixed_mvp' as const,
        createdAt: iso(row.created_at),
      };
    });
  }

  async listTransitions(projectId: string): Promise<System3ProjectTransitionRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT id, project_id, from_stage, to_stage, actor_id, operation_id,
              workflow_run_id, entity_type, entity_id, from_attention, to_attention,
              from_freshness, to_freshness, project_version, metadata, reason, created_at
       FROM remote_agent_system3_project_transitions
       WHERE project_id = $1 ORDER BY created_at DESC, id DESC`,
      [projectId]
    );
    return typedRows(result, value => {
      const row = value as {
        id: string;
        project_id: string;
        from_stage: System3ProjectStage | null;
        to_stage: System3ProjectStage;
        actor_id: string | null;
        operation_id: string | null;
        workflow_run_id: string | null;
        entity_type: string | null;
        entity_id: string | null;
        from_attention: System3Attention | null;
        to_attention: System3Attention | null;
        from_freshness: System3Freshness | null;
        to_freshness: System3Freshness | null;
        project_version: number | null;
        metadata: string | Record<string, unknown>;
        reason: string;
        created_at: Date | string;
      };
      return {
        id: row.id,
        projectId: row.project_id,
        fromStage: row.from_stage,
        toStage: row.to_stage,
        actorId: row.actor_id,
        operationId: row.operation_id,
        workflowRunId: row.workflow_run_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        fromAttention: row.from_attention,
        toAttention: row.to_attention,
        fromFreshness: row.from_freshness,
        toFreshness: row.to_freshness,
        projectVersion: row.project_version,
        metadata: jsonObject<Record<string, unknown>>(row.metadata),
        reason: row.reason,
        createdAt: iso(row.created_at),
      };
    });
  }

  async approveCompilation(input: {
    id: string;
    projectId: string;
    compilationId: string;
    idempotencyKey: string;
    manifest: System3ApprovalManifest;
    expectedVersion: number;
  }): Promise<System3ApprovalRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      await this.lockProject(query, input.projectId);
      const existing = await query(
        `SELECT * FROM remote_agent_system3_approval_manifests
         WHERE project_id = $1 AND idempotency_key = $2`,
        [input.projectId, input.idempotencyKey]
      );
      const existingRow = typedRows(existing, value => value as ApprovalRow)[0];
      if (existingRow) {
        if (existingRow.compilation_id !== input.compilationId) {
          throw new System3ConflictError(
            'Idempotency-Key was already used for a different compilation'
          );
        }
        return asApproval(existingRow);
      }
      const project = await query(
        'SELECT stage, version FROM remote_agent_system3_projects WHERE id = $1',
        [input.projectId]
      );
      const projectRow = typedRows(
        project,
        value => value as { stage: System3ProjectStage; version: number | string }
      )[0];
      if (!projectRow) throw new Error('System 3 project not found');
      if (Number(projectRow.version) !== input.expectedVersion) {
        throw new System3ConflictError('Project changed; refresh before approving');
      }
      const compilation = await query(
        'SELECT id FROM remote_agent_system3_compilations WHERE id = $1 AND project_id = $2',
        [input.compilationId, input.projectId]
      );
      if (compilation.rowCount === 0) throw new Error('Compilation not found for project');
      const inserted = await query(
        `INSERT INTO remote_agent_system3_approval_manifests
          (id, project_id, compilation_id, idempotency_key, manifest)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          input.id,
          input.projectId,
          input.compilationId,
          input.idempotencyKey,
          JSON.stringify(input.manifest),
        ]
      );
      await this.transitionProject(query, {
        projectId: input.projectId,
        fromStage: projectRow.stage,
        toStage: 'approved',
        attention: 'none',
        actorId: input.manifest.approvedBy,
        entityType: 'approval_manifest',
        entityId: input.id,
        reason: 'Approval manifest accepted',
      });
      const row = typedRows(inserted, value => value as ApprovalRow)[0];
      if (!row) throw new Error('Approval manifest creation returned no row');
      return asApproval(row);
    });
  }

  async getLatestApproval(projectId: string): Promise<System3ApprovalRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_approval_manifests
       WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    );
    const row = typedRows(result, value => value as ApprovalRow)[0];
    return row ? asApproval(row) : null;
  }

  async getApproval(projectId: string, approvalId: string): Promise<System3ApprovalRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_approval_manifests
       WHERE id = $1 AND project_id = $2`,
      [approvalId, projectId]
    );
    const row = typedRows(result, value => value as ApprovalRow)[0];
    return row ? asApproval(row) : null;
  }

  async getApprovalByIdempotencyKey(
    projectId: string,
    idempotencyKey: string
  ): Promise<System3ApprovalRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_approval_manifests
       WHERE project_id = $1 AND idempotency_key = $2`,
      [projectId, idempotencyKey]
    );
    const row = typedRows(result, value => value as ApprovalRow)[0];
    return row ? asApproval(row) : null;
  }

  async listApprovals(projectId: string): Promise<System3ApprovalRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_approval_manifests
       WHERE project_id = $1 ORDER BY created_at DESC, id DESC`,
      [projectId]
    );
    return typedRows(result, value => asApproval(value as ApprovalRow));
  }

  async beginExecution(input: {
    executionId: string;
    projectId: string;
    approvalId: string;
    definitionHash: string;
    bundleSnapshotId: string;
    bundleHash: string;
    runtimeBindings: Record<string, unknown>;
    expectedVersion: number;
    idempotencyKey: string;
    conversationId: string;
    codebaseId: string;
    userId?: string;
    workingPath: string;
  }): Promise<{
    execution: System3ExecutionRecord;
    operation: System3OperationRecord;
    workflowRun: System3PrecreatedWorkflowRun;
    existing: boolean;
  }> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      await this.lockProject(query, input.projectId);
      const requestFingerprint = `sha256:${createHash('sha256')
        .update(
          canonicalJson({
            approvalId: input.approvalId,
            definitionHash: input.definitionHash,
            bundleSnapshotId: input.bundleSnapshotId,
            bundleHash: input.bundleHash,
            runtimeBindings: input.runtimeBindings,
            expectedVersion: input.expectedVersion,
          })
        )
        .digest('hex')}`;
      const existingResult = await query(
        `SELECT operation.*, execution.workflow_run_id AS execution_workflow_run_id,
                execution.approval_id,
                execution.definition_hash, execution.status AS execution_status,
                execution.bundle_snapshot_id AS execution_bundle_snapshot_id,
                execution.bundle_hash AS execution_bundle_hash,
                execution.runtime_bindings AS execution_runtime_bindings,
                execution.error AS execution_error, execution.created_at AS execution_created_at,
                execution.updated_at AS execution_updated_at
         FROM remote_agent_system3_project_operations operation
         JOIN remote_agent_system3_project_executions execution ON execution.id = operation.execution_id
         WHERE operation.project_id = $1 AND operation.operation_type = 'execute'
           AND operation.idempotency_key = $2`,
        [input.projectId, input.idempotencyKey]
      );
      const existing = typedRows(
        existingResult,
        value =>
          value as OperationRow & {
            execution_workflow_run_id: string;
            approval_id: string;
            definition_hash: string;
            execution_bundle_snapshot_id: string | null;
            execution_bundle_hash: string | null;
            execution_runtime_bindings: Record<string, unknown> | string | null;
            execution_status: System3ExecutionStatus;
            execution_error: string | null;
            execution_created_at: Date | string;
            execution_updated_at: Date | string;
          }
      )[0];
      if (existing) {
        if (existing.request_fingerprint !== requestFingerprint) {
          throw new System3ConflictError(
            'Idempotency-Key was already used for a different execution request'
          );
        }
        if (existing.execution_id === null) {
          throw new Error('Execution operation is missing its execution record');
        }
        const execution = asExecution({
          id: existing.execution_id,
          project_id: existing.project_id,
          approval_id: existing.approval_id,
          workflow_run_id: existing.execution_workflow_run_id,
          definition_hash: existing.definition_hash,
          bundle_snapshot_id: existing.execution_bundle_snapshot_id,
          bundle_hash: existing.execution_bundle_hash,
          runtime_bindings: existing.execution_runtime_bindings,
          status: existing.execution_status,
          error: existing.execution_error,
          created_at: existing.execution_created_at,
          updated_at: existing.execution_updated_at,
        });
        const now = new Date();
        return {
          execution,
          operation: asOperation(existing),
          workflowRun: {
            id: execution.workflowRunId,
            workflow_name: 'system3-customer-churn-execution',
            conversation_id: input.conversationId,
            parent_conversation_id: null,
            parent_workflow_run_id: null,
            parent_node_id: null,
            codebase_id: input.codebaseId,
            status: 'pending',
            user_message: `Execute System 3 project ${input.projectId}`,
            metadata: { system3ProjectId: input.projectId, system3ExecutionId: execution.id },
            started_at: now,
            completed_at: null,
            last_activity_at: now,
            working_path: input.workingPath,
            user_id: input.userId ?? null,
          },
          existing: true,
        };
      }
      const projectResult = await query(
        'SELECT * FROM remote_agent_system3_projects WHERE id = $1',
        [input.projectId]
      );
      const project = typedRows(projectResult, value => value as ProjectRow)[0];
      if (!project) throw new Error('System 3 project not found');
      if (Number(project.version) !== input.expectedVersion) {
        throw new System3ConflictError('Project changed; refresh before executing');
      }
      if (project.stage !== 'approved' || project.freshness !== 'current') {
        throw new System3ConflictError('Project is not approved with current inputs');
      }
      const approvalResult = await query(
        'SELECT * FROM remote_agent_system3_approval_manifests WHERE id = $1 AND project_id = $2',
        [input.approvalId, input.projectId]
      );
      if (approvalResult.rowCount === 0) throw new Error('Approval manifest not found');
      const executionId = input.executionId;
      const operationId = randomUUID();
      const workflowRunId = randomUUID();
      const metadata = {
        system3ProjectId: input.projectId,
        system3ExecutionId: executionId,
        definitionHash: input.definitionHash,
        system3BundleSnapshotId: input.bundleSnapshotId,
        system3BundleHash: input.bundleHash,
        system3RuntimeBindings: input.runtimeBindings,
      };
      const workflowResult = await query(
        `INSERT INTO remote_agent_workflow_runs
          (id, workflow_name, conversation_id, codebase_id, user_message, metadata, working_path, user_id)
         VALUES ($1, 'system3-customer-churn-execution', $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          workflowRunId,
          input.conversationId,
          input.codebaseId,
          `Execute System 3 project ${input.projectId}`,
          JSON.stringify(metadata),
          input.workingPath,
          input.userId ?? null,
        ]
      );
      const executionResult = await query(
        `INSERT INTO remote_agent_system3_project_executions
          (id, project_id, approval_id, workflow_run_id, definition_hash, bundle_snapshot_id,
           bundle_hash, runtime_bindings, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'accepted') RETURNING *`,
        [
          executionId,
          input.projectId,
          input.approvalId,
          workflowRunId,
          input.definitionHash,
          input.bundleSnapshotId,
          input.bundleHash,
          JSON.stringify(input.runtimeBindings),
        ]
      );
      const operationResult = await query(
        `INSERT INTO remote_agent_system3_project_operations
          (id, project_id, execution_id, workflow_run_id, operation_type, status,
           idempotency_key, request_fingerprint, project_version)
         VALUES ($1, $2, $3, $4, 'execute', 'accepted', $5, $6, $7) RETURNING *`,
        [
          operationId,
          input.projectId,
          executionId,
          workflowRunId,
          input.idempotencyKey,
          requestFingerprint,
          input.expectedVersion,
        ]
      );
      await this.transitionProject(query, {
        projectId: input.projectId,
        fromStage: project.stage,
        toStage: 'executing',
        attention: 'none',
        actorId: input.userId ?? null,
        operationId,
        workflowRunId,
        entityType: 'execution',
        entityId: executionId,
        reason: 'Approved execution accepted',
      });
      const executionRow = typedRows(executionResult, value => value as ExecutionRow)[0];
      const operationRow = typedRows(operationResult, value => value as OperationRow)[0];
      const workflowRow = typedRows(
        workflowResult,
        value =>
          value as {
            started_at: Date | string;
            last_activity_at: Date | string | null;
          }
      )[0];
      if (!executionRow || !operationRow || !workflowRow) {
        throw new Error('Atomic System 3 execution creation returned no row');
      }
      return {
        execution: asExecution(executionRow),
        operation: asOperation(operationRow),
        workflowRun: {
          id: workflowRunId,
          workflow_name: 'system3-customer-churn-execution',
          conversation_id: input.conversationId,
          parent_conversation_id: null,
          parent_workflow_run_id: null,
          parent_node_id: null,
          codebase_id: input.codebaseId,
          status: 'pending',
          user_message: `Execute System 3 project ${input.projectId}`,
          metadata,
          started_at: new Date(workflowRow.started_at),
          completed_at: null,
          last_activity_at:
            workflowRow.last_activity_at === null ? null : new Date(workflowRow.last_activity_at),
          working_path: input.workingPath,
          user_id: input.userId ?? null,
        },
        existing: false,
      };
    });
  }

  async markExecutionRunning(executionId: string): Promise<void> {
    await this.ensureSchema();
    await this.database.withTransaction(async query => {
      await query(
        `UPDATE remote_agent_system3_project_executions
         SET status = 'running', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'accepted'`,
        [executionId]
      );
      await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
             heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE execution_id = $1 AND status = 'accepted'`,
        [executionId]
      );
    });
  }

  async completeBaselineExecution(input: {
    operationId: string;
    ownerClaimToken: string;
    executionId: string;
    projectId: string;
    artifact: Omit<
      System3ArtifactVersionRecord,
      | 'id'
      | 'projectId'
      | 'executionId'
      | 'knowledgeSnapshotId'
      | 'sourceVersionId'
      | 'operationId'
      | 'version'
      | 'activityId'
      | 'workflowRunId'
      | 'workflowNodeId'
      | 'displayName'
      | 'summary'
      | 'mediaType'
      | 'schemaId'
      | 'schemaVersion'
      | 'visibility'
      | 'status'
      | 'staleReason'
      | 'sourceVersionIds'
      | 'parentResourceIds'
      | 'createdAt'
    >;
  }): Promise<System3ArtifactVersionRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      const operation = await this.requireProjectOperationClaim(query, {
        operationId: input.operationId,
        projectId: input.projectId,
        type: 'execute',
        ownerClaimToken: input.ownerClaimToken,
      });
      const artifactId = randomUUID();
      const basisResult = await query(
        `SELECT input.source_ids, execution.approval_id
         FROM remote_agent_system3_project_executions execution
         JOIN remote_agent_system3_approval_manifests approval ON approval.id = execution.approval_id
         JOIN remote_agent_system3_compilation_bases basis ON basis.compilation_id = approval.compilation_id
         JOIN remote_agent_system3_input_snapshots input ON input.id = basis.input_snapshot_id
         WHERE execution.id = $1 AND execution.project_id = $2`,
        [input.executionId, input.projectId]
      );
      const basis = typedRows(
        basisResult,
        value => value as { source_ids: string[] | string; approval_id: string }
      )[0];
      if (!basis) throw new Error('Execution input basis is missing');
      const sourceVersionIds = jsonObject<string[]>(basis.source_ids);
      await query(
        `UPDATE remote_agent_system3_artifact_versions
         SET status = 'superseded', stale_reason = NULL
         WHERE project_id = $1 AND artifact_kind = 'baseline_package' AND status = 'current'`,
        [input.projectId]
      );
      const versionResult = await query(
        `SELECT COALESCE(MAX(version), 0) AS version FROM remote_agent_system3_artifact_versions
         WHERE project_id = $1 AND artifact_key = $2`,
        [input.projectId, input.artifact.artifactKey]
      );
      const version =
        Number(
          typedRows(versionResult, value => value as { version: number | string })[0]?.version ?? 0
        ) + 1;
      const inserted = await query(
        `INSERT INTO remote_agent_system3_artifact_versions
          (id, project_id, execution_id, artifact_key, artifact_kind, version, content_hash,
           size_bytes, activity_id, display_name, summary, media_type, schema_id,
           schema_version, visibility, status, source_version_ids, parent_resource_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'TW-06', 'Gói kết quả thực thi',
                 'Mã nguồn và kết quả build/test/experiment của kế hoạch đã duyệt.',
                 'application/gzip', 'system3.execution-package', '1', 'user', 'current',
                 $9, $10) RETURNING *`,
        [
          artifactId,
          input.projectId,
          input.executionId,
          input.artifact.artifactKey,
          input.artifact.artifactKind,
          version,
          input.artifact.contentHash,
          input.artifact.sizeBytes,
          JSON.stringify(sourceVersionIds),
          JSON.stringify([basis.approval_id]),
        ]
      );
      for (const sourceVersionId of sourceVersionIds) {
        await query(
          `INSERT INTO remote_agent_system3_dependency_edges
            (id, project_id, from_kind, from_id, to_kind, to_id, reason)
           VALUES ($1, $2, 'source_version', $3, 'resource', $4, $5)
           ON CONFLICT (project_id, from_kind, from_id, to_kind, to_id) DO NOTHING`,
          [
            randomUUID(),
            input.projectId,
            sourceVersionId,
            artifactId,
            'Kết quả thực thi dùng phiên bản nguồn này.',
          ]
        );
      }
      await query(
        `UPDATE remote_agent_system3_project_executions
         SET status = 'completed', error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [input.executionId]
      );
      const completed = await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'succeeded', result = $1, error = NULL, heartbeat_at = CURRENT_TIMESTAMP,
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND operation_type = 'execute' AND status = 'running'
           AND owner_claim_token = $3`,
        [
          JSON.stringify({ executionId: input.executionId, artifactId }),
          input.operationId,
          input.ownerClaimToken,
        ]
      );
      if (completed.rowCount !== 1) {
        throw new System3ConflictError('Execution claim was lost before artifact commit');
      }
      await this.transitionProject(query, {
        projectId: input.projectId,
        toStage: 'verifying',
        attention: 'none',
        operationId: operation.id,
        workflowRunId: operation.workflow_run_id,
        entityType: 'execution',
        entityId: input.executionId,
        reason: 'Baseline execution completed; verification required',
        metadata: { artifactId },
      });
      const row = typedRows(inserted, value => value as ArtifactVersionRow)[0];
      if (!row) throw new Error('Baseline artifact creation returned no row');
      return asArtifactVersion(row);
    });
  }

  async getBaselineArtifact(executionId: string): Promise<System3ArtifactVersionRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_artifact_versions
       WHERE execution_id = $1 AND artifact_kind = 'baseline_package'
       ORDER BY created_at DESC LIMIT 1`,
      [executionId]
    );
    const row = typedRows(result, value => value as ArtifactVersionRow)[0];
    return row ? asArtifactVersion(row) : null;
  }

  async beginVerification(input: {
    verificationId: string;
    projectId: string;
    executionId: string;
    inputArtifactId: string;
    basisHash: string;
    bundleSnapshotId: string;
    bundleHash: string;
    runtimeBindings: Record<string, unknown>;
    expectedVersion: number;
    idempotencyKey: string;
    conversationId: string;
    codebaseId: string;
    userId?: string;
    workingPath: string;
  }): Promise<{
    verification: System3VerificationRecord;
    operation: System3OperationRecord;
    workflowRun: System3PrecreatedWorkflowRun;
    existing: boolean;
  }> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      await this.lockProject(query, input.projectId);
      const fingerprint = `sha256:${createHash('sha256')
        .update(
          canonicalJson({
            executionId: input.executionId,
            inputArtifactId: input.inputArtifactId,
            basisHash: input.basisHash,
            bundleSnapshotId: input.bundleSnapshotId,
            bundleHash: input.bundleHash,
            runtimeBindings: input.runtimeBindings,
            expectedVersion: input.expectedVersion,
          })
        )
        .digest('hex')}`;
      const existingResult = await query(
        `SELECT operation.*, verification.id AS verification_id,
                verification.execution_id AS verification_execution_id,
                verification.workflow_run_id AS verification_workflow_run_id,
                verification.input_artifact_id, verification.status AS verification_status,
                verification.validator_version, verification.basis_hash,
                verification.bundle_snapshot_id AS verification_bundle_snapshot_id,
                verification.bundle_hash AS verification_bundle_hash,
                verification.runtime_bindings AS verification_runtime_bindings,
                verification.evidence_map, verification.gate,
                verification.error AS verification_error,
                verification.created_at AS verification_created_at,
                verification.updated_at AS verification_updated_at
         FROM remote_agent_system3_project_operations operation
         JOIN remote_agent_system3_verifications verification
           ON verification.workflow_run_id = operation.workflow_run_id
         WHERE operation.project_id = $1 AND operation.operation_type = 'verify'
           AND operation.idempotency_key = $2`,
        [input.projectId, input.idempotencyKey]
      );
      const existing = typedRows(
        existingResult,
        value =>
          value as OperationRow & {
            verification_id: string;
            verification_execution_id: string;
            verification_workflow_run_id: string;
            input_artifact_id: string;
            verification_status: System3ExecutionStatus;
            validator_version: string;
            basis_hash: string;
            verification_bundle_snapshot_id: string | null;
            verification_bundle_hash: string | null;
            verification_runtime_bindings: Record<string, unknown> | string | null;
            evidence_map: Record<string, unknown> | string | null;
            gate: Record<string, unknown> | string | null;
            verification_error: string | null;
            verification_created_at: Date | string;
            verification_updated_at: Date | string;
          }
      )[0];
      if (existing) {
        if (existing.request_fingerprint !== fingerprint) {
          throw new System3ConflictError(
            'Idempotency-Key was already used for a different verification request'
          );
        }
        const verification = asVerification({
          id: existing.verification_id,
          project_id: existing.project_id,
          execution_id: existing.verification_execution_id,
          workflow_run_id: existing.verification_workflow_run_id,
          input_artifact_id: existing.input_artifact_id,
          status: existing.verification_status,
          validator_version: existing.validator_version,
          basis_hash: existing.basis_hash,
          bundle_snapshot_id: existing.verification_bundle_snapshot_id,
          bundle_hash: existing.verification_bundle_hash,
          runtime_bindings: existing.verification_runtime_bindings,
          evidence_map: existing.evidence_map,
          gate: existing.gate,
          error: existing.verification_error,
          created_at: existing.verification_created_at,
          updated_at: existing.verification_updated_at,
        });
        return {
          verification,
          operation: asOperation(existing),
          workflowRun: precreatedSystem3Run(input, verification.workflowRunId, 'verification'),
          existing: true,
        };
      }
      const projectResult = await query(
        'SELECT * FROM remote_agent_system3_projects WHERE id = $1',
        [input.projectId]
      );
      const project = typedRows(projectResult, value => value as ProjectRow)[0];
      if (!project) throw new Error('System 3 project not found');
      if (Number(project.version) !== input.expectedVersion) {
        throw new System3ConflictError('Project changed; refresh before verifying');
      }
      if (project.freshness !== 'current' || !['verifying', 'delivery'].includes(project.stage)) {
        throw new System3ConflictError('Execution basis is not current for verification');
      }
      const execution = await query(
        `SELECT id FROM remote_agent_system3_project_executions
         WHERE id = $1 AND project_id = $2 AND status = 'completed'`,
        [input.executionId, input.projectId]
      );
      if (execution.rowCount === 0)
        throw new System3ConflictError('Baseline execution is incomplete');
      const artifact = await query(
        `SELECT id, content_hash FROM remote_agent_system3_artifact_versions
         WHERE id = $1 AND execution_id = $2 AND artifact_kind = 'baseline_package'`,
        [input.inputArtifactId, input.executionId]
      );
      const artifactRow = typedRows(
        artifact,
        value => value as { id: string; content_hash: string }
      )[0];
      if (artifactRow?.content_hash !== input.basisHash) {
        throw new System3ConflictError('Baseline artifact basis is stale or tampered');
      }
      const verificationId = input.verificationId;
      const workflowRunId = randomUUID();
      const operationId = randomUUID();
      const workflowRun = precreatedSystem3Run(input, workflowRunId, 'verification');
      await query(
        `INSERT INTO remote_agent_workflow_runs
          (id, workflow_name, conversation_id, codebase_id, user_message, metadata, working_path, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          workflowRunId,
          workflowRun.workflow_name,
          input.conversationId,
          input.codebaseId,
          workflowRun.user_message,
          JSON.stringify(workflowRun.metadata),
          input.workingPath,
          input.userId ?? null,
        ]
      );
      const verificationResult = await query(
        `INSERT INTO remote_agent_system3_verifications
          (id, project_id, execution_id, workflow_run_id, input_artifact_id, status,
           validator_version, basis_hash, bundle_snapshot_id, bundle_hash, runtime_bindings)
         VALUES ($1, $2, $3, $4, $5, 'accepted', 'system3-validator@1', $6, $7, $8, $9) RETURNING *`,
        [
          verificationId,
          input.projectId,
          input.executionId,
          workflowRunId,
          input.inputArtifactId,
          input.basisHash,
          input.bundleSnapshotId,
          input.bundleHash,
          JSON.stringify(input.runtimeBindings),
        ]
      );
      const operationResult = await query(
        `INSERT INTO remote_agent_system3_project_operations
          (id, project_id, execution_id, workflow_run_id, operation_type, status,
           idempotency_key, request_fingerprint, project_version)
         VALUES ($1, $2, $3, $4, 'verify', 'accepted', $5, $6, $7) RETURNING *`,
        [
          operationId,
          input.projectId,
          input.executionId,
          workflowRunId,
          input.idempotencyKey,
          fingerprint,
          input.expectedVersion,
        ]
      );
      await this.transitionProject(query, {
        projectId: input.projectId,
        fromStage: project.stage,
        toStage: 'verifying',
        attention: 'none',
        actorId: input.userId ?? null,
        operationId,
        workflowRunId,
        entityType: 'verification',
        entityId: verificationId,
        reason: 'Verification accepted',
      });
      const verificationRow = typedRows(verificationResult, value => value as VerificationRow)[0];
      const operationRow = typedRows(operationResult, value => value as OperationRow)[0];
      if (!verificationRow || !operationRow)
        throw new Error('Verification creation returned no row');
      return {
        verification: asVerification(verificationRow),
        operation: asOperation(operationRow),
        workflowRun,
        existing: false,
      };
    });
  }

  async markVerificationRunning(verificationId: string): Promise<void> {
    await this.ensureSchema();
    await this.database.withTransaction(async query => {
      await query(
        `UPDATE remote_agent_system3_verifications SET status = 'running', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'accepted'`,
        [verificationId]
      );
    });
  }

  async completeVerification(input: {
    operationId: string;
    ownerClaimToken: string;
    verificationId: string;
    projectId: string;
    executionId: string;
    evidenceMap: Record<string, unknown>;
    gate: Record<string, unknown>;
    evidence: Omit<
      System3EvidenceRecord,
      | 'id'
      | 'projectId'
      | 'executionId'
      | 'verificationId'
      | 'validatorVersion'
      | 'basisHash'
      | 'createdAt'
    >[];
  }): Promise<void> {
    await this.ensureSchema();
    await this.database.withTransaction(async query => {
      const operation = await this.requireProjectOperationClaim(query, {
        operationId: input.operationId,
        projectId: input.projectId,
        type: 'verify',
        ownerClaimToken: input.ownerClaimToken,
      });
      const verificationResult = await query(
        'SELECT * FROM remote_agent_system3_verifications WHERE id = $1 AND project_id = $2',
        [input.verificationId, input.projectId]
      );
      const verification = typedRows(verificationResult, value => value as VerificationRow)[0];
      if (!verification) throw new Error('Verification not found');
      for (const evidence of input.evidence) {
        await query(
          `INSERT INTO remote_agent_system3_evidence_records
            (id, project_id, execution_id, verification_id, requirement_id, status,
             validator_version, basis_hash, evidence, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            randomUUID(),
            input.projectId,
            input.executionId,
            input.verificationId,
            evidence.requirementId,
            evidence.status,
            verification.validator_version,
            verification.basis_hash,
            JSON.stringify(evidence.evidence),
            evidence.reason,
          ]
        );
      }
      await query(
        `UPDATE remote_agent_system3_verifications
         SET status = 'completed', evidence_map = $1, gate = $2, error = NULL,
             updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [JSON.stringify(input.evidenceMap), JSON.stringify(input.gate), input.verificationId]
      );
      const completed = await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'succeeded', result = $1, error = NULL, heartbeat_at = CURRENT_TIMESTAMP,
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND operation_type = 'verify' AND status = 'running'
           AND owner_claim_token = $3`,
        [
          JSON.stringify({ verificationId: input.verificationId }),
          input.operationId,
          input.ownerClaimToken,
        ]
      );
      if (completed.rowCount !== 1) {
        throw new System3ConflictError('Verification claim was lost before evidence commit');
      }
      await this.transitionProject(query, {
        projectId: input.projectId,
        toStage: 'delivery',
        attention: 'none',
        operationId: operation.id,
        workflowRunId: verification.workflow_run_id,
        entityType: 'verification',
        entityId: input.verificationId,
        reason: 'Verification passed; delivery review required',
      });
    });
  }

  async failVerification(input: {
    operationId: string;
    ownerClaimToken: string;
    verificationId: string;
    projectId: string;
    error: string;
    evidenceMap?: Record<string, unknown>;
    gate?: Record<string, unknown>;
  }): Promise<boolean> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      let operation: OperationRow;
      try {
        operation = await this.requireProjectOperationClaim(query, {
          operationId: input.operationId,
          projectId: input.projectId,
          type: 'verify',
          ownerClaimToken: input.ownerClaimToken,
        });
      } catch (error) {
        if (error instanceof System3ConflictError) return false;
        throw error;
      }
      const verificationResult = await query(
        'SELECT * FROM remote_agent_system3_verifications WHERE id = $1',
        [input.verificationId]
      );
      const verification = typedRows(verificationResult, value => value as VerificationRow)[0];
      if (!verification) return false;
      await query(
        `UPDATE remote_agent_system3_verifications
         SET status = 'failed', error = $1, evidence_map = COALESCE($3, evidence_map),
             gate = COALESCE($4, gate), updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [
          input.error,
          input.verificationId,
          input.evidenceMap ? JSON.stringify(input.evidenceMap) : null,
          input.gate ? JSON.stringify(input.gate) : null,
        ]
      );
      const failed = await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'failed', error = $1, finished_at = CURRENT_TIMESTAMP,
             heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND operation_type = 'verify' AND status = 'running'
           AND owner_claim_token = $3`,
        [input.error, input.operationId, input.ownerClaimToken]
      );
      if (failed.rowCount !== 1) return false;
      await this.transitionProject(query, {
        projectId: input.projectId,
        toStage: 'verifying',
        attention: 'failed',
        operationId: operation.id,
        workflowRunId: verification.workflow_run_id,
        entityType: 'verification',
        entityId: input.verificationId,
        reason: 'Verification failed',
        metadata: { error: input.error },
      });
      return true;
    });
  }

  async getVerification(verificationId: string): Promise<System3VerificationRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      'SELECT * FROM remote_agent_system3_verifications WHERE id = $1',
      [verificationId]
    );
    const row = typedRows(result, value => value as VerificationRow)[0];
    return row ? asVerification(row) : null;
  }

  async getLatestVerification(projectId: string): Promise<System3VerificationRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_verifications
       WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    );
    const row = typedRows(result, value => value as VerificationRow)[0];
    return row ? asVerification(row) : null;
  }

  async listVerifications(projectId: string): Promise<System3VerificationRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_verifications
       WHERE project_id = $1 ORDER BY created_at DESC, id DESC`,
      [projectId]
    );
    return typedRows(result, value => asVerification(value as VerificationRow));
  }

  async beginDelivery(input: {
    deliveryId: string;
    projectId: string;
    executionId: string;
    verificationId: string;
    bundleSnapshotId: string;
    bundleHash: string;
    runtimeBindings: Record<string, unknown>;
    expectedVersion: number;
    idempotencyKey: string;
    conversationId: string;
    codebaseId: string;
    userId?: string;
    workingPath: string;
  }): Promise<{
    operation: System3OperationRecord;
    workflowRun: System3PrecreatedWorkflowRun;
    existing: boolean;
  }> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      await this.lockProject(query, input.projectId);
      const fingerprint = `sha256:${createHash('sha256')
        .update(
          canonicalJson({
            executionId: input.executionId,
            verificationId: input.verificationId,
            bundleSnapshotId: input.bundleSnapshotId,
            bundleHash: input.bundleHash,
            runtimeBindings: input.runtimeBindings,
            expectedVersion: input.expectedVersion,
          })
        )
        .digest('hex')}`;
      const existingResult = await query(
        `SELECT * FROM remote_agent_system3_project_operations
         WHERE project_id = $1 AND operation_type = 'delivery' AND idempotency_key = $2`,
        [input.projectId, input.idempotencyKey]
      );
      const existing = typedRows(existingResult, value => value as OperationRow)[0];
      if (existing) {
        if (existing.request_fingerprint !== fingerprint) {
          throw new System3ConflictError(
            'Idempotency-Key was already used for a different delivery request'
          );
        }
        if (!existing.workflow_run_id)
          throw new Error('Delivery operation is missing workflow run');
        return {
          operation: asOperation(existing),
          workflowRun: precreatedSystem3Run(input, existing.workflow_run_id, 'delivery'),
          existing: true,
        };
      }
      const projectResult = await query(
        'SELECT * FROM remote_agent_system3_projects WHERE id = $1',
        [input.projectId]
      );
      const project = typedRows(projectResult, value => value as ProjectRow)[0];
      if (!project) throw new Error('System 3 project not found');
      if (Number(project.version) !== input.expectedVersion) {
        throw new System3ConflictError('Project changed; refresh before creating delivery');
      }
      if (project.stage !== 'delivery' || project.freshness !== 'current') {
        throw new System3ConflictError(
          'A current successful verification is required for delivery'
        );
      }
      const verificationResult = await query(
        `SELECT * FROM remote_agent_system3_verifications
         WHERE id = $1 AND project_id = $2 AND execution_id = $3 AND status = 'completed'`,
        [input.verificationId, input.projectId, input.executionId]
      );
      const verification = typedRows(verificationResult, value => value as VerificationRow)[0];
      if (verification?.gate == null) {
        throw new System3ConflictError('Verification is not ready for delivery');
      }
      const gate = jsonObject<Record<string, unknown>>(verification.gate);
      if (gate.status !== 'passed') throw new System3ConflictError('Verification gate is blocked');
      const workflowRunId = randomUUID();
      const operationId = randomUUID();
      const workflowRun = precreatedSystem3Run(input, workflowRunId, 'delivery');
      await query(
        `INSERT INTO remote_agent_workflow_runs
          (id, workflow_name, conversation_id, codebase_id, user_message, metadata, working_path, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          workflowRunId,
          workflowRun.workflow_name,
          input.conversationId,
          input.codebaseId,
          workflowRun.user_message,
          JSON.stringify({
            ...workflowRun.metadata,
            system3VerificationId: input.verificationId,
            system3DeliveryId: input.deliveryId,
          }),
          input.workingPath,
          input.userId ?? null,
        ]
      );
      const operationResult = await query(
        `INSERT INTO remote_agent_system3_project_operations
          (id, project_id, execution_id, workflow_run_id, operation_type, status,
           idempotency_key, request_fingerprint, project_version)
         VALUES ($1, $2, $3, $4, 'delivery', 'accepted', $5, $6, $7) RETURNING *`,
        [
          operationId,
          input.projectId,
          input.executionId,
          workflowRunId,
          input.idempotencyKey,
          fingerprint,
          input.expectedVersion,
        ]
      );
      await this.transitionProject(query, {
        projectId: input.projectId,
        fromStage: project.stage,
        toStage: 'delivery',
        attention: 'none',
        actorId: input.userId ?? null,
        operationId,
        workflowRunId,
        entityType: 'delivery',
        entityId: operationId,
        reason: 'Delivery accepted',
        metadata: { verificationId: input.verificationId },
      });
      const operation = typedRows(operationResult, value => value as OperationRow)[0];
      if (!operation) throw new Error('Delivery operation creation returned no row');
      return { operation: asOperation(operation), workflowRun, existing: false };
    });
  }

  async completeDelivery(input: {
    deliveryId: string;
    operationId: string;
    ownerClaimToken: string;
    projectId: string;
    executionId: string;
    verificationId: string;
    bundleSnapshotId: string;
    bundleHash: string;
    runtimeBindings: Record<string, unknown>;
    delivery: Omit<
      System3DeliveryRecord,
      | 'id'
      | 'projectId'
      | 'executionId'
      | 'verificationId'
      | 'bundleSnapshotId'
      | 'bundleHash'
      | 'runtimeBindings'
      | 'createdAt'
    >;
  }): Promise<System3DeliveryRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      const operation = await this.requireProjectOperationClaim(query, {
        operationId: input.operationId,
        projectId: input.projectId,
        type: 'delivery',
        ownerClaimToken: input.ownerClaimToken,
      });
      const basisResult = await query(
        `SELECT input.source_ids
         FROM remote_agent_system3_project_executions execution
         JOIN remote_agent_system3_approval_manifests approval ON approval.id = execution.approval_id
         JOIN remote_agent_system3_compilation_bases basis ON basis.compilation_id = approval.compilation_id
         JOIN remote_agent_system3_input_snapshots input ON input.id = basis.input_snapshot_id
         WHERE execution.id = $1 AND execution.project_id = $2`,
        [input.executionId, input.projectId]
      );
      const basis = typedRows(basisResult, value => value as { source_ids: string[] | string })[0];
      if (!basis) throw new Error('Delivery input basis is missing');
      const sourceVersionIds = jsonObject<string[]>(basis.source_ids);
      const inserted = await query(
        `INSERT INTO remote_agent_system3_delivery_manifests
          (id, project_id, execution_id, verification_id, package_storage_key, package_filename,
           content_hash, size_bytes, bundle_snapshot_id, bundle_hash, runtime_bindings, manifest)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [
          input.deliveryId,
          input.projectId,
          input.executionId,
          input.verificationId,
          input.delivery.packageStorageKey,
          input.delivery.packageFilename,
          input.delivery.contentHash,
          input.delivery.sizeBytes,
          input.bundleSnapshotId,
          input.bundleHash,
          JSON.stringify(input.runtimeBindings),
          JSON.stringify(input.delivery.manifest),
        ]
      );
      const versionResult = await query(
        `SELECT COALESCE(MAX(version), 0) AS version FROM remote_agent_system3_artifact_versions
         WHERE project_id = $1 AND artifact_key = $2`,
        [input.projectId, input.delivery.packageStorageKey]
      );
      const version =
        Number(
          typedRows(versionResult, value => value as { version: number | string })[0]?.version ?? 0
        ) + 1;
      const deliveryArtifactId = randomUUID();
      await query(
        `INSERT INTO remote_agent_system3_artifact_versions
          (id, project_id, execution_id, artifact_key, artifact_kind, version, content_hash,
           size_bytes, activity_id, display_name, summary, media_type, schema_id,
           schema_version, visibility, status, source_version_ids, parent_resource_ids)
         VALUES ($1, $2, $3, $4, 'delivery_package', $5, $6, $7, 'TW-09', 'Gói bàn giao',
                 'Gói bàn giao được tạo từ kết quả đã xác minh.', 'application/gzip',
                 'system3.delivery-package', '1', 'user', 'current', $8, $9)`,
        [
          deliveryArtifactId,
          input.projectId,
          input.executionId,
          input.delivery.packageStorageKey,
          version,
          input.delivery.contentHash,
          input.delivery.sizeBytes,
          JSON.stringify(sourceVersionIds),
          JSON.stringify([input.verificationId]),
        ]
      );
      for (const sourceVersionId of sourceVersionIds) {
        await query(
          `INSERT INTO remote_agent_system3_dependency_edges
            (id, project_id, from_kind, from_id, to_kind, to_id, reason)
           VALUES ($1, $2, 'source_version', $3, 'resource', $4, $5)
           ON CONFLICT (project_id, from_kind, from_id, to_kind, to_id) DO NOTHING`,
          [
            randomUUID(),
            input.projectId,
            sourceVersionId,
            deliveryArtifactId,
            'Gói bàn giao dùng phiên bản nguồn này.',
          ]
        );
      }
      const completed = await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'succeeded', result = $1, error = NULL, heartbeat_at = CURRENT_TIMESTAMP,
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND status = 'running' AND owner_claim_token = $3`,
        [
          JSON.stringify({ deliveryId: typedRows(inserted, value => value as DeliveryRow)[0]?.id }),
          input.operationId,
          input.ownerClaimToken,
        ]
      );
      if (completed.rowCount !== 1) {
        throw new System3ConflictError('Delivery claim was lost before manifest commit');
      }
      await this.transitionProject(query, {
        projectId: input.projectId,
        toStage: 'delivered',
        attention: 'none',
        operationId: input.operationId,
        workflowRunId: operation.workflow_run_id,
        entityType: 'delivery_manifest',
        entityId: typedRows(inserted, value => value as DeliveryRow)[0]?.id ?? input.operationId,
        reason: 'Delivery manifest and package stored',
      });
      const row = typedRows(inserted, value => value as DeliveryRow)[0];
      if (!row) throw new Error('Delivery manifest creation returned no row');
      return asDelivery(row);
    });
  }

  async failDelivery(input: {
    operationId: string;
    ownerClaimToken: string;
    projectId: string;
    error: string;
  }): Promise<boolean> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      let operation: OperationRow;
      try {
        operation = await this.requireProjectOperationClaim(query, {
          operationId: input.operationId,
          projectId: input.projectId,
          type: 'delivery',
          ownerClaimToken: input.ownerClaimToken,
        });
      } catch (error) {
        if (error instanceof System3ConflictError) return false;
        throw error;
      }
      const failed = await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'failed', error = $1, heartbeat_at = CURRENT_TIMESTAMP,
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND operation_type = 'delivery' AND status = 'running'
           AND owner_claim_token = $3`,
        [input.error, input.operationId, input.ownerClaimToken]
      );
      if (failed.rowCount !== 1) return false;
      await this.transitionProject(query, {
        projectId: input.projectId,
        toStage: 'delivery',
        attention: 'failed',
        operationId: input.operationId,
        workflowRunId: operation.workflow_run_id,
        entityType: 'delivery',
        entityId: input.operationId,
        reason: 'Delivery failed',
        metadata: { error: input.error },
      });
      return true;
    });
  }

  async completeExecution(input: {
    operationId: string;
    ownerClaimToken: string;
    executionId: string;
    projectId: string;
    delivery: Omit<System3DeliveryRecord, 'id' | 'projectId' | 'executionId' | 'createdAt'>;
    evidence: Omit<System3EvidenceRecord, 'id' | 'projectId' | 'executionId' | 'createdAt'>[];
  }): Promise<void> {
    await this.ensureSchema();
    await this.database.withTransaction(async query => {
      const operationClaim = await this.requireProjectOperationClaim(query, {
        operationId: input.operationId,
        projectId: input.projectId,
        type: 'execute',
        ownerClaimToken: input.ownerClaimToken,
      });
      for (const evidence of input.evidence) {
        const evidenceId = randomUUID();
        await query(
          `INSERT INTO remote_agent_system3_evidence_records
            (id, project_id, execution_id, requirement_id, status, evidence, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            evidenceId,
            input.projectId,
            input.executionId,
            evidence.requirementId,
            evidence.status,
            JSON.stringify(evidence.evidence),
            evidence.reason,
          ]
        );
        if (evidence.requirementId !== null) {
          await query(
            `INSERT INTO remote_agent_system3_dependency_edges
              (id, project_id, from_kind, from_id, to_kind, to_id, reason)
             VALUES ($1, $2, 'requirement', $3, 'evidence', $4, $5)
             ON CONFLICT (project_id, from_kind, from_id, to_kind, to_id) DO NOTHING`,
            [
              randomUUID(),
              input.projectId,
              evidence.requirementId,
              evidenceId,
              'Requirement verification record',
            ]
          );
        }
      }
      await query(
        `INSERT INTO remote_agent_system3_delivery_manifests
          (id, project_id, execution_id, package_storage_key, package_filename, content_hash, size_bytes, manifest)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          input.projectId,
          input.executionId,
          input.delivery.packageStorageKey,
          input.delivery.packageFilename,
          input.delivery.contentHash,
          input.delivery.sizeBytes,
          JSON.stringify(input.delivery.manifest),
        ]
      );
      const versionResult = await query(
        `SELECT COALESCE(MAX(version), 0) AS version FROM remote_agent_system3_artifact_versions
         WHERE project_id = $1 AND artifact_key = $2`,
        [input.projectId, input.delivery.packageStorageKey]
      );
      const versionRow = typedRows(
        versionResult,
        value => value as { version: number | string }
      )[0];
      await query(
        `INSERT INTO remote_agent_system3_artifact_versions
          (id, project_id, execution_id, artifact_key, artifact_kind, version, content_hash, size_bytes)
         VALUES ($1, $2, $3, $4, 'delivery_package', $5, $6, $7)`,
        [
          randomUUID(),
          input.projectId,
          input.executionId,
          input.delivery.packageStorageKey,
          Number(versionRow?.version ?? 0) + 1,
          input.delivery.contentHash,
          input.delivery.sizeBytes,
        ]
      );
      await query(
        `INSERT INTO remote_agent_system3_dependency_edges
          (id, project_id, from_kind, from_id, to_kind, to_id, reason)
         VALUES ($1, $2, 'execution', $3, 'artifact', $4, $5)`,
        [
          randomUUID(),
          input.projectId,
          input.executionId,
          input.delivery.packageStorageKey,
          'Delivery artifact produced by execution',
        ]
      );
      await query(
        `UPDATE remote_agent_system3_project_executions
         SET status = 'completed', error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [input.executionId]
      );
      const completed = await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'succeeded', error = NULL, heartbeat_at = CURRENT_TIMESTAMP,
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND operation_type = 'execute' AND status = 'running'
           AND owner_claim_token = $2`,
        [input.operationId, input.ownerClaimToken]
      );
      if (completed.rowCount !== 1) {
        throw new System3ConflictError('Execution claim was lost before completion');
      }
      await this.transitionProject(query, {
        projectId: input.projectId,
        toStage: 'delivered',
        attention: 'none',
        operationId: operationClaim.id,
        workflowRunId: operationClaim.workflow_run_id,
        entityType: 'execution',
        entityId: input.executionId,
        reason: 'Execution, verification, and delivery completed',
      });
    });
  }

  async failExecution(input: {
    operationId: string;
    ownerClaimToken: string;
    executionId: string;
    projectId: string;
    error: string;
  }): Promise<boolean> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      let operation: OperationRow;
      try {
        operation = await this.requireProjectOperationClaim(query, {
          operationId: input.operationId,
          projectId: input.projectId,
          type: 'execute',
          ownerClaimToken: input.ownerClaimToken,
        });
      } catch (error) {
        if (error instanceof System3ConflictError) return false;
        throw error;
      }
      await query(
        `UPDATE remote_agent_system3_project_executions
         SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND status IN ('accepted', 'running')`,
        [input.error, input.executionId]
      );
      const failed = await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'failed', error = $1, heartbeat_at = CURRENT_TIMESTAMP,
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND operation_type = 'execute' AND status = 'running'
           AND owner_claim_token = $3`,
        [input.error, input.operationId, input.ownerClaimToken]
      );
      if (failed.rowCount !== 1) return false;
      await this.transitionProject(query, {
        projectId: input.projectId,
        toStage: 'approved',
        attention: 'failed',
        operationId: operation.id,
        workflowRunId: operation.workflow_run_id,
        entityType: 'execution',
        entityId: input.executionId,
        reason: 'Execution failed',
        metadata: { error: input.error },
      });
      return true;
    });
  }

  /** User-triggered reconciliation only; no timer may abandon cross-process work. */
  async abandonUnknownOperation(operationId: string): Promise<System3OperationRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      const result = await query(
        'SELECT * FROM remote_agent_system3_project_operations WHERE id = $1',
        [operationId]
      );
      const row = typedRows(result, value => value as OperationRow)[0];
      if (!row) throw new Error('System 3 operation not found');
      await this.lockProject(query, row.project_id);
      const lockedResult = await query(
        `SELECT * FROM remote_agent_system3_project_operations WHERE id = $1${
          this.database.dialect === 'postgres' ? ' FOR UPDATE' : ''
        }`,
        [operationId]
      );
      const lockedRow = typedRows(lockedResult, value => value as OperationRow)[0];
      if (!lockedRow) throw new Error('System 3 operation not found');
      const current = lockedRow;
      if (current.status === 'abandoned') return asOperation(current);
      if (current.status !== 'accepted' && current.status !== 'running') {
        throw new System3ConflictError(
          `Operation with status '${current.status}' cannot be abandoned`
        );
      }
      if (hasResponsiveOperationOwner(current)) {
        throw new System3ConflictError(
          'Operation owner is still responsive; wait before abandoning the operation'
        );
      }

      const reason = 'User abandoned the operation after its owning process became unknown';
      if (current.workflow_run_id !== null) {
        await query(
          `UPDATE remote_agent_workflow_runs
           SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND status NOT IN ('completed', 'cancelled')`,
          [current.workflow_run_id]
        );
      }
      if (current.execution_id !== null) {
        await query(
          `UPDATE remote_agent_system3_project_executions
           SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND status IN ('accepted', 'running')`,
          [reason, current.execution_id]
        );
      }
      await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'abandoned', error = $1, finished_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND status IN ('accepted', 'running')
        `,
        [reason, operationId]
      );
      await this.transitionProject(query, {
        projectId: current.project_id,
        toStage:
          typedRows(
            await query('SELECT stage FROM remote_agent_system3_projects WHERE id = $1', [
              current.project_id,
            ]),
            value => value as { stage: System3ProjectStage }
          )[0]?.stage ?? 'draft',
        attention: 'failed',
        operationId: current.id,
        workflowRunId: current.workflow_run_id,
        entityType: current.execution_id === null ? 'operation' : 'execution',
        entityId: current.execution_id ?? current.id,
        reason: 'User abandoned unknown operation',
      });
      return asOperation({
        ...current,
        status: 'abandoned',
        error: reason,
        finished_at: new Date(),
        updated_at: new Date(),
      });
    });
  }

  async getOperation(operationId: string): Promise<System3OperationRecord | null> {
    await this.ensureSchema();
    const durable = await this.database.query(
      'SELECT * FROM remote_agent_system3_project_operations WHERE id = $1',
      [operationId]
    );
    const durableRow = typedRows(durable, value => value as OperationRow)[0];
    if (durableRow) return asOperation(durableRow);
    const result = await this.database.query(
      `SELECT operation.*, execution.workflow_run_id, '' AS request_fingerprint, NULL AS result
       FROM remote_agent_system3_operations operation
       JOIN remote_agent_system3_project_executions execution ON execution.id = operation.execution_id
       WHERE operation.id = $1`,
      [operationId]
    );
    const row = typedRows(result, value => value as OperationRow)[0];
    return row ? asOperation(row) : null;
  }

  async beginProjectOperation(input: {
    projectId: string;
    type: System3OperationType;
    idempotencyKey: string;
    request: Record<string, unknown>;
    expectedVersion: number;
  }): Promise<{ operation: System3OperationRecord; existing: boolean }> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      await this.lockProject(query, input.projectId);
      const fingerprint = `sha256:${createHash('sha256')
        .update(canonicalJson(input.request))
        .digest('hex')}`;
      const prior = await query(
        `SELECT * FROM remote_agent_system3_project_operations
         WHERE project_id = $1 AND operation_type = $2 AND idempotency_key = $3`,
        [input.projectId, input.type, input.idempotencyKey]
      );
      const priorRow = typedRows(prior, value => value as OperationRow)[0];
      if (priorRow) {
        if (priorRow.request_fingerprint !== fingerprint) {
          throw new System3ConflictError(
            'Idempotency-Key was already used for a different operation request'
          );
        }
        return { operation: asOperation(priorRow), existing: true };
      }
      const projectResult = await query(
        'SELECT version FROM remote_agent_system3_projects WHERE id = $1',
        [input.projectId]
      );
      const project = typedRows(projectResult, value => value as { version: number | string })[0];
      if (!project) throw new Error('System 3 project not found');
      if (Number(project.version) !== input.expectedVersion) {
        throw new System3ConflictError('Project changed; refresh before starting the operation');
      }
      const inserted = await query(
        `INSERT INTO remote_agent_system3_project_operations
          (id, project_id, operation_type, status, idempotency_key, request_fingerprint, project_version)
         VALUES ($1, $2, $3, 'accepted', $4, $5, $6) RETURNING *`,
        [
          randomUUID(),
          input.projectId,
          input.type,
          input.idempotencyKey,
          fingerprint,
          input.expectedVersion,
        ]
      );
      const row = typedRows(inserted, value => value as OperationRow)[0];
      if (!row) throw new Error('Project operation creation returned no row');
      return { operation: asOperation(row), existing: false };
    });
  }

  async getProjectOperationReplay(input: {
    projectId: string;
    type: System3OperationType;
    idempotencyKey: string;
    request: Record<string, unknown>;
  }): Promise<System3OperationRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_project_operations
       WHERE project_id = $1 AND operation_type = $2 AND idempotency_key = $3`,
      [input.projectId, input.type, input.idempotencyKey]
    );
    const row = typedRows(result, value => value as OperationRow)[0];
    if (!row) return null;
    const fingerprint = `sha256:${createHash('sha256')
      .update(canonicalJson(input.request))
      .digest('hex')}`;
    if (row.request_fingerprint !== fingerprint) {
      throw new System3ConflictError(
        'Idempotency-Key was already used for a different operation request'
      );
    }
    return asOperation(row);
  }

  async markProjectOperationRunning(input: {
    operationId: string;
    ownerInstanceId: string;
    workflowRunId?: string;
    executionId?: string;
  }): Promise<string> {
    await this.ensureSchema();
    const ownerClaimToken = randomUUID();
    const updated = await this.database.query(
      `UPDATE remote_agent_system3_project_operations
       SET status = 'running', owner_instance_id = $2, owner_claim_token = $5,
           heartbeat_at = CURRENT_TIMESTAMP,
           started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
           workflow_run_id = COALESCE($3, workflow_run_id),
           execution_id = COALESCE($4, execution_id),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'accepted'`,
      [
        input.operationId,
        input.ownerInstanceId,
        input.workflowRunId ?? null,
        input.executionId ?? null,
        ownerClaimToken,
      ]
    );
    if (updated.rowCount !== 1) {
      throw new System3ConflictError(
        'Project operation was already claimed or is no longer active'
      );
    }
    return ownerClaimToken;
  }

  async retryFailedProjectOperation(operationId: string): Promise<System3OperationRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      const currentResult = await query(
        'SELECT * FROM remote_agent_system3_project_operations WHERE id = $1',
        [operationId]
      );
      const current = typedRows(currentResult, value => value as OperationRow)[0];
      if (!current) throw new Error('System 3 operation not found');
      if (current.status === 'accepted') return asOperation(current);
      if (current.status !== 'failed') {
        throw new System3ConflictError(
          `Operation with status '${current.status}' cannot be retried`
        );
      }
      const updatedResult = await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'accepted', error = NULL, owner_instance_id = NULL,
             owner_claim_token = NULL, heartbeat_at = NULL, finished_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'failed'`,
        [operationId]
      );
      if (updatedResult.rowCount !== 1) throw new Error('Operation retry updated no row');
      const refreshedResult = await query(
        'SELECT * FROM remote_agent_system3_project_operations WHERE id = $1',
        [operationId]
      );
      const updated = typedRows(refreshedResult, value => value as OperationRow)[0];
      if (!updated) throw new Error('Operation retry returned no row');
      return asOperation(updated);
    });
  }

  /**
   * Explicit user-requested recovery. Running work is never taken over by a
   * timer: callers may opt into takeover only after showing the ambiguous
   * state and receiving a deliberate retry action from the user.
   */
  async resumeProjectOperationExplicitly(operationId: string): Promise<System3OperationRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      const currentResult = await query(
        'SELECT * FROM remote_agent_system3_project_operations WHERE id = $1',
        [operationId]
      );
      const current = typedRows(currentResult, value => value as OperationRow)[0];
      if (!current) throw new Error('System 3 operation not found');
      await this.lockProject(query, current.project_id);
      const lockedResult = await query(
        `SELECT * FROM remote_agent_system3_project_operations WHERE id = $1${
          this.database.dialect === 'postgres' ? ' FOR UPDATE' : ''
        }`,
        [operationId]
      );
      const lockedCurrent = typedRows(lockedResult, value => value as OperationRow)[0];
      if (!lockedCurrent) throw new Error('System 3 operation not found');
      if (lockedCurrent.status === 'succeeded' || lockedCurrent.status === 'abandoned') {
        throw new System3ConflictError(
          `Operation with status '${lockedCurrent.status}' cannot be resumed`
        );
      }
      if (hasResponsiveOperationOwner(lockedCurrent)) {
        throw new System3ConflictError(
          'Operation owner is still responsive; explicit takeover is not available yet'
        );
      }
      const updatedResult = await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'accepted', error = NULL, owner_instance_id = NULL,
             owner_claim_token = NULL, heartbeat_at = NULL, finished_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status IN ('accepted', 'running', 'failed')`,
        [operationId]
      );
      if (updatedResult.rowCount !== 1) throw new Error('Operation resume updated no row');
      const refreshedResult = await query(
        'SELECT * FROM remote_agent_system3_project_operations WHERE id = $1',
        [operationId]
      );
      const updated = typedRows(refreshedResult, value => value as OperationRow)[0];
      if (!updated) throw new Error('Operation resume returned no row');
      return asOperation(updated);
    });
  }

  async heartbeatProjectOperation(
    operationId: string,
    ownerInstanceId: string,
    ownerClaimToken: string
  ): Promise<boolean> {
    await this.ensureSchema();
    const updated = await this.database.query(
      `UPDATE remote_agent_system3_project_operations
       SET heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND owner_instance_id = $2 AND owner_claim_token = $3
         AND status = 'running'`,
      [operationId, ownerInstanceId, ownerClaimToken]
    );
    return updated.rowCount === 1;
  }

  async recordProjectOperationProgress(
    operationId: string,
    ownerClaimToken: string,
    result: Record<string, unknown>
  ): Promise<void> {
    await this.ensureSchema();
    const updated = await this.database.query(
      `UPDATE remote_agent_system3_project_operations
       SET result = $2, heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'running' AND owner_claim_token = $3`,
      [operationId, JSON.stringify(result), ownerClaimToken]
    );
    if (updated.rowCount !== 1) {
      throw new System3ConflictError('Project operation claim was lost before progress commit');
    }
  }

  async completeProjectOperation(
    operationId: string,
    ownerClaimToken: string,
    result: Record<string, unknown>,
    links?: { workflowRunId?: string; executionId?: string }
  ): Promise<void> {
    await this.ensureSchema();
    const updated = await this.database.query(
      `UPDATE remote_agent_system3_project_operations
       SET status = 'succeeded', result = $2, error = NULL,
           workflow_run_id = COALESCE($3, workflow_run_id),
           execution_id = COALESCE($4, execution_id), heartbeat_at = CURRENT_TIMESTAMP,
           finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'running' AND owner_claim_token = $5`,
      [
        operationId,
        JSON.stringify(result),
        links?.workflowRunId ?? null,
        links?.executionId ?? null,
        ownerClaimToken,
      ]
    );
    if (updated.rowCount !== 1) {
      throw new System3ConflictError('Project operation claim was lost before completion');
    }
  }

  async failProjectOperation(
    operationId: string,
    ownerClaimToken: string,
    error: string
  ): Promise<boolean> {
    await this.ensureSchema();
    const updated = await this.database.query(
      `UPDATE remote_agent_system3_project_operations
       SET status = 'failed', error = $2, heartbeat_at = CURRENT_TIMESTAMP,
           finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'running' AND owner_claim_token = $3`,
      [operationId, error, ownerClaimToken]
    );
    return updated.rowCount === 1;
  }

  async getExecutionByIdempotencyKey(
    projectId: string,
    idempotencyKey: string
  ): Promise<System3ExecutionRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT execution.* FROM remote_agent_system3_project_operations operation
       JOIN remote_agent_system3_project_executions execution ON execution.id = operation.execution_id
       WHERE operation.project_id = $1 AND operation.operation_type = 'execute'
         AND operation.idempotency_key = $2`,
      [projectId, idempotencyKey]
    );
    const row = typedRows(result, value => value as ExecutionRow)[0];
    return row ? asExecution(row) : null;
  }

  async getExecutionReplay(input: {
    projectId: string;
    idempotencyKey: string;
    approvalId: string;
    expectedVersion: number;
  }): Promise<{
    execution: System3ExecutionRecord;
    operation: System3OperationRecord;
    workflowRun: System3PrecreatedWorkflowRun;
  } | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT operation.*, execution.workflow_run_id AS execution_workflow_run_id,
              execution.approval_id, execution.definition_hash,
              execution.status AS execution_status, execution.bundle_snapshot_id AS execution_bundle_snapshot_id,
              execution.bundle_hash AS execution_bundle_hash, execution.runtime_bindings AS execution_runtime_bindings,
              execution.error AS execution_error, execution.created_at AS execution_created_at,
              execution.updated_at AS execution_updated_at,
              run.workflow_name AS execution_run_workflow_name,
              run.conversation_id AS execution_run_conversation_id,
              run.codebase_id AS execution_run_codebase_id,
              run.user_message AS execution_run_user_message,
              run.metadata AS execution_run_metadata,
              run.started_at AS execution_run_started_at,
              run.last_activity_at AS execution_run_last_activity_at,
              run.working_path AS execution_run_working_path,
              run.user_id AS execution_run_user_id
       FROM remote_agent_system3_project_operations operation
       JOIN remote_agent_system3_project_executions execution ON execution.id = operation.execution_id
       JOIN remote_agent_workflow_runs run ON run.id = execution.workflow_run_id
       WHERE operation.project_id = $1 AND operation.operation_type = 'execute'
         AND operation.idempotency_key = $2`,
      [input.projectId, input.idempotencyKey]
    );
    const row = typedRows(
      result,
      value =>
        value as OperationRow & {
          execution_workflow_run_id: string;
          approval_id: string;
          definition_hash: string;
          execution_status: System3ExecutionStatus;
          execution_bundle_snapshot_id: string | null;
          execution_bundle_hash: string | null;
          execution_runtime_bindings: Record<string, unknown> | string | null;
          execution_error: string | null;
          execution_created_at: Date | string;
          execution_updated_at: Date | string;
          execution_run_workflow_name: string;
          execution_run_conversation_id: string;
          execution_run_codebase_id: string;
          execution_run_user_message: string;
          execution_run_metadata: Record<string, unknown> | string | null;
          execution_run_started_at: Date | string;
          execution_run_last_activity_at: Date | string | null;
          execution_run_working_path: string;
          execution_run_user_id: string | null;
        }
    )[0];
    if (!row) {
      if (await this.getExecutionByIdempotencyKey(input.projectId, input.idempotencyKey)) {
        throw new System3ConflictError('Execution replay is missing its persisted Workflow Run');
      }
      return null;
    }
    if (row.execution_id === null) {
      throw new System3ConflictError('Execution replay is missing its persisted execution');
    }
    const runtimeBindings = jsonObject<Record<string, unknown>>(
      row.execution_runtime_bindings ?? {}
    );
    const fingerprint = `sha256:${createHash('sha256')
      .update(
        canonicalJson({
          approvalId: row.approval_id,
          definitionHash: row.definition_hash,
          bundleSnapshotId: row.execution_bundle_snapshot_id,
          bundleHash: row.execution_bundle_hash,
          runtimeBindings,
          expectedVersion: input.expectedVersion,
        })
      )
      .digest('hex')}`;
    if (row.approval_id !== input.approvalId || row.request_fingerprint !== fingerprint) {
      throw new System3ConflictError(
        'Idempotency-Key was already used for a different execution request'
      );
    }
    return {
      operation: asOperation(row),
      execution: asExecution({
        id: row.execution_id,
        project_id: row.project_id,
        approval_id: row.approval_id,
        workflow_run_id: row.execution_workflow_run_id,
        definition_hash: row.definition_hash,
        bundle_snapshot_id: row.execution_bundle_snapshot_id,
        bundle_hash: row.execution_bundle_hash,
        runtime_bindings: runtimeBindings,
        status: row.execution_status,
        error: row.execution_error,
        created_at: row.execution_created_at,
        updated_at: row.execution_updated_at,
      }),
      workflowRun: {
        id: row.execution_workflow_run_id,
        workflow_name: row.execution_run_workflow_name,
        conversation_id: row.execution_run_conversation_id,
        parent_conversation_id: null,
        parent_workflow_run_id: null,
        parent_node_id: null,
        codebase_id: row.execution_run_codebase_id,
        status: 'pending',
        user_message: row.execution_run_user_message,
        metadata: jsonObject<Record<string, unknown>>(row.execution_run_metadata ?? {}),
        started_at: new Date(row.execution_run_started_at),
        completed_at: null,
        last_activity_at:
          row.execution_run_last_activity_at === null
            ? null
            : new Date(row.execution_run_last_activity_at),
        working_path: row.execution_run_working_path,
        user_id: row.execution_run_user_id,
      },
    };
  }

  async listOperations(projectId: string): Promise<System3OperationRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_project_operations
       WHERE project_id = $1 ORDER BY created_at DESC, id DESC`,
      [projectId]
    );
    return typedRows(result, value => asOperation(value as OperationRow));
  }

  async getExecution(executionId: string): Promise<System3ExecutionRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      'SELECT * FROM remote_agent_system3_project_executions WHERE id = $1',
      [executionId]
    );
    const row = typedRows(result, value => value as ExecutionRow)[0];
    return row ? asExecution(row) : null;
  }

  async getLatestExecution(projectId: string): Promise<System3ExecutionRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_project_executions
       WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    );
    const row = typedRows(result, value => value as ExecutionRow)[0];
    return row ? asExecution(row) : null;
  }

  async listExecutions(projectId: string): Promise<System3ExecutionRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_project_executions
       WHERE project_id = $1 ORDER BY created_at DESC, id DESC`,
      [projectId]
    );
    return typedRows(result, value => asExecution(value as ExecutionRow));
  }

  async listEvidence(executionId: string): Promise<System3EvidenceRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_evidence_records
       WHERE execution_id = $1 ORDER BY created_at ASC, id ASC`,
      [executionId]
    );
    return typedRows(result, value => asEvidence(value as EvidenceRow));
  }

  async getDelivery(executionId: string): Promise<System3DeliveryRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      'SELECT * FROM remote_agent_system3_delivery_manifests WHERE execution_id = $1',
      [executionId]
    );
    const row = typedRows(result, value => value as DeliveryRow)[0];
    return row ? asDelivery(row) : null;
  }

  async getLatestDelivery(projectId: string): Promise<System3DeliveryRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_delivery_manifests
       WHERE project_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [projectId]
    );
    const row = typedRows(result, value => value as DeliveryRow)[0];
    return row ? asDelivery(row) : null;
  }

  async listDeliveries(projectId: string): Promise<System3DeliveryRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_delivery_manifests
       WHERE project_id = $1 ORDER BY created_at DESC, id DESC`,
      [projectId]
    );
    return typedRows(result, value => asDelivery(value as DeliveryRow));
  }

  async listArtifactVersions(projectId: string): Promise<System3ArtifactVersionRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_artifact_versions
       WHERE project_id = $1 ORDER BY created_at DESC, id DESC`,
      [projectId]
    );
    return typedRows(result, value => asArtifactVersion(value as ArtifactVersionRow));
  }

  async listDependencyEdges(projectId: string): Promise<System3DependencyEdgeRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT from_kind, from_id, to_kind, to_id, reason
       FROM remote_agent_system3_dependency_edges
       WHERE project_id = $1 ORDER BY created_at ASC, id ASC`,
      [projectId]
    );
    return typedRows(result, value => {
      const row = value as {
        from_kind: string;
        from_id: string;
        to_kind: string;
        to_id: string;
        reason: string;
      };
      return {
        fromKind: row.from_kind,
        fromId: row.from_id,
        toKind: row.to_kind,
        toId: row.to_id,
        reason: row.reason,
      };
    });
  }

  async listImpactManifests(projectId: string): Promise<System3ImpactManifestRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT impact.* FROM remote_agent_system3_impact_manifests impact
       LEFT JOIN remote_agent_system3_source_versions source
         ON source.id = impact.source_version_id
       WHERE impact.project_id = $1
       ORDER BY source.created_at DESC, source.lineage_version DESC,
                impact.created_at DESC, impact.schema_version DESC, impact.id DESC`,
      [projectId]
    );
    return typedRows(result, value => asImpact(value as ImpactRow));
  }

  async listLifecycleAttempts(projectId: string): Promise<System3LifecycleAttemptRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_lifecycle_attempts
       WHERE project_id = $1 ORDER BY sequence DESC`,
      [projectId]
    );
    return typedRows(result, value => asLifecycleAttempt(value as LifecycleAttemptRow));
  }

  async getLifecycleAttempt(
    projectId: string,
    attemptId: string
  ): Promise<System3LifecycleAttemptRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_lifecycle_attempts
       WHERE project_id = $1 AND id = $2`,
      [projectId, attemptId]
    );
    const row = typedRows(result, value => value as LifecycleAttemptRow)[0];
    return row ? asLifecycleAttempt(row) : null;
  }

  async getActiveLifecycleAttempt(
    projectId: string
  ): Promise<System3LifecycleAttemptRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_lifecycle_attempts
       WHERE project_id = $1 AND lifecycle_status = 'active'
       ORDER BY sequence DESC LIMIT 1`,
      [projectId]
    );
    const row = typedRows(result, value => value as LifecycleAttemptRow)[0];
    return row ? asLifecycleAttempt(row) : null;
  }

  async getLifecycleAttemptReplay(
    input: System3LifecycleAttemptReplayInput
  ): Promise<System3LifecycleAttemptRecord | null> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_lifecycle_attempts
       WHERE project_id = $1 AND idempotency_key = $2`,
      [input.projectId, input.idempotencyKey]
    );
    const row = typedRows(result, value => value as LifecycleAttemptRow)[0];
    if (!row) return null;
    assertLifecycleAttemptReplayMatches(row, input);
    return asLifecycleAttempt(row);
  }

  async hasCurrentLifecycleAttemptPayload(projectId: string, attemptId: string): Promise<boolean> {
    await this.ensureSchema();
    const storagePrefix = `attempts/${attemptId}/%`;
    const result = await this.database.query(
      `SELECT 1 AS found
       FROM remote_agent_system3_artifact_versions
       WHERE project_id = $1 AND artifact_key LIKE $2 AND status = 'current'
       LIMIT 1`,
      [projectId, storagePrefix]
    );
    return typedRows(result, value => value as { found: number | string }).length > 0;
  }

  async beginLifecycleAttempt(input: System3LifecycleAttemptBeginInput): Promise<{
    attempt: System3LifecycleAttemptRecord;
    existing: boolean;
  }> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      await this.lockProject(query, input.projectId);
      const idempotentResult = await query(
        `SELECT * FROM remote_agent_system3_lifecycle_attempts
         WHERE project_id = $1 AND idempotency_key = $2`,
        [input.projectId, input.idempotencyKey]
      );
      const idempotent = typedRows(idempotentResult, value => value as LifecycleAttemptRow)[0];
      if (idempotent) {
        assertLifecycleAttemptReplayMatches(idempotent, input, input.basis);
        return { attempt: asLifecycleAttempt(idempotent), existing: true };
      }
      const projectResult = await query(
        'SELECT version FROM remote_agent_system3_projects WHERE id = $1',
        [input.projectId]
      );
      const project = typedRows(projectResult, value => value as { version: number | string })[0];
      if (!project) throw new System3ConflictError('Project no longer exists');
      if (Number(project.version) !== input.expectedVersion) {
        throw new System3ConflictError('Project changed; preview the Lifecycle Attempt again');
      }
      const activeResult = await query(
        `SELECT id, run_status FROM remote_agent_system3_lifecycle_attempts
         WHERE project_id = $1 AND lifecycle_status = 'active'`,
        [input.projectId]
      );
      const active = typedRows(
        activeResult,
        value => value as { id: string; run_status: System3LifecycleAttemptRunStatus }
      )[0];
      if (active && ['preparing', 'running', 'waiting', 'unknown'].includes(active.run_status)) {
        throw new System3ConflictError(
          'An active Lifecycle Attempt must be resolved before starting another'
        );
      }
      if (active) {
        await query(
          `UPDATE remote_agent_system3_lifecycle_attempts
           SET lifecycle_status = 'superseded' WHERE id = $1`,
          [active.id]
        );
      }
      const sequenceResult = await query(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
         FROM remote_agent_system3_lifecycle_attempts WHERE project_id = $1`,
        [input.projectId]
      );
      const sequence = Number(
        typedRows(sequenceResult, value => value as { next_sequence: number | string })[0]
          ?.next_sequence ?? 1
      );
      const id = randomUUID();
      const created = await query(
        `INSERT INTO remote_agent_system3_lifecycle_attempts
          (id, project_id, sequence, base_attempt_id, start_activity_id, scope, input_mode,
           basis, preview_hash, idempotency_key, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          id,
          input.projectId,
          sequence,
          input.baseAttemptId ?? null,
          input.startActivityId,
          input.scope,
          input.inputMode,
          JSON.stringify(input.basis),
          input.previewHash,
          input.idempotencyKey,
          input.createdBy ?? null,
        ]
      );
      const row = typedRows(created, value => value as LifecycleAttemptRow)[0];
      if (!row) throw new Error('Lifecycle Attempt creation returned no row');
      return { attempt: asLifecycleAttempt(row), existing: false };
    });
  }

  async createLifecycleAttempt(
    input: System3LifecycleAttemptBeginInput
  ): Promise<System3LifecycleAttemptRecord> {
    return (await this.beginLifecycleAttempt(input)).attempt;
  }

  async updateLifecycleAttempt(
    projectId: string,
    attemptId: string,
    patch: Partial<
      Pick<
        System3LifecycleAttemptRecord,
        | 'conversationId'
        | 'isolationEnvironmentId'
        | 'branchName'
        | 'workingPath'
        | 'runStatus'
        | 'cleanupStatus'
        | 'checkpointActivityId'
        | 'nextActivityId'
        | 'cleanupManifest'
      >
    >
  ): Promise<System3LifecycleAttemptRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      await this.lockProject(query, projectId);
      const currentResult = await query(
        `SELECT * FROM remote_agent_system3_lifecycle_attempts
         WHERE project_id = $1 AND id = $2`,
        [projectId, attemptId]
      );
      const currentRow = typedRows(currentResult, value => value as LifecycleAttemptRow)[0];
      if (!currentRow) throw new System3ConflictError('Lifecycle Attempt not found');
      const existing = asLifecycleAttempt(currentRow);
      const nowTerminal = patch.runStatus === 'completed' || patch.runStatus === 'failed';
      const cleaned = patch.cleanupStatus === 'completed';
      const updated = await query(
        `UPDATE remote_agent_system3_lifecycle_attempts
         SET conversation_id = COALESCE($1, conversation_id),
             isolation_environment_id = COALESCE($2, isolation_environment_id),
             branch_name = COALESCE($3, branch_name),
             working_path = COALESCE($4, working_path),
             run_status = COALESCE($5, run_status),
             cleanup_status = COALESCE($6, cleanup_status),
             checkpoint_activity_id = $7,
             next_activity_id = $8,
             cleanup_manifest = COALESCE($9, cleanup_manifest),
             started_at = CASE WHEN $5 = 'running' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
             completed_at = CASE WHEN $10 THEN CURRENT_TIMESTAMP ELSE completed_at END,
             cleaned_at = CASE WHEN $11 THEN CURRENT_TIMESTAMP ELSE cleaned_at END,
             lifecycle_status = CASE WHEN $11 THEN 'cleaned' ELSE lifecycle_status END
         WHERE id = $12 AND project_id = $13`,
        [
          patch.conversationId ?? null,
          patch.isolationEnvironmentId ?? null,
          patch.branchName ?? null,
          patch.workingPath ?? null,
          patch.runStatus ?? null,
          patch.cleanupStatus ?? null,
          Object.prototype.hasOwnProperty.call(patch, 'checkpointActivityId')
            ? (patch.checkpointActivityId ?? null)
            : existing.checkpointActivityId,
          Object.prototype.hasOwnProperty.call(patch, 'nextActivityId')
            ? (patch.nextActivityId ?? null)
            : existing.nextActivityId,
          patch.cleanupManifest === undefined ? null : JSON.stringify(patch.cleanupManifest),
          nowTerminal,
          cleaned,
          attemptId,
          projectId,
        ]
      );
      if (updated.rowCount !== 1) {
        throw new System3ConflictError('Lifecycle Attempt was changed by another process');
      }
      const refreshed = await query(
        `SELECT * FROM remote_agent_system3_lifecycle_attempts
         WHERE project_id = $1 AND id = $2`,
        [projectId, attemptId]
      );
      const row = typedRows(refreshed, value => value as LifecycleAttemptRow)[0];
      if (!row) throw new System3ConflictError('Lifecycle Attempt was changed by another process');
      return asLifecycleAttempt(row);
    });
  }

  async getTraceabilitySummary(projectId: string): Promise<System3TraceabilitySummary> {
    await this.ensureSchema();
    const tableNames = [
      'requirements',
      'knowledge_facts',
      'open_issues',
      'dependency_edges',
      'artifact_versions',
    ] as const;
    const counts = await Promise.all(
      tableNames.map(async table => {
        const statusFilter = table === 'open_issues' ? " AND status = 'open'" : '';
        const result = await this.database.query(
          `SELECT COUNT(*) AS count FROM remote_agent_system3_${table} WHERE project_id = $1${statusFilter}`,
          [projectId]
        );
        return Number(
          typedRows(result, value => value as { count: number | string })[0]?.count ?? 0
        );
      })
    );
    return {
      requirements: counts[0] ?? 0,
      knowledgeFacts: counts[1] ?? 0,
      openIssues: counts[2] ?? 0,
      dependencyEdges: counts[3] ?? 0,
      artifactVersions: counts[4] ?? 0,
    };
  }

  async buildFlow(
    projectId: string,
    phases: System3Phase[]
  ): Promise<{
    project: System3ProjectRecord;
    sources: System3SourceRecord[];
    analysis: BlueprintAnalysis | null;
    decisions: System3DecisionRecord[];
    readiness: System3ReadinessContractRecord | null;
    readinessEvaluation: System3ReadinessEvaluation | null;
    compilation: System3CompilationRecord | null;
    approval: System3ApprovalRecord | null;
    execution: System3ExecutionRecord | null;
    verification: System3VerificationRecord | null;
    delivery: System3DeliveryRecord | null;
    impacts: System3ImpactManifestRecord[];
    understandingRunId: string | null;
    phases: System3Phase[];
  } | null> {
    const project = await this.getProject(projectId);
    if (!project) return null;
    const [
      sources,
      snapshot,
      decisions,
      readiness,
      compilation,
      approval,
      execution,
      verification,
      impacts,
      operations,
    ] = await Promise.all([
      this.listSources(projectId),
      this.getActiveUnderstanding(projectId),
      this.listDecisions(projectId),
      this.getLatestReadinessContract(projectId),
      this.getLatestCompilation(projectId),
      this.getLatestApproval(projectId),
      this.getLatestExecution(projectId),
      this.getLatestVerification(projectId),
      this.listImpactManifests(projectId),
      this.listOperations(projectId),
    ]);
    const activeDecisions = snapshot
      ? decisions.filter(decision => decision.knowledgeSnapshotId === snapshot.id)
      : [];
    const activeReadiness =
      readiness?.knowledgeSnapshotId === project.activeKnowledgeSnapshotId &&
      project.freshness === 'current'
        ? readiness
        : null;
    const operationEvaluation = operations
      .filter(
        operation =>
          operation.type === 'readiness' &&
          operation.status === 'succeeded' &&
          operation.projectVersion === project.version
      )
      .map(operation => system3ReadinessEvaluationSchema.safeParse(operation.result?.evaluation))
      .find(result => result.success);
    const contractBody = activeReadiness
      ? system3ReadinessContractBodySchema.safeParse(activeReadiness.contract)
      : null;
    const readinessEvaluation = contractBody?.success
      ? system3ReadinessEvaluationSchema.parse({
          schemaVersion: 1,
          status: 'passed',
          knowledgeSnapshotId: contractBody.data.knowledgeSnapshotId,
          projectVersion: contractBody.data.projectVersion,
          checks: contractBody.data.checks,
          blockerReasons: [],
          nextAction: 'continue_compile',
        })
      : operationEvaluation?.success
        ? operationEvaluation.data
        : null;
    const activeCompilation =
      project.freshness === 'current' &&
      compilation?.knowledgeSnapshotId === project.activeKnowledgeSnapshotId
        ? compilation
        : null;
    const activeApproval =
      activeCompilation !== null && approval?.compilationId === activeCompilation.id
        ? approval
        : null;
    const activeExecution =
      project.freshness === 'current' &&
      activeApproval &&
      execution?.approvalId === activeApproval.id
        ? execution
        : null;
    const activeVerification =
      activeExecution !== null &&
      verification?.executionId === activeExecution.id &&
      project.freshness === 'current'
        ? verification
        : null;
    return {
      project,
      sources,
      analysis: snapshot?.analysis ?? null,
      decisions: activeDecisions,
      readiness: activeReadiness,
      readinessEvaluation,
      compilation: activeCompilation,
      approval: activeApproval,
      execution: activeExecution,
      verification: activeVerification,
      delivery: activeExecution ? await this.getDelivery(activeExecution.id) : null,
      impacts,
      understandingRunId: snapshot?.workflowRunId ?? null,
      phases,
    };
  }
}
