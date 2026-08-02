import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BashNode, NodeOutput } from './schemas';
import { writeNodeIoManifest, type NodeIoManifest } from './node-io';

describe('writeNodeIoManifest', () => {
  it('preserves typed values and creates a new immutable attempt', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'anvil-node-io-'));
    const node: BashNode = { id: 'build', bash: 'echo ok', depends_on: ['prepare'] };
    const dependency: NodeOutput = {
      state: 'completed',
      output: '{"ready":true}',
      structuredOutput: { ready: true },
    };
    const output: NodeOutput = {
      state: 'completed',
      output: '{"count":3}',
      structuredOutput: { count: 3 },
    };

    try {
      const firstPath = await writeNodeIoManifest({
        artifactsDir,
        runId: 'run-1',
        node,
        output,
        dependencyOutputs: new Map([['prepare', dependency]]),
        startedAt: '2026-07-17T00:00:00.000Z',
        completedAt: '2026-07-17T00:00:01.000Z',
      });
      const secondPath = await writeNodeIoManifest({
        artifactsDir,
        runId: 'run-1',
        node,
        output,
        dependencyOutputs: new Map([['prepare', dependency]]),
        startedAt: '2026-07-17T00:00:02.000Z',
      });
      const first = JSON.parse(
        await readFile(join(artifactsDir, firstPath), 'utf8')
      ) as NodeIoManifest;

      expect(firstPath).toEndWith('/attempts/1/io.json');
      expect(secondPath).toEndWith('/attempts/2/io.json');
      expect(first.output.value).toEqual({ count: 3 });
      expect(first.resolvedInputs.prepare).toEqual({ ready: true });
      expect(first.declaredInputs).toEqual({ bash: 'echo ok' });
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });

  it('stores large output separately and does not read environment secrets', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'anvil-node-io-'));
    const node: BashNode = { id: 'large-output', bash: 'print-result' };
    const secret = process.env.ANVIL_NODE_IO_TEST_SECRET;
    process.env.ANVIL_NODE_IO_TEST_SECRET = 'must-not-be-recorded';

    try {
      const relativePath = await writeNodeIoManifest({
        artifactsDir,
        runId: 'run-2',
        node,
        output: { state: 'completed', output: 'x'.repeat(5000) },
        dependencyOutputs: new Map(),
        startedAt: '2026-07-17T00:00:00.000Z',
      });
      const rawManifest = await readFile(join(artifactsDir, relativePath), 'utf8');
      const manifest = JSON.parse(rawManifest) as NodeIoManifest;

      expect(manifest.output.truncated).toBe(true);
      expect(manifest.output.preview).toHaveLength(4096);
      expect(manifest.output.value).toBeUndefined();
      expect(manifest.output.artifactPath).toBeDefined();
      expect(rawManifest).not.toContain('must-not-be-recorded');
    } finally {
      if (secret === undefined) delete process.env.ANVIL_NODE_IO_TEST_SECRET;
      else process.env.ANVIL_NODE_IO_TEST_SECRET = secret;
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });
});
