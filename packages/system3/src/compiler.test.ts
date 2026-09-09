import { expect, test } from 'bun:test';
import {
  compileCustomerChurnReference,
  createApprovalManifest,
  projectSystem3WorkflowBundlePhases,
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
const dataset: System3SourceRecord = {
  ...blueprint,
  id: '00000000-0000-4000-8000-000000000005',
  sourceId: '00000000-0000-4000-8000-000000000105',
  kind: 'dataset',
  filename: 'customers.csv',
  originalFilename: 'customers.csv',
  mediaType: 'text/csv',
  contentHash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  storageKey: 'sources/dataset/a/customers.csv',
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
const analysisWithDataset: BlueprintAnalysis = {
  ...analysis,
  dataset: {
    filename: dataset.filename,
    rowCount: 2,
    columnCount: 2,
    columns: ['id', 'churn'],
    targetColumn: 'churn',
    targetExists: true,
    targetDistribution: { yes: 1, no: 1 },
  },
};
const executableSources = [blueprint, dataset] as const;

test('compiles a deterministic Customer Churn execution plan', () => {
  const input = {
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: executableSources,
    analysis: analysisWithDataset,
  };
  const first = compileCustomerChurnReference(input);
  const second = compileCustomerChurnReference(input);

  expect(first.definitionHash).toBe(second.definitionHash);
  expect(first.plan.schemaVersion).toBe(3);
  expect(first.plan.compilerVersion).toBe('system3-compiler@3');
  expect(first.workflowBundles.map(bundle => bundle.activityId)).toEqual([
    'TW-06',
    'TW-07',
    'TW-09',
  ]);
  expect(
    first.plan.phases.filter(phase => ['build', 'experiment', 'delivery'].includes(phase.phaseId))
  ).toEqual(
    projectSystem3WorkflowBundlePhases({
      workflowBundles: first.workflowBundles,
      runtimeProfile: first.plan.runtimeProfile,
    })
  );
  expect(first.plan.phases[0]?.workflow).toBe('system3-understand-project');
  expect(first.plan.phases[0]?.resourceProfile).toEqual({ cpuOnly: true, ramGb: 8 });
});

test('pins the primary dataset Source Version and hash into the TW-06 bundle', () => {
  const supplementalDataset = {
    ...dataset,
    id: '00000000-0000-4000-8000-000000000004',
    sourceId: '00000000-0000-4000-8000-000000000004',
    role: 'supplemental' as const,
    filename: 'supplement.csv',
    originalFilename: 'supplement.csv',
  };
  const compiled = compileCustomerChurnReference({
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: [supplementalDataset, ...executableSources],
    analysis: analysisWithDataset,
  });
  const executionBundle = compiled.workflowBundles.find(bundle => bundle.activityId === 'TW-06');
  expect(executionBundle?.definition.workflows).toContainEqual(
    expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: 'scaffold-project',
          action: expect.objectContaining({
            input: expect.objectContaining({
              datasetSourceVersionId: dataset.id,
              datasetContentHash: dataset.contentHash,
            }),
          }),
        }),
      ]),
    })
  );
});

test('refuses compilation without exactly one primary dataset Source Version', () => {
  expect(() =>
    compileCustomerChurnReference({
      knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
      sources: [blueprint],
      analysis,
    })
  ).toThrow('data_required');
  expect(() =>
    compileCustomerChurnReference({
      knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
      sources: [
        ...executableSources,
        {
          ...dataset,
          id: '00000000-0000-4000-8000-000000000006',
          sourceId: '00000000-0000-4000-8000-000000000106',
        },
      ],
      analysis: analysisWithDataset,
    })
  ).toThrow('multiple primary dataset');
});

test('scopes persisted workflow and capability snapshot IDs to the project', () => {
  const common = {
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: executableSources,
    analysis: analysisWithDataset,
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
    compilationId: '00000000-0000-4000-8000-000000000030',
    projectId: blueprint.projectId,
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: executableSources,
    analysis: analysisWithDataset,
  });
  const manifest = createApprovalManifest({
    compilationId: '00000000-0000-4000-8000-000000000030',
    projectId: blueprint.projectId,
    plan: compiled.plan,
    definitionHash: compiled.definitionHash,
    capabilityRegistryHash: compiled.capabilityRegistryHash,
    workflowBundles: compiled.workflowBundles,
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
    compilationId: '00000000-0000-4000-8000-000000000030',
    projectId: blueprint.projectId,
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: executableSources,
    analysis: analysisWithDataset,
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
      workflowBundles: compiled.workflowBundles,
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
    compilationId: '00000000-0000-4000-8000-000000000030',
    projectId: blueprint.projectId,
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: [currentBlueprint, previousBlueprint, dataset],
    analysis: analysisWithDataset,
  });

  expect(compiled.plan.inputSnapshot.sourceIds).toEqual([currentBlueprint.id, dataset.id]);
  expect(compiled.plan.inputSnapshot.sourceHashes).toEqual([
    currentBlueprint.contentHash,
    dataset.contentHash,
  ]);
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
    sources: [supportingBlueprint, blueprint, dataset],
    analysis: analysisWithDataset,
  });

  expect(compiled.plan.inputSnapshot.sourceIds).toContain(blueprint.id);
  expect(compiled.plan.inputSnapshot.sourceIds).toContain(supportingBlueprint.id);
  expect(compiled.plan.inputSnapshot.sourceIds).toHaveLength(3);
});

test('refuses compilation when a required capability cannot be resolved', () => {
  expect(() =>
    compileCustomerChurnReference({
      knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
      sources: executableSources,
      analysis: analysisWithDataset,
      availableCapabilities: [],
    })
  ).toThrow('unresolved required capabilities');
});

test('rejects capability policy tampering after compilation', () => {
  const compiled = compileCustomerChurnReference({
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: executableSources,
    analysis: analysisWithDataset,
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
    compilationId: '00000000-0000-4000-8000-000000000030',
    projectId: blueprint.projectId,
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: executableSources,
    analysis: analysisWithDataset,
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
      workflowBundles: compiled.workflowBundles,
    }).executionPlanHash
  ).toBe(compiled.definitionHash);
});

test('pins an approved artifact for a delivery-only scoped execution', () => {
  const reusableArtifact = {
    kind: 'delivery_package' as const,
    storageKey: 'artifacts/delivery/abc/generated_project.tar.gz',
    contentHash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    sourceExecutionId: '00000000-0000-4000-8000-000000000060',
    sourceVersionIds: executableSources.map(source => source.id),
  };
  const compiled = compileCustomerChurnReference({
    knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
    sources: executableSources,
    analysis: analysisWithDataset,
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
      sources: executableSources,
      analysis: analysisWithDataset,
      rerunScope: {
        impactManifestId: '00000000-0000-4000-8000-000000000040',
        affectedPhases: ['delivery'],
      },
    })
  ).toThrow('requires an approved reusable artifact');
});

test('refuses delivery result reuse when Source Version lineage differs', () => {
  expect(() =>
    compileCustomerChurnReference({
      knowledgeSnapshotId: '00000000-0000-4000-8000-000000000020',
      sources: executableSources,
      analysis: analysisWithDataset,
      rerunScope: {
        impactManifestId: '00000000-0000-4000-8000-000000000040',
        affectedPhases: ['delivery'],
        reusableArtifact: {
          kind: 'delivery_package',
          storageKey: 'artifacts/delivery/old/generated_project.tar.gz',
          contentHash: `sha256:${'e'.repeat(64)}`,
          sourceExecutionId: '00000000-0000-4000-8000-000000000060',
          sourceVersionIds: ['00000000-0000-4000-8000-000000000099'],
        },
      },
    })
  ).toThrow('equivalent Source Version basis');
});
