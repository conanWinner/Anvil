import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const SYSTEMD_RUN = '/usr/bin/systemd-run';
const SYSTEMCTL = '/usr/bin/systemctl';
const BWRAP = '/usr/bin/bwrap';
const PYTHON = '/usr/bin/python3';
const STREAM_LIMIT = 64 * 1024;
const MAX_TIMEOUT_MS = 60_000;
const STOP_DISCOVERY_MS = 2_000;

export interface PythonSandboxInput {
  workspaceDir: string;
  signal: AbortSignal;
  timeoutMs: number;
  entrypoint: 'solution.py' | 'harness.py';
}

export interface PythonSandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface WorkspaceFiles {
  input: string;
  entrypoint: string;
  candidateOutput?: string;
}

async function executable(path: string): Promise<void> {
  try {
    await access(path, constants.X_OK);
  } catch (cause) {
    throw new Error(`Python sandbox requires executable ${path}`, { cause });
  }
}

async function assertSystemdManager(): Promise<void> {
  const process = Bun.spawn([SYSTEMCTL, 'show', '--property=Version', '--value'], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  if ((await process.exited) !== 0)
    throw new Error('Python sandbox requires an available systemd system manager');
}

function within(root: string, path: string): boolean {
  const relativePath = path.slice(root.length);
  return path === root || (relativePath.startsWith(sep) && relativePath !== sep);
}

async function workspaceFiles(
  workspaceDir: string,
  entrypoint: PythonSandboxInput['entrypoint']
): Promise<WorkspaceFiles> {
  const requestedRoot = resolve(workspaceDir);
  const root = await realpath(requestedRoot);
  if (root === '/') throw new Error('Python sandbox workspace cannot be the filesystem root');
  const rootInfo = await lstat(requestedRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error('Python sandbox workspace must be a real directory');
  if (root !== requestedRoot)
    throw new Error('Python sandbox workspace path must not traverse symlinks');

  const file = async (name: string): Promise<string> => {
    const path = resolve(root, name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error(`Python sandbox requires regular workspace file '${name}'`);
    const canonical = await realpath(path);
    if (!within(root, canonical))
      throw new Error(`Python sandbox file '${name}' escapes workspace`);
    return canonical;
  };

  const input = await file('input.csv');
  const entrypointPath = await file(entrypoint);
  return {
    input,
    entrypoint: entrypointPath,
    ...(entrypoint === 'harness.py'
      ? { candidateOutput: await file('candidate-output.json') }
      : {}),
  };
}

async function captureCapped(
  stream: ReadableStream<Uint8Array>,
  onOverflow: () => void
): Promise<{ text: string; overflow: boolean }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let overflow = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = STREAM_LIMIT - size;
    if (remaining > 0) {
      const chunk = value.subarray(0, remaining);
      chunks.push(chunk);
      size += chunk.byteLength;
    }
    if (value.byteLength > remaining && !overflow) {
      overflow = true;
      onOverflow();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), overflow };
}

async function stopUnit(unit: string, isRunning: () => boolean): Promise<void> {
  const deadline = Date.now() + STOP_DISCOVERY_MS;
  while (isRunning() && Date.now() < deadline) {
    const status = Bun.spawn([SYSTEMCTL, 'show', '--property=LoadState', '--value', unit], {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const [state, statusCode] = await Promise.all([
      new Response(status.stdout).text(),
      status.exited,
    ]);
    if (statusCode !== 0) throw new Error('Could not inspect Python sandbox transient unit');
    if (!isRunning()) return;
    if (state.trim() !== 'not-found') {
      const stop = Bun.spawn([SYSTEMCTL, 'stop', unit], { stdout: 'ignore', stderr: 'ignore' });
      if ((await stop.exited) !== 0 && isRunning())
        throw new Error('Could not stop Python sandbox transient unit');
      return;
    }
    await Bun.sleep(25);
  }
  if (isRunning())
    throw new Error('Python sandbox transient unit did not become visible for cancellation');
}

export async function runPythonSandbox({
  workspaceDir,
  signal,
  timeoutMs,
  entrypoint,
}: PythonSandboxInput): Promise<PythonSandboxResult> {
  if (entrypoint !== 'solution.py' && entrypoint !== 'harness.py')
    throw new Error("Python sandbox entrypoint must be 'solution.py' or 'harness.py'");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS)
    throw new Error(`Python sandbox timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}`);
  signal.throwIfAborted();
  const files = await workspaceFiles(workspaceDir, entrypoint);
  await Promise.all([
    executable(SYSTEMD_RUN),
    executable(SYSTEMCTL),
    executable(BWRAP),
    executable(PYTHON),
  ]);
  await assertSystemdManager();
  signal.throwIfAborted();

  const unit = `anvil-python-${randomUUID()}.service`;
  const command = [
    SYSTEMD_RUN,
    '--quiet',
    '--wait',
    '--pipe',
    '--collect',
    `--unit=${unit}`,
    '--property=MemoryMax=256M',
    '--property=MemorySwapMax=0',
    '--property=CPUQuota=100%',
    '--property=TasksMax=16',
    `--property=RuntimeMaxSec=${timeoutMs}ms`,
    '--property=TimeoutStopSec=2s',
    '--property=KillMode=control-group',
    '--property=NoNewPrivileges=yes',
    '--property=LimitFSIZE=1048576',
    '--property=LimitNOFILE=64',
    BWRAP,
    '--die-with-parent',
    '--new-session',
    '--unshare-all',
    '--clearenv',
    '--cap-drop',
    'ALL',
    '--ro-bind',
    '/usr',
    '/usr',
    '--symlink',
    'usr/bin',
    '/bin',
    '--symlink',
    'usr/lib',
    '/lib',
    '--symlink',
    'usr/lib64',
    '/lib64',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    '--tmpfs',
    '/work',
    '--ro-bind',
    files.input,
    '/work/input.csv',
    '--ro-bind',
    files.entrypoint,
    `/work/${entrypoint}`,
    ...(files.candidateOutput === undefined
      ? []
      : ['--ro-bind', files.candidateOutput, '/work/candidate-output.json']),
    '--remount-ro',
    '/work',
    '--remount-ro',
    '/',
    '--chdir',
    '/work',
    '--uid',
    '65534',
    '--gid',
    '65534',
    PYTHON,
    '-I',
    '-B',
    `/work/${entrypoint}`,
  ];

  const process = Bun.spawn(command, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  let stopPromise: Promise<void> | undefined;
  let unitExited = false;
  const requestStop = (): void => {
    if (unitExited || stopPromise !== undefined) return;
    stopPromise = stopUnit(unit, () => !unitExited);
    void stopPromise.catch(() => undefined);
  };
  const onAbort = (): void => {
    requestStop();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      captureCapped(process.stdout, requestStop),
      captureCapped(process.stderr, requestStop),
      process.exited.then(code => {
        unitExited = true;
        return code;
      }),
    ]);
    await stopPromise;
    if (signal.aborted) throw signal.reason ?? new Error('Python sandbox was aborted');
    if (stdout.overflow || stderr.overflow)
      throw new Error(`Python sandbox output exceeds ${STREAM_LIMIT} bytes per stream`);
    return { exitCode, stdout: stdout.text, stderr: stderr.text };
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

// ponytail: Linux-only Python stdlib sandbox; broaden runtime or add languages only with an approved isolation contract.
