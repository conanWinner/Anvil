/** Workflow variant: defaults + sparse wire conversion. */
import type { WireDagNode, WorkflowNodeData } from '../types';

export function defaultWorkflowData(): WorkflowNodeData {
  return { name: '', inputs: {}, artifacts: { inputs: {}, outputs: {} } };
}

export function workflowFromDag(variantSpecific: Partial<WireDagNode>): WorkflowNodeData {
  if (variantSpecific.workflow === undefined) {
    throw new Error("workflowFromDag: wire node has no 'workflow' field");
  }
  return variantSpecific.workflow;
}

export function workflowToDag(data: WorkflowNodeData): Partial<WireDagNode> {
  return { workflow: data };
}
