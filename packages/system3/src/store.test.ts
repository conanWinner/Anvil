import { describe, expect, mock, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { System3ConflictError, System3Store, type System3Database } from './store';
import { detectSystem3SourceChange } from './change-detection';

const operationRow = {
  id: 'operation-1',
  project_id: 'project-1',
  execution_id: 'execution-1',
  operation_type: 'execute' as const,
  status: 'running' as const,
  idempotency_key: 'execute-key',
  request_fingerprint: 'legacy:operation-1',
  project_version: 2,
  result: null,
  error: null,
  owner_instance_id: 'server-1',
  heartbeat_at: '2026-07-21T00:00:00.000Z',
  started_at: '2026-07-21T00:00:00.000Z',
  finished_at: null,
  created_at: '2026-07-21T00:00:00.000Z',
  updated_at: '2026-07-21T00:00:00.000Z',
  workflow_run_id: 'run-1',
};

const projectOperationRow = {
  id: '00000000-0000-4000-8000-000000000111',
  project_id: 'project-1',
  execution_id: null,
  workflow_run_id: null,
  operation_type: 'compile' as const,
  status: 'accepted' as const,
  idempotency_key: 'compile-key',
  request_fingerprint: 'sha256:fingerprint',
  project_version: 2,
  result: null,
  error: null,
  owner_instance_id: null,
  heartbeat_at: null,
  started_at: null,
  finished_at: null,
  created_at: '2026-07-21T00:00:00.000Z',
  updated_at: '2026-07-21T00:00:00.000Z',
};

function databaseForStatus(status: string): {
  database: System3Database;
  statements: string[];
} {
  const statements: string[] = [];
  const query = mock(async (sql: string) => {
    statements.push(sql);
    if (sql.includes('SELECT * FROM remote_agent_system3_project_operations')) {
      return { rows: [{ ...operationRow, status }], rowCount: 1 };
    }
    if (sql.includes('UPDATE remote_agent_system3_project_operations')) {
      return {
        rows: [
          {
            ...operationRow,
            status: 'abandoned',
            error: 'User abandoned the operation after its owning process became unknown',
            finished_at: '2026-07-21T00:01:00.000Z',
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('SELECT stage, attention, freshness, version')) {
      return {
        rows: [{ stage: 'executing', attention: 'none', freshness: 'current', version: 2 }],
        rowCount: 1,
      };
    }
    if (sql.includes('SELECT stage FROM remote_agent_system3_projects')) {
      return { rows: [{ stage: 'executing' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  return {
    statements,
    database: {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    },
  };
}

describe('System3Store operation recovery', () => {
  test('explicitly abandons the System 3 operation and its generic workflow run', async () => {
    const { database, statements } = databaseForStatus('running');
    const operation = await new System3Store(database).abandonUnknownOperation('operation-1');

    expect(operation.status).toBe('abandoned');
    expect(statements.some(sql => sql.includes("SET status = 'cancelled'"))).toBe(true);
    expect(statements.some(sql => sql.includes("SET status = 'failed'"))).toBe(true);
    expect(statements.some(sql => sql.includes('remote_agent_system3_project_transitions'))).toBe(
      true
    );
  });

  test('is idempotent after the operation has already been abandoned', async () => {
    const { database, statements } = databaseForStatus('abandoned');
    const operation = await new System3Store(database).abandonUnknownOperation('operation-1');

    expect(operation.status).toBe('abandoned');
    expect(
      statements.filter(sql => sql.includes('UPDATE remote_agent_system3_project_operations'))
    ).toHaveLength(0);
  });

  test('rejects abandoning a terminal operation', async () => {
    const { database } = databaseForStatus('succeeded');
    await expect(
      new System3Store(database).abandonUnknownOperation('operation-1')
    ).rejects.toBeInstanceOf(System3ConflictError);
  });

  test('takes over a running operation only through an explicit resume call', async () => {
    const statements: string[] = [];
    let resumed = false;
    const query = mock(async (sql: string) => {
      statements.push(sql);
      if (sql.includes('SELECT * FROM remote_agent_system3_project_operations')) {
        return {
          rows: [
            {
              ...operationRow,
              operation_type: 'source_intake',
              status: resumed ? 'accepted' : 'running',
              owner_instance_id: resumed ? null : operationRow.owner_instance_id,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("SET status = 'accepted'")) {
        resumed = true;
        return {
          rows: [],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };

    const resumedOperation = await new System3Store(database).resumeProjectOperationExplicitly(
      operationRow.id
    );

    expect(resumedOperation.status).toBe('accepted');
    expect(
      statements.some(
        sql =>
          sql.includes("status IN ('accepted', 'running', 'failed')") &&
          sql.includes('owner_instance_id = NULL')
      )
    ).toBe(true);
  });

  test('refuses takeover or abandonment while the durable heartbeat is fresh', async () => {
    const query = mock(async (sql: string) => {
      if (sql.includes('SELECT * FROM remote_agent_system3_project_operations')) {
        return {
          rows: [{ ...operationRow, heartbeat_at: new Date().toISOString() }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };
    const store = new System3Store(database);

    await expect(store.resumeProjectOperationExplicitly(operationRow.id)).rejects.toThrow(
      'still responsive'
    );
    await expect(store.abandonUnknownOperation(operationRow.id)).rejects.toThrow(
      'still responsive'
    );
  });

  test('treats a fresh SQLite CURRENT_TIMESTAMP heartbeat as a responsive owner', async () => {
    const sqliteHeartbeat = new Date()
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d{3}Z$/, '');
    const query = mock(async (sql: string) => {
      if (sql.includes('SELECT * FROM remote_agent_system3_project_operations')) {
        return {
          rows: [{ ...operationRow, heartbeat_at: sqliteHeartbeat }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };
    const store = new System3Store(database);

    await expect(store.resumeProjectOperationExplicitly(operationRow.id)).rejects.toThrow(
      'still responsive'
    );
    await expect(store.abandonUnknownOperation(operationRow.id)).rejects.toThrow(
      'still responsive'
    );
  });
});

describe('System3Store workflow bundle snapshots', () => {
  test('loads a persisted bundle only through its project and compilation lineage', async () => {
    const snapshotRow = {
      id: '00000000-0000-4000-8000-000000000701',
      project_id: '00000000-0000-4000-8000-000000000702',
      compilation_id: '00000000-0000-4000-8000-000000000703',
      activity_id: 'TW-06',
      schema_version: 3,
      compiler_version: 'system3-compiler@3',
      template_id: 'customer-churn-reference@1',
      execution_mode: 'full',
      definition: JSON.stringify({
        schemaVersion: 3,
        compilerVersion: 'system3-compiler@3',
        activityId: 'TW-06',
        executionMode: 'full',
        rootWorkflow: 'system3-customer-churn-execution',
        workflows: [{ name: 'system3-customer-churn-execution' }],
        runtimeBindings: [],
        capabilityRegistry: {},
        permissions: [],
        runtimeProfile: { cpuOnly: true, ramGb: null },
        dependencies: {},
        inputMappings: {},
        outputMappings: {},
        outputSchemas: {},
        timeouts: {},
      }),
      definition_hash: `sha256:${'a'.repeat(64)}`,
      created_at: '2026-09-07T00:00:00.000Z',
    };
    const database: System3Database = {
      dialect: 'sqlite',
      query: mock(async (sql: string) => {
        if (sql.includes('SELECT * FROM remote_agent_system3_workflow_bundle_snapshots')) {
          return { rows: [snapshotRow], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      withTransaction: async callback => callback(async () => ({ rows: [], rowCount: 0 })),
    };

    const snapshot = await new System3Store(database).getWorkflowBundleSnapshot({
      projectId: snapshotRow.project_id,
      compilationId: snapshotRow.compilation_id,
      activityId: 'TW-06',
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.id).toBe(snapshotRow.id);
    expect(snapshot?.definitionHash).toBe(snapshotRow.definition_hash);
    expect(snapshot?.activityId).toBe('TW-06');
  });
});

describe('System3Store Impact Manifest V3', () => {
  test('persists the immutable detector basis and stales an exact affected resource', async () => {
    const statements: string[] = [];
    const query = mock(async (sql: string, params: unknown[] = []) => {
      statements.push(sql);
      if (sql.includes('SELECT * FROM remote_agent_system3_impact_manifests')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO remote_agent_system3_impact_manifests')) {
        return {
          rows: [
            {
              id: params[0],
              project_id: params[1],
              source_version_id: params[2],
              operation_id: params[3],
              previous_source_version_id: params[4],
              schema_version: params[5],
              detector_version: params[6],
              basis_hash: params[7],
              manifest_hash: params[8],
              manifest: params[9],
              affected_phases: params[10],
              reason: params[11],
              created_at: '2026-07-29T00:00:00.000Z',
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const database: System3Database = {
      dialect: 'postgres',
      query,
      withTransaction: async callback => callback(query),
    };
    const projectId = '00000000-0000-4000-8000-000000000201';
    const operationId = '00000000-0000-4000-8000-000000000202';
    const sourceVersionId = '00000000-0000-4000-8000-000000000203';
    const manifest = await detectSystem3SourceChange({
      projectId,
      operationId,
      current: {
        id: sourceVersionId,
        sourceId: '00000000-0000-4000-8000-000000000204',
        kind: 'blueprint',
        filename: 'blueprint.md',
        mediaType: 'text/markdown',
        contentHash: `sha256:${'a'.repeat(64)}`,
        bytes: new TextEncoder().encode('**Business Goal:** Retain customers'),
      },
      previous: null,
      knowledgeSnapshotId: null,
      targetColumn: null,
      resources: [
        {
          resourceType: 'knowledge_snapshot',
          resourceId: '00000000-0000-4000-8000-000000000205',
          activityId: 'TW-02',
          sourceVersionIds: [],
          status: 'current',
        },
      ],
      now: '2026-07-29T00:00:00.000Z',
    });

    const impact = await new System3Store(database).recordSourceImpact({
      projectId,
      sourceVersionId,
      kind: 'blueprint',
      operationId,
      previousSourceVersionId: null,
      manifest,
    });

    expect(impact.schemaVersion).toBe(3);
    expect(impact.manifest?.detectorVersion).toBe('system3-change-detector@3');
    expect(impact.basisHash).toStartWith('sha256:');
    expect(
      statements.some(
        sql => sql.includes('id IN (') && sql.includes('remote_agent_system3_artifact_versions')
      )
    ).toBe(true);
  });
});

describe('System3Store project operations', () => {
  test('creates a durable non-execution operation with a request fingerprint', async () => {
    const statements: string[] = [];
    const query = mock(async (sql: string) => {
      statements.push(sql);
      if (sql.includes('SELECT * FROM remote_agent_system3_project_operations')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO remote_agent_system3_project_operations')) {
        return { rows: [projectOperationRow], rowCount: 1 };
      }
      if (sql.includes('SELECT version FROM remote_agent_system3_projects')) {
        return { rows: [{ version: 2 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };

    const result = await new System3Store(database).beginProjectOperation({
      projectId: 'project-1',
      type: 'compile',
      idempotencyKey: 'compile-key',
      request: { expectedVersion: 2 },
      expectedVersion: 2,
    });

    expect(result.existing).toBe(false);
    expect(result.operation.executionId).toBeNull();
    expect(result.operation.type).toBe('compile');
    expect(result.operation.requestFingerprint).toStartWith('sha256:');
    expect(statements.some(sql => sql.includes('project_operations'))).toBe(true);
  });

  test('returns an exact prior request before consulting the newer project version', async () => {
    const statements: string[] = [];
    const fingerprint = `sha256:${createHash('sha256')
      .update('{"expectedVersion":2}')
      .digest('hex')}`;
    const query = mock(async (sql: string) => {
      statements.push(sql);
      if (sql.includes('SELECT * FROM remote_agent_system3_project_operations')) {
        return {
          rows: [{ ...projectOperationRow, request_fingerprint: fingerprint }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };

    const replay = await new System3Store(database).getProjectOperationReplay({
      projectId: 'project-1',
      type: 'compile',
      idempotencyKey: 'compile-key',
      request: { expectedVersion: 2 },
    });

    expect(replay?.id).toBe(projectOperationRow.id);
    expect(
      statements.some(sql => sql.includes('SELECT version FROM remote_agent_system3_projects'))
    ).toBe(false);
  });

  test('rejects reuse of an operation key with a different request', async () => {
    const query = mock(async (sql: string) => {
      if (sql.includes('SELECT * FROM remote_agent_system3_project_operations')) {
        return { rows: [projectOperationRow], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };

    await expect(
      new System3Store(database).getProjectOperationReplay({
        projectId: 'project-1',
        type: 'compile',
        idempotencyKey: 'compile-key',
        request: { expectedVersion: 3 },
      })
    ).rejects.toBeInstanceOf(System3ConflictError);
  });
});

describe('System3Store operation ownership fencing', () => {
  test('treats SQLite CURRENT_TIMESTAMP operation values as UTC', async () => {
    const query = mock(async (sql: string) => {
      if (sql.includes('SELECT * FROM remote_agent_system3_project_operations')) {
        return {
          rows: [
            {
              ...operationRow,
              heartbeat_at: '2026-09-08 14:34:54',
              created_at: '2026-09-08 14:34:54',
              updated_at: '2026-09-08 14:34:54',
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };

    const operation = await new System3Store(database).getOperation(operationRow.id);

    expect(operation?.heartbeatAt).toBe('2026-09-08T14:34:54.000Z');
    expect(operation?.createdAt).toBe('2026-09-08T14:34:54.000Z');
  });

  test('issues a unique claim token only when the accepted operation is won', async () => {
    let claimAttempts = 0;
    const query = mock(async (sql: string) => {
      if (sql.includes("SET status = 'running'") && sql.includes('owner_claim_token')) {
        claimAttempts += 1;
        return { rows: [], rowCount: claimAttempts === 1 ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };
    const store = new System3Store(database);

    const token = await store.markProjectOperationRunning({
      operationId: 'operation-1',
      ownerInstanceId: 'server-1',
    });

    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    await expect(
      store.markProjectOperationRunning({
        operationId: 'operation-1',
        ownerInstanceId: 'server-2',
      })
    ).rejects.toBeInstanceOf(System3ConflictError);
  });

  test('rejects progress and completion after the worker loses its claim', async () => {
    const query = mock(async () => ({ rows: [], rowCount: 0 }));
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };
    const store = new System3Store(database);

    await expect(
      store.recordProjectOperationProgress('operation-1', 'stale-token', { stage: 'late' })
    ).rejects.toBeInstanceOf(System3ConflictError);
    await expect(
      store.completeProjectOperation('operation-1', 'stale-token', { output: 'late' })
    ).rejects.toBeInstanceOf(System3ConflictError);
    expect(await store.failProjectOperation('operation-1', 'stale-token', 'late error')).toBe(
      false
    );
  });

  test('blocks delivery domain writes before inserting when its claim is stale', async () => {
    const statements: string[] = [];
    const query = mock(async (sql: string) => {
      statements.push(sql);
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };

    await expect(
      new System3Store(database).completeDelivery({
        deliveryId: 'delivery-1',
        operationId: 'operation-1',
        ownerClaimToken: 'stale-token',
        projectId: 'project-1',
        executionId: 'execution-1',
        verificationId: 'verification-1',
        bundleSnapshotId: 'bundle-1',
        bundleHash: 'sha256:bundle',
        runtimeBindings: {},
        delivery: {
          packageStorageKey: 'deliveries/package.tar.gz',
          packageFilename: 'package.tar.gz',
          contentHash: `sha256:${'a'.repeat(64)}`,
          sizeBytes: 1,
          manifest: {},
        },
      })
    ).rejects.toBeInstanceOf(System3ConflictError);
    expect(
      statements.some(sql => sql.includes('INSERT INTO remote_agent_system3_delivery_manifests'))
    ).toBe(false);
  });

  test('blocks control-plane domain writes before any insert when their claim is stale', async () => {
    const statements: string[] = [];
    const query = mock(async (sql: string) => {
      statements.push(sql);
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };
    const store = new System3Store(database);

    await expect(
      store.recordSourceImpact({
        projectId: 'project-1',
        sourceVersionId: 'source-version-1',
        kind: 'blueprint',
        operationId: 'operation-1',
        ownerClaimToken: 'stale-token',
      })
    ).rejects.toBeInstanceOf(System3ConflictError);
    await expect(
      store.saveUnderstandingCandidate({
        projectId: 'project-1',
        analysis: {} as never,
        artifactKey: 'understanding.json',
        workflowRunId: 'run-1',
        expectedVersion: 1,
        inputSnapshotId: 'input-1',
        sourceVersionIds: ['source-version-1'],
        qualityReport: {} as never,
        reportArtifacts: [],
        operation: { id: 'operation-2', ownerClaimToken: 'stale-token' },
      })
    ).rejects.toBeInstanceOf(System3ConflictError);
    await expect(
      store.activateUnderstandingCandidate({
        projectId: 'project-1',
        snapshotId: 'snapshot-1',
        expectedVersion: 1,
        actorId: null,
        operation: { id: 'operation-3', ownerClaimToken: 'stale-token' },
      })
    ).rejects.toBeInstanceOf(System3ConflictError);
    await expect(
      store.saveReadinessContract({
        projectId: 'project-1',
        knowledgeSnapshotId: 'snapshot-1',
        workflowRunId: 'run-1',
        contract: {},
        artifactKey: 'readiness.json',
        expectedVersion: 1,
        operation: { id: 'operation-4', ownerClaimToken: 'stale-token', result: {} },
      })
    ).rejects.toBeInstanceOf(System3ConflictError);
    await expect(
      store.saveCompilation({
        id: 'compilation-1',
        projectId: 'project-1',
        knowledgeSnapshotId: 'snapshot-1',
        plan: {} as never,
        definitionHash: 'sha256:definition',
        capabilityRegistryHash: 'sha256:capabilities',
        workflowBundleSnapshots: [],
        expectedVersion: 1,
        operation: { id: 'operation-5', ownerClaimToken: 'stale-token' },
      })
    ).rejects.toBeInstanceOf(System3ConflictError);
    await expect(
      store.addSource({
        projectId: 'project-1',
        kind: 'blueprint',
        role: 'primary',
        filename: 'blueprint.md',
        originalFilename: 'blueprint.md',
        mediaType: 'text/markdown',
        contentHash: 'sha256:source',
        sizeBytes: 1,
        storageKey: 'sources/blueprint.md',
        validationReport: {} as never,
        origin: 'web',
        operationId: 'operation-6',
        ownerClaimToken: 'stale-token',
        expectedVersion: 1,
      })
    ).rejects.toBeInstanceOf(System3ConflictError);
    await expect(
      store.finalizeSourceVersion({
        projectId: 'project-1',
        sourceVersionId: 'source-version-1',
        storageKey: 'sources/blueprint.md',
        operationId: 'operation-7',
        ownerClaimToken: 'stale-token',
      })
    ).rejects.toBeInstanceOf(System3ConflictError);
    await expect(
      store.recordSourceIntakeReport({
        projectId: 'project-1',
        operationId: 'operation-8',
        sourceVersionId: null,
        artifactKey: 'operations/OP-00/operation-8/report.json',
        report: {} as never,
        ownerClaimToken: 'stale-token',
      })
    ).rejects.toBeInstanceOf(System3ConflictError);

    expect(statements.some(sql => sql.includes('INSERT INTO'))).toBe(false);
  });
});

describe('System3Store readiness transaction', () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const knowledgeSnapshotId = '22222222-2222-4222-8222-222222222222';
  const datasetSourceVersionId = '33333333-3333-4333-8333-333333333333';
  const contract = {
    schemaVersion: 2 as const,
    status: 'passed' as const,
    knowledgeSnapshotId,
    projectVersion: 4,
    requirementIds: ['FR-001'],
    targetDefinition: 'churn',
    targetColumn: 'churn',
    datasetSourceVersionId,
    runtime: { cpuOnly: true, ramGb: 8 },
    decisions: [],
    checks: [
      {
        id: 'dataset_profile',
        label: 'Dataset Profile',
        status: 'passed' as const,
        message: 'Dataset thật và profile của nó đã được ghim.',
        nextAction: null,
      },
    ],
  };

  test('locks the project and ignores pending decisions from historical snapshots', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const query = mock(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT id FROM remote_agent_system3_projects')) {
        return { rows: [{ id: projectId }], rowCount: 1 };
      }
      if (sql.includes('SELECT * FROM remote_agent_system3_projects')) {
        return {
          rows: [
            {
              id: projectId,
              version: 4,
              active_knowledge_snapshot_id: knowledgeSnapshotId,
              freshness: 'current',
              stage: 'understanding',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('COUNT(*) AS count FROM remote_agent_system3_decisions')) {
        return { rows: [{ count: 0 }], rowCount: 1 };
      }
      if (sql.includes('SELECT version.id FROM remote_agent_system3_source_versions')) {
        return { rows: [{ id: datasetSourceVersionId }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO remote_agent_system3_readiness_contracts')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              project_id: projectId,
              knowledge_snapshot_id: knowledgeSnapshotId,
              workflow_run_id: '55555555-5555-4555-8555-555555555555',
              contract: JSON.stringify(contract),
              contract_hash: `sha256:${'a'.repeat(64)}`,
              artifact_key: 'contracts/readiness/contract.json',
              created_at: '2026-09-08T00:00:00.000Z',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT stage, attention, freshness, version')) {
        return {
          rows: [{ stage: 'understanding', attention: 'none', freshness: 'current', version: 4 }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const database: System3Database = {
      dialect: 'postgres',
      query,
      withTransaction: async callback => callback(query),
    };

    const readiness = await new System3Store(database).saveReadinessContract({
      projectId,
      knowledgeSnapshotId,
      workflowRunId: '55555555-5555-4555-8555-555555555555',
      contract,
      artifactKey: 'contracts/readiness/contract.json',
      expectedVersion: 4,
    });

    expect(readiness.knowledgeSnapshotId).toBe(knowledgeSnapshotId);
    expect(calls[0]?.sql).toContain('CREATE TABLE');
    const lockIndex = calls.findIndex(call => call.sql.includes('FOR UPDATE'));
    const projectReadIndex = calls.findIndex(call =>
      call.sql.includes('SELECT * FROM remote_agent_system3_projects')
    );
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(projectReadIndex);
    const decisionQuery = calls.find(call => call.sql.includes('COUNT(*) AS count'));
    expect(decisionQuery?.sql).toContain('knowledge_snapshot_id = $2');
    expect(decisionQuery?.params).toEqual([projectId, knowledgeSnapshotId]);
  });

  test('rejects a contract when the active Knowledge Snapshot changed before save', async () => {
    const statements: string[] = [];
    const query = mock(async (sql: string) => {
      statements.push(sql);
      if (sql.includes('SELECT id FROM remote_agent_system3_projects')) {
        return { rows: [{ id: projectId }], rowCount: 1 };
      }
      if (sql.includes('SELECT * FROM remote_agent_system3_projects')) {
        return {
          rows: [
            {
              id: projectId,
              version: 4,
              active_knowledge_snapshot_id: '66666666-6666-4666-8666-666666666666',
              freshness: 'current',
              stage: 'understanding',
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'postgres',
      query,
      withTransaction: async callback => callback(query),
    };

    await expect(
      new System3Store(database).saveReadinessContract({
        projectId,
        knowledgeSnapshotId,
        workflowRunId: '55555555-5555-4555-8555-555555555555',
        contract,
        artifactKey: 'contracts/readiness/contract.json',
        expectedVersion: 4,
      })
    ).rejects.toThrow('Knowledge snapshot changed; rerun readiness');
    expect(
      statements.some(sql => sql.includes('INSERT INTO remote_agent_system3_readiness_contracts'))
    ).toBe(false);
  });
});

describe('System3Store delivery idempotency', () => {
  test('replays the original operation when only the newly generated delivery id differs', async () => {
    const requestFingerprint = `sha256:${createHash('sha256')
      .update(
        '{"bundleHash":"sha256:bundle","bundleSnapshotId":"bundle-1","executionId":"execution-1","expectedVersion":7,"runtimeBindings":{},"verificationId":"verification-1"}'
      )
      .digest('hex')}`;
    const existing = {
      ...projectOperationRow,
      id: 'operation-delivery-1',
      project_id: 'project-1',
      execution_id: 'execution-1',
      workflow_run_id: 'workflow-run-1',
      operation_type: 'delivery' as const,
      status: 'succeeded' as const,
      idempotency_key: 'delivery-key',
      request_fingerprint: requestFingerprint,
      project_version: 7,
    };
    const query = mock(async (sql: string) => {
      if (
        sql.includes('remote_agent_system3_project_operations') &&
        sql.includes("operation_type = 'delivery'")
      ) {
        return { rows: [existing], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };

    const replay = await new System3Store(database).beginDelivery({
      deliveryId: 'new-generated-delivery-id',
      projectId: 'project-1',
      executionId: 'execution-1',
      verificationId: 'verification-1',
      bundleSnapshotId: 'bundle-1',
      bundleHash: 'sha256:bundle',
      runtimeBindings: {},
      expectedVersion: 7,
      idempotencyKey: 'delivery-key',
      conversationId: 'conversation-1',
      codebaseId: 'codebase-1',
      workingPath: '/tmp/project-1',
    });

    expect(replay.existing).toBe(true);
    expect(replay.operation.id).toBe(existing.id);
    expect(replay.workflowRun.id).toBe(existing.workflow_run_id);
  });
});

describe('System3Store Lifecycle Attempt', () => {
  test('pins a preview basis and creates the next isolated test attempt', async () => {
    const statements: string[] = [];
    const projectId = '00000000-0000-4000-8000-000000000301';
    const query = mock(async (sql: string, params: unknown[] = []) => {
      statements.push(sql);
      if (sql.includes('SELECT version FROM remote_agent_system3_projects')) {
        return { rows: [{ version: 7 }], rowCount: 1 };
      }
      if (sql.includes('WHERE project_id = $1 AND idempotency_key = $2')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("lifecycle_status = 'active'")) return { rows: [], rowCount: 0 };
      if (sql.includes('MAX(sequence)')) return { rows: [{ next_sequence: 2 }], rowCount: 1 };
      if (sql.includes('INSERT INTO remote_agent_system3_lifecycle_attempts')) {
        return {
          rows: [
            {
              id: params[0],
              project_id: projectId,
              sequence: 2,
              base_attempt_id: null,
              start_activity_id: 'OP-00',
              scope: 'full',
              input_mode: 'replay',
              basis: params[7],
              preview_hash: params[8],
              conversation_id: null,
              isolation_environment_id: null,
              branch_name: null,
              working_path: null,
              lifecycle_status: 'active',
              run_status: 'preparing',
              cleanup_status: 'not_started',
              checkpoint_activity_id: null,
              next_activity_id: null,
              cleanup_manifest: null,
              created_by_user_id: null,
              created_at: '2026-08-03T00:00:00.000Z',
              started_at: null,
              completed_at: null,
              cleaned_at: null,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };
    const attempt = await new System3Store(database).createLifecycleAttempt({
      projectId,
      startActivityId: 'OP-00',
      scope: 'full',
      inputMode: 'replay',
      expectedVersion: 7,
      previewHash: `sha256:${'a'.repeat(64)}`,
      idempotencyKey: 'attempt-create-1',
      basis: {
        schemaVersion: 1,
        sourceVersionIds: ['00000000-0000-4000-8000-000000000302'],
        sourceHashes: [`sha256:${'b'.repeat(64)}`],
        knowledgeSnapshotId: null,
        readinessContractId: null,
        compilationId: null,
        approvalId: null,
        executionId: null,
        verificationId: null,
        baseCommitSha: null,
        resources: {},
      },
    });

    expect(attempt.sequence).toBe(2);
    expect(attempt.runStatus).toBe('preparing');
    expect(attempt.basis.sourceVersionIds).toEqual(['00000000-0000-4000-8000-000000000302']);
    expect(statements.some(sql => sql.includes('idx_system3_lifecycle_attempts_one_active'))).toBe(
      true
    );
  });

  test('does not supersede an attempt that is waiting for the user at a checkpoint', async () => {
    const projectId = '00000000-0000-4000-8000-000000000311';
    const query = mock(async (sql: string) => {
      if (sql.includes('SELECT version FROM remote_agent_system3_projects')) {
        return { rows: [{ version: 7 }], rowCount: 1 };
      }
      if (sql.includes('WHERE project_id = $1 AND idempotency_key = $2')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("lifecycle_status = 'active'")) {
        return { rows: [{ id: 'attempt-waiting', run_status: 'waiting' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };

    await expect(
      new System3Store(database).createLifecycleAttempt({
        projectId,
        startActivityId: 'OP-00',
        scope: 'full',
        inputMode: 'replay',
        expectedVersion: 7,
        previewHash: `sha256:${'c'.repeat(64)}`,
        idempotencyKey: 'attempt-waiting-key',
        basis: {
          schemaVersion: 1,
          sourceVersionIds: [],
          sourceHashes: [],
          knowledgeSnapshotId: null,
          readinessContractId: null,
          compilationId: null,
          approvalId: null,
          executionId: null,
          verificationId: null,
          baseCommitSha: null,
          resources: {},
        },
      })
    ).rejects.toThrow('An active Lifecycle Attempt must be resolved before starting another');
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes("SET lifecycle_status = 'superseded'"))
    ).toBe(false);
  });

  test('clears terminal checkpoint and next activity explicitly', async () => {
    const projectId = '00000000-0000-4000-8000-000000000321';
    const attemptId = '00000000-0000-4000-8000-000000000322';
    const basis = {
      schemaVersion: 1 as const,
      sourceVersionIds: ['00000000-0000-4000-8000-000000000323'],
      sourceHashes: [`sha256:${'d'.repeat(64)}`],
      knowledgeSnapshotId: null,
      readinessContractId: null,
      compilationId: null,
      approvalId: null,
      executionId: null,
      verificationId: null,
      baseCommitSha: null,
      resources: {},
    };
    const existingRow = {
      id: attemptId,
      project_id: projectId,
      sequence: 3,
      base_attempt_id: null,
      start_activity_id: 'TW-03',
      scope: 'activity' as const,
      input_mode: 'current' as const,
      basis: JSON.stringify(basis),
      preview_hash: `sha256:${'e'.repeat(64)}`,
      conversation_id: 'conversation-1',
      isolation_environment_id: 'environment-1',
      branch_name: 'anvil/task-system3-test-run-3',
      working_path: '/tmp/system3-run-3',
      lifecycle_status: 'active' as const,
      run_status: 'waiting' as const,
      cleanup_status: 'not_started' as const,
      checkpoint_activity_id: 'TW-02',
      next_activity_id: 'TW-03',
      cleanup_manifest: null,
      created_by_user_id: null,
      created_at: '2026-08-03T00:00:00.000Z',
      started_at: null,
      completed_at: null,
      cleaned_at: null,
    };
    let updateParams: unknown[] = [];
    let storedRow: Record<string, unknown> = { ...existingRow };
    const query = mock(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('WHERE project_id = $1 AND id = $2')) {
        return { rows: [storedRow], rowCount: 1 };
      }
      if (sql.includes('UPDATE remote_agent_system3_lifecycle_attempts')) {
        updateParams = params;
        storedRow = {
          ...storedRow,
          run_status: 'completed',
          checkpoint_activity_id: params[6] as null,
          next_activity_id: params[7] as null,
          completed_at: '2026-08-03T00:05:00.000Z',
        };
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };

    const updated = await new System3Store(database).updateLifecycleAttempt(projectId, attemptId, {
      runStatus: 'completed',
      checkpointActivityId: null,
      nextActivityId: null,
    });

    expect(updateParams[6]).toBeNull();
    expect(updateParams[7]).toBeNull();
    expect(updated.checkpointActivityId).toBeNull();
    expect(updated.nextActivityId).toBeNull();
  });

  test('detects current project output before deleting an attempt payload', async () => {
    let inspectedParams: unknown[] = [];
    const query = mock(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('artifact_key LIKE')) {
        inspectedParams = params;
        return { rows: [{ found: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };

    const found = await new System3Store(database).hasCurrentLifecycleAttemptPayload(
      '00000000-0000-4000-8000-000000000331',
      '00000000-0000-4000-8000-000000000332'
    );

    expect(found).toBe(true);
    expect(inspectedParams).toEqual([
      '00000000-0000-4000-8000-000000000331',
      'attempts/00000000-0000-4000-8000-000000000332/%',
    ]);
  });
});

describe('System3Store Understanding Input Snapshot', () => {
  test('persists pinned source IDs, hashes and processing basis before TW-02', async () => {
    const statements: string[] = [];
    const row = {
      id: '00000000-0000-4000-8000-000000000401',
      project_id: '00000000-0000-4000-8000-000000000010',
      operation_id: '00000000-0000-4000-8000-000000000402',
      knowledge_snapshot_id: null,
      workflow_run_id: null,
      source_ids: JSON.stringify(['00000000-0000-4000-8000-000000000403']),
      source_hashes: JSON.stringify([
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ]),
      parser_version: 'system3-blueprint-parser@1',
      extraction_policy_version: 'system3-understanding-policy@1',
      capability_registry_hash:
        'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      runtime_profile: JSON.stringify({ mode: 'poc', cpuOnly: true }),
      created_at: '2026-07-29T00:00:00.000Z',
    };
    const query = mock(async (sql: string) => {
      statements.push(sql);
      if (sql.includes('WHERE project_id = $1 AND operation_id = $2')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO remote_agent_system3_understanding_input_snapshots')) {
        return { rows: [row], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };

    const snapshot = await new System3Store(database).createUnderstandingInputSnapshot({
      projectId: row.project_id,
      operationId: row.operation_id,
      sourceIds: ['00000000-0000-4000-8000-000000000403'],
      sourceHashes: ['sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      parserVersion: row.parser_version,
      extractionPolicyVersion: row.extraction_policy_version,
      capabilityRegistryHash: row.capability_registry_hash,
      runtimeProfile: { mode: 'poc', cpuOnly: true },
    });

    expect(snapshot.sourceIds).toEqual(['00000000-0000-4000-8000-000000000403']);
    expect(snapshot.sourceHashes[0]).toStartWith('sha256:');
    expect(snapshot.knowledgeSnapshotId).toBeNull();
    expect(
      statements.some(sql =>
        sql.includes('INSERT INTO remote_agent_system3_understanding_input_snapshots')
      )
    ).toBe(true);
  });

  test('rejects an unpaired source ID and content hash list', async () => {
    const query = mock(async () => ({ rows: [], rowCount: 0 }));
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };

    await expect(
      new System3Store(database).createUnderstandingInputSnapshot({
        projectId: 'project-1',
        operationId: 'operation-1',
        sourceIds: ['source-1'],
        sourceHashes: [],
        parserVersion: 'parser@1',
        extractionPolicyVersion: 'policy@1',
        capabilityRegistryHash: 'sha256:capabilities',
        runtimeProfile: {},
      })
    ).rejects.toThrow('matching source IDs and hashes');
  });
});

describe('System3Store Understanding candidate activation', () => {
  const projectRow = {
    id: 'project-1',
    codebase_id: 'codebase-1',
    name: 'Project',
    description: null,
    stage: 'understanding' as const,
    attention: 'input_required' as const,
    freshness: 'current' as const,
    version: 3,
    template_id: 'customer-churn-reference',
    active_knowledge_snapshot_id: null,
    created_at: '2026-08-02T00:00:00.000Z',
    updated_at: '2026-08-02T00:00:00.000Z',
  };
  const snapshotRow = {
    id: 'snapshot-1',
    project_id: 'project-1',
    analysis: JSON.stringify({}),
    artifact_key: 'understanding/snapshot-1.json',
    workflow_run_id: 'run-1',
    input_snapshot_id: 'input-1',
    schema_version: 2,
    lifecycle_status: 'candidate' as const,
    quality_status: 'passed' as const,
    quality_report: null,
    activated_at: null,
    activated_by_user_id: null,
    created_at: '2026-08-02T00:00:00.000Z',
  };

  test('does not activate a candidate that failed the quality gate', async () => {
    const query = mock(async (sql: string) => {
      if (sql.includes('FROM remote_agent_system3_projects WHERE id')) {
        return { rows: [projectRow], rowCount: 1 };
      }
      if (sql.includes('FROM remote_agent_system3_knowledge_snapshots')) {
        return {
          rows: [{ ...snapshotRow, quality_status: 'revision_required' }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };
    await expect(
      new System3Store(database).activateUnderstandingCandidate({
        projectId: 'project-1',
        snapshotId: 'snapshot-1',
        expectedVersion: 3,
        actorId: null,
      })
    ).rejects.toThrow('quality does not allow activation');
  });

  test('does not activate while a decision from that candidate is pending', async () => {
    const query = mock(async (sql: string) => {
      if (sql.includes('FROM remote_agent_system3_projects WHERE id')) {
        return { rows: [projectRow], rowCount: 1 };
      }
      if (sql.includes('FROM remote_agent_system3_knowledge_snapshots')) {
        return { rows: [snapshotRow], rowCount: 1 };
      }
      if (sql.includes('SELECT COUNT(*) AS count')) {
        return { rows: [{ count: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };
    await expect(
      new System3Store(database).activateUnderstandingCandidate({
        projectId: 'project-1',
        snapshotId: 'snapshot-1',
        expectedVersion: 3,
        actorId: null,
      })
    ).rejects.toThrow('Resolve the candidate decisions');
  });
});

describe('System3Store source lineage', () => {
  test('same hash returns the current immutable version without inserting another row', async () => {
    const statements: string[] = [];
    const sourceRow = {
      id: '00000000-0000-4000-8000-000000000201',
      source_id: '00000000-0000-4000-8000-000000000200',
      project_id: '00000000-0000-4000-8000-000000000010',
      kind: 'blueprint' as const,
      role: 'primary' as const,
      filename: 'project.md',
      original_filename: 'project.md',
      media_type: 'text/markdown',
      version: 1,
      lineage_version: 1,
      content_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      size_bytes: 12,
      storage_key: 'sources/blueprint/hash/project.md',
      storage_status: 'ready' as const,
      validation_report: JSON.stringify({
        schemaVersion: 1,
        outcome: 'accepted',
        checks: [],
        warnings: [],
      }),
      created_by_user_id: null,
      origin: 'test',
      operation_id: '00000000-0000-4000-8000-000000000300',
      created_at: '2026-07-28T00:00:00.000Z',
    };
    const query = mock(async (sql: string) => {
      statements.push(sql);
      if (sql.includes('SELECT stage, freshness, version')) {
        return { rows: [{ stage: 'draft', freshness: 'current', version: 1 }], rowCount: 1 };
      }
      if (sql.includes('SELECT id, kind, role FROM remote_agent_system3_sources')) {
        return {
          rows: [{ id: sourceRow.source_id, kind: sourceRow.kind, role: sourceRow.role }],
          rowCount: 1,
        };
      }
      if (sql.includes('WHERE source_id = $1') && sql.includes('storage_status')) {
        return { rows: [sourceRow], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };

    const result = await new System3Store(database).addSource({
      projectId: sourceRow.project_id,
      sourceId: sourceRow.source_id,
      kind: 'blueprint',
      role: 'primary',
      filename: sourceRow.filename,
      originalFilename: sourceRow.original_filename,
      mediaType: sourceRow.media_type,
      contentHash: sourceRow.content_hash,
      sizeBytes: sourceRow.size_bytes,
      storageKey: sourceRow.storage_key,
      validationReport: { schemaVersion: 1, outcome: 'accepted', checks: [], warnings: [] },
      origin: 'test',
      operationId: '00000000-0000-4000-8000-000000000301',
      expectedVersion: 1,
    });

    expect(result.outcome).toBe('unchanged');
    expect(result.source.id).toBe(sourceRow.id);
    expect(
      statements.some(sql => sql.includes('INSERT INTO remote_agent_system3_source_versions'))
    ).toBe(false);
  });

  test('creates a pending Source Version before storage promotion and does not mutate project state', async () => {
    const statements: string[] = [];
    const pendingRow = {
      id: '00000000-0000-4000-8000-000000000211',
      source_id: '00000000-0000-4000-8000-000000000210',
      project_id: '00000000-0000-4000-8000-000000000010',
      kind: 'blueprint' as const,
      role: 'primary' as const,
      filename: 'project.md',
      original_filename: 'project.md',
      media_type: 'text/markdown',
      version: 1,
      lineage_version: 1,
      content_hash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      size_bytes: 12,
      storage_key: 'sources/blueprint/hash/content',
      storage_status: 'pending' as const,
      validation_report: JSON.stringify({
        schemaVersion: 1,
        outcome: 'accepted',
        checks: [],
        warnings: [],
      }),
      created_by_user_id: null,
      origin: 'test',
      operation_id: '00000000-0000-4000-8000-000000000310',
      intake_report_artifact_id: null,
      created_at: '2026-07-28T00:00:00.000Z',
    };
    const query = mock(async (sql: string) => {
      statements.push(sql);
      if (sql.includes('WHERE project_id = $1 AND operation_id = $2')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('SELECT stage, freshness, version')) {
        return { rows: [{ stage: 'draft', freshness: 'current', version: 1 }], rowCount: 1 };
      }
      if (sql.includes('COUNT(*) AS count')) return { rows: [{ count: 0 }], rowCount: 1 };
      if (sql.includes("role = 'primary'")) return { rows: [], rowCount: 0 };
      if (sql.includes('WHERE source_id = $1') && sql.includes('storage_status')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('SUM(size_bytes)')) return { rows: [{ total: 0 }], rowCount: 1 };
      if (sql.includes('MAX(version)')) return { rows: [{ version: 0 }], rowCount: 1 };
      if (sql.includes('INSERT INTO remote_agent_system3_source_versions')) {
        return { rows: [pendingRow], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };

    const result = await new System3Store(database).addSource({
      projectId: pendingRow.project_id,
      kind: 'blueprint',
      role: 'primary',
      filename: pendingRow.filename,
      originalFilename: pendingRow.original_filename,
      mediaType: pendingRow.media_type,
      contentHash: pendingRow.content_hash,
      sizeBytes: pendingRow.size_bytes,
      storageKey: pendingRow.storage_key,
      validationReport: { schemaVersion: 1, outcome: 'accepted', checks: [], warnings: [] },
      origin: 'test',
      operationId: pendingRow.operation_id,
      expectedVersion: 1,
    });

    expect(result.outcome).toBe('created_source');
    expect(result.source.storageStatus).toBe('pending');
    expect(
      statements.some(
        sql =>
          sql.includes('INSERT INTO remote_agent_system3_source_versions') &&
          sql.includes("'pending'")
      )
    ).toBe(true);
    expect(
      statements.some(sql => sql.includes('INSERT INTO remote_agent_system3_project_transitions'))
    ).toBe(false);
  });

  test('finalizes a pending Source Version and only then records the project transition', async () => {
    const statements: string[] = [];
    const pendingRow = {
      id: '00000000-0000-4000-8000-000000000221',
      source_id: '00000000-0000-4000-8000-000000000220',
      project_id: '00000000-0000-4000-8000-000000000010',
      kind: 'blueprint' as const,
      role: 'primary' as const,
      filename: 'project.md',
      original_filename: 'project.md',
      media_type: 'text/markdown',
      version: 1,
      lineage_version: 1,
      content_hash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      size_bytes: 12,
      storage_key: 'sources/blueprint/hash/content',
      storage_status: 'pending' as const,
      validation_report: JSON.stringify({
        schemaVersion: 1,
        outcome: 'accepted',
        checks: [],
        warnings: [],
      }),
      created_by_user_id: null,
      origin: 'test',
      operation_id: '00000000-0000-4000-8000-000000000320',
      intake_report_artifact_id: null,
      created_at: '2026-07-28T00:00:00.000Z',
    };
    const readyRow = { ...pendingRow, storage_status: 'ready' as const };
    const projectState = {
      stage: 'draft',
      attention: 'input_required',
      freshness: 'current',
      version: 1,
    };
    const query = mock(async (sql: string) => {
      statements.push(sql);
      if (sql.includes('WHERE id = $1 AND project_id = $2 AND operation_id = $3')) {
        return { rows: [pendingRow], rowCount: 1 };
      }
      if (sql.includes('SELECT stage, freshness FROM')) {
        return { rows: [projectState], rowCount: 1 };
      }
      if (sql.includes("storage_status = 'ready' AND id <>")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SET storage_key = $2, storage_status = 'ready'")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT * FROM remote_agent_system3_source_versions WHERE id = $1')) {
        return { rows: [readyRow], rowCount: 1 };
      }
      if (sql.includes('SELECT stage, attention, freshness, version')) {
        return { rows: [projectState], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const database: System3Database = {
      dialect: 'sqlite',
      query,
      withTransaction: async callback => callback(query),
    };

    const result = await new System3Store(database).finalizeSourceVersion({
      projectId: pendingRow.project_id,
      sourceVersionId: pendingRow.id,
      storageKey: pendingRow.storage_key,
      operationId: pendingRow.operation_id,
    });

    expect(result.storageStatus).toBe('ready');
    const readyIndex = statements.findIndex(
      sql =>
        sql.includes('UPDATE remote_agent_system3_source_versions') &&
        sql.includes("storage_status = 'ready'")
    );
    const transitionIndex = statements.findIndex(sql =>
      sql.includes('INSERT INTO remote_agent_system3_project_transitions')
    );
    expect(readyIndex).toBeGreaterThanOrEqual(0);
    expect(transitionIndex).toBeGreaterThan(readyIndex);
  });
});
