import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ConversationLockManager } from '@anvil/core';
import type { WebAdapter } from '../adapters/web';
import { validationErrorHook } from './openapi-defaults';
import { mockAllWorkflowModules } from '../test/workflow-mock-factories';

// ---------------------------------------------------------------------------
// Mock setup — must be declared before any dynamic imports of mocked modules
// ---------------------------------------------------------------------------

const mockGetCodebase = mock(
  async (_id: string) =>
    null as null | {
      id: string;
      name: string;
      repository_url: string | null;
      default_cwd: string;
      ai_assistant_type: string;
      commands: Record<string, unknown> | string;
      created_at: string;
      updated_at: string;
    }
);
const mockListCodebases = mock(async () => [] as (typeof MOCK_CODEBASE)[]);
const mockDeleteCodebase = mock(async (_id: string) => {});
const mockCloneRepository = mock(async (_url: string) => ({
  codebaseId: 'clone-uuid-1',
  alreadyExisted: false,
}));
const mockCreateRepository = mock(async (_name: string) => ({
  codebaseId: 'create-uuid-1',
  alreadyExisted: false,
}));
const mockRegisterRepository = mock(async (_path: string) => ({
  codebaseId: 'register-uuid-1',
  alreadyExisted: false,
}));
const mockListByCodebase = mock(async (_id: string) => [] as unknown[]);
const mockRemoveWorktree = mock(async () => {});
const mockUpdateStatus = mock(async (_id: string, _status: string) => {});
const intakeRoot = await mkdtemp(join(tmpdir(), 'anvil-api-intakes-'));
const mockFindConversationByPlatformId = mock(
  async (_id: string) => null as MockConversation | null
);
const mockAddMessage = mock(async () => ({
  id: 'msg-1',
  conversation_id: 'conversation-db-1',
  role: 'user',
  content: 'intake',
  metadata: '{}',
  created_at: new Date().toISOString(),
}));
const mockGetActiveIntakeDraft = mock(async () => null as MockIntakeDraft | null);
const mockUpdateIntakeDraft = mock(
  async (_id: string, update: Partial<MockIntakeDraft>) =>
    null as MockIntakeDraft | null | Promise<MockIntakeDraft | null>
);
const mockFindOrCreateUser = mock(async () => ({
  id: 'local-web-user',
  display_name: 'Local Web',
  email: null,
  role: 'admin' as const,
  created_at: new Date(),
  updated_at: new Date(),
}));

mock.module('@anvil/core', () => ({
  handleMessage: mock(async () => {}),
  getDatabaseType: () => 'sqlite',
  loadConfig: mock(async () => ({})),
  cloneRepository: mockCloneRepository,
  createRepository: mockCreateRepository,
  registerRepository: mockRegisterRepository,
  ConversationNotFoundError: class ConversationNotFoundError extends Error {
    constructor(id: string) {
      super(`Conversation not found: ${id}`);
      this.name = 'ConversationNotFoundError';
    }
  },
  getAnvilWorkspacesPath: () => '/tmp/.anvil/workspaces',
  getWorkflowIntakesPath: () => intakeRoot,
  generateAndSetTitle: mock(async () => {}),
  createLogger: () => ({
    fatal: mock(() => undefined),
    error: mock(() => undefined),
    warn: mock(() => undefined),
    info: mock(() => undefined),
    debug: mock(() => undefined),
    trace: mock(() => undefined),
    child: mock(function (this: unknown) {
      return this;
    }),
    bindings: mock(() => ({ module: 'test' })),
    isLevelEnabled: mock(() => true),
    level: 'info',
  }),
}));

mock.module('@anvil/paths', () => ({
  createLogger: () => ({
    fatal: mock(() => undefined),
    error: mock(() => undefined),
    warn: mock(() => undefined),
    info: mock(() => undefined),
    debug: mock(() => undefined),
    trace: mock(() => undefined),
    child: mock(function (this: unknown) {
      return this;
    }),
    bindings: mock(() => ({ module: 'test' })),
    isLevelEnabled: mock(() => true),
    level: 'info',
  }),
  getWorkflowFolderSearchPaths: mock(() => ['.anvil/workflows']),
  getCommandFolderSearchPaths: mock(() => ['.anvil/commands']),
  getDefaultCommandsPath: mock(() => '/tmp/.anvil-test-nonexistent/commands/defaults'),
  getDefaultWorkflowsPath: mock(() => '/tmp/.anvil-test-nonexistent/workflows/defaults'),
  getWorkflowIntakesPath: () => intakeRoot,
  getAnvilWorkspacesPath: () => '/tmp/.anvil/workspaces',
  resolveProjectRootFromCwd: (cwd: string) => {
    const match = /^\/tmp\/\.anvil\/workspaces\/([^/]+)\/([^/]+)/.exec(cwd);
    return match ? `/tmp/.anvil/workspaces/${match[1]}/${match[2]}` : null;
  },
  resolveRegisteredProjectRoot: (name: string, cwd: string) => {
    const match = /^\/tmp\/\.anvil\/workspaces\/([^/]+)\/([^/]+)/.exec(cwd);
    return match
      ? `/tmp/.anvil/workspaces/${match[1]}/${match[2]}`
      : `/tmp/.anvil/workspaces/_local/${name}`;
  },
}));

mockAllWorkflowModules();

mock.module('@anvil/workflows/workflow-discovery', () => ({
  discoverWorkflowsWithConfig: mock(async () => ({
    workflows: [
      {
        filename: '/tmp/project/.anvil/workflows/intake-demo.yaml',
        source: 'project',
        workflow: {
          name: 'intake-demo',
          description: 'Intake upload test',
          input_schema: {
            type: 'object',
            properties: { blueprint: { type: 'object' }, dataset: { type: 'object' } },
            required: ['blueprint', 'dataset'],
          },
          intake: {
            version: 1,
            title: 'Prepare test',
            fields: [
              { input: 'blueprint', control: 'file', prompt: 'Blueprint?' },
              { input: 'dataset', control: 'dataset', prompt: 'Dataset?' },
            ],
          },
          nodes: [],
        },
      },
    ],
    errors: [],
  })),
}));

mock.module('@anvil/git', () => ({
  removeWorktree: mockRemoveWorktree,
  toRepoPath: (p: string) => p,
  toWorktreePath: (p: string) => p,
}));

mock.module('@anvil/core/db/conversations', () => ({
  findConversationByPlatformId: mockFindConversationByPlatformId,
  listConversations: mock(async () => []),
  getOrCreateConversation: mock(async () => ({
    id: 'internal-uuid-123',
    platform_conversation_id: 'web-test-abc',
    title: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    platform_type: 'web',
    deleted_at: null,
    codebase_id: null,
  })),
  softDeleteConversation: mock(async () => {}),
  updateConversationTitle: mock(async () => {}),
  getConversationById: mock(async () => null),
}));

mock.module('@anvil/core/db/users', () => ({
  findOrCreateUserByPlatformIdentity: mockFindOrCreateUser,
}));

mock.module('@anvil/core/db/codebases', () => ({
  listCodebases: mockListCodebases,
  getCodebase: mockGetCodebase,
  deleteCodebase: mockDeleteCodebase,
}));

mock.module('@anvil/core/db/isolation-environments', () => ({
  listByCodebase: mockListByCodebase,
  updateStatus: mockUpdateStatus,
}));

mock.module('@anvil/core/db/workflows', () => ({
  listWorkflowRuns: mock(async () => []),
  listDashboardRuns: mock(async () => ({
    runs: [],
    total: 0,
    counts: { all: 0, running: 0, completed: 0, failed: 0, cancelled: 0, pending: 0 },
  })),
  getWorkflowRun: mock(async () => null),
  cancelWorkflowRun: mock(async () => {}),
  getWorkflowRunByWorkerPlatformId: mock(async () => null),
}));

mock.module('@anvil/core/db/workflow-events', () => ({
  listWorkflowEvents: mock(async () => []),
}));

mock.module('@anvil/core/db/messages', () => ({
  addMessage: mockAddMessage,
  listMessages: mock(async () => []),
}));

mock.module('@anvil/core/db/workflow-intakes', () => ({
  getActiveWorkflowIntakeDraft: mockGetActiveIntakeDraft,
  getLatestWorkflowIntakeDraft: mock(async () => null),
  createWorkflowIntakeDraft: mock(async () => {
    throw new Error('not expected');
  }),
  updateWorkflowIntakeDraft: mockUpdateIntakeDraft,
  claimWorkflowIntakeDraftStart: mock(async () => false),
  discardWorkflowIntakeDraft: mock(async () => {}),
}));

mock.module('@anvil/core/utils/commands', () => ({
  findMarkdownFilesRecursive: mock(async () => []),
}));

// Import the module under test AFTER all mock.module() calls
import { registerApiRoutes } from './api';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_CODEBASE = {
  id: 'codebase-uuid-1',
  name: 'my-project',
  repository_url: 'https://github.com/user/repo',
  default_cwd: '/home/user/projects/my-project',
  ai_assistant_type: 'claude',
  commands: {},
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const MOCK_CODEBASE_WITH_STRING_COMMANDS = {
  ...MOCK_CODEBASE,
  id: 'codebase-uuid-2',
  commands: '{"plan":{"path":"/cmds/plan.md","description":"Plan"}}',
};

const MOCK_ENV = {
  id: 'env-uuid-1',
  codebase_id: 'codebase-uuid-1',
  working_path: '/tmp/worktrees/feature-branch',
  status: 'active',
  workflow_type: 'implement',
  workflow_id: 'wf-1',
  branch_name: 'feature-branch',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

interface MockConversation {
  id: string;
  codebase_id: string | null;
}

interface MockIntakeDraft {
  id: string;
  codebase_id: string;
  workflow_name: string;
  definition_hash: string;
  status: 'draft' | 'ready' | 'starting' | 'started' | 'discarded';
  values: Record<string, unknown>;
  current_field: string | null;
  validation_errors: string[];
  started_run_id: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

afterAll(async () => {
  await rm(intakeRoot, { recursive: true, force: true });
});

function makeApp(): OpenAPIHono {
  const app = new OpenAPIHono({ defaultHook: validationErrorHook });
  const mockWebAdapter = {
    setConversationDbId: mock((_platformId: string, _dbId: string) => {}),
    emitSSE: mock(async () => {}),
    emitLockEvent: mock(async () => {}),
  } as unknown as WebAdapter;
  const mockLockManager = {
    acquireLock: mock(async (_id: string, fn: () => Promise<void>) => {
      await fn();
      return { status: 'started' };
    }),
    getStats: mock(() => ({ active: 0, queued: 0 })),
  } as unknown as ConversationLockManager;
  registerApiRoutes(app, mockWebAdapter, mockLockManager);
  return app;
}

// ---------------------------------------------------------------------------
// Tests: GET /api/codebases
// ---------------------------------------------------------------------------

describe('GET /api/codebases', () => {
  beforeEach(() => {
    mockListCodebases.mockReset();
  });

  test('returns empty array when no codebases exist', async () => {
    mockListCodebases.mockImplementationOnce(async () => []);

    const app = makeApp();
    const response = await app.request('/api/codebases');
    expect(response.status).toBe(200);

    const body = (await response.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  test('returns list of codebases sorted by name', async () => {
    mockListCodebases.mockImplementationOnce(async () => [
      { ...MOCK_CODEBASE, id: 'b', name: 'zebra-project', repository_url: null },
      { ...MOCK_CODEBASE, id: 'a', name: 'alpha-project', repository_url: null },
    ]);

    const app = makeApp();
    const response = await app.request('/api/codebases');
    expect(response.status).toBe(200);

    const body = (await response.json()) as Array<{ name: string }>;
    expect(body[0]?.name).toBe('alpha-project');
    expect(body[1]?.name).toBe('zebra-project');
  });

  test('deduplicates by repository_url (keeps most recently updated)', async () => {
    const older = {
      ...MOCK_CODEBASE,
      id: 'older',
      name: 'my-project',
      repository_url: 'https://github.com/user/repo',
      updated_at: '2024-01-01T00:00:00Z',
    };
    const newer = {
      ...MOCK_CODEBASE,
      id: 'newer',
      name: 'my-project',
      repository_url: 'https://github.com/user/repo.git',
      updated_at: '2024-06-01T00:00:00Z',
    };
    mockListCodebases.mockImplementationOnce(async () => [older, newer]);

    const app = makeApp();
    const response = await app.request('/api/codebases');
    expect(response.status).toBe(200);

    const body = (await response.json()) as Array<{ id: string }>;
    // Only one entry should survive dedup (the newer one)
    expect(body.length).toBe(1);
    expect(body[0]?.id).toBe('newer');
  });

  test('parses commands when stored as JSON string', async () => {
    mockListCodebases.mockImplementationOnce(async () => [MOCK_CODEBASE_WITH_STRING_COMMANDS]);

    const app = makeApp();
    const response = await app.request('/api/codebases');
    expect(response.status).toBe(200);

    const body = (await response.json()) as Array<{ commands: unknown }>;
    // Should be parsed object, not a string
    expect(typeof body[0]?.commands).toBe('object');
    expect(body[0]?.commands).not.toBeNull();
  });

  test('returns 500 when DB throws', async () => {
    mockListCodebases.mockImplementationOnce(async () => {
      throw new Error('DB unavailable');
    });

    const app = makeApp();
    const response = await app.request('/api/codebases');
    expect(response.status).toBe(500);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Failed to list codebases');
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/codebases/:id
// ---------------------------------------------------------------------------

describe('GET /api/codebases/:id', () => {
  beforeEach(() => {
    mockGetCodebase.mockReset();
  });

  test('returns codebase when found', async () => {
    mockGetCodebase.mockImplementationOnce(async () => MOCK_CODEBASE);

    const app = makeApp();
    const response = await app.request('/api/codebases/codebase-uuid-1');
    expect(response.status).toBe(200);

    const body = (await response.json()) as { id: string; name: string };
    expect(body.id).toBe('codebase-uuid-1');
    expect(body.name).toBe('my-project');
  });

  test('returns 404 when codebase not found', async () => {
    mockGetCodebase.mockImplementationOnce(async () => null);

    const app = makeApp();
    const response = await app.request('/api/codebases/unknown-id');
    expect(response.status).toBe(404);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('not found');
  });

  test('parses commands when stored as JSON string', async () => {
    mockGetCodebase.mockImplementationOnce(async () => MOCK_CODEBASE_WITH_STRING_COMMANDS);

    const app = makeApp();
    const response = await app.request('/api/codebases/codebase-uuid-2');
    expect(response.status).toBe(200);

    const body = (await response.json()) as { commands: unknown };
    expect(typeof body.commands).toBe('object');
    expect(body.commands).not.toBeNull();
  });

  test('returns empty commands object when JSON is corrupted', async () => {
    mockGetCodebase.mockImplementationOnce(async () => ({
      ...MOCK_CODEBASE,
      commands: '{not valid json',
    }));

    const app = makeApp();
    const response = await app.request('/api/codebases/codebase-uuid-1');
    expect(response.status).toBe(200);

    const body = (await response.json()) as { commands: unknown };
    expect(body.commands).toEqual({});
  });

  test('returns 500 when DB throws', async () => {
    mockGetCodebase.mockImplementationOnce(async () => {
      throw new Error('Connection error');
    });

    const app = makeApp();
    const response = await app.request('/api/codebases/any-id');
    expect(response.status).toBe(500);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Failed to get codebase');
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/codebases
// ---------------------------------------------------------------------------

describe('POST /api/codebases', () => {
  beforeEach(() => {
    mockGetCodebase.mockReset();
    mockCloneRepository.mockReset();
    mockCreateRepository.mockReset();
    mockRegisterRepository.mockReset();
  });

  test('registers codebase by URL and returns 201', async () => {
    mockCloneRepository.mockImplementationOnce(async () => ({
      codebaseId: 'clone-uuid-1',
      alreadyExisted: false,
    }));
    mockGetCodebase.mockImplementationOnce(async () => MOCK_CODEBASE);

    const app = makeApp();
    const response = await app.request('/api/codebases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://github.com/user/repo' }),
    });
    expect(response.status).toBe(201);

    const body = (await response.json()) as { id: string };
    expect(body.id).toBe('codebase-uuid-1');
    expect(mockCloneRepository).toHaveBeenCalledWith('https://github.com/user/repo');
  });

  test('registers existing URL codebase with 200', async () => {
    mockCloneRepository.mockImplementationOnce(async () => ({
      codebaseId: 'clone-uuid-1',
      alreadyExisted: true,
    }));
    mockGetCodebase.mockImplementationOnce(async () => MOCK_CODEBASE);

    const app = makeApp();
    const response = await app.request('/api/codebases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://github.com/user/repo' }),
    });
    expect(response.status).toBe(200);
  });

  test('registers codebase by local path and returns 201', async () => {
    mockRegisterRepository.mockImplementationOnce(async () => ({
      codebaseId: 'register-uuid-1',
      alreadyExisted: false,
    }));
    mockGetCodebase.mockImplementationOnce(async () => ({
      ...MOCK_CODEBASE,
      id: 'register-uuid-1',
      repository_url: null,
    }));

    const app = makeApp();
    const response = await app.request('/api/codebases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/home/user/my-repo' }),
    });
    expect(response.status).toBe(201);
    expect(mockRegisterRepository).toHaveBeenCalledWith('/home/user/my-repo');
  });

  test('creates a managed local project and returns 201', async () => {
    mockCreateRepository.mockImplementationOnce(async () => ({
      codebaseId: 'create-uuid-1',
      alreadyExisted: false,
    }));
    mockGetCodebase.mockImplementationOnce(async () => ({
      ...MOCK_CODEBASE,
      id: 'create-uuid-1',
      name: 'new-project',
      repository_url: null,
      default_cwd: '/tmp/.anvil/workspaces/_local/new-project/source',
    }));

    const app = makeApp();
    const response = await app.request('/api/codebases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ create: { name: 'new-project' } }),
    });

    expect(response.status).toBe(201);
    expect(mockCreateRepository).toHaveBeenCalledWith('new-project');
  });

  test('returns 400 for an unsafe managed project name', async () => {
    const app = makeApp();
    const response = await app.request('/api/codebases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ create: { name: '../outside' } }),
    });

    expect(response.status).toBe(400);
    expect(mockCreateRepository).not.toHaveBeenCalled();
  });

  test('returns 400 when both url and path are provided', async () => {
    const app = makeApp();
    const response = await app.request('/api/codebases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://github.com/x/y', path: '/local/path' }),
    });
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('url');
    expect(body.error).toContain('path');
  });

  test('returns 400 when neither url nor path are provided', async () => {
    const app = makeApp();
    const response = await app.request('/api/codebases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('url');
  });

  test('returns 400 for malformed JSON body', async () => {
    const app = makeApp();
    const response = await app.request('/api/codebases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    });
    expect(response.status).toBe(400);
  });

  test('returns 500 when codebase record not found after creation', async () => {
    mockCloneRepository.mockImplementationOnce(async () => ({
      codebaseId: 'clone-uuid-1',
      alreadyExisted: false,
    }));
    mockGetCodebase.mockImplementationOnce(async () => null);

    const app = makeApp();
    const response = await app.request('/api/codebases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://github.com/user/repo' }),
    });
    expect(response.status).toBe(500);
  });

  test('returns 500 when clone throws an error', async () => {
    mockCloneRepository.mockImplementationOnce(async () => {
      throw new Error('git clone failed: authentication required');
    });

    const app = makeApp();
    const response = await app.request('/api/codebases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://github.com/private/repo' }),
    });
    expect(response.status).toBe(500);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('authentication required');
  });
});

// ---------------------------------------------------------------------------
// Tests: DELETE /api/codebases/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/codebases/:id', () => {
  beforeEach(() => {
    mockGetCodebase.mockReset();
    mockDeleteCodebase.mockReset();
    mockListByCodebase.mockReset();
    mockRemoveWorktree.mockReset();
    mockUpdateStatus.mockReset();
  });

  test('deletes codebase with no isolation environments and returns success', async () => {
    mockGetCodebase.mockImplementationOnce(async () => MOCK_CODEBASE);
    mockListByCodebase.mockImplementationOnce(async () => []);
    mockDeleteCodebase.mockImplementationOnce(async () => {});

    const app = makeApp();
    const response = await app.request('/api/codebases/codebase-uuid-1', { method: 'DELETE' });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(mockDeleteCodebase).toHaveBeenCalledWith('codebase-uuid-1');
  });

  test('removes worktrees before deleting codebase', async () => {
    mockGetCodebase.mockImplementationOnce(async () => MOCK_CODEBASE);
    mockListByCodebase.mockImplementationOnce(async () => [MOCK_ENV]);
    mockRemoveWorktree.mockImplementationOnce(async () => {});
    mockUpdateStatus.mockImplementationOnce(async () => {});
    mockDeleteCodebase.mockImplementationOnce(async () => {});

    const app = makeApp();
    const response = await app.request('/api/codebases/codebase-uuid-1', { method: 'DELETE' });
    expect(response.status).toBe(200);

    // Worktree removal and status update should have been called
    expect(mockRemoveWorktree).toHaveBeenCalled();
    expect(mockUpdateStatus).toHaveBeenCalledWith('env-uuid-1', 'destroyed');
  });

  test('continues deletion even if worktree removal fails', async () => {
    mockGetCodebase.mockImplementationOnce(async () => MOCK_CODEBASE);
    mockListByCodebase.mockImplementationOnce(async () => [MOCK_ENV]);
    mockRemoveWorktree.mockImplementationOnce(async () => {
      throw new Error('worktree already gone');
    });
    mockUpdateStatus.mockImplementationOnce(async () => {});
    mockDeleteCodebase.mockImplementationOnce(async () => {});

    const app = makeApp();
    const response = await app.request('/api/codebases/codebase-uuid-1', { method: 'DELETE' });
    // Should still succeed — worktree removal failure is logged and skipped
    expect(response.status).toBe(200);

    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(mockDeleteCodebase).toHaveBeenCalled();
  });

  test('returns 404 when codebase not found', async () => {
    mockGetCodebase.mockImplementationOnce(async () => null);

    const app = makeApp();
    const response = await app.request('/api/codebases/unknown-id', { method: 'DELETE' });
    expect(response.status).toBe(404);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('not found');
  });

  test('does not delete disk directory for external (non-Anvil-managed) repos', async () => {
    // The codebase's default_cwd is outside the Anvil workspaces root
    mockGetCodebase.mockImplementationOnce(async () => ({
      ...MOCK_CODEBASE,
      default_cwd: '/home/user/my-external-repo',
    }));
    mockListByCodebase.mockImplementationOnce(async () => []);
    mockDeleteCodebase.mockImplementationOnce(async () => {});

    const app = makeApp();
    const response = await app.request('/api/codebases/codebase-uuid-1', { method: 'DELETE' });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  test('returns 500 when DB delete throws', async () => {
    mockGetCodebase.mockImplementationOnce(async () => MOCK_CODEBASE);
    mockListByCodebase.mockImplementationOnce(async () => []);
    mockDeleteCodebase.mockImplementationOnce(async () => {
      throw new Error('FK constraint violation');
    });

    const app = makeApp();
    const response = await app.request('/api/codebases/codebase-uuid-1', { method: 'DELETE' });
    expect(response.status).toBe(500);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Failed to delete codebase');
  });
});

describe('POST /api/codebases/:id/workflow-intakes/:workflowName/attachments', () => {
  beforeEach(() => {
    mockGetCodebase.mockReset();
    mockFindConversationByPlatformId.mockReset();
    mockGetActiveIntakeDraft.mockReset();
    mockUpdateIntakeDraft.mockReset();
    mockAddMessage.mockClear();
  });

  test('stores an external Blueprint and advances the persisted draft to Dataset', async () => {
    const now = new Date().toISOString();
    const draft: MockIntakeDraft = {
      id: 'draft-uuid-1',
      codebase_id: 'codebase-uuid-1',
      workflow_name: 'intake-demo',
      definition_hash: 'definition-hash',
      status: 'draft',
      values: {},
      current_field: 'blueprint',
      validation_errors: ['Thiếu đầu vào bắt buộc: blueprint'],
      started_run_id: null,
      created_by_user_id: null,
      updated_by_user_id: null,
      created_at: now,
      updated_at: now,
    };
    mockGetCodebase.mockImplementation(async () => MOCK_CODEBASE);
    mockFindConversationByPlatformId.mockImplementation(async () => ({
      id: 'conversation-db-1',
      codebase_id: 'codebase-uuid-1',
    }));
    mockGetActiveIntakeDraft.mockImplementation(async () => draft);
    mockUpdateIntakeDraft.mockImplementation(async (_id, update) => ({
      ...draft,
      ...update,
      updated_at: new Date().toISOString(),
    }));

    const form = new FormData();
    form.append('conversationId', 'web-conversation-1');
    form.append('files', new File(['# System 2 Blueprint\n'], 'outside-blueprint.md'));

    const response = await makeApp().request(
      '/api/codebases/codebase-uuid-1/workflow-intakes/intake-demo/attachments',
      { method: 'POST', body: form }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      state: string;
      draft: { currentField: string; values: Record<string, unknown> };
      attachment: { path: string; name: string; sha256: string };
    };
    expect(body.state).toBe('collecting');
    expect(body.draft.currentField).toBe('dataset');
    expect(body.attachment.name).toBe('outside-blueprint.md');
    expect(body.attachment.path).toContain(join('codebase-uuid-1', 'draft-uuid-1'));
    expect(await readFile(body.attachment.path, 'utf8')).toBe('# System 2 Blueprint\n');
    expect(body.attachment.sha256).toHaveLength(64);
    expect(mockUpdateIntakeDraft).toHaveBeenCalledTimes(1);
    expect(mockAddMessage).toHaveBeenCalledTimes(2);
    await rm(dirname(dirname(body.attachment.path)), { recursive: true, force: true });
  });
});
