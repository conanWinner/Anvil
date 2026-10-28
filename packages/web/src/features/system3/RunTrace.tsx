import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleSlash,
  Loader2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  getSystem3OperationTrace,
  getSystem3ProjectHistory,
  type System3ExperimentProgressEvent,
  type System3OperationResponse,
} from '@/lib/api';
import { latestProjectOperation } from './store';
import {
  buildTraceView,
  formatTraceDuration,
  mergeTraceEvents,
  TRACE_ACTOR_LABELS,
  type TraceStageView,
  type TraceStepView,
} from './trace-view';
import type { System3Project } from './types';

type OperationRef = Pick<System3OperationResponse, 'id' | 'status'>;

const PENDING = new Set(['accepted', 'running']);
const POLL_MS = 2000;

function isPending(operation: OperationRef | null): boolean {
  return operation !== null && PENDING.has(operation.status);
}

/** Latest TW-06 operation of the project: the live one when present, else from history. */
function useExecuteOperation(project: System3Project): OperationRef | null {
  const live = project.operation?.type === 'execute' ? project.operation : undefined;
  const liveId = live?.id;
  const [fromHistory, setFromHistory] = useState<OperationRef | null>(null);
  useEffect(() => {
    if (liveId !== undefined) return undefined;
    let active = true;
    void getSystem3ProjectHistory(project.id).then(
      history => {
        if (!active) return;
        const latest = latestProjectOperation(
          history.operations.filter(operation => operation.type === 'execute')
        );
        setFromHistory(latest ? { id: latest.id, status: latest.status } : null);
      },
      () => {
        // History is optional context here; the run page still works without a past trace.
        if (active) setFromHistory(null);
      }
    );
    return (): void => {
      active = false;
    };
  }, [project.id, project.version, liveId]);
  return live ? { id: live.id, status: live.status } : fromHistory;
}

function useOperationTrace(operation: OperationRef | null): {
  events: System3ExperimentProgressEvent[];
  status: OperationRef['status'] | null;
  error: string | null;
} {
  const [events, setEvents] = useState<System3ExperimentProgressEvent[]>([]);
  const [status, setStatus] = useState<OperationRef['status'] | null>(operation?.status ?? null);
  const [error, setError] = useState<string | null>(null);
  const operationId = operation?.id ?? null;
  const pending = isPending(operation);

  useEffect(() => {
    setEvents([]);
    setError(null);
  }, [operationId]);
  useEffect(() => {
    setStatus(operation?.status ?? null);
  }, [operation?.status]);

  useEffect(() => {
    if (operationId === null) return undefined;
    let active = true;
    let poll: ReturnType<typeof setInterval> | undefined;
    let source: EventSource | undefined;
    const load = (): void => {
      void getSystem3OperationTrace(operationId).then(
        trace => {
          if (!active) return;
          setEvents(current => mergeTraceEvents(current, trace.events));
          setError(null);
        },
        (reason: unknown) => {
          if (active)
            setError(reason instanceof Error ? reason.message : 'Không thể tải tiến trình');
        }
      );
    };
    load();
    if (pending) {
      const startPolling = (): void => {
        poll ??= setInterval(load, POLL_MS);
      };
      if (typeof EventSource === 'undefined') startPolling();
      else {
        source = new EventSource(
          `/api/system3/operations/${encodeURIComponent(operationId)}/events`
        );
        source.addEventListener('trace', message => {
          const incoming = JSON.parse((message as MessageEvent<string>).data) as
            | System3ExperimentProgressEvent[]
            | undefined;
          if (active && Array.isArray(incoming))
            setEvents(current => mergeTraceEvents(current, incoming));
        });
        source.addEventListener('operation', message => {
          const projection = JSON.parse(
            (message as MessageEvent<string>).data
          ) as System3OperationResponse;
          if (!active) return;
          setStatus(projection.status);
          if (!PENDING.has(projection.status)) {
            source?.close();
            load();
          }
        });
        source.onerror = (): void => {
          // The stream ends normally after a terminal state; otherwise fall back to polling.
          source?.close();
          if (active) startPolling();
        };
      }
    }
    return (): void => {
      active = false;
      source?.close();
      if (poll) clearInterval(poll);
    };
  }, [operationId, pending]);

  return { events, status, error };
}

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return (): void => {
      clearInterval(timer);
    };
  }, [enabled]);
  return now;
}

function StatusMark({ status }: { status: TraceStepView['status'] | 'waiting' }): ReactElement {
  if (status === 'passed') return <Check className="s3t-mark passed" size={14} aria-hidden />;
  if (status === 'failed') return <X className="s3t-mark failed" size={14} aria-hidden />;
  if (status === 'running')
    return <Loader2 className="s3t-mark running s3t-spin" size={14} aria-hidden />;
  if (status === 'interrupted')
    return <CircleSlash className="s3t-mark failed" size={14} aria-hidden />;
  return <Circle className="s3t-mark waiting" size={12} aria-hidden />;
}

const STATUS_LABEL: Record<TraceStepView['status'], string> = {
  running: 'Đang chạy',
  passed: 'Xong',
  failed: 'Lỗi',
  interrupted: 'Bị ngắt',
};

function stepStatusLabel(step: TraceStepView): string {
  if (step.action === 'question') return 'Cần bạn';
  if (step.sentBack) return 'Lỗi → gửi lại agent';
  if (step.status === 'failed' && step.action === 'review') return 'Còn lỗi chặn';
  return STATUS_LABEL[step.status];
}

function TraceStep({
  step,
  open,
  now,
  onToggle,
}: {
  step: TraceStepView;
  open: boolean;
  now: number;
  onToggle: () => void;
}): ReactElement {
  const elapsed =
    step.durationMs ?? (step.status === 'running' ? now - Date.parse(step.startedAt) : null);
  const detailId = `s3t-detail-${step.step}`;
  return (
    <li className={`s3t-step ${step.status} ${step.action === 'question' ? 'question' : ''}`}>
      <button
        type="button"
        className="s3t-step-row"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <StatusMark status={step.status} />
        <span className="s3t-step-title">
          {step.title}
          <small>
            {TRACE_ACTOR_LABELS[step.actor]}
            {step.round > 1 ? ` · vòng ${step.round.toString()}` : ''}
          </small>
        </span>
        <span className={`s3t-step-status ${step.status}`}>{stepStatusLabel(step)}</span>
        <span className="s3t-step-time">
          {elapsed === null ? '—' : formatTraceDuration(elapsed)}
        </span>
      </button>
      {open ? (
        <div className="s3t-step-detail" id={detailId}>
          <dl>
            <div>
              <dt>Bắt đầu</dt>
              <dd>{new Date(step.startedAt).toLocaleTimeString('vi-VN')}</dd>
            </div>
            <div>
              <dt>Thực hiện</dt>
              <dd>{TRACE_ACTOR_LABELS[step.actor]}</dd>
            </div>
            {step.variantId ? (
              <div>
                <dt>Phương án</dt>
                <dd>{step.variantId}</dd>
              </div>
            ) : null}
          </dl>
          {step.detail ? (
            <pre className="s3t-log">{step.detail}</pre>
          ) : (
            <p className="s3t-muted">
              {step.status === 'running'
                ? 'Đang chờ kết quả…'
                : step.status === 'interrupted'
                  ? 'Lượt chạy kết thúc trước khi bước này báo kết quả.'
                  : 'Không có thêm chi tiết.'}
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}

function TraceStage({
  stage,
  index,
  now,
  openStep,
  onToggleStep,
  doneEarlier,
}: {
  stage: TraceStageView;
  index: number;
  /** A later stage already ran (a run after its build): this one was done by the earlier build. */
  doneEarlier: boolean;
  now: number;
  openStep: string | null;
  onToggleStep: (step: string) => void;
}): ReactElement {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const isOpen = expanded ?? (stage.status === 'running' || stage.status === 'failed');
  // Finished steps carry their duration; a running one counts its elapsed time so far.
  const runningMs = stage.steps.reduce(
    (total, step) =>
      step.status === 'running' && step.durationMs === null
        ? total + Math.max(0, now - Date.parse(step.startedAt))
        : total,
    0
  );
  const meta =
    stage.status === 'waiting'
      ? doneEarlier
        ? 'đã xong ở lượt xây dựng'
        : 'chưa bắt đầu'
      : `${stage.steps.length.toString()} bước · ${formatTraceDuration(stage.durationMs + runningMs)}`;
  return (
    <section className={`s3t-stage ${stage.status}`} aria-label={stage.title}>
      <button
        type="button"
        className="s3t-stage-head"
        aria-expanded={isOpen}
        disabled={stage.steps.length === 0}
        onClick={() => {
          setExpanded(!isOpen);
        }}
      >
        <span className={`s3t-stage-index ${stage.status}`}>
          {stage.status === 'passed' ? <Check size={13} aria-hidden /> : index + 1}
        </span>
        <strong>{stage.title}</strong>
        <span className="s3t-stage-meta">{meta}</span>
        {stage.steps.length > 0 ? (
          isOpen ? (
            <ChevronDown size={16} aria-hidden />
          ) : (
            <ChevronRight size={16} aria-hidden />
          )
        ) : null}
      </button>
      {isOpen && stage.steps.length > 0 ? (
        <ol className="s3t-steps">
          {stage.steps.map(step => (
            <TraceStep
              key={step.step}
              step={step}
              now={now}
              open={openStep === step.step}
              onToggle={() => {
                onToggleStep(step.step);
              }}
            />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/**
 * Live trace of the latest TW-06 run: every builder, reviewer, sandbox and scoring step as it
 * starts and finishes, so the user always sees what is happening and what failed.
 */
export function RunTrace({
  project,
  variantNames,
}: {
  project: System3Project;
  variantNames: ReadonlyMap<string, string>;
}): ReactElement | null {
  const operation = useExecuteOperation(project);
  const { events, status, error } = useOperationTrace(operation);
  const live = status !== null && PENDING.has(status);
  const stages = useMemo(
    () => buildTraceView(events, variantNames, live),
    [events, variantNames, live]
  );
  const steps = stages.flatMap(stage => stage.steps);
  const running = steps.find(step => step.status === 'running');
  const now = useNow(live);
  const [openStep, setOpenStep] = useState<string | null>(null);

  if (operation === null) return null;
  const first = steps.reduce<number | null>(
    (earliest, step) =>
      earliest === null
        ? Date.parse(step.startedAt)
        : Math.min(earliest, Date.parse(step.startedAt)),
    null
  );
  const lastEnd = steps.reduce(
    (latest, step) =>
      Math.max(
        latest,
        Date.parse(step.startedAt) +
          (step.durationMs ?? (step.status === 'running' ? now - Date.parse(step.startedAt) : 0))
      ),
    0
  );
  const elapsed = first === null ? null : (live ? now : lastEnd) - first;
  const agentCalls = steps.filter(step => step.actor === 'builder' || step.actor === 'reviewer');
  const sandboxRuns = steps.filter(step => step.actor === 'sandbox');
  const sandboxFailures = sandboxRuns.filter(step => step.status === 'failed').length;
  const question = steps.find(step => step.action === 'question');
  const headline = live
    ? 'Đang chạy'
    : status === 'succeeded'
      ? 'Đã xong'
      : status === 'failed'
        ? 'Dừng vì lỗi'
        : status === 'unknown'
          ? 'Không rõ trạng thái'
          : 'Đã dừng';

  return (
    <section className="s3t" aria-labelledby="s3t-title">
      <header className="s3t-head">
        <div>
          <h2 id="s3t-title">Tiến trình</h2>
          <p>Bấm vào một bước để xem chi tiết, log và nội dung Anvil gửi lại cho agent.</p>
        </div>
        <span
          className={`s3t-badge ${live ? 'running' : status === 'succeeded' ? 'passed' : 'failed'}`}
        >
          {live ? <span className="s3t-pulse" aria-hidden /> : null}
          {headline}
        </span>
      </header>
      <dl className="s3t-stats">
        <div>
          <dt>Đã chạy</dt>
          <dd>{elapsed === null ? '—' : formatTraceDuration(elapsed)}</dd>
        </div>
        <div>
          <dt>Bước hiện tại</dt>
          <dd>{running ? running.title : live ? 'Đang chuẩn bị…' : '—'}</dd>
        </div>
        <div>
          <dt>Lượt gọi agent</dt>
          <dd>{agentCalls.length.toString()}</dd>
        </div>
        <div>
          <dt>Lần chạy sandbox</dt>
          <dd>
            {sandboxRuns.length.toString()}
            {sandboxFailures > 0 ? <small> · {sandboxFailures.toString()} lỗi</small> : null}
          </dd>
        </div>
      </dl>
      {question ? (
        <p className="s3t-question" role="status">
          <AlertTriangle size={16} aria-hidden="true" /> Agent dừng lại và hỏi bạn — xem bước “Agent
          cần bạn quyết định” bên dưới.
        </p>
      ) : null}
      {error ? (
        <p className="s3-note" role="alert">
          {error}
        </p>
      ) : null}
      {steps.length === 0 ? (
        <p className="s3t-muted s3t-empty">
          {live
            ? 'Đang khởi tạo môi trường chạy; bước đầu tiên sẽ hiện ở đây.'
            : 'Lượt chạy này không ghi tiến trình (chạy trước khi có tính năng theo dõi).'}
        </p>
      ) : (
        <div className="s3t-stages">
          {stages.map((stage, index) => (
            <TraceStage
              key={stage.id}
              stage={stage}
              index={index}
              doneEarlier={stages.slice(index + 1).some(later => later.status !== 'waiting')}
              now={now}
              openStep={openStep}
              onToggleStep={step => {
                setOpenStep(current => (current === step ? null : step));
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
