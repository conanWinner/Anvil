import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeBlueprintMarkdown } from './blueprint';
import { System3CapabilityRegistry } from './capabilities';

function context(): {
  runId: string;
  nodeId: string;
  cwd: string;
  artifactsDir: string;
  signal: AbortSignal;
} {
  return {
    runId: 'run-1',
    nodeId: 'node-1',
    cwd: '/tmp',
    artifactsDir: '/tmp/artifacts',
    signal: new AbortController().signal,
  };
}

test('registry fails fast for an unknown executor', async () => {
  const registry = new System3CapabilityRegistry();
  expect(registry.has('system3.unknown')).toBe(false);
  expect(registry.execute('system3.unknown', {}, context())).rejects.toThrow(
    "Unknown System 3 capability 'system3.unknown'"
  );
});

test('understanding capabilities preserve structured outputs between nodes', async () => {
  const registry = new System3CapabilityRegistry();
  const parsed = await registry.execute(
    'system3.blueprint-parser',
    { markdown: '# Mục tiêu\nDự đoán churn trong 90 ngày.\nCPU-only, RAM 8 GB.' },
    context()
  );
  const parsedBody = parsed.structuredOutput as { analysis: unknown };
  const composed = await registry.execute(
    'system3.project-overview',
    { analysis: parsedBody.analysis, datasetProfile: null },
    context()
  );
  expect(composed.structuredOutput).toMatchObject({
    analysis: { runtime: { cpuOnly: true, ramGb: 8 } },
  });
});

test('input snapshot verifier keeps explicit pinned sources instead of resolving latest sources', async () => {
  const registry = new System3CapabilityRegistry({
    listSourceRefs: async () => [
      { id: 'latest-blueprint', kind: 'blueprint', contentHash: 'sha256:latest' },
    ],
    readLatestSource: async () => null,
    readArtifact: async () => new Uint8Array(),
  });
  const pinnedSources = [
    { id: 'replayed-blueprint', kind: 'blueprint', contentHash: 'sha256:replayed' },
  ];
  const verified = await registry.execute(
    'system3.input-snapshot-verifier',
    { projectId: 'project-1', sources: pinnedSources },
    context()
  );
  expect(verified.structuredOutput).toEqual({ verified: true, sources: pinnedSources });
});

test('readiness decision resolver reports pending decisions without failing the workflow', async () => {
  const registry = new System3CapabilityRegistry();
  const decisions = [{ id: 'decision-1', status: 'pending' as const, answer: null }];

  const pending = await registry.execute('system3.decision-resolver', { decisions }, context());
  expect(pending.structuredOutput).toEqual({ resolvedDecisions: [], pendingDecisionCount: 1 });

  const resolved = await registry.execute(
    'system3.decision-resolver',
    { decisions: [{ ...decisions[0], status: 'answered', answer: 'Use recall' }] },
    context()
  );
  expect(resolved.structuredOutput).toEqual({
    resolvedDecisions: [{ id: 'decision-1', answer: 'Use recall' }],
    pendingDecisionCount: 0,
  });
});

const readinessAnalysis = {
  schemaVersion: 1 as const,
  businessGoal: 'Reduce churn',
  technicalObjective: 'Predict churn',
  targetDefinition: 'churn',
  runtime: { cpuOnly: true, ramGb: 8 },
  requirements: [
    {
      id: 'FR-001',
      kind: 'FR',
      priority: 'P0',
      source: 'blueprint',
      statement: 'Predict churn',
      acceptanceCriterion: 'Report recall',
      sourcePointer: 'blueprint.md:1',
    },
  ],
  modules: [],
  manualReviews: [],
  dataset: null,
};

test('readiness returns data_required instead of ready when data-dependent work lacks a dataset', async () => {
  const registry = new System3CapabilityRegistry();
  const evaluated = await registry.execute(
    'system3.readiness-gate-evaluator',
    {
      analysis: readinessAnalysis,
      pendingDecisionCount: 0,
      knowledgeSnapshotId: '11111111-1111-4111-8111-111111111111',
      projectVersion: 3,
      datasetSourceVersionId: null,
      requiredCapabilityIds: ['system3.project-scaffolder'],
      availableCapabilityIds: ['system3.project-scaffolder'],
    },
    context()
  );
  expect(evaluated.structuredOutput).toMatchObject({
    evaluation: {
      status: 'data_required',
      nextAction: 'link_dataset',
      blockerReasons: expect.arrayContaining([expect.stringContaining('Dataset')]),
    },
  });
});

test('readiness blocks for review when a dataset profile exists without a current pinned source', async () => {
  const registry = new System3CapabilityRegistry();
  const evaluated = await registry.execute(
    'system3.readiness-gate-evaluator',
    {
      analysis: {
        ...readinessAnalysis,
        dataset: {
          filename: 'customers.csv',
          rowCount: 2,
          columnCount: 2,
          columns: ['customer_id', 'churn'],
          targetColumn: 'churn',
          targetExists: true,
          targetDistribution: { yes: 1, no: 1 },
        },
      },
      pendingDecisionCount: 0,
      knowledgeSnapshotId: '11111111-1111-4111-8111-111111111111',
      projectVersion: 3,
      datasetSourceVersionId: null,
      requiredCapabilityIds: ['system3.project-scaffolder'],
      availableCapabilityIds: ['system3.project-scaffolder'],
    },
    context()
  );

  expect(evaluated.structuredOutput).toMatchObject({
    evaluation: {
      status: 'blocked',
      nextAction: 'review_understanding',
    },
  });
});

test('readiness freezes a contract only after dataset, target, runtime, decisions and capabilities pass', async () => {
  const registry = new System3CapabilityRegistry();
  const analysis = {
    ...readinessAnalysis,
    dataset: {
      filename: 'customers.csv',
      rowCount: 2,
      columnCount: 2,
      columns: ['customer_id', 'churn'],
      targetColumn: 'churn',
      targetExists: true,
      targetDistribution: { yes: 1, no: 1 },
    },
  };
  const gate = await registry.execute(
    'system3.readiness-gate-evaluator',
    {
      analysis,
      pendingDecisionCount: 0,
      knowledgeSnapshotId: '11111111-1111-4111-8111-111111111111',
      projectVersion: 3,
      datasetSourceVersionId: '22222222-2222-4222-8222-222222222222',
      requiredCapabilityIds: ['system3.project-scaffolder'],
      availableCapabilityIds: ['system3.project-scaffolder'],
    },
    context()
  );
  const evaluation = (gate.structuredOutput as { evaluation: unknown }).evaluation;
  const built = await registry.execute(
    'system3.readiness-contract-builder',
    {
      analysis,
      evaluation,
      datasetSourceVersionId: '22222222-2222-4222-8222-222222222222',
      resolvedDecisions: [],
    },
    context()
  );
  expect(built.structuredOutput).toMatchObject({
    evaluation: { status: 'passed' },
    contract: {
      schemaVersion: 2,
      status: 'passed',
      datasetSourceVersionId: '22222222-2222-4222-8222-222222222222',
      targetDefinition: 'churn',
      targetColumn: 'churn',
    },
  });
});

test('project scaffolder fails closed when pinned dataset bytes do not match approval', async () => {
  const datasetSourceVersionId = '33333333-3333-4333-8333-333333333334';
  const registry = new System3CapabilityRegistry({
    listSourceRefs: async () => [],
    readLatestSource: async () => ({ filename: 'latest.csv', text: 'id,churn\n2,no\n' }),
    readSourceVersion: async () => ({
      id: datasetSourceVersionId,
      kind: 'dataset',
      filename: 'approved.csv',
      mediaType: 'text/csv',
      contentHash: `sha256:${'a'.repeat(64)}`,
      bytes: new TextEncoder().encode('id,churn\n1,yes\n'),
    }),
    readArtifact: async () => new Uint8Array(),
  });
  await expect(
    registry.execute(
      'system3.project-scaffolder',
      {
        projectId: '11111111-1111-4111-8111-111111111111',
        projectName: 'Customer Churn',
        targetColumn: 'churn',
        datasetSourceVersionId,
        datasetContentHash: `sha256:${'a'.repeat(64)}`,
      },
      context()
    )
  ).rejects.toThrow('failed its content hash check');
});

test('baseline capabilities build, verify, and package a real deterministic project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anvil-system3-capabilities-'));
  const projectId = '11111111-1111-4111-8111-111111111111';
  const executionId = '22222222-2222-4222-8222-222222222222';
  const datasetSourceVersionId = '33333333-3333-4333-8333-333333333333';
  const datasetBytes = new TextEncoder().encode(
    '\uFEFF"customer,id",churn_old,note\n1," yes ","first\nline"\n2,no,ok\n3," yes ",ok\n'
  );
  const datasetContentHash = `sha256:${new Bun.CryptoHasher('sha256')
    .update(datasetBytes)
    .digest('hex')}`;
  const registry = new System3CapabilityRegistry({
    listSourceRefs: async () => [],
    readLatestSource: async (_id, kind) =>
      kind === 'dataset' ? { filename: 'latest.csv', text: 'customer_id,churn\n99,no\n' } : null,
    readSourceVersion: async (_id, sourceVersionId) =>
      sourceVersionId === datasetSourceVersionId
        ? {
            id: datasetSourceVersionId,
            kind: 'dataset',
            filename: 'customers-a.csv',
            mediaType: 'text/csv',
            contentHash: datasetContentHash,
            bytes: datasetBytes,
          }
        : null,
    readArtifact: async () => new Uint8Array(),
  });
  const buildContext = {
    ...context(),
    artifactsDir: join(root, 'children', 'build', 'build-run'),
  };
  const experimentContext = {
    ...context(),
    artifactsDir: join(root, 'children', 'experiment', 'experiment-run'),
  };
  const verifyContext = {
    ...context(),
    artifactsDir: join(root, 'children', 'verify', 'verify-run'),
  };
  const body = (value: { structuredOutput?: unknown }): Record<string, unknown> =>
    value.structuredOutput as Record<string, unknown>;

  try {
    const scaffold = body(
      await registry.execute(
        'system3.project-scaffolder',
        {
          projectId,
          projectName: 'Customer Churn',
          targetColumn: 'churn_old',
          datasetSourceVersionId,
          datasetContentHash,
        },
        buildContext
      )
    );
    const projectDir = scaffold.projectDir;
    expect(typeof projectDir).toBe('string');
    await registry.execute('system3.project-validator', { projectDir }, buildContext);
    await registry.execute('system3.dataset-validator', { projectDir }, experimentContext);
    expect(new Uint8Array(await readFile(join(String(projectDir), 'data', 'input.csv')))).toEqual(
      datasetBytes
    );
    const tests = body(
      await registry.execute('system3.test-runner', { projectDir }, experimentContext)
    );
    const data = body(
      await registry.execute('system3.data-pipeline-runner', { projectDir }, experimentContext)
    );
    const baseline = body(
      await registry.execute('system3.baseline-runner', { projectDir }, experimentContext)
    );
    expect(data.dataResult).toMatchObject({ rows: 3, targetColumn: 'churn_old' });
    expect(baseline.experiment).toMatchObject({
      metrics: { rows: 3, prediction: ' yes ', accuracy: 2 / 3 },
    });
    const analysis = analyzeBlueprintMarkdown(
      '# Requirements\n- REQ-001: Predict churn in 90 days.\nCPU-only, RAM 8 GB.',
      null
    );
    const evidenceInput = {
      projectDir,
      analysis,
      testResult: tests.testResult,
      dataResult: data.dataResult,
      experiment: baseline.experiment,
    };
    await registry.execute('system3.artifact-schema-validator', evidenceInput, verifyContext);
    const evidence = body(
      await registry.execute('system3.evidence-map-builder', evidenceInput, verifyContext)
    );
    const gate = body(
      await registry.execute(
        'system3.baseline-gate-evaluator',
        { evidenceMap: evidence.evidenceMap },
        verifyContext
      )
    );
    const packaged = body(
      await registry.execute(
        'system3.delivery-packager',
        { projectDir, gate: gate.gate },
        verifyContext
      )
    );
    const manifest = body(
      await registry.execute(
        'system3.delivery-manifest-builder',
        {
          projectId,
          executionId,
          packagePath: packaged.packagePath,
          evidenceMap: evidence.evidenceMap,
          gate: gate.gate,
        },
        verifyContext
      )
    );

    const packageBytes = await readFile(String(packaged.packagePath));
    const packageHash = `sha256:${new Bun.CryptoHasher('sha256')
      .update(packageBytes)
      .digest('hex')}`;
    expect(packageBytes).not.toHaveLength(0);
    expect(manifest).toMatchObject({
      delivery: {
        status: 'ready',
        requirementCoverage: { status: 'not_verified', verified: 0 },
        gate: { id: 'G5', status: 'passed' },
      },
    });

    const reuseRegistry = new System3CapabilityRegistry({
      listSourceRefs: async () => [],
      readLatestSource: async () => null,
      readArtifact: async () => packageBytes,
    });
    const reused = body(
      await reuseRegistry.execute(
        'system3.delivery-artifact-materializer',
        {
          projectId,
          storageKey: 'artifacts/delivery/approved/generated_project.tar.gz',
          contentHash: packageHash,
          sourceExecutionId: executionId,
        },
        { ...context(), artifactsDir: join(root, 'children', 'reuse', 'reuse-run') }
      )
    );
    expect(reused).toMatchObject({
      testResult: { exitCode: 0 },
      dataResult: { status: 'passed' },
      experiment: { status: 'passed' },
    });
    const datasetBBytes = new TextEncoder().encode(
      'customer_id,churn_new\n10,no\n11,no\n12,no\n13,yes\n'
    );
    const datasetBHash = `sha256:${new Bun.CryptoHasher('sha256')
      .update(datasetBBytes)
      .digest('hex')}`;
    const datasetBId = '44444444-4444-4444-8444-444444444445';
    const rebindRegistry = new System3CapabilityRegistry({
      listSourceRefs: async () => [],
      readLatestSource: async () => ({ filename: 'wrong-latest.csv', text: 'id,churn\n1,no\n' }),
      readSourceVersion: async () => ({
        id: datasetBId,
        kind: 'dataset',
        filename: 'customers-b.csv',
        mediaType: 'text/csv',
        contentHash: datasetBHash,
        bytes: datasetBBytes,
      }),
      readArtifact: async () => new Uint8Array(),
    });
    await rebindRegistry.execute(
      'system3.pinned-dataset-materializer',
      {
        projectId,
        projectDir: reused.projectDir,
        targetColumn: 'churn_new',
        datasetSourceVersionId: datasetBId,
        datasetContentHash: datasetBHash,
      },
      { ...context(), artifactsDir: join(root, 'children', 'reuse', 'reuse-run') }
    );
    expect(await readFile(join(String(reused.projectDir), 'data', 'input.csv'), 'utf8')).toBe(
      new TextDecoder().decode(datasetBBytes)
    );
    await rebindRegistry.execute(
      'system3.dataset-validator',
      { projectDir: reused.projectDir },
      { ...context(), artifactsDir: join(root, 'children', 'reuse', 'reuse-run') }
    );
    const reboundData = body(
      await rebindRegistry.execute(
        'system3.data-pipeline-runner',
        { projectDir: reused.projectDir },
        { ...context(), artifactsDir: join(root, 'children', 'reuse', 'reuse-run') }
      )
    );
    expect(reboundData.dataResult).toEqual({
      status: 'passed',
      rows: 4,
      targetColumn: 'churn_new',
      datasetSourceVersionId: datasetBId,
      datasetContentHash: datasetBHash,
    });
    expect(
      `sha256:${new Bun.CryptoHasher('sha256')
        .update(await readFile(String(packaged.packagePath)))
        .digest('hex')}`
    ).toBe(packageHash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
