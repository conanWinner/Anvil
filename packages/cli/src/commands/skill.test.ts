/**
 * Tests for skill install command
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BUNDLED_MANAGE_RUN_SKILL_FILES, BUNDLED_SKILL_FILES } from '../bundled-skill';
import { copyAnvilSkill, skillInstallCommand } from './skill';

describe('copyAnvilSkill', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'anvil-skill-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes every bundled skill file under .claude/skills/anvil/', async () => {
    await copyAnvilSkill(tempDir);

    const skillRoot = join(tempDir, '.claude', 'skills', 'anvil');
    for (const [relativePath, content] of Object.entries(BUNDLED_SKILL_FILES)) {
      const dest = join(skillRoot, relativePath);
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, 'utf-8')).toBe(content);
    }
  });

  it('writes every bundled skill file under .agents/skills/anvil/ (Codex path)', async () => {
    await copyAnvilSkill(tempDir);

    const skillRoot = join(tempDir, '.agents', 'skills', 'anvil');
    for (const [relativePath, content] of Object.entries(BUNDLED_SKILL_FILES)) {
      const dest = join(skillRoot, relativePath);
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, 'utf-8')).toBe(content);
    }
  });

  it('writes every bundled manage-run skill file under .agents/skills/manage-run/ (Codex path)', async () => {
    await copyAnvilSkill(tempDir);

    const skillRoot = join(tempDir, '.agents', 'skills', 'manage-run');
    for (const [relativePath, content] of Object.entries(BUNDLED_MANAGE_RUN_SKILL_FILES)) {
      const dest = join(skillRoot, relativePath);
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, 'utf-8')).toBe(content);
    }
  });

  it('overwrites pre-existing skill files with bundled content', async () => {
    const skillRoot = join(tempDir, '.claude', 'skills', 'anvil');
    const skillMdPath = join(skillRoot, 'SKILL.md');

    // Pre-seed with stale content; copyAnvilSkill must overwrite it.
    await copyAnvilSkill(tempDir);
    writeFileSync(skillMdPath, 'STALE');
    expect(readFileSync(skillMdPath, 'utf-8')).toBe('STALE');

    await copyAnvilSkill(tempDir);
    expect(readFileSync(skillMdPath, 'utf-8')).toBe(BUNDLED_SKILL_FILES['SKILL.md']);
  });
});

describe('skillInstallCommand', () => {
  let tempDir: string;
  let logSpy: ReturnType<typeof spyOn>;
  let errSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'anvil-skill-cmd-test-'));
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    errSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('returns 0 and installs the skill into the target directory', async () => {
    const exitCode = await skillInstallCommand(tempDir);

    expect(exitCode).toBe(0);
    expect(existsSync(join(tempDir, '.claude', 'skills', 'anvil', 'SKILL.md'))).toBe(true);
    // Also installs into the Codex path
    expect(existsSync(join(tempDir, '.agents', 'skills', 'anvil', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tempDir, '.agents', 'skills', 'manage-run', 'SKILL.md'))).toBe(true);
    // Final log line should mention restarting both Claude Code and Codex
    const lastLog = logSpy.mock.calls.at(-1)?.[0] as string | undefined;
    expect(lastLog).toContain('Restart Claude Code or Codex');
  });

  it('returns 1 and prints an error when the target directory does not exist', async () => {
    const missing = join(tempDir, 'does-not-exist');
    const exitCode = await skillInstallCommand(missing);

    expect(exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalled();
    const firstError = errSpy.mock.calls[0][0] as string;
    expect(firstError).toContain('Directory does not exist');
    // Nothing should have been written to either path
    expect(existsSync(join(missing, '.claude'))).toBe(false);
    expect(existsSync(join(missing, '.agents'))).toBe(false);
  });
});
