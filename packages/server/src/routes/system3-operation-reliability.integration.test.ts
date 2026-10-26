import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAdapter } from '@anvil/core/db/adapters/index';
import {
  System3ConflictError,
  System3Store,
  type System3Database,
  type System3ProjectRecord,
} from '@anvil/system3';

async function createHarness(): Promise<{
  database: SqliteAdapter;
  project: System3ProjectRecord;
  store: System3Store;
}> {
  const database = new SqliteAdapter(join(tmpdir(), `anvil-t05-${randomUUID()}.db`));
  const codebaseId = randomUUID();
  await database.query(
    'INSERT INTO remote_agent_codebases (id, name, default_cwd) VALUES ($1, $2, $3)',
    [codebaseId, 'T05 reliability test', '/tmp/anvil-t05-reliability']
  );
  const store = new System3Store(database);
  const project = await store.createProject({
    codebaseId,
    name: 'T05 reliability test',
  });
  return { database, project, store };
}

function createTwoPartyBarrier(): () => Promise<void> {
  let arrivals = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === 2) release?.();
    await gate;
  };
}

describe('System 3 operation reliability with real SQLite', () => {
  test('approves at the expected version and replays one execution only for the same basis', async () => {
    const { database, project, store } = await createHarness();
    const snapshotId = randomUUID();
    const compilationId = randomUUID();
    const approvalId = randomUUID();
    const bundleSnapshotId = randomUUID();
    const conversationId = randomUUID();
    await database.query(
      `INSERT INTO remote_agent_system3_knowledge_snapshots
         (id, project_id, analysis, artifact_key, schema_version, lifecycle_status, quality_status)
       VALUES ($1, $2, '{}', 't05/understanding.json', 3, 'active', 'passed')`,
      [snapshotId, project.id]
    );
    await database.query(
      'UPDATE remote_agent_system3_projects SET active_knowledge_snapshot_id = $1 WHERE id = $2',
      [snapshotId, project.id]
    );
    await database.query(
      `INSERT INTO remote_agent_system3_compilations
         (id, project_id, knowledge_snapshot_id, plan, definition_hash, capability_registry_hash)
       VALUES ($1, $2, $3, '{}', 'sha256:definition', 'sha256:capabilities')`,
      [compilationId, project.id, snapshotId]
    );
    await database.query(
      `INSERT INTO remote_agent_system3_workflow_bundle_snapshots
         (id, project_id, compilation_id, activity_id, schema_version, compiler_version,
          template_id, execution_mode, definition, definition_hash)
       VALUES ($1, $2, $3, 'TW-06', 3, 'system3-compiler@3',
               'customer-churn-reference@1', 'full', '{}', 'sha256:bundle')`,
      [bundleSnapshotId, project.id, compilationId]
    );
    const beforeApproval = await store.getProject(project.id);
    if (!beforeApproval) throw new Error('T05 project was not found before approval');
    const approval = await store.approveCompilation({
      id: approvalId,
      projectId: project.id,
      compilationId,
      idempotencyKey: 'execute-approval:controlled-execute-key',
      manifest: {} as never,
      expectedVersion: beforeApproval.version,
    });
    const approvalReplay = await store.approveCompilation({
      id: randomUUID(),
      projectId: project.id,
      compilationId,
      idempotencyKey: 'execute-approval:controlled-execute-key',
      manifest: {} as never,
      expectedVersion: beforeApproval.version,
    });
    const approvedProject = await store.getProject(project.id);
    if (!approvedProject) throw new Error('T05 project was not found after approval');
    expect(approvalReplay.id).toBe(approval.id);
    expect(approvedProject.version).toBe(beforeApproval.version + 1);
    await expect(
      store.approveCompilation({
        id: randomUUID(),
        projectId: project.id,
        compilationId,
        idempotencyKey: 'new-approval-key',
        manifest: {} as never,
        expectedVersion: beforeApproval.version,
      })
    ).rejects.toBeInstanceOf(System3ConflictError);

    await database.query(
      `INSERT INTO remote_agent_conversations
         (id, platform_type, platform_conversation_id, codebase_id)
       VALUES ($1, 'web', $2, $3)`,
      [conversationId, 't05-execution', project.codebaseId]
    );
    const input = {
      executionId: randomUUID(),
      projectId: project.id,
      approvalId: approval.id,
      definitionHash: 'sha256:definition',
      bundleSnapshotId,
      bundleHash: 'sha256:bundle',
      runtimeBindings: { executionId: 'pinned' },
      expectedVersion: approvedProject.version,
      idempotencyKey: 'controlled-execute-key',
      conversationId,
      codebaseId: project.codebaseId,
      workingPath: '/tmp/anvil-t05-execution',
    };
    const first = await store.beginExecution(input);
    const acceptedRetry = await store.beginExecution(input);
    expect(acceptedRetry.existing).toBe(true);
    expect(acceptedRetry.operation.id).toBe(first.operation.id);
    const acceptedReplay = await store.getExecutionReplay({
      projectId: project.id,
      idempotencyKey: input.idempotencyKey,
      approvalId: approval.id,
      expectedVersion: input.expectedVersion,
    });
    expect(acceptedReplay?.execution.id).toBe(first.execution.id);
    await expect(
      store.getExecutionReplay({
        projectId: project.id,
        idempotencyKey: input.idempotencyKey,
        approvalId: approval.id,
        expectedVersion: input.expectedVersion + 1,
      })
    ).rejects.toBeInstanceOf(System3ConflictError);
    const claimToken = await store.markProjectOperationRunning({
      operationId: acceptedRetry.operation.id,
      ownerInstanceId: 't05-execution-owner',
    });
    expect(claimToken).toBeTruthy();
    await expect(
      store.markProjectOperationRunning({
        operationId: first.operation.id,
        ownerInstanceId: 't05-second-owner',
      })
    ).rejects.toBeInstanceOf(System3ConflictError);

    const replay = await store.beginExecution(input);
    expect(replay.existing).toBe(true);
    expect(replay.execution.id).toBe(first.execution.id);
    expect(replay.operation.id).toBe(first.operation.id);
    expect(
      (
        await store.getExecutionReplay({
          projectId: project.id,
          idempotencyKey: input.idempotencyKey,
          approvalId: approval.id,
          expectedVersion: input.expectedVersion,
        })
      )?.operation.status
    ).toBe('running');
    await expect(
      store.beginExecution({ ...input, expectedVersion: input.expectedVersion + 1 })
    ).rejects.toBeInstanceOf(System3ConflictError);
    const counts = await database.query<{ executions: number; runs: number }>(
      `SELECT
         (SELECT COUNT(*) FROM remote_agent_system3_project_executions WHERE project_id = $1) AS executions,
         (SELECT COUNT(*) FROM remote_agent_workflow_runs WHERE id = $2) AS runs`,
      [project.id, first.execution.workflowRunId]
    );
    expect(Number(counts.rows[0]?.executions)).toBe(1);
    expect(Number(counts.rows[0]?.runs)).toBe(1);
    await database.close();
  });

  test('serializes a controlled same-key race and replays the one durable operation', async () => {
    const { database, project, store } = await createHarness();
    const barrier = createTwoPartyBarrier();
    const request = { expectedVersion: project.version, sourceVersionId: randomUUID() };

    const begin = async () => {
      await barrier();
      return store.beginProjectOperation({
        projectId: project.id,
        type: 'change_detection',
        idempotencyKey: 'controlled-race-key',
        request,
        expectedVersion: project.version,
      });
    };

    const [left, right] = await Promise.all([begin(), begin()]);
    expect(left.operation.id).toBe(right.operation.id);
    expect([left.existing, right.existing].sort()).toEqual([false, true]);

    const count = await database.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM remote_agent_system3_project_operations
       WHERE project_id = $1 AND operation_type = 'change_detection'
         AND idempotency_key = 'controlled-race-key'`,
      [project.id]
    );
    expect(Number(count.rows[0]?.count)).toBe(1);

    const claimToken = await store.markProjectOperationRunning({
      operationId: left.operation.id,
      ownerInstanceId: 't05-test-owner',
    });
    await store.completeProjectOperation(left.operation.id, claimToken, { outcome: 'complete' });
    const replay = await store.beginProjectOperation({
      projectId: project.id,
      type: 'change_detection',
      idempotencyKey: 'controlled-race-key',
      request,
      expectedVersion: project.version,
    });
    expect(replay.existing).toBe(true);
    expect(replay.operation.id).toBe(left.operation.id);
    expect(replay.operation.status).toBe('succeeded');

    await database.close();
  });

  test('reclaims an accepted readiness retry through one durable claim', async () => {
    const { database, project, store } = await createHarness();
    const request = { expectedVersion: project.version };
    const first = await store.beginProjectOperation({
      projectId: project.id,
      type: 'readiness',
      idempotencyKey: 'accepted-readiness-retry',
      request,
      expectedVersion: project.version,
    });
    const replay = await store.getProjectOperationReplay({
      projectId: project.id,
      type: 'readiness',
      idempotencyKey: 'accepted-readiness-retry',
      request,
    });
    expect(replay?.id).toBe(first.operation.id);
    expect(replay?.status).toBe('accepted');

    const retried = await store.beginProjectOperation({
      projectId: project.id,
      type: 'readiness',
      idempotencyKey: 'accepted-readiness-retry',
      request,
      expectedVersion: project.version,
    });
    expect(retried.existing).toBe(true);
    expect(retried.operation.id).toBe(first.operation.id);
    expect(retried.operation.status).toBe('accepted');

    const ownerClaimToken = await store.markProjectOperationRunning({
      operationId: retried.operation.id,
      ownerInstanceId: 't05-readiness-retry-owner',
    });
    expect(ownerClaimToken).toBeTruthy();
    await expect(
      store.markProjectOperationRunning({
        operationId: first.operation.id,
        ownerInstanceId: 't05-readiness-second-owner',
      })
    ).rejects.toBeInstanceOf(System3ConflictError);
    const count = await database.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM remote_agent_system3_project_operations
       WHERE project_id = $1 AND operation_type = 'readiness'
         AND idempotency_key = 'accepted-readiness-retry'`,
      [project.id]
    );
    expect(Number(count.rows[0]?.count)).toBe(1);
    const claimed = await store.getOperation(first.operation.id);
    expect(claimed?.status).toBe('running');
    await database.close();
  });

  test('serializes Lifecycle Attempt creation and validates same-key replays', async () => {
    const { database, project, store } = await createHarness();
    const basis = {
      schemaVersion: 1 as const,
      sourceVersionIds: [randomUUID()],
      sourceHashes: [`sha256:${'a'.repeat(64)}`],
      knowledgeSnapshotId: null,
      readinessContractId: null,
      compilationId: null,
      approvalId: null,
      executionId: null,
      verificationId: null,
      baseCommitSha: 'b'.repeat(40),
      resources: { projectVersion: project.version, requestedScope: 'activity' },
    };
    const request = {
      projectId: project.id,
      expectedVersion: project.version,
      baseAttemptId: null,
      startActivityId: 'OP-00',
      scope: 'activity' as const,
      inputMode: 'current' as const,
      basis,
      previewHash: `sha256:${'c'.repeat(64)}`,
      idempotencyKey: 'attempt-race-key',
    };

    const [left, right] = await Promise.all([
      store.beginLifecycleAttempt(request),
      store.beginLifecycleAttempt(request),
    ]);

    expect(left.attempt.id).toBe(right.attempt.id);
    expect([left.existing, right.existing].sort()).toEqual([false, true]);
    const count = await database.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM remote_agent_system3_lifecycle_attempts
       WHERE project_id = $1 AND idempotency_key = 'attempt-race-key'`,
      [project.id]
    );
    expect(Number(count.rows[0]?.count)).toBe(1);

    const replay = await store.getLifecycleAttemptReplay(request);
    expect(replay?.id).toBe(left.attempt.id);
    await expect(
      store.getLifecycleAttemptReplay({ ...request, startActivityId: 'TW-02' })
    ).rejects.toBeInstanceOf(System3ConflictError);

    await database.close();
  });

  test('rolls back the domain write and terminal status when commit is fault-injected', async () => {
    const { database, project, store } = await createHarness();
    const sourceVersionId = randomUUID();
    const sourceId = randomUUID();
    await database.query(
      `INSERT INTO remote_agent_system3_sources
         (id, project_id, kind, role, display_name, status)
       VALUES ($1, $2, 'user_brief', 'primary', 'T05 brief', 'active')`,
      [sourceId, project.id]
    );
    await database.query(
      `INSERT INTO remote_agent_system3_source_versions
         (id, source_id, project_id, kind, role, filename, original_filename, media_type,
          version, lineage_version, content_hash, size_bytes, storage_key, storage_status,
          validation_report, origin)
       VALUES ($1, $2, $3, 'user_brief', 'primary', 'brief.md', 'brief.md', 'text/markdown',
               1, 1, 'sha256:t05', 3, 't05/brief.md', 'ready', $4, 'test')`,
      [
        sourceVersionId,
        sourceId,
        project.id,
        JSON.stringify({ schemaVersion: 1, outcome: 'accepted', checks: [], warnings: [] }),
      ]
    );
    const begun = await store.beginProjectOperation({
      projectId: project.id,
      type: 'change_detection',
      idempotencyKey: 'fault-at-commit-key',
      request: { expectedVersion: project.version, sourceVersionId },
      expectedVersion: project.version,
    });
    const claimToken = await store.markProjectOperationRunning({
      operationId: begun.operation.id,
      ownerInstanceId: 't05-fault-owner',
    });

    const faultingDatabase: System3Database = {
      dialect: 'sqlite',
      query: database.query.bind(database),
      withTransaction: callback =>
        database.withTransaction(async query => {
          let impactWasWritten = false;
          return callback(async (sql, params) => {
            const result = await query(sql, params);
            if (sql.includes('INSERT INTO remote_agent_system3_impact_manifests')) {
              impactWasWritten = true;
            }
            if (
              impactWasWritten &&
              sql.includes('UPDATE remote_agent_system3_project_operations') &&
              sql.includes("SET status = 'succeeded'")
            ) {
              throw new Error('Injected failure immediately before transaction commit');
            }
            return result;
          });
        }),
    };

    await expect(
      new System3Store(faultingDatabase).recordSourceImpact({
        projectId: project.id,
        sourceVersionId,
        kind: 'user_brief',
        operationId: begun.operation.id,
        ownerClaimToken: claimToken,
      })
    ).rejects.toThrow('Injected failure immediately before transaction commit');

    const rolledBackImpact = await database.query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM remote_agent_system3_impact_manifests WHERE project_id = $1',
      [project.id]
    );
    expect(Number(rolledBackImpact.rows[0]?.count)).toBe(0);
    expect((await store.getOperation(begun.operation.id))?.status).toBe('running');

    const impact = await store.recordSourceImpact({
      projectId: project.id,
      sourceVersionId,
      kind: 'user_brief',
      operationId: begun.operation.id,
      ownerClaimToken: claimToken,
    });
    expect(impact.sourceVersionId).toBe(sourceVersionId);
    expect((await store.getOperation(begun.operation.id))?.status).toBe('succeeded');

    await database.close();
  });

  test('preserves verification evidence and gate on failure and rejects a non-owner claim', async () => {
    const { database, project, store } = await createHarness();
    const snapshotId = randomUUID();
    const compilationId = randomUUID();
    const bundleSnapshotId = randomUUID();
    const approvalId = randomUUID();
    const conversationId = randomUUID();
    const executionId = randomUUID();
    const executionRunId = randomUUID();
    const artifactId = randomUUID();
    await database.query(
      `INSERT INTO remote_agent_conversations
         (id, platform_type, platform_conversation_id, codebase_id)
       VALUES ($1, 'web', $2, $3)`,
      [conversationId, `t05-verification-${randomUUID()}`, project.codebaseId]
    );
    await database.query(
      `INSERT INTO remote_agent_system3_knowledge_snapshots
         (id, project_id, analysis, artifact_key, schema_version, lifecycle_status, quality_status)
       VALUES ($1, $2, '{}', 't05/verification-understanding.json', 3, 'active', 'passed')`,
      [snapshotId, project.id]
    );
    await database.query(
      `INSERT INTO remote_agent_system3_compilations
         (id, project_id, knowledge_snapshot_id, plan, definition_hash, capability_registry_hash)
       VALUES ($1, $2, $3, '{}', 'sha256:t05-definition', 'sha256:t05-capabilities')`,
      [compilationId, project.id, snapshotId]
    );
    await database.query(
      `INSERT INTO remote_agent_system3_workflow_bundle_snapshots
         (id, project_id, compilation_id, activity_id, schema_version, compiler_version,
          template_id, execution_mode, definition, definition_hash)
       VALUES ($1, $2, $3, 'TW-06', 3, 'system3-compiler@3',
               'customer-churn-reference@1', 'full', '{}', 'sha256:t05-bundle')`,
      [bundleSnapshotId, project.id, compilationId]
    );
    await database.query(
      `INSERT INTO remote_agent_system3_approval_manifests
         (id, project_id, compilation_id, idempotency_key, manifest)
       VALUES ($1, $2, $3, 't05-verification-approval', '{}')`,
      [approvalId, project.id, compilationId]
    );
    await database.query(
      `INSERT INTO remote_agent_workflow_runs
         (id, workflow_name, conversation_id, codebase_id, user_message, metadata, working_path)
       VALUES ($1, 'system3-customer-churn-execution', $2, $3, 'fixture execution', '{}', $4)`,
      [executionRunId, conversationId, project.codebaseId, '/tmp/anvil-t05-verification']
    );
    await database.query(
      `INSERT INTO remote_agent_system3_project_executions
         (id, project_id, approval_id, workflow_run_id, definition_hash, bundle_snapshot_id,
          bundle_hash, runtime_bindings, status)
       VALUES ($1, $2, $3, $4, 'sha256:t05-definition', $5,
               'sha256:t05-bundle', '{}', 'completed')`,
      [executionId, project.id, approvalId, executionRunId, bundleSnapshotId]
    );
    const artifactHash = `sha256:${'a'.repeat(64)}`;
    await database.query(
      `INSERT INTO remote_agent_system3_artifact_versions
         (id, project_id, execution_id, artifact_key, artifact_kind, version, content_hash, size_bytes)
       VALUES ($1, $2, $3, 't05/verification-baseline.tar.gz', 'baseline_package', 1, $4, 1)`,
      [artifactId, project.id, executionId, artifactHash]
    );
    await database.query(
      "UPDATE remote_agent_system3_projects SET stage = 'verifying', freshness = 'current' WHERE id = $1",
      [project.id]
    );

    const begun = await store.beginVerification({
      verificationId: randomUUID(),
      projectId: project.id,
      executionId,
      inputArtifactId: artifactId,
      basisHash: artifactHash,
      bundleSnapshotId,
      bundleHash: 'sha256:t05-verification-bundle',
      runtimeBindings: {},
      expectedVersion: project.version,
      idempotencyKey: 't05-verification-failure',
      conversationId,
      codebaseId: project.codebaseId,
      workingPath: '/tmp/anvil-t05-verification',
    });
    const ownerClaimToken = await store.markProjectOperationRunning({
      operationId: begun.operation.id,
      ownerInstanceId: 't05-verification-owner',
    });
    await store.markVerificationRunning(begun.verification.id);
    const evidenceMap = {
      schemaVersion: 1,
      models: [{ model: 'router9/model-a', status: 'failed' }],
    };
    const gate = { status: 'blocked', reason: 'Verification found a failing model.' };

    expect(
      await store.failVerification({
        operationId: begun.operation.id,
        ownerClaimToken: randomUUID(),
        verificationId: begun.verification.id,
        projectId: project.id,
        error: 'stale owner must not write',
        evidenceMap: { models: [] },
        gate: { status: 'passed' },
      })
    ).toBe(false);
    const afterStaleClaim = await store.getVerification(begun.verification.id);
    expect(afterStaleClaim?.status).toBe('running');
    expect(afterStaleClaim?.evidenceMap).toBeNull();
    expect(afterStaleClaim?.gate).toBeNull();

    expect(
      await store.failVerification({
        operationId: begun.operation.id,
        ownerClaimToken,
        verificationId: begun.verification.id,
        projectId: project.id,
        error: 'Verification found a failing model.',
        evidenceMap,
        gate,
      })
    ).toBe(true);
    const failed = await store.getVerification(begun.verification.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.evidenceMap).toEqual(evidenceMap);
    expect(failed?.gate).toEqual(gate);
    expect((await store.getOperation(begun.operation.id))?.status).toBe('failed');

    await database.close();
  });
});
