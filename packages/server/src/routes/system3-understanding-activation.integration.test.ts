import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAdapter } from '@anvil/core/db/adapters/index';
import { System3Store, type System3ProjectRecord } from '@anvil/system3';

interface ActivationFixture {
  database: SqliteAdapter;
  project: System3ProjectRecord;
  store: System3Store;
  candidateId: string;
  currentSourceId: string;
  replacementSourceId: string;
  replacementOperationId: string;
  understandingArtifactId: string;
}

async function createFixture(): Promise<ActivationFixture> {
  const database = new SqliteAdapter(join(tmpdir(), `anvil-t07-${randomUUID()}.db`));
  const codebaseId = randomUUID();
  await database.query(
    'INSERT INTO remote_agent_codebases (id, name, default_cwd) VALUES ($1, $2, $3)',
    [codebaseId, 'T07 activation test', '/tmp/anvil-t07-activation']
  );
  const store = new System3Store(database);
  const project = await store.createProject({ codebaseId, name: 'T07 activation test' });

  const firstOperationId = randomUUID();
  const initial = await store.addSource({
    projectId: project.id,
    kind: 'blueprint',
    role: 'primary',
    filename: 'project.md',
    originalFilename: 'project.md',
    mediaType: 'text/markdown',
    contentHash: `sha256:${'a'.repeat(64)}`,
    sizeBytes: 3,
    storageKey: 't07/blueprint-v1.md',
    validationReport: { schemaVersion: 1, outcome: 'accepted', checks: [], warnings: [] },
    origin: 'test',
    operationId: firstOperationId,
    expectedVersion: project.version,
  });
  await store.finalizeSourceVersion({
    projectId: project.id,
    sourceVersionId: initial.source.id,
    storageKey: initial.source.storageKey,
    operationId: firstOperationId,
  });

  const afterInitialSource = await store.getProject(project.id);
  if (!afterInitialSource)
    throw new Error('T07 project was not found after initial source finalization');
  const analyzeOperation = await store.beginProjectOperation({
    projectId: project.id,
    type: 'analyze',
    idempotencyKey: `t07-analyze-${randomUUID()}`,
    request: { sourceVersionId: initial.source.id },
    expectedVersion: afterInitialSource.version,
  });
  const input = await store.createUnderstandingInputSnapshot({
    projectId: project.id,
    operationId: analyzeOperation.operation.id,
    sourceIds: [initial.source.id],
    sourceHashes: [initial.source.contentHash],
    parserVersion: 't07-parser@1',
    extractionPolicyVersion: 't07-policy@1',
    capabilityRegistryHash: `sha256:${'b'.repeat(64)}`,
    runtimeProfile: {},
  });
  const candidateId = randomUUID();
  await database.query(
    `INSERT INTO remote_agent_system3_knowledge_snapshots
      (id, project_id, analysis, artifact_key, input_snapshot_id, schema_version,
       lifecycle_status, quality_status, quality_report)
     VALUES ($1, $2, $3, $4, $5, 2, 'candidate', 'passed', $6)`,
    [
      candidateId,
      project.id,
      JSON.stringify({}),
      't07/understanding.json',
      input.id,
      JSON.stringify({ status: 'passed', issues: [] }),
    ]
  );
  const understandingArtifactId = randomUUID();
  await database.query(
    `INSERT INTO remote_agent_system3_artifact_versions
      (id, project_id, knowledge_snapshot_id, artifact_key, artifact_kind, version,
       content_hash, size_bytes, activity_id, status)
     VALUES ($1, $2, $3, $4, 'knowledge_snapshot', 1, $5, 2, 'TW-02', 'candidate')`,
    [
      understandingArtifactId,
      project.id,
      candidateId,
      't07/understanding.json',
      `sha256:${'c'.repeat(64)}`,
    ]
  );

  const beforeReplacement = await store.getProject(project.id);
  if (!beforeReplacement) throw new Error('T07 project was not found before source replacement');
  const replacementOperationId = randomUUID();
  const replacement = await store.addSource({
    projectId: project.id,
    sourceId: initial.source.sourceId,
    kind: 'blueprint',
    role: 'primary',
    filename: 'project.md',
    originalFilename: 'project.md',
    mediaType: 'text/markdown',
    contentHash: `sha256:${'d'.repeat(64)}`,
    sizeBytes: 3,
    storageKey: 't07/blueprint-v2.md',
    validationReport: { schemaVersion: 1, outcome: 'accepted', checks: [], warnings: [] },
    origin: 'test',
    operationId: replacementOperationId,
    expectedVersion: beforeReplacement.version,
  });

  return {
    database,
    project,
    store,
    candidateId,
    currentSourceId: initial.source.id,
    replacementSourceId: replacement.source.id,
    replacementOperationId,
    understandingArtifactId,
  };
}

async function finalizeReplacement(fixture: ActivationFixture): Promise<void> {
  await fixture.store.finalizeSourceVersion({
    projectId: fixture.project.id,
    sourceVersionId: fixture.replacementSourceId,
    storageKey: 't07/blueprint-v2.md',
    operationId: fixture.replacementOperationId,
  });
}

describe('System 3 Understanding activation and source replacement with real SQLite', () => {
  test('rejects and stales a candidate when the pinned source was replaced before activation', async () => {
    const fixture = await createFixture();
    await finalizeReplacement(fixture);
    const currentProject = await fixture.store.getProject(fixture.project.id);
    if (!currentProject) throw new Error('T07 project was not found before activation');
    const operation = await fixture.store.beginProjectOperation({
      projectId: fixture.project.id,
      type: 'activate_understanding',
      idempotencyKey: `t07-activate-${randomUUID()}`,
      request: { snapshotId: fixture.candidateId },
      expectedVersion: currentProject.version,
    });
    const ownerClaimToken = await fixture.store.markProjectOperationRunning({
      operationId: operation.operation.id,
      ownerInstanceId: 't07-stale-activation',
    });

    await expect(
      fixture.store.activateUnderstandingCandidate({
        projectId: fixture.project.id,
        snapshotId: fixture.candidateId,
        expectedVersion: currentProject.version,
        actorId: null,
        operation: { id: operation.operation.id, ownerClaimToken },
      })
    ).rejects.toThrow(
      'Project sources changed; create a new Understanding candidate before activation'
    );

    const candidate = await fixture.store.getUnderstandingSnapshot(
      fixture.project.id,
      fixture.candidateId
    );
    expect(candidate?.lifecycleStatus).toBe('stale');
    const artifact = await fixture.database.query<{ status: string }>(
      'SELECT status FROM remote_agent_system3_artifact_versions WHERE id = $1',
      [fixture.understandingArtifactId]
    );
    expect(artifact.rows[0]?.status).toBe('stale');
    expect((await fixture.store.getOperation(operation.operation.id))?.status).toBe('running');
    await fixture.database.close();
  });

  test('keeps the activated snapshot immutable and stales its current artifact through OP-01 after replacement finalization', async () => {
    const fixture = await createFixture();
    const beforeActivation = await fixture.store.getProject(fixture.project.id);
    if (!beforeActivation) throw new Error('T07 project was not found before activation');
    await fixture.store.activateUnderstandingCandidate({
      projectId: fixture.project.id,
      snapshotId: fixture.candidateId,
      expectedVersion: beforeActivation.version,
      actorId: null,
    });

    await finalizeReplacement(fixture);
    await fixture.store.recordSourceImpact({
      projectId: fixture.project.id,
      sourceVersionId: fixture.replacementSourceId,
      previousSourceVersionId: fixture.currentSourceId,
      kind: 'blueprint',
    });

    const snapshot = await fixture.store.getUnderstandingSnapshot(
      fixture.project.id,
      fixture.candidateId
    );
    expect(snapshot?.lifecycleStatus).toBe('active');
    const artifact = await fixture.database.query<{ status: string; stale_reason: string | null }>(
      'SELECT status, stale_reason FROM remote_agent_system3_artifact_versions WHERE id = $1',
      [fixture.understandingArtifactId]
    );
    expect(artifact.rows[0]?.status).toBe('stale');
    expect(artifact.rows[0]?.stale_reason).toContain('blueprint source changed');
    await fixture.database.close();
  });
});
