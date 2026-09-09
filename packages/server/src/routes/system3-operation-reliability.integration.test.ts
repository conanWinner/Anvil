import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAdapter } from '@anvil/core/db/adapters';
import { System3Store, type System3Database, type System3ProjectRecord } from '@anvil/system3';

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
});
