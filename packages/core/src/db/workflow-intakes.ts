import { createLogger } from '@anvil/paths';
import { pool, getDialect } from './connection';
import type { WorkflowIntakeDraftRow, WorkflowIntakeDraftStatus } from '../schemas/workflow-intake';

type IntakeValues = Record<string, unknown>;

export interface WorkflowIntakeDraft extends Omit<
  WorkflowIntakeDraftRow,
  'values' | 'validation_errors'
> {
  values: IntakeValues;
  validation_errors: string[];
}

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  cachedLog ??= createLogger('db.workflow-intakes');
  return cachedLog;
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseErrors(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function normalize(row: WorkflowIntakeDraftRow): WorkflowIntakeDraft {
  return {
    ...row,
    values: parseJson(row.values),
    validation_errors: parseErrors(row.validation_errors),
  };
}

export async function getActiveWorkflowIntakeDraft(
  codebaseId: string,
  workflowName: string
): Promise<WorkflowIntakeDraft | null> {
  const result = await pool.query<WorkflowIntakeDraftRow>(
    `SELECT * FROM remote_agent_workflow_intake_drafts
     WHERE codebase_id = $1 AND workflow_name = $2 AND status IN ('draft', 'ready', 'starting')
     ORDER BY updated_at DESC LIMIT 1`,
    [codebaseId, workflowName]
  );
  return result.rows[0] ? normalize(result.rows[0]) : null;
}

export async function getLatestWorkflowIntakeDraft(
  codebaseId: string,
  workflowName: string
): Promise<WorkflowIntakeDraft | null> {
  const result = await pool.query<WorkflowIntakeDraftRow>(
    `SELECT * FROM remote_agent_workflow_intake_drafts
     WHERE codebase_id = $1 AND workflow_name = $2
     ORDER BY updated_at DESC LIMIT 1`,
    [codebaseId, workflowName]
  );
  return result.rows[0] ? normalize(result.rows[0]) : null;
}

export async function getActiveWorkflowIntakeDraftByConversation(
  conversationId: string
): Promise<WorkflowIntakeDraft | null> {
  const result = await pool.query<WorkflowIntakeDraftRow>(
    `SELECT * FROM remote_agent_workflow_intake_drafts
     WHERE conversation_id = $1 AND status IN ('draft', 'ready', 'starting')
     ORDER BY updated_at DESC LIMIT 1`,
    [conversationId]
  );
  return result.rows[0] ? normalize(result.rows[0]) : null;
}

/** Atomically claim a ready draft so concurrent Start requests cannot dispatch twice. */
export async function claimWorkflowIntakeDraftStart(id: string): Promise<boolean> {
  const dialect = getDialect();
  const result = await pool.query(
    `UPDATE remote_agent_workflow_intake_drafts
     SET status = 'starting', updated_at = ${dialect.now()}
     WHERE id = $1 AND status = 'ready'`,
    [id]
  );
  return (result.rowCount ?? 0) === 1;
}

export async function createWorkflowIntakeDraft(data: {
  codebase_id: string;
  workflow_name: string;
  definition_hash: string;
  conversation_id?: string;
  values?: IntakeValues;
  current_field?: string | null;
  user_id?: string;
}): Promise<WorkflowIntakeDraft> {
  const result = await pool.query<WorkflowIntakeDraftRow>(
    `INSERT INTO remote_agent_workflow_intake_drafts
     (codebase_id, workflow_name, definition_hash, conversation_id, "values", current_field, created_by_user_id, updated_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     RETURNING *`,
    [
      data.codebase_id,
      data.workflow_name,
      data.definition_hash,
      data.conversation_id ?? null,
      JSON.stringify(data.values ?? {}),
      data.current_field ?? null,
      data.user_id ?? null,
    ]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Failed to create workflow intake draft');
  getLog().info(
    { codebaseId: data.codebase_id, workflowName: data.workflow_name },
    'intake.created'
  );
  return normalize(row);
}

export async function updateWorkflowIntakeDraft(
  id: string,
  data: {
    values?: IntakeValues;
    current_field?: string | null;
    validation_errors?: readonly string[];
    status?: WorkflowIntakeDraftStatus;
    started_run_id?: string | null;
    conversation_id?: string | null;
    user_id?: string;
  }
): Promise<WorkflowIntakeDraft | null> {
  const existing = await pool.query<WorkflowIntakeDraftRow>(
    'SELECT * FROM remote_agent_workflow_intake_drafts WHERE id = $1',
    [id]
  );
  const row = existing.rows[0];
  if (!row) return null;
  if (row.status === 'started' || row.status === 'discarded') {
    throw new Error(`Workflow intake draft '${id}' is immutable`);
  }
  const dialect = getDialect();
  await pool.query(
    `UPDATE remote_agent_workflow_intake_drafts
     SET "values" = $1, current_field = $2, validation_errors = $3, status = $4,
         started_run_id = $5, conversation_id = $6, updated_by_user_id = $7,
         updated_at = ${dialect.now()}
     WHERE id = $8`,
    [
      JSON.stringify(data.values ?? parseJson(row.values)),
      data.current_field === undefined ? row.current_field : data.current_field,
      JSON.stringify(data.validation_errors ?? normalize(row).validation_errors),
      data.status ?? row.status,
      data.started_run_id === undefined ? row.started_run_id : data.started_run_id,
      data.conversation_id === undefined ? row.conversation_id : data.conversation_id,
      data.user_id ?? row.updated_by_user_id,
      id,
    ]
  );
  const updated = await pool.query<WorkflowIntakeDraftRow>(
    'SELECT * FROM remote_agent_workflow_intake_drafts WHERE id = $1',
    [id]
  );
  return updated.rows[0] ? normalize(updated.rows[0]) : null;
}

export async function discardWorkflowIntakeDraft(id: string, userId?: string): Promise<void> {
  const dialect = getDialect();
  await pool.query(
    `UPDATE remote_agent_workflow_intake_drafts
     SET status = 'discarded', updated_by_user_id = $1, updated_at = ${dialect.now()}
     WHERE id = $2 AND status IN ('draft', 'ready')`,
    [userId ?? null, id]
  );
}
