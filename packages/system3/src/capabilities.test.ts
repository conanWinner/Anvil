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

test('readiness capabilities fail closed until decisions are answered', async () => {
  const registry = new System3CapabilityRegistry();
  const decisions = [{ id: 'decision-1', status: 'pending' as const, answer: null }];

  await expect(
    registry.execute('system3.decision-resolver', { decisions }, context())
  ).rejects.toThrow('Readiness requires 1 decision(s) to be resolved');

  const resolved = await registry.execute(
    'system3.decision-resolver',
    { decisions: [{ ...decisions[0], status: 'answered', answer: 'Use recall' }] },
    context()
  );
  expect(resolved.structuredOutput).toEqual({
    resolvedDecisions: [{ id: 'decision-1', answer: 'Use recall' }],
  });
});

test('baseline capabilities build, verify, and package a real deterministic project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anvil-system3-capabilities-'));
  const projectId = '11111111-1111-4111-8111-111111111111';
  const executionId = '22222222-2222-4222-8222-222222222222';
  const registry = new System3CapabilityRegistry({
    listSourceRefs: async () => [],
    readLatestSource: async (_id, kind) =>
      kind === 'dataset'
        ? { filename: 'customers.csv', text: 'customer_id,churn\n1,yes\n2,no\n3,yes\n' }
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
        { projectId, projectName: 'Customer Churn', targetColumn: 'churn' },
        buildContext
      )
    );
    const projectDir = scaffold.projectDir;
    expect(typeof projectDir).toBe('string');
    await registry.execute('system3.project-validator', { projectDir }, buildContext);
    await registry.execute('system3.dataset-validator', { projectDir }, experimentContext);
    const tests = body(
      await registry.execute('system3.test-runner', { projectDir }, experimentContext)
    );
    const data = body(
      await registry.execute('system3.data-pipeline-runner', { projectDir }, experimentContext)
    );
    const baseline = body(
      await registry.execute('system3.baseline-runner', { projectDir }, experimentContext)
    );
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
          contentHash: `sha256:${new Bun.CryptoHasher('sha256').update(packageBytes).digest('hex')}`,
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
