import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAdapter } from '@anvil/core/db/adapters';
import {
  analyzeBlueprintMarkdown,
  compileCustomerChurnReference,
  System3CapabilityRegistry,
  System3Store,
} from '@anvil/system3';
import { resolveSystem3LifecycleAttemptSources } from './system3-attempt-sources';

test('SQLite source replacement preserves pinned A while a new execution uses B', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anvil-pinned-source-'));
  const database = new SqliteAdapter(join(root, 'test.db'));
  try {
    const codebaseId = randomUUID();
    await database.query(
      'INSERT INTO remote_agent_codebases (id, name, default_cwd) VALUES ($1, $2, $3)',
      [codebaseId, 'Pinned source test', root]
    );
    const store = new System3Store(database);
    const project = await store.createProject({ codebaseId, name: 'Pinned source test' });
    const readStarted = Promise.withResolvers<void>();
    const replacementReady = Promise.withResolvers<void>();
    let firstRead = true;
    const registry = new System3CapabilityRegistry({
      listSourceRefs: async () => [],
      readLatestSource: async () => {
        throw new Error('Execution must never resolve latest');
      },
      readSourceVersion: async (projectId, sourceVersionId) => {
        if (firstRead) {
          firstRead = false;
          readStarted.resolve();
          await replacementReady.promise;
        }
        const source = await store.getSourceVersion(projectId, sourceVersionId);
        if (source?.storageStatus !== 'ready') return null;
        return { ...source, bytes: await readFile(join(root, source.storageKey)) };
      },
      readArtifact: async () => new Uint8Array(),
    });
    let inFlightBuild: ReturnType<System3CapabilityRegistry['execute']> | undefined;
    const versions = [];
    for (const [name, bytes] of [
      ['a', 'id,target\n1,yes\n'],
      ['b', 'id,target\n2,no\n3,no\n'],
    ] as const) {
      const operationId = randomUUID();
      const current = await store.getProject(project.id);
      if (!current) throw new Error('Missing project');
      const storageKey = `${name}.csv`;
      await writeFile(join(root, storageKey), bytes, { flag: 'wx' });
      const added = await store.addSource({
        projectId: project.id,
        ...(versions[0] ? { sourceId: versions[0].sourceId } : {}),
        kind: 'dataset',
        role: 'primary',
        filename: 'input.csv',
        originalFilename: 'input.csv',
        mediaType: 'text/csv',
        contentHash: `sha256:${new Bun.CryptoHasher('sha256').update(bytes).digest('hex')}`,
        sizeBytes: Buffer.byteLength(bytes),
        storageKey,
        validationReport: { schemaVersion: 1, outcome: 'accepted', checks: [], warnings: [] },
        origin: 'test',
        operationId,
        expectedVersion: current.version,
      });
      await store.finalizeSourceVersion({
        projectId: project.id,
        sourceVersionId: added.source.id,
        storageKey,
        operationId,
      });
      versions.push(added.source);
      if (name === 'a') {
        inFlightBuild = registry.execute(
          'system3.project-scaffolder',
          {
            projectId: project.id,
            projectName: 'Pinned dataset',
            targetColumn: 'target',
            datasetSourceVersionId: added.source.id,
            datasetContentHash: added.source.contentHash,
          },
          {
            runId: 'in-flight-a',
            nodeId: 'build',
            cwd: root,
            artifactsDir: join(root, 'in-flight/children/build/run'),
            signal: new AbortController().signal,
          }
        );
        await readStarted.promise;
      }
    }
    expect((await store.listActiveSources(project.id)).map(source => source.id)).toEqual([
      versions[1]!.id,
    ]);
    replacementReady.resolve();
    if (!inFlightBuild) throw new Error('Expected a build waiting on its pinned source');
    const inFlightOutput = (await inFlightBuild).structuredOutput as { projectDir: string };
    expect(await readFile(join(inFlightOutput.projectDir, 'data/input.csv'), 'utf8')).toBe(
      'id,target\n1,yes\n'
    );
    let originalProjectDir = '';
    for (const [index, source] of versions.entries()) {
      const result = await registry.execute(
        'system3.project-scaffolder',
        {
          projectId: project.id,
          projectName: 'Pinned dataset',
          targetColumn: 'target',
          datasetSourceVersionId: source.id,
          datasetContentHash: source.contentHash,
        },
        {
          runId: `run-${index}`,
          nodeId: 'build',
          cwd: root,
          artifactsDir: join(root, `execution-${index}/children/build/run`),
          signal: new AbortController().signal,
        }
      );
      const output = result.structuredOutput as { projectDir: string };
      if (index === 0) originalProjectDir = output.projectDir;
      expect(await readFile(join(output.projectDir, 'data/input.csv'), 'utf8')).toBe(
        await readFile(join(root, source.storageKey), 'utf8')
      );
    }
    const replacement = versions[1]!;
    const reuseContext = {
      runId: 'rebind',
      nodeId: 'materialize',
      cwd: root,
      artifactsDir: join(root, 'execution-0/children/experiment/run'),
      signal: new AbortController().signal,
    };
    await registry.execute(
      'system3.pinned-dataset-materializer',
      {
        projectId: project.id,
        projectDir: originalProjectDir,
        targetColumn: 'target',
        datasetSourceVersionId: replacement.id,
        datasetContentHash: replacement.contentHash,
      },
      reuseContext
    );
    const validation = await registry.execute(
      'system3.dataset-validator',
      { projectDir: originalProjectDir },
      reuseContext
    );
    expect(validation.structuredOutput).toMatchObject({ rows: 2, targetColumn: 'target' });
    const config = JSON.parse(await readFile(join(originalProjectDir, 'config.json'), 'utf8')) as {
      datasetSourceVersionId: string;
      datasetContentHash: string;
    };
    expect(config).toMatchObject({
      datasetSourceVersionId: replacement.id,
      datasetContentHash: replacement.contentHash,
    });
    expect(await readFile(join(root, 'a.csv'), 'utf8')).toBe('id,target\n1,yes\n');
    const current = await store.getProject(project.id);
    if (!current) throw new Error('Missing project');
    const operationId = randomUUID();
    const markdown = '# Requirements\nPredict target.';
    await writeFile(join(root, 'project.md'), markdown, { flag: 'wx' });
    const blueprint = await store.addSource({
      projectId: project.id,
      kind: 'blueprint',
      role: 'primary',
      filename: 'project.md',
      originalFilename: 'project.md',
      mediaType: 'text/markdown',
      contentHash: `sha256:${new Bun.CryptoHasher('sha256').update(markdown).digest('hex')}`,
      sizeBytes: Buffer.byteLength(markdown),
      storageKey: 'project.md',
      validationReport: { schemaVersion: 1, outcome: 'accepted', checks: [], warnings: [] },
      origin: 'test',
      operationId,
      expectedVersion: current.version,
    });
    await store.finalizeSourceVersion({
      projectId: project.id,
      sourceVersionId: blueprint.source.id,
      storageKey: blueprint.source.storageKey,
      operationId,
    });
    const sources = await store.listActiveSources(project.id);
    const compileInput = {
      projectId: project.id,
      knowledgeSnapshotId: randomUUID(),
      sources,
      analysis: analyzeBlueprintMarkdown(markdown, null),
      rerunScope: {
        impactManifestId: randomUUID(),
        affectedPhases: ['delivery'] as const,
        reusableArtifact: {
          kind: 'delivery_package' as const,
          storageKey: 'delivery/package.tar.gz',
          contentHash: `sha256:${'b'.repeat(64)}`,
          sourceExecutionId: randomUUID(),
          sourceVersionIds: [blueprint.source.id, versions[0]!.id],
        },
      },
    };
    expect(() => compileCustomerChurnReference(compileInput)).toThrow(
      'Delivery result reuse requires an equivalent Source Version basis'
    );
    const equivalent = compileCustomerChurnReference({
      ...compileInput,
      rerunScope: {
        ...compileInput.rerunScope,
        reusableArtifact: {
          ...compileInput.rerunScope.reusableArtifact,
          sourceVersionIds: [blueprint.source.id, replacement.id],
        },
      },
    });
    expect(equivalent.plan.rerunScope.executionMode).toBe('delivery');
    for (const inputMode of ['current', 'replay'] as const) {
      const projectState = await store.getProject(project.id);
      if (!projectState) throw new Error('Missing project');
      const attempt = await store.createLifecycleAttempt({
        projectId: project.id,
        startActivityId: 'OP-00',
        scope: 'full',
        inputMode,
        expectedVersion: projectState.version,
        previewHash: `sha256:${'c'.repeat(64)}`,
        idempotencyKey: randomUUID(),
        basis: {
          schemaVersion: 1,
          sourceVersionIds: sources.map(source => source.id),
          sourceHashes: sources.map(source => source.contentHash),
          knowledgeSnapshotId: null,
          readinessContractId: null,
          compilationId: null,
          approvalId: null,
          executionId: null,
          verificationId: null,
          baseCommitSha: null,
          resources: {},
        },
      });
      const resolved = await resolveSystem3LifecycleAttemptSources({
        store,
        projectId: project.id,
      });
      expect(resolved.map(source => source.id)).toEqual(attempt.basis.sourceVersionIds);
      expect(resolved.find(source => source.kind === 'dataset')?.id).toBe(replacement.id);
      if (inputMode === 'replay') {
        await database.query(
          "UPDATE remote_agent_system3_source_versions SET storage_status = 'pending' WHERE id = $1",
          [replacement.id]
        );
        await expect(
          resolveSystem3LifecycleAttemptSources({ store, projectId: project.id })
        ).rejects.toThrow('Một Source Version đã ghim không còn khả dụng');
      }
      await store.updateLifecycleAttempt(project.id, attempt.id, { runStatus: 'completed' });
    }
  } finally {
    await database.close();
  }
});
