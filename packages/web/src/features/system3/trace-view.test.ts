import { describe, expect, test } from 'bun:test';
import type { System3ExperimentProgressEvent } from '@/lib/api';
import { buildTraceView, formatTraceDuration, mergeTraceEvents } from './trace-view';

function event(
  seq: number,
  partial: Partial<System3ExperimentProgressEvent> &
    Pick<System3ExperimentProgressEvent, 'step' | 'stage' | 'action' | 'status'>
): System3ExperimentProgressEvent {
  return {
    seq,
    at: new Date(Date.UTC(2026, 9, 27, 7, 0, seq)).toISOString(),
    round: 1,
    variantId: null,
    detail: '',
    durationMs: partial.status === 'running' ? null : 1000,
    ...partial,
  };
}

const events: System3ExperimentProgressEvent[] = [
  event(0, { step: 'a', stage: 'prepare', action: 'generate', status: 'running' }),
  event(1, { step: 'a', stage: 'prepare', action: 'generate', status: 'passed', detail: 'notes' }),
  event(2, { step: 'b', stage: 'prepare', action: 'prepare_data', status: 'running' }),
  event(3, {
    step: 'b',
    stage: 'prepare',
    action: 'prepare_data',
    status: 'failed',
    detail: 'KeyError',
  }),
  event(4, { step: 'c', stage: 'prepare', action: 'generate', status: 'running', round: 2 }),
];

describe('buildTraceView', () => {
  test('shows one row per step with its latest state, grouped by stage', () => {
    const [prepare, variants, review, run] = buildTraceView(events);
    expect(prepare?.status).toBe('running');
    expect(prepare?.steps.map(step => [step.title, step.status, step.actor])).toEqual([
      ['Viết prepare_data.py', 'passed', 'builder'],
      ['Chạy prepare_data.py trên dữ liệu đã ghim', 'failed', 'sandbox'],
      ['Sửa prepare_data.py', 'running', 'builder'],
    ]);
    expect(prepare?.steps[1]?.detail).toBe('KeyError');
    expect([variants?.status, review?.status, run?.status]).toEqual([
      'waiting',
      'waiting',
      'waiting',
    ]);
  });

  test('keeps a finished outcome when its running event arrives later', () => {
    const [prepare] = buildTraceView([events[1], events[0]].filter(item => item !== undefined));
    expect(prepare?.steps).toHaveLength(1);
    expect(prepare?.steps[0]).toMatchObject({ status: 'passed', detail: 'notes' });
    expect(prepare?.status).toBe('passed');
  });

  test('shows an unfinished step as interrupted once the operation has ended', () => {
    const [prepare] = buildTraceView(events, new Map(), false);
    expect(prepare?.steps.at(-1)?.status).toBe('interrupted');
    expect(prepare?.status).toBe('failed');
  });

  test('marks a sandbox failure as sent back only when a later fix round followed it', () => {
    const [sent] = buildTraceView(events);
    expect(sent?.steps[1]?.sentBack).toBe(true);
    const lastRound = events.slice(0, 4);
    const [stopped] = buildTraceView(lastRound, new Map(), false);
    expect(stopped?.steps[1]?.sentBack).toBe(false);
  });

  test('titles a builder step as a fix when its stage already had one, whatever the round', () => {
    const [prepare] = buildTraceView([
      event(0, { step: 'a', stage: 'prepare', action: 'generate', status: 'passed' }),
      event(1, { step: 'r', stage: 'review', action: 'review', status: 'failed' }),
      event(2, { step: 'b', stage: 'prepare', action: 'generate', status: 'passed', round: 1 }),
    ]);
    expect(prepare?.steps.map(step => step.title)).toEqual([
      'Viết prepare_data.py',
      'Sửa prepare_data.py',
    ]);
  });

  test('names variant runs and marks a failed last step', () => {
    const [, , , run] = buildTraceView(
      [
        event(0, {
          step: 'v',
          stage: 'run',
          action: 'variant_run',
          status: 'failed',
          variantId: 'xgboost',
        }),
      ],
      new Map([['xgboost', 'XGBoost']])
    );
    expect(run?.steps[0]?.title).toBe('Chạy XGBoost');
    expect(run?.status).toBe('failed');
  });
});

describe('mergeTraceEvents', () => {
  test('adds only unseen step states and keeps chronological order', () => {
    const merged = mergeTraceEvents(events.slice(0, 2), [
      events[1],
      events[3],
      events[2],
    ] as System3ExperimentProgressEvent[]);
    expect(merged.map(item => item.seq)).toEqual([0, 1, 2, 3]);
  });
});

describe('formatTraceDuration', () => {
  test('formats seconds, minutes and hours', () => {
    expect(formatTraceDuration(42_000)).toBe('42s');
    expect(formatTraceDuration(185_000)).toBe('3m 05s');
    expect(formatTraceDuration(3_720_000)).toBe('1h 02m');
  });
});
