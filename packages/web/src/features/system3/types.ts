import type { paths } from '../../lib/api.generated';

export type PhaseStatus =
  | 'completed'
  | 'active'
  | 'blocked'
  | 'ready'
  | 'waiting'
  | 'not_started'
  | 'stale'
  | 'not_verified'
  | 'out_of_mvp_scope';

export type DecisionStatus = 'pending' | 'answered';

export type WorkflowStepStatus = 'completed' | 'running' | 'pending' | 'blocked';

export type System3SourceKind =
  | 'blueprint'
  | 'dataset'
  | 'constraints'
  | 'data_dictionary'
  | 'user_brief'
  | 'supporting_document';

export type System3SourceRole = 'primary' | 'supplemental';

export interface System3SourceValidationReport {
  schemaVersion: 1;
  outcome: 'accepted' | 'unchanged' | 'rejected';
  checks: readonly {
    id: string;
    label: string;
    status: 'passed' | 'warning' | 'failed';
    message: string;
  }[];
  warnings: readonly string[];
}

export interface System3WorkflowStep {
  id: string;
  title: string;
  description: string;
  kind: 'input' | 'agent' | 'check' | 'artifact' | 'approval';
  status: WorkflowStepStatus;
  duration: string;
  input: string;
  output: string;
}

export interface System3Phase {
  id: string;
  title: string;
  summary: string;
  technicalWorkflow: string;
  status: PhaseStatus;
  progress: number;
  objective: string;
  inputs: readonly string[];
  outputs: readonly string[];
  workflowSteps: readonly System3WorkflowStep[];
}

export interface System3Decision {
  id: string;
  title: string;
  question: string;
  why: string;
  recommendation: string;
  options: readonly string[];
  affectedPhases: readonly string[];
  status: DecisionStatus;
  answer: string | null;
}

export interface System3Source {
  id: string;
  sourceId: string;
  name: string;
  originalFilename: string;
  kind: System3SourceKind;
  role: System3SourceRole;
  mediaType: string;
  version: number;
  hash: string;
  sizeBytes: number;
  storageStatus: 'pending' | 'ready' | 'failed';
  validationReport: System3SourceValidationReport;
  origin: string;
  intakeReportArtifactId: string | null;
  createdAt: string;
  status: 'ready' | 'superseded';
  detail: string;
}

export interface System3LogicalSourceSummary {
  id: string;
  projectId: string;
  kind: System3SourceKind;
  role: System3SourceRole;
  displayName: string;
  status: 'active';
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
  storageStatus: 'not_stored' | 'pending' | 'ready' | 'failed';
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

export interface System3SourceIntakeReportView {
  id: string;
  projectId: string;
  operationId: string;
  sourceVersionId: string | null;
  report: System3SourceIntakeReport;
  createdAt: string;
}

export interface System3SourceIntakeResult {
  operationId: string;
  outcome: 'created_source' | 'created_version' | 'unchanged';
  source: System3LogicalSourceSummary;
  version: System3Source;
  previousVersionId: string | null;
  projectVersion: number;
  changeDetectionOperationId: string | null;
  intakeReport: System3SourceIntakeReportView;
}

export interface System3IntakeGate {
  ready: boolean;
  blueprintReady: boolean;
  activeSourceCount: number;
  changeDetection: readonly {
    sourceVersionId: string;
    filename: string;
    operationId: string | null;
    status: 'not_started' | 'running' | 'succeeded' | 'failed' | 'unknown';
    error: string | null;
    retryable: boolean;
  }[];
  recoveries: readonly {
    operationId: string;
    status: 'accepted' | 'running' | 'failed' | 'unknown';
    stage: 'accepted' | 'staged' | 'pending' | 'ready' | 'unknown';
    filename: string | null;
    sourceVersionId: string | null;
    error: string | null;
    retryable: boolean;
    requiresTakeoverConfirmation: boolean;
  }[];
  blockingReasons: readonly string[];
}

export interface System3Execution {
  id: string;
  workflowRunId: string;
  status: 'accepted' | 'running' | 'completed' | 'failed';
  error: string | null;
}

export interface System3Evidence {
  id: string;
  requirementId: string | null;
  status: 'passed' | 'failed' | 'not_verified' | 'out_of_mvp_scope';
  evidence: readonly string[];
  reason: string | null;
}

export interface System3Verification {
  id: string;
  workflowRunId: string;
  status: 'accepted' | 'running' | 'completed' | 'failed';
  error: string | null;
}

export interface System3Delivery {
  packageFilename: string;
  contentHash: string;
  sizeBytes: number;
  manifest: Readonly<Record<string, unknown>>;
}

export interface System3Project {
  id: string;
  codebaseId: string;
  name: string;
  description: string;
  stage: string;
  attention: string;
  freshness: 'current' | 'partially_stale' | 'stale';
  workflowVersion: string;
  version: number;
  phases: readonly System3Phase[];
  decisions: readonly System3Decision[];
  sources: readonly System3Source[];
  intakeReports: readonly System3SourceIntakeReportView[];
  intakeGate: System3IntakeGate;
  manifestApproved: boolean;
  planCompiled: boolean;
  compilationId?: string;
  approvalId?: string;
  understandingRunId?: string;
  readiness?: {
    id: string;
    workflowRunId: string;
    contractHash: string;
  };
  execution?: System3Execution;
  verification?: System3Verification;
  operation?: {
    id: string;
    status: 'accepted' | 'running' | 'succeeded' | 'failed' | 'abandoned' | 'unknown';
    error: string | null;
  };
  evidence: readonly System3Evidence[];
  delivery?: System3Delivery;
  impacts: readonly {
    id: string;
    sourceVersionId: string;
    affectedPhases: readonly string[];
    reason: string;
    operationId: string | null;
    previousSourceVersionId: string | null;
    schemaVersion: 1 | 2 | 3;
    detectorVersion: string;
    basisHash: string;
    manifestHash: string;
    manifest: {
      analysisMode: 'deterministic' | 'llm_assisted' | 'conservative_fallback' | 'legacy_broad';
      confidence: 'high' | 'medium' | 'low';
      summary: string;
      changes: readonly {
        kind: string;
        changeType: 'added' | 'modified' | 'removed' | 'unchanged';
        entityType: string;
        entityKey: string | null;
        summary: string;
        confidence: 'high' | 'medium' | 'low';
        previousValue?: string | null;
        currentValue?: string | null;
      }[];
      affectedActivities: readonly string[];
      affectedResources: readonly {
        resourceId: string | null;
        activityId: string;
        reason: string;
      }[];
      reusableResources: readonly {
        resourceId: string | null;
        activityId: string;
        reason: string;
      }[];
      proposedRerun: {
        mode: 'none' | 'scoped' | 'full';
        activityIds: readonly string[];
        executableScope: 'none' | 'full' | 'experiment' | 'delivery';
        reason: string;
      };
      uncertainties: readonly string[];
      llmAssistance: {
        used: boolean;
        provider: string | null;
        model: string | null;
        candidateCount: number;
      };
    } | null;
    createdAt: string;
  }[];
  compilation?: {
    definitionHash: string;
    capabilityRegistryHash: string;
    inputSourceCount: number;
    runtime: string;
    rerunMode: 'full' | 'scoped';
    executionMode: 'full' | 'experiment' | 'delivery';
    affectedPhases: readonly string[];
    skippedPhases: readonly string[];
    reusedArtifactCount: number;
  };
  deliveryReady: boolean;
  deliveryAvailable: boolean;
}

type System3ActivityResponse =
  paths['/api/system3/projects/{id}/activities/{activityId}']['get']['responses'][200]['content']['application/json'];
type System3ResourceResponse =
  paths['/api/system3/projects/{id}/resources/{resourceType}/{resourceId}']['get']['responses'][200]['content']['application/json'];

export type System3LifecycleActivityId = System3ActivityResponse['activityId'];
export type System3ActivityResourceView = System3ActivityResponse;
export type System3ResourceDescriptor = System3ActivityResponse['inputs'][number];
export type System3ResourceType = System3ResourceDescriptor['resourceType'];
export type System3ResourcePresentation = System3ResourceResponse;
export type System3PresentationBlock = System3ResourceResponse['blocks'][number];
