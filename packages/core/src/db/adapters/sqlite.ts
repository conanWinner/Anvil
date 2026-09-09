/**
 * SQLite adapter using bun:sqlite
 */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { IDatabase, QueryResult, SqlDialect } from './types';
import { createLogger } from '@anvil/paths';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.sqlite');
  return cachedLog;
}

export class SqliteAdapter implements IDatabase {
  private db: Database;
  /**
   * bun:sqlite uses one connection per adapter. Keep asynchronous transactions
   * exclusive so a callback which awaits cannot be interleaved by another
   * BEGIN on the same connection.
   */
  private transactionQueue: Promise<void> = Promise.resolve();
  readonly dialect = 'sqlite' as const;
  readonly sql: SqlDialect = sqliteDialect;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrent performance
    this.db.run('PRAGMA journal_mode = WAL');

    // Retry busy locks up to 5s to avoid SQLITE_BUSY during parallel workflows
    this.db.run('PRAGMA busy_timeout = 5000');

    // Enable foreign keys
    this.db.run('PRAGMA foreign_keys = ON');

    // Initialize schema if needed
    this.initSchema();
  }

  async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    // Convert $1, $2, etc. to ? placeholders and reorder params to match
    const { sql: convertedSql, params: reorderedParams } = this.convertPlaceholders(
      sql,
      params ?? []
    );

    try {
      // Determine if this is a SELECT or mutation
      const trimmedSql = sql.trim().toUpperCase();
      const isSelect = trimmedSql.startsWith('SELECT') || trimmedSql.startsWith('WITH');

      // Cast params to SQLite's expected type
      const sqliteParams = reorderedParams as SQLQueryBindings[];

      if (isSelect) {
        const stmt = this.db.prepare(convertedSql);
        const rows = stmt.all(...sqliteParams) as T[];
        return { rows, rowCount: rows.length };
      } else {
        const upperSql = sql.toUpperCase();

        // Handle INSERT with RETURNING using native SQLite RETURNING (3.35+)
        // We must use .all() instead of .run() because .run() discards
        // RETURNING results, and its lastInsertRowid is unreliable when
        // ON CONFLICT DO UPDATE fires.
        if (upperSql.includes('RETURNING') && upperSql.includes('INSERT')) {
          const stmt = this.db.prepare(convertedSql);
          const rows = stmt.all(...sqliteParams) as T[];
          return { rows, rowCount: rows.length };
        }

        // UPDATE/DELETE with RETURNING not supported
        if (upperSql.includes('RETURNING')) {
          throw new Error(
            'SQLite adapter does not support RETURNING clause on UPDATE/DELETE statements. ' +
              `Query: ${convertedSql.substring(0, 100)}... ` +
              'Hint: Use a SELECT before the mutation if you need the row data.'
          );
        }

        // Standard INSERT/UPDATE/DELETE without RETURNING
        const stmt = this.db.prepare(convertedSql);
        const result = stmt.run(...sqliteParams);
        return { rows: [], rowCount: result.changes };
      }
    } catch (error) {
      const err = error as Error;
      getLog().error({ err, sql: convertedSql, params }, 'db.sqlite_query_failed');
      throw error;
    }
  }

  async withTransaction<T>(
    fn: (query: <U>(sql: string, params?: unknown[]) => Promise<QueryResult<U>>) => Promise<T>
  ): Promise<T> {
    const releaseTransactionSlot = await this.acquireTransactionSlot();
    let transactionStarted = false;
    try {
      // Acquire the write reservation before the callback reads state. This
      // serializes check-then-write transactions across SQLite connections,
      // not only through this adapter's in-process queue.
      await this.query('BEGIN IMMEDIATE');
      transactionStarted = true;
      const result = await fn(this.query.bind(this));
      await this.query('COMMIT');
      return result;
    } catch (e) {
      if (transactionStarted) {
        try {
          await this.query('ROLLBACK');
        } catch (rollbackError) {
          getLog().error({ err: rollbackError as Error }, 'db.sqlite_transaction_rollback_failed');
        }
      }
      throw e;
    } finally {
      releaseTransactionSlot();
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  /**
   * Convert PostgreSQL $1, $2 placeholders to SQLite ? placeholders.
   *
   * PostgreSQL uses explicit indices ($1, $2) so params can appear in any order
   * in SQL. SQLite uses positional ? — so params must be reordered to match the
   * left-to-right order of placeholders in the SQL string.
   *
   * Example: SQL has "$2 ... $1" with params [id, json] →
   *   converted SQL: "? ... ?" with reordered params [json, id]
   */
  private convertPlaceholders(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
    // Collect $N placeholders in order of appearance
    const placeholderOrder: number[] = [];
    const convertedSql = sql
      .replace(/\$(\d+)/g, (_match, indexStr: string) => {
        placeholderOrder.push(Number(indexStr));
        return '?';
      })
      .replace(/::jsonb/g, '')
      .replace(/::INTERVAL/g, '');

    // Reorder params to match the positional order of ? in the SQL.
    // $N is 1-based, so $1 → params[0], $2 → params[1], etc.
    const reordered =
      placeholderOrder.length > 0 ? placeholderOrder.map(idx => params[idx - 1]) : params;

    return { sql: convertedSql, params: reordered };
  }

  private async acquireTransactionSlot(): Promise<() => void> {
    const previousTransaction = this.transactionQueue;
    let releaseTransactionSlot: (() => void) | undefined;
    this.transactionQueue = new Promise<void>(resolve => {
      releaseTransactionSlot = resolve;
    });
    await previousTransaction;
    return () => releaseTransactionSlot?.();
  }

  /**
   * Initialize database schema.
   * Always runs createSchema() since all statements use IF NOT EXISTS,
   * ensuring new tables from migrations are created in existing databases.
   */
  private initSchema(): void {
    this.createSchema();
    this.migrateColumns();
  }

  /**
   * Add columns to existing tables that predate newer schema additions.
   * SQLite's CREATE TABLE IF NOT EXISTS skips entirely for existing tables,
   * so new columns must be added via ALTER TABLE for databases created before
   * the columns were added to createSchema().
   */
  private migrateColumns(): void {
    // Source Intake lineage and provenance. Keep its index here because an
    // existing source_versions table does not have source_id until these ALTERs run.
    try {
      const sourceVersionCols = this.db
        .prepare("PRAGMA table_info('remote_agent_system3_source_versions')")
        .all() as { name: string }[];
      const sourceVersionColNames = new Set(sourceVersionCols.map(column => column.name));
      const additions: readonly [string, string][] = [
        ['source_id', 'TEXT'],
        ['role', 'TEXT'],
        ['original_filename', 'TEXT'],
        ['media_type', 'TEXT'],
        ['lineage_version', 'INTEGER'],
        ['storage_status', 'TEXT'],
        ['validation_report', 'TEXT'],
        ['created_by_user_id', 'TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL'],
        ['origin', 'TEXT'],
        ['operation_id', 'TEXT'],
        ['intake_report_artifact_id', 'TEXT'],
      ];
      for (const [name, definition] of additions) {
        if (!sourceVersionColNames.has(name)) {
          this.db.run(
            `ALTER TABLE remote_agent_system3_source_versions ADD COLUMN ${name} ${definition}`
          );
        }
      }
      const legacySourceGroups = this.db
        .prepare(
          `SELECT DISTINCT version.project_id, version.kind
           FROM remote_agent_system3_source_versions version
           WHERE version.source_id IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM remote_agent_system3_sources source
               WHERE source.project_id = version.project_id AND source.kind = version.kind
             )`
        )
        .all() as { project_id: string; kind: string }[];
      const insertLegacySource = this.db.prepare(
        `INSERT INTO remote_agent_system3_sources
           (id, project_id, kind, role, display_name, status)
         VALUES (?, ?, ?, 'primary', ?, 'active')`
      );
      for (const group of legacySourceGroups) {
        insertLegacySource.run(randomUUID(), group.project_id, group.kind, group.kind);
      }
      this.db.run(`
        UPDATE remote_agent_system3_source_versions
        SET source_id = (
              SELECT source.id FROM remote_agent_system3_sources source
              WHERE source.project_id = remote_agent_system3_source_versions.project_id
                AND source.kind = remote_agent_system3_source_versions.kind
              ORDER BY source.created_at ASC, source.id ASC LIMIT 1
            ),
            role = COALESCE(role, 'primary'),
            original_filename = COALESCE(original_filename, filename),
            media_type = COALESCE(media_type, 'application/octet-stream'),
            lineage_version = COALESCE(lineage_version, version),
            storage_status = COALESCE(storage_status, 'ready'),
            validation_report = COALESCE(
              validation_report,
              '{"schemaVersion":1,"outcome":"accepted","checks":[],"warnings":["Migrated legacy source"]}'
            ),
            origin = COALESCE(origin, 'legacy')
        WHERE source_id IS NULL OR role IS NULL OR lineage_version IS NULL
      `);

      // Early SQLite Source Intake builds generated logical Source ids with
      // lower(hex(randomblob(16))). Those 32-character values are not UUIDs and
      // are rejected by the OP-01 v2 manifest contract. Re-key the parent first,
      // then its Source Versions, so both legacy databases and current FK-enabled
      // schemas converge safely on the same UUID contract.
      const invalidSources = (
        this.db.prepare('SELECT id FROM remote_agent_system3_sources').all() as { id: string }[]
      ).filter(source => !UUID_PATTERN.test(source.id));
      const rekeySource = this.db.transaction((oldSourceId: string, newSourceId: string) => {
        this.db
          .prepare(
            `INSERT INTO remote_agent_system3_sources
               (id, project_id, kind, role, display_name, status,
                created_by_user_id, created_at, updated_at)
             SELECT ?, project_id, kind, role, display_name, status,
                    created_by_user_id, created_at, updated_at
             FROM remote_agent_system3_sources WHERE id = ?`
          )
          .run(newSourceId, oldSourceId);
        this.db
          .prepare(
            'UPDATE remote_agent_system3_source_versions SET source_id = ? WHERE source_id = ?'
          )
          .run(newSourceId, oldSourceId);
        this.db.prepare('DELETE FROM remote_agent_system3_sources WHERE id = ?').run(oldSourceId);
      });
      for (const source of invalidSources) {
        rekeySource(source.id, randomUUID());
      }
      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_system3_source_lineage_versions ON remote_agent_system3_source_versions(source_id, lineage_version DESC)'
      );
      this.db.run(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_system3_source_lineage_version_unique ON remote_agent_system3_source_versions(source_id, lineage_version)'
      );
      const artifactVersionCols = this.db
        .prepare("PRAGMA table_info('remote_agent_system3_artifact_versions')")
        .all() as { name: string }[];
      const artifactVersionColNames = new Set(artifactVersionCols.map(column => column.name));
      for (const [name, definition] of [
        ['source_version_id', 'TEXT'],
        ['operation_id', 'TEXT'],
        ['activity_id', 'TEXT'],
        ['workflow_run_id', 'TEXT'],
        ['workflow_node_id', 'TEXT'],
        ['display_name', 'TEXT'],
        ['summary', 'TEXT'],
        ['media_type', 'TEXT'],
        ['schema_id', 'TEXT'],
        ['schema_version', 'TEXT'],
        ['visibility', 'TEXT'],
        ['status', 'TEXT'],
        ['stale_reason', 'TEXT'],
        ['source_version_ids', 'TEXT'],
        ['parent_resource_ids', 'TEXT'],
      ] as const) {
        if (!artifactVersionColNames.has(name)) {
          this.db.run(
            `ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN ${name} ${definition}`
          );
        }
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_system3_source_intake_failed');
    }

    // Users columns. `role` is the web-auth identity seam (default 'admin').
    // Better Auth's own tables are PostgreSQL-only — web auth is never enabled
    // on SQLite — so only the role column is backfilled here.
    try {
      const userCols = this.db.prepare("PRAGMA table_info('remote_agent_users')").all() as {
        name: string;
      }[];
      const userColNames = new Set(userCols.map(c => c.name));
      if (!userColNames.has('role')) {
        this.db.run("ALTER TABLE remote_agent_users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_users_columns_failed');
    }

    // Codebases columns
    try {
      const codebaseCols = this.db.prepare("PRAGMA table_info('remote_agent_codebases')").all() as {
        name: string;
      }[];
      const codebaseColNames = new Set(codebaseCols.map(c => c.name));

      if (!codebaseColNames.has('default_branch')) {
        this.db.run('ALTER TABLE remote_agent_codebases ADD COLUMN default_branch TEXT');
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_codebases_columns_failed');
    }

    // Conversations columns
    try {
      const cols = this.db.prepare("PRAGMA table_info('remote_agent_conversations')").all() as {
        name: string;
      }[];
      const colNames = new Set(cols.map(c => c.name));

      if (!colNames.has('title')) {
        this.db.run('ALTER TABLE remote_agent_conversations ADD COLUMN title TEXT');
      }
      if (!colNames.has('deleted_at')) {
        this.db.run('ALTER TABLE remote_agent_conversations ADD COLUMN deleted_at TEXT');
      }
      if (!colNames.has('hidden')) {
        this.db.run('ALTER TABLE remote_agent_conversations ADD COLUMN hidden INTEGER DEFAULT 0');
      }
      if (!colNames.has('user_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_conversations ADD COLUMN user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL'
        );
      }
      if (!colNames.has('client_request_id')) {
        this.db.run('ALTER TABLE remote_agent_conversations ADD COLUMN client_request_id TEXT');
      }
      // Index must be created here, not in createSchema(): the column doesn't
      // exist on pre-0.4.0 databases until the ALTER TABLE above runs, and
      // CREATE INDEX on a missing column aborts the entire createSchema()
      // exec block. Idempotent so it's safe to run unconditionally.
      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON remote_agent_conversations(user_id) WHERE user_id IS NOT NULL'
      );
      this.db.run(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_client_request_id ON remote_agent_conversations(client_request_id) WHERE client_request_id IS NOT NULL'
      );
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_conversations_columns_failed');
    }

    // Workflow runs columns
    try {
      const wfCols = this.db.prepare("PRAGMA table_info('remote_agent_workflow_runs')").all() as {
        name: string;
      }[];
      const wfColNames = new Set(wfCols.map(c => c.name));

      if (!wfColNames.has('parent_conversation_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_workflow_runs ADD COLUMN parent_conversation_id TEXT'
        );
      }

      if (!wfColNames.has('working_path')) {
        this.db.run('ALTER TABLE remote_agent_workflow_runs ADD COLUMN working_path TEXT');
      }

      if (!wfColNames.has('user_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_workflow_runs ADD COLUMN user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL'
        );
      }
      if (!wfColNames.has('parent_workflow_run_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_workflow_runs ADD COLUMN parent_workflow_run_id TEXT REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE'
        );
      }
      if (!wfColNames.has('parent_node_id')) {
        this.db.run('ALTER TABLE remote_agent_workflow_runs ADD COLUMN parent_node_id TEXT');
      }
      // Same rationale as idx_conversations_user_id above.
      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_workflow_runs_user_id ON remote_agent_workflow_runs(user_id) WHERE user_id IS NOT NULL'
      );
      this.db.run(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_parent_node_unique ON remote_agent_workflow_runs(parent_workflow_run_id, parent_node_id) WHERE parent_workflow_run_id IS NOT NULL'
      );
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_workflow_runs_columns_failed');
    }

    // Sessions columns
    try {
      const sessCols = this.db.prepare("PRAGMA table_info('remote_agent_sessions')").all() as {
        name: string;
      }[];
      const sessColNames = new Set(sessCols.map(c => c.name));

      if (!sessColNames.has('ended_reason')) {
        this.db.run('ALTER TABLE remote_agent_sessions ADD COLUMN ended_reason TEXT');
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_session_columns_failed');
    }

    // Messages columns
    try {
      const cols = this.db.prepare("PRAGMA table_info('remote_agent_messages')").all() as {
        name: string;
      }[];
      const colNames = new Set(cols.map(c => c.name));
      if (!colNames.has('user_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_messages ADD COLUMN user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL'
        );
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_messages_columns_failed');
    }

    try {
      const cols = this.db
        .prepare("PRAGMA table_info('remote_agent_workflow_intake_drafts')")
        .all() as { name: string }[];
      const colNames = new Set(cols.map(c => c.name));
      if (!colNames.has('conversation_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_workflow_intake_drafts ADD COLUMN conversation_id TEXT REFERENCES remote_agent_conversations(id) ON DELETE SET NULL'
        );
      }
      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_workflow_intakes_conversation ON remote_agent_workflow_intake_drafts(conversation_id) WHERE conversation_id IS NOT NULL'
      );
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_workflow_intake_columns_failed');
    }

    try {
      const cols = this.db
        .prepare("PRAGMA table_info('remote_agent_system3_knowledge_snapshots')")
        .all() as { name: string }[];
      if (!cols.some(column => column.name === 'workflow_run_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_system3_knowledge_snapshots ADD COLUMN workflow_run_id TEXT REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL'
        );
      }
      const names = new Set(cols.map(column => column.name));
      for (const [column, definition] of [
        ['input_snapshot_id', 'TEXT'],
        ['schema_version', 'INTEGER NOT NULL DEFAULT 1'],
        ['lifecycle_status', 'TEXT'],
        ['quality_status', 'TEXT'],
        ['quality_report', 'TEXT'],
        ['activated_at', 'TEXT'],
        ['activated_by_user_id', 'TEXT'],
      ] as const) {
        if (!names.has(column)) {
          this.db.run(
            `ALTER TABLE remote_agent_system3_knowledge_snapshots ADD COLUMN ${column} ${definition}`
          );
        }
      }
      const inputCols = this.db
        .prepare("PRAGMA table_info('remote_agent_system3_understanding_input_snapshots')")
        .all() as { name: string }[];
      if (!inputCols.some(column => column.name === 'source_refs')) {
        this.db.run(
          'ALTER TABLE remote_agent_system3_understanding_input_snapshots ADD COLUMN source_refs TEXT'
        );
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_system3_snapshot_columns_failed');
    }

    try {
      const inputCols = this.db
        .prepare("PRAGMA table_info('remote_agent_system3_input_snapshots')")
        .all() as { name: string }[];
      if (!inputCols.some(column => column.name === 'runtime_profile_version_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_system3_input_snapshots ADD COLUMN runtime_profile_version_id TEXT REFERENCES remote_agent_system3_runtime_profile_versions(id) ON DELETE RESTRICT'
        );
      }
      const inputs = this.db
        .prepare(
          `SELECT input.id, input.project_id, input.runtime_profile_hash, compilation.plan
           FROM remote_agent_system3_input_snapshots input
           LEFT JOIN remote_agent_system3_compilations compilation
             ON json_extract(compilation.plan, '$.inputSnapshotId') = input.id
           WHERE input.runtime_profile_version_id IS NULL`
        )
        .all() as {
        id: string;
        project_id: string;
        runtime_profile_hash: string;
        plan: string | null;
      }[];
      for (const input of inputs) {
        let profile: unknown = { cpuOnly: true, ramGb: null };
        if (input.plan !== null) {
          const plan = JSON.parse(input.plan) as {
            runtimeProfile?: unknown;
            phases?: { resourceProfile?: unknown }[];
          };
          profile = plan.runtimeProfile ?? plan.phases?.[0]?.resourceProfile ?? profile;
        }
        const profileId = randomUUID();
        this.db.run(
          `INSERT OR IGNORE INTO remote_agent_system3_runtime_profile_versions
            (id, project_id, profile_hash, profile) VALUES (?, ?, ?, ?)`,
          [profileId, input.project_id, input.runtime_profile_hash, JSON.stringify(profile)]
        );
        const stored = this.db
          .prepare(
            `SELECT id FROM remote_agent_system3_runtime_profile_versions
             WHERE project_id = ? AND profile_hash = ?`
          )
          .get(input.project_id, input.runtime_profile_hash) as { id: string } | null;
        if (stored) {
          this.db.run(
            `UPDATE remote_agent_system3_input_snapshots
             SET runtime_profile_version_id = ? WHERE id = ?`,
            [stored.id, input.id]
          );
        }
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_system3_runtime_profiles_failed');
    }

    try {
      const transitionCols = this.db
        .prepare("PRAGMA table_info('remote_agent_system3_project_transitions')")
        .all() as { name: string }[];
      const names = new Set(transitionCols.map(column => column.name));
      const additions: readonly [string, string][] = [
        ['actor_id', 'TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL'],
        ['operation_id', 'TEXT'],
        ['workflow_run_id', 'TEXT REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL'],
        ['entity_type', 'TEXT'],
        ['entity_id', 'TEXT'],
        ['from_attention', 'TEXT'],
        ['to_attention', 'TEXT'],
        ['from_freshness', 'TEXT'],
        ['to_freshness', 'TEXT'],
        ['project_version', 'INTEGER'],
        ['metadata', "TEXT NOT NULL DEFAULT '{}'"],
      ];
      for (const [name, definition] of additions) {
        if (!names.has(name)) {
          this.db.run(
            `ALTER TABLE remote_agent_system3_project_transitions ADD COLUMN ${name} ${definition}`
          );
        }
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_system3_transition_audit_failed');
    }

    // System 3 project operations supersede the legacy execution-only table.
    // SQLite cannot add a NOT NULL column without a default, so existing rows
    // are initialized to zero and immediately converged to the project version.
    try {
      const cols = this.db
        .prepare("PRAGMA table_info('remote_agent_system3_project_operations')")
        .all() as { name: string }[];
      const colNames = new Set(cols.map(column => column.name));
      if (!colNames.has('project_version')) {
        this.db.run(
          'ALTER TABLE remote_agent_system3_project_operations ADD COLUMN project_version INTEGER NOT NULL DEFAULT 0'
        );
      }
      if (!colNames.has('owner_instance_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_system3_project_operations ADD COLUMN owner_instance_id TEXT'
        );
      }
      if (!colNames.has('owner_claim_token')) {
        this.db.run(
          'ALTER TABLE remote_agent_system3_project_operations ADD COLUMN owner_claim_token TEXT'
        );
      }
      if (!colNames.has('heartbeat_at')) {
        this.db.run(
          'ALTER TABLE remote_agent_system3_project_operations ADD COLUMN heartbeat_at TEXT'
        );
      }
      if (!colNames.has('started_at')) {
        this.db.run(
          'ALTER TABLE remote_agent_system3_project_operations ADD COLUMN started_at TEXT'
        );
      }
      if (!colNames.has('finished_at')) {
        this.db.run(
          'ALTER TABLE remote_agent_system3_project_operations ADD COLUMN finished_at TEXT'
        );
      }
      this.db.run(
        `UPDATE remote_agent_system3_project_operations
         SET project_version = COALESCE(
           (SELECT project.version FROM remote_agent_system3_projects project
            WHERE project.id = remote_agent_system3_project_operations.project_id),
           project_version
         )
         WHERE project_version = 0`
      );
      this.db.run(
        `INSERT OR IGNORE INTO remote_agent_system3_project_operations
          (id, project_id, operation_type, execution_id, workflow_run_id, status,
           idempotency_key, request_fingerprint, project_version, result, error,
           started_at, finished_at, created_at, updated_at)
         SELECT legacy.id, legacy.project_id, legacy.operation_type, legacy.execution_id,
                execution.workflow_run_id, legacy.status, legacy.idempotency_key,
                'legacy:' || legacy.id, project.version, NULL, legacy.error,
                legacy.created_at,
                CASE WHEN legacy.status IN ('succeeded', 'failed', 'abandoned')
                     THEN legacy.updated_at ELSE NULL END,
                legacy.created_at, legacy.updated_at
         FROM remote_agent_system3_operations legacy
         JOIN remote_agent_system3_project_executions execution ON execution.id = legacy.execution_id
         JOIN remote_agent_system3_projects project ON project.id = legacy.project_id`
      );
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_system3_operations_failed');
    }

    try {
      const evidenceColumns = new Set(
        (
          this.db.prepare("PRAGMA table_info('remote_agent_system3_evidence_records')").all() as {
            name: string;
          }[]
        ).map(column => column.name)
      );
      if (!evidenceColumns.has('verification_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_system3_evidence_records ADD COLUMN verification_id TEXT REFERENCES remote_agent_system3_verifications(id) ON DELETE RESTRICT'
        );
      }
      if (!evidenceColumns.has('validator_version')) {
        this.db.run(
          "ALTER TABLE remote_agent_system3_evidence_records ADD COLUMN validator_version TEXT NOT NULL DEFAULT 'system3-validator@1'"
        );
      }
      if (!evidenceColumns.has('basis_hash')) {
        this.db.run(
          "ALTER TABLE remote_agent_system3_evidence_records ADD COLUMN basis_hash TEXT NOT NULL DEFAULT 'legacy'"
        );
      }
      const deliveryColumns = new Set(
        (
          this.db.prepare("PRAGMA table_info('remote_agent_system3_delivery_manifests')").all() as {
            name: string;
          }[]
        ).map(column => column.name)
      );
      if (!deliveryColumns.has('verification_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_system3_delivery_manifests ADD COLUMN verification_id TEXT REFERENCES remote_agent_system3_verifications(id) ON DELETE RESTRICT'
        );
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_system3_verification_failed');
    }

    // Isolation environments columns
    try {
      const cols = this.db
        .prepare("PRAGMA table_info('remote_agent_isolation_environments')")
        .all() as {
        name: string;
      }[];
      const colNames = new Set(cols.map(c => c.name));
      if (!colNames.has('created_by_user_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_isolation_environments ADD COLUMN created_by_user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL'
        );
      }
    } catch (e: unknown) {
      getLog().warn(
        { err: e as Error },
        'db.sqlite_migration_isolation_environments_columns_failed'
      );
    }

    // #1955: credential rows are vendor-keyed (claude→anthropic, codex→openai,
    // copilot→github-copilot). Idempotent data fix mirroring
    // migrations/000_combined.sql: where both a legacy and a vendor row exist
    // for the same user, the vendor row wins; then legacy rows are renamed.
    // Transactional so a mid-sequence failure can't leave partial renames
    // (matches the Postgres path, which runs inside the schema-apply txn);
    // a failed run is also survivable — reads normalize legacy ids.
    try {
      this.db.run('BEGIN');
      try {
        this.db.run(
          `DELETE FROM remote_agent_user_provider_keys
           WHERE provider IN ('claude', 'codex', 'copilot')
             AND EXISTS (
               SELECT 1 FROM remote_agent_user_provider_keys v
               WHERE v.user_id = remote_agent_user_provider_keys.user_id
                 AND v.provider = CASE remote_agent_user_provider_keys.provider
                   WHEN 'claude' THEN 'anthropic'
                   WHEN 'codex' THEN 'openai'
                   WHEN 'copilot' THEN 'github-copilot'
                 END
             )`
        );
        this.db.run(
          "UPDATE remote_agent_user_provider_keys SET provider = 'anthropic' WHERE provider = 'claude'"
        );
        this.db.run(
          "UPDATE remote_agent_user_provider_keys SET provider = 'openai' WHERE provider = 'codex'"
        );
        this.db.run(
          "UPDATE remote_agent_user_provider_keys SET provider = 'github-copilot' WHERE provider = 'copilot'"
        );
        this.db.run('COMMIT');
      } catch (inner: unknown) {
        this.db.run('ROLLBACK');
        throw inner;
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_provider_key_vendor_ids_failed');
    }
  }

  /**
   * Create all tables.
   *
   * NOTE: NOT NULL constraint changes on existing columns (e.g., branch_name in
   * isolation_environments, user_message in workflow_runs, name in codebases) are only
   * enforced for new databases. For existing databases, CREATE TABLE IF NOT EXISTS is a
   * no-op so the old schema remains. SQLite lacks ALTER COLUMN support; enforcing new
   * constraints on existing tables would require a table rebuild via migrateColumns().
   */
  private createSchema(): void {
    this.db.run(`
      -- Users table (Anvil identity, platform-agnostic)
      CREATE TABLE IF NOT EXISTS remote_agent_users (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        display_name TEXT,
        email TEXT,
        role TEXT NOT NULL DEFAULT 'admin',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- User identities table (per-platform mapping → users.id)
      CREATE TABLE IF NOT EXISTS remote_agent_user_identities (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        platform_user_id TEXT NOT NULL,
        platform_display_name TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(platform, platform_user_id)
      );

      -- User GitHub tokens (per-user device-flow tokens, encrypted at rest) [PR-C]
      CREATE TABLE IF NOT EXISTS remote_agent_user_github_tokens (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
        github_user_id INTEGER NOT NULL,
        github_login TEXT NOT NULL,
        access_token_encrypted TEXT NOT NULL,
        refresh_token_encrypted TEXT,
        access_token_expires_at TEXT,
        refresh_token_expires_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id)
      );

      -- User AI-provider credentials (Phase 2): one row per (user_id, provider).
      -- Exactly one of api_key_encrypted / oauth_creds_encrypted is populated;
      -- the kind column records which. Encrypted at rest with TOKEN_ENCRYPTION_KEY.
      CREATE TABLE IF NOT EXISTS remote_agent_user_provider_keys (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        kind TEXT NOT NULL,
        api_key_encrypted TEXT,
        oauth_creds_encrypted TEXT,
        label TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, provider)
      );

      CREATE TABLE IF NOT EXISTS remote_agent_user_provider_connections (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        api_key_encrypted TEXT,
        oauth_creds_encrypted TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, provider, name)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_provider_connections_one_default
        ON remote_agent_user_provider_connections(user_id, provider)
        WHERE is_default = 1;

      INSERT INTO remote_agent_user_provider_connections
        (id, user_id, provider, name, kind, api_key_encrypted, oauth_creds_encrypted, is_default, created_at, updated_at)
      SELECT id, user_id, provider,
             CASE WHEN label IS NULL OR label = '' THEN provider ELSE label END,
             kind, api_key_encrypted, oauth_creds_encrypted, 1, created_at, updated_at
      FROM remote_agent_user_provider_keys legacy
      WHERE NOT EXISTS (
        SELECT 1 FROM remote_agent_user_provider_connections current
        WHERE current.user_id = legacy.user_id AND current.provider = legacy.provider
      );

      -- User AI preferences (Phase 3): personal model tiers, @custom aliases,
      -- and default assistant. NON-encrypted — model names are not secrets
      -- (mirrors codebase_env_vars, not the provider-key store). One row per
      -- user; cascades on user deletion. tiers/aliases are JSON-as-TEXT (parsed
      -- in the store layer so SQLite and Postgres behave identically).
      CREATE TABLE IF NOT EXISTS remote_agent_user_ai_prefs (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
        tiers TEXT,
        aliases TEXT,
        default_provider TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id)
      );

      -- Codebases table
      CREATE TABLE IF NOT EXISTS remote_agent_codebases (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        name TEXT NOT NULL,
        repository_url TEXT,
        default_cwd TEXT NOT NULL,
        default_branch TEXT,
        ai_assistant_type TEXT DEFAULT 'claude',
        commands TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- Codebase env vars table
      CREATE TABLE IF NOT EXISTS remote_agent_codebase_env_vars (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        codebase_id TEXT NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(codebase_id, key)
      );

      -- Conversations table
      CREATE TABLE IF NOT EXISTS remote_agent_conversations (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        platform_type TEXT NOT NULL,
        platform_conversation_id TEXT NOT NULL,
        client_request_id TEXT,
        ai_assistant_type TEXT DEFAULT 'claude',
        codebase_id TEXT REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
        cwd TEXT,
        isolation_env_id TEXT,
        title TEXT,
        deleted_at TEXT,
        hidden INTEGER DEFAULT 0,
        user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        last_activity_at TEXT DEFAULT (datetime('now')),
        UNIQUE(platform_type, platform_conversation_id)
      );

      -- Sessions table
      CREATE TABLE IF NOT EXISTS remote_agent_sessions (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        conversation_id TEXT NOT NULL REFERENCES remote_agent_conversations(id) ON DELETE CASCADE,
        codebase_id TEXT REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
        ai_assistant_type TEXT NOT NULL DEFAULT 'claude',
        assistant_session_id TEXT,
        active INTEGER DEFAULT 1,
        metadata TEXT DEFAULT '{}',
        started_at TEXT DEFAULT (datetime('now')),
        ended_at TEXT,
        parent_session_id TEXT REFERENCES remote_agent_sessions(id),
        transition_reason TEXT,
        ended_reason TEXT
      );

      -- Isolation environments table
      CREATE TABLE IF NOT EXISTS remote_agent_isolation_environments (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        codebase_id TEXT NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,
        workflow_type TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'worktree',
        working_path TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        created_by_platform TEXT,
        created_by_user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        metadata TEXT DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
        -- Note: uniqueness enforced via partial index below (only active environments)
      );

      -- Partial unique index: only active environments need uniqueness
      CREATE UNIQUE INDEX IF NOT EXISTS unique_active_workflow
        ON remote_agent_isolation_environments (codebase_id, workflow_type, workflow_id)
        WHERE status = 'active';

      -- Workflow runs table
      CREATE TABLE IF NOT EXISTS remote_agent_workflow_runs (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        conversation_id TEXT NOT NULL REFERENCES remote_agent_conversations(id) ON DELETE CASCADE,
        codebase_id TEXT REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
        workflow_name TEXT NOT NULL,
        user_message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        current_step_index INTEGER,
        metadata TEXT DEFAULT '{}',
        parent_conversation_id TEXT REFERENCES remote_agent_conversations(id) ON DELETE SET NULL,
        parent_workflow_run_id TEXT REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
        parent_node_id TEXT,
        user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        started_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        last_activity_at TEXT DEFAULT (datetime('now')),
        working_path TEXT
      );

      -- Workflow events table
      CREATE TABLE IF NOT EXISTS remote_agent_workflow_events (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        workflow_run_id TEXT NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        step_index INTEGER,
        step_name TEXT,
        data TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Messages table (conversation history for Web UI)
      CREATE TABLE IF NOT EXISTS remote_agent_messages (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        conversation_id TEXT NOT NULL REFERENCES remote_agent_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        metadata TEXT DEFAULT '{}',
        user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Per-node provider session IDs persisted across workflow re-runs
      CREATE TABLE IF NOT EXISTS remote_agent_workflow_node_sessions (
        workflow_name TEXT NOT NULL,
        node_id TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        last_run_id TEXT REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (workflow_name, node_id, scope_key, provider)
      );

      -- Durable pre-run workflow intake drafts.
      CREATE TABLE IF NOT EXISTS remote_agent_workflow_intake_drafts (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        codebase_id TEXT NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,
        workflow_name TEXT NOT NULL,
        definition_hash TEXT NOT NULL,
        conversation_id TEXT REFERENCES remote_agent_conversations(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        "values" TEXT NOT NULL DEFAULT '{}',
        current_field TEXT,
        validation_errors TEXT NOT NULL DEFAULT '[]',
        started_run_id TEXT REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
        created_by_user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        updated_by_user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_codebase_env_vars_codebase_id ON remote_agent_codebase_env_vars(codebase_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_platform ON remote_agent_conversations(platform_type, platform_conversation_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_conversation ON remote_agent_sessions(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_active ON remote_agent_sessions(active);
      CREATE INDEX IF NOT EXISTS idx_isolation_codebase ON remote_agent_isolation_environments(codebase_id);
      CREATE INDEX IF NOT EXISTS idx_isolation_workflow ON remote_agent_isolation_environments(workflow_type, workflow_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_conversation ON remote_agent_workflow_runs(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON remote_agent_workflow_runs(status);
      CREATE INDEX IF NOT EXISTS idx_workflow_events_run_id ON remote_agent_workflow_events(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_events_type ON remote_agent_workflow_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_workflow_events_created_at ON remote_agent_workflow_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON remote_agent_messages(conversation_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_workflow_node_sessions_scope ON remote_agent_workflow_node_sessions(scope_key);
      CREATE INDEX IF NOT EXISTS idx_workflow_node_sessions_workflow ON remote_agent_workflow_node_sessions(workflow_name);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_intakes_active_unique
        ON remote_agent_workflow_intake_drafts(codebase_id, workflow_name)
        WHERE status IN ('draft', 'ready', 'starting');
      CREATE INDEX IF NOT EXISTS idx_workflow_intakes_codebase
        ON remote_agent_workflow_intake_drafts(codebase_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS remote_agent_conversation_memory_handoffs (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        codebase_id TEXT NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL UNIQUE REFERENCES remote_agent_conversations(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'processing',
        source_last_message_id TEXT REFERENCES remote_agent_messages(id) ON DELETE SET NULL,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS remote_agent_project_memory_entries (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        codebase_id TEXT NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,
        source_conversation_id TEXT REFERENCES remote_agent_conversations(id) ON DELETE SET NULL,
        handoff_id TEXT REFERENCES remote_agent_conversation_memory_handoffs(id) ON DELETE SET NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'extracted',
        user_edited INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_by_user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        updated_by_user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_project_memory_active
        ON remote_agent_project_memory_entries(codebase_id, pinned DESC, updated_at DESC)
        WHERE active = 1;
      CREATE INDEX IF NOT EXISTS idx_project_memory_source
        ON remote_agent_project_memory_entries(source_conversation_id)
        WHERE source_conversation_id IS NOT NULL;

      -- System 3 Project control plane. Domain state stays separate from the
      -- generic workflow-run tables so it can evolve independently.
      CREATE TABLE IF NOT EXISTS remote_agent_system3_projects (
        id TEXT PRIMARY KEY,
        codebase_id TEXT NOT NULL UNIQUE REFERENCES remote_agent_codebases(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        description TEXT,
        stage TEXT NOT NULL,
        attention TEXT NOT NULL,
        freshness TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        template_id TEXT NOT NULL,
        active_knowledge_snapshot_id TEXT REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        role TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_by_user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_source_versions (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES remote_agent_system3_sources(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        role TEXT NOT NULL,
        filename TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        media_type TEXT NOT NULL,
        version INTEGER NOT NULL,
        lineage_version INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        storage_key TEXT NOT NULL,
        storage_status TEXT NOT NULL DEFAULT 'ready',
        validation_report TEXT NOT NULL,
        created_by_user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        origin TEXT NOT NULL DEFAULT 'web',
        operation_id TEXT,
        intake_report_artifact_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, kind, version),
        UNIQUE(source_id, lineage_version)
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_knowledge_snapshots (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        analysis TEXT NOT NULL,
        artifact_key TEXT NOT NULL,
        workflow_run_id TEXT REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
        input_snapshot_id TEXT,
        schema_version INTEGER NOT NULL DEFAULT 1,
        lifecycle_status TEXT,
        quality_status TEXT,
        quality_report TEXT,
        activated_at TEXT,
        activated_by_user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_readiness_contracts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        knowledge_snapshot_id TEXT NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE RESTRICT,
        workflow_run_id TEXT NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE RESTRICT,
        contract TEXT NOT NULL,
        contract_hash TEXT NOT NULL,
        artifact_key TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_lifecycle_attempts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE RESTRICT,
        sequence INTEGER NOT NULL,
        base_attempt_id TEXT REFERENCES remote_agent_system3_lifecycle_attempts(id) ON DELETE SET NULL,
        start_activity_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        input_mode TEXT NOT NULL,
        basis TEXT NOT NULL,
        preview_hash TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        conversation_id TEXT,
        isolation_environment_id TEXT,
        branch_name TEXT,
        working_path TEXT,
        lifecycle_status TEXT NOT NULL DEFAULT 'active',
        run_status TEXT NOT NULL DEFAULT 'preparing',
        cleanup_status TEXT NOT NULL DEFAULT 'not_started',
        checkpoint_activity_id TEXT,
        next_activity_id TEXT,
        cleanup_manifest TEXT,
        created_by_user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT,
        completed_at TEXT,
        cleaned_at TEXT,
        UNIQUE(project_id, sequence),
        UNIQUE(project_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_system3_lifecycle_attempts_project
        ON remote_agent_system3_lifecycle_attempts(project_id, sequence DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_system3_lifecycle_attempts_one_active
        ON remote_agent_system3_lifecycle_attempts(project_id)
        WHERE lifecycle_status = 'active';
      CREATE TABLE IF NOT EXISTS remote_agent_system3_decisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        knowledge_snapshot_id TEXT NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        question TEXT NOT NULL,
        why TEXT NOT NULL,
        recommendation TEXT NOT NULL,
        options TEXT NOT NULL,
        affected_phases TEXT NOT NULL,
        status TEXT NOT NULL,
        answer TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_system3_sources_project_kind
        ON remote_agent_system3_source_versions(project_id, kind, version DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_snapshots_project
        ON remote_agent_system3_knowledge_snapshots(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_readiness_project
        ON remote_agent_system3_readiness_contracts(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_decisions_project_status
        ON remote_agent_system3_decisions(project_id, status, created_at ASC);
      CREATE TABLE IF NOT EXISTS remote_agent_system3_compilations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        knowledge_snapshot_id TEXT NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE RESTRICT,
        plan TEXT NOT NULL,
        definition_hash TEXT NOT NULL,
        capability_registry_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_system3_compilations_project
        ON remote_agent_system3_compilations(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS remote_agent_system3_product_workflow_versions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        template_id TEXT NOT NULL, definition_hash TEXT NOT NULL, definition TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_system3_workflow_versions_project
        ON remote_agent_system3_product_workflow_versions(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS remote_agent_system3_runtime_profile_versions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        profile_hash TEXT NOT NULL,
        profile TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, profile_hash)
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_input_snapshots (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        knowledge_snapshot_id TEXT NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE RESTRICT,
        source_ids TEXT NOT NULL, source_hashes TEXT NOT NULL,
        runtime_profile_version_id TEXT NOT NULL REFERENCES remote_agent_system3_runtime_profile_versions(id) ON DELETE RESTRICT,
        runtime_profile_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_capability_registry_snapshots (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        registry_hash TEXT NOT NULL, registry TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_compilation_bases (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        compilation_id TEXT NOT NULL UNIQUE REFERENCES remote_agent_system3_compilations(id) ON DELETE CASCADE,
        product_workflow_version_id TEXT NOT NULL REFERENCES remote_agent_system3_product_workflow_versions(id) ON DELETE RESTRICT,
        input_snapshot_id TEXT NOT NULL REFERENCES remote_agent_system3_input_snapshots(id) ON DELETE RESTRICT,
        capability_registry_snapshot_id TEXT NOT NULL REFERENCES remote_agent_system3_capability_registry_snapshots(id) ON DELETE RESTRICT,
        compiler_version TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_execution_plan_snapshots (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        compilation_id TEXT NOT NULL UNIQUE REFERENCES remote_agent_system3_compilations(id) ON DELETE CASCADE,
        definition_hash TEXT NOT NULL, plan TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_workflow_bundle_snapshots (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        compilation_id TEXT NOT NULL REFERENCES remote_agent_system3_compilations(id) ON DELETE CASCADE,
        activity_id TEXT NOT NULL CHECK (activity_id IN ('TW-06', 'TW-07', 'TW-09')),
        schema_version INTEGER NOT NULL,
        compiler_version TEXT NOT NULL,
        template_id TEXT NOT NULL,
        execution_mode TEXT NOT NULL CHECK (execution_mode IN ('full', 'experiment', 'delivery')),
        definition TEXT NOT NULL,
        definition_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(compilation_id, activity_id)
      );
      CREATE INDEX IF NOT EXISTS idx_system3_workflow_bundle_snapshots_project
        ON remote_agent_system3_workflow_bundle_snapshots(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_workflow_bundle_snapshots_compilation
        ON remote_agent_system3_workflow_bundle_snapshots(compilation_id, activity_id);
      CREATE TABLE IF NOT EXISTS remote_agent_system3_project_transitions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        from_stage TEXT, to_stage TEXT NOT NULL,
        actor_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        operation_id TEXT,
        workflow_run_id TEXT REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
        entity_type TEXT, entity_id TEXT,
        from_attention TEXT, to_attention TEXT,
        from_freshness TEXT, to_freshness TEXT,
        project_version INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}',
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_system3_transitions_project
        ON remote_agent_system3_project_transitions(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS remote_agent_system3_approval_manifests (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        compilation_id TEXT NOT NULL REFERENCES remote_agent_system3_compilations(id) ON DELETE RESTRICT,
        idempotency_key TEXT NOT NULL,
        manifest TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_project_executions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        approval_id TEXT NOT NULL REFERENCES remote_agent_system3_approval_manifests(id) ON DELETE RESTRICT,
        workflow_run_id TEXT NOT NULL UNIQUE REFERENCES remote_agent_workflow_runs(id) ON DELETE RESTRICT,
        definition_hash TEXT NOT NULL,
        bundle_snapshot_id TEXT REFERENCES remote_agent_system3_workflow_bundle_snapshots(id) ON DELETE RESTRICT,
        bundle_hash TEXT,
        runtime_bindings TEXT,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_system3_executions_project
        ON remote_agent_system3_project_executions(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS remote_agent_system3_operations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        execution_id TEXT NOT NULL REFERENCES remote_agent_system3_project_executions(id) ON DELETE CASCADE,
        operation_type TEXT NOT NULL,
        status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, operation_type, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_system3_operations_project
        ON remote_agent_system3_operations(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS remote_agent_system3_project_operations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        operation_type TEXT NOT NULL,
        execution_id TEXT REFERENCES remote_agent_system3_project_executions(id) ON DELETE SET NULL,
        workflow_run_id TEXT REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        project_version INTEGER NOT NULL,
        result TEXT,
        error TEXT,
        owner_instance_id TEXT,
        owner_claim_token TEXT,
        heartbeat_at TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, operation_type, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_understanding_input_snapshots (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        operation_id TEXT NOT NULL UNIQUE REFERENCES remote_agent_system3_project_operations(id) ON DELETE CASCADE,
        knowledge_snapshot_id TEXT REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE SET NULL,
        workflow_run_id TEXT REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
        source_ids TEXT NOT NULL,
        source_hashes TEXT NOT NULL,
        source_refs TEXT,
        parser_version TEXT NOT NULL,
        extraction_policy_version TEXT NOT NULL,
        capability_registry_hash TEXT NOT NULL,
        runtime_profile TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_system3_understanding_inputs_project
        ON remote_agent_system3_understanding_input_snapshots(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS remote_agent_system3_source_intake_reports (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        operation_id TEXT NOT NULL UNIQUE REFERENCES remote_agent_system3_project_operations(id) ON DELETE CASCADE,
        source_version_id TEXT REFERENCES remote_agent_system3_source_versions(id) ON DELETE SET NULL,
        artifact_key TEXT NOT NULL,
        report TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_system3_source_intake_reports_project
        ON remote_agent_system3_source_intake_reports(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_project_operations_project
        ON remote_agent_system3_project_operations(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system3_project_operations_status
        ON remote_agent_system3_project_operations(status, updated_at ASC);
      CREATE TABLE IF NOT EXISTS remote_agent_system3_verifications (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        execution_id TEXT NOT NULL REFERENCES remote_agent_system3_project_executions(id) ON DELETE RESTRICT,
        workflow_run_id TEXT NOT NULL UNIQUE REFERENCES remote_agent_workflow_runs(id) ON DELETE RESTRICT,
        input_artifact_id TEXT NOT NULL,
        status TEXT NOT NULL,
        validator_version TEXT NOT NULL,
        basis_hash TEXT NOT NULL,
        bundle_snapshot_id TEXT REFERENCES remote_agent_system3_workflow_bundle_snapshots(id) ON DELETE RESTRICT,
        bundle_hash TEXT,
        runtime_bindings TEXT,
        evidence_map TEXT,
        gate TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_evidence_records (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        execution_id TEXT NOT NULL REFERENCES remote_agent_system3_project_executions(id) ON DELETE CASCADE,
        verification_id TEXT REFERENCES remote_agent_system3_verifications(id) ON DELETE RESTRICT,
        requirement_id TEXT,
        status TEXT NOT NULL,
        validator_version TEXT NOT NULL DEFAULT 'system3-validator@1',
        basis_hash TEXT NOT NULL DEFAULT 'legacy',
        evidence TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_system3_evidence_execution
        ON remote_agent_system3_evidence_records(execution_id, created_at ASC);
      CREATE TABLE IF NOT EXISTS remote_agent_system3_delivery_manifests (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        execution_id TEXT NOT NULL UNIQUE REFERENCES remote_agent_system3_project_executions(id) ON DELETE CASCADE,
        verification_id TEXT REFERENCES remote_agent_system3_verifications(id) ON DELETE RESTRICT,
        package_storage_key TEXT NOT NULL,
        package_filename TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        bundle_snapshot_id TEXT REFERENCES remote_agent_system3_workflow_bundle_snapshots(id) ON DELETE RESTRICT,
        bundle_hash TEXT,
        runtime_bindings TEXT,
        manifest TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_impact_manifests (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        source_version_id TEXT NOT NULL REFERENCES remote_agent_system3_source_versions(id) ON DELETE CASCADE,
        affected_phases TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_system3_impacts_project
        ON remote_agent_system3_impact_manifests(project_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_system3_impacts_source_version
        ON remote_agent_system3_impact_manifests(source_version_id);
      CREATE TABLE IF NOT EXISTS remote_agent_system3_requirements (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        knowledge_snapshot_id TEXT NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE CASCADE,
        requirement_key TEXT NOT NULL, kind TEXT NOT NULL, priority TEXT, source TEXT,
        statement TEXT NOT NULL, acceptance_criterion TEXT NOT NULL, source_pointer TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(knowledge_snapshot_id, requirement_key)
      );
      CREATE INDEX IF NOT EXISTS idx_system3_requirements_project
        ON remote_agent_system3_requirements(project_id, knowledge_snapshot_id);
      CREATE TABLE IF NOT EXISTS remote_agent_system3_knowledge_facts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        knowledge_snapshot_id TEXT NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE CASCADE,
        fact_key TEXT NOT NULL, value TEXT NOT NULL, source_pointer TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(knowledge_snapshot_id, fact_key)
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_open_issues (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        knowledge_snapshot_id TEXT NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE CASCADE,
        issue_key TEXT NOT NULL, title TEXT NOT NULL, source_pointer TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(knowledge_snapshot_id, issue_key)
      );
      CREATE TABLE IF NOT EXISTS remote_agent_system3_dependency_edges (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        from_kind TEXT NOT NULL, from_id TEXT NOT NULL, to_kind TEXT NOT NULL, to_id TEXT NOT NULL,
        reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, from_kind, from_id, to_kind, to_id)
      );
      CREATE INDEX IF NOT EXISTS idx_system3_dependency_edges_project
        ON remote_agent_system3_dependency_edges(project_id, from_kind, from_id);
      CREATE TABLE IF NOT EXISTS remote_agent_system3_artifact_versions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
        execution_id TEXT REFERENCES remote_agent_system3_project_executions(id) ON DELETE CASCADE,
        knowledge_snapshot_id TEXT REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE CASCADE,
        source_version_id TEXT REFERENCES remote_agent_system3_source_versions(id) ON DELETE SET NULL,
        operation_id TEXT REFERENCES remote_agent_system3_project_operations(id) ON DELETE SET NULL,
        artifact_key TEXT NOT NULL, artifact_kind TEXT NOT NULL, version INTEGER NOT NULL,
        content_hash TEXT NOT NULL, size_bytes INTEGER NOT NULL,
        activity_id TEXT, workflow_run_id TEXT, workflow_node_id TEXT,
        display_name TEXT, summary TEXT, media_type TEXT, schema_id TEXT, schema_version TEXT,
        visibility TEXT, status TEXT, stale_reason TEXT,
        source_version_ids TEXT, parent_resource_ids TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, artifact_key, version)
      );
      CREATE INDEX IF NOT EXISTS idx_system3_artifacts_project
        ON remote_agent_system3_artifact_versions(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_parent_conv ON remote_agent_workflow_runs(parent_conversation_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_hidden ON remote_agent_conversations(hidden);
      DROP INDEX IF EXISTS idx_conversations_codebase;
      CREATE INDEX IF NOT EXISTS idx_conversations_codebase ON remote_agent_conversations(codebase_id) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_conversations_isolation_env_id ON remote_agent_conversations(isolation_env_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_codebase ON remote_agent_sessions(codebase_id);
      CREATE INDEX IF NOT EXISTS idx_isolation_env_status ON remote_agent_isolation_environments(status);

      -- From PG migration 009: staleness detection for running workflows
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_last_activity
        ON remote_agent_workflow_runs(last_activity_at) WHERE status = 'running';

      -- From PG migration 010: session audit trail
      CREATE INDEX IF NOT EXISTS idx_sessions_parent
        ON remote_agent_sessions(parent_session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_conversation_started
        ON remote_agent_sessions(conversation_id, started_at DESC);

      -- User identity index. user_identities is a new table created above
      -- so its user_id column always exists. Indexes for the user_id columns
      -- added by migrateColumns() onto pre-existing tables (conversations,
      -- workflow_runs) are created there, alongside the ALTER TABLE — see
      -- the comment in migrateColumns() for why this is order-sensitive.
      CREATE INDEX IF NOT EXISTS idx_user_identities_user_id
        ON remote_agent_user_identities(user_id);
    `);
    getLog().info('db.sqlite_schema_initialized');
  }
}

/**
 * SQLite SQL dialect helpers
 */
export const sqliteDialect: SqlDialect = {
  generateUuid(): string {
    return crypto.randomUUID();
  },

  now(): string {
    return "datetime('now')";
  },

  jsonMerge(column: string, paramIndex: number): string {
    // SQLite json_patch: merges two JSON objects
    // Use $N placeholder (not raw ?) so convertPlaceholders can reorder params correctly
    return `json_patch(${column}, $${String(paramIndex)})`;
  },

  jsonArrayContains(column: string, path: string, paramIndex: number): string {
    // SQLite: check if JSON array contains value using instr
    // Use $N placeholder for consistent param ordering
    return `instr(json_extract(${column}, '$.${path}'), $${String(paramIndex)}) > 0`;
  },

  nowMinusDays(paramIndex: number): string {
    return `datetime('now', '-' || $${String(paramIndex)} || ' days')`;
  },

  daysSince(column: string): string {
    return `(julianday('now') - julianday(${column}))`;
  },
};
