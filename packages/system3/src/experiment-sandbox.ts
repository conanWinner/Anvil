import { mkdir } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';
import type { MlRuntime } from './ml-runtime';
import {
  BWRAP_BASE,
  realDirectory,
  runSandboxProcess,
  within,
  type SandboxLimits,
} from './sandbox-process';

/**
 * `check` runs quick smoke tests while an agent builds the codebase; `experiment` runs one
 * approved experiment variant. Both are offline and see only the mounts below.
 */
export const EXPERIMENT_SANDBOX_PROFILES = {
  check: {
    limits: {
      memoryMax: '512M',
      cpuQuota: '100%',
      tasksMax: 32,
      fileSizeBytes: 64 * 1024 * 1024,
      openFiles: 256,
    },
    maxTimeoutMs: 60_000,
    threads: 1,
  },
  experiment: {
    limits: {
      memoryMax: '2048M',
      cpuQuota: '200%',
      tasksMax: 64,
      fileSizeBytes: 512 * 1024 * 1024,
      openFiles: 1024,
    },
    maxTimeoutMs: 30 * 60_000,
    threads: 2,
  },
} as const satisfies Record<
  string,
  { limits: SandboxLimits; maxTimeoutMs: number; threads: number }
>;

export type ExperimentSandboxProfile = keyof typeof EXPERIMENT_SANDBOX_PROFILES;

// Logs are kept as data for the agent and the report; longer output is truncated, not fatal.
const LOG_LIMIT = 256 * 1024;

export interface ExperimentSandboxInput {
  profile: ExperimentSandboxProfile;
  runtime: MlRuntime;
  /** Generated codebase, read-only at /work/project. */
  projectDir: string;
  /** Pinned data and split indices, read-only at /work/data. Never holds held-out labels. */
  dataDir: string;
  /** The only writable mount, at /work/out. */
  outputDir: string;
  /** Python script relative to the project, then its arguments. */
  script: string;
  args?: readonly string[];
  timeoutMs: number;
  signal: AbortSignal;
}

export interface ExperimentSandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
}

function projectScript(script: string): string {
  const normalized = normalize(script);
  if (
    isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    !normalized.endsWith('.py')
  )
    throw new Error(`Experiment script must be a .py path inside the project: ${script}`);
  return `/work/project/${normalized}`;
}

// ponytail: in-process queue; experiments started from another Anvil process are not serialized.
let queue: Promise<unknown> = Promise.resolve();

/** Serializes experiment runs on this host: the VPS profile assumes one heavy run at a time. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

export async function runExperimentSandbox(
  input: ExperimentSandboxInput
): Promise<ExperimentSandboxResult> {
  const profile = EXPERIMENT_SANDBOX_PROFILES[input.profile];
  if (
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > profile.maxTimeoutMs
  )
    throw new Error(
      `Experiment sandbox timeoutMs must be between 1 and ${profile.maxTimeoutMs.toString()} for profile ${input.profile}`
    );
  const script = projectScript(input.script);
  await mkdir(input.outputDir, { recursive: true });
  const [projectDir, dataDir, outputDir] = await Promise.all([
    realDirectory(input.projectDir, 'Experiment project'),
    realDirectory(input.dataDir, 'Experiment data'),
    realDirectory(input.outputDir, 'Experiment output'),
  ]);
  for (const [label, dir] of [
    ['project', projectDir],
    ['data', dataDir],
  ] as const) {
    if (within(dir, outputDir) || within(outputDir, dir))
      throw new Error(`Experiment output must not overlap the ${label} mount`);
  }
  const threads = profile.threads.toString();
  const run = async (): Promise<ExperimentSandboxResult> => {
    input.signal.throwIfAborted();
    const started = Date.now();
    const result = await runSandboxProcess({
      limits: profile.limits,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      streamLimit: LOG_LIMIT,
      stopOnOverflow: false,
      bwrapArgs: [
        ...BWRAP_BASE,
        '--ro-bind',
        input.runtime.dir,
        input.runtime.dir,
        '--tmpfs',
        '/work',
        '--ro-bind',
        projectDir,
        '/work/project',
        '--ro-bind',
        dataDir,
        '/work/data',
        '--bind',
        outputDir,
        '/work/out',
        '--remount-ro',
        '/',
        '--setenv',
        'HOME',
        '/tmp',
        '--setenv',
        'MPLBACKEND',
        'Agg',
        '--setenv',
        'MPLCONFIGDIR',
        '/tmp/matplotlib',
        '--setenv',
        'PYTHONHASHSEED',
        '0',
        '--setenv',
        'OMP_NUM_THREADS',
        threads,
        '--setenv',
        'OPENBLAS_NUM_THREADS',
        threads,
        '--setenv',
        'MKL_NUM_THREADS',
        threads,
        '--setenv',
        'NUMBA_CACHE_DIR',
        '/tmp/numba',
        '--chdir',
        '/work/project',
        '--uid',
        '65534',
        '--gid',
        '65534',
        input.runtime.python,
        '-I',
        '-B',
        script,
        ...(input.args ?? []),
      ],
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      truncated: result.stdoutOverflow || result.stderrOverflow,
      durationMs: Date.now() - started,
    };
  };
  return enqueue(run);
}
