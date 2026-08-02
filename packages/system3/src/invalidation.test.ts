import { expect, test } from 'bun:test';
import { affectedPhasesForSource } from './invalidation';

test('blueprint changes invalidate the complete downstream product flow', () => {
  expect(affectedPhasesForSource('blueprint')).toEqual([
    'understanding',
    'readiness',
    'data',
    'features',
    'experiments',
    'explainability',
    'delivery',
  ]);
});

test('dataset and constraint changes preserve unaffected upstream work', () => {
  expect(affectedPhasesForSource('dataset')).toEqual([
    'understanding',
    'readiness',
    'data',
    'features',
    'experiments',
    'explainability',
    'delivery',
  ]);
  expect(affectedPhasesForSource('constraints')).toEqual([
    'readiness',
    'data',
    'features',
    'experiments',
    'explainability',
    'delivery',
  ]);
});
