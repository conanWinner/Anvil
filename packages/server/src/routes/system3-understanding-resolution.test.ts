import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  persistSystem3BinaryArtifact,
  understandProjectSources,
  type System3SourceRecord,
  type System3UnderstandingInputSnapshotRecord,
} from '@anvil/system3';
import { resolvePinnedUnderstandingAnalysis } from './system3-understanding-resolution';

async function fixture(): Promise<Parameters<typeof resolvePinnedUnderstandingAnalysis>[0]> {
  const root = await mkdtemp(join(tmpdir(), 'anvil-t07-resolution-'));
  const bytes = new TextEncoder().encode('id,outcome\n1,yes\n2,no\n3,yes\n');
  const stored = await persistSystem3BinaryArtifact({
    artifactsRoot: root,
    category: 'sources',
    filename: 'customers.csv',
    bytes,
  });
  const source: System3SourceRecord = {
    ...stored,
    id: 'dataset-v1',
    sourceId: 'dataset',
    projectId: 'project',
    kind: 'dataset',
    role: 'primary',
    originalFilename: 'customers.csv',
    mediaType: 'text/csv',
    version: 1,
    storageStatus: 'ready',
    validationReport: { schemaVersion: 1, outcome: 'accepted', checks: [], warnings: [] },
    createdBy: null,
    origin: 'test',
    operationId: null,
    intakeReportArtifactId: null,
    createdAt: '2026-09-09T00:00:00Z',
  };
  const blueprint = new TextEncoder().encode('# Project\n## Business Goal\nPredict outcomes');
  const blueprintStored = await persistSystem3BinaryArtifact({
    artifactsRoot: root,
    category: 'sources',
    filename: 'blueprint.md',
    bytes: blueprint,
  });
  const { analysis } = await understandProjectSources({
    sources: [
      {
        id: 'blueprint-v1',
        kind: 'blueprint',
        filename: 'blueprint.md',
        mediaType: 'text/markdown',
        bytes: blueprint,
        contentHash: blueprintStored.contentHash,
      },
      { ...source, bytes },
    ],
  });
  const snapshot: System3UnderstandingInputSnapshotRecord = {
    id: 'input-v1',
    projectId: 'project',
    operationId: 'operation',
    knowledgeSnapshotId: null,
    workflowRunId: null,
    sourceIds: [source.id],
    sourceHashes: [source.contentHash],
    sourceRefs: [
      {
        sourceVersionId: source.id,
        kind: 'dataset',
        filename: source.filename,
        mediaType: source.mediaType,
        contentHash: source.contentHash,
      },
    ],
    parserVersion: 'test',
    extractionPolicyVersion: 'test',
    capabilityRegistryHash: 'test',
    runtimeProfile: {},
    createdAt: source.createdAt,
  };
  return {
    projectId: 'project',
    analysis,
    inputSnapshotId: snapshot.id,
    decisions: [
      {
        binding: { kind: 'dataset_target_column', allowedValues: ['id', 'outcome'] },
        status: 'answered',
        answer: 'outcome',
      },
    ],
    getArtifactsRoot: async () => root,
    store: {
      listUnderstandingInputSnapshots: async () => [
        {
          ...snapshot,
          id: 'newer-input',
          sourceRefs: [{ ...snapshot.sourceRefs[0]!, sourceVersionId: 'dataset-v2' }],
        },
        snapshot,
      ],
      getSourceVersion: async (projectId, sourceVersionId) => {
        expect(projectId).toBe('project');
        expect(sourceVersionId).toBe('dataset-v1');
        return source;
      },
    },
  };
}

describe('pinned Understanding decision resolution with real source bytes', () => {
  test('reprofiles the exact pinned version and preserves historical analysis', async () => {
    const input = await fixture();
    const before = structuredClone(input.analysis);
    const resolved = await resolvePinnedUnderstandingAnalysis(input);
    expect(resolved.dataset?.targetDistribution).toEqual({ yes: 2, no: 1 });
    expect(resolved.dataset?.targetColumn).toBe('outcome');
    if (resolved.schemaVersion !== 2) throw new Error('Expected v2');
    expect(resolved.datasetUnderstanding.profile?.sourceVersionId).toBe('dataset-v1');
    expect(resolved.datasetUnderstanding.profile?.targetOtherCount).toBe(0);
    expect(input.analysis).toEqual(before);
  });

  test('rejects unavailable input and mismatched metadata without reading unpinned sources', async () => {
    const input = await fixture();
    await expect(
      resolvePinnedUnderstandingAnalysis({ ...input, inputSnapshotId: null })
    ).rejects.toThrow('Pinned Understanding input');
    const originalRead = input.store.getSourceVersion;
    input.store.getSourceVersion = async (projectId, sourceVersionId) => {
      const source = await originalRead(projectId, sourceVersionId);
      return source ? { ...source, contentHash: 'sha256:wrong' } : null;
    };
    await expect(resolvePinnedUnderstandingAnalysis(input)).rejects.toThrow('no longer matches');
  });

  test('verifies actual streamed bytes, not just matching database hashes', async () => {
    const input = await fixture();
    const other = await persistSystem3BinaryArtifact({
      artifactsRoot: await input.getArtifactsRoot(),
      category: 'sources',
      filename: 'other.csv',
      bytes: new TextEncoder().encode('id,outcome\n1,no\n'),
    });
    const originalRead = input.store.getSourceVersion;
    input.store.getSourceVersion = async (projectId, sourceVersionId) => {
      const source = await originalRead(projectId, sourceVersionId);
      return source ? { ...source, storageKey: other.storageKey } : null;
    };
    await expect(resolvePinnedUnderstandingAnalysis(input)).rejects.toThrow('không khớp');
  });
});
