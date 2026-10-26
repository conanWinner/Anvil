import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

/** Shared systemd-run + bubblewrap launcher for System 3 sandboxes (Linux only). */
export const SYSTEMD_RUN = '/usr/bin/systemd-run';
export const SYSTEMCTL = '/usr/bin/systemctl';
export const BWRAP = '/usr/bin/bwrap';
const STOP_DISCOVERY_MS = 2_000;

export interface SandboxLimits {
  memoryMax: string;
  cpuQuota: string;
  tasksMax: number;
  fileSizeBytes: number;
  openFiles: number;
}

export interface SandboxProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutOverflow: boolean;
  stderrOverflow: boolean;
}

export async function executable(path: string): Promise<void> {
  try {
    await access(path, constants.X_OK);
  } catch (cause) {
    throw new Error(`Python sandbox requires executable ${path}`, { cause });
  }
}

export async function assertSystemdManager(): Promise<void> {
  const process = Bun.spawn([SYSTEMCTL, 'show', '--property=Version', '--value'], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  if ((await process.exited) !== 0)
    throw new Error('Python sandbox requires an available systemd system manager');
}

export function within(root: string, path: string): boolean {
  const relativePath = path.slice(root.length);
  return path === root || (relativePath.startsWith(sep) && relativePath !== sep);
}

/** Returns the canonical path of a real (non-symlink) directory that is not the filesystem root. */
export async function realDirectory(path: string, label: string): Promise<string> {
  const requested = resolve(path);
  const canonical = await realpath(requested);
  if (canonical === '/') throw new Error(`${label} cannot be the filesystem root`);
  const info = await lstat(requested);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(`${label} must be a real directory`);
  if (canonical !== requested) throw new Error(`${label} path must not traverse symlinks`);
  return canonical;
}

async function captureCapped(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  onOverflow: () => void
): Promise<{ text: string; overflow: boolean }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let overflow = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = limit - size;
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

/**
 * Runs `bwrapArgs` (everything after `bwrap`) in a transient systemd unit with hard limits.
 * Streams are capped at `streamLimit` bytes; when `stopOnOverflow` is set an overflowing stream
 * stops the unit (callers that treat output as data), otherwise output is truncated (logs).
 */
export async function runSandboxProcess(input: {
  limits: SandboxLimits;
  timeoutMs: number;
  bwrapArgs: readonly string[];
  signal: AbortSignal;
  streamLimit: number;
  stopOnOverflow: boolean;
}): Promise<SandboxProcessResult> {
  await Promise.all([executable(SYSTEMD_RUN), executable(SYSTEMCTL), executable(BWRAP)]);
  await assertSystemdManager();
  input.signal.throwIfAborted();
  const unit = `anvil-python-${randomUUID()}.service`;
  const command = [
    SYSTEMD_RUN,
    '--quiet',
    '--wait',
    '--pipe',
    '--collect',
    `--unit=${unit}`,
    `--property=MemoryMax=${input.limits.memoryMax}`,
    '--property=MemorySwapMax=0',
    `--property=CPUQuota=${input.limits.cpuQuota}`,
    `--property=TasksMax=${input.limits.tasksMax.toString()}`,
    `--property=RuntimeMaxSec=${input.timeoutMs.toString()}ms`,
    '--property=TimeoutStopSec=2s',
    '--property=KillMode=control-group',
    '--property=NoNewPrivileges=yes',
    `--property=LimitFSIZE=${input.limits.fileSizeBytes.toString()}`,
    `--property=LimitNOFILE=${input.limits.openFiles.toString()}`,
    BWRAP,
    ...input.bwrapArgs,
  ];

  const process = Bun.spawn(command, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  let stopPromise: Promise<void> | undefined;
  let unitExited = false;
  const requestStop = (): void => {
    if (unitExited || stopPromise !== undefined) return;
    stopPromise = stopUnit(unit, () => !unitExited);
    void stopPromise.catch(() => undefined);
  };
  const onOverflow = input.stopOnOverflow ? requestStop : (): void => undefined;
  const onAbort = (): void => {
    requestStop();
  };
  input.signal.addEventListener('abort', onAbort, { once: true });
  if (input.signal.aborted) onAbort();

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      captureCapped(process.stdout, input.streamLimit, onOverflow),
      captureCapped(process.stderr, input.streamLimit, onOverflow),
      process.exited.then(code => {
        unitExited = true;
        return code;
      }),
    ]);
    await stopPromise;
    if (input.signal.aborted) throw input.signal.reason ?? new Error('Python sandbox was aborted');
    return {
      exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutOverflow: stdout.overflow,
      stderrOverflow: stderr.overflow,
    };
  } finally {
    input.signal.removeEventListener('abort', onAbort);
  }
}

/** Base bubblewrap isolation shared by every System 3 sandbox: no network, no host home, no caps. */
export const BWRAP_BASE: readonly string[] = [
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
];
