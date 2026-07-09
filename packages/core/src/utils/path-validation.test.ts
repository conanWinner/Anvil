/**
 * Unit tests for path validation utilities
 *
 * NOTE: These tests use dynamic imports and module cache clearing
 * to test different WORKSPACE_PATH configurations.
 */

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { resolve, join } from 'path';
import { homedir } from 'os';

// Helper to import fresh module with cleared cache
async function importFresh() {
  // Clear the module from cache by deleting it from Loader registry
  const modulePath = require.resolve('./path-validation');
  const anvilPathsModulePath = require.resolve('@anvil/paths');
  delete require.cache[modulePath];
  delete require.cache[anvilPathsModulePath];
  return import('./path-validation');
}

// Default anvil workspaces path
function getDefaultWorkspacesPath(): string {
  return join(homedir(), '.anvil', 'workspaces');
}

describe('path-validation', () => {
  const originalWorkspacePath = process.env.WORKSPACE_PATH;
  const originalAnvilHome = process.env.ANVIL_HOME;
  const originalAnvilDocker = process.env.ANVIL_DOCKER;
  const originalHome = process.env.HOME;

  function restoreHome(): void {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
  }

  beforeEach(() => {
    // Reset to default for consistent test behavior (clear Docker detection too)
    delete process.env.WORKSPACE_PATH;
    delete process.env.ANVIL_HOME;
    delete process.env.ANVIL_DOCKER;
    restoreHome();
  });

  afterAll(() => {
    // Restore original env vars
    if (originalWorkspacePath !== undefined) {
      process.env.WORKSPACE_PATH = originalWorkspacePath;
    } else {
      delete process.env.WORKSPACE_PATH;
    }
    if (originalAnvilHome !== undefined) {
      process.env.ANVIL_HOME = originalAnvilHome;
    } else {
      delete process.env.ANVIL_HOME;
    }
    if (originalAnvilDocker !== undefined) {
      process.env.ANVIL_DOCKER = originalAnvilDocker;
    } else {
      delete process.env.ANVIL_DOCKER;
    }
    restoreHome();
  });

  describe('isPathWithinWorkspace', () => {
    test('should allow paths within default anvil workspaces', async () => {
      const { isPathWithinWorkspace } = await importFresh();
      const defaultPath = getDefaultWorkspacesPath();
      expect(isPathWithinWorkspace(`${defaultPath}/repo`)).toBe(true);
      expect(isPathWithinWorkspace(`${defaultPath}/repo/src`)).toBe(true);
      expect(isPathWithinWorkspace(defaultPath)).toBe(true);
    });

    test('should allow relative paths that resolve within workspace', async () => {
      const { isPathWithinWorkspace } = await importFresh();
      const defaultPath = getDefaultWorkspacesPath();
      expect(isPathWithinWorkspace('repo', defaultPath)).toBe(true);
      expect(isPathWithinWorkspace('./repo', defaultPath)).toBe(true);
      expect(isPathWithinWorkspace('repo/src/file.ts', defaultPath)).toBe(true);
    });

    test('should reject path traversal attempts', async () => {
      const { isPathWithinWorkspace } = await importFresh();
      const defaultPath = getDefaultWorkspacesPath();
      expect(isPathWithinWorkspace(`${defaultPath}/../etc/passwd`)).toBe(false);
      expect(isPathWithinWorkspace('../etc/passwd', defaultPath)).toBe(false);
      expect(isPathWithinWorkspace(`${defaultPath}/repo/../../etc/passwd`)).toBe(false);
      expect(isPathWithinWorkspace('foo/../../../etc/passwd', defaultPath)).toBe(false);
    });

    test('should reject paths outside workspace', async () => {
      const { isPathWithinWorkspace } = await importFresh();
      expect(isPathWithinWorkspace('/etc/passwd')).toBe(false);
      expect(isPathWithinWorkspace('/tmp/file')).toBe(false);
      expect(isPathWithinWorkspace('/var/log/syslog')).toBe(false);
    });

    test('should reject paths that look similar but are outside workspace', async () => {
      const { isPathWithinWorkspace } = await importFresh();
      const defaultPath = getDefaultWorkspacesPath();
      expect(isPathWithinWorkspace(`${defaultPath}-other`)).toBe(false);
    });

    test('should use ANVIL_HOME env var when set', async () => {
      process.env.ANVIL_HOME = '/custom/anvil';
      const { isPathWithinWorkspace } = await importFresh();
      expect(isPathWithinWorkspace('/custom/anvil/workspaces/repo')).toBe(true);
      const defaultPath = getDefaultWorkspacesPath();
      expect(isPathWithinWorkspace(`${defaultPath}/repo`)).toBe(false); // Default path now rejected
    });
  });

  describe('validateAndResolvePath', () => {
    test('should return resolved path for valid paths', async () => {
      const { validateAndResolvePath } = await importFresh();
      const defaultPath = getDefaultWorkspacesPath();
      expect(validateAndResolvePath(`${defaultPath}/repo`)).toBe(resolve(`${defaultPath}/repo`));
      expect(validateAndResolvePath('repo', defaultPath)).toBe(resolve(`${defaultPath}/repo`));
      expect(validateAndResolvePath('./src', `${defaultPath}/repo`)).toBe(
        resolve(`${defaultPath}/repo/src`)
      );
    });

    test('should throw for path traversal attempts', async () => {
      const { validateAndResolvePath } = await importFresh();
      const defaultPath = getDefaultWorkspacesPath();
      expect(() => validateAndResolvePath('../etc/passwd', defaultPath)).toThrow(
        `Path must be within ${defaultPath} directory`
      );
      expect(() => validateAndResolvePath(`${defaultPath}/../etc/passwd`)).toThrow(
        `Path must be within ${defaultPath} directory`
      );
    });

    test('should throw for paths outside workspace', async () => {
      const { validateAndResolvePath } = await importFresh();
      const defaultPath = getDefaultWorkspacesPath();
      expect(() => validateAndResolvePath('/etc/passwd')).toThrow(
        `Path must be within ${defaultPath} directory`
      );
      expect(() => validateAndResolvePath('/tmp/evil')).toThrow(
        `Path must be within ${defaultPath} directory`
      );
    });

    test('should use custom ANVIL_HOME for validation and error message', async () => {
      process.env.ANVIL_HOME = '/my/custom/anvil';
      const { validateAndResolvePath } = await importFresh();
      const customWorkspace = resolve('/my/custom/anvil/workspaces');
      // Valid path under custom workspace
      expect(validateAndResolvePath('/my/custom/anvil/workspaces/repo')).toBe(
        resolve('/my/custom/anvil/workspaces/repo')
      );
      // Path under default workspace should now throw with custom workspace in message
      const defaultPath = getDefaultWorkspacesPath();
      expect(() => validateAndResolvePath(`${defaultPath}/repo`)).toThrow(
        `Path must be within ${customWorkspace} directory`
      );
    });
  });
});
