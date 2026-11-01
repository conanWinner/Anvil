import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateExperimentPredictions,
  rankExperimentVariants,
  splitModelingTable,
  type EvaluationProtocol,
  type ExperimentEvaluation,
} from './experiment-evaluation';
import { resolveMlRuntime } from './ml-runtime';

const sandboxTest = process.env.ANVIL_SANDBOX_TESTS === 'true' ? test : test.skip;

const protocol: EvaluationProtocol = {
  task: 'binary_classification',
  idColumn: 'customer_id',
  targetColumn: 'churn',
  positiveLabel: '1',
  split: { kind: 'stratified_holdout', testFraction: 0.25, seed: 7 },
  primaryMetric: 'roc_auc',
};

function verified(roc: number, f1: number): ExperimentEvaluation['variants'][string] {
  return {
    status: 'verified',
    metrics: { roc_auc: roc, pr_auc: roc, f1, recall: f1, precision: f1, accuracy: f1 },
    reportedTrainingMetrics: {},
    predictionsHash: 'sha256:x',
  };
}

describe('rankExperimentVariants', () => {
  test('ranks verified variants by the primary metric and lists faster near-best ones', () => {
    const suggestion = rankExperimentVariants({
      protocol,
      evaluation: {
        testRows: 100,
        variants: {
          logistic: verified(0.81, 0.6),
          lightgbm: verified(0.9, 0.7),
          random_forest: verified(0.895, 0.72),
          xgboost: { status: 'invalid_predictions', error: 'bad ids' },
        },
      },
      durations: { logistic: 1_000, lightgbm: 60_000, random_forest: 20_000 },
    });
    expect(suggestion.ranking.map(item => item.variant)).toEqual([
      'lightgbm',
      'random_forest',
      'logistic',
    ]);
    expect(suggestion.suggested).toBe('lightgbm');
    expect(suggestion.reasons).toEqual(['highest_primary_metric']);
    expect(suggestion.fasterAlternatives).toEqual(['random_forest']);
    expect(suggestion.unverified).toEqual(['xgboost']);
  });

  test('reports thresholds and never suggests an unverified variant', () => {
    const withThreshold = { ...protocol, thresholds: { roc_auc: 0.85 } };
    expect(
      rankExperimentVariants({
        protocol: withThreshold,
        evaluation: { testRows: 10, variants: { a: verified(0.8, 0.5), b: verified(0.7, 0.5) } },
      }).reasons
    ).toEqual(['highest_primary_metric', 'no_variant_meets_thresholds']);
    expect(
      rankExperimentVariants({
        protocol,
        evaluation: { testRows: 10, variants: { a: { status: 'missing', error: 'none' } } },
      })
    ).toMatchObject({ suggested: null, ranking: [], unverified: ['a'] });
    expect(
      rankExperimentVariants({
        protocol,
        evaluation: { testRows: 10, variants: { a: verified(0.5, 0.9), b: verified(0.49, 0.9) } },
      }).reasons
    ).toEqual(['highest_primary_metric', 'no_better_than_chance']);
  });
});

sandboxTest(
  'Anvil splits once, hides held-out labels and recomputes metrics from predictions',
  async () => {
    const runtime = await resolveMlRuntime();
    const root = await mkdtemp(join(tmpdir(), 'anvil-experiment-eval-'));
    const rows = Array.from({ length: 200 }, (_, index) => {
      const churn = index % 4 === 0 ? 1 : 0;
      return `c${index.toString()},${(churn * 3 + (index % 3)).toString()},2018-01-${((index % 28) + 1).toString().padStart(2, '0')},${churn.toString()}`;
    });
    const tablePath = join(root, 'table.csv');
    await writeFile(tablePath, ['customer_id,feature,last_seen,churn', ...rows].join('\n') + '\n');

    const split = await splitModelingTable({
      runtime,
      tablePath,
      protocol,
      workDir: join(root, 'work'),
      signal: new AbortController().signal,
    });
    expect(split.summary).toMatchObject({
      rows: 200,
      trainRows: 120,
      validationRows: 30,
      testRows: 50,
    });
    const validationIds = (await readFile(join(split.holdoutDir, 'validation_labels.csv'), 'utf8'))
      .trim()
      .split('\n')
      .slice(1)
      .map(line => line.split(',')[0]);
    const validationFeatures = await readFile(
      join(split.agentDataDir, 'validation_features.csv'),
      'utf8'
    );
    expect(validationFeatures.split('\n')[0]).toBe('customer_id,feature,last_seen');
    expect(validationIds).toHaveLength(30);
    expect(split.summary.testPositiveRate).toBeCloseTo(0.24, 1);
    const testFeatures = await readFile(join(split.agentDataDir, 'test_features.csv'), 'utf8');
    expect(testFeatures.split('\n')[0]).toBe('customer_id,feature,last_seen');
    const labels = (await readFile(join(split.holdoutDir, 'test_labels.csv'), 'utf8'))
      .trim()
      .split('\n')
      .slice(1)
      .map(line => line.split(','));

    const predictionsDir = join(root, 'agent-out', 'predictions');
    const reportedDir = join(root, 'agent-out', 'reported');
    await Promise.all([
      mkdir(predictionsDir, { recursive: true }),
      mkdir(reportedDir, { recursive: true }),
    ]);
    const perfect = ['id,score', ...labels.map(([id, target]) => `${id},${target}`)].join('\n');
    const inverted = [
      'id,score',
      ...labels.map(([id, target]) => `${id},${target === '1' ? '0.1' : '0.9'}`),
    ].join('\n');
    await Promise.all([
      writeFile(join(predictionsDir, 'oracle.csv'), perfect + '\n'),
      writeFile(join(predictionsDir, 'inverted.csv'), inverted + '\n'),
      writeFile(join(predictionsDir, 'partial.csv'), perfect.split('\n').slice(0, 10).join('\n')),
      writeFile(join(reportedDir, 'oracle.json'), JSON.stringify({ cv_roc_auc: 0.99 })),
      // Regression: an extra `target` column used to collide with the held-out labels in the merge.
      writeFile(
        join(predictionsDir, 'extra_target.csv'),
        ['id,score,target', ...labels.map(([id, target]) => `${id},${target},0`)].join('\n') + '\n'
      ),
      // Regression: a corrupt reported file used to abort the evaluation of every variant.
      writeFile(join(predictionsDir, 'corrupt_reported.csv'), perfect + '\n'),
      writeFile(join(reportedDir, 'corrupt_reported.json'), '{not json'),
    ]);

    const evaluation = await evaluateExperimentPredictions({
      runtime,
      variants: ['oracle', 'inverted', 'partial', 'absent', 'extra_target', 'corrupt_reported'],
      holdoutDir: split.holdoutDir,
      predictionsDir,
      reportedDir,
      workDir: join(root, 'work'),
      signal: new AbortController().signal,
    });
    expect(evaluation.testRows).toBe(50);
    expect(evaluation.variants.oracle).toMatchObject({
      status: 'verified',
      metrics: { roc_auc: 1, f1: 1, accuracy: 1 },
      reportedTrainingMetrics: { cv_roc_auc: 0.99 },
    });
    expect(evaluation.variants.inverted).toMatchObject({
      status: 'verified',
      metrics: { roc_auc: 0, recall: 0 },
    });
    expect(evaluation.variants.partial?.status).toBe('invalid_predictions');
    expect(evaluation.variants.absent?.status).toBe('missing');
    expect(evaluation.variants.extra_target).toMatchObject({
      status: 'verified',
      metrics: { roc_auc: 1, accuracy: 1 },
    });
    const corrupt = evaluation.variants.corrupt_reported;
    expect(corrupt).toMatchObject({
      status: 'verified',
      metrics: { roc_auc: 1 },
      reportedTrainingMetrics: {},
    });
    expect(corrupt?.status === 'verified' ? corrupt.warnings?.[0] : undefined).toContain(
      'unreadable reported metrics'
    );
    // Three variants score a perfect 1.0; with no durations the tie breaks by name.
    expect(rankExperimentVariants({ protocol, evaluation }).suggested).toBe('corrupt_reported');
  },
  180_000
);

sandboxTest(
  'warns when a blank column alone gives away the target, and not for harmless blanks',
  async () => {
    const runtime = await resolveMlRuntime();
    const root = await mkdtemp(join(tmpdir(), 'anvil-missingness-'));
    const rows = Array.from({ length: 400 }, (_, index) => {
      const churn = index % 4 === 0 ? 1 : 0;
      // `delivery` is blank mostly for the positive class, as a post-label mask would make it.
      const delivery = churn === 1 && index % 8 === 0 ? '' : '3.5';
      const noise = index % 5 === 0 ? '' : '1';
      return `c${index.toString()},${delivery},${noise},${churn.toString()}`;
    });
    const tablePath = join(root, 'table.csv');
    await writeFile(tablePath, ['customer_id,delivery,noise,churn', ...rows].join('\n') + '\n');
    const { summary } = await splitModelingTable({
      runtime,
      tablePath,
      protocol,
      workDir: join(root, 'work'),
      signal: new AbortController().signal,
    });
    expect(summary.warnings.filter(item => item.includes("'delivery'"))).toHaveLength(1);
    expect(summary.warnings.filter(item => item.includes("'noise'"))).toEqual([]);
  },
  180_000
);

test('a linked modeling table is refused before anything reads it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anvil-linked-table-'));
  await writeFile(join(root, 'secret.csv'), 'entity_id,target\n');
  await mkdir(join(root, 'out'));
  await symlink(join(root, 'secret.csv'), join(root, 'out', 'modeling_table.csv'));
  await expect(
    splitModelingTable({
      runtime: { dir: '/unused', python: '/unused', lockHash: 'sha256:unused' },
      tablePath: join(root, 'out', 'modeling_table.csv'),
      protocol: {
        task: 'binary_classification',
        idColumn: 'entity_id',
        targetColumn: 'target',
        positiveLabel: '1',
        split: { kind: 'stratified_holdout', testFraction: 0.2, seed: 42 },
        primaryMetric: 'roc_auc',
      },
      workDir: join(root, 'work'),
      signal: new AbortController().signal,
    })
  ).rejects.toThrow('must be a regular file');
});
