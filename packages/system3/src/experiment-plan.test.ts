import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'bun:test';
import { deriveExperimentPlan } from './experiment-plan';
import { understandProjectSources } from './understanding';

async function analyze(markdown: string | Uint8Array): ReturnType<typeof understandProjectSources> {
  const bytes = typeof markdown === 'string' ? new TextEncoder().encode(markdown) : markdown;
  return understandProjectSources({
    sources: [
      {
        id: 'source-1',
        kind: 'blueprint',
        filename: 'blueprint.md',
        mediaType: 'text/markdown',
        contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        bytes,
      },
    ],
    semanticFallback: () => Promise.reject(new Error('No LLM in experiment-plan tests')),
  });
}

describe('deriveExperimentPlan', () => {
  test('reads the four model options and the evaluation protocol from DESIGN_B_2', async () => {
    const bytes = new Uint8Array(
      await readFile(new URL('../../../docs/system_2/DESIGN_B_2.md', import.meta.url))
    );
    const plan = deriveExperimentPlan((await analyze(bytes)).analysis);
    expect(plan.variants.map(variant => [variant.id, variant.role, variant.recommended])).toEqual([
      ['logistic_regression', 'baseline', false],
      ['random_forest', 'candidate', false],
      ['xgboost', 'candidate', false],
      ['lightgbm', 'candidate', true],
    ]);
    expect(plan.variants.every(variant => variant.sourcePointers.length > 0)).toBe(true);
    expect(plan.techniques.map(item => [item.name, item.optional])).toEqual(
      expect.arrayContaining([
        ['Class Imbalance Handling - SMOTE', false],
        ['Customer Segmentation - K-means Clustering', true],
      ])
    );
    expect(plan.protocol).toMatchObject({
      task: 'binary_classification',
      idColumn: 'entity_id',
      targetColumn: 'target',
      split: { kind: 'time_holdout', timeColumn: 'cutoff_time' },
      primaryMetric: 'roc_auc',
    });
    expect(plan.protocol?.thresholds).toBeUndefined();
    expect(plan.reportedMetrics.slice(0, 3)).toEqual(['roc_auc', 'f1', 'recall']);
    expect(plan.gaps).toEqual([expect.objectContaining({ id: 'no_thresholds', blocking: false })]);
  });

  test('reports blocking gaps instead of guessing variants or metrics', async () => {
    const plan = deriveExperimentPlan(
      (
        await analyze(
          [
            '# Blueprint',
            '## 1. PROBLEM PROFILE',
            '**Business Goal:** Summarize sales.',
            '## 2. REQUIREMENTS CONTRACT',
            '| ID | Type | Priority | Source | Requirement | Acceptance Criteria |',
            '| --- | --- | --- | --- | --- | --- |',
            '| FR-01 | FR | HIGH | user | Sum sales per region. | Totals match the input. |',
          ].join('\n')
        )
      ).analysis
    );
    expect(plan.variants).toEqual([]);
    expect(plan.protocol).toBeNull();
    expect(plan.gaps.filter(gap => gap.blocking).map(gap => gap.id)).toEqual([
      'no_variants',
      'unsupported_task',
      'no_primary_metric',
    ]);
  });
});
