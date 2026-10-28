import { expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  executeExperiment,
  REPRODUCE_SH,
  type ExperimentCapabilityPort,
} from './experiment-capabilities';
import { resolveMlRuntime } from './ml-runtime';
import type { ExperimentPlan } from './experiment-plan';
import type { PinnedUnderstandingSource } from './understanding';

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

function source(
  kind: PinnedUnderstandingSource['kind'],
  filename: string,
  text: string
): PinnedUnderstandingSource {
  const bytes = new TextEncoder().encode(text);
  return {
    id: randomUUID(),
    kind,
    filename,
    mediaType: 'text/plain',
    contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    bytes,
  } as PinnedUnderstandingSource;
}

async function archive(packageDir: string): Promise<Uint8Array> {
  const path = `${packageDir}.tar.gz`;
  const tar = Bun.spawn(['tar', '-czf', path, '-C', dirname(packageDir), 'generated_project']);
  if ((await tar.exited) !== 0) throw new Error('tar failed');
  return readFile(path);
}

sandboxTest(
  'build stage packages tested code; run stages run subsets and carry earlier results over',
  async () => {
    const rows = Array.from({ length: 400 }, (_, index) => {
      const churned = index % 3 === 0 ? 1 : 0;
      return `c${index.toString()},${(churned ? 1 : 5 + (index % 4)).toString()},${(churned ? 10 : 80 + index).toString()},${churned.toString()}`;
    });
    const blueprint = source('blueprint', 'blueprint.md', '# Churn blueprint');
    const dataset = source(
      'dataset',
      'customers.csv',
      ['customer,visits,spend,churned', ...rows].join('\n') + '\n'
    );
    const artifacts = new Map<string, Uint8Array>();
    let modelCalls = 0;
    const port: ExperimentCapabilityPort = {
      readSourceVersion: (_projectId, id) =>
        Promise.resolve([blueprint, dataset].find(item => item.id === id) ?? null),
      generateStructured: ({ prompt, model }) => {
        modelCalls += 1;
        if (model === 'router9/reviewer')
          return Promise.resolve({ verdict: 'pass', summary: 'OK', findings: [] });
        return Promise.resolve({
          files: prompt.includes('DATA PREPARATION')
            ? [{ path: 'prepare_data.py', content: prepare }]
            : [{ path: 'train_variant.py', content: trainVariant }],
          notes: 'ok',
          question: null,
        });
      },
      readArtifact: (_projectId, key) => {
        const bytes = artifacts.get(key);
        return bytes ? Promise.resolve(bytes) : Promise.reject(new Error(`missing ${key}`));
      },
    };
    const root = await mkdtemp(join(tmpdir(), 'anvil-experiment-stages-'));
    const base = {
      projectId: randomUUID(),
      config: {
        schemaVersion: 1,
        builderModel: 'router9/builder',
        reviewerModel: 'router9/reviewer',
        maxFixRounds: 2,
        maxReviewRounds: 1,
        variantTimeoutMinutes: 2,
      },
      plan,
      variantIds: ['logistic_regression', 'random_forest'],
      blueprintSource: { id: blueprint.id, contentHash: blueprint.contentHash },
      datasetSources: [{ id: dataset.id, contentHash: dataset.contentHash }],
    };
    const stage = async (
      name: string,
      run: Record<string, unknown>
    ): Promise<{
      ref: Record<string, string>;
      output: Awaited<ReturnType<typeof executeExperiment>>;
    }> => {
      const artifactsDir = join(root, name);
      await mkdir(artifactsDir);
      const output = await executeExperiment(
        { ...base, run },
        { runId: name, artifactsDir, signal: new AbortController().signal },
        port
      );
      const bytes = await archive(output.projectDir);
      const storageKey = `${name}.tar.gz`;
      artifacts.set(storageKey, bytes);
      return {
        output,
        ref: {
          executionId: randomUUID(),
          storageKey,
          contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        },
      };
    };

    const build = await stage('build', { stage: 'build' });
    expect(build.output.experiment).toMatchObject({ kind: 'experiment_build', status: 'built' });
    const callsAfterBuild = modelCalls;

    const first = await stage('run-1', {
      stage: 'run',
      buildArtifact: build.ref,
      variantIds: ['logistic_regression'],
      parallelism: 1,
      carryOver: null,
    });
    expect(first.output.experiment).toMatchObject({
      kind: 'experiment',
      variantIds: ['logistic_regression'],
    });

    const second = await stage('run-2', {
      stage: 'run',
      buildArtifact: build.ref,
      variantIds: ['random_forest'],
      parallelism: 1,
      carryOver: first.ref,
    });
    // Runs reuse the build: no further model calls, and the earlier variant is carried over.
    expect(modelCalls).toBe(callsAfterBuild);
    expect(second.output.experiment).toMatchObject({
      variantIds: ['logistic_regression', 'random_forest'],
      rerun: ['random_forest'],
    });
    const evaluation = second.output.experiment.evaluation as {
      variants: Record<string, { status: string }>;
    };
    expect(evaluation.variants.logistic_regression?.status).toBe('verified');
    expect(evaluation.variants.random_forest?.status).toBe('verified');

    await expect(
      stage('outside', {
        stage: 'run',
        buildArtifact: build.ref,
        variantIds: ['xgboost'],
        parallelism: 1,
        carryOver: null,
      })
    ).rejects.toThrow('outside the approved plan');
  },
  600_000
);

test('reproduce.sh sandboxes variant code instead of exposing the host', () => {
  expect(REPRODUCE_SH).not.toMatch(/--(ro-)?bind \/ \//u);
  expect(REPRODUCE_SH).toContain('--clearenv');
  expect(REPRODUCE_SH).toContain('--unshare-all');
  expect(REPRODUCE_SH).not.toContain('data/holdout');
  expect(REPRODUCE_SH).toContain('--ro-bind "$here/data/agent" /work/data');
});

sandboxTest(
  'reproduce.sh hides held-out labels, the host filesystem and the environment',
  async () => {
    const runtime = await resolveMlRuntime();
    const root = await mkdtemp(join(tmpdir(), 'anvil-reproduce-'));
    const pkg = join(root, 'package');
    const outside = join(root, 'outside-secret.txt');
    await Promise.all([
      mkdir(join(pkg, 'code'), { recursive: true }),
      mkdir(join(pkg, 'data', 'agent'), { recursive: true }),
      mkdir(join(pkg, 'data', 'holdout'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(pkg, 'reproduce.sh'), REPRODUCE_SH),
      writeFile(outside, 'sentinel\n'),
      writeFile(join(pkg, 'data', 'holdout', 'test_labels.csv'), 'id,target\n'),
      writeFile(join(pkg, 'data', 'agent', 'train.csv'), 'id\n'),
      writeFile(
        join(pkg, 'code', 'train_variant.py'),
        `import json, os, sys
from pathlib import Path
probes = {
    'outside': ${JSON.stringify(outside)},
    'holdout': ${JSON.stringify(join(pkg, 'data', 'holdout', 'test_labels.csv'))},
    'home': ${JSON.stringify(join(process.env.HOME ?? '/root', '.bashrc'))},
    'data': '/work/data/train.csv',
}
seen = {name: Path(path).exists() for name, path in probes.items()}
seen['secret_env'] = 'ANVIL_REPRODUCE_SECRET' in os.environ
Path('/work/out/predictions', sys.argv[2] + '.csv').write_text(json.dumps(seen))
`
      ),
    ]);
    const child = Bun.spawn(['sh', join(pkg, 'reproduce.sh'), 'probe', runtime.python], {
      env: { ...process.env, ANVIL_REPRODUCE_SECRET: 'x' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, stderr }).toMatchObject({ code: 0 });
    expect(JSON.parse(await readFile(stdout.trim(), 'utf8'))).toEqual({
      outside: false,
      holdout: false,
      home: false,
      data: true,
      secret_env: false,
    });
  },
  120_000
);
