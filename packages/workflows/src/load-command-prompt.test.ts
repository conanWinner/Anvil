import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { symlink as fsSymlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as realPaths from '@anvil/paths';

// Mock only the logger so test output stays clean. All other @anvil/paths
// exports (findMarkdownFilesRecursive, getHomeCommandsPath, etc.) use real
// implementations — loadCommandPrompt exercises them against a tmp dir set
// via ANVIL_HOME below.
const mockLogFn = mock(() => {});
const mockLogger = {
  info: mockLogFn,
  warn: mockLogFn,
  error: mockLogFn,
  debug: mockLogFn,
  trace: mockLogFn,
  fatal: mockLogFn,
  child: mock(() => mockLogger),
  bindings: mock(() => ({ module: 'test' })),
  isLevelEnabled: mock(() => true),
  level: 'info',
};
mock.module('@anvil/paths', () => ({
  ...realPaths,
  createLogger: mock(() => mockLogger),
}));

import { loadCommandPrompt } from './executor-shared';
import type { WorkflowDeps } from './deps';

// Minimal deps stub — loadCommandPrompt only calls loadConfig.
function makeDeps(loadDefaultCommands = true): WorkflowDeps {
  return {
    loadConfig: async () => ({ defaults: { loadDefaultCommands } }),
  } as unknown as WorkflowDeps;
}

describe('loadCommandPrompt — home-scope resolution', () => {
  let anvilHome: string;
  let repoRoot: string;
  let prevAnvilHome: string | undefined;

  beforeEach(() => {
    prevAnvilHome = process.env.ANVIL_HOME;
    // Separate tmp dirs for home and repo so they don't collide.
    anvilHome = mkdtempSync(join(tmpdir(), 'anvil-home-'));
    repoRoot = mkdtempSync(join(tmpdir(), 'anvil-repo-'));
    process.env.ANVIL_HOME = anvilHome;
    mkdirSync(join(anvilHome, 'commands'), { recursive: true });
    mkdirSync(join(repoRoot, '.anvil', 'commands'), { recursive: true });
  });

  afterEach(() => {
    if (prevAnvilHome === undefined) delete process.env.ANVIL_HOME;
    else process.env.ANVIL_HOME = prevAnvilHome;
    rmSync(anvilHome, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('resolves a command from ~/.anvil/commands/ when repo has none', async () => {
    writeFileSync(join(anvilHome, 'commands', 'personal-helper.md'), 'Personal helper body');

    const result = await loadCommandPrompt(makeDeps(false), repoRoot, 'personal-helper');

    expect(result.success).toBe(true);
    if (result.success) expect(result.content).toBe('Personal helper body');
  });

  it('resolves a symlinked home command and reads target content', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'anvil-command-source-'));
    try {
      writeFileSync(join(sourceDir, 'linked.md'), 'Linked body');
      await fsSymlink(join(sourceDir, 'linked.md'), join(anvilHome, 'commands', 'linked.md'));

      const result = await loadCommandPrompt(makeDeps(false), repoRoot, 'linked');

      expect(result.success).toBe(true);
      if (result.success) expect(result.content).toBe('Linked body');
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('repo command shadows home command with the same name', async () => {
    writeFileSync(join(anvilHome, 'commands', 'shared.md'), 'HOME version');
    writeFileSync(join(repoRoot, '.anvil', 'commands', 'shared.md'), 'REPO version');

    const result = await loadCommandPrompt(makeDeps(false), repoRoot, 'shared');

    expect(result.success).toBe(true);
    if (result.success) expect(result.content).toBe('REPO version');
  });

  it('resolves a home command inside a 1-level subfolder by basename', async () => {
    mkdirSync(join(anvilHome, 'commands', 'triage'), { recursive: true });
    writeFileSync(join(anvilHome, 'commands', 'triage', 'review.md'), 'Review body');

    const result = await loadCommandPrompt(makeDeps(false), repoRoot, 'review');

    expect(result.success).toBe(true);
    if (result.success) expect(result.content).toBe('Review body');
  });

  it('does NOT resolve home commands buried >1 level deep', async () => {
    mkdirSync(join(anvilHome, 'commands', 'a', 'b'), { recursive: true });
    writeFileSync(join(anvilHome, 'commands', 'a', 'b', 'too-deep.md'), 'too deep');

    const result = await loadCommandPrompt(makeDeps(false), repoRoot, 'too-deep');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('not_found');
  });

  it('returns not_found when neither repo nor home has the command (defaults off)', async () => {
    const result = await loadCommandPrompt(makeDeps(false), repoRoot, 'missing');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('not_found');
  });

  it('surfaces empty_file for a zero-byte home command', async () => {
    writeFileSync(join(anvilHome, 'commands', 'blank.md'), '');

    const result = await loadCommandPrompt(makeDeps(false), repoRoot, 'blank');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('empty_file');
  });
});
