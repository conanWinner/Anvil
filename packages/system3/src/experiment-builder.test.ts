import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExperimentCodebase, type ExperimentGenerate } from './experiment-builder';
import type { ExperimentPlan } from './experiment-plan';
import { resolveMlRuntime } from './ml-runtime';
import { runExperimentVariants } from './experiment-runner';

const sandboxTest = process.env.ANVIL_SANDBOX_TESTS === 'true' ? test : test.skip;

const pointer = {
  sourceVersionId: 'source-1',
  filename: 'blueprint.md',
  headingPath: ['Tech'],
  startLine: 1,
  endLine: 1,
  jsonPointer: null,
  page: null,
  boundingBox: null,
};

const plan: ExperimentPlan = {
  schemaVersion: 1,
  variants: [
    {
      id: 'logistic_regression',
      name: 'Logistic Regression',
      role: 'baseline',
      recommended: false,
      requirementIds: ['FR-01'],
      rationale: null,
      sourcePointers: [pointer],
    },
    {
      id: 'random_forest',
      name: 'Random Forest',
      role: 'candidate',
      recommended: true,
      requirementIds: ['FR-01'],
      rationale: null,
      sourcePointers: [pointer],
    },
  ],
  techniques: [],
  protocol: {
    task: 'binary_classification',
    idColumn: 'entity_id',
    targetColumn: 'target',
    positiveLabel: '1',
    split: { kind: 'stratified_holdout', testFraction: 0.2, seed: 42 },
    primaryMetric: 'roc_auc',
  },
  reportedMetrics: ['roc_auc'],
  gaps: [],
};

const brokenPrepare = `import pandas as pd
frame = pd.read_csv('/work/data/customers.csv')
frame.rename(columns={'customer': 'entity_id'}).to_csv('/work/out/modeling_table.csv', index=False)
`;
const prepare = `import pandas as pd
frame = pd.read_csv('/work/data/customers.csv')
frame = frame.rename(columns={'customer': 'entity_id', 'churned': 'target'})
frame.to_csv('/work/out/modeling_table.csv', index=False)
`;
const trainVariant = `import argparse, json, os
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
parser = argparse.ArgumentParser(); parser.add_argument('--variant', required=True)
variant = parser.parse_args().variant
train = pd.read_csv('/work/data/train.csv'); test = pd.read_csv('/work/data/test_features.csv')
features = ['visits', 'spend']
model = {'logistic_regression': LogisticRegression(), 'random_forest': RandomForestClassifier(n_estimators=20, random_state=0)}[variant]
model.fit(train[features], train['target'])
score = model.predict_proba(test[features])[:, 1]
os.makedirs('/work/out/predictions', exist_ok=True); os.makedirs('/work/out/reported', exist_ok=True)
pd.DataFrame({'id': test['entity_id'], 'score': score, 'label': (score >= 0.5).astype(int)}).to_csv(f'/work/out/predictions/{variant}.csv', index=False)
json.dump({'train_rows': len(train)}, open(f'/work/out/reported/{variant}.json', 'w'))
`;

sandboxTest(
  'builder loop fixes failures from sandbox feedback and review before a run is ready',
  async () => {
    const runtime = await resolveMlRuntime();
    const root = await mkdtemp(join(tmpdir(), 'anvil-experiment-builder-'));
    const rawDataDir = join(root, 'raw');
    await mkdir(rawDataDir);
    const rows = Array.from({ length: 400 }, (_, index) => {
      const churned = index % 3 === 0 ? 1 : 0;
      return `c${index.toString()},${(churned ? 1 : 5 + (index % 4)).toString()},${(churned ? 10 : 80 + index).toString()},${churned.toString()}`;
    });
    await writeFile(
      join(rawDataDir, 'customers.csv'),
      ['customer,visits,spend,churned', ...rows].join('\n') + '\n'
    );

    const prompts: { role: string; prompt: string }[] = [];
    let prepareCalls = 0;
    let reviewCalls = 0;
    const generate: ExperimentGenerate = ({ role, prompt }) => {
      prompts.push({ role, prompt });
      if (role === 'reviewer') {
        reviewCalls += 1;
        return Promise.resolve(
          reviewCalls === 1
            ? {
                verdict: 'changes_required',
                summary: 'Missing seed',
                findings: [
                  { severity: 'blocking', file: 'train_variant.py', message: 'Set random_state' },
                ],
              }
            : { verdict: 'pass', summary: 'OK', findings: [] }
        );
      }
      if (prompt.includes('DATA PREPARATION')) {
        prepareCalls += 1;
        return Promise.resolve({
          files: [
            { path: 'prepare_data.py', content: prepareCalls === 1 ? brokenPrepare : prepare },
          ],
          notes: `prepare ${prepareCalls.toString()}`,
        });
      }
      return Promise.resolve({
        files: [{ path: 'train_variant.py', content: trainVariant }],
        notes: 'variants',
      });
    };

    const result = await buildExperimentCodebase({
      blueprint: '# Churn blueprint',
      plan,
      variantIds: ['logistic_regression', 'random_forest'],
      rawDataDir,
      projectDir: join(root, 'project'),
      workDir: join(root, 'work'),
      runtime,
      generate,
      maxFixRounds: 3,
      maxReviewRounds: 2,
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.events.map(event => `${event.stage}:${event.kind}`)).toEqual([
      'prepare:generated',
      'prepare:check_failed',
      'prepare:generated',
      'prepare:check_passed',
      'variants:generated',
      'variants:check_passed',
      'review:review',
      'variants:generated',
      'variants:check_passed',
      'review:review',
    ]);
    // Sandbox and review feedback reach the builder verbatim.
    expect(prompts[1]?.prompt).toContain("no column 'target'");
    expect(prompts.find(item => item.prompt.includes('reviewer found blocking'))?.prompt).toContain(
      'Set random_state'
    );
    expect(result.split.summary).toMatchObject({ rows: 400, testRows: 80 });
    expect(Object.keys(result.files).sort()).toEqual(['prepare_data.py', 'train_variant.py']);
    const testFeatures = await readFile(
      join(result.split.agentDataDir, 'test_features.csv'),
      'utf8'
    );
    expect(testFeatures.split('\n')[0]).toBe('entity_id,visits,spend');

    const run = await runExperimentVariants({
      runtime,
      projectDir: join(root, 'project'),
      agentDataDir: result.split.agentDataDir,
      holdoutDir: result.split.holdoutDir,
      protocol:
        plan.protocol ??
        (() => {
          throw new Error('protocol');
        })(),
      variantIds: ['logistic_regression', 'random_forest'],
      workDir: join(root, 'experiments'),
      timeoutMs: 120_000,
      signal: new AbortController().signal,
    });
    expect(run.runs.map(item => item.status)).toEqual(['completed', 'completed']);
    expect(run.evaluation.variants.logistic_regression?.status).toBe('verified');
    expect(run.evaluation.variants.random_forest).toMatchObject({
      status: 'verified',
      reportedTrainingMetrics: { train_rows: 320 },
    });
    expect(run.suggestion.ranking).toHaveLength(2);
    expect(run.suggestion.suggested).not.toBeNull();
  },
  600_000
);
