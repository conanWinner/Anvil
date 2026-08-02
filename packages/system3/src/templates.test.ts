import { expect, test } from 'bun:test';
import {
  buildCustomerChurnDeliveryWorkflows,
  buildCustomerChurnExecutionWorkflows,
  buildCustomerChurnVerificationWorkflows,
} from './templates';

const base = {
  projectId: '11111111-1111-4111-8111-111111111111',
  executionId: '22222222-2222-4222-8222-222222222222',
  compilationId: '33333333-3333-4333-8333-333333333333',
  definitionHash: `sha256:${'a'.repeat(64)}`,
  projectName: 'Customer Churn',
  targetColumn: 'churn',
  plan: {},
  analysis: {},
};
const reusableArtifact = {
  kind: 'delivery_package' as const,
  storageKey: 'artifacts/delivery/abc/generated_project.tar.gz',
  contentHash: `sha256:${'b'.repeat(64)}`,
  sourceExecutionId: '44444444-4444-4444-8444-444444444444',
};

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
