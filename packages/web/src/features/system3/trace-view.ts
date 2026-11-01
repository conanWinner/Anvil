import type { System3ExperimentProgressEvent } from '@/lib/api';

/** `interrupted`: the step never reported an outcome and the operation is no longer running. */
export type TraceStepStatus = System3ExperimentProgressEvent['status'] | 'interrupted';
export type TraceActor = 'builder' | 'reviewer' | 'sandbox' | 'anvil';
export type TraceStageId = System3ExperimentProgressEvent['stage'];

export interface TraceStepView {
  step: string;
  stage: TraceStageId;
  action: System3ExperimentProgressEvent['action'];
  actor: TraceActor;
  title: string;
  status: TraceStepStatus;
  round: number;
  variantId: string | null;
  startedAt: string;
  durationMs: number | null;
  detail: string;
  /** A failed sandbox step whose error went back to the builder in a later fix round. */
  sentBack: boolean;
}

export interface TraceStageView {
  id: TraceStageId;
  title: string;
  status: 'waiting' | 'running' | 'passed' | 'failed';
  steps: TraceStepView[];
  durationMs: number;
}

export const TRACE_STAGE_TITLES: Record<TraceStageId, string> = {
  prepare: 'Chuẩn bị dữ liệu',
  variants: 'Code phương án',
  review: 'Review code',
  run: 'Chạy phương án',
};

export const TRACE_ACTOR_LABELS: Record<TraceActor, string> = {
  builder: 'Agent thi công',
  reviewer: 'Agent review',
  sandbox: 'Sandbox',
  anvil: 'Anvil',
};

const ACTOR: Record<System3ExperimentProgressEvent['action'], TraceActor> = {
  sandbox_check: 'anvil',
  generate: 'builder',
  question: 'builder',
  review: 'reviewer',
  prepare_data: 'sandbox',
  contract_check: 'anvil',
  smoke: 'sandbox',
  variant_run: 'sandbox',
  split: 'anvil',
  evaluate: 'anvil',
};

function stepTitle(
  event: System3ExperimentProgressEvent,
  variantNames: ReadonlyMap<string, string>
): string {
  switch (event.action) {
    case 'sandbox_check':
      return 'Kiểm tra sandbox trước khi gọi agent';
    case 'generate': {
      const file = event.stage === 'prepare' ? 'prepare_data.py' : 'train_variant.py';
      return event.round > 1 ? `Sửa ${file}` : `Viết ${file}`;
    }
    case 'prepare_data':
      return 'Chạy prepare_data.py trên dữ liệu đã ghim';
    case 'contract_check':
      return 'Kiểm tra điều kiện nghiệm thu trên ca mẫu đã duyệt';
    case 'split':
      return 'Chia dữ liệu, giữ nhãn kiểm tra';
    case 'smoke':
      return event.round === 0 ? 'Chạy thử lại trên mẫu' : 'Chạy thử trên mẫu';
    case 'review':
      return 'Kiểm tra rò rỉ dữ liệu, cách chia, metric';
    case 'question':
      return 'Agent cần bạn quyết định';
    case 'variant_run':
      return `Chạy ${event.variantId ? (variantNames.get(event.variantId) ?? event.variantId) : 'phương án'}`;
    case 'evaluate':
      return 'Chấm điểm bằng nhãn giữ riêng';
  }
}

/** Merges events into new ones not seen yet, keyed by step and status (idempotent). */
export function mergeTraceEvents(
  current: readonly System3ExperimentProgressEvent[],
  incoming: readonly System3ExperimentProgressEvent[]
): System3ExperimentProgressEvent[] {
  const seen = new Set(current.map(event => `${event.step}:${event.status}`));
  const fresh = incoming.filter(event => !seen.has(`${event.step}:${event.status}`));
  if (fresh.length === 0) return [...current];
  return [...current, ...fresh].sort(
    (left, right) => left.at.localeCompare(right.at) || left.seq - right.seq
  );
}

/**
 * One row per step (its latest state), grouped by stage in lifecycle order. With `live` false
 * (the operation ended), steps still marked running are shown as interrupted, never as running.
 */
export function buildTraceView(
  events: readonly System3ExperimentProgressEvent[],
  variantNames: ReadonlyMap<string, string> = new Map(),
  live = true
): TraceStageView[] {
  const steps = new Map<string, TraceStepView>();
  for (const event of events) {
    const existing = steps.get(event.step);
    const finished = event.status !== 'running';
    // A finished event wins over the running one, whichever arrives first.
    if (existing && existing.status !== 'running' && existing.status !== 'interrupted' && !finished)
      continue;
    steps.set(event.step, {
      step: event.step,
      stage: event.stage,
      action: event.action,
      actor: ACTOR[event.action],
      title: stepTitle(event, variantNames),
      status: event.status === 'running' && !live ? 'interrupted' : event.status,
      round: event.round,
      variantId: event.variantId,
      startedAt:
        existing?.startedAt ??
        (event.durationMs === null
          ? event.at
          : new Date(Date.parse(event.at) - event.durationMs).toISOString()),
      durationMs: event.durationMs,
      detail: event.detail.length > 0 ? event.detail : (existing?.detail ?? ''),
      sentBack: false,
    });
  }
  // Steps keep first-seen (chronological) order, so a later builder round in the same stage is
  // what proves a sandbox error was sent back; the last failure of a stage was not.
  const ordered = [...steps.values()];
  // A review can send the builder back to a stage with its round counter at 1 again, so the
  // title follows what happened: any builder step after an earlier one in its stage is a fix.
  ordered.forEach((step, index) => {
    if (
      step.action === 'generate' &&
      ordered
        .slice(0, index)
        .some(earlier => earlier.stage === step.stage && earlier.action === 'generate')
    )
      step.title = `Sửa ${step.stage === 'prepare' ? 'prepare_data.py' : 'train_variant.py'}`;
  });
  ordered.forEach((step, index) => {
    if (
      step.status !== 'failed' ||
      (step.action !== 'prepare_data' &&
        step.action !== 'contract_check' &&
        step.action !== 'smoke')
    )
      return;
    step.sentBack = ordered
      .slice(index + 1)
      .some(later => later.stage === step.stage && later.action === 'generate');
  });
  return (Object.keys(TRACE_STAGE_TITLES) as TraceStageId[]).map(id => {
    const stageSteps = [...steps.values()].filter(step => step.stage === id);
    const last = stageSteps.at(-1);
    return {
      id,
      title: TRACE_STAGE_TITLES[id],
      status:
        last === undefined
          ? 'waiting'
          : stageSteps.some(step => step.status === 'running')
            ? 'running'
            : last.status === 'failed' || last.status === 'interrupted'
              ? 'failed'
              : 'passed',
      steps: stageSteps,
      durationMs: stageSteps.reduce((total, step) => total + (step.durationMs ?? 0), 0),
    };
  });
}

/** Short Vietnamese duration: 42s, 3m 05s, 1h 02m. */
export function formatTraceDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds.toString()}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes.toString()}m ${(seconds % 60).toString().padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60).toString()}h ${(minutes % 60).toString().padStart(2, '0')}m`;
}
