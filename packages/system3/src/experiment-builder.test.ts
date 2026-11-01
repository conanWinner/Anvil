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
  excerptHash: 'sha256:excerpt',
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
parser = argparse.ArgumentParser(); parser.add_argument('--variant', required=True); parser.add_argument('--params', default='{}')
args = parser.parse_args(); variant = args.variant
params = {'logistic_regression': {'max_iter': 100}, 'random_forest': {'n_estimators': 20}}[variant]
for name, value in json.loads(args.params).items():
    if name not in params: raise SystemExit(f'unknown parameter {name}')
    params[name] = value
train = pd.read_csv('/work/data/train.csv'); test = pd.read_csv('/work/data/test_features.csv')
features = ['visits', 'spend']
model = LogisticRegression(**params) if variant == 'logistic_regression' else RandomForestClassifier(random_state=0, **params)
model.fit(train[features], train['target'])
score = model.predict_proba(test[features])[:, 1]
os.makedirs('/work/out/predictions', exist_ok=True); os.makedirs('/work/out/reported', exist_ok=True)
pd.DataFrame({'id': test['entity_id'], 'score': score, 'label': (score >= 0.5).astype(int)}).to_csv(f'/work/out/predictions/{variant}.csv', index=False)
validation = pd.read_csv('/work/data/validation_features.csv'); os.makedirs('/work/out/validation_predictions', exist_ok=True)
validation_score = model.predict_proba(validation[features])[:, 1]
pd.DataFrame({'id': validation['entity_id'], 'score': validation_score, 'label': (validation_score >= 0.5).astype(int)}).to_csv(f'/work/out/validation_predictions/{variant}.csv', index=False)
json.dump({'train_rows': len(train), 'params': params}, open(f'/work/out/reported/{variant}.json', 'w'))
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
          question: null,
        });
      }
      return Promise.resolve({
        files: [{ path: 'train_variant.py', content: trainVariant }],
        notes: 'variants',
        question: null,
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
    const finished = result.events.filter(event => event.status !== 'running');
    expect(finished.map(event => `${event.stage}:${event.action}:${event.status}`)).toEqual([
      'prepare:sandbox_check:passed',
      'prepare:generate:passed',
      'prepare:prepare_data:passed',
      'prepare:split:failed',
      'prepare:generate:passed',
      'prepare:prepare_data:passed',
      'prepare:split:passed',
      'variants:generate:passed',
      'variants:smoke:passed',
      'review:review:failed',
      'variants:generate:passed',
      'variants:smoke:passed',
      'review:review:passed',
    ]);
    // Every step is announced as running before its outcome, in order.
    expect(result.events.filter(event => event.status === 'running')).toHaveLength(finished.length);
    expect(result.events.map(event => event.seq)).toEqual(result.events.map((_, index) => index));
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
      reportedTrainingMetrics: { train_rows: 256 },
    });
    expect(run.suggestion.ranking).toHaveLength(2);
    expect(run.suggestion.suggested).not.toBeNull();
  },
  600_000
);

sandboxTest(
  'a build stage reports unresolved review findings instead of failing',
  async () => {
    const runtime = await resolveMlRuntime();
    const root = await mkdtemp(join(tmpdir(), 'anvil-experiment-review-'));
    const rawDataDir = join(root, 'raw');
    await mkdir(rawDataDir);
    const rows = Array.from({ length: 200 }, (_, index) => {
      const churned = index % 3 === 0 ? 1 : 0;
      return `c${index.toString()},${(churned ? 1 : 5).toString()},${(churned ? 10 : 80 + index).toString()},${churned.toString()}`;
    });
    await writeFile(
      join(rawDataDir, 'customers.csv'),
      ['customer,visits,spend,churned', ...rows].join('\n') + '\n'
    );
    const finding = {
      severity: 'blocking' as const,
      file: 'prepare_data.py',
      message: 'Possible leak',
    };
    const generate: ExperimentGenerate = ({ role, prompt }) =>
      Promise.resolve(
        role === 'reviewer'
          ? { verdict: 'changes_required', summary: 'Leak?', findings: [finding] }
          : {
              files: prompt.includes('DATA PREPARATION')
                ? [{ path: 'prepare_data.py', content: prepare }]
                : [{ path: 'train_variant.py', content: trainVariant }],
              notes: 'ok',
              question: null,
            }
      );
    const build = (reportUnresolvedReview: boolean): ReturnType<typeof buildExperimentCodebase> =>
      buildExperimentCodebase({
        blueprint: '# Churn blueprint',
        plan,
        variantIds: ['logistic_regression'],
        rawDataDir,
        projectDir: join(root, `project-${String(reportUnresolvedReview)}`),
        workDir: join(root, `work-${String(reportUnresolvedReview)}`),
        runtime,
        generate,
        maxFixRounds: 1,
        maxReviewRounds: 0,
        reportUnresolvedReview,
        signal: new AbortController().signal,
      });
    expect((await build(false)).status).toBe('failed');
    const reported = await build(true);
    expect(reported.status).toBe('ready');
    if (reported.status === 'ready') expect(reported.review.findings).toEqual([finding]);
  },
  300_000
);

sandboxTest(
  'a builder with nothing to change after review reports the findings instead of failing',
  async () => {
    const runtime = await resolveMlRuntime();
    const root = await mkdtemp(join(tmpdir(), 'anvil-experiment-no-change-'));
    const rawDataDir = join(root, 'raw');
    await mkdir(rawDataDir);
    const rows = Array.from({ length: 200 }, (_, index) => {
      const churned = index % 3 === 0 ? 1 : 0;
      return `c${index.toString()},${(churned ? 1 : 5).toString()},${(churned ? 10 : 80 + index).toString()},${churned.toString()}`;
    });
    await writeFile(
      join(rawDataDir, 'customers.csv'),
      ['customer,visits,spend,churned', ...rows].join('\n') + '\n'
    );
    const finding = { severity: 'blocking' as const, file: 'train_variant.py', message: 'Odd' };
    let reviews = 0;
    const generate: ExperimentGenerate = ({ role, prompt }) => {
      if (role === 'reviewer') {
        reviews += 1;
        return Promise.resolve({
          verdict: 'changes_required',
          summary: 'Odd',
          findings: [finding],
        });
      }
      const fixingReview = prompt.includes('The reviewer found blocking problems');
      return Promise.resolve({
        files: fixingReview
          ? []
          : prompt.includes('DATA PREPARATION')
            ? [{ path: 'prepare_data.py', content: prepare }]
            : [{ path: 'train_variant.py', content: trainVariant }],
        notes: 'ok',
        question: null,
      });
    };
    const reported = await buildExperimentCodebase({
      blueprint: '# Churn blueprint',
      plan,
      variantIds: ['logistic_regression'],
      rawDataDir,
      projectDir: join(root, 'project'),
      workDir: join(root, 'work'),
      runtime,
      generate,
      maxFixRounds: 1,
      maxReviewRounds: 3,
      reportUnresolvedReview: true,
      signal: new AbortController().signal,
    });
    expect(reported.status).toBe('ready');
    if (reported.status === 'ready') expect(reported.review.findings).toEqual([finding]);
    // One more look after the builder declined, not the remaining fix rounds.
    expect(reviews).toBe(2);
  },
  300_000
);

sandboxTest(
  'a reviewer concern about a blueprint requirement stops the build with a question',
  async () => {
    const runtime = await resolveMlRuntime();
    const root = await mkdtemp(join(tmpdir(), 'anvil-experiment-question-'));
    const rawDataDir = join(root, 'raw');
    await mkdir(rawDataDir);
    const rows = Array.from({ length: 200 }, (_, index) => {
      const churned = index % 3 === 0 ? 1 : 0;
      return `c${index.toString()},${(churned ? 1 : 5).toString()},${(churned ? 10 : 80 + index).toString()},${churned.toString()}`;
    });
    await writeFile(
      join(rawDataDir, 'customers.csv'),
      ['customer,visits,spend,churned', ...rows].join('\n') + '\n'
    );
    let builderCalls = 0;
    const question = 'FR-03 yêu cầu feature spend nhưng nó có thể rò rỉ; giữ hay bỏ?';
    const generate: ExperimentGenerate = ({ role, prompt }) => {
      if (role === 'builder') builderCalls += 1;
      return Promise.resolve(
        role === 'reviewer'
          ? { verdict: 'changes_required', summary: 'Requirement risk', findings: [], question }
          : {
              files: prompt.includes('DATA PREPARATION')
                ? [{ path: 'prepare_data.py', content: prepare }]
                : [{ path: 'train_variant.py', content: trainVariant }],
              notes: 'ok',
              question: null,
            }
      );
    };
    const result = await buildExperimentCodebase({
      blueprint: '# Churn blueprint',
      plan,
      variantIds: ['logistic_regression'],
      rawDataDir,
      projectDir: join(root, 'project'),
      workDir: join(root, 'work'),
      runtime,
      generate,
      maxFixRounds: 1,
      maxReviewRounds: 2,
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ status: 'needs_decision', stage: 'review', question });
    // The question goes to the user; the builder is not asked to code around the requirement.
    expect(builderCalls).toBe(2);
  },
  300_000
);

sandboxTest(
  'a split is rebuilt when variant work changes the data code it came from',
  async () => {
    const runtime = await resolveMlRuntime();
    const root = await mkdtemp(join(tmpdir(), 'anvil-experiment-stale-split-'));
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
    // Same entities and labels, so a golden check could not tell the two versions apart.
    const editedPrepare = prepare.replace(
      'frame.to_csv(',
      "frame['added_later'] = 1\nframe.to_csv("
    );
    const generate: ExperimentGenerate = ({ role, prompt }) => {
      if (role === 'reviewer')
        return Promise.resolve({ verdict: 'pass', summary: 'OK', findings: [], question: null });
      return Promise.resolve(
        prompt.includes('DATA PREPARATION')
          ? {
              files: [{ path: 'prepare_data.py', content: prepare }],
              notes: 'prepare',
              question: null,
            }
          : {
              files: [
                { path: 'train_variant.py', content: trainVariant },
                { path: 'prepare_data.py', content: editedPrepare },
              ],
              notes: 'variants',
              question: null,
            }
      );
    };
    const result = await buildExperimentCodebase({
      blueprint: '# Churn blueprint',
      plan,
      variantIds: ['logistic_regression'],
      rawDataDir,
      projectDir: join(root, 'project'),
      workDir: join(root, 'work'),
      runtime,
      generate,
      maxFixRounds: 2,
      maxReviewRounds: 1,
      signal: new AbortController().signal,
    });
    if (result.status !== 'ready') throw new Error(`Build ended as ${result.status}`);
    const header = (await readFile(join(result.split.agentDataDir, 'train.csv'), 'utf8')).split(
      '\n'
    )[0];
    expect(header).toContain('added_later');
    const finished = result.events.filter(
      event => event.action === 'prepare_data' && event.status === 'passed'
    );
    expect(finished).toHaveLength(2);
  },
  300_000
);

sandboxTest(
  'links written by generated code never make the host read the file they point at',
  async () => {
    const runtime = await resolveMlRuntime();
    const root = await mkdtemp(join(tmpdir(), 'anvil-experiment-links-'));
    const secretValue = 'HOST-SECRET-VALUE';
    const secretPath = join(root, 'secret.csv');
    await writeFile(secretPath, `${secretValue},x\n`);
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
    const linkTable = `import os\nos.symlink(${JSON.stringify(secretPath)}, '/work/out/modeling_table.csv')\n`;
    const linkPredictions = `import argparse, json, os
parser = argparse.ArgumentParser(); parser.add_argument('--variant', required=True); parser.add_argument('--params', default='{}')
args = parser.parse_args(); variant = args.variant
params = {'logistic_regression': {'max_iter': 100}, 'random_forest': {'n_estimators': 20}}[variant]
for name, value in json.loads(args.params).items():
    if name not in params: raise SystemExit(f'unknown parameter {name}')
    params[name] = value
os.makedirs('/work/out/predictions', exist_ok=True)
os.symlink(${JSON.stringify(secretPath)}, f'/work/out/predictions/{variant}.csv')
`;
    const prompts: string[] = [];
    let prepareCalls = 0;
    let variantCalls = 0;
    const generate: ExperimentGenerate = ({ role, prompt }) => {
      prompts.push(prompt);
      if (role === 'reviewer')
        return Promise.resolve({ verdict: 'pass', summary: 'OK', findings: [], question: null });
      if (prompt.includes('DATA PREPARATION')) {
        prepareCalls += 1;
        return Promise.resolve({
          files: [{ path: 'prepare_data.py', content: prepareCalls === 1 ? linkTable : prepare }],
          notes: 'prepare',
          question: null,
        });
      }
      variantCalls += 1;
      return Promise.resolve({
        files: [
          {
            path: 'train_variant.py',
            content: variantCalls === 1 ? linkPredictions : trainVariant,
          },
        ],
        notes: 'variants',
        question: null,
      });
    };
    const result = await buildExperimentCodebase({
      blueprint: '# Churn blueprint',
      plan,
      variantIds: ['logistic_regression'],
      rawDataDir,
      projectDir: join(root, 'project'),
      workDir: join(root, 'work'),
      runtime,
      generate,
      maxFixRounds: 3,
      maxReviewRounds: 1,
      signal: new AbortController().signal,
    });
    if (result.status !== 'ready') throw new Error(`Build ended as ${result.status}`);
    expect(prepareCalls).toBe(2);
    expect(variantCalls).toBe(2);
    expect(prompts.join('\n')).toContain('must be a regular file');
    expect(prompts.join('\n')).not.toContain(secretValue);

    // A full run that writes a link gets no score from it, and the file stays out of the results.
    const linkingProject = join(root, 'linking-project');
    await mkdir(linkingProject);
    await writeFile(join(linkingProject, 'train_variant.py'), linkPredictions);
    const workDir = join(root, 'run');
    const run = await runExperimentVariants({
      runtime,
      projectDir: linkingProject,
      agentDataDir: result.split.agentDataDir,
      holdoutDir: result.split.holdoutDir,
      protocol: plan.protocol as NonNullable<ExperimentPlan['protocol']>,
      variantIds: ['logistic_regression'],
      workDir,
      timeoutMs: 120_000,
      signal: new AbortController().signal,
    });
    expect(run.evaluation.variants.logistic_regression?.status).toBe('missing');
    expect(run.runs[0]?.logTail).toContain('must be a regular file');
    expect(
      await Bun.file(join(workDir, 'collected', 'predictions', 'logistic_regression.csv')).exists()
    ).toBe(false);
  },
  300_000
);
