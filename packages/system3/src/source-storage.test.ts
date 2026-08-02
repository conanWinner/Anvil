import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discardStagedSystem3Source,
  promoteSystem3Source,
  persistSystem3Artifact,
  readSystem3Artifact,
  readSystem3Source,
  stageSystem3Source,
  system3SourceVersionStorageKey,
} from './source-storage';

const originalAnvilHome = process.env.ANVIL_HOME;
const roots: string[] = [];

async function testHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'anvil-system3-source-storage-'));
  roots.push(root);
  process.env.ANVIL_HOME = root;
  return root;
}

afterEach(async () => {
  process.env.ANVIL_HOME = originalAnvilHome;
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('System 3 two-phase source storage', () => {
  test('stages privately, promotes to a versioned source path, and removes the temp file', async () => {
    const root = await testHome();
    const artifactsRoot = join(root, 'workspaces/_local/project-1/artifacts');
    const bytes = new TextEncoder().encode('# Blueprint');
    const staged = await stageSystem3Source({
      artifactsRoot,
      operationId: 'operation-1',
      kind: 'blueprint',
      filename: '../System 2 blueprint.md',
      bytes,
    });

    expect(staged.filename).toBe('System_2_blueprint.md');
    expect(staged.temporaryStorageKey).toBe('sources/.pending/operation-1/content');
    expect(staged.storageKey).toMatch(/^sources\/blueprint\/[a-f0-9]{64}\/content$/);
    expect(await readFile(join(artifactsRoot, staged.temporaryStorageKey))).toEqual(
      Buffer.from(bytes)
    );

    const storageKey = system3SourceVersionStorageKey({
      kind: 'blueprint',
      sourceId: 'source-1',
      lineageVersion: 2,
      contentHash: staged.contentHash,
      filename: staged.filename,
    });
    const promoted = await promoteSystem3Source({ artifactsRoot, staged, storageKey });
    expect(promoted.created).toBe(true);
    expect(promoted.storageKey).toMatch(
      /^sources\/blueprint\/source-1\/v002_[a-f0-9]{64}\/System_2_blueprint\.md$/
    );
    expect(await readSystem3Source({ artifactsRoot, storageKey: promoted.storageKey })).toEqual(
      Buffer.from(bytes)
    );
    await expect(readFile(join(artifactsRoot, staged.temporaryStorageKey))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('reuses an existing canonical blob and never overwrites different bytes', async () => {
    const root = await testHome();
    const artifactsRoot = join(root, 'workspaces/_local/project-1/artifacts');
    const bytes = new TextEncoder().encode('id,target\n1,yes');
    const first = await stageSystem3Source({
      artifactsRoot,
      operationId: 'operation-1',
      kind: 'dataset',
      filename: 'first.csv',
      bytes,
    });
    expect((await promoteSystem3Source({ artifactsRoot, staged: first })).created).toBe(true);

    const retry = await stageSystem3Source({
      artifactsRoot,
      operationId: 'operation-2',
      kind: 'dataset',
      filename: 'renamed.csv',
      bytes,
    });
    expect(retry.storageKey).toBe(first.storageKey);
    expect((await promoteSystem3Source({ artifactsRoot, staged: retry })).created).toBe(false);
  });

  test('detects staged-file corruption before promotion and leaves it available for reconciliation', async () => {
    const root = await testHome();
    const artifactsRoot = join(root, 'workspaces/_local/project-1/artifacts');
    const staged = await stageSystem3Source({
      artifactsRoot,
      operationId: 'operation-1',
      kind: 'constraints',
      filename: 'rules.md',
      bytes: new TextEncoder().encode('network: false'),
    });
    await writeFile(join(artifactsRoot, staged.temporaryStorageKey), 'corrupted');

    await expect(promoteSystem3Source({ artifactsRoot, staged })).rejects.toThrow(
      'failed content verification'
    );
    await discardStagedSystem3Source(artifactsRoot, staged.temporaryStorageKey);
  });

  test('reconciles a crash after canonical promotion removed the staged file', async () => {
    const root = await testHome();
    const artifactsRoot = join(root, 'workspaces/_local/project-1/artifacts');
    const staged = await stageSystem3Source({
      artifactsRoot,
      operationId: 'operation-1',
      kind: 'blueprint',
      filename: 'blueprint.md',
      bytes: new TextEncoder().encode('# Reconcile me'),
    });
    expect((await promoteSystem3Source({ artifactsRoot, staged })).created).toBe(true);

    const reconciled = await promoteSystem3Source({ artifactsRoot, staged });
    expect(reconciled.created).toBe(false);
    expect(await readSystem3Source({ artifactsRoot, storageKey: reconciled.storageKey })).toEqual(
      Buffer.from('# Reconcile me')
    );
  });

  test('reuses an identical immutable report but rejects different content at the same key', async () => {
    const root = await testHome();
    const artifactsRoot = join(root, 'workspaces/_local/project-1/artifacts');
    const report = { outcome: 'created_source', operationId: 'operation-1' };
    await persistSystem3Artifact({
      artifactsRoot,
      storageKey: 'operations/OP-00/operation-1/report.json',
      body: report,
    });
    await persistSystem3Artifact({
      artifactsRoot,
      storageKey: 'operations/OP-00/operation-1/report.json',
      body: report,
    });
    expect(
      JSON.parse(
        new TextDecoder().decode(
          await readSystem3Artifact({
            artifactsRoot,
            storageKey: 'operations/OP-00/operation-1/report.json',
          })
        )
      )
    ).toEqual(report);
    await expect(
      persistSystem3Artifact({
        artifactsRoot,
        storageKey: 'operations/OP-00/operation-1/report.json',
        body: { ...report, outcome: 'rejected' },
      })
    ).rejects.toThrow('different content');
  });
});
