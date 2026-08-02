/**
 * Tests for executeWorkflow() — the top-level orchestration function.
 * Covers concurrent-run guards, model/provider resolution, and resume logic
 * that the inner dag-executor.test.ts cannot reach.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';

// --- Mock logger ---
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
// Telemetry is fire-and-forget; mock as no-ops so the executor can call them.
// Hoisted so tests can assert on the completion call (outcome / exit reason).
const mockCaptureWorkflowInvoked = mock(() => {});
const mockCaptureWorkflowCompleted = mock(() => {});
mock.module('@anvil/paths', () => ({
  createLogger: mock(() => mockLogger),
  parseOwnerRepo: mock(() => null),
  resolveRegisteredProjectRoot: mock(() => null),
  getRunArtifactsPath: mock(() => '/tmp/artifacts'),
  getProjectLogsPath: mock(() => '/tmp/logs'),
  captureWorkflowInvoked: mockCaptureWorkflowInvoked,
  captureWorkflowCompleted: mockCaptureWorkflowCompleted,
}));

// --- Mock git ---
mock.module('@anvil/git', () => ({
  getDefaultBranch: mock(async () => 'main'),
  toRepoPath: mock((p: string) => p),
}));

// --- Mock dag-executor ---
const mockExecuteDagWorkflow = mock(
  async (..._args: unknown[]): Promise<string | undefined> => undefined
);
mock.module('./dag-executor', () => ({
  executeDagWorkflow: mockExecuteDagWorkflow,
  substituteNodeOutputRefs: (
    value: string,
    outputs: ReadonlyMap<string, { output: string; structuredOutput?: unknown }>
  ): string =>
    value.replace(
      /\$([A-Za-z_][A-Za-z0-9_-]*)\.output\.([A-Za-z_][A-Za-z0-9_]*)/g,
      (_match, nodeId: string, field: string) => {
        const nodeOutput = outputs.get(nodeId);
        const structured = nodeOutput?.structuredOutput;
        if (structured && typeof structured === 'object' && field in structured) {
          return String((structured as Record<string, unknown>)[field]);
        }
        try {
          const parsed = JSON.parse(nodeOutput?.output ?? '') as Record<string, unknown>;
          return String(parsed[field] ?? '');
        } catch {
          return '';
        }
      }
    ),
}));

// --- Mock logger functions ---
mock.module('./logger', () => ({
  logWorkflowStart: mock(async () => {}),
  logWorkflowError: mock(async () => {}),
}));

// --- Mock event emitter ---
const mockEmitter = {
  registerRun: mock(() => {}),
  unregisterRun: mock(() => {}),
  emit: mock(() => {}),
};
mock.module('./event-emitter', () => ({
  getWorkflowEventEmitter: mock(() => mockEmitter),
}));

// --- Bootstrap provider registry (after path mocks) ---
import { registerBuiltinProviders, clearRegistry } from '@anvil/providers';
clearRegistry();
registerBuiltinProviders();

// --- Import after mocks ---
import { executeWorkflow, hydrateResumableRun } from './executor';
import type { WorkflowDeps, IWorkflowPlatform, WorkflowConfig } from './deps';
import type { IWorkflowStore } from './store';
import type { NodeOutput, WorkflowDefinition, WorkflowNode, WorkflowRun } from './schemas';

// --- Helpers ---

function makeStore(overrides: Partial<IWorkflowStore> = {}): IWorkflowStore {
  return {
    getActiveWorkflowRunByPath: mock(async () => null),
    failOrphanedRuns: mock(async () => ({ count: 0 })),
    createWorkflowRun: mock(async () => makeRun()),
    getChildWorkflowRun: mock(async () => null),
    listChildWorkflowRuns: mock(async () => []),
    findActivePausedDescendant: mock(async () => null),
    updateWorkflowRun: mock(async () => {}),
    updateWorkflowActivity: mock(async () => {}),
    completeWorkflowRun: mock(async () => {}),
    failWorkflowRun: mock(async () => {}),
    pauseWorkflowRun: mock(async () => {}),
    cancelWorkflowRun: mock(async () => ({ cancelled: true })),
    getWorkflowRun: mock(async () => ({ ...makeRun(), status: 'completed' as const })),
    getWorkflowRunStatus: mock(async () => 'completed' as const),
    createWorkflowEvent: mock(async () => {}),
    findResumableRun: mock(async () => null),
    getCompletedDagNodeOutputs: mock(async () => new Map()),
    resumeWorkflowRun: mock(async () => makeRun()),
    getCodebase: mock(async () => null),
    getCodebaseEnvVars: mock(async () => ({})),
    getWorkflowNodeSession: mock(async () => null),
    upsertWorkflowNodeSession: mock(async () => {}),
    deleteWorkflowNodeSessions: mock(async () => ({ deleted: 0 })),
    ...overrides,
  };
}

function makePlatform(): IWorkflowPlatform {
  return {
    sendMessage: mock(async () => {}),
    getPlatformType: mock(() => 'test' as const),
  } as unknown as IWorkflowPlatform;
}

function makeDeps(store?: IWorkflowStore): WorkflowDeps {
  return {
    store: store ?? makeStore(),
    loadConfig: mock(
      async (): Promise<WorkflowConfig> => ({
        assistant: 'claude' as const,
        assistants: {
          claude: {},
          codex: {},
        },
        baseBranch: '',
        commands: { folder: '' },
      })
    ),
    getAgentProvider: mock(() => ({
      run: mock(async () => {}),
    })),
  } as unknown as WorkflowDeps;
}

function makeWorkflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: 'test-workflow',
    description: 'Test',
    nodes: [{ id: 'node1', prompt: 'Do something' }],
    ...overrides,
  };
}

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-123',
    workflow_name: 'test-workflow',
    conversation_id: 'conv-1',
    status: 'running',
    started_at: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

describe('executeWorkflow', () => {
  beforeEach(() => {
    mockLogFn.mockClear();
    mockExecuteDagWorkflow.mockClear();
    mockEmitter.registerRun.mockClear();
    mockEmitter.unregisterRun.mockClear();
    mockEmitter.emit.mockClear();
    mockExecuteDagWorkflow.mockImplementation(async (): Promise<string | undefined> => undefined);
  });

  it('persists a redacted root intake manifest', async () => {
    const artifactsDir = `/tmp/anvil-intake-manifest-${crypto.randomUUID()}`;
    const workflow = makeWorkflow({
      intake: {
        version: 1,
        title: 'Collect inputs',
        fields: [{ input: 'blueprint', control: 'file', prompt: 'Blueprint?' }],
      },
    });

    try {
      const result = await executeWorkflow(
        makeDeps(),
        makePlatform(),
        'conv-1',
        '/tmp',
        workflow,
        'message',
        'db-conv-1',
        {
          artifactsDirOverride: artifactsDir,
          inputs: {
            blueprint: { path: 'docs/system2.md' },
            apiToken: 'must-not-be-persisted',
            __anvil_intake_context: {
              draftId: 'draft-123',
              definitionHash: 'definition-hash-123',
              provenance: { blueprint: { sha256: 'abc123' } },
            },
          },
        }
      );

      expect(result.success).toBe(true);
      const manifest = JSON.parse(
        await readFile(join(artifactsDir, 'input', 'intake_manifest.json'), 'utf8')
      ) as {
        workflowName: string;
        definitionHash: string;
        draftId: string;
        provenance: Record<string, unknown>;
        inputs: Record<string, unknown>;
      };
      expect(manifest.workflowName).toBe('test-workflow');
      expect(manifest.definitionHash).toBe('definition-hash-123');
      expect(manifest.draftId).toBe('draft-123');
      expect(manifest.provenance).toEqual({ blueprint: { sha256: 'abc123' } });
      expect(manifest.inputs.apiToken).toBe('[redacted]');
      expect(manifest.inputs.__anvil_intake_context).toBeUndefined();
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });

  it('snapshots a non-composite dynamic workflow for immutable run inspection', async () => {
    const artifactsDir = `/tmp/anvil-definition-snapshot-${crypto.randomUUID()}`;
    const workflow = makeWorkflow({ name: 'dynamic-workflow' });

    try {
      const result = await executeWorkflow(
        makeDeps(),
        makePlatform(),
        'conv-1',
        '/tmp',
        workflow,
        'message',
        'db-conv-1',
        { artifactsDirOverride: artifactsDir }
      );

      expect(result.success).toBe(true);
      const manifest = JSON.parse(
        await readFile(join(artifactsDir, 'composition', 'manifest.json'), 'utf8')
      ) as { rootWorkflow: string; workflows: { name: string; snapshot: string }[] };
      expect(manifest.rootWorkflow).toBe('dynamic-workflow');
      expect(manifest.workflows).toHaveLength(1);
      const snapshotFile = manifest.workflows[0]?.snapshot;
      expect(snapshotFile).toBeString();
      const snapshot = JSON.parse(
        await readFile(join(artifactsDir, 'composition', snapshotFile as string), 'utf8')
      ) as WorkflowDefinition;
      expect(snapshot).toEqual(workflow);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Concurrent-run guard
  // -------------------------------------------------------------------------

  describe('concurrent-run guard', () => {
    it('allows workflow when no active workflow exists', async () => {
      const store = makeStore({ getActiveWorkflowRunByPath: mock(async () => null) });
      const deps = makeDeps(store);
      const result = await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test message',
        'db-conv-1'
      );
      expect(result.workflowRunId).toBe('run-123');
    });

    it('blocks workflow when active workflow check fails', async () => {
      const store = makeStore({
        getActiveWorkflowRunByPath: mock(async () => {
          throw new Error('DB connection lost');
        }),
      });
      const deps = makeDeps(store);
      const result = await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test message',
        'db-conv-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Database error');
    });

    it('blocks workflow when another is actively running', async () => {
      const activeRun = makeRun({
        id: 'other-run-456',
        status: 'running',
        started_at: new Date().toISOString(), // Recent — not stale
      });
      const store = makeStore({
        getActiveWorkflowRunByPath: mock(async () => activeRun),
      });
      const deps = makeDeps(store);
      const result = await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test message',
        'db-conv-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('already active');
    });

    it('passes self-id and started_at to the lock query so self is excluded', async () => {
      // The guard runs AFTER workflowRun is finalized so we always have
      // a self-ID. Without these args, the dispatch's own row would match
      // and falsely trigger the guard.
      const selfRun = makeRun({ id: 'self-run-789', started_at: '2026-04-14T10:00:00.000Z' });
      const getActiveSpy = mock(async () => null);
      const store = makeStore({
        createWorkflowRun: mock(async () => selfRun),
        getActiveWorkflowRunByPath: getActiveSpy,
      });
      const deps = makeDeps(store);

      await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test message',
        'db-conv-1'
      );

      expect(getActiveSpy).toHaveBeenCalledWith(
        '/tmp',
        expect.objectContaining({ id: 'self-run-789', startedAt: expect.any(Date) })
      );
    });

    it('marks self as cancelled when guard fires (no zombie pending row)', async () => {
      const selfRun = makeRun({ id: 'self-run-789' });
      const otherRun = makeRun({ id: 'other-run-456', status: 'running' });
      const updateSpy = mock(async () => {});
      const store = makeStore({
        createWorkflowRun: mock(async () => selfRun),
        getActiveWorkflowRunByPath: mock(async () => otherRun),
        updateWorkflowRun: updateSpy,
      });
      const deps = makeDeps(store);

      await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test message',
        'db-conv-1'
      );

      // Without this, every guard-blocked dispatch would leak a `pending`
      // row that briefly blocks future dispatches via the lock query.
      expect(updateSpy).toHaveBeenCalledWith('self-run-789', { status: 'cancelled' });
    });

    it('uses the actionable "in use" message format with workflow name, duration, and short id', async () => {
      const otherRun = makeRun({
        id: 'abc12345-rest-of-uuid',
        workflow_name: 'anvil-implement',
        status: 'running',
        started_at: new Date(Date.now() - 125000).toISOString(), // 2m 5s ago
      });
      const sendMessageSpy = mock(async () => {});
      const platform = {
        sendMessage: sendMessageSpy,
        getPlatformType: mock(() => 'test' as const),
      } as unknown as IWorkflowPlatform;
      const store = makeStore({
        getActiveWorkflowRunByPath: mock(async () => otherRun),
      });
      const deps = makeDeps(store);

      await executeWorkflow(
        deps,
        platform,
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test message',
        'db-conv-1'
      );

      expect(sendMessageSpy).toHaveBeenCalled();
      const sentMessage = (sendMessageSpy.mock.calls[0] as [string, string])[1];
      expect(sentMessage).toContain('anvil-implement');
      expect(sentMessage).toContain('abc12345');
      expect(sentMessage).toContain('2m 5s');
      // Concrete next actions — every line tells the user something to do.
      expect(sentMessage).toContain('/workflow status');
      expect(sentMessage).toContain('/workflow cancel abc12345');
      expect(sentMessage).toContain('--branch');
    });

    it('skips path-lock check when mutates_checkout is false', async () => {
      const getActiveSpy = mock(async () =>
        makeRun({ id: 'other-run', status: 'running' as const })
      );
      const store = makeStore({ getActiveWorkflowRunByPath: getActiveSpy });
      const deps = makeDeps(store);
      const result = await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow({ mutates_checkout: false }),
        'test message',
        'db-conv-1'
      );
      // Guard skipped: spy never called, run succeeds
      expect(getActiveSpy).not.toHaveBeenCalled();
      expect(result.workflowRunId).toBe('run-123');
    });

    it('still enforces path lock when mutates_checkout is true', async () => {
      const otherRun = makeRun({ id: 'other-run-456', status: 'running' as const });
      const store = makeStore({ getActiveWorkflowRunByPath: mock(async () => otherRun) });
      const deps = makeDeps(store);
      const result = await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow({ mutates_checkout: true }),
        'test message',
        'db-conv-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('already active');
    });

    it('still returns failure when guard self-cancel update throws (best-effort)', async () => {
      const selfRun = makeRun({ id: 'self-run', status: 'pending' });
      const otherRun = makeRun({ id: 'other-run', status: 'running' });
      const updateSpy = mock(async (id: string) => {
        // Self-cancel attempt fails — must not crash, must still surface
        // the "in use" failure to the user.
        if (id === 'self-run') throw new Error('Update failed');
      });
      const store = makeStore({
        createWorkflowRun: mock(async () => selfRun),
        getActiveWorkflowRunByPath: mock(async () => otherRun),
        updateWorkflowRun: updateSpy,
      });
      const deps = makeDeps(store);

      const result = await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test',
        'db-conv-1'
      );

      // Cleanup failure must not mask the "in use" outcome.
      expect(result.success).toBe(false);
      expect(result.error).toContain('already active');
    });
  });

  // -------------------------------------------------------------------------
  // Resume orphan cleanup
  // -------------------------------------------------------------------------

  // Resume-pipeline coverage lives in the "hydrateResumableRun" suite at the
  // bottom of this file (executor no longer queries findResumableRun on its
  // own, so there is no orphan to clean up).

  // -------------------------------------------------------------------------
  // Model/provider resolution
  // -------------------------------------------------------------------------

  describe('model/provider resolution', () => {
    it('uses default provider from config when workflow has no provider or model', async () => {
      const store = makeStore();
      const deps = makeDeps(store);
      await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test message',
        'db-conv-1'
      );
      // Should succeed — uses config.assistant (claude) as default
      expect(mockExecuteDagWorkflow).toHaveBeenCalledTimes(1);
    });

    it('passes workflow.model through unchanged when workflow.provider is unset', async () => {
      const store = makeStore();
      const deps = makeDeps(store);
      // Provider falls back to config.assistant ('claude'); model is forwarded
      // verbatim. The SDK is the source of truth for what model strings work.
      await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow({ model: 'sonnet' }),
        'test message',
        'db-conv-1'
      );
      expect(mockExecuteDagWorkflow).toHaveBeenCalledTimes(1);
    });

    it('passes provider+model through to the SDK without re-routing on model name', async () => {
      // Provider is explicit; the model string is forwarded verbatim to
      // whichever SDK the resolved provider names. A workflow that sets
      // provider:codex with a Claude-looking model gets the request handed
      // to the codex SDK as-is — the SDK decides whether to accept it.
      const store = makeStore();
      const deps = makeDeps(store);
      await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow({ provider: 'codex', model: 'sonnet' }),
        'test message',
        'db-conv-1'
      );
      expect(mockExecuteDagWorkflow).toHaveBeenCalledTimes(1);
    });

    it('throws when workflow.provider is not a registered provider', async () => {
      const store = makeStore();
      const deps = makeDeps(store);
      await expect(
        executeWorkflow(
          deps,
          makePlatform(),
          'conv-1',
          '/tmp',
          makeWorkflow({ provider: 'claud', model: 'sonnet' }),
          'test message',
          'db-conv-1'
        )
      ).rejects.toThrow(/unknown provider 'claud'/);
    });
  });

  // -------------------------------------------------------------------------
  // $DOCS_DIR default resolution
  // -------------------------------------------------------------------------

  describe('docsDir resolution', () => {
    it('passes docs/ default when config.docsPath is undefined', async () => {
      const store = makeStore();
      const deps = makeDeps(store);
      await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test message',
        'db-conv-1'
      );
      expect(mockExecuteDagWorkflow).toHaveBeenCalledTimes(1);
      // docsDir is arg index 11 (0-indexed) of executeDagWorkflow
      const docsDir = mockExecuteDagWorkflow.mock.calls[0]?.[11];
      expect(docsDir).toBe('docs/');
    });

    it('passes configured docsPath when set', async () => {
      const store = makeStore();
      const deps = {
        store,
        loadConfig: mock(
          async (): Promise<WorkflowConfig> => ({
            assistant: 'claude' as const,
            assistants: { claude: {}, codex: {} },
            baseBranch: '',
            commands: { folder: '' },
            docsPath: 'packages/docs-web/src/content/docs',
          })
        ),
        getAgentProvider: mock(() => ({
          run: mock(async () => {}),
        })),
      } as unknown as WorkflowDeps;
      await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test message',
        'db-conv-1'
      );
      expect(mockExecuteDagWorkflow).toHaveBeenCalledTimes(1);
      const docsDir = mockExecuteDagWorkflow.mock.calls[0]?.[11];
      expect(docsDir).toBe('packages/docs-web/src/content/docs');
    });
  });

  // -------------------------------------------------------------------------
  // Resume logic
  // -------------------------------------------------------------------------

  describe('resume logic', () => {
    it('does NOT call findResumableRun on its own', async () => {
      // Two back-to-back executions of the same workflow at the same cwd
      // must not cross-leak. Resume detection lives at the caller; the
      // executor must never touch findResumableRun on its own.
      const findSpy = mock(async () => makeRun({ id: 'stale-prior', status: 'failed' }));
      const store = makeStore({ findResumableRun: findSpy });
      const deps = makeDeps(store);
      await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test message',
        'db-conv-1'
      );
      expect(findSpy).not.toHaveBeenCalled();
      expect(store.resumeWorkflowRun).not.toHaveBeenCalled();
      expect(store.createWorkflowRun).toHaveBeenCalledTimes(1);
    });

    it('runs the dag-executor with priorCompletedNodes when caller supplies them', async () => {
      const resumed = makeRun({ id: 'resumed-run', status: 'running' });
      const priorCompletedNodes = new Map([
        ['node-a', 'a-output'],
        ['node-b', 'b-output'],
      ]);
      const store = makeStore();
      const deps = makeDeps(store);
      await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test message',
        'db-conv-1',
        { preCreatedRun: resumed, priorCompletedNodes }
      );
      // dag-executor receives the priorCompletedNodes map at arg index 15.
      // dag-executor signature: deps, platform, conversationId, cwd, workflow,
      // workflowRun, provider, model, artifactsDir, logDir, baseBranch,
      // docsDir, config, configuredCommandFolder, issueContext, priorCompletedNodes
      const passedPriors = mockExecuteDagWorkflow.mock.calls[0]?.[15] as
        | Map<string, string>
        | undefined;
      expect(passedPriors).toBe(priorCompletedNodes);
      // No fresh row created when a preCreatedRun is supplied.
      expect(store.createWorkflowRun).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Summary propagation
  // -------------------------------------------------------------------------

  describe('summary propagation', () => {
    it('passes dag summary from executeDagWorkflow into WorkflowExecutionResult', async () => {
      mockExecuteDagWorkflow.mockResolvedValueOnce('This is the workflow summary');
      const store = makeStore();
      const deps = makeDeps(store);
      const result = await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test message',
        'db-conv-1'
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.summary).toBe('This is the workflow summary');
      }
    });

    it('passes undefined summary when executeDagWorkflow returns undefined', async () => {
      mockExecuteDagWorkflow.mockResolvedValueOnce(undefined);
      const store = makeStore();
      const deps = makeDeps(store);
      const result = await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test message',
        'db-conv-1'
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.summary).toBeUndefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Pre-created run (uses existing row but still runs guards)
  // -------------------------------------------------------------------------

  describe('pre-created run', () => {
    it('uses pre-created run row but still runs concurrent-run check', async () => {
      const preRun = makeRun({ id: 'pre-run-1' });
      const store = makeStore();
      const deps = makeDeps(store);
      const result = await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test message',
        'db-conv-1',
        { preCreatedRun: preRun }
      );
      // Guards still run (no bypass)
      expect(store.getActiveWorkflowRunByPath).toHaveBeenCalled();
      // But uses the pre-created run instead of creating a new one
      expect(store.createWorkflowRun).not.toHaveBeenCalled();
      expect(result.workflowRunId).toBe('pre-run-1');
    });
  });

  // -------------------------------------------------------------------------
  // DB env var merge
  // -------------------------------------------------------------------------

  describe('DB env var merge', () => {
    it('merges DB env vars on top of file config envVars when codebaseId provided', async () => {
      const store = makeStore({
        getCodebaseEnvVars: mock(async () => ({ DB_KEY: 'db_val' })),
      });
      const deps = makeDeps(store);
      // Override loadConfig to return file-level envVars
      (deps.loadConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
        assistant: 'claude' as const,
        assistants: { claude: {}, codex: {} },
        baseBranch: '',
        commands: { folder: '' },
        envVars: { FILE_KEY: 'file_val' },
      });

      await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test message',
        'db-conv-1',
        { codebaseId: 'codebase-1' }
      );

      // DB env vars should have been fetched for the codebaseId
      expect(store.getCodebaseEnvVars).toHaveBeenCalledWith('codebase-1');

      // The config passed to executeDagWorkflow (arg index 12) should have merged envVars
      const configArg = mockExecuteDagWorkflow.mock.calls[0]?.[12] as WorkflowConfig | undefined;
      expect(configArg?.envVars).toEqual({ FILE_KEY: 'file_val', DB_KEY: 'db_val' });
    });

    it('does not call getCodebaseEnvVars when no codebaseId', async () => {
      const store = makeStore();
      const deps = makeDeps(store);

      await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test message',
        'db-conv-1'
        // no codebaseId
      );

      expect(store.getCodebaseEnvVars).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // User provider env injection (per-user AI-provider credentials)
  // -------------------------------------------------------------------------

  describe('user provider env injection', () => {
    it('skips injection when isPerUserProviderKeysEnabled returns false', async () => {
      const getUserProviderEnv = mock(async () => ({ env: { SHOULD_NOT_APPEAR: '1' }, files: [] }));
      const deps: WorkflowDeps = {
        ...makeDeps(makeStore()),
        isPerUserProviderKeysEnabled: () => false,
        getUserProviderEnv,
      };
      await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'msg',
        'db-c1',
        { userId: 'u-1' }
      );
      expect(getUserProviderEnv).not.toHaveBeenCalled();
    });

    it('skips injection when userId is absent even if feature is enabled', async () => {
      const getUserProviderEnv = mock(async () => ({ env: { SHOULD_NOT_APPEAR: '1' }, files: [] }));
      const deps: WorkflowDeps = {
        ...makeDeps(makeStore()),
        isPerUserProviderKeysEnabled: () => true,
        getUserProviderEnv,
      };
      await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'msg',
        'db-c1'
        // no userId
      );
      expect(getUserProviderEnv).not.toHaveBeenCalled();
    });

    it('merges user provider env LAST so it overrides DB env', async () => {
      const store = makeStore({
        getCodebaseEnvVars: mock(async () => ({ DB_KEY: 'db_val', SHARED_KEY: 'db' })),
      });
      const getUserProviderEnv = mock(async () => ({
        env: { SHARED_KEY: 'user_wins', USER_KEY: 'u_val' },
        files: [] as { path: string; contents: string }[],
      }));
      const deps: WorkflowDeps = {
        ...makeDeps(store),
        isPerUserProviderKeysEnabled: () => true,
        getUserProviderEnv,
      };
      await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'msg',
        'db-c1',
        { codebaseId: 'codebase-1', userId: 'u-1' }
      );
      const configArg = mockExecuteDagWorkflow.mock.calls[0]?.[12] as WorkflowConfig | undefined;
      expect(configArg?.envVars).toMatchObject({
        DB_KEY: 'db_val',
        SHARED_KEY: 'user_wins',
        USER_KEY: 'u_val',
      });
    });

    it('returns {} and does not throw when getUserProviderEnv rejects', async () => {
      const deps: WorkflowDeps = {
        ...makeDeps(makeStore()),
        isPerUserProviderKeysEnabled: () => true,
        getUserProviderEnv: mock(async () => {
          throw new Error('network down');
        }),
      };
      await expect(
        executeWorkflow(deps, makePlatform(), 'conv-1', '/tmp', makeWorkflow(), 'msg', 'db-c1', {
          userId: 'u-1',
        })
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Lock-token cleanup on pre-DAG failure paths (review #1)
  //
  // Any failure between row creation and DAG start that returns early must
  // release the lock token. Without this, ghost pending/running rows block
  // the path until the 5-min stale window or manual intervention.
  // -------------------------------------------------------------------------

  describe('lock cleanup on failure paths', () => {
    // resumeWorkflowRun DB-error coverage lives in the hydrateResumableRun
    // suite — those errors surface at the caller now, not in the executor.

    it('cancels workflowRun when guard query throws (no zombie row)', async () => {
      const updateSpy = mock(async () => {});
      const store = makeStore({
        getActiveWorkflowRunByPath: mock(async () => {
          throw new Error('DB connection lost during guard');
        }),
        updateWorkflowRun: updateSpy,
      });
      const deps = makeDeps(store);

      const result = await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        makeWorkflow(),
        'test',
        'db-conv-1'
      );

      expect(result.success).toBe(false);
      const cancelCall = updateSpy.mock.calls.find(
        (call: unknown[]) => (call[1] as { status?: string })?.status === 'cancelled'
      );
      expect(cancelCall).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Status-aware blocking message (review #3)
  //
  // The lock query returns running, paused, AND fresh-pending rows.
  // Telling a user to "wait" when the holder is `paused` is misleading —
  // they need to approve/reject to unblock it.
  // -------------------------------------------------------------------------

  describe('blocking message status awareness', () => {
    it('uses paused-specific copy when blocker is paused', async () => {
      const pausedRun = makeRun({
        id: 'paused-run-id',
        workflow_name: 'anvil-implement',
        status: 'paused',
        started_at: new Date(Date.now() - 10000).toISOString(),
      });
      const sendMessageSpy = mock(async () => {});
      const platform = {
        sendMessage: sendMessageSpy,
        getPlatformType: mock(() => 'test' as const),
      } as unknown as IWorkflowPlatform;
      const store = makeStore({ getActiveWorkflowRunByPath: mock(async () => pausedRun) });
      const deps = makeDeps(store);

      await executeWorkflow(deps, platform, 'conv-1', '/tmp', makeWorkflow(), 'test', 'db-conv-1');

      const msg = (sendMessageSpy.mock.calls[0] as [string, string])[1];
      // Wrong action ("wait for it to finish") would let users sit forever
      // on a workflow waiting for their own approval.
      expect(msg).toContain('paused');
      expect(msg).toContain('/workflow approve');
      expect(msg).toContain('/workflow reject');
      expect(msg).not.toContain('Wait for it to finish');
    });

    it('uses pending-specific copy when blocker is just starting', async () => {
      const pendingRun = makeRun({
        id: 'pending-run',
        workflow_name: 'anvil-implement',
        status: 'pending',
        started_at: new Date(Date.now() - 500).toISOString(),
      });
      const sendMessageSpy = mock(async () => {});
      const platform = {
        sendMessage: sendMessageSpy,
        getPlatformType: mock(() => 'test' as const),
      } as unknown as IWorkflowPlatform;
      const store = makeStore({ getActiveWorkflowRunByPath: mock(async () => pendingRun) });
      const deps = makeDeps(store);

      await executeWorkflow(deps, platform, 'conv-1', '/tmp', makeWorkflow(), 'test', 'db-conv-1');

      const msg = (sendMessageSpy.mock.calls[0] as [string, string])[1];
      expect(msg).toContain('starting');
    });

    it('uses running copy by default', async () => {
      const runningRun = makeRun({
        id: 'running-run',
        workflow_name: 'anvil-implement',
        status: 'running',
        started_at: new Date(Date.now() - 60000).toISOString(),
      });
      const sendMessageSpy = mock(async () => {});
      const platform = {
        sendMessage: sendMessageSpy,
        getPlatformType: mock(() => 'test' as const),
      } as unknown as IWorkflowPlatform;
      const store = makeStore({ getActiveWorkflowRunByPath: mock(async () => runningRun) });
      const deps = makeDeps(store);

      await executeWorkflow(deps, platform, 'conv-1', '/tmp', makeWorkflow(), 'test', 'db-conv-1');

      const msg = (sendMessageSpy.mock.calls[0] as [string, string])[1];
      expect(msg).toContain('running 1m');
      expect(msg).toContain('Wait for it to finish');
    });
  });
});

describe('finally backstop', () => {
  it('calls failWorkflowRun when run is still running at finally', async () => {
    const failSpy = mock(async () => {});
    const store = makeStore({
      getWorkflowRunStatus: mock(async () => 'running' as const),
      failWorkflowRun: failSpy,
    });
    const deps = makeDeps(store);

    await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'test',
      'db-conv-1'
    );

    const call = (failSpy.mock.calls as unknown[][]).find(
      c => typeof c[1] === 'string' && (c[1] as string).includes('exited without finalizing')
    );
    expect(call).toBeDefined();
  });

  it('does not call failWorkflowRun when run already completed', async () => {
    const failSpy = mock(async () => {});
    const store = makeStore({
      getWorkflowRunStatus: mock(async () => 'completed' as const),
      failWorkflowRun: failSpy,
    });
    const deps = makeDeps(store);

    await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'test',
      'db-conv-1'
    );

    const backstopCall = (failSpy.mock.calls as unknown[][]).find(
      c => typeof c[1] === 'string' && (c[1] as string).includes('exited without finalizing')
    );
    expect(backstopCall).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Telemetry wiring
//
// captureWorkflowCompleted is mocked as a no-op; these tests assert it actually
// fires on the unhandled-throw path (and only there from the executor) and that
// the WorkflowSource is threaded into executeDagWorkflow. Telemetry regressions
// are otherwise invisible — a dropped call leaves no failing assertion.
// ───────────────────────────────────────────────────────────────────────────
describe('telemetry wiring', () => {
  beforeEach(() => {
    mockExecuteDagWorkflow.mockClear();
    mockCaptureWorkflowCompleted.mockClear();
    mockExecuteDagWorkflow.mockImplementation(async (): Promise<string | undefined> => undefined);
  });

  it('captures workflow_failed with unhandled_error when executeDagWorkflow throws', async () => {
    mockExecuteDagWorkflow.mockRejectedValueOnce(new Error('dag boom'));
    const store = makeStore();
    const deps = makeDeps(store);

    await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'msg',
      'db-conv-1'
    );

    // Exactly once — the executor catch must not double-emit with the DAG paths.
    expect(mockCaptureWorkflowCompleted).toHaveBeenCalledTimes(1);
    expect(mockCaptureWorkflowCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', exitReason: 'unhandled_error' })
    );
  });

  it('reports feature-adoption booleans on workflow_invoked', async () => {
    mockCaptureWorkflowInvoked.mockClear();
    const store = makeStore();
    const deps = makeDeps(store);
    const workflow = makeWorkflow({
      persist_sessions: true,
      nodes: [
        { id: 'gen', prompt: 'Generate.', output_format: { type: 'object' }, mcp: 'mcp.json' },
        {
          id: 'iterate',
          depends_on: ['gen'],
          loop: { prompt: 'Iterate.', until: 'DONE', fresh_context: true },
        },
        { id: 'summarize', depends_on: ['iterate'], prompt: 'Summarize.', output_type: 'report' },
      ],
    } as Partial<WorkflowDefinition>);

    await executeWorkflow(deps, makePlatform(), 'conv-1', '/tmp', workflow, 'msg', 'db-conv-1');

    expect(mockCaptureWorkflowInvoked).toHaveBeenCalledTimes(1);
    expect(mockCaptureWorkflowInvoked).toHaveBeenCalledWith(
      expect.objectContaining({
        usesOutputFormat: true,
        usesOutputType: true,
        usesPersistSession: true,
        usesMcp: true,
        usesFreshContext: true,
        usesSkills: false,
      })
    );
  });

  it('reports adoption booleans as false for a plain single-prompt workflow', async () => {
    mockCaptureWorkflowInvoked.mockClear();
    const store = makeStore();
    const deps = makeDeps(store);

    await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'msg',
      'db-conv-1'
    );

    expect(mockCaptureWorkflowInvoked).toHaveBeenCalledWith(
      expect.objectContaining({
        usesOutputFormat: false,
        usesOutputType: false,
        usesPersistSession: false,
        usesMcp: false,
        usesSkills: false,
        usesFreshContext: false,
      })
    );
  });

  it('does not fire executor-level completion telemetry on the success path', async () => {
    // The DAG executor owns success/partial-failure telemetry; the executor's
    // own captureWorkflowCompleted must fire only from the unhandled-throw catch.
    const store = makeStore();
    const deps = makeDeps(store);

    await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'msg',
      'db-conv-1'
    );

    expect(mockCaptureWorkflowCompleted).not.toHaveBeenCalled();
  });

  it('threads source through to executeDagWorkflow (arg index 16)', async () => {
    const store = makeStore();
    const deps = makeDeps(store);

    await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'msg',
      'db-conv-1',
      {
        source: 'bundled',
      }
    );

    expect(mockExecuteDagWorkflow.mock.calls[0]?.[16]).toBe('bundled');
  });

  it('resolves top-level workflow tier refs before calling the DAG executor', async () => {
    const store = makeStore();
    const deps = {
      ...makeDeps(store),
      loadConfig: mock(
        async (): Promise<WorkflowConfig> => ({
          assistant: 'claude',
          assistants: { claude: {}, codex: {} },
          baseBranch: '',
          commands: { folder: '' },
          tiers: {
            large: { provider: 'codex', model: 'gpt-5.5', effort: 'high' },
          },
        })
      ),
    } as WorkflowDeps;

    await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow({ model: 'large' }),
      'msg',
      'db-conv-1'
    );

    expect(mockExecuteDagWorkflow.mock.calls[0]?.[6]).toBe('codex');
    expect(mockExecuteDagWorkflow.mock.calls[0]?.[7]).toBe('gpt-5.5');
    expect(mockExecuteDagWorkflow.mock.calls[0]?.[17]).toEqual(
      expect.objectContaining({
        aliases: expect.objectContaining({
          large: { provider: 'codex', model: 'gpt-5.5', effort: 'high' },
        }),
      })
    );
    expect(mockExecuteDagWorkflow.mock.calls[0]?.[18]).toEqual({
      provider: 'codex',
      model: 'gpt-5.5',
      effort: 'high',
    });
  });

  it('applies per-user AI prefs as the highest-precedence resolver layer', async () => {
    const store = makeStore();
    const getUserAiPrefs = mock(async () => ({
      tiers: { large: { provider: 'codex', model: 'gpt-5.5', effort: 'high' } },
    }));
    const deps = {
      ...makeDeps(store),
      loadConfig: mock(
        async (): Promise<WorkflowConfig> => ({
          assistant: 'claude',
          assistants: { claude: {}, codex: {} },
          baseBranch: '',
          commands: { folder: '' },
          tiers: {
            large: { provider: 'claude', model: 'opus' },
          },
        })
      ),
      getUserAiPrefs,
    } as WorkflowDeps;

    await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow({ model: 'large' }),
      'msg',
      'db-conv-1',
      { userId: 'user-1' }
    );

    expect(getUserAiPrefs).toHaveBeenCalledWith('user-1');
    // User tier wins over the config tier for the same key.
    expect(mockExecuteDagWorkflow.mock.calls[0]?.[6]).toBe('codex');
    expect(mockExecuteDagWorkflow.mock.calls[0]?.[7]).toBe('gpt-5.5');
  });

  it('does not consult per-user AI prefs without a userId (solo unchanged)', async () => {
    const store = makeStore();
    const getUserAiPrefs = mock(async () => ({}));
    const deps = { ...makeDeps(store), getUserAiPrefs } as WorkflowDeps;

    await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'msg',
      'db-conv-1'
    );

    expect(getUserAiPrefs).not.toHaveBeenCalled();
  });

  it('a throwing getUserAiPrefs dep degrades to config-only (run still starts)', async () => {
    const store = makeStore();
    const deps = {
      ...makeDeps(store),
      getUserAiPrefs: mock(async () => {
        throw new Error('db down');
      }),
    } as WorkflowDeps;

    await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow({ model: 'large' }),
      'msg',
      'db-conv-1',
      { userId: 'user-1' }
    );

    // Config default is claude → built-in tier defaults resolve 'large'.
    expect(mockExecuteDagWorkflow.mock.calls[0]?.[6]).toBe('claude');
  });

  it('structurally invalid stored prefs degrade to config-only (run still starts)', async () => {
    const store = makeStore();
    const deps = {
      ...makeDeps(store),
      // An alias without the '@' prefix makes buildAiProfile throw.
      getUserAiPrefs: mock(async () => ({
        aliases: { fast: { provider: 'claude', model: 'haiku' } },
      })),
    } as WorkflowDeps;

    await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow({ model: 'large' }),
      'msg',
      'db-conv-1',
      { userId: 'user-1' }
    );

    expect(mockExecuteDagWorkflow.mock.calls[0]?.[6]).toBe('claude');
  });

  it("per-user default provider rebases tier defaults for the run's profile", async () => {
    const store = makeStore();
    const deps = {
      ...makeDeps(store),
      getUserAiPrefs: mock(async () => ({ defaultProvider: 'codex' })),
    } as WorkflowDeps;

    await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow({ model: 'large' }),
      'msg',
      'db-conv-1',
      { userId: 'user-1' }
    );

    // No tiers configured anywhere → built-in tier defaults follow the
    // user's default provider, not the install config's.
    expect(mockExecuteDagWorkflow.mock.calls[0]?.[6]).toBe('codex');
  });

  it('passes undefined source when the caller does not supply one', async () => {
    const store = makeStore();
    const deps = makeDeps(store);

    await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'msg',
      'db-conv-1'
    );

    expect(mockExecuteDagWorkflow.mock.calls[0]?.[16]).toBeUndefined();
  });

  it('creates a namespaced child run and propagates typed outputs and artifacts', async () => {
    const artifactsDir = `/tmp/anvil-composition-${crypto.randomUUID()}`;
    const createRun = mock(
      async (data: Parameters<IWorkflowStore['createWorkflowRun']>[0]): Promise<WorkflowRun> =>
        makeRun({
          id: data.parent_workflow_run_id ? 'child-run' : 'root-run',
          workflow_name: data.workflow_name,
          status: data.parent_workflow_run_id ? 'pending' : 'running',
          parent_workflow_run_id: data.parent_workflow_run_id,
          parent_node_id: data.parent_node_id,
        })
    );
    const createEvent = mock(async () => {});
    const store = makeStore({
      createWorkflowRun: createRun,
      createWorkflowEvent: createEvent,
      getCompletedDagNodeOutputs: mock(async runId =>
        runId === 'child-run'
          ? new Map([['build', JSON.stringify({ path: 'overview.md' })]])
          : new Map()
      ),
      getWorkflowRun: mock(async id =>
        makeRun({ id, workflow_name: id === 'child-run' ? 'child' : 'root', status: 'completed' })
      ),
    });
    const deps = makeDeps(store);
    const child = makeWorkflow({
      name: 'child',
      input_schema: {
        type: 'object',
        properties: { request: { type: 'object' } },
        required: ['request'],
      },
      output_schema: {
        type: 'object',
        properties: { overviewPath: { type: 'string' } },
        required: ['overviewPath'],
      },
      outputs: { overviewPath: '$build.output.path' },
      nodes: [{ id: 'build', prompt: 'build' }],
    });
    const root = makeWorkflow({
      name: 'root',
      input_schema: {
        type: 'object',
        properties: { request: { type: 'object' } },
        required: ['request'],
      },
      nodes: [
        { id: 'prepare', prompt: 'prepare' },
        {
          id: 'invoke',
          depends_on: ['prepare'],
          workflow: {
            name: 'child',
            inputs: { request: '$prepare.output.request' },
            artifacts: { outputs: { canonical: 'canonical/result.json' } },
          },
        } as WorkflowNode,
      ],
    });
    let childOutput: NodeOutput | undefined;
    mockExecuteDagWorkflow.mockImplementation(async (...args: unknown[]) => {
      const definition = args[4] as WorkflowDefinition;
      const currentArtifactsDir = args[8] as string;
      if (definition.name === 'child') {
        await mkdir(join(currentArtifactsDir, 'canonical'), { recursive: true });
        await writeFile(join(currentArtifactsDir, 'canonical', 'result.json'), '{}');
        return undefined;
      }
      const runner = args.at(-1) as
        | ((node: WorkflowNode, outputs: ReadonlyMap<string, NodeOutput>) => Promise<NodeOutput>)
        | undefined;
      childOutput = await runner?.(
        definition.nodes[1] as WorkflowNode,
        new Map([
          [
            'prepare',
            {
              state: 'completed',
              output: JSON.stringify({ request: { target: 'churn', horizonDays: 90 } }),
              structuredOutput: { request: { target: 'churn', horizonDays: 90 } },
            },
          ],
        ])
      );
      return undefined;
    });

    try {
      const result = await executeWorkflow(
        deps,
        makePlatform(),
        'conv-1',
        '/tmp',
        root,
        'message',
        'db-conv-1',
        {
          inputs: { request: { target: 'churn' } },
          artifactsDirOverride: artifactsDir,
          compositionDefinitions: new Map([
            ['root', root],
            ['child', child],
          ]),
        }
      );

      expect(result.success).toBe(true);
      expect(createRun).toHaveBeenCalledTimes(2);
      expect(createRun.mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({
          parent_workflow_run_id: 'root-run',
          parent_node_id: 'invoke',
          working_path: '/tmp',
          metadata: {
            composition_depth: 1,
            inputs: { request: { target: 'churn', horizonDays: 90 } },
          },
        })
      );
      expect(childOutput?.structuredOutput).toEqual({
        overviewPath: 'overview.md',
        artifacts: {
          canonical: join(artifactsDir, 'children', 'invoke', 'child-run', 'canonical/result.json'),
        },
      });
      expect(
        createEvent.mock.calls.some(
          call => (call[0] as { event_type?: string }).event_type === 'child_workflow_completed'
        )
      ).toBe(true);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });

  it('resumes a composite workflow from the snapshotted root definition', async () => {
    const artifactsDir = `/tmp/anvil-composition-resume-${crypto.randomUUID()}`;
    const child = makeWorkflow({
      name: 'child',
      input_schema: {
        type: 'object',
        properties: { request: { type: 'string' } },
        required: ['request'],
      },
    });
    const snapshottedRoot = makeWorkflow({
      name: 'root',
      input_schema: {
        type: 'object',
        properties: { request: { type: 'string' } },
        required: ['request'],
      },
      nodes: [
        {
          id: 'invoke',
          workflow: { name: 'child', inputs: { request: 'original-request.json' } },
        } as WorkflowNode,
      ],
    });
    const currentRoot = makeWorkflow({
      name: 'root',
      // Simulate YAML edited after the run started. This mapping is invalid for
      // the snapshotted child and must not participate in resume validation.
      nodes: [
        {
          id: 'invoke',
          workflow: { name: 'child', inputs: { legacy_payload: '$INPUTS_JSON_BASE64' } },
        } as WorkflowNode,
      ],
    });
    const rootSnapshot = 'root.json';
    const childSnapshot = 'child.json';
    await mkdir(join(artifactsDir, 'composition'), { recursive: true });
    await writeFile(
      join(artifactsDir, 'composition', 'manifest.json'),
      JSON.stringify({
        rootWorkflow: 'root',
        workflows: [
          { name: 'root', snapshot: rootSnapshot },
          { name: 'child', snapshot: childSnapshot },
        ],
      })
    );
    await writeFile(
      join(artifactsDir, 'composition', rootSnapshot),
      JSON.stringify(snapshottedRoot)
    );
    await writeFile(join(artifactsDir, 'composition', childSnapshot), JSON.stringify(child));
    let executedRoot: WorkflowDefinition | undefined;
    mockExecuteDagWorkflow.mockImplementationOnce(async (...args: unknown[]) => {
      executedRoot = args[4] as WorkflowDefinition;
      return undefined;
    });

    try {
      const result = await executeWorkflow(
        makeDeps(),
        makePlatform(),
        'conv-1',
        '/tmp',
        currentRoot,
        'message',
        'db-conv-1',
        {
          preCreatedRun: makeRun({ id: 'root-run', workflow_name: 'root' }),
          priorCompletedNodes: new Map([['prior', 'done']]),
          inputs: { request: 'original-request.json' },
          artifactsDirOverride: artifactsDir,
        }
      );

      expect(result.success).toBe(true);
      expect((executedRoot?.nodes[0] as WorkflowNode).workflow.inputs).toEqual({
        request: 'original-request.json',
      });
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// hydrateResumableRun
//
// Resume preparation is a caller-side primitive: callers look up the
// candidate themselves (via findResumableRun or
// findResumableRunByParentConversation) and call hydrateResumableRun to
// turn it into the form executeWorkflow expects. The executor only consumes
// what this returns.
// ───────────────────────────────────────────────────────────────────────────

describe('hydrateResumableRun', () => {
  it('returns hydrated run + prior outputs for a candidate with completed nodes', async () => {
    const candidate = makeRun({ id: 'prior-failed', status: 'failed' });
    const resumed = makeRun({ id: 'prior-failed', status: 'running' });
    const priorNodes = new Map([['n1', 'out1']]);
    const store = makeStore({
      getCompletedDagNodeOutputs: mock(async () => priorNodes),
      resumeWorkflowRun: mock(async () => resumed),
    });
    const deps = makeDeps(store);
    const result = await hydrateResumableRun(deps, candidate);
    expect(result).not.toBeNull();
    expect(result?.preCreatedRun).toBe(resumed);
    expect(result?.priorCompletedNodes).toBe(priorNodes);
    expect(store.resumeWorkflowRun).toHaveBeenCalledWith('prior-failed');
  });

  it('returns null when candidate has no completed nodes and no interactive-loop state', async () => {
    const candidate = makeRun({ id: 'empty-prior', status: 'failed' });
    const store = makeStore({
      getCompletedDagNodeOutputs: mock(async () => new Map()),
    });
    const deps = makeDeps(store);
    const result = await hydrateResumableRun(deps, candidate);
    expect(result).toBeNull();
    // Must not transition the run — there is nothing to resume.
    expect(store.resumeWorkflowRun).not.toHaveBeenCalled();
  });

  it('returns hydrated run when interactive-loop state is present even with zero completed nodes', async () => {
    const candidate = makeRun({
      id: 'paused-loop',
      status: 'paused',
      metadata: { approval: { type: 'interactive_loop', nodeId: 'loop-1', iteration: 2 } },
    });
    const resumed = makeRun({ id: 'paused-loop', status: 'running' });
    const store = makeStore({
      getCompletedDagNodeOutputs: mock(async () => new Map()),
      resumeWorkflowRun: mock(async () => resumed),
    });
    const deps = makeDeps(store);
    const result = await hydrateResumableRun(deps, candidate);
    expect(result).not.toBeNull();
    expect(result?.priorCompletedNodes.size).toBe(0);
    expect(store.resumeWorkflowRun).toHaveBeenCalledWith('paused-loop');
  });

  it('propagates DB errors from getCompletedDagNodeOutputs (no silent fallback)', async () => {
    const candidate = makeRun({ id: 'prior-failed', status: 'failed' });
    const store = makeStore({
      getCompletedDagNodeOutputs: mock(async () => {
        throw new Error('DB read failed');
      }),
    });
    const deps = makeDeps(store);
    await expect(hydrateResumableRun(deps, candidate)).rejects.toThrow('DB read failed');
  });

  it('propagates DB errors from resumeWorkflowRun (no silent fallback)', async () => {
    const candidate = makeRun({ id: 'prior-failed', status: 'failed' });
    const store = makeStore({
      getCompletedDagNodeOutputs: mock(async () => new Map([['n1', 'v1']])),
      resumeWorkflowRun: mock(async () => {
        throw new Error('DB write failed');
      }),
    });
    const deps = makeDeps(store);
    await expect(hydrateResumableRun(deps, candidate)).rejects.toThrow('DB write failed');
  });
});
