import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  buildRequirementEvidence,
  compareGoldenOutput,
  contractCheckFeedback,
  findGoldenFixtureProblems,
  runContractChecks,
  type ContractCheckResult,
} from './experiment-contract-checks';
import {
  executeExperiment,
  verifyExperiment,
  type ExperimentCapabilityPort,
} from './experiment-capabilities';
import { hashProjectFiles, listProjectFiles } from './experiment-builder';
import { deriveExperimentPlan } from './experiment-plan';
import { resolveMlRuntime } from './ml-runtime';
import { understandProjectSources, type PinnedUnderstandingSource } from './understanding';
import { projectVerificationEvidence } from './verification-evidence-projection';
import type { VerificationContract } from './verification-contract';

const sandboxTest = process.env.ANVIL_SANDBOX_TESTS === 'true' ? test : test.skip;

const SAMPLE_DIR = new URL('../../web/public/samples/olist/', import.meta.url).pathname;
const TABLES = [
  'olist_orders_dataset.csv',
  'olist_order_items_dataset.csv',
  'olist_order_payments_dataset.csv',
  'olist_order_reviews_dataset.csv',
  'olist_products_dataset.csv',
];

function source(
  kind: PinnedUnderstandingSource['kind'],
  filename: string,
  bytes: Uint8Array
): PinnedUnderstandingSource {
  return {
    id: randomUUID(),
    kind,
    filename,
    mediaType: kind === 'blueprint' ? 'text/markdown' : 'text/csv',
    contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    bytes,
  };
}

async function sampleAnalysis(): ReturnType<typeof understandProjectSources> {
  const blueprint = await readFile(join(SAMPLE_DIR, 'review-risk-blueprint.md'));
  return understandProjectSources({
    sources: [source('blueprint', 'blueprint.md', new Uint8Array(blueprint))],
  });
}

async function sampleContract(): Promise<VerificationContract> {
  const { analysis } = await sampleAnalysis();
  if (!analysis.verificationContract) throw new Error('Sample blueprint has no contract');
  return analysis.verificationContract;
}

/** A correct implementation of FR-01/FR-02; the broken ones below each change one thing. */
const REFERENCE_PREPARE = `import pandas as pd
orders = pd.read_csv('/work/data/olist_orders_dataset.csv')
items = pd.read_csv('/work/data/olist_order_items_dataset.csv')
payments = pd.read_csv('/work/data/olist_order_payments_dataset.csv')
reviews = pd.read_csv('/work/data/olist_order_reviews_dataset.csv')
pd.read_csv('/work/data/olist_products_dataset.csv')
reviews['review_creation_date'] = pd.to_datetime(reviews['review_creation_date'])
first = reviews.sort_values('review_creation_date').drop_duplicates('order_id', keep='first')
frame = orders.merge(first[['order_id', 'review_score']], on='order_id')
frame['target'] = (frame['review_score'] <= 2).astype(int)
frame = frame.merge(items.groupby('order_id').agg(item_count=('price', 'size'), total_price=('price', 'sum')).reset_index(), on='order_id', how='left')
frame = frame.merge(payments.groupby('order_id').agg(installments=('payment_installments', 'max')).reset_index(), on='order_id', how='left')
frame = frame.rename(columns={'order_id': 'entity_id'})
frame[['entity_id', 'target', 'item_count', 'total_price', 'installments']].to_csv('/work/out/modeling_table.csv', index=False)
`;

function broken(from: string, to: string): string {
  if (!REFERENCE_PREPARE.includes(from)) throw new Error(`Fixture text not found: ${from}`);
  return REFERENCE_PREPARE.replace(from, to);
}

const TRAIN_VARIANT = `import argparse, json, os
import pandas as pd
from sklearn.linear_model import LogisticRegression
parser = argparse.ArgumentParser(); parser.add_argument('--variant', required=True); parser.add_argument('--params', default='{}')
args = parser.parse_args(); variant = args.variant
params = {'logistic_regression': {'max_iter': 100}, 'random_forest': {'n_estimators': 20}}[variant]
for name, value in json.loads(args.params).items():
    if name not in params: raise SystemExit(f'unknown parameter {name}')
    params[name] = value
train = pd.read_csv('/work/data/train.csv'); test = pd.read_csv('/work/data/test_features.csv')
features = ['item_count', 'total_price', 'installments']
model = LogisticRegression(max_iter=200).fit(train[features].fillna(0), train['target'])
score = model.predict_proba(test[features].fillna(0))[:, 1]
os.makedirs('/work/out/predictions', exist_ok=True); os.makedirs('/work/out/reported', exist_ok=True)
pd.DataFrame({'id': test['entity_id'], 'score': score, 'label': (score >= 0.5).astype(int)}).to_csv(f'/work/out/predictions/{variant}.csv', index=False)
validation = pd.read_csv('/work/data/validation_features.csv'); os.makedirs('/work/out/validation_predictions', exist_ok=True)
validation_score = model.predict_proba(validation[features].fillna(0))[:, 1]
pd.DataFrame({'id': validation['entity_id'], 'score': validation_score, 'label': (validation_score >= 0.5).astype(int)}).to_csv(f'/work/out/validation_predictions/{variant}.csv', index=False)
json.dump({'train_rows': len(train), 'params': params}, open(f'/work/out/reported/{variant}.json', 'w'))
`;

function result(overrides: Partial<ContractCheckResult>): ContractCheckResult {
  return {
    criterionId: 'FR-02.AC-01',
    requirementId: 'FR-02',
    kind: 'golden_cases',
    status: 'passed',
    failureClass: null,
    reason: 'ok',
    claim: 'claim',
    limitation: 'limitation',
    fixtureHash: 'sha256:fixture',
    differences: null,
    sourcePointers: [],
    ...overrides,
  };
}

describe('compareGoldenOutput', () => {
  const expected = [
    { entity_id: 'a', target: 1 as const },
    { entity_id: 'b', target: 0 as const },
  ];

  test('accepts the exact set, in any order, with extra columns and 1.0-style targets', () => {
    const compared = compareGoldenOutput('target,entity_id,x\n0.0,b,9\n1,a,9\n', expected);
    expect(compared).toMatchObject({ differences: { total: 0 } });
  });

  test.each([
    ['missing', 'entity_id,target\na,1\n', { missing: ['b'] }],
    ['extra', 'entity_id,target\na,1\nb,0\nc,0\n', { extra: ['c'] }],
    ['duplicate', 'entity_id,target\na,1\nb,0\nb,0\n', { duplicate: ['b'] }],
    ['wrong target', 'entity_id,target\na,0\nb,0\n', { wrongTarget: [{ entityId: 'a' }] }],
    ['empty target', 'entity_id,target\na,\nb,0\n', { wrongTarget: [{ entityId: 'a' }] }],
    ['non-numeric target', 'entity_id,target\na,yes\nb,0\n', { wrongTarget: [{ entityId: 'a' }] }],
  ])('reports %s', (_name, csv, difference) => {
    const compared = compareGoldenOutput(csv, expected);
    expect(compared).toMatchObject({ differences: difference });
    if ('differences' in compared) expect(compared.differences.total).toBeGreaterThan(0);
  });

  test('a table without the required columns or with uneven rows is unreadable, not a pass', () => {
    expect(compareGoldenOutput('id,y\na,1\n', expected)).toHaveProperty('unreadable');
    expect(compareGoldenOutput('entity_id,target\na\n', expected)).toHaveProperty('unreadable');
  });

  test('an oversized output is refused quickly: repeating one id cannot cost quadratic time', () => {
    const many = `entity_id,target\n${'a,1\n'.repeat(400_000)}`;
    const started = Date.now();
    expect(compareGoldenOutput(many, expected)).toHaveProperty('unreadable');
    const justUnder = `entity_id,target\n${'a,1\n'.repeat(1_999)}b,0\n`;
    expect(compareGoldenOutput(justUnder, expected)).toMatchObject({
      differences: { duplicate: ['a'] },
    });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('buildRequirementEvidence', () => {
  const requirements = Array.from({ length: 13 }, (_, index) => ({
    id: `FR-${(index + 1).toString().padStart(2, '0')}`,
    acceptanceCriterion: 'Nhiều ý',
    sourcePointers: [],
  }));

  test('a requirement the user removed stays counted and is not reported as unchecked', () => {
    const evidence = buildRequirementEvidence(requirements, [], ['FR-03']);
    expect(evidence.requirementCoverage).toMatchObject({ total: 13, removed: 1, notVerified: 12 });
    expect(evidence.requirements.find(item => item.requirementId === 'FR-03')?.status).toBe(
      'removed_by_decision'
    );
  });

  test('one passing check in a 13-requirement blueprint is 1/1 declared, not 100% of the blueprint', () => {
    const evidence = buildRequirementEvidence(requirements, [
      result({ requirementId: 'FR-02', status: 'passed' }),
    ]);
    expect(evidence.declaredChecks).toMatchObject({ total: 1, passed: 1 });
    expect(evidence.requirementCoverage).toMatchObject({
      status: 'not_verified',
      total: 13,
      verified: 0,
      criteriaPassed: 1,
      notVerified: 12,
    });
    expect(evidence.requirements).toHaveLength(13);
    const row = evidence.requirements.find(item => item.requirementId === 'FR-02');
    expect(row?.status).toBe('criteria_passed');
    expect(row?.reason).toContain('chưa được xác nhận đầy đủ');
  });

  test('no contract is 0 of 13, never 0/0', () => {
    const evidence = buildRequirementEvidence(requirements, []);
    expect(evidence.requirementCoverage).toMatchObject({ total: 13, verified: 0, notVerified: 13 });
    expect(evidence.declaredChecks.total).toBe(0);
  });

  test('a requirement dropped from the contract stays not_verified', () => {
    const evidence = buildRequirementEvidence(requirements, [
      result({ requirementId: 'FR-01', criterionId: 'FR-01.AC-01' }),
    ]);
    expect(evidence.requirements.find(item => item.requirementId === 'FR-02')).toMatchObject({
      status: 'not_verified',
      criteria: [],
    });
  });

  test('failed and blocked outrank passes; manual and unsupported never count as a pass', () => {
    const statusOf = (results: ContractCheckResult[]): string | undefined =>
      buildRequirementEvidence(requirements, results).requirements[1]?.status;
    const passed = result({ requirementId: 'FR-02' });
    expect(statusOf([passed, result({ requirementId: 'FR-02', status: 'failed' })])).toBe('failed');
    expect(statusOf([passed, result({ requirementId: 'FR-02', status: 'blocked' })])).toBe(
      'blocked'
    );
    expect(
      statusOf([passed, result({ requirementId: 'FR-02', kind: 'manual', status: 'not_verified' })])
    ).toBe('not_verified');
  });
});

describe('contractCheckFeedback', () => {
  test('sends code problems to the builder and refuses to send environment problems', () => {
    expect(contractCheckFeedback([result({})])).toBeNull();
    expect(
      contractCheckFeedback([result({ status: 'failed', failureClass: 'output', reason: 'sai' })])
    ).toContain('sai');
    expect(
      contractCheckFeedback([result({ status: 'blocked', failureClass: 'resource_limit' })])
    ).toContain('FR-02.AC-01');
    expect(() =>
      contractCheckFeedback([
        result({ status: 'blocked', failureClass: 'environment', reason: 'no bwrap' }),
      ])
    ).toThrow('no bwrap');
    expect(contractCheckFeedback([result({ kind: 'manual', status: 'not_verified' })])).toBeNull();
  });
});

describe('projectVerificationEvidence', () => {
  test('experiment: passing criteria never become a passed requirement record', () => {
    const evidence = buildRequirementEvidence(
      [
        { id: 'FR-01', acceptanceCriterion: 'x', sourcePointers: [] },
        { id: 'FR-02', acceptanceCriterion: 'y', sourcePointers: [] },
      ],
      [result({})]
    );
    const rows = projectVerificationEvidence({
      kind: 'experiment',
      requirements: evidence.requirements,
      contractChecks: [result({})],
    });
    expect(rows.filter(row => row.requirementId !== null).map(row => row.status)).toEqual([
      'not_verified',
      'not_verified',
    ]);
    expect(rows.find(row => row.requirementId === null)).toMatchObject({
      status: 'passed',
      evidence: ['FR-02.AC-01', 'sha256:fixture'],
    });
    expect(rows.find(row => row.requirementId === 'FR-02')?.evidence).toEqual(['FR-02.AC-01']);
    expect(rows.find(row => row.requirementId === 'FR-02')?.reason).toContain(
      'chưa được xác nhận đầy đủ'
    );
  });

  test('experiment: failed stays failed, blocked is not recorded as a pass or a code failure', () => {
    const rows = projectVerificationEvidence({
      kind: 'experiment',
      requirements: [
        { requirementId: 'FR-01', status: 'failed', criteria: ['A'], reason: 'r' },
        { requirementId: 'FR-02', status: 'blocked', criteria: ['B'], reason: 'r' },
      ],
      contractChecks: [
        result({ criterionId: 'A', status: 'failed' }),
        result({ criterionId: 'B', status: 'blocked' }),
      ],
    });
    expect(rows.map(row => [row.requirementId, row.status])).toEqual([
      [null, 'failed'],
      [null, 'not_verified'],
      ['FR-01', 'failed'],
      ['FR-02', 'not_verified'],
    ]);
  });

  test('model comparison and baseline maps keep their previous records', () => {
    expect(
      projectVerificationEvidence({
        kind: 'model_comparison',
        inputHash: 'sha256:input',
        requirements: [{ requirementId: 'FR-01', status: 'passed', reason: 'ok' }],
      })
    ).toEqual([
      { requirementId: 'FR-01', status: 'passed', evidence: ['sha256:input'], reason: 'ok' },
    ]);
    expect(
      projectVerificationEvidence({
        requirements: [{ requirementId: 'FR-01', status: 'passed' }],
        mvpChecks: [{ id: 'MVP-EXEC-001', status: 'passed' }],
      })
    ).toEqual([
      { requirementId: null, status: 'passed', evidence: ['MVP-EXEC-001'], reason: null },
      {
        requirementId: 'FR-01',
        status: 'not_verified',
        evidence: [],
        reason: 'Outside the approved MVP scope',
      },
    ]);
  });
});

describe('sample blueprint fixture', () => {
  test('has all five tables with the same columns as the sample data', async () => {
    const contract = await sampleContract();
    expect(await findGoldenFixtureProblems(contract, join(SAMPLE_DIR, 'review-risk'))).toEqual([]);
  });

  test('a fixture missing a table or a column is a contract problem', async () => {
    const contract = await sampleContract();
    const check = contract.criteria[0]?.check;
    if (check?.kind !== 'golden_cases') throw new Error('Expected golden_cases');
    const tables = { ...check.tables };
    delete tables['olist_products_dataset.csv'];
    tables['olist_orders_dataset.csv'] = 'order_id\no1\n';
    const problems = await findGoldenFixtureProblems(
      {
        ...contract,
        criteria: [
          { ...contract.criteria[0], check: { ...check, tables } },
        ] as VerificationContract['criteria'],
      },
      join(SAMPLE_DIR, 'review-risk')
    );
    expect(problems.join('\n')).toContain('thiếu bảng olist_products_dataset.csv');
    expect(problems.join('\n')).toContain('cột của olist_orders_dataset.csv');
  });
});

async function runOn(
  prepare: string,
  contract: VerificationContract,
  python?: string
): Promise<ContractCheckResult> {
  const runtime = await resolveMlRuntime();
  const root = await mkdtemp(join(tmpdir(), 'contract-check-test-'));
  const projectDir = join(root, 'project');
  await mkdir(projectDir);
  await writeFile(join(projectDir, 'prepare_data.py'), prepare);
  const [checked] = await runContractChecks({
    contract,
    runtime: python ? { ...runtime, python } : runtime,
    projectDir,
    workDir: join(root, 'work'),
    signal: new AbortController().signal,
  });
  if (!checked) throw new Error('No result');
  return checked;
}

describe('golden_cases in the real sandbox', () => {
  sandboxTest(
    'the correct rule passes; each planted business error is caught',
    async () => {
      const contract = await sampleContract();
      expect(await runOn(REFERENCE_PREPARE, contract)).toMatchObject({
        status: 'passed',
        failureClass: null,
      });
      const planted: [string, string, Record<string, unknown>][] = [
        [
          'flipped label',
          broken(
            "(frame['review_score'] <= 2).astype(int)",
            "(frame['review_score'] > 2).astype(int)"
          ),
          { differences: { wrongTarget: expect.arrayContaining([expect.anything()]) } },
        ],
        [
          '< 2 instead of <= 2',
          broken("frame['review_score'] <= 2", "frame['review_score'] < 2"),
          { differences: { wrongTarget: [{ entityId: 'o_score2' }] } },
        ],
        [
          '<= 3 instead of <= 2',
          broken("frame['review_score'] <= 2", "frame['review_score'] <= 3"),
          { differences: { wrongTarget: [{ entityId: 'o_score3' }] } },
        ],
        [
          'latest review instead of earliest',
          broken("keep='first'", "keep='last'"),
          {
            differences: {
              wrongTarget: expect.arrayContaining([
                expect.objectContaining({ entityId: 'o_earliest_low' }),
              ]),
            },
          },
        ],
        [
          'first row of the file instead of earliest',
          broken(
            "reviews.sort_values('review_creation_date').drop_duplicates",
            'reviews.drop_duplicates'
          ),
          { differences: { wrongTarget: [{ entityId: 'o_earliest_low' }] } },
        ],
        [
          'orders without a review kept',
          broken("on='order_id')\nframe['target']", "on='order_id', how='left')\nframe['target']"),
          { differences: { extra: ['o_no_review'] } },
        ],
        [
          'rows dropped',
          broken(
            'frame = frame.rename(',
            "frame = frame[frame['order_id'] != 'o_score3']\nframe = frame.rename("
          ),
          { differences: { missing: ['o_score3'] } },
        ],
        [
          'join multiplies rows',
          broken(
            "frame = frame.merge(items.groupby('order_id').agg(item_count=('price', 'size'), total_price=('price', 'sum')).reset_index(), on='order_id', how='left')",
            "frame = frame.merge(items.assign(item_count=1, total_price=items['price']), on='order_id', how='left')"
          ),
          { differences: { duplicate: ['o_many_rows'] } },
        ],
      ];
      for (const [name, code, expected] of planted) {
        const checked = await runOn(code, contract);
        expect({ name, ...checked }).toMatchObject({
          name,
          status: 'failed',
          failureClass: 'output',
          ...expected,
        });
      }
    },
    300_000
  );

  sandboxTest(
    'crashes, missing output and symlinks are code failures; a broken runtime is not',
    async () => {
      const contract = await sampleContract();
      expect(await runOn("raise SystemExit('boom')", contract)).toMatchObject({
        status: 'failed',
        failureClass: 'code',
      });
      expect(await runOn('print("nothing written")', contract)).toMatchObject({
        status: 'failed',
        failureClass: 'output',
      });
      // A symlink out of the sandbox must not make the host read that file.
      expect(
        await runOn(
          "import os\nos.symlink('/etc/hostname', '/work/out/modeling_table.csv')\n",
          contract
        )
      ).toMatchObject({ status: 'failed', failureClass: 'output' });
      expect(await runOn(REFERENCE_PREPARE, contract, '/nonexistent/python')).toMatchObject({
        status: 'blocked',
        failureClass: 'environment',
      });
    },
    120_000
  );
});

sandboxTest(
  'TW-06 feeds a failed check back to the builder; TW-07 re-checks the package and reports honestly',
  async () => {
    const analysis = (await sampleAnalysis()).analysis;
    const plan = deriveExperimentPlan(analysis);
    const blueprint = source(
      'blueprint',
      'blueprint.md',
      new Uint8Array(await readFile(join(SAMPLE_DIR, 'review-risk-blueprint.md')))
    );
    const datasets = await Promise.all(
      TABLES.map(async name =>
        source(
          'dataset',
          name,
          new Uint8Array(await readFile(join(SAMPLE_DIR, 'review-risk', name)))
        )
      )
    );
    const prepareFeedback: string[] = [];
    let prepareCalls = 0;
    let variantCalls = 0;
    const port: ExperimentCapabilityPort = {
      readSourceVersion: (_projectId, id) =>
        Promise.resolve([blueprint, ...datasets].find(item => item.id === id) ?? null),
      generateStructured: ({ prompt, model }) => {
        if (model === 'router9/reviewer')
          return Promise.resolve({ verdict: 'pass', summary: 'OK', findings: [], question: null });
        if (prompt.includes('DATA PREPARATION')) {
          prepareCalls += 1;
          const feedback = prompt.split('## Fix this problem from the last run')[1];
          if (feedback) prepareFeedback.push(feedback);
          return Promise.resolve({
            files: [
              {
                path: 'prepare_data.py',
                content:
                  prepareCalls === 1
                    ? broken("frame['review_score'] <= 2", "frame['review_score'] < 2")
                    : REFERENCE_PREPARE,
              },
            ],
            notes: 'ok',
            question: null,
          });
        }
        variantCalls += 1;
        return Promise.resolve({
          files: [{ path: 'train_variant.py', content: TRAIN_VARIANT }],
          notes: 'ok',
          question: null,
        });
      },
      readArtifact: () => Promise.reject(new Error('Not used')),
    };
    const root = await mkdtemp(join(tmpdir(), 'contract-flow-test-'));
    const artifactsDir = join(root, 'a', 'b', 'c', 'run');
    await mkdir(artifactsDir, { recursive: true });
    const context = { runId: 'run', artifactsDir, signal: new AbortController().signal };
    const executed = await executeExperiment(
      {
        projectId: randomUUID(),
        config: {
          schemaVersion: 1,
          builderModel: 'router9/builder',
          reviewerModel: 'router9/reviewer',
          maxFixRounds: 3,
          maxReviewRounds: 1,
          variantTimeoutMinutes: 5,
        },
        plan,
        variantIds: ['logistic_regression'],
        blueprintSource: { id: blueprint.id, contentHash: blueprint.contentHash },
        datasetSources: datasets.map(item => ({ id: item.id, contentHash: item.contentHash })),
      },
      context,
      port
    );
    expect(prepareCalls).toBe(2);
    expect(variantCalls).toBe(1);
    expect(prepareFeedback[0]).toContain('o_score2');

    const requirements = analysis.requirements.map(item => ({
      id: item.id,
      acceptanceCriterion: item.acceptanceCriterion,
      sourcePointers: item.sourcePointers,
    }));
    const verifyInput = {
      projectDir: executed.projectDir,
      experiment: executed.experiment,
      requirements,
      verificationContract: plan.verificationContract,
    };
    const { evidenceMap } = await verifyExperiment(verifyInput, context);
    expect(evidenceMap).toMatchObject({
      kind: 'experiment',
      status: 'passed',
      executionStatus: 'passed',
      scoringStatus: 'passed',
      declaredChecks: { total: 1, passed: 1 },
      requirementCoverage: {
        status: 'not_verified',
        total: requirements.length,
        verified: 0,
        criteriaPassed: 1,
        notVerified: requirements.length - 1,
      },
    });
    const rows = projectVerificationEvidence(evidenceMap);
    expect(rows.filter(row => row.requirementId !== null)).toHaveLength(requirements.length);
    expect(rows.filter(row => row.requirementId !== null && row.status === 'passed')).toEqual([]);

    // Bundles approved before this change: no denominator is reported rather than a false 0/0.
    const legacy = await verifyExperiment(
      { projectDir: executed.projectDir, experiment: executed.experiment },
      context
    );
    expect(legacy.evidenceMap.requirementCoverage).toMatchObject({ total: null });

    // TW-07 reads the package: different code in it without a matching hash is refused...
    const codePath = join(executed.projectDir, 'code', 'prepare_data.py');
    await writeFile(codePath, broken("frame['review_score'] <= 2", "frame['review_score'] < 2"));
    await expect(verifyExperiment(verifyInput, context)).rejects.toThrow('code hash');
    // ...and with a matching hash the check itself fails and blocks the gate input.
    const reportPath = join(executed.projectDir, 'reports', 'experiment_results.json');
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
    await writeFile(
      reportPath,
      JSON.stringify({
        ...report,
        codeHash: hashProjectFiles(await listProjectFiles(join(executed.projectDir, 'code'))),
      })
    );
    const failed = await verifyExperiment(verifyInput, context);
    expect(failed.evidenceMap).toMatchObject({
      status: 'failed',
      executionStatus: 'failed',
      scoringStatus: 'passed',
      declaredChecks: { failed: 1 },
      requirementCoverage: { failed: 1 },
    });
    expect(
      projectVerificationEvidence(failed.evidenceMap).find(row => row.requirementId === 'FR-02')
        ?.status
    ).toBe('failed');
    // A contract the package was not built for is refused rather than checked against it.
    await expect(
      verifyExperiment(
        {
          ...verifyInput,
          verificationContract: {
            contractVersion: 1,
            criteria: [
              {
                id: 'OTHER',
                requirementId: 'FR-02',
                statement: 'Khác',
                check: { kind: 'manual' },
                sourcePointers: plan.verificationContract?.criteria[0]?.sourcePointers ?? [],
              },
            ],
          },
        },
        context
      )
    ).rejects.toThrow('different verification contract');
  },
  600_000
);
