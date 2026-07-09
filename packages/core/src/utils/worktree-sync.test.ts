import { describe, test, expect, beforeEach, afterEach, spyOn, mock, type Mock } from 'bun:test';
import * as git from '@anvil/git';
import * as worktreeCopy from '@anvil/isolation';
import * as configLoader from '../config/config-loader';
import * as fs from 'fs/promises';
import type { Stats } from 'fs';
import type { RepoConfig } from '../config/config-types';
import type { CopyFileEntry } from '@anvil/isolation';
import { createMockLogger } from '../test/mocks/logger';

/** Normalize path separators to forward slashes for cross-platform comparison */
function normPath(p: string): string {
  return p.replace(/\\/g, '/');
}

const mockLogger = createMockLogger();
mock.module('@anvil/paths', () => ({
  createLogger: mock(() => mockLogger),
  getAnvilHome: mock(() => '/home/test/.anvil'),
  getAnvilConfigPath: mock(() => '/home/test/.anvil/config.yaml'),
  getAnvilWorkspacesPath: mock(() => '/home/test/.anvil/workspaces'),
  getAnvilWorktreesPath: mock(() => '/home/test/.anvil/worktrees'),
  getDefaultCommandsPath: mock(() => '/app/.anvil/commands/defaults'),
  getDefaultWorkflowsPath: mock(() => '/app/.anvil/workflows/defaults'),
}));

import { syncAnvilToWorktree } from './worktree-sync';

describe('syncAnvilToWorktree', () => {
  let isWorktreePathSpy: Mock<(path: string) => Promise<boolean>>;
  let getCanonicalRepoPathSpy: Mock<(path: string) => Promise<string>>;
  let statSpy: Mock<(path: string) => Promise<Stats>>;
  let loadRepoConfigSpy: Mock<(path: string) => Promise<RepoConfig>>;
  let copyWorktreeFilesSpy: Mock<
    (canonicalPath: string, worktreePath: string, files: string[]) => Promise<CopyFileEntry[]>
  >;

  beforeEach(() => {
    isWorktreePathSpy = spyOn(git, 'isWorktreePath');
    getCanonicalRepoPathSpy = spyOn(git, 'getCanonicalRepoPath');
    statSpy = spyOn(fs, 'stat');
    loadRepoConfigSpy = spyOn(configLoader, 'loadRepoConfig');
    copyWorktreeFilesSpy = spyOn(worktreeCopy, 'copyWorktreeFiles');
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
  });

  afterEach(() => {
    isWorktreePathSpy.mockRestore();
    getCanonicalRepoPathSpy.mockRestore();
    statSpy.mockRestore();
    loadRepoConfigSpy.mockRestore();
    copyWorktreeFilesSpy.mockRestore();
  });

  test('returns false for non-worktree paths', async () => {
    isWorktreePathSpy.mockResolvedValue(false);

    const result = await syncAnvilToWorktree('/regular/repo');

    expect(result).toBe(false);
    expect(isWorktreePathSpy).toHaveBeenCalledWith('/regular/repo');
    expect(getCanonicalRepoPathSpy).not.toHaveBeenCalled();
  });

  test('returns false when canonical repo has no .anvil', async () => {
    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');
    statSpy.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await syncAnvilToWorktree('/worktree/path');

    expect(result).toBe(false);
    expect(normPath(statSpy.mock.calls[0][0] as string)).toBe('/canonical/repo/.anvil');
    expect(copyWorktreeFilesSpy).not.toHaveBeenCalled();
    // Should not log warning for ENOENT (expected case)
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  test('logs warning and returns false for non-ENOENT canonical stat error', async () => {
    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');
    statSpy.mockRejectedValue(Object.assign(new Error('Permission denied'), { code: 'EACCES' }));

    const result = await syncAnvilToWorktree('/worktree/path');

    expect(result).toBe(false);
    expect(copyWorktreeFilesSpy).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'canonical',
        path: expect.stringMatching(/canonical[/\\]repo[/\\]\.anvil/),
        code: 'EACCES',
      }),
      'stat_failed'
    );
  });

  test('returns false when worktree .anvil is up-to-date', async () => {
    const canonicalMtime = new Date('2024-01-01T10:00:00Z');
    const worktreeMtime = new Date('2024-01-01T12:00:00Z'); // Newer

    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');

    statSpy.mockImplementation((path: string) => {
      const p = normPath(path);
      if (p === '/canonical/repo/.anvil') {
        return Promise.resolve({ mtime: canonicalMtime } as Stats);
      }
      if (p === '/worktree/path/.anvil') {
        return Promise.resolve({ mtime: worktreeMtime } as Stats);
      }
      return Promise.reject(new Error('Unexpected path'));
    });

    const result = await syncAnvilToWorktree('/worktree/path');

    expect(result).toBe(false);
    expect(copyWorktreeFilesSpy).not.toHaveBeenCalled();
  });

  test('syncs when canonical .anvil is newer', async () => {
    const canonicalMtime = new Date('2024-01-01T12:00:00Z'); // Newer
    const worktreeMtime = new Date('2024-01-01T10:00:00Z');

    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');

    statSpy.mockImplementation((path: string) => {
      const p = normPath(path);
      if (p === '/canonical/repo/.anvil') {
        return Promise.resolve({ mtime: canonicalMtime } as Stats);
      }
      if (p === '/worktree/path/.anvil') {
        return Promise.resolve({ mtime: worktreeMtime } as Stats);
      }
      return Promise.reject(new Error('Unexpected path'));
    });

    loadRepoConfigSpy.mockResolvedValue({
      worktree: { copyFiles: ['.anvil', '.env'] },
    });

    copyWorktreeFilesSpy.mockResolvedValue([{ source: '.anvil', destination: '.anvil' }]);

    const result = await syncAnvilToWorktree('/worktree/path');

    expect(result).toBe(true);
    expect(copyWorktreeFilesSpy).toHaveBeenCalledWith(
      expect.stringMatching(/canonical[/\\]repo$/),
      expect.stringMatching(/worktree[/\\]path$/),
      ['.anvil', '.env']
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalRepo: expect.stringMatching(/canonical[/\\]repo$/),
        worktree: '/worktree/path',
        filesCopied: 1,
      }),
      'anvil_synced_to_worktree'
    );
  });

  test('syncs when worktree has no .anvil yet', async () => {
    const canonicalMtime = new Date('2024-01-01T12:00:00Z');

    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');

    statSpy.mockImplementation((path: string) => {
      const p = normPath(path);
      if (p === '/canonical/repo/.anvil') {
        return Promise.resolve({ mtime: canonicalMtime } as Stats);
      }
      if (p === '/worktree/path/.anvil') {
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      }
      return Promise.reject(new Error('Unexpected path'));
    });

    loadRepoConfigSpy.mockResolvedValue({
      worktree: { copyFiles: ['.anvil'] },
    });

    copyWorktreeFilesSpy.mockResolvedValue([{ source: '.anvil', destination: '.anvil' }]);

    const result = await syncAnvilToWorktree('/worktree/path');

    expect(result).toBe(true);
    expect(copyWorktreeFilesSpy).toHaveBeenCalledWith(
      expect.stringMatching(/canonical[/\\]repo$/),
      '/worktree/path',
      ['.anvil']
    );
  });

  test('logs warning and returns false for non-ENOENT worktree stat error', async () => {
    const canonicalMtime = new Date('2024-01-01T12:00:00Z');

    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');

    statSpy.mockImplementation((path: string) => {
      const p = normPath(path);
      if (p === '/canonical/repo/.anvil') {
        return Promise.resolve({ mtime: canonicalMtime } as Stats);
      }
      if (p === '/worktree/path/.anvil') {
        return Promise.reject(Object.assign(new Error('Permission denied'), { code: 'EACCES' }));
      }
      return Promise.reject(new Error('Unexpected path'));
    });

    const result = await syncAnvilToWorktree('/worktree/path');

    expect(result).toBe(false);
    expect(copyWorktreeFilesSpy).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'worktree',
        path: expect.stringMatching(/worktree[/\\]path[/\\]\.anvil/),
        code: 'EACCES',
      }),
      'stat_failed'
    );
    // Should also log the outer catch error
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: '/worktree/path',
        code: 'EACCES',
      }),
      'anvil_sync_failed'
    );
  });

  test('defaults to [".anvil"] when config has no copyFiles', async () => {
    const canonicalMtime = new Date('2024-01-01T12:00:00Z');
    const worktreeMtime = new Date('2024-01-01T10:00:00Z');

    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');

    statSpy.mockImplementation((path: string) => {
      const p = normPath(path);
      if (p === '/canonical/repo/.anvil') {
        return Promise.resolve({ mtime: canonicalMtime } as Stats);
      }
      if (p === '/worktree/path/.anvil') {
        return Promise.resolve({ mtime: worktreeMtime } as Stats);
      }
      return Promise.reject(new Error('Unexpected path'));
    });

    loadRepoConfigSpy.mockResolvedValue({
      worktree: {}, // No copyFiles
    });

    copyWorktreeFilesSpy.mockResolvedValue([{ source: '.anvil', destination: '.anvil' }]);

    const result = await syncAnvilToWorktree('/worktree/path');

    expect(result).toBe(true);
    expect(copyWorktreeFilesSpy).toHaveBeenCalledWith(
      expect.stringMatching(/canonical[/\\]repo$/),
      '/worktree/path',
      ['.anvil']
    );
  });

  test('defaults to [".anvil"] when config loading fails and logs warning', async () => {
    const canonicalMtime = new Date('2024-01-01T12:00:00Z');
    const worktreeMtime = new Date('2024-01-01T10:00:00Z');

    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');

    statSpy.mockImplementation((path: string) => {
      const p = normPath(path);
      if (p === '/canonical/repo/.anvil') {
        return Promise.resolve({ mtime: canonicalMtime } as Stats);
      }
      if (p === '/worktree/path/.anvil') {
        return Promise.resolve({ mtime: worktreeMtime } as Stats);
      }
      return Promise.reject(new Error('Unexpected path'));
    });

    loadRepoConfigSpy.mockRejectedValue(new Error('Config not found'));

    copyWorktreeFilesSpy.mockResolvedValue([{ source: '.anvil', destination: '.anvil' }]);

    const result = await syncAnvilToWorktree('/worktree/path');

    expect(result).toBe(true);
    expect(copyWorktreeFilesSpy).toHaveBeenCalledWith(
      expect.stringMatching(/canonical[/\\]repo$/),
      '/worktree/path',
      ['.anvil']
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalRepoPath: expect.stringMatching(/canonical[/\\]repo$/),
      }),
      'repo_config_load_failed_using_default'
    );
  });

  test('adds .anvil to copyFiles list when not specified', async () => {
    const canonicalMtime = new Date('2024-01-01T12:00:00Z');
    const worktreeMtime = new Date('2024-01-01T10:00:00Z');

    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');

    statSpy.mockImplementation((path: string) => {
      const p = normPath(path);
      if (p === '/canonical/repo/.anvil') {
        return Promise.resolve({ mtime: canonicalMtime } as Stats);
      }
      if (p === '/worktree/path/.anvil') {
        return Promise.resolve({ mtime: worktreeMtime } as Stats);
      }
      return Promise.reject(new Error('Unexpected path'));
    });

    loadRepoConfigSpy.mockResolvedValue({
      worktree: { copyFiles: ['.env', '.vscode'] }, // No .anvil
    });

    copyWorktreeFilesSpy.mockResolvedValue([{ source: '.anvil', destination: '.anvil' }]);

    const result = await syncAnvilToWorktree('/worktree/path');

    expect(result).toBe(true);
    // .anvil is prepended to preserve user's copyFiles while ensuring .anvil is synced
    expect(copyWorktreeFilesSpy).toHaveBeenCalledWith(
      expect.stringMatching(/canonical[/\\]repo$/),
      '/worktree/path',
      ['.anvil', '.env', '.vscode']
    );
  });

  test('handles sync errors gracefully without throwing', async () => {
    const canonicalMtime = new Date('2024-01-01T12:00:00Z');
    const worktreeMtime = new Date('2024-01-01T10:00:00Z');

    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');

    statSpy.mockImplementation((path: string) => {
      const p = normPath(path);
      if (p === '/canonical/repo/.anvil') {
        return Promise.resolve({ mtime: canonicalMtime } as Stats);
      }
      if (p === '/worktree/path/.anvil') {
        return Promise.resolve({ mtime: worktreeMtime } as Stats);
      }
      return Promise.reject(new Error('Unexpected path'));
    });

    loadRepoConfigSpy.mockResolvedValue({
      worktree: { copyFiles: ['.anvil'] },
    });

    copyWorktreeFilesSpy.mockRejectedValue(new Error('Permission denied'));

    const result = await syncAnvilToWorktree('/worktree/path');

    expect(result).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: '/worktree/path',
        errorName: 'Error',
        code: 'UNKNOWN',
      }),
      'anvil_sync_failed'
    );
  });

  test('handles getCanonicalRepoPath errors gracefully', async () => {
    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockRejectedValue(new Error('Failed to read .git file'));

    const result = await syncAnvilToWorktree('/worktree/path');

    expect(result).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: '/worktree/path',
        errorName: 'Error',
        code: 'UNKNOWN',
      }),
      'anvil_sync_failed'
    );
  });
});
