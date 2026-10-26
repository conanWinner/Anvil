import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPythonSandbox } from './python-sandbox';

const sandboxTest = process.env.ANVIL_SANDBOX_TESTS === 'true' ? test : test.skip;

sandboxTest('Python sandbox separates candidate and harness and denies host access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anvil-python-sandbox-'));
  const hostSentinel = join(root, 'host-only.txt');
  const solutionWorkspace = join(root, 'solution-step');
  const harnessWorkspace = join(root, 'harness-step');
  await Promise.all([
    writeFile(hostSentinel, 'host secret'),
    mkdir(solutionWorkspace),
    mkdir(harnessWorkspace),
  ]);
  const input = 'id\n1\n';
  const guards =
    `import json, os, resource, socket\n` +
    `host_path=${JSON.stringify(hostSentinel)}\n` +
    `try:\n open('/work/blocked', 'w').close(); work_write=False\nexcept OSError:\n work_write=True\n` +
    `try:\n open(host_path).read(); host_read=True\nexcept OSError:\n host_read=False\n` +
    `try:\n open('/usr/anvil-write-probe', 'w').close(); usr_write=True\nexcept OSError:\n usr_write=False\n` +
    `try:\n open('/tmp/anvil-write-probe', 'w').close(); tmp_write=True\nexcept OSError:\n tmp_write=False\n` +
    `client=socket.socket(); client.settimeout(1)\n` +
    `try: network=client.connect_ex(('1.1.1.1', 53))\nexcept OSError: network=1\nfinally: client.close()\n` +
    `print(json.dumps({'uid':os.getuid(),'gid':os.getgid(),'nnp':next(x.split()[1] for x in open('/proc/self/status') if x.startswith('NoNewPrivs:')),'caps':next(x.split()[1] for x in open('/proc/self/status') if x.startswith('CapEff:')),'host_read':host_read,'home_denied':not os.path.exists('/home/Anvil') and 'HOME' not in os.environ,'network_denied':network != 0,'work_read_only':work_write,'usr_read_only':not usr_write,'tmp_writable':tmp_write,'fsize':resource.getrlimit(resource.RLIMIT_FSIZE)[0],'nofile':resource.getrlimit(resource.RLIMIT_NOFILE)[0]}))\n`;

  await Promise.all([
    writeFile(join(solutionWorkspace, 'input.csv'), input),
    writeFile(
      join(solutionWorkspace, 'solution.py'),
      guards +
        `assert open('/work/input.csv').read() == ${JSON.stringify(input)}\nassert not os.path.exists('/work/harness.py')\nassert not os.path.exists('/work/candidate-output.json')\n`
    ),
    writeFile(join(harnessWorkspace, 'input.csv'), input),
    writeFile(join(harnessWorkspace, 'candidate-output.json'), '{"answer":1}\n'),
    writeFile(
      join(harnessWorkspace, 'harness.py'),
      guards +
        `assert open('/work/input.csv').read() == ${JSON.stringify(input)}\nassert not os.path.exists('/work/solution.py')\nassert json.load(open('/work/candidate-output.json')) == {'answer':1}\n`
    ),
  ]);

  for (const [workspaceDir, entrypoint] of [
    [solutionWorkspace, 'solution.py'],
    [harnessWorkspace, 'harness.py'],
  ] as const) {
    const result = await runPythonSandbox({
      workspaceDir,
      entrypoint,
      signal: new AbortController().signal,
      timeoutMs: 10_000,
    });
    expect(result.exitCode).toBe(0);
    const environment = JSON.parse(result.stdout) as {
      uid: number;
      gid: number;
      nnp: string;
      caps: string;
      host_read: boolean;
      home_denied: boolean;
      network_denied: boolean;
      work_read_only: boolean;
      usr_read_only: boolean;
      tmp_writable: boolean;
      fsize: number;
      nofile: number;
    };
    expect(environment).toMatchObject({
      uid: 65534,
      gid: 65534,
      nnp: '1',
      caps: '0000000000000000',
      host_read: false,
      home_denied: true,
      network_denied: true,
      work_read_only: true,
      usr_read_only: true,
      tmp_writable: true,
      fsize: 1_048_576,
      nofile: 64,
    });
  }
});

sandboxTest('Python sandbox enforces runtime, abort and output bounds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anvil-python-sandbox-limits-'));
  const workspaceDirs = await Promise.all(
    ['timeout', 'abort', 'overflow'].map(async name => {
      const workspaceDir = join(root, name);
      await mkdir(workspaceDir);
      await Promise.all([
        writeFile(join(workspaceDir, 'input.csv'), 'id\n1\n'),
        writeFile(join(workspaceDir, 'solution.py'), 'import time\ntime.sleep(10)\n'),
      ]);
      return workspaceDir;
    })
  );
  const startedAt = Date.now();
  const timedOut = await runPythonSandbox({
    workspaceDir: workspaceDirs[0]!,
    entrypoint: 'solution.py',
    signal: new AbortController().signal,
    timeoutMs: 1_000,
  });
  expect(timedOut.exitCode).not.toBe(0);
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(700);
  expect(Date.now() - startedAt).toBeLessThan(10_000);

  const controller = new AbortController();
  const abortStartedAt = Date.now();
  const abortTimer = setTimeout(() => controller.abort(new Error('sandbox test abort')), 2_000);
  try {
    await expect(
      runPythonSandbox({
        workspaceDir: workspaceDirs[1]!,
        entrypoint: 'solution.py',
        signal: controller.signal,
        timeoutMs: 10_000,
      })
    ).rejects.toThrow('sandbox test abort');
  } finally {
    clearTimeout(abortTimer);
  }
  expect(Date.now() - abortStartedAt).toBeLessThan(8_000);

  await writeFile(
    join(workspaceDirs[2]!, 'solution.py'),
    "while True: print('x' * 4096, flush=True)\n"
  );
  await expect(
    runPythonSandbox({
      workspaceDir: workspaceDirs[2]!,
      entrypoint: 'solution.py',
      signal: new AbortController().signal,
      timeoutMs: 10_000,
    })
  ).rejects.toThrow('output exceeds 65536 bytes per stream');
});
