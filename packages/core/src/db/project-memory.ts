import { getDatabase, getDialect, pool } from './connection';
import type {
  ConversationMemoryHandoffRow,
  ProjectMemoryCategory,
  ProjectMemoryEntryRow,
} from '../schemas/project-memory';

export interface ExtractedMemoryEntry {
  category: ProjectMemoryCategory;
  content: string;
}

export async function listProjectMemoryEntries(
  codebaseId: string,
  limit = 50
): Promise<readonly ProjectMemoryEntryRow[]> {
  const result = await pool.query<ProjectMemoryEntryRow>(
    `SELECT * FROM remote_agent_project_memory_entries
     WHERE codebase_id = $1 AND active = true
     ORDER BY pinned DESC, user_edited DESC, updated_at DESC
     LIMIT $2`,
    [codebaseId, limit]
  );
  return result.rows;
}

export async function getProjectMemoryEntry(
  codebaseId: string,
  entryId: string
): Promise<ProjectMemoryEntryRow | null> {
  const result = await pool.query<ProjectMemoryEntryRow>(
    `SELECT * FROM remote_agent_project_memory_entries
     WHERE id = $1 AND codebase_id = $2 AND active = true`,
    [entryId, codebaseId]
  );
  return result.rows[0] ?? null;
}

export async function createManualProjectMemoryEntry(data: {
  codebaseId: string;
  category: ProjectMemoryCategory;
  content: string;
  pinned?: boolean;
  userId?: string;
}): Promise<ProjectMemoryEntryRow> {
  const result = await pool.query<ProjectMemoryEntryRow>(
    `INSERT INTO remote_agent_project_memory_entries
     (codebase_id, category, content, origin, user_edited, pinned,
      created_by_user_id, updated_by_user_id)
     VALUES ($1, $2, $3, 'manual', true, $4, $5, $5)
     RETURNING *`,
    [data.codebaseId, data.category, data.content, data.pinned ?? false, data.userId ?? null]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Failed to create project memory entry');
  return row;
}

export async function updateProjectMemoryEntry(
  codebaseId: string,
  entryId: string,
  data: { content?: string; category?: ProjectMemoryCategory; pinned?: boolean; userId?: string }
): Promise<ProjectMemoryEntryRow | null> {
  const existing = await getProjectMemoryEntry(codebaseId, entryId);
  if (!existing) return null;
  const dialect = getDialect();
  const contentChanged = data.content !== undefined && data.content !== existing.content;
  const result = await pool.query<ProjectMemoryEntryRow>(
    `UPDATE remote_agent_project_memory_entries
     SET content = $1, category = $2, pinned = $3,
         user_edited = $4, updated_by_user_id = $5, updated_at = ${dialect.now()}
     WHERE id = $6 AND codebase_id = $7 AND active = true
     RETURNING *`,
    [
      data.content ?? existing.content,
      data.category ?? existing.category,
      data.pinned ?? existing.pinned,
      existing.user_edited || contentChanged || data.category !== undefined,
      data.userId ?? existing.updated_by_user_id,
      entryId,
      codebaseId,
    ]
  );
  return result.rows[0] ?? null;
}

export async function deactivateProjectMemoryEntry(
  codebaseId: string,
  entryId: string,
  userId?: string
): Promise<boolean> {
  const dialect = getDialect();
  const result = await pool.query(
    `UPDATE remote_agent_project_memory_entries
     SET active = false, updated_by_user_id = $1, updated_at = ${dialect.now()}
     WHERE id = $2 AND codebase_id = $3 AND active = true`,
    [userId ?? null, entryId, codebaseId]
  );
  return result.rowCount === 1;
}

export async function deactivateUneditedMemoryFromConversation(
  conversationId: string
): Promise<number> {
  const dialect = getDialect();
  const result = await pool.query(
    `UPDATE remote_agent_project_memory_entries
     SET active = false, updated_at = ${dialect.now()}
     WHERE source_conversation_id = $1 AND origin = 'extracted'
       AND user_edited = false AND active = true`,
    [conversationId]
  );
  return result.rowCount;
}

export async function softDeleteConversationWithMemory(conversationId: string): Promise<void> {
  const db = getDatabase();
  const dialect = getDialect();
  await db.withTransaction(async query => {
    await query(
      `UPDATE remote_agent_project_memory_entries
       SET active = false, updated_at = ${dialect.now()}
       WHERE source_conversation_id = $1 AND origin = 'extracted'
         AND user_edited = false AND active = true`,
      [conversationId]
    );
    const deleted = await query(
      `UPDATE remote_agent_conversations
       SET deleted_at = ${dialect.now()}, updated_at = ${dialect.now()}
       WHERE id = $1`,
      [conversationId]
    );
    if (deleted.rowCount !== 1) throw new Error('Conversation not found');
  });
}

export async function getLastConversationMessageId(conversationId: string): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM remote_agent_messages
     WHERE conversation_id = $1 AND role IN ('user', 'assistant')
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId]
  );
  return result.rows[0]?.id ?? null;
}

export async function getConversationHandoff(
  conversationId: string
): Promise<ConversationMemoryHandoffRow | null> {
  const result = await pool.query<ConversationMemoryHandoffRow>(
    'SELECT * FROM remote_agent_conversation_memory_handoffs WHERE conversation_id = $1',
    [conversationId]
  );
  return result.rows[0] ?? null;
}

/** Claims a handoff when new messages exist or the previous attempt failed. */
export async function claimConversationHandoff(
  codebaseId: string,
  conversationId: string,
  lastMessageId: string
): Promise<ConversationMemoryHandoffRow | null> {
  const dialect = getDialect();
  const result = await pool.query<ConversationMemoryHandoffRow>(
    `INSERT INTO remote_agent_conversation_memory_handoffs
     (codebase_id, conversation_id, status, source_last_message_id)
     VALUES ($1, $2, 'processing', $3)
     ON CONFLICT (conversation_id) DO UPDATE SET
       status = 'processing', source_last_message_id = $3, error = NULL,
       completed_at = NULL, updated_at = ${dialect.now()}
     WHERE remote_agent_conversation_memory_handoffs.source_last_message_id IS NULL
        OR remote_agent_conversation_memory_handoffs.source_last_message_id <> $3
        OR remote_agent_conversation_memory_handoffs.status = 'failed'
     RETURNING *`,
    [codebaseId, conversationId, lastMessageId]
  );
  return result.rows[0] ?? null;
}

export async function completeConversationHandoff(
  handoff: ConversationMemoryHandoffRow,
  entries: readonly ExtractedMemoryEntry[],
  userId?: string
): Promise<readonly ProjectMemoryEntryRow[]> {
  const db = getDatabase();
  const dialect = getDialect();
  return db.withTransaction(async query => {
    await query(
      `UPDATE remote_agent_project_memory_entries
       SET active = false, updated_at = ${dialect.now()}
       WHERE source_conversation_id = $1 AND origin = 'extracted'
         AND user_edited = false AND active = true`,
      [handoff.conversation_id]
    );
    const created: ProjectMemoryEntryRow[] = [];
    for (const entry of entries) {
      const result = await query<ProjectMemoryEntryRow>(
        `INSERT INTO remote_agent_project_memory_entries
         (codebase_id, source_conversation_id, handoff_id, category, content, origin,
          created_by_user_id, updated_by_user_id)
         VALUES ($1, $2, $3, $4, $5, 'extracted', $6, $6)
         RETURNING *`,
        [
          handoff.codebase_id,
          handoff.conversation_id,
          handoff.id,
          entry.category,
          entry.content,
          userId ?? null,
        ]
      );
      const row = result.rows[0];
      if (row) created.push(row);
    }
    await query(
      `UPDATE remote_agent_conversation_memory_handoffs
       SET status = 'completed', error = NULL, completed_at = ${dialect.now()},
           updated_at = ${dialect.now()}
       WHERE id = $1`,
      [handoff.id]
    );
    return created;
  });
}

export async function failConversationHandoff(handoffId: string, error: string): Promise<void> {
  const dialect = getDialect();
  await pool.query(
    `UPDATE remote_agent_conversation_memory_handoffs
     SET status = 'failed', error = $1, updated_at = ${dialect.now()}
     WHERE id = $2`,
    [error.slice(0, 1000), handoffId]
  );
}
