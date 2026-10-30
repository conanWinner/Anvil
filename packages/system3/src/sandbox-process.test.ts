import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inspectSandboxOutput, within } from './sandbox-process';

test('within only accepts the root itself or paths below it', () => {
  expect(within('/work/a', '/work/a')).toBe(true);
  expect(within('/work/a', '/work/a/b')).toBe(true);
  expect(within('/work/a', '/work/ab')).toBe(false);
  // Same length prefix position holds a separator but the path is elsewhere.
  expect(within('/tmp/xyz/build', '/tmp/abc/runs/x')).toBe(false);
  expect(within('/work/a/', '/work/a/b')).toBe(true);
});

describe('inspectSandboxOutput', () => {
  test('accepts only regular files reached through real folders', async () => {
    const root = await mkdtemp(join(tmpdir(), 'anvil-sandbox-output-'));
    const outside = join(root, 'secret.txt');
    const out = join(root, 'out');
    await writeFile(outside, 'host secret');
    await mkdir(join(out, 'real'), { recursive: true });
    await writeFile(join(out, 'real', 'file.csv'), 'id\n');
    await symlink(outside, join(out, 'link.csv'));
    await symlink(dirname(outside), join(out, 'linked-folder'));

    expect(await inspectSandboxOutput(out, 'real/file.csv')).toBe('regular');
    expect(await inspectSandboxOutput(out, 'real/absent.csv')).toBe('missing');
    expect(await inspectSandboxOutput(out, 'absent/file.csv')).toBe('missing');
    expect(await inspectSandboxOutput(out, 'link.csv')).toBe('unsafe');
    expect(await inspectSandboxOutput(out, 'linked-folder/secret.txt')).toBe('unsafe');
    expect(await inspectSandboxOutput(out, 'real')).toBe('unsafe');
    expect(await inspectSandboxOutput(out, 'real/file.csv/x')).toBe('unsafe');
  });
});
