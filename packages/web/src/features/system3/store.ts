import { useSyncExternalStore } from 'react';
import {
  createSystem3Project as createSystem3ProjectRequest,
  getSystem3ProjectFlow,
  type System3OperationResponse,
  type System3ProjectFlowResponse,
} from '@/lib/api';
import type {
  System3IntakeGate,
  System3Project,
  System3Source,
  System3SourceIntakeResult,
  System3SourceIntakeReportView,
  System3SourceKind,
  System3SourceRole,
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
  intakeGate: System3IntakeGate = emptyProject.intakeGate
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
        }
      : undefined,
    operation:
      current.id === flow.project.id && current.execution?.id === flow.execution?.id
        ? current.operation
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
    deliveryReady: flow.verification?.status === 'completed' && flow.delivery === null,
    deliveryAvailable: flow.delivery !== null,
  };
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

async function runProjectOperation(path: string, expectedVersion: number): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ expectedVersion }),
  });
  if (!response.ok) {
    throw new Error(
      await errorMessage(response, `Không thể bắt đầu operation (${response.status})`)
    );
  }
  const body = (await response.json()) as { operation: System3OperationResponse };
  publish({ ...current, operation: body.operation });
  await watchOperation(body.operation.id);
}

export const system3Store = {
  getSnapshot: (): System3Project => current,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  load: async (id: string): Promise<void> => {
    const [flow, reports, intakeGate] = await Promise.all([
      getSystem3ProjectFlow(id),
      loadSourceIntakeReports(id),
      loadIntakeGate(id),
    ]);
    publish(toProject(flow, reports, intakeGate));
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
    publish(toProject((await response.json()) as System3ProjectFlowResponse));
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
  },
  verify: async (): Promise<void> => {
    const project = current;
    if (!project.execution) throw new Error('Chưa có baseline execution để verify');
    await runProjectOperation(
      `/api/system3/projects/${project.id}/executions/${project.execution.id}/verifications`,
      project.version
    );
  },
  deliver: async (): Promise<void> => {
    const project = current;
    if (!project.verification) throw new Error('Chưa có verification để tạo delivery');
    await runProjectOperation(
      `/api/system3/projects/${project.id}/verifications/${project.verification.id}/deliveries`,
      project.version
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
