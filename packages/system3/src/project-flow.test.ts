import { expect, test } from 'bun:test';
import { buildProjectPhases } from './project-flow';

test('marks project understanding stale when an immutable source changes', () => {
  const phases = buildProjectPhases({
    understood: true,
    pendingDecisions: 0,
    freshness: 'partially_stale',
  });

  expect(phases.find(phase => phase.id === 'understanding')?.status).toBe('stale');
  expect(phases.find(phase => phase.id === 'readiness')?.status).toBe('waiting');
});

test('readiness is blocked only by unresolved decisions on current knowledge', () => {
  const phases = buildProjectPhases({
    understood: true,
    pendingDecisions: 2,
    freshness: 'current',
  });

  expect(phases.find(phase => phase.id === 'understanding')?.status).toBe('completed');
  expect(phases.find(phase => phase.id === 'readiness')?.status).toBe('blocked');
});
