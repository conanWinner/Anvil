import { expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import {
  compileCustomerChurnReference,
  modelComparisonConfigSchema,
  parsePinnedModelComparisonConfig,
  System3CapabilityRegistry,
  system3ReadinessContractBodySchema,
  type BlueprintAnalysis,
  type System3ReadinessContractBody,
  type System3SourceRecord,
} from '@anvil/system3';

const bytesOf = (value: string): Uint8Array => new TextEncoder().encode(value);
const hashOf = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

test('targetless comparison passes pinned Readiness and compiles with its same config', async () => {
  const projectId = randomUUID();
  const knowledgeSnapshotId = randomUUID();
  const datasetId = randomUUID();
  const blueprintId = randomUUID();
  const constraintId = randomUUID();
  const config = modelComparisonConfigSchema.parse({
    schemaVersion: 1,
    models: ['router9/test-a', 'router9/test-b'],
    prompt: 'Summarize customers and orders by state.',
    harness: 'print("checks")',
    requirementIds: ['FR-01'],
  });
  const configBytes = bytesOf(JSON.stringify({ modelComparison: config }));
  const pinnedConfig = parsePinnedModelComparisonConfig(configBytes, hashOf(configBytes));
  const blueprintBytes = bytesOf('# Aggregate customers');
  const datasetBytes = bytesOf('customer_unique_id,order_count,customer_state\na,2,SP\n');
  const source = (
    id: string,
    kind: System3SourceRecord['kind'],
    filename: string,
    bytes: Uint8Array,
    mediaType: string
  ): System3SourceRecord => ({
    id,
    sourceId: id,
    projectId,
    kind,
    role: 'primary',
    filename,
    originalFilename: filename,
    mediaType,
    version: 1,
    contentHash: hashOf(bytes),
    sizeBytes: bytes.byteLength,
    storageKey: `sources/${filename}`,
    storageStatus: 'ready',
    validationReport: { schemaVersion: 1, outcome: 'accepted', checks: [], warnings: [] },
    createdBy: null,
    origin: 'integration-test',
    operationId: null,
    intakeReportArtifactId: null,
    createdAt: new Date(0).toISOString(),
  });
  const sources = [
    source(blueprintId, 'blueprint', 'problem.md', blueprintBytes, 'text/markdown'),
    source(datasetId, 'dataset', 'input.csv', datasetBytes, 'text/csv'),
    source(constraintId, 'constraints', 'model-comparison.json', configBytes, 'application/json'),
  ];
  const analysis: BlueprintAnalysis = {
    schemaVersion: 1,
    businessGoal: 'Summarize customers and orders by state.',
    technicalObjective: 'Print JSON aggregate output.',
    targetDefinition: null,
    runtime: { cpuOnly: true, ramGb: 1 },
    requirements: [
      {
        id: 'FR-01',
        kind: 'FR',
        priority: 'HIGH',
        source: 'sample',
        statement: 'Summarize totals by state.',
        acceptanceCriterion: 'The checks match the pinned CSV.',
        sourcePointer: 'problem.md:1',
      },
    ],
    modules: [],
    manualReviews: [],
    dataset: {
      filename: 'input.csv',
      rowCount: 1,
      columnCount: 3,
      columns: ['customer_unique_id', 'order_count', 'customer_state'],
      targetColumn: null,
      targetExists: false,
      targetDistribution: {},
    },
  };
  const registry = new System3CapabilityRegistry();
  const context = {
    runId: 'readiness-integration',
    nodeId: 'evaluate-gates',
    cwd: '/tmp',
    artifactsDir: '/tmp/anvil-comparison-readiness-integration',
    signal: new AbortController().signal,
  };
  const evaluated = await registry.execute(
    'system3.readiness-gate-evaluator',
    {
      analysis,
      modelComparison: pinnedConfig,
      pendingDecisionCount: 0,
      knowledgeSnapshotId,
      projectVersion: 10,
      datasetSourceVersionId: datasetId,
      requiredCapabilityIds: [],
      availableCapabilityIds: [],
    },
    context
  );
  const evaluation = (evaluated.structuredOutput as { evaluation: { status: string } }).evaluation;
  expect(evaluation.status).toBe('passed');
  const built = await registry.execute(
    'system3.readiness-contract-builder',
    {
      analysis,
      modelComparison: pinnedConfig,
      evaluation,
      datasetSourceVersionId: datasetId,
      resolvedDecisions: [],
    },
    { ...context, nodeId: 'finalize-contract' }
  );
  const contract = system3ReadinessContractBodySchema.parse(
    (built.structuredOutput as { contract: unknown }).contract
  );
  expect(contract.schemaVersion).toBe(3);
  expect(contract).not.toHaveProperty('targetDefinition');
  expect(contract).not.toHaveProperty('targetColumn');
  expect(contract.schemaVersion === 3 ? contract.modelComparison : null).toEqual(pinnedConfig);

  const compiled = compileCustomerChurnReference({
    projectId,
    projectVersion: 11,
    knowledgeSnapshotId,
    sources,
    analysis,
    modelComparison: pinnedConfig,
    readinessContractBody: contract as System3ReadinessContractBody,
  });
  expect(compiled.plan.modelComparison).toEqual(pinnedConfig);
  expect(JSON.stringify(compiled.workflowBundles)).not.toContain('"targetColumn":"target"');
  expect(() => parsePinnedModelComparisonConfig(configBytes, `sha256:${'0'.repeat(64)}`)).toThrow(
    'Pinned model comparison configuration hash mismatch'
  );
  expect(() =>
    compileCustomerChurnReference({
      projectId,
      projectVersion: 11,
      knowledgeSnapshotId,
      sources,
      analysis,
      modelComparison: { ...pinnedConfig, prompt: 'Changed after readiness.' },
      readinessContractBody: contract,
    })
  ).toThrow('matching pinned comparison Readiness Contract');
});
