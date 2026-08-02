import { requestJson } from '../lib/http';

export type ProjectMemoryCategory =
  | 'decision'
  | 'requirement'
  | 'constraint'
  | 'preference'
  | 'fact';
export interface ProjectMemoryEntry {
  id: string;
  category: ProjectMemoryCategory;
  content: string;
  origin: 'extracted' | 'manual';
  user_edited: boolean;
  pinned: boolean;
  source_conversation_id: string | null;
  source_conversation_title: string | null;
  updated_at: string;
}
export async function listProjectMemory(projectId: string): Promise<ProjectMemoryEntry[]> {
  const result = await requestJson<{ entries: ProjectMemoryEntry[] }>(
    `/api/codebases/${encodeURIComponent(projectId)}/project-memory`
  );
  return result.entries;
}
export async function handoffProjectMemory(
  projectId: string,
  conversationId: string
): Promise<void> {
  await requestJson(`/api/codebases/${encodeURIComponent(projectId)}/project-memory/handoff`, {
    method: 'POST',
    body: JSON.stringify({ conversationId }),
  });
}
export async function createProjectMemory(projectId: string, content: string): Promise<void> {
  await requestJson(`/api/codebases/${encodeURIComponent(projectId)}/project-memory/entries`, {
    method: 'POST',
    body: JSON.stringify({ category: 'fact', content }),
  });
}
export async function updateProjectMemory(
  projectId: string,
  entryId: string,
  patch: { content?: string; pinned?: boolean }
): Promise<void> {
  await requestJson(
    `/api/codebases/${encodeURIComponent(projectId)}/project-memory/entries/${encodeURIComponent(entryId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) }
  );
}
export async function deleteProjectMemory(projectId: string, entryId: string): Promise<void> {
  await requestJson(
    `/api/codebases/${encodeURIComponent(projectId)}/project-memory/entries/${encodeURIComponent(entryId)}`,
    { method: 'DELETE' }
  );
}
