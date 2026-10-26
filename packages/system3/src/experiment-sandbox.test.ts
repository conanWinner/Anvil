import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runExperimentSandbox } from './experiment-sandbox';
import { resolveMlRuntime } from './ml-runtime';

// Needs systemd, bubblewrap and `bun run system3:ml-runtime`.
const sandboxTest = process.env.ANVIL_SANDBOX_TESTS === 'true' ? test : test.skip;

async function workspace(script: string): Promise<{
  projectDir: string;
  dataDir: string;
  outputDir: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'anvil-experiment-sandbox-'));
  const projectDir = join(root, 'project');
  const dataDir = join(root, 'data');
  const outputDir = join(root, 'out');
  await Promise.all([mkdir(projectDir), mkdir(dataDir)]);
  await Promise.all([
    writeFile(join(projectDir, 'main.py'), script),
    writeFile(join(dataDir, 'train.csv'), 'x,y\n0,0\n1,1\n2,0\n3,1\n4,0\n5,1\n'),
  ]);
  return { projectDir, dataDir, outputDir };
}

sandboxTest(
  'experiment profile runs the locked ML stack offline with only /work/out writable',
  async () => {
    const runtime = await resolveMlRuntime();
    const dirs = await workspace(
      [
        'import json, os, socket',
        'import pandas as pd, sklearn, lightgbm, xgboost',
        'from sklearn.linear_model import LogisticRegression',
        "frame = pd.read_csv('/work/data/train.csv')",
        "model = LogisticRegression().fit(frame[['x']], frame['y'])",
        'def denied(path):',
        '    try:',
        "        open(path, 'w').close()",
        '        return False',
        '    except OSError:',
        '        return True',
        'client = socket.socket(); client.settimeout(1)',
        'try: network = client.connect_ex(("1.1.1.1", 53))',
        'except OSError: network = 1',
        "json.dump({'sklearn': sklearn.__version__, 'rows': len(frame),",
        "  'project_ro': denied('/work/project/x'), 'data_ro': denied('/work/data/x'),",
        "  'network_denied': network != 0, 'threads': os.environ['OMP_NUM_THREADS'],",
        "  'uid': os.getuid()}, open('/work/out/result.json', 'w'))",
        "print('done')",
      ].join('\n')
    );
    const result = await runExperimentSandbox({
      profile: 'experiment',
      runtime,
      ...dirs,
      script: 'main.py',
      timeoutMs: 120_000,
      signal: new AbortController().signal,
    });
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(await readFile(join(dirs.outputDir, 'result.json'), 'utf8'))).toMatchObject({
      rows: 6,
      project_ro: true,
      data_ro: true,
      network_denied: true,
      threads: '2',
      uid: 65534,
    });
  },
  180_000
);

sandboxTest(
  'check profile stops runs that exceed memory or time',
  async () => {
    const runtime = await resolveMlRuntime();
    const memory = await workspace("blob = bytearray(1024 * 1024 * 1024)\nprint('allocated')\n");
    const memoryResult = await runExperimentSandbox({
      profile: 'check',
      runtime,
      ...memory,
      script: 'main.py',
      timeoutMs: 30_000,
      signal: new AbortController().signal,
    });
    expect(memoryResult.exitCode).not.toBe(0);
    expect(memoryResult.stdout).not.toContain('allocated');

    const slow = await workspace("import time\ntime.sleep(30)\nprint('finished')\n");
    const slowResult = await runExperimentSandbox({
      profile: 'check',
      runtime,
      ...slow,
      script: 'main.py',
      timeoutMs: 1_000,
      signal: new AbortController().signal,
    });
    expect(slowResult.exitCode).not.toBe(0);
    expect(slowResult.stdout).not.toContain('finished');
  },
  120_000
);

test('rejects scripts outside the project and timeouts beyond the profile', async () => {
  const runtime = { dir: '/nonexistent', python: '/nonexistent/bin/python', lockHash: 'sha256:x' };
  const dirs = await workspace('print(1)\n');
  const base = { runtime, ...dirs, signal: new AbortController().signal };
  await expect(
    runExperimentSandbox({ ...base, profile: 'check', script: '../escape.py', timeoutMs: 1_000 })
  ).rejects.toThrow('inside the project');
  await expect(
    runExperimentSandbox({ ...base, profile: 'check', script: 'main.py', timeoutMs: 120_000 })
  ).rejects.toThrow('timeoutMs');
  await expect(
    runExperimentSandbox({
      ...base,
      profile: 'experiment',
      script: 'main.py',
      timeoutMs: 1_000,
      outputDir: join(dirs.projectDir, 'out'),
    })
  ).rejects.toThrow('overlap');
});
