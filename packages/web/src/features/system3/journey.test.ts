import { describe, expect, test } from 'bun:test';
import { buildJourney } from './journey';
import type { LifecyclePhaseView } from './lifecycle-view';
import type { PhaseStatus } from './types';

function lifecycle(statuses: Record<LifecyclePhaseView['id'], PhaseStatus>): LifecyclePhaseView[] {
  return (Object.keys(statuses) as LifecyclePhaseView['id'][]).map(id => ({
    id,
    title: id,
    eyebrow: id,
    summary: '',
    objective: '',
    status: statuses[id],
    progress: 0,
    activities: [],
  }));
}

describe('buildJourney', () => {
  test('marks the first unfinished step as current and later steps as upcoming', () => {
    const steps = buildJourney(
      lifecycle({
        intake: 'completed',
        understanding: 'ready',
        readiness: 'not_started',
        build: 'not_started',
        verify: 'not_started',
        delivery: 'not_started',
      })
    );
    expect(steps.map(step => step.status)).toEqual([
      'done',
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
  });

  test('groups build and verify into one run step', () => {
    const steps = buildJourney(
      lifecycle({
        intake: 'completed',
        understanding: 'completed',
        readiness: 'completed',
        build: 'completed',
        verify: 'active',
        delivery: 'not_started',
      })
    );
    expect(steps[3]).toEqual({
      id: 'run',
      label: 'Chạy & kiểm tra',
      status: 'current',
      active: true,
    });
    expect(steps[4]?.status).toBe('upcoming');
  });

  test('surfaces blocked and stale phases instead of hiding them behind done steps', () => {
    const blocked = buildJourney(
      lifecycle({
        intake: 'completed',
        understanding: 'completed',
        readiness: 'blocked',
        build: 'not_started',
        verify: 'not_started',
        delivery: 'not_started',
      })
    );
    expect(blocked[2]?.status).toBe('attention');

    const stale = buildJourney(
      lifecycle({
        intake: 'completed',
        understanding: 'stale',
        readiness: 'completed',
        build: 'completed',
        verify: 'completed',
        delivery: 'completed',
      })
    );
    expect(stale.map(step => step.status)).toEqual(['done', 'stale', 'done', 'done', 'done']);
  });
});
