import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileCheck2,
  FileInput,
  FolderKanban,
  GitCompareArrows,
  GitBranch,
  LayoutDashboard,
  Layers3,
  LockKeyhole,
  Moon,
  PackageCheck,
  PanelLeftClose,
  Play,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload,
  Workflow,
  X,
} from 'lucide-react';
import { createElement, useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router';
import { listSystem3Projects, type System3ProjectResponse } from '@/lib/api';
import {
  buildLifecycleView,
  completedLifecyclePhaseCount,
  type LifecycleActivityView,
  type LifecyclePhaseView,
} from './lifecycle-view';
import { System3SourceIntakeRequestError, system3Store, useSystem3Project } from './store';
import { InlineResourceViewer, ResourceList } from './ResourceViewer';
import type {
  PhaseStatus,
  System3ActivityResourceView,
  System3Phase,
  System3ResourceDescriptor,
  System3SourceIntakeReportView,
  System3SourceKind,
  System3SourceRole,
} from './types';
import './system3.css';

const NAV_ITEMS = [
  { to: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
  { to: 'flow', label: 'Vòng đời dự án', icon: LayoutDashboard },
  { to: 'sources', label: 'Nguồn đầu vào', icon: FolderKanban },
  { to: 'evidence', label: 'Kết quả & Bằng chứng', icon: Layers3 },
  { to: 'decisions', label: 'Quyết định & Phê duyệt', icon: CircleHelp },
  { to: 'delivery', label: 'Bàn giao', icon: PackageCheck },
] as const;

function Shell({ children }: { children: ReactElement }): ReactElement {
  const [dark, setDark] = useState(() => {
    try {
      return window.localStorage.getItem('anvil.system3.theme') === 'dark';
    } catch {
      return false;
    }
  });
  return (
    <div className={`system3-root ${dark ? 's3-dark' : ''}`}>
      <a className="s3-skip-link" href="#main-content" aria-label="Skip to main content">
        Chuyển tới nội dung chính
      </a>
      <header className="s3-topbar">
        <Link to="/console/projects" className="s3-brand">
          <span className="s3-brand-mark">A</span>
          <span>Anvil Projects</span>
        </Link>
        <div className="s3-top-actions">
          <span>Customer Churn Reference</span>
          <span>•</span>
          <span>Project control plane</span>
          <button
            type="button"
            className="s3-theme-button"
            aria-label={dark ? 'Dùng giao diện sáng' : 'Dùng giao diện tối'}
            onClick={() => {
              const next = !dark;
              setDark(next);
              try {
                window.localStorage.setItem('anvil.system3.theme', next ? 'dark' : 'light');
              } catch {
                // Theme persistence is optional; the in-memory preference still works.
              }
            }}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}

function ProjectNav(): ReactElement {
  const project = useSystem3Project();
  const pending = project.decisions.filter(decision => decision.status === 'pending').length;
  const approvalAttention =
    pending === 0 && project.readiness !== undefined && !project.manifestApproved ? 1 : 0;
  const decisionAttention = pending + approvalAttention;
  return (
    <nav className="s3-nav" aria-label="Điều hướng Anvil Project">
      <div className="s3-project-name">{project.name}</div>
      {NAV_ITEMS.map(item => {
        return (
          <NavLink
            key={item.to}
            to={`/console/projects/${project.id}/${item.to}`}
            className={({ isActive }) => (isActive ? 's3-active' : '')}
          >
            <span className="flex items-center gap-2">
              {createElement(item.icon, { size: 16 })} {item.label}
            </span>
            {item.to === 'decisions' && decisionAttention > 0 ? (
              <span className="s3-nav-badge">{decisionAttention}</span>
            ) : null}
          </NavLink>
        );
      })}
      <NavLink
        className={({ isActive }) => `s3-nav-technical ${isActive ? 's3-active' : ''}`}
        to={`/console/projects/${project.id}/technical`}
      >
        <span className="flex items-center gap-2">
          <PanelLeftClose size={16} /> Technical Console
        </span>
        <ChevronRight size={15} />
      </NavLink>
    </nav>
  );
}

function Workspace({ children }: { children: ReactElement }): ReactElement {
  const { projectId } = useParams();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (projectId === undefined) {
      setLoading(false);
      setLoadError('Project ID không hợp lệ');
      return;
    }
    let active = true;
    setLoading(true);
    setLoadError(null);
    void system3Store
      .load(projectId)
      .catch(error => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Không thể tải project');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return (): void => {
      active = false;
    };
  }, [projectId]);
  return (
    <Shell>
      <div className="s3-shell">
        {loading ? (
          <main className="s3-main" id="main-content">
            <p className="s3-note">Đang tải Project Flow…</p>
          </main>
        ) : loadError !== null ? (
          <main className="s3-main" id="main-content">
            <p className="s3-note" role="alert" aria-live="assertive">
              {loadError}
            </p>
            <Link className="s3-button no-underline" to="/console/projects">
              Quay lại projects
            </Link>
          </main>
        ) : (
          <>
            <ProjectNav />
            <main className="s3-main" id="main-content">
              {children}
            </main>
          </>
        )}
      </div>
    </Shell>
  );
}

function ProjectHeader({
  showPrimaryAction = true,
}: {
  showPrimaryAction?: boolean;
}): ReactElement {
  const project = useSystem3Project();
  const navigate = useNavigate();
  const [analyzing, setAnalyzing] = useState(false);
  const [runningReadiness, setRunningReadiness] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const pending = project.decisions.filter(decision => decision.status === 'pending').length;
  const lifecycle = buildLifecycleView(project);
  const completed = completedLifecyclePhaseCount(lifecycle);
  const activeSourceCount = new Set(
    project.sources.filter(source => source.status === 'ready').map(source => source.sourceId)
  ).size;
  const primary = (): { label: string; action: () => void; disabled?: boolean } => {
    if (project.operation?.status === 'unknown')
      return {
        label: abandoning ? 'Đang đóng execution…' : 'Xử lý execution không xác định',
        action: (): void => {
          const confirmed = window.confirm(
            'Thao tác này sẽ đánh dấu WorkflowRun hiện tại là cancelled và đưa project về trạng thái đã approve. Chỉ tiếp tục khi bạn đã kiểm tra Technical Console và chắc chắn process cũ không còn chạy.'
          );
          if (!confirmed) return;
          setAbandoning(true);
          setHeaderError(null);
          void system3Store
            .abandonUnknownOperation()
            .catch(error => {
              setHeaderError(
                error instanceof Error ? error.message : 'Không thể đóng execution không xác định'
              );
            })
            .finally(() => {
              setAbandoning(false);
            });
        },
        disabled: abandoning,
      };
    if (!project.intakeGate.ready)
      return {
        label: 'Hoàn tất phase Tiếp nhận',
        action: () => navigate(`/console/projects/${project.id}/sources`),
      };
    if (project.freshness !== 'current')
      return {
        label: analyzing ? 'Đang phân tích lại…' : 'Phân tích lại sources',
        action: (): void => {
          setAnalyzing(true);
          setHeaderError(null);
          void system3Store
            .analyze()
            .catch(error => {
              setHeaderError(
                error instanceof Error ? error.message : 'Không thể phân tích lại sources'
              );
            })
            .finally(() => {
              setAnalyzing(false);
            });
        },
        disabled: analyzing,
      };
    if (pending > 0)
      return {
        label: `Xử lý ${pending.toString()} quyết định`,
        action: () => navigate(`/console/projects/${project.id}/decisions`),
      };
    if (!project.readiness)
      return {
        label: runningReadiness ? 'Đang khóa readiness…' : 'Chạy readiness contract',
        action: (): void => {
          setRunningReadiness(true);
          setHeaderError(null);
          void system3Store
            .runReadiness()
            .catch(error => {
              setHeaderError(
                error instanceof Error ? error.message : 'Không thể tạo readiness contract'
              );
            })
            .finally(() => {
              setRunningReadiness(false);
            });
        },
        disabled: runningReadiness,
      };
    if (!project.planCompiled)
      return {
        label: 'Chuẩn bị Execution Plan',
        action: () => navigate(`/console/projects/${project.id}/decisions`),
      };
    if (!project.manifestApproved)
      return {
        label: 'Xem và phê duyệt kế hoạch',
        action: () => navigate(`/console/projects/${project.id}/decisions`),
      };
    if (project.deliveryAvailable)
      return {
        label: 'Xem delivery đã tạo',
        action: () => navigate(`/console/projects/${project.id}/delivery`),
      };
    if (project.deliveryReady)
      return {
        label: 'Review yêu cầu bàn giao',
        action: () => navigate(`/console/projects/${project.id}/delivery`),
      };
    if (
      executing ||
      project.operation?.status === 'accepted' ||
      project.operation?.status === 'running' ||
      project.execution?.status === 'running'
    )
      return {
        label: 'Đang chạy baseline…',
        action: () => navigate(`/console/projects/${project.id}/technical`),
        disabled: true,
      };
    if (project.stage === 'approved')
      return {
        label: 'Chạy baseline MVP',
        action: (): void => {
          setExecuting(true);
          setHeaderError(null);
          void system3Store
            .execute()
            .catch(error => {
              setHeaderError(
                error instanceof Error ? error.message : 'Không thể thực thi baseline MVP'
              );
            })
            .finally(() => {
              setExecuting(false);
            });
        },
      };
    return { label: 'Đang chuẩn bị', action: () => undefined, disabled: true };
  };
  const action = primary();
  return (
    <header className="s3-workspace-header s3-workspace-header-compact">
      <div className="s3-header-main">
        <div>
          <p className="s3-kicker">Customer Churn Reference</p>
          <h1>{project.name}</h1>
          <p>
            {project.description} · {project.workflowVersion}
          </p>
        </div>
        {showPrimaryAction ? (
          <button
            type="button"
            className="s3-button"
            onClick={action.action}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        ) : null}
      </div>
      <div className="s3-compact-context" aria-label="Tóm tắt trạng thái project">
        <span>
          <strong>{completed.toString()}/6</strong> phase hoàn tất
        </span>
        <span>
          <strong>{activeSourceCount.toString()}</strong> nguồn đang dùng
        </span>
        <span className={pending > 0 ? 'needs-attention' : ''}>
          <strong>{pending.toString()}</strong> quyết định cần xử lý
        </span>
        <span className={project.freshness === 'current' ? '' : 'needs-attention'}>
          {project.freshness === 'current' ? 'Dữ liệu hiện hành' : 'Cần phân tích lại'}
        </span>
      </div>
      {headerError !== null ? (
        <p className="s3-note" role="alert" aria-live="assertive">
          {headerError}
        </p>
      ) : null}
    </header>
  );
}

function phaseGlyph(status: PhaseStatus): string {
  if (status === 'completed') return '✓';
  if (status === 'blocked') return '!';
  if (status === 'active') return '•';
  if (status === 'ready') return '→';
  if (status === 'stale') return '↻';
  if (status === 'out_of_mvp_scope') return '—';
  if (status === 'not_verified') return '?';
  return '○';
}

function phaseStatusLabel(status: PhaseStatus): string {
  if (status === 'completed') return 'Đã hoàn tất';
  if (status === 'blocked') return 'Đang bị chặn';
  if (status === 'active') return 'Đang chạy';
  if (status === 'ready') return 'Sẵn sàng';
  if (status === 'stale') return 'Cần chạy lại';
  if (status === 'waiting') return 'Đang chờ';
  if (status === 'out_of_mvp_scope') return 'Ngoài phạm vi MVP';
  if (status === 'not_verified') return 'Chưa xác minh';
  return 'Chưa bắt đầu';
}

function OverviewPage(): ReactElement {
  const project = useSystem3Project();
  const lifecycle = buildLifecycleView(project);
  const completed = completedLifecyclePhaseCount(lifecycle);
  const pendingDecisions = project.decisions.filter(value => value.status === 'pending').length;
  const currentPhase = lifecycle.find(item => item.status !== 'completed') ?? lifecycle.at(-1);
  const nextActivity =
    currentPhase?.activities.find(activity => activity.status !== 'completed') ??
    currentPhase?.activities[0];
  const nextRoute =
    project.operation?.status === 'unknown' ? 'technical' : (nextActivity?.route ?? 'flow');
  const attentionItems = [
    ...(!project.intakeGate.ready
      ? ['Phase Tiếp nhận chưa đạt gate; cần hoàn tất bộ nguồn trước khi phân tích.']
      : []),
    ...(project.freshness !== 'current'
      ? ['Nguồn đã thay đổi; một số kết quả cần được phân tích hoặc xác minh lại.']
      : []),
    ...(pendingDecisions > 0
      ? [`${pendingDecisions.toString()} Decision đang chờ bạn trả lời.`]
      : []),
    ...(project.operation?.status === 'unknown'
      ? ['Có execution không xác định; hãy kiểm tra Technical Console trước khi xử lý.']
      : []),
  ];
  return (
    <Workspace>
      <div className="s3-page-card">
        <ProjectHeader showPrimaryAction={false} />
        <div className="s3-overview-command-grid">
          <section className="s3-overview-command" aria-labelledby="overview-next-title">
            <p className="s3-kicker">Việc nên làm tiếp theo</p>
            <span className={`s3-status-badge ${nextActivity?.status ?? 'waiting'}`}>
              {phaseStatusLabel(nextActivity?.status ?? 'waiting')}
            </span>
            <h2 id="overview-next-title">
              {project.operation?.status === 'unknown'
                ? 'Kiểm tra execution không xác định'
                : (nextActivity?.label ?? 'Project Lifecycle đã hoàn tất')}
            </h2>
            <p>
              {project.operation?.status === 'unknown'
                ? 'Anvil không tự thay đổi trạng thái của công việc có thể đang chạy ở process khác.'
                : (nextActivity?.statusDetail ??
                  'Mở Vòng đời dự án để kiểm tra toàn bộ kết quả và lịch sử.')}
            </p>
            <div className="s3-overview-command-meta">
              <span>
                {currentPhase?.title ?? 'Hoàn tất'} · {completed.toString()}/6 phase hoàn tất
              </span>
              {nextActivity ? <span>{nextActivity.id}</span> : null}
            </div>
            <Link
              className="s3-button no-underline"
              to={`/console/projects/${project.id}/${nextRoute}`}
            >
              {nextActivity ? activityActionLabel(nextActivity) : 'Xem Vòng đời dự án'}
              <ArrowRight size={15} />
            </Link>
          </section>

          <aside className="s3-overview-attention" aria-labelledby="overview-attention-title">
            <div>
              <p className="s3-kicker">Cần chú ý</p>
              <h2 id="overview-attention-title">
                {attentionItems.length > 0 ? 'Trước khi đi tiếp' : 'Project đang ổn định'}
              </h2>
            </div>
            {attentionItems.length > 0 ? (
              <ul>
                {attentionItems.map(item => (
                  <li key={item}>
                    <CircleHelp size={16} /> <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Không có blocker cấp project. Bạn có thể tiếp tục activity đang được đề xuất.</p>
            )}
          </aside>
        </div>

        <section className="s3-overview-journey" aria-labelledby="overview-journey-title">
          <header>
            <div>
              <p className="s3-kicker">Project Lifecycle</p>
              <h2 id="overview-journey-title">Tiến độ sáu giai đoạn</h2>
            </div>
            <Link to={`/console/projects/${project.id}/flow`}>
              Xem 10 activity <ArrowRight size={14} />
            </Link>
          </header>
          <ol>
            {lifecycle.map((phase, index) => (
              <li key={phase.id} className={phase.status}>
                <span>{(index + 1).toString().padStart(2, '0')}</span>
                <div>
                  <strong>{phase.title}</strong>
                  <small>{phaseStatusLabel(phase.status)}</small>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Workspace>
  );
}

function FlowPage(): ReactElement {
  const project = useSystem3Project();
  const lifecycle = buildLifecycleView(project);
  const nextPhase = lifecycle.find(item => item.status !== 'completed') ?? lifecycle.at(-1);
  const suggestedActivityId =
    nextPhase?.activities.find(activity => activity.status !== 'completed')?.id ??
    nextPhase?.activities[0]?.id ??
    'OP-00';
  const selectionWasExplicit = useRef(false);
  const [selectedActivityId, setSelectedActivityId] = useState<string>(suggestedActivityId);
  const selected =
    lifecycle.find(phase =>
      phase.activities.some(activity => activity.id === selectedActivityId)
    ) ?? lifecycle[0];
  const selectedActivity = selected?.activities.find(
    activity => activity.id === selectedActivityId
  );
  const pendingDecisionCount = project.decisions.filter(
    decision => decision.status === 'pending'
  ).length;
  const selectedActivityOwnsPrimaryAction =
    (selectedActivity !== undefined && selectedActivity.route !== 'flow') ||
    (!project.intakeGate.ready && selectedActivityId === 'OP-00') ||
    (project.intakeGate.ready &&
      project.freshness === 'current' &&
      pendingDecisionCount > 0 &&
      selectedActivityId === 'TW-03') ||
    (project.intakeGate.ready &&
      project.freshness === 'current' &&
      pendingDecisionCount === 0 &&
      project.readiness !== undefined &&
      !project.planCompiled &&
      selectedActivityId === 'OP-04') ||
    (project.planCompiled && !project.manifestApproved && selectedActivityId === 'OP-05');
  useEffect(() => {
    if (!selectionWasExplicit.current) setSelectedActivityId(suggestedActivityId);
  }, [project.id, suggestedActivityId]);
  if (selected === undefined) {
    return (
      <Workspace>
        <div aria-hidden="true" />
      </Workspace>
    );
  }
  return (
    <Workspace>
      <>
        <ProjectHeader showPrimaryAction={!selectedActivityOwnsPrimaryAction} />
        <section className="s3-lifecycle-workspace" aria-labelledby="project-lifecycle-title">
          <header className="s3-lifecycle-toolbar">
            <div>
              <p className="s3-kicker">Project Lifecycle</p>
              <h2 id="project-lifecycle-title">Vòng đời dự án</h2>
              <p>Chọn một hoạt động. Mọi đầu vào, kết quả và việc cần làm nằm cùng một chỗ.</p>
            </div>
            <div className="s3-lifecycle-legend" aria-label="Chú thích loại hoạt động">
              <span>
                <LockKeyhole size={14} /> OP · thao tác backend
              </span>
              <span>
                <Workflow size={14} /> TW · quy trình kỹ thuật
              </span>
            </div>
          </header>
          <div className="s3-lifecycle-layout">
            <nav
              className="s3-lifecycle-rail"
              aria-label="6 giai đoạn và 10 hoạt động vòng đời dự án"
            >
              {lifecycle.map((phase, index) => (
                <section
                  key={phase.id}
                  className={`s3-lifecycle-rail-phase ${selected.id === phase.id ? 'selected' : ''}`}
                  aria-labelledby={`lifecycle-phase-${phase.id}`}
                >
                  <div className="s3-lifecycle-rail-heading">
                    <span className={`s3-phase-marker ${phase.status}`} aria-hidden="true">
                      {phaseGlyph(phase.status)}
                    </span>
                    <span>
                      <small>{(index + 1).toString().padStart(2, '0')}</small>
                      <strong id={`lifecycle-phase-${phase.id}`}>{phase.title}</strong>
                    </span>
                    <span className="s3-rail-phase-status">{phaseStatusLabel(phase.status)}</span>
                  </div>
                  <div className="s3-lifecycle-rail-activities">
                    {phase.activities.map(activity => (
                      <button
                        key={activity.id}
                        type="button"
                        className={selectedActivityId === activity.id ? 'selected' : ''}
                        aria-current={selectedActivityId === activity.id ? 'step' : undefined}
                        onClick={() => {
                          selectionWasExplicit.current = true;
                          setSelectedActivityId(activity.id);
                        }}
                      >
                        <span>{activity.id}</span>
                        <strong>{activity.label}</strong>
                        <i className={`s3-rail-status-dot ${activity.status}`} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </nav>
            <LifecyclePhaseDetail
              phase={selected}
              projectId={project.id}
              selectedActivityId={selectedActivityId}
            />
          </div>
        </section>
      </>
    </Workspace>
  );
}

function PlanReviewDialog({ onClose }: { onClose: () => void }): ReactElement {
  const project = useSystem3Project();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  useEffect(() => {
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleDialogKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', handleDialogKey);
    return (): void => {
      window.removeEventListener('keydown', handleDialogKey);
      previouslyFocusedRef.current?.focus();
    };
  }, [onClose]);
  return (
    <div className="s3-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="s3-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-review-title"
        onMouseDown={event => {
          event.stopPropagation();
        }}
      >
        <header className="s3-dialog-head">
          <div>
            <p className="s3-kicker">Approval manifest</p>
            <h2 id="plan-review-title">Review kế hoạch trước khi build</h2>
            <p>Approval sẽ pin chính xác workflow, nguồn, runtime profile và plan hash dưới đây.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="s3-icon-button"
            onClick={onClose}
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </header>
        <div className="s3-dialog-body">
          <div className="s3-review-grid">
            <ReviewItem label="Product workflow" value={project.workflowVersion} />
            <ReviewItem
              label="Input snapshot"
              value={`${(project.compilation?.inputSourceCount ?? 0).toString()} source đã pin`}
            />
            <ReviewItem
              label="Execution plan"
              value={project.compilation?.definitionHash ?? 'Chưa compile'}
              mono
            />
            <ReviewItem label="Runtime" value={project.compilation?.runtime ?? 'Chưa xác định'} />
            <ReviewItem
              label="Rerun scope"
              value={
                project.compilation?.rerunMode === 'scoped'
                  ? `Scoped ${project.compilation.executionMode} · ${project.compilation.affectedPhases.join(' · ')}`
                  : 'Full baseline flow'
              }
            />
            <ReviewItem
              label="Artifact reuse"
              value={
                (project.compilation?.reusedArtifactCount ?? 0) > 0
                  ? `${String(project.compilation?.reusedArtifactCount)} artifact đã pin bằng hash`
                  : 'Không tái sử dụng artifact'
              }
            />
          </div>
          <section className="s3-section">
            <h3>Phạm vi được phép thực thi</h3>
            <ul className="s3-check-list">
              {project.compilation?.executionMode === 'full' ? (
                <li>
                  <Check size={15} /> Sinh project Python trong vùng artifact cô lập của run
                </li>
              ) : (
                <li>
                  <Check size={15} /> Kiểm hash và materialize đúng artifact đã approve
                </li>
              )}
              {project.compilation?.executionMode !== 'delivery' ? (
                <li>
                  <Check size={15} /> Chạy test, data pipeline và baseline experiment
                </li>
              ) : null}
              <li>
                <Check size={15} /> Đóng gói artifact; không deploy hoặc push tự động
              </li>
            </ul>
            {(project.compilation?.skippedPhases.length ?? 0) > 0 ? (
              <p className="s3-note">
                Phase được bỏ qua có chủ đích: {project.compilation?.skippedPhases.join(' · ')}.
                Output được tái sử dụng vẫn phải vượt qua content-hash preflight.
              </p>
            ) : null}
          </section>
          <div className="s3-note">
            Explainability và 13 product requirements vẫn cần evidence thật. Approval này không biến
            scope gap thành verified.
          </div>
          {submitError !== null ? (
            <p className="s3-note" role="alert" aria-live="assertive">
              {submitError}
            </p>
          ) : null}
        </div>
        <footer className="s3-dialog-actions">
          <button type="button" className="s3-button s3-button-secondary" onClick={onClose}>
            Quay lại chỉnh sửa
          </button>
          <button
            type="button"
            className="s3-button"
            disabled={submitting || project.compilation === undefined}
            onClick={() => {
              setSubmitting(true);
              setSubmitError(null);
              void system3Store
                .approve()
                .then(onClose)
                .catch(error => {
                  setSubmitError(
                    error instanceof Error ? error.message : 'Không thể approve manifest'
                  );
                })
                .finally(() => {
                  setSubmitting(false);
                });
            }}
          >
            <ShieldCheck size={15} className="mr-1 inline" />
            {submitting ? 'Đang approve…' : 'Approve manifest'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ReviewItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): ReactElement {
  return (
    <div className="s3-review-item">
      <span>{label}</span>
      <strong className={mono ? 'font-mono' : ''}>{value}</strong>
    </div>
  );
}

function activityIcon(activityId: string): ReactElement {
  if (activityId === 'OP-00') return <FileInput size={18} />;
  if (activityId === 'OP-01') return <GitCompareArrows size={18} />;
  if (activityId === 'TW-02') return <SearchCheck size={18} />;
  if (activityId === 'OP-05') return <LockKeyhole size={18} />;
  if (activityId === 'TW-07') return <ShieldCheck size={18} />;
  if (activityId === 'OP-08' || activityId === 'TW-09') return <PackageCheck size={18} />;
  return <Workflow size={18} />;
}

function activityActionLabel(activity: LifecycleActivityView): string {
  if (activity.id === 'OP-00' || activity.id === 'OP-01') return 'Mở trung tâm nguồn';
  if (activity.id === 'OP-04') return 'Chuẩn bị Execution Plan';
  if (activity.id === 'OP-05') return 'Xem và phê duyệt kế hoạch';
  if (activity.route === 'decisions') return 'Xử lý các quyết định';
  if (activity.route === 'evidence') return 'Xem bằng chứng';
  if (activity.route === 'delivery') return 'Mở khu vực bàn giao';
  if (activity.route === 'technical') return 'Theo dõi lần chạy kỹ thuật';
  return 'Mở chi tiết activity';
}

function activityAsTechnicalPhase(
  phase: LifecyclePhaseView,
  activity: LifecycleActivityView
): System3Phase {
  return {
    id: activity.id.toLowerCase(),
    title: `${activity.id} — ${activity.label}`,
    summary: activity.description,
    technicalWorkflow: activity.technicalWorkflow ?? 'Control-plane operation',
    status: activity.status,
    progress:
      activity.status === 'completed' || activity.status === 'stale'
        ? 100
        : activity.status === 'active'
          ? 55
          : 0,
    objective: phase.objective,
    inputs: [activity.input],
    outputs: [activity.output],
    workflowSteps: activity.workflowSteps,
  };
}

function ActivityResourceSection({
  title,
  description,
  resources,
  empty,
  onOpen,
}: {
  title: string;
  description: string;
  resources: readonly System3ResourceDescriptor[];
  empty: string;
  onOpen: (resource: System3ResourceDescriptor, opener: HTMLElement) => void;
}): ReactElement {
  return (
    <section className="s3-activity-resource-section">
      <header>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span>{resources.length.toString()}</span>
      </header>
      <ResourceList resources={resources} empty={empty} onOpen={onOpen} />
    </section>
  );
}

function LifecyclePhaseDetail({
  phase,
  projectId,
  selectedActivityId,
}: {
  phase: LifecyclePhaseView;
  projectId: string;
  selectedActivityId: string;
}): ReactElement {
  const [activityView, setActivityView] = useState<System3ActivityResourceView | null>(null);
  const [activityViewError, setActivityViewError] = useState<string | null>(null);
  const [activityViewLoading, setActivityViewLoading] = useState(false);
  const [selectedResource, setSelectedResource] = useState<System3ResourceDescriptor | null>(null);
  const [resourceOpener, setResourceOpener] = useState<HTMLElement | null>(null);
  const selectedActivity =
    phase.activities.find(activity => activity.id === selectedActivityId) ?? phase.activities[0];
  const selectedActivityIdForRequest = selectedActivity?.id ?? '';
  useEffect(() => {
    if (selectedActivityIdForRequest === '') return undefined;
    const controller = new AbortController();
    setActivityViewLoading(true);
    setActivityViewError(null);
    setActivityView(null);
    setSelectedResource(null);
    void fetch(
      `/api/system3/projects/${encodeURIComponent(projectId)}/activities/${encodeURIComponent(selectedActivityIdForRequest)}`,
      { signal: controller.signal }
    )
      .then(async response => {
        if (!response.ok)
          throw new Error(`Không thể tải tài nguyên (${response.status.toString()})`);
        return response.json() as Promise<System3ActivityResourceView>;
      })
      .then(setActivityView)
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setActivityViewError(error instanceof Error ? error.message : 'Không thể tải tài nguyên');
      })
      .finally(() => {
        if (!controller.signal.aborted) setActivityViewLoading(false);
      });
    return (): void => {
      controller.abort();
    };
  }, [projectId, selectedActivityIdForRequest]);
  if (selectedActivity === undefined) return <div aria-hidden="true" />;
  const route = `/console/projects/${projectId}/${selectedActivity.route}`;
  const technicalPhase = activityAsTechnicalPhase(phase, selectedActivity);
  const openResource = (resource: System3ResourceDescriptor, opener: HTMLElement): void => {
    setResourceOpener(opener);
    setSelectedResource(resource);
  };
  const inputs = activityView?.inputs ?? [];
  const outputs = activityView?.outputs ?? [];
  const evidence = activityView?.evidence ?? [];
  const technicalResources = activityView?.technicalResources ?? [];
  return (
    <>
      <article className="s3-activity-workspace" aria-labelledby="selected-activity-title">
        <header className="s3-activity-workspace-header">
          <div className="s3-activity-workspace-title">
            <span
              className={`s3-activity-icon ${selectedActivity.executionKind}`}
              aria-hidden="true"
            >
              {activityIcon(selectedActivity.id)}
            </span>
            <div>
              <p className="s3-activity-code">
                {selectedActivity.id} ·{' '}
                {selectedActivity.executionKind === 'operation'
                  ? 'Thao tác backend'
                  : 'Quy trình kỹ thuật'}
              </p>
              <h2 id="selected-activity-title">{selectedActivity.label}</h2>
              <p>{selectedActivity.description}</p>
            </div>
          </div>
          <div className="s3-activity-workspace-actions">
            <span className={`s3-status-badge ${selectedActivity.status}`}>
              {phaseStatusLabel(selectedActivity.status)}
            </span>
            <Link className="s3-button no-underline" to={route}>
              {activityActionLabel(selectedActivity)} <ArrowRight size={15} />
            </Link>
          </div>
        </header>

        <section className={`s3-next-action ${selectedActivity.status}`} aria-live="polite">
          <div>
            <span>Trạng thái và việc cần làm</span>
            <strong>{selectedActivity.statusDetail}</strong>
          </div>
          <small>
            Phase {phase.eyebrow} · {phase.title} · {phase.progress.toString()}% hoàn thành
          </small>
        </section>

        {selectedActivity.legacy ? (
          <div className="s3-legacy-inline">
            <Clock3 size={16} />
            <span>Nguồn cũ được giữ nguyên, nhưng không có báo cáo OP-00 lịch sử.</span>
          </div>
        ) : null}

        <dl className="s3-activity-brief">
          <div>
            <dt>Đầu vào chính</dt>
            <dd>{selectedActivity.input}</dd>
          </div>
          <div>
            <dt>Kết quả chính</dt>
            <dd>{selectedActivity.output}</dd>
          </div>
          <div>
            <dt>Cách Anvil thực hiện</dt>
            <dd>
              {selectedActivity.executionKind === 'operation'
                ? 'Backend xử lý theo quy tắc; không tạo Workflow Run mặc định.'
                : `Anvil Workflow Runtime · ${selectedActivity.technicalWorkflow ?? 'workflow đã đăng ký'}`}
            </dd>
          </div>
        </dl>

        {activityViewLoading ? (
          <p className="s3-resource-loading" role="status" aria-live="polite">
            Đang tải đầu vào và kết quả của activity…
          </p>
        ) : null}
        {activityViewError === null ? null : (
          <p className="s3-note" role="alert" aria-live="assertive">
            {activityViewError}
          </p>
        )}

        <div className="s3-activity-resource-grid">
          <ActivityResourceSection
            title="Đầu vào đã dùng"
            description="Đúng phiên bản Anvil đã cố định cho bước này."
            resources={inputs}
            empty="Chưa có đầu vào được lưu."
            onOpen={openResource}
          />
          <ActivityResourceSection
            title="Kết quả đã tạo"
            description={
              selectedActivity.id === 'OP-01'
                ? 'Chỉ hiển thị báo cáo của lần kiểm tra gần nhất.'
                : 'Báo cáo và kết quả mở xem trực tiếp tại đây.'
            }
            resources={outputs}
            empty="Bước này chưa tạo kết quả."
            onOpen={openResource}
          />
          <ActivityResourceSection
            title="Bằng chứng"
            description="Thông tin dùng để xác minh yêu cầu hoặc kết luận."
            resources={evidence}
            empty="Bước này chưa có bằng chứng riêng."
            onOpen={openResource}
          />
        </div>

        {activityView !== null ? (
          <details className="s3-secondary-details">
            <summary>
              <span>
                <Clock3 size={16} /> Lịch sử hoạt động ({activityView.history.length.toString()})
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </summary>
            {activityView.history.length === 0 ? (
              <p className="s3-resource-empty">Chưa có lịch sử được ghi nhận.</p>
            ) : (
              <ol className="s3-activity-history">
                {activityView.history.map(item => (
                  <li key={item.id}>
                    <span />
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                      <small>
                        {item.createdAt === null
                          ? item.status
                          : `${new Date(item.createdAt).toLocaleString('vi-VN')} · ${item.status}`}
                      </small>
                      {item.resource === undefined || item.resource === null ? null : (
                        <button
                          type="button"
                          className="s3-button s3-button-secondary"
                          onClick={event => {
                            if (item.resource !== undefined && item.resource !== null) {
                              openResource(item.resource, event.currentTarget);
                            }
                          }}
                        >
                          Xem báo cáo này
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </details>
        ) : null}

        {technicalResources.length > 0 ? (
          <details className="s3-technical-drilldown">
            <summary>
              <span>
                <GitCompareArrows size={16} /> Thông tin kỹ thuật dùng khi kiểm tra
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </summary>
            <p className="s3-note">
              Số quan hệ, mức độ đầy đủ và đường ảnh hưởng được OP-01 sử dụng. Đây không phải tệp
              nguồn do người dùng tải lên.
            </p>
            <ResourceList resources={technicalResources} empty="" onOpen={openResource} />
          </details>
        ) : null}

        {selectedActivity.executionKind === 'workflow' &&
        selectedActivity.workflowSteps.length > 0 ? (
          <details className="s3-technical-drilldown">
            <summary>
              <span>
                <Workflow size={16} /> Node và lần chạy kỹ thuật
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </summary>
            <PhaseDetail phase={technicalPhase} projectId={projectId} />
          </details>
        ) : null}

        <p className="s3-inspector-footnote">
          ID, hash, JSON và log chỉ xuất hiện khi bạn chủ động mở thông tin kỹ thuật.
        </p>
      </article>
      {selectedResource === null ? null : (
        <InlineResourceViewer
          projectId={projectId}
          resource={selectedResource}
          opener={resourceOpener}
          onClose={() => {
            setSelectedResource(null);
          }}
        />
      )}
    </>
  );
}

function workflowStepGlyph(kind: System3Phase['workflowSteps'][number]['kind']): string {
  if (kind === 'input') return 'IN';
  if (kind === 'agent') return 'AI';
  if (kind === 'check') return '✓';
  if (kind === 'artifact') return 'OUT';
  return 'OK';
}

function workflowStepKindLabel(kind: System3Phase['workflowSteps'][number]['kind']): string {
  if (kind === 'input') return 'Đầu vào';
  if (kind === 'agent') return 'Agent';
  if (kind === 'check') return 'Kiểm tra';
  if (kind === 'artifact') return 'Artifact';
  return 'Phê duyệt';
}

function PhaseDetail({
  phase,
  projectId,
}: {
  phase: System3Phase;
  projectId: string;
}): ReactElement {
  const [tab, setTab] = useState<'workflow' | 'overview' | 'run' | 'activity'>('workflow');
  const [selectedStepId, setSelectedStepId] = useState(phase.workflowSteps[0]?.id ?? '');
  const [activity, setActivity] = useState<
    { id: string; fromStage: string | null; toStage: string; reason: string; createdAt: string }[]
  >([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const response = await fetch(`/api/system3/projects/${projectId}/history`);
        if (!response.ok) throw new Error('Không thể tải lịch sử project');
        const history = (await response.json()) as {
          transitions?: {
            id: string;
            fromStage: string | null;
            toStage: string;
            reason: string;
            createdAt: string;
          }[];
        };
        setActivity(history.transitions ?? []);
      } catch (error) {
        setActivityError(error instanceof Error ? error.message : 'Không thể tải lịch sử project');
      }
    })();
  }, [projectId]);
  const selectedStep =
    phase.workflowSteps.find(step => step.id === selectedStepId) ?? phase.workflowSteps[0];
  const completedSteps = phase.workflowSteps.filter(step => step.status === 'completed').length;
  return (
    <article className="s3-detail">
      <div className="s3-phase-hero">
        <div>
          <p className="s3-kicker">
            Phase · {phaseStatusLabel(phase.status)} · {phase.progress.toString()}%
          </p>
          <h2>{phase.title}</h2>
          <p>{phase.summary}</p>
        </div>
        <div className="s3-run-pill">
          <span className={phase.status === 'completed' ? 'complete' : ''} />
          {phase.status === 'completed' ? 'Run hoàn tất' : 'Chưa có run'}
        </div>
      </div>

      <div className="s3-phase-tabs" role="tablist" aria-label={`Chi tiết ${phase.title}`}>
        <button
          id={`workflow-tab-${phase.id}`}
          type="button"
          role="tab"
          aria-selected={tab === 'workflow'}
          aria-controls={`workflow-panel-${phase.id}`}
          className={tab === 'workflow' ? 'active' : ''}
          onClick={() => {
            setTab('workflow');
          }}
        >
          Cách workflow hoạt động
        </button>
        <button
          id={`overview-tab-${phase.id}`}
          type="button"
          role="tab"
          aria-selected={tab === 'overview'}
          aria-controls={`overview-panel-${phase.id}`}
          className={tab === 'overview' ? 'active' : ''}
          onClick={() => {
            setTab('overview');
          }}
        >
          Mục tiêu & kết quả
        </button>
        <button
          id={`run-tab-${phase.id}`}
          type="button"
          role="tab"
          aria-selected={tab === 'run'}
          aria-controls={`run-panel-${phase.id}`}
          className={tab === 'run' ? 'active' : ''}
          onClick={() => {
            setTab('run');
          }}
        >
          Lần chạy gần nhất
        </button>
        <button
          id={`activity-tab-${phase.id}`}
          type="button"
          role="tab"
          aria-selected={tab === 'activity'}
          aria-controls={`activity-panel-${phase.id}`}
          className={tab === 'activity' ? 'active' : ''}
          onClick={() => {
            setTab('activity');
          }}
        >
          Activity & audit
        </button>
      </div>

      {tab === 'workflow' ? (
        <section
          className="s3-workflow-view"
          id={`workflow-panel-${phase.id}`}
          role="tabpanel"
          aria-labelledby={`workflow-tab-${phase.id}`}
        >
          <div className="s3-workflow-intro">
            <div>
              <span>WORKFLOW ĐÃ BIND</span>
              <strong>{phase.technicalWorkflow}</strong>
              <p>
                Đây là execution plan của phase — mỗi bước đều có input, output và trạng thái rõ
                ràng.
              </p>
            </div>
            <Link to="/console/workflows" className="s3-workflow-link">
              Mở workflow kỹ thuật <ChevronRight size={15} />
            </Link>
          </div>
          <div className="s3-workflow-body">
            <ol className="s3-workflow-steps">
              {phase.workflowSteps.map((step, index) => (
                <li key={step.id}>
                  <button
                    type="button"
                    className={selectedStep?.id === step.id ? 'selected' : ''}
                    onClick={() => {
                      setSelectedStepId(step.id);
                    }}
                  >
                    <span className={`s3-step-icon ${step.kind}`}>
                      {workflowStepGlyph(step.kind)}
                    </span>
                    <span className="s3-step-copy">
                      <small>
                        Bước {(index + 1).toString()} · {workflowStepKindLabel(step.kind)}
                      </small>
                      <strong>{step.title}</strong>
                      <span>{step.description}</span>
                    </span>
                    <span className={`s3-step-status ${step.status}`}>
                      {step.status === 'completed' ? 'Xong' : 'Chờ chạy'}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {selectedStep ? (
              <aside className="s3-step-inspector" aria-label="Chi tiết bước workflow">
                <span className="s3-inspector-label">Chi tiết node</span>
                <h3>{selectedStep.title}</h3>
                <p>{selectedStep.description}</p>
                <dl>
                  <div>
                    <dt>Input</dt>
                    <dd>{selectedStep.input}</dd>
                  </div>
                  <div>
                    <dt>Output</dt>
                    <dd>{selectedStep.output}</dd>
                  </div>
                  <div>
                    <dt>Loại node</dt>
                    <dd>{workflowStepKindLabel(selectedStep.kind)}</dd>
                  </div>
                  <div>
                    <dt>Thời lượng</dt>
                    <dd>{selectedStep.duration}</dd>
                  </div>
                </dl>
                <div className="s3-inspector-note">
                  <Check size={14} /> Nguồn và knowledge snapshot được lưu thật; node I/O generic sẽ
                  xuất hiện ở execution milestone.
                </div>
                {selectedStep.status === 'completed' ? (
                  <Link
                    className="s3-inspector-action"
                    to={`/console/projects/${projectId}/evidence`}
                  >
                    Xem output artifact <ChevronRight size={14} />
                  </Link>
                ) : null}
              </aside>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === 'overview' ? (
        <div
          className="s3-overview-grid"
          id={`overview-panel-${phase.id}`}
          role="tabpanel"
          aria-labelledby={`overview-tab-${phase.id}`}
        >
          <section className="s3-section">
            <h3>Mục tiêu</h3>
            <p className="m-0 text-sm leading-6 text-slate-700">{phase.objective}</p>
          </section>
          <section className="s3-section">
            <h3>Đầu vào</h3>
            <ul className="s3-list">
              {phase.inputs.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section className="s3-section">
            <h3>Kết quả mong đợi</h3>
            <ul className="s3-list">
              {phase.outputs.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === 'run' ? (
        <section
          className="s3-run-view"
          id={`run-panel-${phase.id}`}
          role="tabpanel"
          aria-labelledby={`run-tab-${phase.id}`}
        >
          <div className="s3-run-summary">
            <div>
              <span>
                {phase.status === 'completed' ? 'KNOWLEDGE SNAPSHOT' : 'CHƯA CÓ EXECUTION RUN'}
              </span>
              <strong>
                {phase.status === 'completed' ? 'Hiểu dự án đã hoàn tất' : 'Đang chờ bắt đầu'}
              </strong>
              <small>
                {completedSteps.toString()} / {phase.workflowSteps.length.toString()} node hoàn tất
                · projection từ source và knowledge snapshot
              </small>
            </div>
            <span className={`s3-chip ${phase.status === 'completed' ? 'good' : 'warn'}`}>
              {phase.status === 'completed' ? 'Passed' : 'Not started'}
            </span>
          </div>
          <div className="s3-run-timeline">
            {phase.workflowSteps.map(step => (
              <div key={step.id}>
                <span className={step.status === 'completed' ? 'done' : ''}>
                  {step.status === 'completed' ? <Check size={13} /> : <Play size={12} />}
                </span>
                <section>
                  <strong>{step.title}</strong>
                  <p>
                    {step.input} → {step.output}
                  </p>
                </section>
                <small>{step.duration}</small>
              </div>
            ))}
          </div>
          <div className="s3-run-footnote">
            Đây là projection thân thiện từ generic WorkflowRun thật. Technical Console hiển thị
            definition snapshot bất biến, event stream, input/output từng node và artifact của lần
            chạy này.
          </div>
          <Link className="s3-run-console-link" to={`/console/projects/${projectId}/technical`}>
            Mở run, logs và retry history trong Technical Console <ChevronRight size={15} />
          </Link>
        </section>
      ) : null}

      {tab === 'activity' ? (
        <section
          className="s3-run-view"
          id={`activity-panel-${phase.id}`}
          role="tabpanel"
          aria-labelledby={`activity-tab-${phase.id}`}
        >
          <div className="s3-run-summary">
            <div>
              <span>LIFECYCLE AUDIT</span>
              <strong>Thay đổi trạng thái có lý do rõ ràng</strong>
              <small>
                Không tự suy đoán process đã mất; trạng thái unknown cần thao tác của người dùng.
              </small>
            </div>
          </div>
          {activityError !== null ? (
            <p className="s3-note" role="alert" aria-live="assertive">
              {activityError}
            </p>
          ) : null}
          <div className="s3-run-timeline">
            {activity.length === 0 ? <p className="s3-note">Chưa có transition phù hợp.</p> : null}
            {activity.map(entry => (
              <div key={entry.id}>
                <span className="done">
                  <Check size={13} />
                </span>
                <strong>
                  {entry.fromStage ?? 'created'} → {entry.toStage}
                </strong>
                <small>
                  {entry.reason} · {new Date(entry.createdAt).toLocaleString('vi-VN')}
                </small>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}

function SourceIntakeReportCard({
  view,
  title,
}: {
  view: System3SourceIntakeReportView;
  title: string;
}): ReactElement {
  const report = view.report;
  const outcomeLabel = {
    created_source: 'Đã nhận nguồn mới',
    created_version: 'Đã nhận phiên bản mới',
    unchanged: 'Không thay đổi',
    rejected: 'Bị từ chối',
  }[report.outcome];
  const changeLabel = {
    not_required: 'Không cần chạy',
    succeeded: 'Đã hoàn tất',
    failed: 'Thất bại — cần thử lại',
  }[report.changeDetection.status];
  return (
    <section className="s3-source-report" aria-live="polite">
      <div className="s3-card-head">
        <div>
          <h3>{title}</h3>
          <p>
            <strong>{outcomeLabel}</strong> · {report.originalFilename}
          </p>
        </div>
        <span className={`s3-chip ${report.outcome === 'rejected' ? 'warn' : 'good'}`}>
          {outcomeLabel}
        </span>
      </div>
      <p>
        {report.role === 'primary' ? 'Nguồn chính' : 'Nguồn bổ sung'} ·{' '}
        {report.sizeBytes.toLocaleString('vi-VN')} bytes ·{' '}
        {new Date(report.createdAt).toLocaleString('vi-VN')}
      </p>
      <ul>
        {report.validationReport.checks.map(check => (
          <li key={check.id}>
            <strong>
              {check.status === 'passed'
                ? 'Đạt'
                : check.status === 'warning'
                  ? 'Cảnh báo'
                  : 'Không đạt'}
              :
            </strong>{' '}
            {check.label} — {check.message}
          </li>
        ))}
        {report.validationReport.warnings.map(warning => (
          <li key={warning}>
            <strong>Cảnh báo:</strong> {warning}
          </li>
        ))}
      </ul>
      <p>
        <strong>Phát hiện thay đổi (OP-01):</strong> {changeLabel}
        {report.changeDetection.error ? ` — ${report.changeDetection.error}` : ''}
      </p>
      <p>
        <strong>Bước tiếp theo:</strong>{' '}
        {report.nextAction === 'retry_intake'
          ? 'Chọn lại file phù hợp và thử tiếp nhận lại.'
          : report.nextAction === 'retry_change_detection'
            ? 'Thử lại bước Phát hiện thay đổi trước khi tiếp tục.'
            : 'Kiểm tra bộ nguồn rồi chủ động chuyển sang Hiểu dự án.'}
      </p>
      <details>
        <summary>Chi tiết kỹ thuật</summary>
        <p>
          Operation: {report.operationId} · Report artifact: {view.id}
        </p>
        <p>
          MIME: {report.mediaType} · Hash:{' '}
          {report.contentHash ?? 'Không tính vì file bị từ chối trước khi đọc'}
        </p>
        <p>
          Actor: {report.actorId ?? 'Không xác định'} · Origin: {report.origin} · Phiên bản trước:{' '}
          {report.previousVersionId ?? 'Không có'}
        </p>
        <a
          className="s3-button s3-button-secondary"
          href={`/api/system3/projects/${report.projectId}/source-intake-reports/${view.id}/content`}
        >
          Tải báo cáo JSON
        </a>
      </details>
    </section>
  );
}

function SourcesPage(): ReactElement {
  const project = useSystem3Project();
  const navigate = useNavigate();
  const sourceFileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<System3SourceKind>('blueprint');
  const [role, setRole] = useState<System3SourceRole>('primary');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<System3SourceIntakeReportView | null>(null);
  const [retryIdempotencyKey, setRetryIdempotencyKey] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [selectedImpactResource, setSelectedImpactResource] =
    useState<System3ResourceDescriptor | null>(null);
  const [impactResourceOpener, setImpactResourceOpener] = useState<HTMLElement | null>(null);
  const rules = {
    blueprint: 'Markdown, JSON hoặc PDF; tối đa 10 MB',
    dataset: 'CSV UTF-8 (.csv), tối đa 25 MB',
    constraints: 'JSON, YAML hoặc Markdown; tối đa 2 MB',
    data_dictionary: 'CSV, JSON, YAML, Markdown hoặc PDF; tối đa 10 MB',
    user_brief: 'Markdown, văn bản hoặc PDF; tối đa 10 MB',
    supporting_document: 'Markdown, văn bản, JSON, YAML hoặc PDF; tối đa 10 MB',
  } as const;
  const accepts: Record<System3SourceKind, string> = {
    blueprint: '.md,.json,.pdf,text/markdown,application/json,application/pdf',
    dataset: '.csv,text/csv',
    constraints: '.json,.yaml,.yml,.md,application/json,text/markdown',
    data_dictionary: '.csv,.json,.yaml,.yml,.md,.pdf',
    user_brief: '.md,.txt,.pdf,text/plain,text/markdown,application/pdf',
    supporting_document: '.md,.txt,.json,.yaml,.yml,.pdf',
  };
  const kindLabels: Record<System3SourceKind, string> = {
    blueprint: 'Bản mô tả dự án',
    dataset: 'Dữ liệu',
    constraints: 'Ràng buộc',
    data_dictionary: 'Từ điển dữ liệu',
    user_brief: 'Yêu cầu của người dùng',
    supporting_document: 'Tài liệu bổ sung',
  };
  const { intakeGate } = project;
  const activeSources = project.sources.filter(source => source.status === 'ready');
  const legacySources = activeSources.filter(
    source => source.origin === 'legacy' || source.intakeReportArtifactId === null
  );
  const visibleLatestReport = lastReport ?? project.intakeReports[0] ?? null;
  const allChangesComplete =
    intakeGate.changeDetection.length > 0 &&
    intakeGate.changeDetection.every(item => item.status === 'succeeded');
  const latestImpact = project.impacts[0] ?? null;
  const activityLabels: Readonly<Record<string, string>> = {
    'TW-02': 'Hiểu dự án',
    'TW-03': 'Kiểm tra mức độ sẵn sàng',
    'OP-04': 'Chuẩn bị kế hoạch thực thi',
    'OP-05': 'Phê duyệt kế hoạch',
    'TW-06': 'Thực thi kế hoạch đã duyệt',
    'TW-07': 'Xác minh kết quả độc lập',
    'OP-08': 'Yêu cầu bàn giao',
    'TW-09': 'Tạo gói bàn giao',
  };
  const openLatestImpact = (opener: HTMLElement): void => {
    if (latestImpact === null) return;
    setGateError(null);
    void fetch(`/api/system3/projects/${project.id}/activities/OP-01`)
      .then(async response => {
        if (!response.ok) throw new Error('Không thể tải kết quả OP-01');
        return (await response.json()) as System3ActivityResourceView;
      })
      .then(view => {
        const resource = view.outputs.find(item => item.id === latestImpact.id);
        if (!resource) throw new Error('Không tìm thấy báo cáo ảnh hưởng của OP-01');
        setImpactResourceOpener(opener);
        setSelectedImpactResource(resource);
      })
      .catch(error => {
        setGateError(error instanceof Error ? error.message : 'Không thể mở báo cáo ảnh hưởng');
      });
  };
  return (
    <Workspace>
      <>
        <div className="s3-page-card">
          <ProjectHeader showPrimaryAction={false} />
          <section className="s3-op-hero" aria-labelledby="source-intake-title">
            <div className="s3-op-hero-copy">
              <span className="s3-operation-label">
                <LockKeyhole size={14} /> Hoạt động vòng đời · OP-00
              </span>
              <h2 id="source-intake-title">Tiếp nhận nguồn đầu vào</h2>
              <p>
                Anvil kiểm tra file, giữ nguyên bytes đã nhận và tạo Source Version không bị ghi đè.
                Bạn luôn biết nguồn nào đang được dùng trước khi chuyển sang Hiểu dự án.
              </p>
            </div>
            <div className={`s3-op-status ${intakeGate.ready ? 'ready' : 'attention'}`}>
              {intakeGate.ready ? <CheckCircle2 size={22} /> : <Clock3 size={22} />}
              <div>
                <span>Trạng thái phase Tiếp nhận</span>
                <strong>{intakeGate.ready ? 'Đã sẵn sàng' : 'Cần hoàn tất'}</strong>
                <small>
                  {intakeGate.ready
                    ? 'Có thể chủ động bắt đầu TW-02 Hiểu dự án.'
                    : (intakeGate.blockingReasons[0] ?? 'Hãy thêm Blueprint nguồn chính.')}
                </small>
              </div>
            </div>
          </section>

          <ol className="s3-intake-steps" aria-label="Các bước của phase Tiếp nhận">
            {[
              ['1', 'Nhận file', activeSources.length > 0],
              ['2', 'Kiểm tra định dạng', activeSources.length > 0],
              ['3', 'Lưu phiên bản bất biến', activeSources.length > 0],
              ['4', 'Phát hiện thay đổi', allChangesComplete],
            ].map(([number, label, complete]) => (
              <li key={String(number)} className={complete ? 'complete' : ''}>
                <span>{complete ? <Check size={14} /> : number}</span>
                <strong>{label}</strong>
              </li>
            ))}
          </ol>

          <section className="s3-card s3-source-workbench">
            <div className="s3-card-head">
              <div>
                <p className="s3-kicker">Source Registry</p>
                <h2>Thêm hoặc cập nhật nguồn</h2>
                <p className="m-1 text-sm text-slate-500">
                  Mỗi tài liệu là một nguồn riêng. Khi thay file, Anvil giữ lại phiên bản cũ để có
                  thể kiểm tra và chạy lại đúng dữ liệu đã dùng.
                </p>
              </div>
            </div>
            <div className="s3-card-body">
              {legacySources.length > 0 ? (
                <section className="s3-legacy-banner" aria-label="Nguồn được chuyển từ Anvil cũ">
                  <div className="s3-legacy-icon">
                    <Clock3 size={19} />
                  </div>
                  <div>
                    <span className="s3-operation-label">Nguồn legacy · cần xác nhận một lần</span>
                    <h3>{legacySources.length.toString()} nguồn không có báo cáo OP-00 lịch sử</h3>
                    <p>
                      Anvil giữ nguyên Source Version đã migrate và không tạo giả báo cáo. Hãy xác
                      nhận nguồn bằng OP-01 hoặc tải phiên bản mới để có đầy đủ báo cáo tiếp nhận.
                    </p>
                    <div className="s3-legacy-actions">
                      {legacySources.map(source => {
                        const change = intakeGate.changeDetection.find(
                          item => item.sourceVersionId === source.id
                        );
                        return change?.status !== 'succeeded' ? (
                          <button
                            key={source.id}
                            type="button"
                            className="s3-button"
                            disabled={recoveringId !== null}
                            onClick={() => {
                              setRecoveringId(source.id);
                              setGateError(null);
                              void system3Store
                                .retryChangeDetection(source.id)
                                .then(() => {
                                  setMessage(`Đã xác nhận ${source.name} và hoàn tất OP-01.`);
                                })
                                .catch(error => {
                                  setGateError(
                                    error instanceof Error
                                      ? error.message
                                      : 'Không thể xác nhận nguồn'
                                  );
                                })
                                .finally(() => {
                                  setRecoveringId(null);
                                });
                            }}
                          >
                            {recoveringId === source.id
                              ? 'Đang xác nhận…'
                              : `Xác nhận ${source.name}`}
                          </button>
                        ) : null;
                      })}
                      <button
                        type="button"
                        className="s3-button s3-button-secondary"
                        onClick={() => sourceFileInput.current?.focus()}
                      >
                        Tải phiên bản mới
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}
              <form
                className="s3-source-upload"
                onSubmit={event => {
                  event.preventDefault();
                  if (!file) {
                    setMessage('Chọn một tệp trước khi tải lên.');
                    return;
                  }
                  setPending(true);
                  setMessage(null);
                  void system3Store
                    .uploadSource(kind, file, {
                      ...(sourceId ? { sourceId } : {}),
                      role,
                      ...(retryIdempotencyKey ? { idempotencyKey: retryIdempotencyKey } : {}),
                    })
                    .then(result => {
                      setFile(null);
                      setSourceId(null);
                      setLastReport(result.intakeReport);
                      setRetryIdempotencyKey(null);
                      if (sourceFileInput.current) sourceFileInput.current.value = '';
                      setMessage(
                        result.outcome === 'unchanged'
                          ? 'Tệp trùng với phiên bản hiện tại nên Anvil không tạo bản sao mới.'
                          : result.outcome === 'created_source'
                            ? 'Đã thêm nguồn mới và tự động kiểm tra phần nào của dự án bị ảnh hưởng.'
                            : 'Đã tạo phiên bản mới và tự động kiểm tra phần nào của dự án bị ảnh hưởng.'
                      );
                    })
                    .catch(error => {
                      if (error instanceof System3SourceIntakeRequestError) {
                        setLastReport(error.intakeReport);
                        setRetryIdempotencyKey(
                          error.intakeReport === null ? error.idempotencyKey : null
                        );
                      }
                      setMessage(error instanceof Error ? error.message : 'Không thể tải source');
                    })
                    .finally(() => {
                      setPending(false);
                    });
                }}
              >
                <div>
                  <label htmlFor="system3-source-kind">Loại source</label>
                  <select
                    id="system3-source-kind"
                    value={kind}
                    disabled={pending}
                    onChange={event => {
                      setKind(event.target.value as typeof kind);
                      setSourceId(null);
                      setRole('primary');
                      setFile(null);
                      setLastReport(null);
                      setRetryIdempotencyKey(null);
                      setMessage(null);
                    }}
                  >
                    {Object.entries(kindLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="system3-source-role">Vai trò</label>
                  <select
                    id="system3-source-role"
                    value={role}
                    disabled={pending || sourceId !== null}
                    onChange={event => {
                      setRole(event.target.value as System3SourceRole);
                    }}
                  >
                    <option value="primary">Nguồn chính</option>
                    <option value="supplemental">Nguồn bổ sung</option>
                  </select>
                  <small>
                    {sourceId
                      ? 'Phiên bản mới giữ nguyên vai trò của nguồn.'
                      : 'Mỗi loại chỉ có một nguồn chính; có thể thêm nhiều nguồn bổ sung.'}
                  </small>
                </div>
                <div>
                  <label htmlFor="system3-source-file">Tệp mới</label>
                  <input
                    ref={sourceFileInput}
                    id="system3-source-file"
                    type="file"
                    disabled={pending}
                    accept={accepts[kind]}
                    onChange={event => {
                      setFile(event.currentTarget.files?.[0] ?? null);
                      setMessage(null);
                    }}
                  />
                  <small>{rules[kind]}</small>
                </div>
                <button className="s3-button" type="submit" disabled={pending || file === null}>
                  <Upload size={15} />{' '}
                  {pending
                    ? 'Đang kiểm tra…'
                    : retryIdempotencyKey
                      ? 'Thử hoàn tất lại'
                      : sourceId
                        ? 'Tạo phiên bản mới'
                        : 'Thêm nguồn'}
                </button>
                {message ? (
                  <p className="s3-note" role="status" aria-live="polite">
                    {message}
                  </p>
                ) : null}
              </form>
              {sourceId ? (
                <div className="s3-note">
                  Bạn đang thay file cho một nguồn đã có.{' '}
                  <button
                    type="button"
                    className="s3-button s3-button-secondary"
                    onClick={() => {
                      setSourceId(null);
                      setFile(null);
                      if (sourceFileInput.current) sourceFileInput.current.value = '';
                    }}
                  >
                    Hủy thay file
                  </button>
                </div>
              ) : null}
              {visibleLatestReport ? (
                <SourceIntakeReportCard
                  view={visibleLatestReport}
                  title="Báo cáo tiếp nhận gần nhất"
                />
              ) : null}
              <section className="s3-card s3-intake-gate">
                <div className="s3-card-head">
                  <div>
                    <p className="s3-kicker">Intake Gate</p>
                    <h3>Kiểm tra trước khi sang Hiểu dự án</h3>
                  </div>
                  <span className={`s3-status-badge ${intakeGate.ready ? 'completed' : 'blocked'}`}>
                    {intakeGate.ready ? 'Đã đạt' : 'Chưa đạt'}
                  </span>
                </div>
                <div className="s3-card-body">
                  <ul>
                    <li>
                      {intakeGate.blueprintReady ? '✓' : '○'} Đã có Blueprint nguồn chính đang dùng.
                    </li>
                    <li>
                      {intakeGate.activeSourceCount > 0 ? '✓' : '○'} Có{' '}
                      {intakeGate.activeSourceCount.toString()} nguồn hợp lệ trong Source Registry.
                    </li>
                    <li>
                      {intakeGate.changeDetection.every(item => item.status === 'succeeded')
                        ? '✓'
                        : '○'}{' '}
                      OP-01 đã hoàn tất cho từng phiên bản nguồn đang dùng.
                    </li>
                  </ul>
                  {intakeGate.recoveries.map(recovery => (
                    <div className="s3-note" key={recovery.operationId}>
                      <strong>Yêu cầu tiếp nhận bị gián đoạn:</strong>{' '}
                      {recovery.filename ?? 'chưa lưu được tên tệp'} · bước {recovery.stage}.
                      {recovery.error ? ` ${recovery.error}` : ''}
                      {recovery.requiresTakeoverConfirmation ? (
                        <p>
                          Anvil không thể biết process cũ còn chạy hay không. Chỉ tiếp tục nếu bạn
                          đã kiểm tra và muốn nhận quyền xử lý operation này.
                        </p>
                      ) : null}
                      {recovery.retryable ? (
                        <button
                          type="button"
                          className="s3-button s3-button-secondary"
                          disabled={recoveringId !== null}
                          onClick={() => {
                            if (
                              recovery.requiresTakeoverConfirmation &&
                              !window.confirm(
                                'Operation có thể vẫn chạy ở process khác. Bạn có chắc muốn tiếp tục lại từ dữ liệu đã lưu?'
                              )
                            ) {
                              return;
                            }
                            setRecoveringId(recovery.operationId);
                            setGateError(null);
                            void system3Store
                              .retrySourceIntake(recovery.operationId)
                              .then(() => {
                                setMessage('Đã hoàn tất lại yêu cầu tiếp nhận.');
                              })
                              .catch(error => {
                                setGateError(
                                  error instanceof Error
                                    ? error.message
                                    : 'Không thể khôi phục Source Intake'
                                );
                              })
                              .finally(() => {
                                setRecoveringId(null);
                              });
                          }}
                        >
                          {recoveringId === recovery.operationId
                            ? 'Đang tiếp tục…'
                            : 'Tiếp tục lại yêu cầu này'}
                        </button>
                      ) : (
                        <p>Chưa có đủ bytes đã ghim; hãy chọn lại tệp và gửi một yêu cầu mới.</p>
                      )}
                    </div>
                  ))}
                  {intakeGate.changeDetection
                    .filter(item => item.status !== 'succeeded')
                    .map(item => (
                      <div className="s3-note" key={item.sourceVersionId}>
                        <strong>
                          {item.status === 'not_started'
                            ? 'Nguồn cần được xác nhận lại bằng cách kiểm tra mới:'
                            : 'OP-01 chưa hoàn tất:'}
                        </strong>{' '}
                        {item.filename}.{item.error ? ` ${item.error}` : ''}{' '}
                        {item.retryable ? (
                          <button
                            type="button"
                            className="s3-button s3-button-secondary"
                            disabled={recoveringId !== null}
                            onClick={() => {
                              setRecoveringId(item.sourceVersionId);
                              setGateError(null);
                              void system3Store
                                .retryChangeDetection(item.sourceVersionId)
                                .then(() => {
                                  setMessage('OP-01 đã hoàn tất.');
                                })
                                .catch(error => {
                                  setGateError(
                                    error instanceof Error
                                      ? error.message
                                      : 'Không thể thử lại OP-01'
                                  );
                                })
                                .finally(() => {
                                  setRecoveringId(null);
                                });
                            }}
                          >
                            {recoveringId === item.sourceVersionId
                              ? 'Đang kiểm tra lại…'
                              : item.status === 'not_started'
                                ? 'Xác nhận lại nguồn'
                                : 'Thử lại OP-01'}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  <p>
                    Anvil chỉ bắt đầu Technical Workflow “Hiểu dự án” sau khi bạn xem bộ nguồn và
                    chủ động xác nhận tại đây.
                  </p>
                  <button
                    type="button"
                    className="s3-button"
                    disabled={!intakeGate.ready || continuing || recoveringId !== null}
                    onClick={() => {
                      setContinuing(true);
                      setGateError(null);
                      void system3Store
                        .analyze()
                        .then(() => {
                          navigate(`/console/projects/${project.id}/flow`);
                        })
                        .catch(error => {
                          setGateError(
                            error instanceof Error ? error.message : 'Không thể bắt đầu Hiểu dự án'
                          );
                        })
                        .finally(() => {
                          setContinuing(false);
                        });
                    }}
                  >
                    {continuing ? 'Đang bắt đầu Hiểu dự án…' : 'Tiếp tục Hiểu dự án'}
                  </button>
                  {!intakeGate.ready ? (
                    <div className="s3-note">
                      <p>Hoàn tất các mục còn thiếu phía trên trước khi tiếp tục:</p>
                      <ul>
                        {intakeGate.blockingReasons.map(reason => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {gateError ? (
                    <p className="s3-note" role="alert" aria-live="assertive">
                      {gateError}
                    </p>
                  ) : null}
                </div>
              </section>
              {latestImpact ? (
                <section className="s3-source-report" role="status" aria-live="polite">
                  <div className="s3-card-head">
                    <div>
                      <p className="s3-kicker">Hoạt động vòng đời · OP-01</p>
                      <h3>Báo cáo ảnh hưởng gần nhất</h3>
                    </div>
                    <span
                      className={`s3-chip ${
                        latestImpact.manifest?.proposedRerun.mode === 'none' ? 'good' : 'warn'
                      }`}
                    >
                      {latestImpact.manifest?.confidence === 'high'
                        ? 'Độ chắc chắn cao'
                        : latestImpact.manifest?.confidence === 'medium'
                          ? 'Cần xem lại một phần'
                          : latestImpact.manifest
                            ? 'Phạm vi an toàn mở rộng'
                            : 'Báo cáo phiên bản cũ'}
                    </span>
                  </div>
                  <p>{latestImpact.manifest?.summary ?? latestImpact.reason}</p>
                  {latestImpact.manifest ? (
                    <>
                      <p>
                        <strong>Đã phát hiện:</strong>{' '}
                        {latestImpact.manifest.changes.length.toString()} thay đổi ·{' '}
                        <strong>Đề xuất:</strong>{' '}
                        {latestImpact.manifest.proposedRerun.mode === 'none'
                          ? 'Không cần làm lại các bước phía sau'
                          : latestImpact.manifest.proposedRerun.mode === 'scoped'
                            ? 'Chạy lại có phạm vi'
                            : 'Chạy lại đầy đủ'}
                      </p>
                      <p>
                        <strong>Kết quả cần cập nhật:</strong>{' '}
                        {latestImpact.manifest.affectedResources.length.toString()} ·{' '}
                        <strong>Kết quả có thể giữ lại:</strong>{' '}
                        {latestImpact.manifest.reusableResources.length.toString()}
                      </p>
                      {latestImpact.manifest.affectedActivities.length > 0 ? (
                        <ul>
                          {latestImpact.manifest.affectedActivities.map(activityId => (
                            <li key={activityId}>
                              {activityLabels[activityId] ?? activityId} · {activityId}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>
                          Nội dung sau khi chuẩn hóa không đổi nên các bước phía sau không cần cập
                          nhật.
                        </p>
                      )}
                      {latestImpact.manifest.uncertainties.length > 0 ? (
                        <p className="s3-note">
                          <strong>Điểm chưa xác định chắc chắn:</strong>{' '}
                          {latestImpact.manifest.uncertainties.join(' ')}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p>
                      Báo cáo cũ chỉ có phạm vi rộng. Chạy lại OP-01 để biết rõ nội dung thay đổi và
                      nguồn gốc của từng kết quả.
                    </p>
                  )}
                  <button
                    type="button"
                    className="s3-button s3-button-secondary"
                    onClick={event => {
                      openLatestImpact(event.currentTarget);
                    }}
                  >
                    Xem chi tiết thay đổi
                  </button>
                </section>
              ) : null}
              {project.sources.map(source => (
                <div className="s3-row" key={source.id}>
                  <div>
                    <h3>
                      {source.name} <span className="s3-chip">v{source.version.toString()}</span>
                    </h3>
                    <p>{source.detail}</p>
                    <small>
                      {kindLabels[source.kind]} ·{' '}
                      {source.role === 'primary' ? 'Nguồn chính' : 'Nguồn bổ sung'} ·{' '}
                      {new Date(source.createdAt).toLocaleString('vi-VN')}
                    </small>
                    <details>
                      <summary>Chi tiết kỹ thuật và báo cáo kiểm tra</summary>
                      <p>
                        Mã nội dung: {source.hash} · Định dạng: {source.mediaType} · Nguồn:{' '}
                        {source.origin}
                      </p>
                      <ul>
                        {source.validationReport.checks.map(check => (
                          <li key={check.id}>
                            {check.label}: {check.message}
                          </li>
                        ))}
                        {source.validationReport.warnings.map(warning => (
                          <li key={warning}>Cảnh báo: {warning}</li>
                        ))}
                      </ul>
                      <a
                        className="s3-button s3-button-secondary"
                        href={`/api/system3/projects/${project.id}/source-versions/${source.id}/content`}
                      >
                        Tải đúng phiên bản này
                      </a>
                    </details>
                  </div>
                  <div>
                    <span className={`s3-chip ${source.status === 'superseded' ? 'warn' : 'good'}`}>
                      {source.status === 'superseded' ? 'Phiên bản lịch sử' : 'Đang dùng'}
                    </span>
                    {source.status === 'ready' ? (
                      <button
                        type="button"
                        className="s3-button s3-button-secondary"
                        onClick={() => {
                          setKind(source.kind);
                          setRole(source.role);
                          setSourceId(source.sourceId);
                          setFile(null);
                          setMessage(`Chọn file mới cho ${source.name}.`);
                          sourceFileInput.current?.focus();
                        }}
                      >
                        Tải phiên bản mới
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
              <section className="s3-card s3-report-history">
                <div className="s3-card-head">
                  <div>
                    <p className="s3-kicker">Artifact history</p>
                    <h3>Lịch sử báo cáo tiếp nhận</h3>
                    <p>
                      Các lần bị từ chối vẫn được giữ lại để người dùng có thể xem và sửa đúng lỗi.
                    </p>
                  </div>
                  <span className="s3-chip">{project.intakeReports.length.toString()} báo cáo</span>
                </div>
                <div className="s3-card-body">
                  {project.intakeReports.length === 0 ? (
                    <div className="s3-empty-report">
                      <FileCheck2 size={22} />
                      <div>
                        <strong>Chưa có báo cáo OP-00</strong>
                        <p>
                          Project này chưa tiếp nhận nguồn bằng OP-00 hiện tại. Nguồn legacy vẫn
                          được giữ nguyên và được giải thích ở phía trên.
                        </p>
                      </div>
                    </div>
                  ) : null}
                  {project.intakeReports
                    .filter(report => report.id !== visibleLatestReport?.id)
                    .map(report => (
                      <SourceIntakeReportCard
                        key={report.id}
                        view={report}
                        title={`Báo cáo ${new Date(report.createdAt).toLocaleString('vi-VN')}`}
                      />
                    ))}
                </div>
              </section>
            </div>
          </section>
        </div>
        {selectedImpactResource === null ? null : (
          <InlineResourceViewer
            projectId={project.id}
            resource={selectedImpactResource}
            opener={impactResourceOpener}
            onClose={() => {
              setSelectedImpactResource(null);
            }}
          />
        )}
      </>
    </Workspace>
  );
}

function DecisionsPage(): ReactElement {
  const project = useSystem3Project();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [preparingPlan, setPreparingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const pendingDecisions = project.decisions.filter(
    decision => decision.status === 'pending'
  ).length;
  const canPreparePlan = pendingDecisions === 0 && project.readiness !== undefined;
  const openPlanReview = (): void => {
    setPlanError(null);
    if (project.planCompiled) {
      setReviewOpen(true);
      return;
    }
    setPreparingPlan(true);
    void system3Store
      .compile()
      .then(() => {
        setReviewOpen(true);
      })
      .catch(error => {
        setPlanError(error instanceof Error ? error.message : 'Không thể chuẩn bị Execution Plan');
      })
      .finally(() => {
        setPreparingPlan(false);
      });
  };
  return (
    <Workspace>
      <div className="s3-page-card">
        <ProjectHeader showPrimaryAction={false} />
        <header className="s3-purpose-header">
          <div>
            <p className="s3-kicker">Quyết định & Phê duyệt</p>
            <h2>Đóng các lựa chọn trước khi thực thi</h2>
            <p>
              Trả lời những điều Anvil không được tự đoán, sau đó xem chính xác Execution Plan trước
              khi tạo Approval Manifest.
            </p>
          </div>
          <span className={`s3-status-badge ${pendingDecisions > 0 ? 'blocked' : 'ready'}`}>
            {pendingDecisions > 0
              ? `${pendingDecisions.toString()} Decision đang chờ`
              : 'Decision đã đầy đủ'}
          </span>
        </header>

        <div className="s3-decision-workspace-grid">
          <section className="s3-card">
            <div className="s3-card-head">
              <div>
                <p className="s3-kicker">Decision</p>
                <h2>Quyết định cần xác nhận</h2>
                <p className="m-1 text-sm text-slate-500">
                  Câu trả lời được lưu theo phiên bản và trở thành một phần của compilation basis.
                </p>
              </div>
            </div>
            <div className="s3-card-body">
              {project.decisions.length === 0 ? (
                <p className="s3-note">Chưa có Decision nào được tạo từ bản hiểu dự án.</p>
              ) : null}
              {project.decisions.map(decision => (
                <DecisionRow key={decision.id} decision={decision} />
              ))}
            </div>
          </section>

          <aside className="s3-approval-workspace" aria-labelledby="approval-workspace-title">
            <div className="s3-approval-workspace-head">
              <span className="s3-operation-label">
                <LockKeyhole size={14} /> OP-04 · OP-05
              </span>
              <h2 id="approval-workspace-title">Kế hoạch và phê duyệt</h2>
              <p>
                Compile tạo Execution Plan. Phê duyệt chỉ áp dụng cho đúng plan và bộ nguồn đã ghim.
              </p>
            </div>

            <ol className="s3-approval-steps">
              <li className={project.readiness ? 'complete' : 'waiting'}>
                <span>{project.readiness ? <Check size={14} /> : '1'}</span>
                <div>
                  <strong>Readiness Contract</strong>
                  <small>{project.readiness ? 'Đã khóa điều kiện đầu vào' : 'Chưa sẵn sàng'}</small>
                </div>
              </li>
              <li
                className={project.planCompiled ? 'complete' : canPreparePlan ? 'ready' : 'waiting'}
              >
                <span>{project.planCompiled ? <Check size={14} /> : '2'}</span>
                <div>
                  <strong>Execution Plan</strong>
                  <small>
                    {project.planCompiled ? 'Đã chuẩn bị' : 'Chờ đủ Decision và Readiness'}
                  </small>
                </div>
              </li>
              <li
                className={
                  project.manifestApproved ? 'complete' : project.planCompiled ? 'ready' : 'waiting'
                }
              >
                <span>{project.manifestApproved ? <Check size={14} /> : '3'}</span>
                <div>
                  <strong>Approval Manifest</strong>
                  <small>{project.manifestApproved ? 'Đã phê duyệt' : 'Chờ review kế hoạch'}</small>
                </div>
              </li>
            </ol>

            {project.compilation ? (
              <dl className="s3-approval-basis">
                <div>
                  <dt>Nguồn đã ghim</dt>
                  <dd>{project.compilation.inputSourceCount.toString()}</dd>
                </div>
                <div>
                  <dt>Runtime</dt>
                  <dd>{project.compilation.runtime}</dd>
                </div>
                <div>
                  <dt>Phạm vi</dt>
                  <dd>
                    {project.compilation.rerunMode === 'scoped'
                      ? 'Chạy lại có phạm vi'
                      : 'Toàn bộ baseline'}
                  </dd>
                </div>
              </dl>
            ) : null}

            {planError !== null ? (
              <p className="s3-note" role="alert" aria-live="assertive">
                {planError}
              </p>
            ) : null}

            {project.manifestApproved ? (
              <div className="s3-approval-complete">
                <CheckCircle2 size={18} />
                <div>
                  <strong>Kế hoạch đã được phê duyệt</strong>
                  <p>TW-06 chỉ được thực thi theo Approval Manifest hiện hành.</p>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="s3-button"
                disabled={!canPreparePlan || preparingPlan}
                onClick={openPlanReview}
              >
                {preparingPlan
                  ? 'Đang chuẩn bị Execution Plan…'
                  : project.planCompiled
                    ? 'Xem và phê duyệt kế hoạch'
                    : 'Chuẩn bị Execution Plan'}
              </button>
            )}
            {!canPreparePlan && !project.manifestApproved ? (
              <p className="s3-approval-help">
                {pendingDecisions > 0
                  ? 'Hoàn tất các Decision bên trái trước khi compile.'
                  : 'Chạy Readiness Contract trong Vòng đời dự án trước khi compile.'}
              </p>
            ) : null}
          </aside>
        </div>
        {reviewOpen ? (
          <PlanReviewDialog
            onClose={() => {
              setReviewOpen(false);
            }}
          />
        ) : null}
      </div>
    </Workspace>
  );
}

function DecisionRow({ decision }: { decision: import('./types').System3Decision }): ReactElement {
  const [answer, setAnswer] = useState(decision.answer ?? decision.options[0] ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  return (
    <article className="s3-decision-card">
      <div className="s3-decision-head">
        <div>
          <h3>{decision.title}</h3>
          <p>{decision.question}</p>
        </div>
        <span className={`s3-chip ${decision.status === 'answered' ? 'good' : 'warn'}`}>
          {decision.status === 'answered' ? 'Đã xác nhận' : 'Cần quyết định'}
        </span>
      </div>
      {decision.status === 'pending' ? (
        <>
          <div className="s3-decision-why">
            <strong>Vì sao cần quyết định:</strong> {decision.why}
          </div>
          <fieldset className="s3-decision-options">
            <legend>Chọn một phương án</legend>
            {decision.options.map(option => (
              <label key={option} className={answer === option ? 'selected' : ''}>
                <input
                  type="radio"
                  name={`decision-${decision.id}`}
                  value={option}
                  checked={answer === option}
                  onChange={() => {
                    setAnswer(option);
                  }}
                />
                <span>{option}</span>
                {option === decision.options[0] ? <small>Khuyến nghị</small> : null}
              </label>
            ))}
          </fieldset>
          <div className="s3-decision-foot">
            <small>Ảnh hưởng: {decision.affectedPhases.join(' · ')}</small>
            <button
              type="button"
              className="s3-button"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                setSaveError(null);
                void system3Store
                  .answerDecision(decision.id, answer)
                  .catch(error => {
                    setSaveError(
                      error instanceof Error ? error.message : 'Không thể cập nhật decision'
                    );
                  })
                  .finally(() => {
                    setSaving(false);
                  });
              }}
            >
              {saving ? 'Đang lưu…' : 'Xác nhận lựa chọn'}
            </button>
          </div>
          {saveError !== null ? (
            <p className="s3-note" role="alert" aria-live="assertive">
              {saveError}
            </p>
          ) : null}
        </>
      ) : (
        <div className="s3-decision-answer">
          <Check size={16} />
          <div>
            <strong>{decision.answer}</strong>
            <small>Ảnh hưởng: {decision.affectedPhases.join(' · ')}</small>
          </div>
        </div>
      )}
    </article>
  );
}

function EvidencePage(): ReactElement {
  const project = useSystem3Project();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [traceability, setTraceability] = useState<{
    requirements: number;
    knowledgeFacts: number;
    openIssues: number;
    dependencyEdges: number;
    artifactVersions: number;
  } | null>(null);
  useEffect(() => {
    setLoadError(null);
    void Promise.all([
      system3Store.loadEvidence(),
      fetch(`/api/system3/projects/${project.id}/traceability`).then(async response => {
        if (!response.ok) throw new Error(`Không thể tải traceability (${response.status})`);
        setTraceability((await response.json()) as NonNullable<typeof traceability>);
      }),
    ]).catch(error => {
      setLoadError(error instanceof Error ? error.message : 'Không thể tải evidence');
    });
  }, [project.execution?.id, project.id]);
  const verifiedChecks = project.evidence.filter(evidence => evidence.status === 'passed');
  const requirementEvidence = project.evidence.filter(evidence => evidence.requirementId !== null);
  return (
    <Workspace>
      <div className="s3-page-card">
        <ProjectHeader showPrimaryAction={false} />
        <header className="s3-purpose-header">
          <div>
            <p className="s3-kicker">Kết quả & Bằng chứng</p>
            <h2>Đối soát toàn bộ project</h2>
            <p>
              Khác với Evidence của một activity trong Vòng đời, khu vực này tổng hợp traceability,
              kết quả runtime và mức bao phủ requirement trên toàn project.
            </p>
          </div>
          <Link
            className="s3-button s3-button-secondary no-underline"
            to={`/console/projects/${project.id}/flow`}
          >
            Xem theo activity <ArrowRight size={15} />
          </Link>
        </header>
        <section className="s3-card">
          <div className="s3-card-head">
            <div>
              <h2>Bằng chứng toàn project</h2>
              <p className="m-1 text-sm text-slate-500">
                Evidence runtime và requirement coverage là hai khái niệm khác nhau.
              </p>
            </div>
          </div>
          <div className="s3-card-body">
            {loadError !== null ? (
              <p className="s3-note" role="alert" aria-live="assertive">
                {loadError}
              </p>
            ) : null}
            <div className="s3-note">
              <strong>
                {project.evidence.length > 0
                  ? `${verifiedChecks.length.toString()} runtime check đã có evidence.`
                  : 'Chưa có verification evidence.'}
              </strong>{' '}
              Requirement coverage được báo riêng và không suy diễn từ baseline execution.
            </div>
            {traceability !== null ? (
              <div className="s3-review-grid" aria-label="Traceability đã chuẩn hóa">
                <ReviewItem label="Requirements" value={traceability.requirements.toString()} />
                <ReviewItem
                  label="Knowledge facts"
                  value={traceability.knowledgeFacts.toString()}
                />
                <ReviewItem label="Open issues" value={traceability.openIssues.toString()} />
                <ReviewItem
                  label="Dependency edges"
                  value={traceability.dependencyEdges.toString()}
                />
                <ReviewItem
                  label="Artifact versions"
                  value={traceability.artifactVersions.toString()}
                />
              </div>
            ) : null}
            <div className="s3-row">
              <div>
                <h3>Requirement coverage</h3>
                <p>
                  {requirementEvidence.length.toString()} requirement được theo dõi; full DESIGN_B_2
                  vẫn ngoài scope baseline MVP.
                </p>
                <small>Status: not_verified · verified: 0</small>
              </div>
              <span className="s3-chip warn">Not verified</span>
            </div>
            {project.evidence.map(evidence => (
              <div className="s3-row" key={evidence.id}>
                <div>
                  <h3>{evidence.requirementId ?? evidence.evidence[0] ?? 'Runtime check'}</h3>
                  <p>{evidence.reason ?? 'Deterministic runtime evidence đã pass.'}</p>
                  <small>{evidence.evidence.join(' · ') || 'Không có artifact claim'}</small>
                </div>
                <span className={`s3-chip ${evidence.status === 'passed' ? 'good' : 'warn'}`}>
                  {evidence.status}
                </span>
              </div>
            ))}
            <div className="s3-row">
              <div>
                <h3>Understanding provenance</h3>
                <p>Source hash, parser output và manual-review items đã được lưu cùng project.</p>
                <small>Status: available</small>
              </div>
              <span className="s3-chip good">Available</span>
            </div>
          </div>
        </section>
      </div>
    </Workspace>
  );
}

function DeliveryPage(): ReactElement {
  const project = useSystem3Project();
  const [delivering, setDelivering] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const activeSourceCount = new Set(
    project.sources.filter(source => source.status === 'ready').map(source => source.sourceId)
  ).size;
  const createDelivery = (): void => {
    setDelivering(true);
    setDeliveryError(null);
    void system3Store
      .deliver()
      .catch(error => {
        setDeliveryError(error instanceof Error ? error.message : 'Không thể tạo gói bàn giao');
      })
      .finally(() => {
        setDelivering(false);
      });
  };
  return (
    <Workspace>
      <div className="s3-page-card">
        <ProjectHeader showPrimaryAction={false} />
        <header className="s3-purpose-header">
          <div>
            <p className="s3-kicker">Bàn giao</p>
            <h2>Kiểm tra và tạo gói bàn giao</h2>
            <p>
              Khu vực này sở hữu Delivery Request, bản kê bàn giao và package cuối cùng. Vòng đời dự
              án chỉ hiển thị trạng thái tóm tắt của OP-08 và TW-09.
            </p>
          </div>
          <span
            className={`s3-status-badge ${project.deliveryAvailable ? 'completed' : project.deliveryReady ? 'ready' : 'waiting'}`}
          >
            {project.deliveryAvailable
              ? 'Đã tạo package'
              : project.deliveryReady
                ? 'Sẵn sàng yêu cầu'
                : 'Chưa đạt delivery gate'}
          </span>
        </header>

        <div className="s3-delivery-workspace">
          <section className="s3-delivery-gate" aria-labelledby="delivery-gate-title">
            <div>
              <span className="s3-operation-label">
                <LockKeyhole size={14} /> OP-08 · Delivery Request
              </span>
              <h2 id="delivery-gate-title">Điều kiện bàn giao</h2>
              <p>
                Anvil kiểm tra lại đúng execution, verification và phiên bản project trước khi chấp
                nhận yêu cầu đóng gói.
              </p>
            </div>
            <ul className="s3-delivery-checks">
              <li className={project.manifestApproved ? 'complete' : ''}>
                {project.manifestApproved ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}
                <span>
                  <strong>Kế hoạch đã phê duyệt</strong>
                  <small>Approval Manifest thuộc đúng project version</small>
                </span>
              </li>
              <li className={project.verification?.status === 'completed' ? 'complete' : ''}>
                {project.verification?.status === 'completed' ? (
                  <CheckCircle2 size={17} />
                ) : (
                  <Clock3 size={17} />
                )}
                <span>
                  <strong>Verification hiện hành</strong>
                  <small>Kết quả được kiểm tra độc lập trước khi đóng gói</small>
                </span>
              </li>
              <li className={project.freshness === 'current' ? 'complete' : ''}>
                {project.freshness === 'current' ? (
                  <CheckCircle2 size={17} />
                ) : (
                  <Clock3 size={17} />
                )}
                <span>
                  <strong>Nguồn và kết quả còn hiện hành</strong>
                  <small>Không dùng kết quả stale cho Delivery Request</small>
                </span>
              </li>
            </ul>
            {!project.deliveryAvailable && project.deliveryReady ? (
              <button
                type="button"
                className="s3-button"
                disabled={delivering}
                onClick={createDelivery}
              >
                {delivering ? 'Đang tạo gói bàn giao…' : 'Xác nhận và tạo gói bàn giao'}
              </button>
            ) : null}
            {deliveryError !== null ? (
              <p className="s3-note" role="alert" aria-live="assertive">
                {deliveryError}
              </p>
            ) : null}
            {!project.deliveryReady && !project.deliveryAvailable ? (
              <div className="s3-note">
                Hoàn tất compile, approval, execution và verification trước khi yêu cầu bàn giao.
              </div>
            ) : null}
          </section>

          <section className="s3-delivery-package" aria-labelledby="delivery-package-title">
            <div>
              <span className="s3-operation-label">
                <Workflow size={14} /> TW-09 · Deliver
              </span>
              <h2 id="delivery-package-title">Gói sản phẩm</h2>
              <p>
                Package bất biến đi cùng Delivery Manifest và hướng dẫn để người nhận có thể đối
                soát hoặc chạy lại.
              </p>
            </div>
            {project.delivery ? (
              <>
                <div className="s3-delivery-file">
                  <PackageCheck size={24} />
                  <div>
                    <strong>{project.delivery.packageFilename}</strong>
                    <small>{project.delivery.sizeBytes.toLocaleString('vi-VN')} bytes</small>
                  </div>
                  <a
                    className="s3-button s3-button-secondary"
                    href={`/api/system3/projects/${project.id}/delivery/package`}
                  >
                    Tải gói bàn giao
                  </a>
                </div>
                <dl className="s3-delivery-manifest-summary">
                  <div>
                    <dt>Project Workflow Version</dt>
                    <dd>{project.workflowVersion}</dd>
                  </div>
                  <div>
                    <dt>Source Version đang dùng</dt>
                    <dd>{activeSourceCount.toString()}</dd>
                  </div>
                  <div>
                    <dt>Verification</dt>
                    <dd>Đã hoàn tất</dd>
                  </div>
                </dl>
                <details className="s3-technical-resource">
                  <summary>Thông tin kỹ thuật của package</summary>
                  <p>Mã nội dung: {project.delivery.contentHash}</p>
                </details>
                <div className="s3-note">
                  Package hiện hành vẫn ghi rõ các requirement ngoài phạm vi hoặc chưa có Evidence;
                  trạng thái build thành công không tự động biến các khoảng trống đó thành verified.
                </div>
              </>
            ) : (
              <div className="s3-delivery-empty">
                <PackageCheck size={26} />
                <strong>Chưa có package</strong>
                <p>TW-09 chỉ bắt đầu sau khi người dùng gửi Delivery Request hợp lệ.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </Workspace>
  );
}

function TechnicalPage(): ReactElement {
  const project = useSystem3Project();
  const [abandoning, setAbandoning] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const latestRunId = project.execution?.workflowRunId ?? project.understandingRunId;
  const runHref = latestRunId ? `/console/p/${project.codebaseId}/r/${latestRunId}` : '/console';
  const abandonUnknownExecution = (): void => {
    const confirmed = window.confirm(
      'Thao tác này sẽ đánh dấu Workflow Run hiện tại là cancelled và đưa project về trạng thái đã approve. Chỉ tiếp tục khi bạn chắc chắn process cũ không còn chạy.'
    );
    if (!confirmed) return;
    setAbandoning(true);
    setRecoveryError(null);
    void system3Store
      .abandonUnknownOperation()
      .catch(error => {
        setRecoveryError(
          error instanceof Error ? error.message : 'Không thể đóng execution không xác định'
        );
      })
      .finally(() => {
        setAbandoning(false);
      });
  };
  return (
    <Workspace>
      <div className="s3-page-card">
        <ProjectHeader showPrimaryAction={false} />
        {project.operation?.status === 'unknown' ? (
          <section className="s3-technical-recovery" aria-labelledby="technical-recovery-title">
            <div>
              <p className="s3-kicker">Cần người dùng xác nhận</p>
              <h2 id="technical-recovery-title">Execution đang ở trạng thái không xác định</h2>
              <p>
                Anvil không tự đánh dấu thất bại vì công việc có thể vẫn chạy ở process khác. Kiểm
                tra Runs & logs trước khi đóng execution.
              </p>
            </div>
            <button
              type="button"
              className="s3-button"
              disabled={abandoning}
              onClick={abandonUnknownExecution}
            >
              {abandoning ? 'Đang xử lý…' : 'Xử lý execution không xác định'}
            </button>
            {recoveryError !== null ? (
              <p className="s3-note" role="alert" aria-live="assertive">
                {recoveryError}
              </p>
            ) : null}
          </section>
        ) : null}
        <section className="s3-card">
          <div className="s3-card-head">
            <div>
              <p className="s3-kicker">Advanced</p>
              <h2>Technical Console</h2>
              <p className="m-1 text-sm text-slate-500">
                Runs, nodes và provider logs nằm ở lớp kỹ thuật, tách khỏi Project Flow.
              </p>
            </div>
          </div>
          <div className="s3-card-body s3-technical-links">
            <a href={runHref}>
              <Play size={18} />
              <span>
                <strong>Runs & logs</strong>
                <small>
                  {latestRunId ? `Mở run ${latestRunId}` : 'Project chưa có workflow run.'}
                </small>
              </span>
              <ChevronRight size={17} />
            </a>
            <a href="/console/workflows">
              <GitBranch size={18} />
              <span>
                <strong>Workflow definitions</strong>
                <small>Xem fixed workflow và composition kỹ thuật.</small>
              </span>
              <ChevronRight size={17} />
            </a>
            <a href="/console/builder">
              <PanelLeftClose size={18} />
              <span>
                <strong>Workflow Studio</strong>
                <small>Experimental editor; không thuộc Customer Churn MVP.</small>
              </span>
              <ChevronRight size={17} />
            </a>
          </div>
        </section>
        <div className="s3-note mt-4">
          “Hiểu dự án” chạy qua generic workflow runtime; node I/O, event và artifact có thể kiểm
          tra trực tiếp bằng liên kết Runs & logs ở trên.
        </div>
      </div>
    </Workspace>
  );
}

function NewProjectPage(): ReactElement {
  const [step, setStep] = useState(1);
  const [projectName, setProjectName] = useState('Customer Churn MVP');
  const [description, setDescription] = useState('Dự đoán churn từ dữ liệu giao dịch e-commerce.');
  const [blueprintFile, setBlueprintFile] = useState<File | null>(null);
  const [datasetFile, setDatasetFile] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const copy: Record<number, ReactElement> = {
    1: (
      <>
        <h1>Thông tin dự án</h1>
        <p>Tạo một project Customer Churn có lifecycle, evidence và approval rõ ràng.</p>
        <div className="s3-form-grid">
          <label>
            <span>Tên project</span>
            <input
              value={projectName}
              onChange={event => {
                setProjectName(event.target.value);
              }}
            />
          </label>
          <label>
            <span>Mô tả ngắn</span>
            <textarea
              rows={3}
              value={description}
              onChange={event => {
                setDescription(event.target.value);
              }}
            />
          </label>
        </div>
      </>
    ),
    2: (
      <>
        <h1>Chọn workflow khởi đầu</h1>
        <p>MVP chỉ bật workflow đã được kiểm chứng; không tạo workflow tự do.</p>
        <div className="s3-option">
          <strong>Customer Churn Reference</strong>
          <span>DESIGN_B_2.md + Olist-like sample dataset · CPU only · 8 GB RAM</span>
        </div>
      </>
    ),
    3: (
      <>
        <h1>Nguồn dữ liệu</h1>
        <p>Tải source thật. Blueprint Markdown là bắt buộc; CSV dataset là tùy chọn ở MVP này.</p>
        <div className="s3-source-picker">
          <div>
            <FileCheck2 size={20} />
            <span>
              <strong>{blueprintFile?.name ?? 'Chưa chọn blueprint'}</strong>
              <small>
                Blueprint Markdown bắt buộc; được hash và lưu immutable sau khi tạo project.
              </small>
            </span>
            <span className={blueprintFile === null ? 's3-chip warn' : 's3-chip good'}>
              {blueprintFile === null ? 'Cần chọn' : 'Đã chọn'}
            </span>
          </div>
          <div>
            <FolderKanban size={20} />
            <span>
              <strong>{datasetFile?.name ?? 'Chưa chọn dataset'}</strong>
              <small>Dataset CSV là tùy chọn cho slice Hiểu dự án.</small>
            </span>
            <span className={datasetFile === null ? 's3-chip' : 's3-chip good'}>
              {datasetFile === null ? 'Tùy chọn' : 'Đã chọn'}
            </span>
          </div>
        </div>
        <div className="s3-form-grid mt-4">
          <label>
            <span>Blueprint Markdown *</span>
            <input
              type="file"
              accept=".md,text/markdown"
              onChange={event => {
                setBlueprintFile(event.target.files?.[0] ?? null);
              }}
            />
          </label>
          <label>
            <span>Dataset CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={event => {
                setDatasetFile(event.target.files?.[0] ?? null);
              }}
            />
          </label>
        </div>
      </>
    ),
    4: (
      <>
        <h1>Ràng buộc</h1>
        <p>Runtime profile được pin vào input snapshot trước compilation.</p>
        <div className="s3-constraint-grid">
          <label>
            <span>Compute</span>
            <strong>CPU only</strong>
          </label>
          <label>
            <span>Memory budget</span>
            <strong>8 GB RAM</strong>
          </label>
          <label>
            <span>Project mode</span>
            <strong>POC</strong>
          </label>
          <label>
            <span>Approval policy</span>
            <strong>Approve before build</strong>
          </label>
        </div>
      </>
    ),
    5: (
      <>
        <h1>Sẵn sàng phân tích đầu vào</h1>
        <p>
          Khi tạo project, Anvil sẽ lưu source bất biến rồi chạy “Hiểu dự án” để trích xuất các
          requirement, ràng buộc và manual-review item từ chính blueprint bạn đã tải lên.
        </p>
        <ol className="s3-analysis-list">
          {[
            'Pin source version và content hash',
            'Đọc và trích xuất blueprint',
            'Profile dataset CSV nếu có',
            'Tạo knowledge snapshot cùng source pointer',
            'Tạo decision từ manual-review item',
          ].map(item => (
            <li key={item}>
              <Check size={15} /> {item}
            </li>
          ))}
        </ol>
      </>
    ),
    6: (
      <>
        <h1>Tạo Project Flow</h1>
        <p>
          Project sẽ mở tại màn hình Nguồn để bạn xem báo cáo tiếp nhận và kết quả OP-01. Anvil chỉ
          bắt đầu “Hiểu dự án” sau khi bạn chủ động xác nhận.
        </p>
      </>
    ),
  };
  const last = step === 6;
  return (
    <Shell>
      <main className="s3-main" id="main-content">
        <section className="s3-wizard">
          <Link to="/console/projects" className="text-sm text-blue-700 no-underline">
            ← Quay lại projects
          </Link>
          <div className="s3-step-labels" aria-label={`Bước ${step.toString()} / 6`}>
            {['Thông tin', 'Workflow', 'Sources', 'Constraints', 'Analyze', 'Review'].map(
              (label, index) => (
                <div key={label} className={index + 1 <= step ? 'active' : ''}>
                  <span>{index + 1 < step ? '✓' : (index + 1).toString()}</span>
                  <small>{label}</small>
                </div>
              )
            )}
          </div>
          <div className="s3-card s3-wizard-panel">
            {copy[step]}
            <div className="s3-wizard-actions">
              <button
                type="button"
                className="s3-button s3-button-secondary"
                onClick={() => {
                  setStep(Math.max(1, step - 1));
                }}
                disabled={step === 1}
              >
                Quay lại
              </button>
              {last ? (
                <button
                  type="button"
                  className="s3-button"
                  disabled={submitting || blueprintFile === null}
                  onClick={() => {
                    const selectedBlueprint = blueprintFile;
                    if (selectedBlueprint === null) return;
                    setSubmitting(true);
                    setSubmitError(null);
                    void (async (): Promise<void> => {
                      const id = await system3Store.createProject(projectName, description);
                      await system3Store.uploadSource('blueprint', selectedBlueprint);
                      if (datasetFile !== null)
                        await system3Store.uploadSource('dataset', datasetFile);
                      navigate(`/console/projects/${id}/sources`);
                    })()
                      .catch(error => {
                        setSubmitError(
                          error instanceof Error ? error.message : 'Không thể tạo project'
                        );
                      })
                      .finally(() => {
                        setSubmitting(false);
                      });
                  }}
                >
                  {submitting ? 'Đang tạo project…' : 'Tạo và kiểm tra nguồn'}
                </button>
              ) : (
                <button
                  type="button"
                  className="s3-button"
                  onClick={() => {
                    setStep(step + 1);
                  }}
                >
                  Tiếp tục
                </button>
              )}
              {submitError !== null ? (
                <p className="s3-note" role="alert" aria-live="assertive">
                  {submitError}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      </main>
    </Shell>
  );
}

function HomePage(): ReactElement {
  const [projects, setProjects] = useState<System3ProjectResponse[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        setProjects(await listSystem3Projects());
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : 'Không thể tải projects');
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  return (
    <Shell>
      <main className="s3-main" id="main-content">
        <section className="s3-home">
          <p className="s3-kicker">Project control plane</p>
          <div className="s3-title-row">
            <div>
              <h1 className="s3-title">Dự án của bạn</h1>
              <p className="s3-subtitle">
                Biết dự án đang ở đâu, cần quyết định gì và evidence nào đang có.
              </p>
            </div>
            <Link className="s3-button no-underline" to="/console/projects/new">
              <Sparkles size={15} className="mr-1 inline" />
              Tạo project
            </Link>
          </div>
          {loading ? <p className="s3-note">Đang tải project…</p> : null}
          {loadError !== null ? (
            <p className="s3-note" role="alert" aria-live="assertive">
              {loadError}
            </p>
          ) : null}
          {!loading && loadError === null && projects.length === 0 ? (
            <section className="s3-card">
              <h2>Chưa có Anvil Project</h2>
              <p>Tạo project đầu tiên, tải blueprint lên và chạy “Hiểu dự án”.</p>
            </section>
          ) : null}
          <div className="s3-grid">
            {projects.map(project => (
              <Link
                key={project.id}
                to={`/console/projects/${project.id}/flow`}
                className="s3-card s3-project-card"
              >
                <div className="flex items-center justify-between gap-4">
                  <h2>{project.name}</h2>
                  <ChevronRight size={18} className="text-blue-600" />
                </div>
                <p>{project.description || 'Chưa có mô tả.'}</p>
                <div className="s3-meta">
                  <span className="s3-chip">{project.stage}</span>
                  <span className={project.attention === 'none' ? 's3-chip' : 's3-chip warn'}>
                    {project.attention}
                  </span>
                  <span className="s3-chip">v{project.version.toString()}</span>
                </div>
              </Link>
            ))}
          </div>
          <section className="s3-card s3-journey">
            <div className="s3-card-head">
              <div>
                <h2>Project Lifecycle của System 3</h2>
                <p className="m-1 text-sm text-slate-500">
                  Sáu giai đoạn lớn, bên trong là mười hoạt động có đầu vào và kết quả rõ ràng.
                </p>
              </div>
            </div>
            <div className="s3-journey-grid">
              {[
                ['01', 'Tiếp nhận', 'Nguồn được kiểm tra và lưu thành phiên bản bất biến.'],
                ['02', 'Hiểu dự án', 'Tạo bản hiểu có thể truy ngược về đúng nguồn.'],
                ['03', 'Sẵn sàng', 'Đóng Decision, chuẩn bị và phê duyệt kế hoạch.'],
                ['04', 'Xây dựng', 'Thực thi Project Workflow Version đã được duyệt.'],
                ['05', 'Xác minh', 'Kiểm tra kết quả độc lập bằng Evidence.'],
                ['06', 'Bàn giao', 'Tạo package bất biến sau yêu cầu rõ ràng.'],
              ].map(([number, title, detail]) => (
                <div key={number}>
                  <span>{number}</span>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </div>
              ))}
            </div>
          </section>
        </section>
      </main>
    </Shell>
  );
}

export function System3App(): ReactElement {
  return (
    <>
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="new" element={<NewProjectPage />} />
        <Route path=":projectId/flow" element={<FlowPage />} />
        <Route path=":projectId/overview" element={<OverviewPage />} />
        <Route path=":projectId/sources" element={<SourcesPage />} />
        <Route path=":projectId/decisions" element={<DecisionsPage />} />
        <Route path=":projectId/evidence" element={<EvidencePage />} />
        <Route path=":projectId/delivery" element={<DeliveryPage />} />
        <Route path=":projectId/technical" element={<TechnicalPage />} />
        <Route path="*" element={<Navigate to="/console/projects" replace />} />
      </Routes>
    </>
  );
}
