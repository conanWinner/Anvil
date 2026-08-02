import type { Workflow } from '../primitives/workflow';

/**
 * Keep workflow visibility aligned with the current console scope.
 * Project pages show only repo-local definitions; the unscoped page remains
 * the catalogue of bundled defaults.
 */
export function workflowsForScope(
  workflows: readonly Workflow[],
  projectScoped: boolean
): Workflow[] {
  const source = projectScoped ? 'project' : 'bundled';
  return workflows.filter(workflow => workflow.source === source);
}
