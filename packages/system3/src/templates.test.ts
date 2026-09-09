import { expect, test } from 'bun:test';
import {
  buildCustomerChurnDeliveryWorkflows,
  buildCustomerChurnExecutionWorkflows,
  buildCustomerChurnVerificationWorkflows,
  buildReadinessContractWorkflow,
  buildUnderstandProjectWorkflow,
} from './templates';

const base = {
  projectId: '11111111-1111-4111-8111-111111111111',
  executionId: '22222222-2222-4222-8222-222222222222',
  compilationId: '33333333-3333-4333-8333-333333333333',
  definitionHash: `sha256:${'a'.repeat(64)}`,
  projectName: 'Customer Churn',
  targetColumn: 'churn',
  datasetSource: {
    id: '77777777-7777-4777-8777-777777777777',
    contentHash: `sha256:${'d'.repeat(64)}`,
  },
  plan: {},
  analysis: {},
};
const reusableArtifact = {
  kind: 'delivery_package' as const,
  storageKey: 'artifacts/delivery/abc/generated_project.tar.gz',
  contentHash: `sha256:${'b'.repeat(64)}`,
  sourceExecutionId: '44444444-4444-4444-8444-444444444444',
  sourceVersionIds: [base.datasetSource.id],
};

test('TW-02 pins exact sources before its deterministic analysis node', () => {
  const workflow = buildUnderstandProjectWorkflow({
    projectId: base.projectId,
    inputSnapshotId: '55555555-5555-4555-8555-555555555555',
    sources: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        kind: 'blueprint',
        filename: 'system-2.md',
        mediaType: 'text/markdown',
        contentHash: `sha256:${'c'.repeat(64)}`,
      },
    ],
  });
  expect(workflow.nodes.map(node => node.id)).toEqual([
    'verify-input-snapshot',
    'analyze-understanding',
  ]);
  expect(workflow.outputs.analysis).toBe('$analyze-understanding.output.analysis');
  expect(workflow.nodes[0]).toMatchObject({
    action: {
      input: {
        sources: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            contentHash: `sha256:${'c'.repeat(64)}`,
          },
        ],
      },
    },
  });
});

test('TW-03 returns a business evaluation and an optional passed contract', () => {
  const workflow = buildReadinessContractWorkflow({
    analysis: {},
    decisions: [],
    knowledgeSnapshotId: '11111111-1111-4111-8111-111111111111',
    projectVersion: 3,
    datasetSourceVersionId: null,
    requiredCapabilityIds: ['system3.project-scaffolder'],
    availableCapabilityIds: ['system3.project-scaffolder'],
  });

  expect(workflow.outputs).toEqual({
    evaluation: '$finalize-contract.output.evaluation',
    contract: '$finalize-contract.output.contract',
  });
  expect(workflow.output_schema.required).toEqual(['evaluation', 'contract']);
});

test('full execution compiles only build and experiment children', () => {
  const bundle = buildCustomerChurnExecutionWorkflows({
    ...base,
    rerunScope: { executionMode: 'full', reusedArtifacts: [] },
  });
  expect(bundle.root.nodes.map(node => node.id)).toEqual(['baseline-build', 'baseline-experiment']);
  expect(bundle.definitions.map(definition => definition.name)).not.toContain('system3-verify');
});

test('delivery scoped execution skips build and experiment nodes', () => {
  const bundle = buildCustomerChurnExecutionWorkflows({
    ...base,
    rerunScope: { executionMode: 'delivery', reusedArtifacts: [reusableArtifact] },
  });
  expect(bundle.root.nodes.map(node => node.id)).toEqual(['reuse-experiment-artifact']);
  expect(bundle.definitions.map(definition => definition.name)).not.toContain(
    'system3-baseline-build'
  );
  expect(bundle.definitions.map(definition => definition.name)).not.toContain(
    'system3-baseline-experiment'
  );
});

test('experiment scoped execution reapplies the exact approved dataset before running', () => {
  const bundle = buildCustomerChurnExecutionWorkflows({
    ...base,
    rerunScope: { executionMode: 'experiment', reusedArtifacts: [reusableArtifact] },
  });
  expect(bundle.root.nodes.map(node => node.id)).toEqual([
    'reuse-build-artifact',
    'materialize-pinned-dataset',
    'baseline-experiment',
  ]);
  expect(bundle.root.nodes[1]).toMatchObject({
    action: {
      executor: 'system3.pinned-dataset-materializer',
      input: {
        datasetSourceVersionId: base.datasetSource.id,
        datasetContentHash: base.datasetSource.contentHash,
      },
    },
  });
});

test('verification and delivery are independent technical workflows', () => {
  const artifact = {
    storageKey: reusableArtifact.storageKey,
    contentHash: reusableArtifact.contentHash,
    sourceExecutionId: reusableArtifact.sourceExecutionId,
  };
  const verification = buildCustomerChurnVerificationWorkflows({
    projectId: base.projectId,
    analysis: {},
    artifact,
  });
  const delivery = buildCustomerChurnDeliveryWorkflows({
    projectId: base.projectId,
    executionId: base.executionId,
    artifact,
    evidenceMap: {},
    gate: { status: 'passed' },
  });
  expect(verification.root.name).toBe('system3-customer-churn-verification');
  expect(delivery.root.name).toBe('system3-customer-churn-delivery');
  expect(verification.definitions.map(value => value.name)).not.toContain(delivery.root.name);
});
