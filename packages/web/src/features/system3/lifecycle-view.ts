import type { PhaseStatus, System3Phase, System3Project, System3WorkflowStep } from './types';

export type LifecycleExecutionKind = 'operation' | 'workflow';

export interface LifecycleActivityView {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  executionKind: LifecycleExecutionKind;
  status: PhaseStatus;
  statusDetail: string;
  input: string;
  output: string;
  technicalWorkflow: string | null;
  route: 'flow' | 'sources' | 'decisions' | 'evidence' | 'delivery' | 'technical';
  workflowSteps: readonly System3WorkflowStep[];
  legacy?: boolean;
}

export interface LifecyclePhaseView {
  id: 'intake' | 'understanding' | 'readiness' | 'build' | 'verify' | 'delivery';
  title: string;
  eyebrow: string;
  summary: string;
  objective: string;
  status: PhaseStatus;
  progress: number;
  activities: readonly LifecycleActivityView[];
}

function backendPhase(project: System3Project, id: string): System3Phase | undefined {
  return project.phases.find(phase => phase.id === id);
}

function normalizeStatus(status: PhaseStatus | undefined): PhaseStatus {
  return status ?? 'not_started';
}

function operationStatus(input: {
  complete: boolean;
  active?: boolean;
  blocked?: boolean;
  ready?: boolean;
  waiting?: boolean;
}): PhaseStatus {
  if (input.complete) return 'completed';
  if (input.blocked) return 'blocked';
  if (input.active) return 'active';
  if (input.ready) return 'ready';
  if (input.waiting) return 'waiting';
  return 'not_started';
}

function rollupStatus(activities: readonly LifecycleActivityView[]): PhaseStatus {
  const statuses = activities.map(activity => activity.status);
  if (statuses.every(status => status === 'completed')) return 'completed';
  if (statuses.includes('stale')) return 'stale';
  if (statuses.includes('active')) return 'active';
  if (statuses.includes('blocked')) return 'blocked';
  if (statuses.includes('ready')) return 'ready';
  if (statuses.includes('completed')) return 'active';
  if (statuses.includes('waiting')) return 'waiting';
  return 'not_started';
}

function progressOf(activities: readonly LifecycleActivityView[]): number {
  const units = activities.reduce((total, activity) => {
    if (activity.status === 'completed' || activity.status === 'stale') return total + 1;
    if (activity.status === 'active') return total + 0.5;
    return total;
  }, 0);
  return Math.round((units / activities.length) * 100);
}

function phase(input: Omit<LifecyclePhaseView, 'status' | 'progress'>): LifecyclePhaseView {
  return {
    ...input,
    status: rollupStatus(input.activities),
    progress: progressOf(input.activities),
  };
}

export function buildLifecycleView(project: System3Project): readonly LifecyclePhaseView[] {
  const understanding = backendPhase(project, 'understanding');
  const readiness = backendPhase(project, 'readiness');
  const buildSections = ['data', 'features', 'experiments', 'explainability']
    .map(id => backendPhase(project, id))
    .filter(value => value !== undefined);
  const activeSources = project.sources.filter(source => source.status === 'ready');
  const legacySources = activeSources.filter(
    source => source.origin === 'legacy' || source.intakeReportArtifactId === null
  );
  const hasRecoveries = project.intakeGate.recoveries.length > 0;
  const changeStatuses = project.intakeGate.changeDetection.map(item => item.status);
  const changeComplete =
    changeStatuses.length > 0 && changeStatuses.every(status => status === 'succeeded');
  const changeRunning = changeStatuses.includes('running');
  const changeFailed = changeStatuses.includes('failed') || changeStatuses.includes('unknown');
  const intakeActivities: readonly LifecycleActivityView[] = [
    {
      id: 'OP-00',
      label: 'Tiếp nhận nguồn đầu vào',
      shortLabel: 'Source Intake',
      description: 'Kiểm tra file, lưu nội dung bất biến và ghi nhận phiên bản đang được dùng.',
      executionKind: 'operation',
      status: operationStatus({
        complete: activeSources.length > 0 && !hasRecoveries,
        active: hasRecoveries,
        blocked: hasRecoveries,
      }),
      statusDetail:
        activeSources.length === 0
          ? 'Chưa có nguồn hợp lệ.'
          : hasRecoveries
            ? `${project.intakeGate.recoveries.length.toString()} yêu cầu cần được khôi phục.`
            : legacySources.length > 0
              ? `${activeSources.length.toString()} nguồn sẵn sàng; ${legacySources.length.toString()} nguồn được chuyển từ phiên bản Anvil cũ.`
              : `${activeSources.length.toString()} nguồn sẵn sàng và có lịch sử tiếp nhận.`,
      input: 'File nguồn, loại nguồn, vai trò và phiên bản project',
      output: 'Source Version bất biến + báo cáo tiếp nhận',
      technicalWorkflow: null,
      route: 'sources',
      workflowSteps: [],
      legacy: legacySources.length > 0,
    },
    {
      id: 'OP-01',
      label: 'Phát hiện thay đổi',
      shortLabel: 'Change Detection',
      description: 'Xác định nguồn mới làm phần nào của project cần được cập nhật.',
      executionKind: 'operation',
      status: operationStatus({
        complete: changeComplete,
        active: changeRunning,
        blocked: changeFailed,
        ready: activeSources.length > 0 && !changeComplete,
        waiting: activeSources.length === 0,
      }),
      statusDetail:
        activeSources.length === 0
          ? 'Chờ OP-00 tiếp nhận nguồn.'
          : changeComplete
            ? 'Mọi Source Version đang dùng đã được kiểm tra ảnh hưởng.'
            : changeRunning
              ? 'Đang kiểm tra phạm vi ảnh hưởng.'
              : changeFailed
                ? 'Có lần kiểm tra cần người dùng thử lại.'
                : 'Sẵn sàng kiểm tra nguồn đã tiếp nhận.',
      input: 'Source Version mới và trạng thái project hiện tại',
      output: 'Impact Manifest + trạng thái stale của phần liên quan',
      technicalWorkflow: null,
      route: 'sources',
      workflowSteps: [],
    },
  ];

  const backendUnderstandingStatus = normalizeStatus(understanding?.status);
  // The backend phase stays not_started until a snapshot is activated; a running analysis or a
  // candidate awaiting review must not be presented as "not started" (that invites a duplicate run).
  const analysisInProgressOrAwaitingReview =
    (backendUnderstandingStatus === 'not_started' || backendUnderstandingStatus === 'ready') &&
    (project.stage === 'understanding' ||
      (project.operation?.type === 'analyze' &&
        (project.operation.status === 'accepted' || project.operation.status === 'running')));
  const understandingStatus: PhaseStatus = analysisInProgressOrAwaitingReview
    ? 'active'
    : backendUnderstandingStatus;
  const understandingActivities: readonly LifecycleActivityView[] = [
    {
      id: 'TW-02',
      label: 'Hiểu dự án',
      shortLabel: 'Understand Project',
      description: 'Đọc các nguồn đã ghim và tạo bản hiểu dự án có thể truy ngược.',
      executionKind: 'workflow',
      status: understandingStatus,
      statusDetail:
        understandingStatus === 'completed'
          ? 'Knowledge Snapshot hiện hành đã được tạo.'
          : understandingStatus === 'stale'
            ? 'Nguồn đã đổi; bản hiểu dự án cần được tạo lại.'
            : analysisInProgressOrAwaitingReview
              ? project.operation?.type === 'analyze' && project.operation.status !== 'succeeded'
                ? 'Anvil đang phân tích các nguồn đã ghim.'
                : 'Bản hiểu đã sẵn sàng; xem, trả lời câu hỏi và chấp nhận.'
              : project.intakeGate.ready
                ? 'Đầu vào đã sẵn sàng; chờ người dùng xác nhận bắt đầu.'
                : 'Chờ hoàn tất phase Tiếp nhận.',
      input: 'Input Snapshot khóa đúng Source Version',
      output: 'Knowledge Snapshot, requirements, facts và Decisions',
      technicalWorkflow: understanding?.technicalWorkflow ?? 'system3-understand-project',
      route: 'flow',
      workflowSteps: understanding?.workflowSteps ?? [],
    },
  ];

  const readinessStatus = normalizeStatus(readiness?.status);
  const readinessEvaluation = project.readinessEvaluation;
  const readinessBlocked =
    readinessEvaluation !== undefined && readinessEvaluation.status !== 'passed';
  const readinessRoute =
    readinessEvaluation?.nextAction === 'link_dataset'
      ? 'sources'
      : readinessEvaluation?.nextAction === 'answer_decisions'
        ? 'decisions'
        : readinessEvaluation?.nextAction === 'configure_runtime'
          ? 'technical'
          : 'flow';
  const readinessActivities: readonly LifecycleActivityView[] = [
    {
      id: 'TW-03',
      label: 'Kiểm tra mức độ sẵn sàng',
      shortLabel: 'Readiness',
      description: 'Kiểm tra dữ liệu, quyết định và điều kiện cần có trước khi lập kế hoạch.',
      executionKind: 'workflow',
      status: readinessBlocked ? 'blocked' : readinessStatus,
      statusDetail: project.readiness
        ? 'Readiness Contract hiện hành đã được tạo.'
        : readinessEvaluation?.blockerReasons[0] !== undefined
          ? readinessEvaluation.blockerReasons[0]
          : project.decisions.some(decision => decision.status === 'pending')
            ? 'Còn Decision cần người dùng trả lời.'
            : 'Chờ bản hiểu dự án hiện hành.',
      input: 'Knowledge Snapshot, Decisions và runtime profile',
      output: 'Readiness Contract và danh sách điều còn thiếu',
      technicalWorkflow: readiness?.technicalWorkflow ?? 'system3-readiness-contract',
      route: readinessRoute,
      workflowSteps: readiness?.workflowSteps ?? [],
    },
    {
      id: 'OP-04',
      label: 'Chuẩn bị kế hoạch thực thi',
      shortLabel: 'Compile',
      description: 'Chuyển trạng thái đủ điều kiện thành Execution Plan chính xác.',
      executionKind: 'operation',
      status: operationStatus({
        complete: project.planCompiled,
        ready: project.readiness !== undefined,
        waiting: project.readiness === undefined,
      }),
      statusDetail: project.planCompiled
        ? 'Execution Plan đã được tạo và đang chờ hoặc đã được phê duyệt.'
        : project.readiness
          ? 'Readiness đã đạt; có thể chuẩn bị kế hoạch.'
          : 'Chờ Readiness Contract.',
      input: 'Readiness Contract + version và capability snapshots',
      output: 'Execution Plan',
      technicalWorkflow: null,
      route: 'decisions',
      workflowSteps: [],
    },
    {
      id: 'OP-05',
      label: 'Phê duyệt kế hoạch',
      shortLabel: 'Approve',
      description: 'Ghi nhận chính xác kế hoạch, đầu vào và quyền mà người dùng chấp thuận.',
      executionKind: 'operation',
      status: operationStatus({
        complete: project.manifestApproved,
        ready: project.planCompiled,
        waiting: !project.planCompiled,
      }),
      statusDetail: project.manifestApproved
        ? 'Approval Manifest đã được ghi nhận.'
        : project.planCompiled
          ? 'Execution Plan đang chờ người dùng xem và phê duyệt.'
          : 'Chờ Execution Plan.',
      input: 'Execution Plan chính xác và actor phê duyệt',
      output: 'Approval Manifest bất biến',
      technicalWorkflow: null,
      route: 'decisions',
      workflowSteps: [],
    },
  ];

  const buildStatus: PhaseStatus = project.execution
    ? project.execution.status === 'completed'
      ? 'completed'
      : project.execution.status === 'failed'
        ? 'blocked'
        : 'active'
    : project.manifestApproved
      ? 'ready'
      : 'waiting';
  const buildActivities: readonly LifecycleActivityView[] = [
    {
      id: 'TW-06',
      label: 'Thực thi kế hoạch đã duyệt',
      shortLabel: 'Execute Project Workflow Version',
      description: 'Chạy build, dữ liệu và thử nghiệm theo đúng Approval Manifest.',
      executionKind: 'workflow',
      status: buildStatus,
      statusDetail: project.execution
        ? project.execution.status === 'completed'
          ? 'Execution đã hoàn tất; kết quả đang được xác minh.'
          : project.execution.status === 'failed'
            ? (project.execution.error ?? 'Execution thất bại và cần được xem xét.')
            : 'Execution đang chạy trong môi trường cô lập.'
        : project.manifestApproved
          ? 'Kế hoạch đã duyệt và sẵn sàng thực thi.'
          : 'Chờ Approval Manifest.',
      input: 'Approval Manifest + project workspace cô lập',
      output: 'Execution artifacts và kết quả build/experiment',
      technicalWorkflow: 'system3-baseline-build + system3-baseline-experiment',
      route: 'flow',
      workflowSteps: buildSections.flatMap(section => section.workflowSteps),
    },
  ];

  const verificationStatus: PhaseStatus = project.verification
    ? project.verification.status === 'completed'
      ? 'completed'
      : project.verification.status === 'failed'
        ? 'blocked'
        : 'active'
    : project.execution?.status === 'completed'
      ? 'ready'
      : 'waiting';
  const verifyActivities: readonly LifecycleActivityView[] = [
    {
      id: 'TW-07',
      label: 'Xác minh kết quả độc lập',
      shortLabel: 'Verify',
      description: 'Kiểm tra artifact bất biến và gắn Evidence vào từng yêu cầu.',
      executionKind: 'workflow',
      status: verificationStatus,
      statusDetail: project.verification
        ? project.verification.status === 'completed'
          ? 'Verification đã hoàn tất; Evidence có thể được kiểm tra.'
          : project.verification.status === 'failed'
            ? (project.verification.error ?? 'Verification chưa đạt.')
            : 'Verification đang chạy.'
        : 'Chờ execution hoàn tất.',
      input: 'Execution artifact bất biến + validator version',
      output: 'Verification result + Evidence',
      technicalWorkflow: 'system3-verify',
      route: project.verification ? 'evidence' : 'flow',
      workflowSteps: [],
    },
  ];

  const deliveryActivities: readonly LifecycleActivityView[] = [
    {
      id: 'OP-08',
      label: 'Yêu cầu bàn giao',
      shortLabel: 'Delivery Request',
      description: 'Kiểm tra verification hiện hành trước khi người dùng yêu cầu đóng gói.',
      executionKind: 'operation',
      status: operationStatus({
        complete: project.deliveryAvailable,
        ready: project.deliveryReady,
        waiting: !project.deliveryReady,
      }),
      statusDetail: project.deliveryAvailable
        ? 'Yêu cầu bàn giao đã được chấp nhận.'
        : project.deliveryReady
          ? 'Verification hiện hành đã đạt; người dùng có thể yêu cầu bàn giao.'
          : 'Chờ Verification đạt.',
      input: 'Verification đã đạt + yêu cầu package',
      output: 'Delivery gate được chấp nhận',
      technicalWorkflow: null,
      route: 'delivery',
      workflowSteps: [],
    },
    {
      id: 'TW-09',
      label: 'Tạo gói bàn giao',
      shortLabel: 'Deliver',
      description: 'Tạo package và manifest bất biến từ kết quả đã được xác minh.',
      executionKind: 'workflow',
      status: project.deliveryAvailable ? 'completed' : project.deliveryReady ? 'ready' : 'waiting',
      statusDetail: project.deliveryAvailable
        ? `Package ${project.delivery?.packageFilename ?? ''} đã sẵn sàng tải xuống.`
        : project.deliveryReady
          ? 'Chờ người dùng chủ động yêu cầu tạo package.'
          : 'Chờ Delivery Request hợp lệ.',
      input: 'Immutable artifact + verification hiện hành',
      output: 'Delivery Package + Delivery Manifest',
      technicalWorkflow: 'system3-delivery',
      route: 'delivery',
      workflowSteps: [],
    },
  ];

  return [
    phase({
      id: 'intake',
      title: 'Tiếp nhận',
      eyebrow: 'Intake',
      summary: 'Nhận, kiểm tra và khóa đúng phiên bản nguồn trước khi phân tích.',
      objective: 'Bảo đảm mọi activity sau đều dùng nguồn có phiên bản và nguồn gốc rõ ràng.',
      activities: intakeActivities,
    }),
    phase({
      id: 'understanding',
      title: 'Hiểu dự án',
      eyebrow: 'Understanding',
      summary: 'Biến nguồn đã ghim thành bản hiểu dự án có thể kiểm tra.',
      objective: 'Tạo Knowledge Snapshot mà người dùng có thể xem và truy ngược về nguồn.',
      activities: understandingActivities,
    }),
    phase({
      id: 'readiness',
      title: 'Sẵn sàng',
      eyebrow: 'Readiness',
      summary: 'Đóng các khoảng trống, chuẩn bị và phê duyệt kế hoạch chính xác.',
      objective: 'Chỉ cho phép thực thi khi điều kiện, kế hoạch và quyền đã rõ ràng.',
      activities: readinessActivities,
    }),
    phase({
      id: 'build',
      title: 'Xây dựng',
      eyebrow: 'Build',
      summary: 'Thực hiện đúng Project Workflow Version đã được phê duyệt.',
      objective: 'Tạo kết quả có thể tái lập trong môi trường thực thi được cô lập.',
      activities: buildActivities,
    }),
    phase({
      id: 'verify',
      title: 'Xác minh',
      eyebrow: 'Verify',
      summary: 'Kiểm tra kết quả độc lập bằng bằng chứng thay vì chỉ tin trạng thái chạy.',
      objective: 'Phân biệt execution thành công với kết quả thực sự đáp ứng yêu cầu.',
      activities: verifyActivities,
    }),
    phase({
      id: 'delivery',
      title: 'Bàn giao',
      eyebrow: 'Delivery',
      summary: 'Chỉ đóng gói và bàn giao kết quả đã được xác minh.',
      objective: 'Tạo package bất biến cùng manifest và hướng dẫn có thể đối soát.',
      activities: deliveryActivities,
    }),
  ];
}

export function completedLifecyclePhaseCount(phases: readonly LifecyclePhaseView[]): number {
  return phases.filter(item => item.status === 'completed').length;
}

export type SuggestedLifecycleActivityReason =
  | 'unknown_operation'
  | 'active_operation'
  | 'blocker'
  | 'pending_decision'
  | 'missing_data'
  | 'understanding'
  | 'approval'
  | 'verification_results'
  | 'next_activity';

export interface SuggestedLifecycleActivity {
  activityId: string;
  reason: SuggestedLifecycleActivityReason;
}

const operationActivity: Partial<Record<NonNullable<System3Project['operation']>['type'], string>> =
  {
    source_intake: 'OP-00',
    change_detection: 'OP-01',
    analyze: 'TW-02',
    activate_understanding: 'TW-02',
    readiness: 'TW-03',
    compile: 'OP-04',
    execute: 'TW-06',
    verify: 'TW-07',
    delivery: 'TW-09',
  };

export function selectSuggestedLifecycleActivity(
  project: System3Project,
  lifecycle: readonly LifecyclePhaseView[] = buildLifecycleView(project)
): SuggestedLifecycleActivity {
  const activities = lifecycle.flatMap(item => item.activities);
  const activity = (id: string): LifecycleActivityView => {
    const found = activities.find(item => item.id === id);
    if (found === undefined) throw new Error(`Missing canonical Lifecycle Activity: ${id}`);
    return found;
  };
  const nextIncomplete = (): LifecycleActivityView =>
    activities.find(item => item.status !== 'completed') ?? activities.at(-1) ?? activity('OP-00');

  if (project.operation?.status === 'unknown') {
    return {
      activityId: activity(operationActivity[project.operation.type] ?? nextIncomplete().id).id,
      reason: 'unknown_operation',
    };
  }
  if (project.operation && ['accepted', 'running'].includes(project.operation.status)) {
    return {
      activityId: operationActivity[project.operation.type] ?? nextIncomplete().id,
      reason: 'active_operation',
    };
  }

  if (project.freshness !== 'current') {
    return { activityId: 'OP-01', reason: 'blocker' };
  }

  if (project.decisions.some(item => item.status === 'pending')) {
    return { activityId: 'TW-03', reason: 'pending_decision' };
  }
  if (project.readinessEvaluation?.status === 'data_required') {
    return { activityId: 'TW-03', reason: 'missing_data' };
  }

  const blocker = activities.find(item => item.status === 'blocked' || item.status === 'stale');
  if (blocker !== undefined) return { activityId: blocker.id, reason: 'blocker' };

  const understanding = activity('TW-02');
  if (project.intakeGate.ready && understanding.status !== 'completed') {
    return { activityId: understanding.id, reason: 'understanding' };
  }
  if (project.planCompiled && !project.manifestApproved) {
    return { activityId: 'OP-05', reason: 'approval' };
  }
  if (
    (project.verification?.modelReports.length ?? 0) > 0 ||
    project.verification?.experiment !== undefined
  ) {
    return { activityId: 'TW-07', reason: 'verification_results' };
  }
  return { activityId: nextIncomplete().id, reason: 'next_activity' };
}
