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
  /** Nothing is running and the next move is the user's (accept a draft, choose how to run). */
  awaitingUser?: boolean;
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
  awaitingUser: boolean;
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
    // Work that is done up to the user's move (a draft to accept, code awaiting a run choice).
    if (activity.status === 'active' || activity.awaitingUser) return total + 0.5;
    return total;
  }, 0);
  return Math.round((units / activities.length) * 100);
}

function phase(
  input: Omit<LifecyclePhaseView, 'status' | 'progress' | 'awaitingUser'>
): LifecyclePhaseView {
  const status = rollupStatus(input.activities);
  return {
    ...input,
    status,
    progress: progressOf(input.activities),
    awaitingUser:
      (status === 'active' || status === 'ready') &&
      input.activities.some(activity => activity.status === status && activity.awaitingUser),
  };
}

/**
 * One line for a stopped build: the step's own panel shows the full question or error text, so the
 * summary only says which it is (a question waits for the user, an error can be re-run).
 */
function failedBuildSummary(error: string | null): string {
  if (error?.startsWith('Cần bạn quyết định') === true)
    return 'Agent dừng lại hỏi bạn về một điểm trong blueprint.';
  const firstLine = error?.split('\n')[0]?.trim() ?? '';
  if (firstLine.length === 0) return 'Bước Xây dựng dừng vì lỗi; xem tiến trình rồi chạy lại.';
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine;
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
            ? 'Mọi nguồn đang dùng đã được kiểm tra ảnh hưởng.'
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
  // Also after a re-analysis (new source version): an older snapshot is still active, but the
  // project is back in understanding until the user accepts the new draft.
  const analysisInProgressOrAwaitingReview =
    project.stage === 'understanding' ||
    ((backendUnderstandingStatus === 'not_started' || backendUnderstandingStatus === 'ready') &&
      project.operation?.type === 'analyze' &&
      (project.operation.status === 'accepted' || project.operation.status === 'running'));
  const understandingStatus: PhaseStatus = analysisInProgressOrAwaitingReview
    ? 'active'
    : backendUnderstandingStatus;
  const analysisRunning =
    project.operation?.type === 'analyze' && project.operation.status !== 'succeeded';
  const understandingActivities: readonly LifecycleActivityView[] = [
    {
      id: 'TW-02',
      label: 'Hiểu dự án',
      shortLabel: 'Understand Project',
      description: 'Đọc các nguồn đã ghim và tạo bản hiểu dự án có thể truy ngược.',
      executionKind: 'workflow',
      status: understandingStatus,
      awaitingUser: analysisInProgressOrAwaitingReview && !analysisRunning,
      statusDetail:
        understandingStatus === 'completed'
          ? 'Bản hiểu dự án đã được chấp nhận và đang dùng.'
          : understandingStatus === 'stale'
            ? 'Nguồn đã đổi; bản hiểu dự án cần được tạo lại.'
            : analysisInProgressOrAwaitingReview
              ? analysisRunning
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
        ? 'Đã kiểm tra đủ điều kiện để lập kế hoạch.'
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
      description: 'Lập kế hoạch chạy chính xác từ bản hiểu và điều kiện đã kiểm tra.',
      executionKind: 'operation',
      status: operationStatus({
        complete: project.planCompiled,
        ready: project.readiness !== undefined,
        waiting: project.readiness === undefined,
      }),
      statusDetail: project.planCompiled
        ? 'Kế hoạch chạy đã được lập.'
        : project.readiness
          ? 'Đã đủ điều kiện; có thể lập kế hoạch.'
          : 'Chờ kiểm tra điều kiện.',
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
      awaitingUser: project.planCompiled && !project.manifestApproved,
      statusDetail: project.manifestApproved
        ? 'Bạn đã phê duyệt kế hoạch.'
        : project.planCompiled
          ? 'Kế hoạch đang chờ bạn xem và phê duyệt.'
          : 'Chờ lập kế hoạch.',
      input: 'Execution Plan chính xác và actor phê duyệt',
      output: 'Approval Manifest bất biến',
      technicalWorkflow: null,
      route: 'decisions',
      workflowSteps: [],
    },
  ];

  // Experiment mode: the code is built and waits for the user's run choice (plan 13 §10).
  const awaitingRunChoice =
    project.execution?.status === 'completed' &&
    project.experimentBuild?.executionId === project.execution.id;
  const buildStatus: PhaseStatus = awaitingRunChoice
    ? 'ready'
    : project.execution
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
      description:
        'Agent viết code, sandbox chạy thử và chạy các phương án đúng như kế hoạch đã duyệt.',
      executionKind: 'workflow',
      status: buildStatus,
      awaitingUser: awaitingRunChoice,
      statusDetail: awaitingRunChoice
        ? 'Code đã viết và kiểm thử trên mẫu; chọn phương án và cách chạy.'
        : project.execution
          ? project.execution.status === 'completed'
            ? project.verification?.status === 'completed'
              ? 'Đã chạy xong; Anvil đã chấm lại metric.'
              : 'Đã chạy xong; Anvil đang chấm lại kết quả.'
            : project.execution.status === 'failed'
              ? failedBuildSummary(project.execution.error)
              : 'Đang chạy trong sandbox cô lập.'
          : project.manifestApproved
            ? 'Kế hoạch đã duyệt và sẵn sàng thực thi.'
            : 'Chờ bạn phê duyệt kế hoạch.',
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
    : project.execution?.status === 'completed' && !awaitingRunChoice
      ? 'ready'
      : 'waiting';
  const verifyActivities: readonly LifecycleActivityView[] = [
    {
      id: 'TW-07',
      label: 'Xác minh kết quả độc lập',
      shortLabel: 'Verify',
      description: 'Anvil chấm lại kết quả bằng nhãn giữ riêng và gắn bằng chứng vào từng yêu cầu.',
      executionKind: 'workflow',
      status: verificationStatus,
      statusDetail: project.verification
        ? project.verification.status === 'completed'
          ? 'Đã chấm lại metric; xem kết quả và chọn phương án.'
          : project.verification.status === 'failed'
            ? (project.verification.error ?? 'Xác minh chưa đạt.')
            : 'Đang xác minh.'
        : 'Chờ bước Xây dựng chạy xong.',
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
      description: 'Kiểm tra kết quả đã xác minh trước khi bạn yêu cầu đóng gói.',
      executionKind: 'operation',
      status: operationStatus({
        complete: project.deliveryAvailable,
        ready: project.deliveryReady,
        waiting: !project.deliveryReady,
      }),
      awaitingUser: project.deliveryReady && !project.deliveryAvailable,
      statusDetail: project.deliveryAvailable
        ? 'Yêu cầu bàn giao đã được chấp nhận.'
        : project.deliveryReady
          ? 'Anvil đã chấm lại metric; bạn có thể yêu cầu bàn giao.'
          : 'Chờ xác minh đạt.',
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
      description: 'Tạo gói cố định kèm bản kê bàn giao từ kết quả đã xác minh.',
      executionKind: 'workflow',
      status: project.deliveryAvailable ? 'completed' : project.deliveryReady ? 'ready' : 'waiting',
      awaitingUser: project.deliveryReady && !project.deliveryAvailable,
      statusDetail: project.deliveryAvailable
        ? `Gói ${project.delivery?.packageFilename ?? ''} đã sẵn sàng tải xuống.`
        : project.deliveryReady
          ? 'Chờ bạn chọn phương án và yêu cầu tạo gói.'
          : 'Chờ yêu cầu bàn giao hợp lệ.',
      input: 'Immutable artifact + verification hiện hành',
      output: 'Delivery Package + Delivery Manifest',
      technicalWorkflow: 'system3-delivery',
      route: 'delivery',
      workflowSteps: [],
    },
  ];

  // While a (new) understanding is produced or awaits acceptance, every later step will be redone
  // on it: show them as waiting instead of the previous basis's results or failures.
  const afterUnderstanding = (
    activities: readonly LifecycleActivityView[]
  ): readonly LifecycleActivityView[] =>
    project.stage !== 'understanding'
      ? activities
      : activities.map(activity => ({
          ...activity,
          status: 'waiting' as const,
          awaitingUser: false,
          statusDetail: 'Chờ bản hiểu dự án mới được chấp nhận.',
        }));
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
      activities: afterUnderstanding(readinessActivities),
    }),
    phase({
      id: 'build',
      title: 'Xây dựng',
      eyebrow: 'Build',
      summary: 'Thực hiện đúng Project Workflow Version đã được phê duyệt.',
      objective: 'Tạo kết quả có thể tái lập trong môi trường thực thi được cô lập.',
      activities: afterUnderstanding(buildActivities),
    }),
    phase({
      id: 'verify',
      title: 'Xác minh',
      eyebrow: 'Verify',
      summary: 'Kiểm tra kết quả độc lập bằng bằng chứng thay vì chỉ tin trạng thái chạy.',
      objective: 'Phân biệt execution thành công với kết quả thực sự đáp ứng yêu cầu.',
      activities: afterUnderstanding(verifyActivities),
    }),
    phase({
      id: 'delivery',
      title: 'Bàn giao',
      eyebrow: 'Delivery',
      summary: 'Chỉ đóng gói và bàn giao kết quả đã được xác minh.',
      objective: 'Tạo package bất biến cùng manifest và hướng dẫn có thể đối soát.',
      activities: afterUnderstanding(deliveryActivities),
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
    project.execution?.status === 'completed' &&
    project.experimentBuild?.executionId === project.execution.id
  ) {
    return { activityId: 'TW-06', reason: 'next_activity' };
  }
  if (
    (project.verification?.modelReports.length ?? 0) > 0 ||
    project.verification?.experiment !== undefined
  ) {
    return { activityId: 'TW-07', reason: 'verification_results' };
  }
  return { activityId: nextIncomplete().id, reason: 'next_activity' };
}
