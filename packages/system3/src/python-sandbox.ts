import { lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BWRAP_BASE,
  executable,
  realDirectory,
  runSandboxProcess,
  within,
} from './sandbox-process';

const PYTHON = '/usr/bin/python3';
const STREAM_LIMIT = 64 * 1024;
const MAX_TIMEOUT_MS = 60_000;

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

async function workspaceFiles(
  workspaceDir: string,
  entrypoint: PythonSandboxInput['entrypoint']
): Promise<WorkspaceFiles> {
  const root = await realDirectory(workspaceDir, 'Python sandbox workspace');

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
  await executable(PYTHON);
  const result = await runSandboxProcess({
    limits: {
      memoryMax: '256M',
      cpuQuota: '100%',
      tasksMax: 16,
      fileSizeBytes: 1024 * 1024,
      openFiles: 64,
    },
    timeoutMs,
    signal,
    streamLimit: STREAM_LIMIT,
    stopOnOverflow: true,
    bwrapArgs: [
      ...BWRAP_BASE,
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
    ],
  });
  if (result.stdoutOverflow || result.stderrOverflow)
    throw new Error(`Python sandbox output exceeds ${STREAM_LIMIT} bytes per stream`);
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

// ponytail: Linux-only Python stdlib sandbox; broaden runtime or add languages only with an approved isolation contract.
