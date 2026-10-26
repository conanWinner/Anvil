import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAnvilHome } from '@anvil/paths';

/** Hashed package lock that defines what experiment code may import inside the sandbox. */
export const ML_RUNTIME_LOCK_PATH = fileURLToPath(
  new URL('../runtime/requirements-ml.lock', import.meta.url)
);

export const ML_RUNTIME_MARKER = '.anvil-runtime.json';

export interface MlRuntime {
  /** Canonical venv directory; mounted read-only at the same path inside the sandbox. */
  dir: string;
  python: string;
  lockHash: string;
}

export async function mlRuntimeLockHash(): Promise<string> {
  const lock = await readFile(ML_RUNTIME_LOCK_PATH);
  return `sha256:${createHash('sha256').update(lock).digest('hex')}`;
}

export function mlRuntimeDir(lockHash: string): string {
  return join(
    getAnvilHome(),
    'runtimes',
    'system3-ml',
    lockHash.replace(/^sha256:/u, '').slice(0, 16)
  );
}

/**
 * Resolves the installed runtime for the current lock. Fails instead of falling back to the host
 * Python: experiment results are only reproducible against the locked package set.
 */
export async function resolveMlRuntime(): Promise<MlRuntime> {
  const lockHash = await mlRuntimeLockHash();
  const expectedDir = mlRuntimeDir(lockHash);
  const missing = new Error(
    `System 3 ML runtime for ${lockHash} is not installed at ${expectedDir}. Run \`bun run system3:ml-runtime\`.`
  );
  let dir: string;
  let marker: unknown;
  try {
    dir = await realpath(expectedDir);
    marker = JSON.parse(await readFile(join(dir, ML_RUNTIME_MARKER), 'utf8')) as unknown;
    await access(join(dir, 'bin', 'python'), constants.X_OK);
  } catch (cause) {
    throw new Error(missing.message, { cause });
  }
  if (
    typeof marker !== 'object' ||
    marker === null ||
    !('lockHash' in marker) ||
    marker.lockHash !== lockHash
  )
    throw new Error(`System 3 ML runtime at ${dir} does not match lock ${lockHash}`);
  return { dir, python: join(dir, 'bin', 'python'), lockHash };
}
