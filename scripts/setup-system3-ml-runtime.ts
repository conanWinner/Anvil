/**
 * Installs the locked System 3 ML runtime (a uv-managed venv) under $ANVIL_HOME/runtimes.
 * Network access is needed only here; experiment sandboxes mount the result read-only offline.
 *
 *   bun run system3:ml-runtime          install (idempotent)
 *   bun run system3:ml-lock             re-resolve requirements-ml.in into the hashed lock
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  ML_RUNTIME_LOCK_PATH,
  ML_RUNTIME_MARKER,
  mlRuntimeDir,
  mlRuntimeLockHash,
  resolveMlRuntime,
} from '../packages/system3/src/ml-runtime';

const UV = process.env.UV_BIN ?? join(homedir(), '.local', 'bin', 'uv');
const BASE_PYTHON = '/usr/bin/python3';

async function run(args: string[]): Promise<void> {
  const child = Bun.spawn([UV, ...args], { stdout: 'inherit', stderr: 'inherit' });
  if ((await child.exited) !== 0) throw new Error(`uv ${args.join(' ')} failed`);
}

async function lock(): Promise<void> {
  await run([
    'pip',
    'compile',
    ML_RUNTIME_LOCK_PATH.replace(/\.lock$/u, '.in'),
    '--python-version',
    '3.12',
    '--python-platform',
    'x86_64-manylinux_2_28',
    '--generate-hashes',
    '--no-header',
    '-o',
    ML_RUNTIME_LOCK_PATH,
  ]);
}

async function install(): Promise<void> {
  try {
    const existing = await resolveMlRuntime();
    console.log(`System 3 ML runtime already installed: ${existing.dir}`);
    return;
  } catch {
    // Not installed (or stale marker): build it from scratch below.
  }
  const lockHash = await mlRuntimeLockHash();
  const dir = mlRuntimeDir(lockHash);
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, '..'), { recursive: true });
  await run(['venv', '--python', BASE_PYTHON, dir]);
  await run([
    'pip',
    'sync',
    '--python',
    join(dir, 'bin', 'python'),
    '--require-hashes',
    ML_RUNTIME_LOCK_PATH,
  ]);
  // Native wheels need host libraries (LightGBM links libgomp); fail with the fix instead of later.
  const smoke = Bun.spawn(
    [join(dir, 'bin', 'python'), '-c', 'import sklearn, lightgbm, xgboost, pandas, shap'],
    { stdout: 'inherit', stderr: 'inherit' }
  );
  if ((await smoke.exited) !== 0)
    throw new Error(
      'ML runtime import check failed. On Debian/Ubuntu install OpenMP: apt-get install -y libgomp1'
    );
  // The marker is written last, so an interrupted install is never mistaken for a ready runtime.
  await writeFile(
    join(dir, ML_RUNTIME_MARKER),
    `${JSON.stringify({ lockHash, basePython: BASE_PYTHON }, null, 2)}\n`
  );
  console.log(`System 3 ML runtime installed: ${dir}`);
}

await (process.argv.includes('--lock') ? lock() : install());
