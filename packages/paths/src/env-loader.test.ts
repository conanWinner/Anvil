import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { loadAnvilEnv } from './env-loader';

/**
 * loadAnvilEnv covers the read side of the three-path env model (#1302):
 *   ~/.anvil/.env         → home scope, override: true
 *   <cwd>/.anvil/.env     → repo scope, override: true (wins over home)
 *
 * Tests drive the home scope via ANVIL_HOME and the repo scope via the `cwd`
 * argument. Both are tmpdirs; no real ~/.anvil/ is touched.
 */

const tmpRoot = join(import.meta.dir, '__env-loader-test-tmp__');
const anvilHomeDir = join(tmpRoot, 'anvil-home');
const repoDir = join(tmpRoot, 'repo');

// Keys we set/clear in tests. Using namespaced names to avoid collisions with
// anything a developer might have in their real shell env.
const TEST_KEYS = ['TEST_EL_HOME_ONLY', 'TEST_EL_REPO_ONLY', 'TEST_EL_OVERLAP', 'TEST_EL_OTHER'];

let originalAnvilHome: string | undefined;
let originalAnvilVerboseBoot: string | undefined;
let originalLogLevel: string | undefined;
let stderrSpy: ReturnType<typeof spyOn>;
let stderrWrites: string[];

beforeEach(() => {
  mkdirSync(anvilHomeDir, { recursive: true });
  mkdirSync(join(repoDir, '.anvil'), { recursive: true });

  originalAnvilHome = process.env.ANVIL_HOME;
  process.env.ANVIL_HOME = anvilHomeDir;

  // Clear verbose-boot toggles so each test starts suppressed and can opt in explicitly.
  originalAnvilVerboseBoot = process.env.ANVIL_VERBOSE_BOOT;
  originalLogLevel = process.env.LOG_LEVEL;
  delete process.env.ANVIL_VERBOSE_BOOT;
  delete process.env.LOG_LEVEL;

  for (const k of TEST_KEYS) delete process.env[k];

  stderrWrites = [];
  stderrSpy = spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderrWrites.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  });
});

afterEach(() => {
  stderrSpy.mockRestore();
  rmSync(tmpRoot, { recursive: true, force: true });

  if (originalAnvilHome === undefined) delete process.env.ANVIL_HOME;
  else process.env.ANVIL_HOME = originalAnvilHome;

  if (originalAnvilVerboseBoot === undefined) delete process.env.ANVIL_VERBOSE_BOOT;
  else process.env.ANVIL_VERBOSE_BOOT = originalAnvilVerboseBoot;

  if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalLogLevel;

  for (const k of TEST_KEYS) delete process.env[k];
});

describe('loadAnvilEnv', () => {
  it('loads keys from ~/.anvil/.env and emits a [anvil] loaded line when verbose-boot is set', () => {
    process.env.ANVIL_VERBOSE_BOOT = '1';
    writeFileSync(join(anvilHomeDir, '.env'), 'TEST_EL_HOME_ONLY=from-home\nTEST_EL_OTHER=keep\n');

    loadAnvilEnv(repoDir);

    expect(process.env.TEST_EL_HOME_ONLY).toBe('from-home');
    expect(process.env.TEST_EL_OTHER).toBe('keep');
    // Tilde-shortening of the rendered path is opportunistic (only when the
    // tmpdir lives under `homedir()`). On Windows CI the tmpdir is on a
    // different drive and the path renders absolute, so we match on count and
    // the anvil-home tmpdir segment rather than a literal `~` prefix.
    const line = stderrWrites.find(s => s.includes('[anvil] loaded') && !s.includes('repo scope'));
    expect(line).toBeDefined();
    expect(line).toContain('loaded 2 keys');
    expect(line).toContain(join('anvil-home', '.env'));
  });

  it('loads keys from <cwd>/.anvil/.env and marks it as repo scope when verbose-boot is set', () => {
    process.env.ANVIL_VERBOSE_BOOT = '1';
    writeFileSync(join(repoDir, '.anvil', '.env'), 'TEST_EL_REPO_ONLY=from-repo\n');

    loadAnvilEnv(repoDir);

    expect(process.env.TEST_EL_REPO_ONLY).toBe('from-repo');
    const line = stderrWrites.find(s => s.includes('repo scope, overrides user scope'));
    expect(line).toBeDefined();
    expect(line).toContain('loaded 1 keys');
    // Path rendering tildes anything under the user's home directory — assert
    // on the suffix (the `.anvil/.env` segment) rather than the full path,
    // because the tmpdir may or may not live under $HOME on CI.
    expect(line).toContain(join('.anvil', '.env'));
  });

  it('does not emit loaded lines by default even when keys are present', () => {
    writeFileSync(join(anvilHomeDir, '.env'), 'TEST_EL_HOME_ONLY=from-home\n');
    writeFileSync(join(repoDir, '.anvil', '.env'), 'TEST_EL_REPO_ONLY=from-repo\n');

    loadAnvilEnv(repoDir);

    // Keys are still loaded into process.env — only the stderr line is gated.
    expect(process.env.TEST_EL_HOME_ONLY).toBe('from-home');
    expect(process.env.TEST_EL_REPO_ONLY).toBe('from-repo');
    const anyLoaded = stderrWrites.find(s => s.includes('[anvil] loaded'));
    expect(anyLoaded).toBeUndefined();
  });

  it('emits loaded lines when LOG_LEVEL=debug', () => {
    process.env.LOG_LEVEL = 'debug';
    writeFileSync(join(anvilHomeDir, '.env'), 'TEST_EL_HOME_ONLY=from-home\n');

    loadAnvilEnv(repoDir);

    const line = stderrWrites.find(s => s.includes('[anvil] loaded') && !s.includes('repo scope'));
    expect(line).toBeDefined();
  });

  it('repo scope overrides home scope on overlapping keys', () => {
    writeFileSync(join(anvilHomeDir, '.env'), 'TEST_EL_OVERLAP=from-home\n');
    writeFileSync(join(repoDir, '.anvil', '.env'), 'TEST_EL_OVERLAP=from-repo\n');

    loadAnvilEnv(repoDir);

    expect(process.env.TEST_EL_OVERLAP).toBe('from-repo');
  });

  it('emits nothing when neither file exists', () => {
    loadAnvilEnv(repoDir);
    const anyLoaded = stderrWrites.find(s => s.includes('[anvil] loaded'));
    expect(anyLoaded).toBeUndefined();
  });

  it('emits no loaded line when a file exists but is empty', () => {
    writeFileSync(join(anvilHomeDir, '.env'), '');
    writeFileSync(join(repoDir, '.anvil', '.env'), '');

    loadAnvilEnv(repoDir);

    const anyLoaded = stderrWrites.find(s => s.includes('[anvil] loaded'));
    expect(anyLoaded).toBeUndefined();
  });

  it('exits with error when env file has a dotenv-unparseable layout', () => {
    // dotenv.parse is very permissive — lines without `=` are silently ignored,
    // so syntactic errors that actually surface are rare. We instead simulate
    // a permission-style failure by writing a path that cannot be read: pass a
    // directory in place of a file. dotenv.config returns an error for EISDIR.
    // (Use the home slot since the repo path derives from cwd inside the fn.)
    rmSync(join(anvilHomeDir, '.env'), { force: true });
    mkdirSync(join(anvilHomeDir, '.env'), { recursive: true }); // directory at .env path

    const consoleErrorMessages: string[] = [];
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation((msg: unknown) => {
      consoleErrorMessages.push(String(msg));
    });
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    try {
      expect(() => loadAnvilEnv(repoDir)).toThrow('process.exit called');
      const msg = consoleErrorMessages.find(s => s.startsWith('Error loading .env'));
      expect(msg).toBeDefined();
    } finally {
      consoleErrorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('emits loaded lines when LOG_LEVEL=trace', () => {
    process.env.LOG_LEVEL = 'trace';
    writeFileSync(join(anvilHomeDir, '.env'), 'TEST_EL_HOME_ONLY=from-home\n');

    loadAnvilEnv(repoDir);

    const line = stderrWrites.find(s => s.includes('[anvil] loaded') && !s.includes('repo scope'));
    expect(line).toBeDefined();
  });

  it('does not emit loaded lines when ANVIL_VERBOSE_BOOT is set to a non-"1" value', () => {
    process.env.ANVIL_VERBOSE_BOOT = 'true';
    writeFileSync(join(anvilHomeDir, '.env'), 'TEST_EL_HOME_ONLY=from-home\n');

    loadAnvilEnv(repoDir);

    const anyLoaded = stderrWrites.find(s => s.includes('[anvil] loaded'));
    expect(anyLoaded).toBeUndefined();
  });
});
