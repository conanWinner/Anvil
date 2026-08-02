import { createHash, randomUUID } from 'node:crypto';
import type {
  BlueprintAnalysis,
  System3ApprovalManifest,
  System3Attention,
  System3ExecutionPlan,
  System3Freshness,
  System3Phase,
  System3ProjectStage,
  System3SourceKind,
  System3SourceRole,
  System3SourceStorageStatus,
  System3ImpactManifest,
} from './contracts';
import { system3ImpactManifestSchema } from './contracts';
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

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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
    expectedVersion: number;
  }): Promise<System3SourceIntakeStoreResult> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      await this.lockProject(query, input.projectId);
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
  }): Promise<System3SourceRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      await this.lockProject(query, input.projectId);
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
  }): Promise<System3SourceIntakeReportRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
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
    previousSourceVersionId?: string | null;
    manifest?: System3ImpactManifest;
  }): Promise<System3ImpactManifestRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
      await this.lockProject(query, input.projectId);
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
      if (existing) return asImpact(existing);
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
      if (row) return asImpact(row);
      const racedResult = await query(
        `SELECT * FROM remote_agent_system3_impact_manifests
         WHERE project_id = $1 AND source_version_id = $2 AND basis_hash = $3 AND detector_version = $4`,
        [input.projectId, input.sourceVersionId, basisHash, detectorVersion]
      );
      const raced = typedRows(racedResult, value => value as ImpactRow)[0];
      if (!raced) throw new Error('Impact manifest creation returned no row');
      return asImpact(raced);
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
    const inserted = await this.database.query(
      `INSERT INTO remote_agent_system3_understanding_input_snapshots
        (id, project_id, operation_id, source_ids, source_hashes, parser_version,
         extraction_policy_version, capability_registry_hash, runtime_profile)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
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

  async saveUnderstanding(input: {
    projectId: string;
    analysis: BlueprintAnalysis;
    artifactKey: string;
    workflowRunId: string;
    expectedVersion: number;
    inputSnapshotId: string;
    sourceVersionIds: string[];
  }): Promise<System3KnowledgeSnapshotRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
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
        throw new System3ConflictError('Project changed; refresh before analyzing');
      }
      const id = randomUUID();
      const inserted = await query(
        `INSERT INTO remote_agent_system3_knowledge_snapshots
          (id, project_id, analysis, artifact_key, workflow_run_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          id,
          input.projectId,
          JSON.stringify(input.analysis),
          input.artifactKey,
          input.workflowRunId,
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
        `UPDATE remote_agent_system3_artifact_versions
         SET status = 'superseded', stale_reason = NULL
         WHERE project_id = $1 AND artifact_kind = 'knowledge_snapshot' AND status = 'current'`,
        [input.projectId]
      );
      await query(
        `INSERT INTO remote_agent_system3_artifact_versions
          (id, project_id, knowledge_snapshot_id, artifact_key, artifact_kind, version,
           content_hash, size_bytes, activity_id, workflow_run_id, display_name, summary,
           media_type, schema_id, schema_version, visibility, status,
           source_version_ids, parent_resource_ids)
         VALUES ($1, $2, $3, $4, 'knowledge_snapshot', 1, $5, $6, 'TW-02', $7,
                 'Bản hiểu dự án', 'Mục tiêu, yêu cầu, dữ liệu và vấn đề Anvil đã hiểu.',
                 'application/json', 'system3.knowledge-snapshot', '1', 'user', 'current',
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
        ]
      );
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
      await query(
        'DELETE FROM remote_agent_system3_decisions WHERE project_id = $1 AND status = $2',
        [input.projectId, 'pending']
      );
      for (const review of input.analysis.manualReviews) {
        await query(
          `INSERT INTO remote_agent_system3_decisions
            (id, project_id, knowledge_snapshot_id, title, question, why, recommendation, options, affected_phases, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')`,
          [
            randomUUID(),
            input.projectId,
            id,
            'Cần xác nhận phạm vi',
            review.text,
            'Blueprint đánh dấu đây là manual review; hệ thống không tự suy đoán.',
            'Xác nhận theo đề xuất trong blueprint hoặc ghi rõ phạm vi thay thế.',
            JSON.stringify(['Dùng đề xuất', 'Tự nhập quyết định']),
            JSON.stringify(['readiness']),
          ]
        );
      }
      const attention: System3Attention =
        input.analysis.manualReviews.length > 0 ? 'decision_required' : 'none';
      const stage: System3ProjectStage =
        input.analysis.manualReviews.length > 0 ? 'understanding' : 'workflow_design';
      await query(
        `UPDATE remote_agent_system3_projects
         SET active_knowledge_snapshot_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [id, input.projectId]
      );
      await this.transitionProject(query, {
        projectId: input.projectId,
        fromStage: projectRow.stage,
        toStage: stage,
        attention,
        freshness: 'current',
        workflowRunId: input.workflowRunId,
        entityType: 'knowledge_snapshot',
        entityId: id,
        reason: 'Understanding snapshot created',
      });
      const row = typedRows(inserted, value => value as SnapshotRow)[0];
      if (!row) throw new Error('Knowledge snapshot creation returned no row');
      return asSnapshot(row);
    });
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
  }): Promise<System3ReadinessContractRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
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
      const pending = await query(
        "SELECT COUNT(*) AS count FROM remote_agent_system3_decisions WHERE project_id = $1 AND status = 'pending'",
        [input.projectId]
      );
      const pendingCount = Number(
        typedRows(pending, value => value as { count: number | string })[0]?.count ?? 0
      );
      if (pendingCount > 0)
        throw new System3ConflictError('Resolve all decisions before readiness');
      const serialized = JSON.stringify(input.contract);
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
      return asReadinessContract(row);
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

  async listDecisions(projectId: string): Promise<System3DecisionRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      'SELECT * FROM remote_agent_system3_decisions WHERE project_id = $1 ORDER BY created_at ASC',
      [projectId]
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
      const project = await query('SELECT * FROM remote_agent_system3_projects WHERE id = $1', [
        input.projectId,
      ]);
      const row = typedRows(project, value => value as ProjectRow)[0];
      if (!row) throw new Error('System 3 project not found');
      if (Number(row.version) !== input.expectedVersion)
        throw new System3ConflictError('Project changed; refresh before responding');
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
        "SELECT COUNT(*) AS count FROM remote_agent_system3_decisions WHERE project_id = $1 AND status = 'pending'",
        [input.projectId]
      );
      const pendingRow = typedRows(pending, value => value as { count: number | string })[0];
      const hasPending = Number(pendingRow?.count ?? 0) > 0;
      await this.transitionProject(query, {
        projectId: input.projectId,
        fromStage: row.stage,
        toStage: hasPending ? 'understanding' : 'workflow_design',
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
    impactManifestId?: string;
    impactManifestIds?: readonly string[];
    expectedVersion: number;
  }): Promise<System3CompilationRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
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
      return asCompilation(row);
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

  async listCompilations(projectId: string): Promise<System3CompilationRecord[]> {
    await this.ensureSchema();
    const result = await this.database.query(
      `SELECT * FROM remote_agent_system3_compilations
       WHERE project_id = $1 ORDER BY created_at DESC, id DESC`,
      [projectId]
    );
    return typedRows(result, value => asCompilation(value as CompilationRow));
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
    projectId: string;
    approvalId: string;
    definitionHash: string;
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
            expectedVersion: input.expectedVersion,
          })
        )
        .digest('hex')}`;
      const existingResult = await query(
        `SELECT operation.*, execution.workflow_run_id AS execution_workflow_run_id,
                execution.approval_id,
                execution.definition_hash, execution.status AS execution_status,
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
      const executionId = randomUUID();
      const operationId = randomUUID();
      const workflowRunId = randomUUID();
      const metadata = {
        system3ProjectId: input.projectId,
        system3ExecutionId: executionId,
        definitionHash: input.definitionHash,
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
          (id, project_id, approval_id, workflow_run_id, definition_hash, status)
         VALUES ($1, $2, $3, $4, $5, 'accepted') RETURNING *`,
        [executionId, input.projectId, input.approvalId, workflowRunId, input.definitionHash]
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
      const operationResult = await query(
        `SELECT * FROM remote_agent_system3_project_operations
         WHERE execution_id = $1 AND operation_type = 'execute'`,
        [input.executionId]
      );
      const operation = typedRows(operationResult, value => value as OperationRow)[0];
      await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'succeeded', result = $1, error = NULL, heartbeat_at = CURRENT_TIMESTAMP,
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE execution_id = $2 AND operation_type = 'execute'`,
        [JSON.stringify({ executionId: input.executionId, artifactId }), input.executionId]
      );
      await this.transitionProject(query, {
        projectId: input.projectId,
        toStage: 'verifying',
        attention: 'none',
        operationId: operation?.id ?? null,
        workflowRunId: operation?.workflow_run_id ?? null,
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
    projectId: string;
    executionId: string;
    inputArtifactId: string;
    basisHash: string;
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
      const verificationId = randomUUID();
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
           validator_version, basis_hash)
         VALUES ($1, $2, $3, $4, $5, 'accepted', 'system3-validator@1', $6) RETURNING *`,
        [
          verificationId,
          input.projectId,
          input.executionId,
          workflowRunId,
          input.inputArtifactId,
          input.basisHash,
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
      const operationResult = await query(
        `SELECT * FROM remote_agent_system3_project_operations
         WHERE workflow_run_id = $1 AND operation_type = 'verify'`,
        [verification.workflow_run_id]
      );
      const operation = typedRows(operationResult, value => value as OperationRow)[0];
      await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'succeeded', result = $1, error = NULL, heartbeat_at = CURRENT_TIMESTAMP,
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE workflow_run_id = $2 AND operation_type = 'verify'`,
        [JSON.stringify({ verificationId: input.verificationId }), verification.workflow_run_id]
      );
      await this.transitionProject(query, {
        projectId: input.projectId,
        toStage: 'delivery',
        attention: 'none',
        operationId: operation?.id ?? null,
        workflowRunId: verification.workflow_run_id,
        entityType: 'verification',
        entityId: input.verificationId,
        reason: 'Verification passed; delivery review required',
      });
    });
  }

  async failVerification(verificationId: string, projectId: string, error: string): Promise<void> {
    await this.ensureSchema();
    await this.database.withTransaction(async query => {
      const verificationResult = await query(
        'SELECT * FROM remote_agent_system3_verifications WHERE id = $1',
        [verificationId]
      );
      const verification = typedRows(verificationResult, value => value as VerificationRow)[0];
      if (!verification) return;
      await query(
        `UPDATE remote_agent_system3_verifications
         SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [error, verificationId]
      );
      const operationResult = await query(
        `SELECT * FROM remote_agent_system3_project_operations
         WHERE workflow_run_id = $1 AND operation_type = 'verify'`,
        [verification.workflow_run_id]
      );
      const operation = typedRows(operationResult, value => value as OperationRow)[0];
      await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'failed', error = $1, finished_at = CURRENT_TIMESTAMP,
             heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE workflow_run_id = $2 AND operation_type = 'verify'`,
        [error, verification.workflow_run_id]
      );
      await this.transitionProject(query, {
        projectId,
        toStage: 'verifying',
        attention: 'failed',
        operationId: operation?.id ?? null,
        workflowRunId: verification.workflow_run_id,
        entityType: 'verification',
        entityId: verificationId,
        reason: 'Verification failed',
        metadata: { error },
      });
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
    projectId: string;
    executionId: string;
    verificationId: string;
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
          JSON.stringify({ ...workflowRun.metadata, system3VerificationId: input.verificationId }),
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
    operationId: string;
    projectId: string;
    executionId: string;
    verificationId: string;
    delivery: Omit<
      System3DeliveryRecord,
      'id' | 'projectId' | 'executionId' | 'verificationId' | 'createdAt'
    >;
  }): Promise<System3DeliveryRecord> {
    await this.ensureSchema();
    return this.database.withTransaction(async query => {
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
      const operationResult = await query(
        `SELECT * FROM remote_agent_system3_project_operations
         WHERE id = $1 AND project_id = $2 AND operation_type = 'delivery'`,
        [input.operationId, input.projectId]
      );
      const operation = typedRows(operationResult, value => value as OperationRow)[0];
      if (!operation) throw new Error('Delivery operation not found');
      const inserted = await query(
        `INSERT INTO remote_agent_system3_delivery_manifests
          (id, project_id, execution_id, verification_id, package_storage_key, package_filename,
           content_hash, size_bytes, manifest)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          randomUUID(),
          input.projectId,
          input.executionId,
          input.verificationId,
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
      await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'succeeded', result = $1, error = NULL, heartbeat_at = CURRENT_TIMESTAMP,
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [
          JSON.stringify({ deliveryId: typedRows(inserted, value => value as DeliveryRow)[0]?.id }),
          input.operationId,
        ]
      );
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

  async failDelivery(operationId: string, projectId: string, error: string): Promise<void> {
    await this.ensureSchema();
    await this.database.withTransaction(async query => {
      const existing = await query(
        "SELECT * FROM remote_agent_system3_project_operations WHERE id = $1 AND operation_type = 'delivery'",
        [operationId]
      );
      const operation = typedRows(existing, value => value as OperationRow)[0];
      if (!operation) return;
      await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'failed', error = $1, heartbeat_at = CURRENT_TIMESTAMP,
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND operation_type = 'delivery'`,
        [error, operationId]
      );
      await this.transitionProject(query, {
        projectId,
        toStage: 'delivery',
        attention: 'failed',
        operationId,
        workflowRunId: operation.workflow_run_id,
        entityType: 'delivery',
        entityId: operationId,
        reason: 'Delivery failed',
        metadata: { error },
      });
    });
  }

  async completeExecution(input: {
    executionId: string;
    projectId: string;
    delivery: Omit<System3DeliveryRecord, 'id' | 'projectId' | 'executionId' | 'createdAt'>;
    evidence: Omit<System3EvidenceRecord, 'id' | 'projectId' | 'executionId' | 'createdAt'>[];
  }): Promise<void> {
    await this.ensureSchema();
    await this.database.withTransaction(async query => {
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
      await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'succeeded', error = NULL, heartbeat_at = CURRENT_TIMESTAMP,
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE execution_id = $1`,
        [input.executionId]
      );
      const operation = await query(
        'SELECT id, workflow_run_id FROM remote_agent_system3_project_operations WHERE execution_id = $1',
        [input.executionId]
      );
      const operationRow = typedRows(
        operation,
        value => value as { id: string; workflow_run_id: string | null }
      )[0];
      await this.transitionProject(query, {
        projectId: input.projectId,
        toStage: 'delivered',
        attention: 'none',
        operationId: operationRow?.id ?? null,
        workflowRunId: operationRow?.workflow_run_id ?? null,
        entityType: 'execution',
        entityId: input.executionId,
        reason: 'Execution, verification, and delivery completed',
      });
    });
  }

  async failExecution(executionId: string, projectId: string, error: string): Promise<void> {
    await this.ensureSchema();
    await this.database.withTransaction(async query => {
      await query(
        `UPDATE remote_agent_system3_project_executions
         SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [error, executionId]
      );
      await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'failed', error = $1, heartbeat_at = CURRENT_TIMESTAMP,
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE execution_id = $2`,
        [error, executionId]
      );
      const operation = await query(
        'SELECT id, workflow_run_id FROM remote_agent_system3_project_operations WHERE execution_id = $1',
        [executionId]
      );
      const operationRow = typedRows(
        operation,
        value => value as { id: string; workflow_run_id: string | null }
      )[0];
      await this.transitionProject(query, {
        projectId,
        toStage: 'approved',
        attention: 'failed',
        operationId: operationRow?.id ?? null,
        workflowRunId: operationRow?.workflow_run_id ?? null,
        entityType: 'execution',
        entityId: executionId,
        reason: 'Execution failed',
        metadata: { error },
      });
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
      if (row.status === 'abandoned') return asOperation(row);
      if (row.status !== 'accepted' && row.status !== 'running') {
        throw new System3ConflictError(`Operation with status '${row.status}' cannot be abandoned`);
      }

      const reason = 'User abandoned the operation after its owning process became unknown';
      if (row.workflow_run_id !== null) {
        await query(
          `UPDATE remote_agent_workflow_runs
           SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND status NOT IN ('completed', 'cancelled')`,
          [row.workflow_run_id]
        );
      }
      if (row.execution_id !== null) {
        await query(
          `UPDATE remote_agent_system3_project_executions
           SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND status IN ('accepted', 'running')`,
          [reason, row.execution_id]
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
        projectId: row.project_id,
        toStage:
          typedRows(
            await query('SELECT stage FROM remote_agent_system3_projects WHERE id = $1', [
              row.project_id,
            ]),
            value => value as { stage: System3ProjectStage }
          )[0]?.stage ?? 'draft',
        attention: 'failed',
        operationId: row.id,
        workflowRunId: row.workflow_run_id,
        entityType: row.execution_id === null ? 'operation' : 'execution',
        entityId: row.execution_id ?? row.id,
        reason: 'User abandoned unknown operation',
      });
      return asOperation({
        ...row,
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

  async markProjectOperationRunning(input: {
    operationId: string;
    ownerInstanceId: string;
    workflowRunId?: string;
    executionId?: string;
  }): Promise<void> {
    await this.ensureSchema();
    await this.database.query(
      `UPDATE remote_agent_system3_project_operations
       SET status = 'running', owner_instance_id = $2, heartbeat_at = CURRENT_TIMESTAMP,
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
      ]
    );
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
             heartbeat_at = NULL, finished_at = NULL, updated_at = CURRENT_TIMESTAMP
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
      if (current.status === 'succeeded' || current.status === 'abandoned') {
        throw new System3ConflictError(
          `Operation with status '${current.status}' cannot be resumed`
        );
      }
      const updatedResult = await query(
        `UPDATE remote_agent_system3_project_operations
         SET status = 'accepted', error = NULL, owner_instance_id = NULL,
             heartbeat_at = NULL, finished_at = NULL, updated_at = CURRENT_TIMESTAMP
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

  async heartbeatProjectOperation(operationId: string, ownerInstanceId: string): Promise<void> {
    await this.ensureSchema();
    await this.database.query(
      `UPDATE remote_agent_system3_project_operations
       SET heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND owner_instance_id = $2 AND status = 'running'`,
      [operationId, ownerInstanceId]
    );
  }

  async recordProjectOperationProgress(
    operationId: string,
    result: Record<string, unknown>
  ): Promise<void> {
    await this.ensureSchema();
    await this.database.query(
      `UPDATE remote_agent_system3_project_operations
       SET result = $2, heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status IN ('accepted', 'running')`,
      [operationId, JSON.stringify(result)]
    );
  }

  async completeProjectOperation(
    operationId: string,
    result: Record<string, unknown>,
    links?: { workflowRunId?: string; executionId?: string }
  ): Promise<void> {
    await this.ensureSchema();
    await this.database.query(
      `UPDATE remote_agent_system3_project_operations
       SET status = 'succeeded', result = $2, error = NULL,
           workflow_run_id = COALESCE($3, workflow_run_id),
           execution_id = COALESCE($4, execution_id), heartbeat_at = CURRENT_TIMESTAMP,
           finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status IN ('accepted', 'running')`,
      [
        operationId,
        JSON.stringify(result),
        links?.workflowRunId ?? null,
        links?.executionId ?? null,
      ]
    );
  }

  async failProjectOperation(operationId: string, error: string): Promise<void> {
    await this.ensureSchema();
    await this.database.query(
      `UPDATE remote_agent_system3_project_operations
       SET status = 'failed', error = $2, heartbeat_at = CURRENT_TIMESTAMP,
           finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status IN ('accepted', 'running')`,
      [operationId, error]
    );
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
    ]);
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
      decisions,
      readiness:
        readiness?.knowledgeSnapshotId === project.activeKnowledgeSnapshotId &&
        project.freshness === 'current'
          ? readiness
          : null,
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
