import { useSyncExternalStore } from 'react';
import {
  createSystem3Project as createSystem3ProjectRequest,
  getSystem3ProjectFlow,
  type System3OperationResponse,
  type System3ProjectHistory,
  type System3ProjectFlowResponse,
} from '@/lib/api';
import type {
  System3IntakeGate,
  System3Decision,
  System3Project,
  System3Source,
  System3SourceIntakeResult,
  System3SourceIntakeReportView,
  System3SourceKind,
  System3SourceRole,
  System3UnderstandingView,
  System3KnowledgeSnapshot,
  System3ExperimentResults,
} from './types';

const emptyProject: System3Project = {
  id: '',
  codebaseId: '',
  name: '',
  description: '',
  stage: 'draft',
  attention: 'none',
  freshness: 'current',
  workflowVersion: 'customer-churn-reference@1',
  version: 0,
  phases: [],
  decisions: [],
  sources: [],
  intakeReports: [],
  intakeGate: {
    ready: false,
    blueprintReady: false,
    activeSourceCount: 0,
    changeDetection: [],
    recoveries: [],
    blockingReasons: [],
  },
  evidence: [],
  impacts: [],
  manifestApproved: false,
  planCompiled: false,
  deliveryReady: false,
  deliveryAvailable: false,
};

let current = emptyProject;
const listeners = new Set<() => void>();
interface ExecutionRequestRecord {
  idempotencyKey: string;
  expectedVersion: number;
}

export function getExecutionRequest(
  projectId: string,
  compilationId: string,
  expectedVersion: number
): ExecutionRequestRecord {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('Project version không hợp lệ. Tải lại project.');
  }
  // Keep the same request after success too: a repeated click replays its result.
  const storageKey = `system3:execute:${projectId}:${compilationId}`;
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing !== null) {
      const request: unknown = JSON.parse(existing);
      if (
        request === null ||
        typeof request !== 'object' ||
        !('idempotencyKey' in request) ||
        typeof request.idempotencyKey !== 'string' ||
        request.idempotencyKey.trim().length === 0 ||
        !('expectedVersion' in request) ||
        typeof request.expectedVersion !== 'number' ||
        !Number.isSafeInteger(request.expectedVersion) ||
        request.expectedVersion < 1
      )
        throw new Error('Invalid saved execution request');
      return { idempotencyKey: request.idempotencyKey, expectedVersion: request.expectedVersion };
    }
    const request = { idempotencyKey: crypto.randomUUID(), expectedVersion };
    sessionStorage.setItem(storageKey, JSON.stringify(request));
    return request;
  } catch {
    throw new Error(
      'Không thể đọc hoặc lưu request chống chạy trùng. Kiểm tra lưu trữ phiên và trạng thái project trước khi thử lại.'
    );
  }
}

function publish(next: System3Project): void {
  current = next;
  for (const listener of listeners) listener();
}

function compilationSummary(
  compilation: System3ProjectFlowResponse['compilation']
): System3Project['compilation'] {
  if (compilation === null) return undefined;
  const snapshot = compilation.plan.inputSnapshot;
  const phases = compilation.plan.phases;
  const sourceIds =
    snapshot !== null && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>).sourceIds
      : undefined;
  const runtimeProfile = compilation.plan.runtimeProfile;
  const firstPhase = Array.isArray(phases) ? phases[0] : undefined;
  const resourceProfile =
    runtimeProfile !== null && typeof runtimeProfile === 'object' && !Array.isArray(runtimeProfile)
      ? runtimeProfile
      : firstPhase !== null && typeof firstPhase === 'object' && !Array.isArray(firstPhase)
        ? (firstPhase as Record<string, unknown>).resourceProfile
        : undefined;
  const profile =
    resourceProfile !== null &&
    typeof resourceProfile === 'object' &&
    !Array.isArray(resourceProfile)
      ? (resourceProfile as Record<string, unknown>)
      : {};
  const rerunScope = compilation.plan.rerunScope;
  const rerunScopeRecord =
    rerunScope !== null && typeof rerunScope === 'object' && !Array.isArray(rerunScope)
      ? (rerunScope as Record<string, unknown>)
      : {};
  const rerunMode = rerunScopeRecord.mode === 'scoped' ? 'scoped' : 'full';
  const affectedPhases = Array.isArray(rerunScopeRecord.affectedPhases)
    ? rerunScopeRecord.affectedPhases.filter((value): value is string => typeof value === 'string')
    : [];
  const skippedPhases = Array.isArray(rerunScopeRecord.skippedPhases)
    ? rerunScopeRecord.skippedPhases.filter((value): value is string => typeof value === 'string')
    : [];
  const reusedArtifacts = Array.isArray(rerunScopeRecord.reusedArtifacts)
    ? rerunScopeRecord.reusedArtifacts
    : [];
  const executionMode =
    rerunScopeRecord.executionMode === 'experiment' || rerunScopeRecord.executionMode === 'delivery'
      ? rerunScopeRecord.executionMode
      : 'full';
  const ram = typeof profile.ramGb === 'number' ? ` · RAM ${profile.ramGb.toString()} GB` : '';
  return {
    definitionHash: compilation.definitionHash,
    capabilityRegistryHash: compilation.capabilityRegistryHash,
    inputSourceCount: Array.isArray(sourceIds) ? sourceIds.length : 0,
    runtime: `${profile.cpuOnly === true ? 'CPU only' : 'Runtime mặc định'}${ram}`,
    rerunMode,
    executionMode,
    affectedPhases,
    skippedPhases,
    reusedArtifactCount: reusedArtifacts.length,
    ...(compilation.plan.modelComparison === undefined
      ? {}
      : { modelComparison: compilation.plan.modelComparison }),
    ...(compilation.plan.experiment === undefined
      ? {}
      : { experiment: compilation.plan.experiment }),
  };
}

function experimentResults(
  map: NonNullable<NonNullable<System3ProjectFlowResponse['verification']>['evidenceMap']> | null
): System3ExperimentResults | undefined {
  if (
    map?.kind !== 'experiment' ||
    !map.primaryMetric ||
    !map.variants ||
    !map.suggestion ||
    !map.review ||
    !map.split ||
    !map.agents
  )
    return undefined;
  return {
    primaryMetric: map.primaryMetric,
    variants: map.variants,
    suggestion: map.suggestion,
    review: map.review,
    split: map.split,
    agents: map.agents,
    mismatches: map.mismatches ?? [],
  };
}

function toSource(
  source: System3ProjectFlowResponse['sources'][number],
  latestVersionBySource: ReadonlyMap<string, number>
): System3Source {
  const active = source.version === latestVersionBySource.get(source.sourceId);
  return {
    id: source.id,
    sourceId: source.sourceId,
    name: source.filename,
    originalFilename: source.originalFilename,
    kind: source.kind,
    role: source.role,
    mediaType: source.mediaType,
    version: source.version,
    hash: source.contentHash,
    sizeBytes: source.sizeBytes,
    storageStatus: source.storageStatus,
    validationReport: source.validationReport,
    origin: source.origin,
    intakeReportArtifactId:
      'intakeReportArtifactId' in source && typeof source.intakeReportArtifactId === 'string'
        ? source.intakeReportArtifactId
        : null,
    createdAt: source.createdAt,
    status: active ? 'ready' : 'superseded',
    detail: `${source.sizeBytes.toLocaleString('vi-VN')} bytes · ${
      active ? 'phiên bản đang được dùng' : 'phiên bản lịch sử'
    }`,
  };
}

function toProject(
  flow: System3ProjectFlowResponse,
  intakeReports: readonly System3SourceIntakeReportView[] = [],
  intakeGate: System3IntakeGate = emptyProject.intakeGate,
  operation?: System3Project['operation']
): System3Project {
  const latestSourceVersion = new Map<string, number>();
  for (const source of flow.sources) {
    latestSourceVersion.set(
      source.sourceId,
      Math.max(latestSourceVersion.get(source.sourceId) ?? 0, source.version)
    );
  }
  return {
    id: flow.project.id,
    codebaseId: flow.project.codebaseId,
    name: flow.project.name,
    description: flow.project.description,
    stage: flow.project.stage,
    attention: flow.project.attention,
    freshness: flow.project.freshness,
    workflowVersion: flow.project.templateId,
    version: flow.project.version,
    phases: flow.phases.map(phase => ({
      ...phase,
      workflowSteps: phase.workflowSteps.map(step => ({
        ...step,
        duration: step.status === 'completed' ? 'Đã hoàn tất' : 'Chưa chạy',
      })),
    })),
    decisions: flow.decisions.map(decision => ({
      id: decision.id,
      title: decision.title,
      question: decision.question,
      why: decision.why,
      recommendation: decision.recommendation,
      options: decision.options,
      binding: toDecisionBinding(decision.binding),
      affectedPhases: decision.affectedPhases,
      status: decision.status,
      answer: decision.answer,
    })),
    sources: flow.sources.map(source => toSource(source, latestSourceVersion)),
    intakeReports,
    intakeGate,
    manifestApproved: flow.approval !== null,
    planCompiled: flow.compilation !== null,
    compilationId: flow.compilation?.id,
    approvalId: flow.approval?.id,
    understandingRunId: flow.understandingRunId ?? undefined,
    readiness: flow.readiness ?? undefined,
    readinessEvaluation: flow.readinessEvaluation ?? undefined,
    execution: flow.execution
      ? {
          id: flow.execution.id,
          workflowRunId: flow.execution.workflowRunId,
          status: flow.execution.status,
          error: flow.execution.error,
        }
      : undefined,
    verification: flow.verification
      ? {
          id: flow.verification.id,
          workflowRunId: flow.verification.workflowRunId,
          status: flow.verification.status,
          error: flow.verification.error,
          modelReports: flow.verification.evidenceMap?.models ?? [],
          ...(experimentResults(flow.verification.evidenceMap)
            ? { experiment: experimentResults(flow.verification.evidenceMap) }
            : {}),
        }
      : undefined,
    operation: operation
      ? {
          id: operation.id,
          type: operation.type,
          status: operation.status,
          error: operation.error,
        }
      : undefined,
    evidence:
      current.id === flow.project.id && current.execution?.id === flow.execution?.id
        ? current.evidence
        : [],
    delivery: flow.delivery
      ? {
          packageFilename: flow.delivery.packageFilename,
          contentHash: flow.delivery.contentHash,
          sizeBytes: flow.delivery.sizeBytes,
          manifest: flow.delivery.manifest,
        }
      : undefined,
    impacts: flow.impacts.map(impact => {
      const value = impact as typeof impact & Record<string, unknown>;
      return {
        ...impact,
        operationId: typeof value.operationId === 'string' ? value.operationId : null,
        previousSourceVersionId:
          typeof value.previousSourceVersionId === 'string' ? value.previousSourceVersionId : null,
        schemaVersion: value.schemaVersion === 3 ? 3 : value.schemaVersion === 2 ? 2 : 1,
        detectorVersion:
          typeof value.detectorVersion === 'string'
            ? value.detectorVersion
            : 'system3-change-detector@1',
        basisHash: typeof value.basisHash === 'string' ? value.basisHash : `legacy:${impact.id}`,
        manifestHash:
          typeof value.manifestHash === 'string' ? value.manifestHash : `legacy:${impact.id}`,
        manifest:
          value.manifest !== null &&
          typeof value.manifest === 'object' &&
          !Array.isArray(value.manifest)
            ? (value.manifest as System3Project['impacts'][number]['manifest'])
            : null,
      };
    }),
    compilation: compilationSummary(flow.compilation),
    // Only a build of the active approval can be run.
    ...(flow.experimentBuild && flow.experimentBuild.approvalId === flow.approval?.id
      ? { experimentBuild: flow.experimentBuild }
      : {}),
    deliveryReady: flow.verification?.status === 'completed' && flow.delivery === null,
    deliveryAvailable: flow.delivery !== null,
  };
}

function toDecisionBinding(value: unknown): System3Decision['binding'] {
  if (
    value !== null &&
    typeof value === 'object' &&
    'kind' in value &&
    value.kind === 'dataset_target_column' &&
    'allowedValues' in value &&
    Array.isArray(value.allowedValues) &&
    value.allowedValues.every(item => typeof item === 'string')
  ) {
    return { kind: 'dataset_target_column', allowedValues: value.allowedValues };
  }
  return null;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollOperation(operationId: string): Promise<void> {
  for (;;) {
    const response = await fetch(`/api/system3/operations/${operationId}`);
    if (!response.ok) {
      throw new Error(await errorMessage(response, `Không thể đọc operation (${response.status})`));
    }
    const operation = (await response.json()) as System3OperationResponse;
    publish({ ...current, operation });
    if (operation.status === 'succeeded') {
      await system3Store.load(current.id);
      return;
    }
    if (operation.status === 'failed' || operation.status === 'abandoned') {
      throw new Error(operation.error ?? 'System 3 execution thất bại');
    }
    if (operation.status === 'unknown') {
      throw new Error(
        'Không thể xác định process còn sở hữu execution. Mở Technical Console để kiểm tra trước khi chạy lại.'
      );
    }
    await wait(750);
  }
}

async function watchOperation(operationId: string): Promise<void> {
  if (typeof EventSource === 'undefined') return pollOperation(operationId);
  return new Promise<void>((resolve, reject) => {
    const source = new EventSource(`/api/system3/operations/${operationId}/events`);
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      source.close();
      callback();
    };
    source.addEventListener('operation', event => {
      const operation = JSON.parse(event.data) as System3OperationResponse;
      publish({ ...current, operation });
      if (operation.status === 'succeeded') {
        finish(() => {
          void system3Store.load(current.id).then(resolve, reject);
        });
      } else if (operation.status === 'failed' || operation.status === 'abandoned') {
        finish(() => {
          reject(new Error(operation.error ?? 'System 3 execution thất bại'));
        });
      } else if (operation.status === 'unknown') {
        finish(() => {
          reject(
            new Error(
              'Không thể xác định process còn sở hữu execution. Mở Technical Console để kiểm tra trước khi chạy lại.'
            )
          );
        });
      }
    });
    source.onerror = (): void => {
      finish(() => {
        void pollOperation(operationId).then(resolve, reject);
      });
    };
  });
}

async function watchAutomaticVerification(executionOperationId: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    // An experiment build waits for the run choice; nothing is verified yet.
    if (current.experimentBuild?.executionId === current.execution?.id) return;
    const operation = current.operation;
    if (operation?.id !== executionOperationId && operation?.type === 'verify') {
      if (operation.status === 'accepted' || operation.status === 'running') {
        await watchOperation(operation.id);
      }
      return;
    }
    if (current.verification?.status === 'completed' || current.verification?.status === 'failed') {
      return;
    }
    await wait(250);
    await system3Store.load(current.id);
  }
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: string;
      message?: string;
      report?: { checks?: readonly { status?: string; message?: string }[] };
    };
    const failedCheck = body.report?.checks?.find(check => check.status === 'failed')?.message;
    const summary = body.message ?? body.error ?? fallback;
    return failedCheck ? `${summary}: ${failedCheck}` : summary;
  } catch {
    return fallback;
  }
}

export class System3SourceIntakeRequestError extends Error {
  readonly status: number;
  readonly idempotencyKey: string;
  readonly intakeReport: System3SourceIntakeReportView | null;

  constructor(input: {
    message: string;
    status: number;
    idempotencyKey: string;
    intakeReport: System3SourceIntakeReportView | null;
  }) {
    super(input.message);
    this.name = 'System3SourceIntakeRequestError';
    this.status = input.status;
    this.idempotencyKey = input.idempotencyKey;
    this.intakeReport = input.intakeReport;
  }
}

async function loadSourceIntakeReports(
  projectId: string
): Promise<readonly System3SourceIntakeReportView[]> {
  const response = await fetch(`/api/system3/projects/${projectId}/source-intake-reports`);
  if (!response.ok) {
    throw new Error(
      await errorMessage(response, `Không thể tải báo cáo tiếp nhận (${response.status})`)
    );
  }
  return ((await response.json()) as { reports: System3SourceIntakeReportView[] }).reports;
}

async function loadIntakeGate(projectId: string): Promise<System3IntakeGate> {
  const response = await fetch(`/api/system3/projects/${projectId}/intake-gate`);
  if (!response.ok) {
    throw new Error(await errorMessage(response, `Không thể tải cổng Intake (${response.status})`));
  }
  return (await response.json()) as System3IntakeGate;
}

async function loadProjectOperations(
  projectId: string,
  signal?: AbortSignal
): Promise<System3OperationResponse[]> {
  const response = await fetch(`/api/system3/projects/${encodeURIComponent(projectId)}/history`, {
    signal,
  });
  if (!response.ok) {
    throw new Error(
      await errorMessage(response, `Không thể tải operation history (${response.status})`)
    );
  }
  const history = (await response.json()) as System3ProjectHistory;
  return history.operations;
}

async function loadOperationProjection(
  operationId: string,
  signal?: AbortSignal
): Promise<System3OperationResponse> {
  const response = await fetch(`/api/system3/operations/${encodeURIComponent(operationId)}`, {
    signal,
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, `Không thể tải operation (${response.status})`));
  }
  return (await response.json()) as System3OperationResponse;
}

function isOperationPending(operation: System3OperationResponse): boolean {
  return ['accepted', 'running'].includes(operation.status);
}

export function latestProjectOperation(
  operations: readonly System3OperationResponse[]
): System3OperationResponse | undefined {
  return operations.reduce<System3OperationResponse | undefined>(
    (latest, operation) =>
      latest === undefined ||
      operation.createdAt > latest.createdAt ||
      (operation.createdAt === latest.createdAt &&
        (operation.projectVersion > latest.projectVersion ||
          // Timestamps have second precision; several operations can share one.
          (operation.projectVersion === latest.projectVersion &&
            operation.updatedAt > latest.updatedAt)))
        ? operation
        : latest,
    undefined
  );
}

function waitForNextObservation(signal: AbortSignal, delay: number): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, delay);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function waitUntilVisible(signal: AbortSignal): Promise<void> {
  if (typeof document === 'undefined' || !document.hidden || signal.aborted)
    return Promise.resolve();
  return new Promise(resolve => {
    const finish = (): void => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const onVisibilityChange = (): void => {
      if (!document.hidden) finish();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function startProjectOperation(
  path: string,
  expectedVersion: number,
  extraBody: Record<string, unknown> = {}
): Promise<System3OperationResponse> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ ...extraBody, expectedVersion }),
  });
  if (!response.ok) {
    throw new Error(
      await errorMessage(response, `Không thể bắt đầu operation (${response.status})`)
    );
  }
  const body = (await response.json()) as { operation: System3OperationResponse };
  publish({ ...current, operation: body.operation });
  return body.operation;
}

async function runProjectOperation(
  path: string,
  expectedVersion: number,
  extraBody: Record<string, unknown> = {}
): Promise<void> {
  const operation = await startProjectOperation(path, expectedVersion, extraBody);
  await watchOperation(operation.id);
}

export const system3Store = {
  getSnapshot: (): System3Project => current,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  load: async (id: string, signal?: AbortSignal): Promise<void> => {
    const [flow, reports, intakeGate, operations] = await Promise.all([
      getSystem3ProjectFlow(id),
      loadSourceIntakeReports(id),
      loadIntakeGate(id),
      loadProjectOperations(id, signal),
    ]);
    if (signal?.aborted) return;
    const latest = latestProjectOperation(operations);
    let operation = latest;
    if (latest && (isOperationPending(latest) || latest.status === 'unknown')) {
      try {
        operation = await loadOperationProjection(latest.id, signal);
      } catch (error) {
        if (signal?.aborted) return;
        throw error;
      }
    }
    if (signal?.aborted) return;
    publish(toProject(flow, reports, intakeGate, operation));
  },
  watchOperations: async (
    projectId: string,
    signal: AbortSignal,
    onError: (message: string | null) => void
  ): Promise<void> => {
    let observedId = current.id === projectId ? current.operation?.id : undefined;
    let observedStatus = current.id === projectId ? current.operation?.status : undefined;
    while (!signal.aborted) {
      await waitUntilVisible(signal);
      if (signal.aborted) return;
      let delay = 5000;
      try {
        const operations = await loadProjectOperations(projectId, signal);
        if (signal.aborted) return;
        const latest = latestProjectOperation(operations);
        if (latest) {
          if (isOperationPending(latest)) delay = 1500;
          const operation =
            isOperationPending(latest) || latest.status === 'unknown'
              ? await loadOperationProjection(latest.id, signal)
              : latest;
          if (signal.aborted) return;
          if (latest.id !== observedId || operation.status !== observedStatus) {
            await system3Store.load(projectId, signal);
            if (signal.aborted) return;
            observedId = latest.id;
            observedStatus = current.operation?.status;
          }
        }
        onError(null);
      } catch (error) {
        if (signal.aborted) return;
        onError(error instanceof Error ? error.message : 'Không thể theo dõi operation');
      }
      await waitForNextObservation(signal, delay);
    }
  },
  createProject: async (name: string, description: string): Promise<string> => {
    const project = await createSystem3ProjectRequest({
      name,
      description,
      createManagedCodebase: true,
    });
    await system3Store.load(project.id);
    return project.id;
  },
  uploadSource: async (
    kind: System3SourceKind,
    file: File,
    options: { sourceId?: string; role?: System3SourceRole; idempotencyKey?: string } = {}
  ): Promise<System3SourceIntakeResult> => {
    const project = current;
    const form = new FormData();
    form.set('kind', kind);
    form.set('role', options.role ?? 'primary');
    if (options.sourceId) form.set('sourceId', options.sourceId);
    form.set('expectedVersion', project.version.toString());
    form.set('file', file);
    const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
    const response = await fetch(`/api/system3/projects/${project.id}/sources`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: form,
    });
    if (!response.ok) {
      let intakeReport: System3SourceIntakeReportView | null = null;
      let message = `Không thể tải source (${response.status})`;
      try {
        const body = (await response.json()) as {
          error?: string;
          message?: string;
          intakeReport?: System3SourceIntakeReportView;
          report?: { checks?: readonly { status?: string; message?: string }[] };
        };
        intakeReport = body.intakeReport ?? null;
        const failedCheck = body.report?.checks?.find(check => check.status === 'failed')?.message;
        message = body.message ?? body.error ?? message;
        if (failedCheck) message = `${message}: ${failedCheck}`;
      } catch {
        // Keep the stable fallback when the server did not return JSON.
      }
      if (intakeReport) {
        publish({
          ...current,
          intakeReports: [
            intakeReport,
            ...current.intakeReports.filter(report => report.id !== intakeReport.id),
          ],
        });
      }
      throw new System3SourceIntakeRequestError({
        message,
        status: response.status,
        idempotencyKey,
        intakeReport,
      });
    }
    const wire = (await response.json()) as Omit<System3SourceIntakeResult, 'version'> & {
      version: System3ProjectFlowResponse['sources'][number];
    };
    await system3Store.load(project.id);
    const mappedVersion = current.sources.find(source => source.id === wire.version.id);
    if (!mappedVersion) throw new Error('Không tìm thấy source vừa được tiếp nhận trong registry');
    return { ...wire, version: mappedVersion };
  },
  retrySourceIntake: async (operationId: string): Promise<void> => {
    const project = current;
    const response = await fetch(
      `/api/system3/projects/${project.id}/source-intake-operations/${operationId}/retry`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: project.version }),
      }
    );
    if (!response.ok) {
      throw new Error(
        await errorMessage(response, `Không thể khôi phục Source Intake (${response.status})`)
      );
    }
    await system3Store.load(project.id);
  },
  retryChangeDetection: async (sourceVersionId: string): Promise<void> => {
    const project = current;
    const response = await fetch(
      `/api/system3/projects/${project.id}/source-versions/${sourceVersionId}/change-detection/retry`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: project.version }),
      }
    );
    if (!response.ok) {
      throw new Error(await errorMessage(response, `Không thể thử lại OP-01 (${response.status})`));
    }
    await system3Store.load(project.id);
  },
  analyze: async (): Promise<void> => {
    const project = current;
    await runProjectOperation(
      `/api/system3/projects/${project.id}/knowledge-snapshots`,
      project.version
    );
  },
  /**
   * OP-00/OP-01 settle asynchronously after an upload. Wait for the gate; returns false as soon as
   * intake reports a failure that needs the user, or when the wait times out.
   */
  waitForIntakeGate: async (timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const gate = current.intakeGate;
      if (gate.ready) return true;
      const failed =
        gate.changeDetection.some(item => item.status === 'failed') ||
        gate.recoveries.some(item => item.status === 'failed');
      if (failed || Date.now() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, 1000));
      await system3Store.load(current.id);
    }
  },
  /** Starts TW-02 and returns once the server accepted it; the workspace poller observes progress. */
  startAnalysis: async (): Promise<void> => {
    const project = current;
    await startProjectOperation(
      `/api/system3/projects/${project.id}/knowledge-snapshots`,
      project.version
    );
  },
  getUnderstandingView: async (): Promise<System3UnderstandingView> => {
    const response = await fetch(
      `/api/system3/projects/${encodeURIComponent(current.id)}/phases/understanding/view`
    );
    if (!response.ok) {
      throw new Error(
        await errorMessage(response, `Không thể tải Bản hiểu dự án (${response.status})`)
      );
    }
    const view = (await response.json()) as Omit<System3UnderstandingView, 'decisions'> & {
      decisions: readonly (Omit<System3Decision, 'binding'> & { binding: unknown })[];
    };
    return {
      ...view,
      decisions: view.decisions.map(decision => ({
        ...decision,
        binding: toDecisionBinding(decision.binding),
      })),
    };
  },
  activateUnderstanding: async (
    snapshotId: string,
    expectedVersion: number
  ): Promise<System3KnowledgeSnapshot> => {
    const response = await fetch(
      `/api/system3/projects/${encodeURIComponent(current.id)}/knowledge-snapshots/${encodeURIComponent(snapshotId)}/activate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ expectedVersion }),
      }
    );
    if (!response.ok) {
      throw new Error(
        await errorMessage(response, `Không thể kích hoạt Bản hiểu dự án (${response.status})`)
      );
    }
    const snapshot = (await response.json()) as System3KnowledgeSnapshot;
    await system3Store.load(current.id);
    return snapshot;
  },
  answerDecision: async (decisionId: string, answer?: string): Promise<void> => {
    const project = current;
    const response = await fetch(
      `/api/system3/projects/${project.id}/decisions/${decisionId}/respond`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answer: answer ?? 'Dùng đề xuất',
          expectedVersion: project.version,
        }),
      }
    );
    if (!response.ok)
      throw new Error(
        await errorMessage(response, `Không thể cập nhật decision (${response.status})`)
      );
    publish(
      toProject(
        (await response.json()) as System3ProjectFlowResponse,
        project.intakeReports,
        project.intakeGate,
        project.operation
      )
    );
  },
  runReadiness: async (): Promise<void> => {
    const project = current;
    await runProjectOperation(
      `/api/system3/projects/${project.id}/readiness-contracts`,
      project.version
    );
  },
  compile: async (): Promise<void> => {
    const project = current;
    await runProjectOperation(`/api/system3/projects/${project.id}/compilations`, project.version);
  },
  approve: async (): Promise<void> => {
    const project = current;
    if (!project.compilationId) throw new Error('Compile preview trước khi approve');
    const response = await fetch(`/api/system3/projects/${project.id}/approval-manifests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        compilationId: project.compilationId,
        expectedVersion: project.version,
      }),
    });
    if (!response.ok)
      throw new Error(await errorMessage(response, `Không thể approve plan (${response.status})`));
    await system3Store.load(project.id);
  },
  execute: async (): Promise<void> => {
    const project = current;
    if (!project.approvalId) throw new Error('Approve manifest trước khi execute');
    const response = await fetch(`/api/system3/projects/${project.id}/executions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ approvalId: project.approvalId, expectedVersion: project.version }),
    });
    if (!response.ok) {
      throw new Error(await errorMessage(response, `Không thể execute plan (${response.status})`));
    }
    const body = (await response.json()) as {
      operation: System3OperationResponse;
      execution: System3Project['execution'];
    };
    publish({ ...project, operation: body.operation, execution: body.execution });
    await watchOperation(body.operation.id);
    await watchAutomaticVerification(body.operation.id);
  },
  approveAndExecute: async (): Promise<void> => {
    const project = current;
    if (!project.compilationId) throw new Error('Compile preview trước khi approve');
    const request = getExecutionRequest(project.id, project.compilationId, project.version);
    const response = await fetch(`/api/system3/projects/${project.id}/executions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.idempotencyKey },
      body: JSON.stringify({
        compilationId: project.compilationId,
        expectedVersion: request.expectedVersion,
      }),
    });
    if (!response.ok) {
      if (response.status === 409) {
        throw new Error(
          'Project hoặc plan đã thay đổi. Tải lại project để kiểm tra basis hiện tại; chỉ chạy lại sau khi review một plan mới.'
        );
      }
      throw new Error(
        await errorMessage(response, `Không thể phê duyệt và chạy (${response.status})`)
      );
    }
    const body = (await response.json()) as {
      operation: System3OperationResponse;
      execution: System3Project['execution'];
    };
    publish({ ...project, operation: body.operation, execution: body.execution });
    await watchOperation(body.operation.id);
    await watchAutomaticVerification(body.operation.id);
  },
  /** Runs variants of the latest experiment build (plan 13 §10). */
  runExperiment: async (choice: {
    variantIds: readonly string[];
    parallelism: number;
    /** Keep the latest run's results for variants not run again. */
    keepEarlierResults: boolean;
  }): Promise<void> => {
    const project = current;
    const build = project.experimentBuild;
    if (!project.approvalId || !build) throw new Error('Chưa có gói code đã build để chạy');
    const response = await fetch(`/api/system3/projects/${project.id}/executions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        approvalId: project.approvalId,
        expectedVersion: project.version,
        experimentRun: {
          buildExecutionId: build.executionId,
          variantIds: choice.variantIds,
          parallelism: choice.parallelism,
          ...(choice.keepEarlierResults && build.latestRunExecutionId
            ? { carryOverExecutionId: build.latestRunExecutionId }
            : {}),
        },
      }),
    });
    if (!response.ok)
      throw new Error(
        await errorMessage(response, `Không thể chạy thí nghiệm (${response.status})`)
      );
    const body = (await response.json()) as {
      operation: System3OperationResponse;
      execution: System3Project['execution'];
    };
    publish({ ...project, operation: body.operation, execution: body.execution });
    await watchOperation(body.operation.id);
    await watchAutomaticVerification(body.operation.id);
  },
  verify: async (): Promise<void> => {
    const project = current;
    if (!project.execution) throw new Error('Chưa có baseline execution để verify');
    await runProjectOperation(
      `/api/system3/projects/${project.id}/executions/${project.execution.id}/verifications`,
      project.version
    );
  },
  /** `selectedVariant` records the user's experiment choice in the delivery manifest. */
  deliver: async (selectedVariant?: string): Promise<void> => {
    const project = current;
    if (!project.verification) throw new Error('Chưa có verification để tạo delivery');
    await runProjectOperation(
      `/api/system3/projects/${project.id}/verifications/${project.verification.id}/deliveries`,
      project.version,
      selectedVariant === undefined ? {} : { selectedVariant }
    );
  },
  abandonUnknownOperation: async (): Promise<void> => {
    const project = current;
    if (project.operation?.status !== 'unknown') {
      throw new Error('Chỉ có thể đóng operation đang ở trạng thái không xác định');
    }
    const response = await fetch(`/api/system3/operations/${project.operation.id}/abandon`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(
        await errorMessage(response, `Không thể đóng operation (${response.status})`)
      );
    }
    const operation = (await response.json()) as System3OperationResponse;
    publish({ ...project, operation });
    await system3Store.load(project.id);
  },
  loadEvidence: async (): Promise<void> => {
    const project = current;
    if (!project.execution) return;
    const response = await fetch(`/api/system3/projects/${project.id}/evidence`);
    if (!response.ok) {
      throw new Error(await errorMessage(response, `Không thể tải evidence (${response.status})`));
    }
    const body = (await response.json()) as { evidence: System3Project['evidence'] };
    publish({ ...current, evidence: body.evidence });
  },
};

export function useSystem3Project(): System3Project {
  return useSyncExternalStore(
    system3Store.subscribe,
    system3Store.getSnapshot,
    system3Store.getSnapshot
  );
}
