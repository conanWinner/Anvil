import { describe, expect, mock, test } from 'bun:test';
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
