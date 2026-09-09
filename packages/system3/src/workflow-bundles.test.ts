import { expect, test } from 'bun:test';
import type { BlueprintAnalysis } from './contracts';
import {
  bindSystem3WorkflowBundle,
  compileSystem3WorkflowBundles,
  createApprovalManifest,
  hashSystem3Definition,
  verifyApprovedWorkflowBundle,
} from './compiler';

const projectId = '00000000-0000-4000-8000-000000000010';
const compilationId = '00000000-0000-4000-8000-000000000030';
const analysis: BlueprintAnalysis = {
  schemaVersion: 1,
  businessGoal: null,
  technicalObjective: null,
  targetDefinition: null,
  runtime: { cpuOnly: true, ramGb: 8 },
  requirements: [],
  modules: [],
  manualReviews: [],
  dataset: null,
};
const plan = {
  schemaVersion: 3 as const,
  compilerVersion: 'system3-compiler@3' as const,
  templateId: 'customer-churn-reference@1' as const,
  productWorkflowVersionId: '00000000-0000-4000-8000-000000000101',
  inputSnapshotId: '00000000-0000-4000-8000-000000000102',
  capabilityRegistrySnapshotId: '00000000-0000-4000-8000-000000000103',
  compilationBasisId: '00000000-0000-4000-8000-000000000104',
  executionPlanSnapshotId: '00000000-0000-4000-8000-000000000105',
  runtimeProfileVersionId: '00000000-0000-4000-8000-000000000106',
  runtimeProfileHash: `sha256:${'a'.repeat(64)}`,
  runtimeProfile: analysis.runtime,
  inputSnapshot: {
    sourceIds: ['00000000-0000-4000-8000-000000000107'],
    sourceHashes: [`sha256:${'b'.repeat(64)}`],
  },
  knowledgeSnapshotId: '00000000-0000-4000-8000-000000000108',
  capabilityRegistry: [],
  rerunScope: {
    mode: 'full' as const,
    executionMode: 'full' as const,
    impactManifestId: null,
    impactManifestIds: [],
    affectedPhases: ['understanding'],
    skippedPhases: [],
    reusedArtifacts: [],
  },
  phases: [],
};

function bundles(
  mode: 'full' | 'experiment' | 'delivery' = 'full',
  datasetSource = {
    id: '00000000-0000-4000-8000-000000000001',
    contentHash: `sha256:${'d'.repeat(64)}`,
  }
) {
  const reusableArtifact = {
    kind: 'delivery_package' as const,
    storageKey: 'artifacts/delivery/baseline.tar.gz',
    contentHash: `sha256:${'c'.repeat(64)}`,
    sourceExecutionId: '00000000-0000-4000-8000-000000000109',
    sourceVersionIds: ['00000000-0000-4000-8000-000000000001'],
  };
  return compileSystem3WorkflowBundles({
    projectId,
    compilationId,
    projectName: 'Customer Churn',
    targetColumn: 'churn',
    datasetSource,
    plan,
    analysis,
    runtimeProfile: analysis.runtime,
    capabilityRegistry: [],
    rerunScope: {
      executionMode: mode,
      reusedArtifacts: mode === 'full' ? [] : [reusableArtifact],
    },
  });
}

test('changing the pinned dataset changes the TW-06 bundle hash', () => {
  const first = bundles('full').find(bundle => bundle.activityId === 'TW-06');
  const second = bundles('full', {
    id: '00000000-0000-4000-8000-000000000002',
    contentHash: `sha256:${'e'.repeat(64)}`,
  }).find(bundle => bundle.activityId === 'TW-06');
  expect(first?.definitionHash).not.toBe(second?.definitionHash);
});

test('compiles exactly one immutable bundle for TW-06, TW-07 and TW-09 in every mode', () => {
  for (const mode of ['full', 'experiment', 'delivery'] as const) {
    const snapshots = bundles(mode);
    expect(snapshots.map(value => value.activityId)).toEqual(['TW-06', 'TW-07', 'TW-09']);
    expect(new Set(snapshots.map(value => value.id)).size).toBe(3);
    expect(snapshots.every(value => value.executionMode === mode)).toBe(true);
  }
});

test('bundle hash covers executor, dependency, mapping, schema, timeout, capability, permission and runtime profile', () => {
  const [snapshot] = bundles();
  if (!snapshot) throw new Error('Expected TW-06 bundle');
  const mutations: unknown[] = [
    { ...snapshot.definition, workflows: [{ name: 'changed-executor' }] },
    { ...snapshot.definition, dependencies: { changed: ['dependency'] } },
    { ...snapshot.definition, inputMappings: { changed: '$INPUTS.value' } },
    { ...snapshot.definition, outputSchemas: { changed: { type: 'string' } } },
    { ...snapshot.definition, timeouts: { changed: 1 } },
    { ...snapshot.definition, capabilityRegistry: [{ id: 'changed', version: '2' }] },
    { ...snapshot.definition, permissions: ['changed:permission'] },
    { ...snapshot.definition, runtimeProfile: { cpuOnly: false, ramGb: 99 } },
  ];
  for (const mutation of mutations) {
    expect(hashSystem3Definition(mutation)).not.toBe(snapshot.definitionHash);
  }
  expect(bundles()[0]?.definitionHash).toBe(snapshot.definitionHash);
});

test('approval pins exactly the three bundle IDs and hashes', () => {
  const snapshots = bundles();
  const definitionHash = hashSystem3Definition(plan);
  const manifest = createApprovalManifest({
    compilationId,
    projectId,
    plan,
    definitionHash,
    capabilityRegistryHash: hashSystem3Definition([]),
    workflowBundles: snapshots,
  });
  expect(manifest.schemaVersion).toBe(3);
  expect(manifest.workflowBundleBindings).toEqual(
    snapshots.map(snapshot => ({
      activityId: snapshot.activityId,
      bundleSnapshotId: snapshot.id,
      bundleHash: snapshot.definitionHash,
      schemaVersion: 3,
    }))
  );
});

test('typed runtime bindings reject missing, extra and invalid values before returning definitions', () => {
  const snapshot = bundles().find(value => value.activityId === 'TW-07');
  if (!snapshot) throw new Error('Expected TW-07 bundle');
  expect(() => bindSystem3WorkflowBundle(snapshot, {})).toThrow('Missing runtime binding');
  expect(() =>
    bindSystem3WorkflowBundle(snapshot, {
      artifactStorageKey: 'artifacts/a.tar.gz',
      artifactContentHash: `sha256:${'d'.repeat(64)}`,
      sourceExecutionId: 'not-a-uuid',
    })
  ).toThrow('sourceExecutionId');
  expect(() =>
    bindSystem3WorkflowBundle(snapshot, {
      artifactStorageKey: 'artifacts/a.tar.gz',
      artifactContentHash: `sha256:${'d'.repeat(64)}`,
      sourceExecutionId: '00000000-0000-4000-8000-000000000110',
      executableNode: 'not-approved',
    })
  ).toThrow('Unexpected runtime binding');
});

test('TW-06 declares executionId and binding removes every runtime marker', () => {
  const snapshot = bundles().find(value => value.activityId === 'TW-06');
  if (!snapshot) throw new Error('Expected TW-06 bundle');
  expect(() => bindSystem3WorkflowBundle(snapshot, {})).toThrow('Missing runtime binding');
  const bound = bindSystem3WorkflowBundle(snapshot, {
    executionId: '00000000-0000-4000-8000-000000000111',
  });
  expect(JSON.stringify(bound.definition)).not.toContain('$BINDING.');
});

test('TW-09 replaces evidence and gate markers as whole typed objects', () => {
  const snapshot = bundles().find(value => value.activityId === 'TW-09');
  if (!snapshot) throw new Error('Expected TW-09 bundle');
  const bound = bindSystem3WorkflowBundle(snapshot, {
    artifactStorageKey: 'artifacts/a.tar.gz',
    artifactContentHash: `sha256:${'d'.repeat(64)}`,
    sourceExecutionId: '00000000-0000-4000-8000-000000000110',
    executionId: '00000000-0000-4000-8000-000000000111',
    evidenceMap: { requirement: 'verified' },
    gate: { status: 'passed' },
  });
  const definition = JSON.stringify(bound.definition);
  expect(definition).toContain('"evidenceMap":{"requirement":"verified"}');
  expect(definition).toContain('"gate":{"status":"passed"}');
  expect(definition).not.toContain('$BINDING.');
});

test('approved lineage rejects legacy, cross-compilation and tampered snapshots', () => {
  const snapshots = bundles();
  const definitionHash = hashSystem3Definition(plan);
  const manifest = createApprovalManifest({
    compilationId,
    projectId,
    plan,
    definitionHash,
    capabilityRegistryHash: hashSystem3Definition([]),
    workflowBundles: snapshots,
  });
  const snapshot = snapshots[0];
  if (!snapshot) throw new Error('Expected TW-06 bundle');
  expect(() =>
    verifyApprovedWorkflowBundle({
      projectId,
      compilationId,
      plan,
      definitionHash,
      approvalManifest: { ...manifest, workflowBundleBindings: undefined } as never,
      bundle: snapshot,
      activityId: 'TW-06',
    })
  ).toThrow('recompile_required');
  expect(() =>
    verifyApprovedWorkflowBundle({
      projectId,
      compilationId,
      plan,
      definitionHash,
      approvalManifest: manifest,
      bundle: { ...snapshot, compilationId: '00000000-0000-4000-8000-000000000999' },
      activityId: 'TW-06',
    })
  ).toThrow('recompile_required');
  expect(() =>
    verifyApprovedWorkflowBundle({
      projectId,
      compilationId,
      plan,
      definitionHash,
      approvalManifest: manifest,
      bundle: { ...snapshot, definition: { ...snapshot.definition, rootWorkflow: 'tampered' } },
      activityId: 'TW-06',
    })
  ).toThrow('recompile_required');
});
