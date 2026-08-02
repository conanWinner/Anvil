import type { components } from '@/lib/api.generated';
import { requestJson } from '../lib/http';

export type WorkflowFlowResponse = components['schemas']['WorkflowFlowResponse'];
export type WorkflowFlowTree = components['schemas']['WorkflowFlowTree'];
export type WorkflowFlowNode = components['schemas']['WorkflowFlowNode'];
export type WorkflowNodeIoResponse = components['schemas']['WorkflowNodeIoResponse'];
export type WorkflowCompositionResponse = components['schemas']['WorkflowCompositionResponse'];

export async function getWorkflowFlow(runId: string): Promise<WorkflowFlowResponse> {
  return requestJson<WorkflowFlowResponse>(`/api/workflows/runs/${encodeURIComponent(runId)}/flow`);
}

export async function getWorkflowNodeIo(
  rootRunId: string,
  nodePath: string
): Promise<WorkflowNodeIoResponse> {
  return requestJson<WorkflowNodeIoResponse>(
    `/api/workflows/runs/${encodeURIComponent(rootRunId)}/nodes/${encodeURIComponent(nodePath)}/io`
  );
}

export async function getWorkflowComposition(
  workflowName: string,
  cwd: string
): Promise<WorkflowCompositionResponse> {
  const query = new URLSearchParams({ cwd });
  return requestJson<WorkflowCompositionResponse>(
    `/api/workflows/${encodeURIComponent(workflowName)}/composition?${query.toString()}`
  );
}
