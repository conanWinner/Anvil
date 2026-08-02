import { requestJson } from '../lib/http';
import { HttpError } from '../lib/http';

export type WorkflowIntakeStatus = 'draft' | 'ready' | 'starting' | 'started' | 'discarded';

export interface WorkflowIntakeDraft {
  id: string;
  codebaseId: string;
  workflowName: string;
  definitionHash: string;
  status: WorkflowIntakeStatus;
  values: Record<string, unknown>;
  currentField: string | null;
  validationErrors: string[];
  startedRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

function intakePath(projectId: string, workflowName: string): string {
  return `/api/codebases/${encodeURIComponent(projectId)}/workflow-intakes/${encodeURIComponent(workflowName)}`;
}

export async function getWorkflowIntake(
  projectId: string,
  workflowName: string
): Promise<WorkflowIntakeDraft | null> {
  return requestJson<WorkflowIntakeDraft | null>(intakePath(projectId, workflowName));
}

export async function saveWorkflowIntake(
  projectId: string,
  workflowName: string,
  values: Record<string, unknown>,
  currentField?: string | null
): Promise<WorkflowIntakeDraft> {
  return requestJson<WorkflowIntakeDraft>(intakePath(projectId, workflowName), {
    method: 'PATCH',
    body: JSON.stringify({ values, ...(currentField !== undefined ? { currentField } : {}) }),
  });
}

export async function startWorkflowIntake(
  projectId: string,
  workflowName: string,
  conversationId: string
): Promise<{ accepted: boolean; status: string; runId: string | null }> {
  return requestJson(`${intakePath(projectId, workflowName)}/start`, {
    method: 'POST',
    body: JSON.stringify({
      conversationId,
      message: `Start ${workflowName} from confirmed intake`,
    }),
  });
}

export interface WorkflowIntakeChatResponse {
  draft: WorkflowIntakeDraft;
  state: 'collecting' | 'review' | 'confirmed' | 'stopped';
  shouldStart: boolean;
}

export interface WorkflowIntakeAttachmentResponse {
  draft: WorkflowIntakeDraft;
  state: 'collecting' | 'review';
  attachment: {
    input: string;
    name: string;
    path: string;
    size: number;
    mime: string;
    sha256: string;
  };
}

export async function chatWorkflowIntake(
  projectId: string,
  workflowName: string,
  conversationId: string,
  message: string
): Promise<WorkflowIntakeChatResponse> {
  return requestJson<WorkflowIntakeChatResponse>(`${intakePath(projectId, workflowName)}/chat`, {
    method: 'POST',
    body: JSON.stringify({ conversationId, message }),
  });
}

export async function attachWorkflowIntakeFile(
  projectId: string,
  workflowName: string,
  conversationId: string,
  file: File
): Promise<WorkflowIntakeAttachmentResponse> {
  const url = `${intakePath(projectId, workflowName)}/attachments`;
  const form = new FormData();
  form.append('conversationId', conversationId);
  form.append('files', file, file.name);
  const response = await fetch(url, { method: 'POST', body: form });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new HttpError(response.status, url, body.error ?? 'Không thể lưu file Intake.');
  }
  return response.json() as Promise<WorkflowIntakeAttachmentResponse>;
}

export async function discardWorkflowIntake(
  projectId: string,
  workflowName: string
): Promise<void> {
  await requestJson<{ success: boolean }>(intakePath(projectId, workflowName), {
    method: 'DELETE',
  });
}
