import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { System3CapabilityRegistry } from './capabilities';

test('dataset validation requires provenance and rejects changed bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anvil-dataset-provenance-'));
  const bytes = 'id,target\n1,yes\n2,no\n';
  const hash = `sha256:${new Bun.CryptoHasher('sha256').update(bytes).digest('hex')}`;
  const registry = new System3CapabilityRegistry();
  for (const [name, contentHash, content, error] of [
    ['missing', undefined, bytes, 'Dataset content hash is missing or invalid'],
    ['malformed', 'sha256:invalid', bytes, 'Dataset content hash is missing or invalid'],
    ['changed', hash, `${bytes}3,no\n`, 'không khớp'],
    ['valid', hash, bytes, null],
  ] as const) {
    const projectDir = join(root, name);
    await mkdir(join(projectDir, 'data'), { recursive: true });
    await writeFile(join(projectDir, 'data/input.csv'), content);
    await writeFile(
      join(projectDir, 'config.json'),
      JSON.stringify({
        targetColumn: 'target',
        datasetSourceVersionId: '33333333-3333-4333-8333-333333333333',
        sourceFilename: 'input.csv',
        datasetContentHash: contentHash,
      })
    );
    const result = registry.execute(
      'system3.dataset-validator',
      { projectDir },
      {
        runId: name,
        nodeId: 'validate',
        cwd: root,
        artifactsDir: join(root, 'children/experiment/run'),
        signal: new AbortController().signal,
      }
    );
    if (error) await expect(result).rejects.toThrow(error);
    else expect((await result).structuredOutput).toMatchObject({ rows: 2 });
  }
});
