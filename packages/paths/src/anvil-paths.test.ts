import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { mkdir, rm, writeFile, lstat, readlink, symlink as fsSymlink } from 'fs/promises';

const isWindows = process.platform === 'win32';

import {
  isDocker,
  getAnvilHome,
  getAnvilWorkspacesPath,
  ensureAnvilWorkspacesPath,
  getAnvilWorktreesPath,
  getAnvilConfigPath,
  getCredentialKeyPath,
  getWorkflowIntakesPath,
  getHomeWorkflowsPath,
  getHomeCommandsPath,
  getHomeScriptsPath,
  getLegacyHomeWorkflowsPath,
  getCommandFolderSearchPaths,
  getWorkflowFolderSearchPaths,
  expandTilde,
  getAppAnvilBasePath,
  getDefaultCommandsPath,
  getDefaultWorkflowsPath,
  logAnvilPaths,
  validateAppDefaultsPaths,
  parseOwnerRepo,
  getProjectRoot,
  getProjectSourcePath,
  getProjectWorktreesPath,
  getProjectArtifactsPath,
  getProjectLogsPath,
  getRunArtifactsPath,
  getRunLogPath,
  resolveProjectRootFromCwd,
  resolveRegisteredProjectRoot,
  ensureProjectStructure,
  createProjectSourceSymlink,
  findMarkdownFilesRecursive,
} from './anvil-paths';

/** All env vars that path functions depend on */
const ENV_VARS = ['WORKSPACE_PATH', 'WORKTREE_BASE', 'ANVIL_HOME', 'ANVIL_DOCKER', 'HOME'];

/**
 * Save and restore environment variables around each test.
 * Call at the top of a describe block to register beforeEach/afterEach hooks.
 */
function useEnvSnapshot(): void {
  const snapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_VARS) {
      snapshot[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_VARS) {
      if (snapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = snapshot[key];
      }
    }
  });
}

describe('anvil-paths', () => {
  useEnvSnapshot();

  describe('expandTilde', () => {
    test('expands ~ to home directory', () => {
      expect(expandTilde('~/test')).toBe(join(homedir(), 'test'));
    });

    test('returns path unchanged if no tilde', () => {
      expect(expandTilde('/absolute/path')).toBe('/absolute/path');
    });
  });

  describe('isDocker', () => {
    test('returns true when WORKSPACE_PATH is /workspace', () => {
      process.env.WORKSPACE_PATH = '/workspace';
      expect(isDocker()).toBe(true);
    });

    test('returns true when HOME=/root and WORKSPACE_PATH set', () => {
      process.env.HOME = '/root';
      process.env.WORKSPACE_PATH = '/app/workspace';
      expect(isDocker()).toBe(true);
    });

    test('returns true when ANVIL_DOCKER=true', () => {
      delete process.env.WORKSPACE_PATH;
      process.env.ANVIL_DOCKER = 'true';
      expect(isDocker()).toBe(true);
    });

    test('returns false for local development', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_DOCKER;
      process.env.HOME = homedir();
      expect(isDocker()).toBe(false);
    });
  });

  describe('getAnvilHome', () => {
    test('returns /.anvil in Docker', () => {
      process.env.WORKSPACE_PATH = '/workspace';
      expect(getAnvilHome()).toBe('/.anvil');
    });

    test('returns ANVIL_HOME when set (local)', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_DOCKER;
      process.env.ANVIL_HOME = '/custom/anvil';
      expect(getAnvilHome()).toBe('/custom/anvil');
    });

    test('expands tilde in ANVIL_HOME', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_DOCKER;
      process.env.ANVIL_HOME = '~/my-anvil';
      expect(getAnvilHome()).toBe(join(homedir(), 'my-anvil'));
    });

    test('returns ~/.anvil by default (local)', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      expect(getAnvilHome()).toBe(join(homedir(), '.anvil'));
    });
  });

  describe('getAnvilWorkspacesPath', () => {
    test('returns ~/.anvil/workspaces by default', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      expect(getAnvilWorkspacesPath()).toBe(join(homedir(), '.anvil', 'workspaces'));
    });

    test('returns /.anvil/workspaces in Docker', () => {
      process.env.ANVIL_DOCKER = 'true';
      expect(getAnvilWorkspacesPath()).toBe(join('/', '.anvil', 'workspaces'));
    });

    test('uses ANVIL_HOME when set', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_DOCKER;
      process.env.ANVIL_HOME = '/custom/anvil';
      expect(getAnvilWorkspacesPath()).toBe(join('/custom/anvil', 'workspaces'));
    });
  });

  describe('getAnvilWorktreesPath', () => {
    test('returns ~/.anvil/worktrees by default', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.WORKTREE_BASE;
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      expect(getAnvilWorktreesPath()).toBe(join(homedir(), '.anvil', 'worktrees'));
    });

    test('returns /.anvil/worktrees in Docker', () => {
      process.env.ANVIL_DOCKER = 'true';
      expect(getAnvilWorktreesPath()).toBe(join('/', '.anvil', 'worktrees'));
    });

    test('uses ANVIL_HOME when set', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.WORKTREE_BASE;
      delete process.env.ANVIL_DOCKER;
      process.env.ANVIL_HOME = '/custom/anvil';
      expect(getAnvilWorktreesPath()).toBe(join('/custom/anvil', 'worktrees'));
    });
  });

  describe('getCommandFolderSearchPaths', () => {
    test('returns .anvil/commands and defaults by default', () => {
      const paths = getCommandFolderSearchPaths();
      expect(paths).toEqual(['.anvil/commands', '.anvil/commands/defaults']);
    });

    test('includes configured folder when provided', () => {
      const paths = getCommandFolderSearchPaths('.claude/commands/anvil');
      expect(paths).toEqual([
        '.anvil/commands',
        '.anvil/commands/defaults',
        '.claude/commands/anvil',
      ]);
    });

    test('.anvil/commands has highest priority', () => {
      const paths = getCommandFolderSearchPaths('.custom/commands');
      expect(paths[0]).toBe('.anvil/commands');
    });

    test('.anvil/commands/defaults has second priority', () => {
      const paths = getCommandFolderSearchPaths('.custom/commands');
      expect(paths[1]).toBe('.anvil/commands/defaults');
    });

    test('does not duplicate .anvil/commands if configured', () => {
      const paths = getCommandFolderSearchPaths('.anvil/commands');
      expect(paths).toEqual(['.anvil/commands', '.anvil/commands/defaults']);
    });

    test('does not duplicate .anvil/commands/defaults if configured', () => {
      const paths = getCommandFolderSearchPaths('.anvil/commands/defaults');
      expect(paths).toEqual(['.anvil/commands', '.anvil/commands/defaults']);
    });
  });

  describe('getWorkflowFolderSearchPaths', () => {
    test('returns .anvil/workflows', () => {
      const paths = getWorkflowFolderSearchPaths();
      expect(paths).toEqual(['.anvil/workflows']);
    });
  });

  describe('getAnvilConfigPath', () => {
    test('returns path to config.yaml', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      expect(getAnvilConfigPath()).toBe(join(homedir(), '.anvil', 'config.yaml'));
    });
  });

  describe('getCredentialKeyPath', () => {
    test('returns credential-key inside ANVIL_HOME', () => {
      process.env.ANVIL_HOME = '/custom/anvil';
      expect(getCredentialKeyPath()).toBe(join('/custom/anvil', 'credential-key'));
    });
  });

  describe('getWorkflowIntakesPath', () => {
    test('returns the managed intake directory inside ANVIL_HOME', () => {
      process.env.ANVIL_HOME = '/custom/anvil';
      expect(getWorkflowIntakesPath()).toBe(join('/custom/anvil', 'intakes'));
    });
  });

  describe('getHomeWorkflowsPath', () => {
    test('returns ~/.anvil/workflows by default (direct child of ~/.anvil/)', () => {
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      expect(getHomeWorkflowsPath()).toBe(join(homedir(), '.anvil', 'workflows'));
    });

    test('returns /.anvil/workflows in Docker', () => {
      process.env.ANVIL_DOCKER = 'true';
      expect(getHomeWorkflowsPath()).toBe(join('/', '.anvil', 'workflows'));
    });

    test('uses ANVIL_HOME when set', () => {
      delete process.env.ANVIL_DOCKER;
      process.env.ANVIL_HOME = '/custom/anvil';
      expect(getHomeWorkflowsPath()).toBe(join('/custom/anvil', 'workflows'));
    });

    test('no double `.anvil/` nesting — must sit next to workspaces/ and worktrees/', () => {
      // Regression guard: the old location was ~/.anvil/.anvil/workflows/.
      // New location must NOT reintroduce the double-nested path.
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      expect(getHomeWorkflowsPath()).not.toContain(join('.anvil', '.anvil'));
    });
  });

  describe('getHomeCommandsPath', () => {
    test('returns ~/.anvil/commands by default', () => {
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      expect(getHomeCommandsPath()).toBe(join(homedir(), '.anvil', 'commands'));
    });

    test('returns /.anvil/commands in Docker', () => {
      process.env.ANVIL_DOCKER = 'true';
      expect(getHomeCommandsPath()).toBe(join('/', '.anvil', 'commands'));
    });

    test('uses ANVIL_HOME when set', () => {
      delete process.env.ANVIL_DOCKER;
      process.env.ANVIL_HOME = '/custom/anvil';
      expect(getHomeCommandsPath()).toBe(join('/custom/anvil', 'commands'));
    });
  });

  describe('getHomeScriptsPath', () => {
    test('returns ~/.anvil/scripts by default', () => {
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      expect(getHomeScriptsPath()).toBe(join(homedir(), '.anvil', 'scripts'));
    });

    test('returns /.anvil/scripts in Docker', () => {
      process.env.ANVIL_DOCKER = 'true';
      expect(getHomeScriptsPath()).toBe(join('/', '.anvil', 'scripts'));
    });

    test('uses ANVIL_HOME when set', () => {
      delete process.env.ANVIL_DOCKER;
      process.env.ANVIL_HOME = '/custom/anvil';
      expect(getHomeScriptsPath()).toBe(join('/custom/anvil', 'scripts'));
    });
  });

  describe('getLegacyHomeWorkflowsPath', () => {
    // This helper only exists so discovery can DETECT files at the old location
    // and emit a deprecation warning. It is not a fallback read path.
    test('returns ~/.anvil/.anvil/workflows (the retired location)', () => {
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      expect(getLegacyHomeWorkflowsPath()).toBe(join(homedir(), '.anvil', '.anvil', 'workflows'));
    });

    test('honors ANVIL_HOME so migration detection works in custom setups', () => {
      delete process.env.ANVIL_DOCKER;
      process.env.ANVIL_HOME = '/custom/anvil';
      expect(getLegacyHomeWorkflowsPath()).toBe(join('/custom/anvil', '.anvil', 'workflows'));
    });
  });

  describe('getAppAnvilBasePath', () => {
    test('returns repo root .anvil path in local development', () => {
      delete process.env.ANVIL_DOCKER;
      delete process.env.WORKSPACE_PATH;
      const path = getAppAnvilBasePath();
      // Should end with .anvil and NOT contain packages/core or packages/paths
      expect(path).toMatch(/\.anvil$/);
      expect(path).not.toContain('packages/core');
      expect(path).not.toContain('packages/paths');
    });

    test('path exists and contains defaults directories', () => {
      delete process.env.ANVIL_DOCKER;
      delete process.env.WORKSPACE_PATH;
      const path = getAppAnvilBasePath();
      // The path should end with .anvil and the directory should exist
      expect(path).toMatch(/\.anvil$/);
      expect(existsSync(path)).toBe(true);
    });
  });

  describe('getDefaultCommandsPath', () => {
    test('returns commands/defaults under app anvil base', () => {
      delete process.env.ANVIL_DOCKER;
      delete process.env.WORKSPACE_PATH;
      const path = getDefaultCommandsPath();
      expect(path).toContain('.anvil');
      expect(path).toContain('commands');
      expect(path).toContain('defaults');
      expect(path).not.toContain('packages/core');
    });
  });

  describe('getDefaultWorkflowsPath', () => {
    test('returns workflows/defaults under app anvil base', () => {
      delete process.env.ANVIL_DOCKER;
      delete process.env.WORKSPACE_PATH;
      const path = getDefaultWorkflowsPath();
      expect(path).toContain('.anvil');
      expect(path).toContain('workflows');
      expect(path).toContain('defaults');
      expect(path).not.toContain('packages/core');
    });
  });

  // =========================================================================
  // Project-centric path functions
  // =========================================================================

  describe('parseOwnerRepo', () => {
    test('parses owner/repo format', () => {
      expect(parseOwnerRepo('acme/widget')).toEqual({ owner: 'acme', repo: 'widget' });
    });

    test('returns null for bare name', () => {
      expect(parseOwnerRepo('widget')).toBeNull();
    });

    test('returns null for empty string', () => {
      expect(parseOwnerRepo('')).toBeNull();
    });

    test('returns null for trailing slash', () => {
      expect(parseOwnerRepo('acme/')).toBeNull();
    });

    test('returns null for leading slash', () => {
      expect(parseOwnerRepo('/widget')).toBeNull();
    });

    test('rejects nested paths with more than one slash', () => {
      const result = parseOwnerRepo('acme/nested/widget');
      expect(result).toBeNull();
    });

    test('rejects path traversal in owner', () => {
      expect(parseOwnerRepo('../etc/passwd')).toBeNull();
    });

    test('rejects path traversal in repo', () => {
      expect(parseOwnerRepo('acme/../../etc')).toBeNull();
    });

    test('rejects dot and dotdot segments', () => {
      expect(parseOwnerRepo('./widget')).toBeNull();
      expect(parseOwnerRepo('acme/..')).toBeNull();
      expect(parseOwnerRepo('../widget')).toBeNull();
      expect(parseOwnerRepo('.')).toBeNull();
    });

    test('accepts valid GitHub-style names with dots, hyphens, underscores', () => {
      expect(parseOwnerRepo('my-org/my_repo.js')).toEqual({
        owner: 'my-org',
        repo: 'my_repo.js',
      });
    });

    test('rejects names with spaces', () => {
      expect(parseOwnerRepo('my org/repo')).toBeNull();
    });

    test('rejects names with special characters', () => {
      expect(parseOwnerRepo('acme/repo;rm -rf')).toBeNull();
      expect(parseOwnerRepo('acme/$HOME')).toBeNull();
    });
  });

  describe('getProjectRoot', () => {
    test('returns path under workspaces', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      const result = getProjectRoot('acme', 'widget');
      expect(result).toBe(join(homedir(), '.anvil', 'workspaces', 'acme', 'widget'));
    });

    test('respects ANVIL_HOME', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_DOCKER;
      process.env.ANVIL_HOME = '/custom/anvil';
      expect(getProjectRoot('acme', 'widget')).toBe(
        join('/custom/anvil', 'workspaces', 'acme', 'widget')
      );
    });

    test('works in Docker', () => {
      process.env.ANVIL_DOCKER = 'true';
      expect(getProjectRoot('acme', 'widget')).toBe(
        join('/', '.anvil', 'workspaces', 'acme', 'widget')
      );
    });
  });

  describe('getProjectSourcePath', () => {
    test('appends source/ to project root', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      expect(getProjectSourcePath('acme', 'widget')).toBe(
        join(homedir(), '.anvil', 'workspaces', 'acme', 'widget', 'source')
      );
    });
  });

  describe('getProjectWorktreesPath', () => {
    test('appends worktrees/ to project root', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      expect(getProjectWorktreesPath('acme', 'widget')).toBe(
        join(homedir(), '.anvil', 'workspaces', 'acme', 'widget', 'worktrees')
      );
    });
  });

  describe('getProjectArtifactsPath', () => {
    test('appends artifacts/ to project root', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      expect(getProjectArtifactsPath('acme', 'widget')).toBe(
        join(homedir(), '.anvil', 'workspaces', 'acme', 'widget', 'artifacts')
      );
    });
  });

  describe('getProjectLogsPath', () => {
    test('appends logs/ to project root', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      expect(getProjectLogsPath('acme', 'widget')).toBe(
        join(homedir(), '.anvil', 'workspaces', 'acme', 'widget', 'logs')
      );
    });
  });

  describe('getRunArtifactsPath', () => {
    test('returns artifacts/runs/{id}/ path', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      expect(getRunArtifactsPath('acme', 'widget', 'run-123')).toBe(
        join(homedir(), '.anvil', 'workspaces', 'acme', 'widget', 'artifacts', 'runs', 'run-123')
      );
    });
  });

  describe('getRunLogPath', () => {
    test('returns logs/{id}.jsonl path', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      expect(getRunLogPath('acme', 'widget', 'run-123')).toBe(
        join(homedir(), '.anvil', 'workspaces', 'acme', 'widget', 'logs', 'run-123.jsonl')
      );
    });
  });

  describe('resolveProjectRootFromCwd', () => {
    test('resolves project root from a path under workspaces', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      const workspacesPath = getAnvilWorkspacesPath();
      const cwd = join(workspacesPath, 'acme', 'widget', 'source');
      expect(resolveProjectRootFromCwd(cwd)).toBe(join(workspacesPath, 'acme', 'widget'));
    });

    test('resolves from worktrees subpath', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      const workspacesPath = getAnvilWorkspacesPath();
      const cwd = join(workspacesPath, 'acme', 'widget', 'worktrees', 'feature-auth');
      expect(resolveProjectRootFromCwd(cwd)).toBe(join(workspacesPath, 'acme', 'widget'));
    });

    test('returns null for path outside workspaces', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      expect(resolveProjectRootFromCwd('/home/user/projects/my-repo')).toBeNull();
    });

    test('returns null for path with only owner (no repo)', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_HOME;
      delete process.env.ANVIL_DOCKER;
      const workspacesPath = getAnvilWorkspacesPath();
      expect(resolveProjectRootFromCwd(join(workspacesPath, 'acme'))).toBeNull();
    });

    test('works with ANVIL_HOME override', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.ANVIL_DOCKER;
      process.env.ANVIL_HOME = join('/', 'custom', 'anvil');
      const cwd = join('/', 'custom', 'anvil', 'workspaces', 'acme', 'widget', 'source');
      expect(resolveProjectRootFromCwd(cwd)).toBe(
        join('/', 'custom', 'anvil', 'workspaces', 'acme', 'widget')
      );
    });
  });

  describe('resolveRegisteredProjectRoot', () => {
    test('keeps a managed local project at its existing workspace root', () => {
      process.env.ANVIL_HOME = '/custom/anvil';
      const cwd = join('/custom/anvil', 'workspaces', '_local', 'customer-churn-mvp', 'source');
      expect(resolveRegisteredProjectRoot('customer-churn-mvp', cwd)).toBe(
        join('/custom/anvil', 'workspaces', '_local', 'customer-churn-mvp')
      );
    });

    test('maps a registered external local repository into _local', () => {
      process.env.ANVIL_HOME = '/custom/anvil';
      expect(resolveRegisteredProjectRoot('customer-churn-mvp', '/code/customer-churn-mvp')).toBe(
        join('/custom/anvil', 'workspaces', '_local', 'customer-churn-mvp')
      );
    });

    test('maps an owner/repo registration into its project workspace', () => {
      process.env.ANVIL_HOME = '/custom/anvil';
      expect(resolveRegisteredProjectRoot('acme/churn', '/code/churn')).toBe(
        join('/custom/anvil', 'workspaces', 'acme', 'churn')
      );
    });

    test('rejects malformed registration names outside managed workspaces', () => {
      process.env.ANVIL_HOME = '/custom/anvil';
      expect(resolveRegisteredProjectRoot('../escape', '/code/project')).toBeNull();
    });
  });
});

describe('logAnvilPaths', () => {
  useEnvSnapshot();

  test('does not throw', () => {
    delete process.env.WORKSPACE_PATH;
    delete process.env.ANVIL_HOME;
    delete process.env.ANVIL_DOCKER;
    expect(() => logAnvilPaths()).not.toThrow();
  });
});

describe('validateAppDefaultsPaths', () => {
  test('does not throw for valid paths', async () => {
    await expect(validateAppDefaultsPaths()).resolves.toBeUndefined();
  });

  test('handles missing paths gracefully', async () => {
    const originalEnv = process.env.ANVIL_DOCKER;
    process.env.ANVIL_DOCKER = 'true';
    try {
      // In Docker mode, paths won't exist — should still not throw
      await expect(validateAppDefaultsPaths()).resolves.toBeUndefined();
    } finally {
      if (originalEnv === undefined) {
        delete process.env.ANVIL_DOCKER;
      } else {
        process.env.ANVIL_DOCKER = originalEnv;
      }
    }
  });
});

// =========================================================================
// Async filesystem tests (use temp directories for isolation)
// =========================================================================

describe('ensureProjectStructure', () => {
  let tempAnvilHome: string;
  useEnvSnapshot();

  beforeEach(async () => {
    delete process.env.WORKSPACE_PATH;
    delete process.env.ANVIL_DOCKER;
    tempAnvilHome = join(
      tmpdir(),
      `anvil-paths-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    process.env.ANVIL_HOME = tempAnvilHome;
  });

  afterEach(async () => {
    await rm(tempAnvilHome, { recursive: true, force: true });
  });

  test('creates all four project subdirectories', async () => {
    await ensureProjectStructure('acme', 'widget');

    const sourcePath = getProjectSourcePath('acme', 'widget');
    const worktreesPath = getProjectWorktreesPath('acme', 'widget');
    const artifactsPath = getProjectArtifactsPath('acme', 'widget');
    const logsPath = getProjectLogsPath('acme', 'widget');

    // All directories should exist
    expect((await lstat(sourcePath)).isDirectory()).toBe(true);
    expect((await lstat(worktreesPath)).isDirectory()).toBe(true);
    expect((await lstat(artifactsPath)).isDirectory()).toBe(true);
    expect((await lstat(logsPath)).isDirectory()).toBe(true);
  });

  test('is idempotent - safe to call twice', async () => {
    await ensureProjectStructure('acme', 'widget');
    await ensureProjectStructure('acme', 'widget');

    const sourcePath = getProjectSourcePath('acme', 'widget');
    expect((await lstat(sourcePath)).isDirectory()).toBe(true);
  });
});

describe('ensureAnvilWorkspacesPath', () => {
  let tempAnvilHome: string;
  useEnvSnapshot();

  beforeEach(async () => {
    delete process.env.WORKSPACE_PATH;
    delete process.env.ANVIL_DOCKER;
    tempAnvilHome = join(
      tmpdir(),
      `anvil-paths-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    process.env.ANVIL_HOME = tempAnvilHome;
  });

  afterEach(async () => {
    await rm(tempAnvilHome, { recursive: true, force: true });
  });

  test('creates the workspaces directory when missing', async () => {
    const expected = getAnvilWorkspacesPath();
    expect(existsSync(expected)).toBe(false);

    const returned = await ensureAnvilWorkspacesPath();

    expect(returned).toBe(expected);
    expect((await lstat(expected)).isDirectory()).toBe(true);
  });

  test('is idempotent - safe to call twice', async () => {
    await ensureAnvilWorkspacesPath();
    await ensureAnvilWorkspacesPath();

    const expected = getAnvilWorkspacesPath();
    expect((await lstat(expected)).isDirectory()).toBe(true);
  });
});

describe('createProjectSourceSymlink', () => {
  let tempAnvilHome: string;
  let tempTarget: string;
  useEnvSnapshot();

  beforeEach(async () => {
    delete process.env.WORKSPACE_PATH;
    delete process.env.ANVIL_DOCKER;
    tempAnvilHome = join(
      tmpdir(),
      `anvil-symlink-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    process.env.ANVIL_HOME = tempAnvilHome;

    tempTarget = join(
      tmpdir(),
      `anvil-target-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(tempTarget, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempAnvilHome, { recursive: true, force: true });
    await rm(tempTarget, { recursive: true, force: true });
  });

  test.skipIf(isWindows)('creates a symlink pointing to the target', async () => {
    await ensureProjectStructure('acme', 'widget');
    await createProjectSourceSymlink('acme', 'widget', tempTarget);

    const linkPath = getProjectSourcePath('acme', 'widget');
    const stats = await lstat(linkPath);
    expect(stats.isSymbolicLink()).toBe(true);
    expect(await readlink(linkPath)).toBe(tempTarget);
  });

  test.skipIf(isWindows)('is a no-op if symlink already points to same target', async () => {
    await ensureProjectStructure('acme', 'widget');
    await createProjectSourceSymlink('acme', 'widget', tempTarget);
    // Call again - should not throw
    await createProjectSourceSymlink('acme', 'widget', tempTarget);

    const linkPath = getProjectSourcePath('acme', 'widget');
    expect(await readlink(linkPath)).toBe(tempTarget);
  });

  test.skipIf(isWindows)('throws when symlink points to a different target', async () => {
    await ensureProjectStructure('acme', 'widget');
    await createProjectSourceSymlink('acme', 'widget', tempTarget);

    const otherTarget = join(tmpdir(), 'other-target');
    await mkdir(otherTarget, { recursive: true });

    try {
      await expect(createProjectSourceSymlink('acme', 'widget', otherTarget)).rejects.toThrow(
        'already points to'
      );
    } finally {
      await rm(otherTarget, { recursive: true, force: true });
    }
  });

  test.skipIf(isWindows)(
    'is a no-op when real directory with contents exists (clone case)',
    async () => {
      await ensureProjectStructure('acme', 'widget');

      // Put a file in the source dir to simulate a clone
      const sourcePath = getProjectSourcePath('acme', 'widget');
      await writeFile(join(sourcePath, 'README.md'), '# Hello');

      // Should not overwrite the directory with a symlink
      await createProjectSourceSymlink('acme', 'widget', tempTarget);

      const stats = await lstat(sourcePath);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.isSymbolicLink()).toBe(false);
    }
  );

  test.skipIf(isWindows)(
    'replaces empty directory with symlink (ensureProjectStructure case)',
    async () => {
      await ensureProjectStructure('acme', 'widget');

      // source/ is empty from ensureProjectStructure
      await createProjectSourceSymlink('acme', 'widget', tempTarget);

      const linkPath = getProjectSourcePath('acme', 'widget');
      const stats = await lstat(linkPath);
      expect(stats.isSymbolicLink()).toBe(true);
      expect(await readlink(linkPath)).toBe(tempTarget);
    }
  );

  test.skipIf(isWindows)('creates symlink when source path does not exist', async () => {
    // Only create the parent, not the source dir itself
    const projectRoot = getProjectRoot('acme', 'widget');
    await mkdir(projectRoot, { recursive: true });

    await createProjectSourceSymlink('acme', 'widget', tempTarget);

    const linkPath = getProjectSourcePath('acme', 'widget');
    const stats = await lstat(linkPath);
    expect(stats.isSymbolicLink()).toBe(true);
  });
});

describe.skipIf(isWindows)('findMarkdownFilesRecursive - symlinks', () => {
  let tempDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `anvil-md-symlink-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    sourceDir = join(
      tmpdir(),
      `anvil-md-symlink-source-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(tempDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
  });

  test('finds .md file reached via symlink in the search root', async () => {
    await writeFile(join(sourceDir, 'linked.md'), '# linked');
    await fsSymlink(join(sourceDir, 'linked.md'), join(tempDir, 'linked.md'));

    const files = await findMarkdownFilesRecursive(tempDir);

    expect(files).toEqual([{ commandName: 'linked', relativePath: 'linked.md' }]);
  });

  test('mixes regular files and symlinks in the same directory', async () => {
    await writeFile(join(tempDir, 'regular.md'), '# regular');
    await writeFile(join(sourceDir, 'linked.md'), '# linked');
    await fsSymlink(join(sourceDir, 'linked.md'), join(tempDir, 'linked.md'));

    const files = await findMarkdownFilesRecursive(tempDir);
    const commandNames = files.map(file => file.commandName).sort();

    expect(commandNames).toEqual(['linked', 'regular']);
  });

  test('descends into a symlinked directory of .md files', async () => {
    await writeFile(join(sourceDir, 'nested.md'), '# nested');
    await fsSymlink(sourceDir, join(tempDir, 'linked-dir'));

    const files = await findMarkdownFilesRecursive(tempDir);

    expect(files).toEqual([
      { commandName: 'nested', relativePath: join('linked-dir', 'nested.md') },
    ]);
  });

  test('preserves sibling symlink aliases that point to the same directory', async () => {
    const localSourceDir = join(tempDir, 'source');
    await mkdir(localSourceDir);
    await writeFile(join(localSourceDir, 'foo.md'), '# foo');
    await fsSymlink(localSourceDir, join(tempDir, 'alias'));

    const files = await findMarkdownFilesRecursive(tempDir);
    const relativePaths = files.map(file => file.relativePath).sort();

    expect(relativePaths).toEqual([join('alias', 'foo.md'), join('source', 'foo.md')]);
  });

  test('skips broken symlinks silently', async () => {
    await writeFile(join(tempDir, 'regular.md'), '# regular');
    await fsSymlink(join(sourceDir, 'missing.md'), join(tempDir, 'broken.md'));

    const files = await findMarkdownFilesRecursive(tempDir);

    expect(files).toEqual([{ commandName: 'regular', relativePath: 'regular.md' }]);
  });

  test('does not recurse infinitely on a self-referential symlink cycle', async () => {
    await writeFile(join(tempDir, 'root.md'), '# root');
    await fsSymlink(tempDir, join(tempDir, 'self'));

    const files = await findMarkdownFilesRecursive(tempDir);

    expect(files).toEqual([{ commandName: 'root', relativePath: 'root.md' }]);
  });

  test('does not recurse infinitely on a multi-level symlink cycle', async () => {
    const firstDir = join(tempDir, 'first');
    const secondDir = join(firstDir, 'second');
    await mkdir(secondDir, { recursive: true });
    await writeFile(join(secondDir, 'nested.md'), '# nested');
    await fsSymlink(firstDir, join(secondDir, 'back-to-first'));

    const files = await findMarkdownFilesRecursive(tempDir);

    expect(files).toEqual([
      { commandName: 'nested', relativePath: join('first', 'second', 'nested.md') },
    ]);
  });
});
