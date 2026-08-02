import { expect, test } from 'bun:test';
import {
  compileCustomerChurnReference,
  createApprovalManifest,
  validateSystem3CapabilityPolicy,
} from './compiler';
import type { BlueprintAnalysis } from './contracts';
import type { System3SourceRecord } from './store';

const blueprint: System3SourceRecord = {
  id: '00000000-0000-4000-8000-000000000001',
  sourceId: '00000000-0000-4000-8000-000000000001',
  projectId: '00000000-0000-4000-8000-000000000010',
  kind: 'blueprint',
  role: 'primary',
  filename: 'DESIGN_B_2.md',
  originalFilename: 'DESIGN_B_2.md',
  mediaType: 'text/markdown',
  version: 1,
  contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  sizeBytes: 1,
  storageKey: 'sources/blueprint/a/DESIGN_B_2.md',
  storageStatus: 'ready',
  validationReport: { schemaVersion: 1, outcome: 'accepted', checks: [], warnings: [] },
  createdBy: null,
  origin: 'test',
  operationId: null,
  intakeReportArtifactId: null,
  createdAt: '2026-07-21T00:00:00.000Z',
};

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

test('compiles a deterministic Customer Churn execution plan', () => {
  const input = {
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: [blueprint],
    analysis,
  };
  const first = compileCustomerChurnReference(input);
  const second = compileCustomerChurnReference(input);

  expect(first.definitionHash).toBe(second.definitionHash);
  expect(first.plan.phases[0]?.workflow).toBe('system3-understand-project');
  expect(first.plan.phases[0]?.resourceProfile).toEqual({ cpuOnly: true, ramGb: 8 });
});

test('scopes persisted workflow and capability snapshot IDs to the project', () => {
  const common = {
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: [blueprint],
    analysis,
  };
  const first = compileCustomerChurnReference({
    ...common,
    projectId: '00000000-0000-4000-8000-000000000010',
  });
  const second = compileCustomerChurnReference({
    ...common,
    projectId: '00000000-0000-4000-8000-000000000011',
  });

  expect(first.plan.productWorkflowVersionId).not.toBe(second.plan.productWorkflowVersionId);
  expect(first.plan.capabilityRegistrySnapshotId).not.toBe(
    second.plan.capabilityRegistrySnapshotId
  );
});

test('approval manifest pins the compiled plan hashes', () => {
  const compiled = compileCustomerChurnReference({
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: [blueprint],
    analysis,
  });
  const manifest = createApprovalManifest({
    compilationId: '00000000-0000-4000-8000-000000000030',
    projectId: blueprint.projectId,
    plan: compiled.plan,
    definitionHash: compiled.definitionHash,
    capabilityRegistryHash: compiled.capabilityRegistryHash,
  });

  expect(manifest.executionPlanHash).toBe(compiled.definitionHash);
  expect(manifest.runtimeProfile).toEqual({ cpuOnly: true, ramGb: 8 });
});

test('pins the immutable readiness contract into the execution plan and approval', () => {
  const readinessContract = {
    id: '00000000-0000-4000-8000-000000000050',
    contractHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  };
  const compiled = compileCustomerChurnReference({
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: [blueprint],
    analysis,
    readinessContract,
  });
  expect(compiled.plan.readinessContract).toEqual(readinessContract);
  expect(
    createApprovalManifest({
      compilationId: '00000000-0000-4000-8000-000000000030',
      projectId: blueprint.projectId,
      plan: compiled.plan,
      definitionHash: compiled.definitionHash,
      capabilityRegistryHash: compiled.capabilityRegistryHash,
    }).readinessContract
  ).toEqual(readinessContract);
});

test('pins only the latest immutable version from each logical source', () => {
  const previousBlueprint = { ...blueprint, id: '00000000-0000-4000-8000-000000000002' };
  const currentBlueprint = {
    ...blueprint,
    id: '00000000-0000-4000-8000-000000000003',
    version: 2,
    contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  };
  const compiled = compileCustomerChurnReference({
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: [currentBlueprint, previousBlueprint],
    analysis,
  });

  expect(compiled.plan.inputSnapshot.sourceIds).toEqual([currentBlueprint.id]);
  expect(compiled.plan.inputSnapshot.sourceHashes).toEqual([currentBlueprint.contentHash]);
});

test('keeps multiple active source lineages of the same kind', () => {
  const supportingBlueprint = {
    ...blueprint,
    id: '00000000-0000-4000-8000-000000000004',
    sourceId: '00000000-0000-4000-8000-000000000104',
    role: 'supplemental' as const,
    filename: 'appendix.md',
    originalFilename: 'appendix.md',
    contentHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  };
  const compiled = compileCustomerChurnReference({
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: [supportingBlueprint, blueprint],
    analysis,
  });

  expect(compiled.plan.inputSnapshot.sourceIds).toContain(blueprint.id);
  expect(compiled.plan.inputSnapshot.sourceIds).toContain(supportingBlueprint.id);
  expect(compiled.plan.inputSnapshot.sourceIds).toHaveLength(2);
});

test('refuses compilation when a required capability cannot be resolved', () => {
  expect(() =>
    compileCustomerChurnReference({
      knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
      sources: [blueprint],
      analysis,
      availableCapabilities: [],
    })
  ).toThrow('unresolved required capabilities');
});

test('rejects capability policy tampering after compilation', () => {
  const compiled = compileCustomerChurnReference({
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: [blueprint],
    analysis,
  });
  const [firstCapability, ...remainingCapabilities] = compiled.plan.capabilityRegistry;
  if (firstCapability === undefined) throw new Error('Expected a compiled capability');

  expect(() =>
    validateSystem3CapabilityPolicy(compiled.plan, [
      {
        ...firstCapability,
        permissions: [...firstCapability.permissions, 'process:tar'],
      },
      ...remainingCapabilities,
    ])
  ).toThrow(`Capability policy changed for '${firstCapability.id}@${firstCapability.version}'`);
});

test('pins a pending impact manifest into a deterministic scoped rerun', () => {
  const compiled = compileCustomerChurnReference({
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: [blueprint],
    analysis,
    rerunScope: {
      impactManifestId: '00000000-0000-4000-8000-000000000040',
      affectedPhases: [
        'readiness',
        'data',
        'features',
        'experiments',
        'explainability',
        'delivery',
      ],
    },
  });

  expect(compiled.plan.rerunScope).toEqual({
    mode: 'scoped',
    executionMode: 'full',
    impactManifestId: '00000000-0000-4000-8000-000000000040',
    impactManifestIds: ['00000000-0000-4000-8000-000000000040'],
    affectedPhases: ['readiness', 'data', 'features', 'experiments', 'explainability', 'delivery'],
    skippedPhases: [],
    reusedArtifacts: [],
  });
  expect(
    createApprovalManifest({
      compilationId: '00000000-0000-4000-8000-000000000030',
      projectId: blueprint.projectId,
      plan: compiled.plan,
      definitionHash: compiled.definitionHash,
      capabilityRegistryHash: compiled.capabilityRegistryHash,
    }).executionPlanHash
  ).toBe(compiled.definitionHash);
});

test('pins an approved artifact for a delivery-only scoped execution', () => {
  const reusableArtifact = {
    kind: 'delivery_package' as const,
    storageKey: 'artifacts/delivery/abc/generated_project.tar.gz',
    contentHash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    sourceExecutionId: '00000000-0000-4000-8000-000000000060',
  };
  const compiled = compileCustomerChurnReference({
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: [blueprint],
    analysis,
    rerunScope: {
      impactManifestId: '00000000-0000-4000-8000-000000000040',
      affectedPhases: ['delivery'],
      reusableArtifact,
    },
  });

  expect(compiled.plan.rerunScope).toEqual({
    mode: 'scoped',
    executionMode: 'delivery',
    impactManifestId: '00000000-0000-4000-8000-000000000040',
    impactManifestIds: ['00000000-0000-4000-8000-000000000040'],
    affectedPhases: ['delivery'],
    skippedPhases: [
      'understanding',
      'readiness',
      'data',
      'features',
      'experiments',
      'explainability',
    ],
    reusedArtifacts: [reusableArtifact],
  });
});

test('refuses scoped artifact reuse when the approved artifact is unavailable', () => {
  expect(() =>
    compileCustomerChurnReference({
      knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
      sources: [blueprint],
      analysis,
      rerunScope: {
        impactManifestId: '00000000-0000-4000-8000-000000000040',
        affectedPhases: ['delivery'],
      },
    })
  ).toThrow('requires an approved reusable artifact');
});
