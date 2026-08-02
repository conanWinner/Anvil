import { describe, expect, test } from 'bun:test';
import type { Workflow } from '../primitives/workflow';
import { workflowsForScope } from './workflow-scope';

const workflows: Workflow[] = [
  { name: 'project-flow', description: null, source: 'project' },
  { name: 'global-flow', description: null, source: 'global' },
  { name: 'bundled-flow', description: null, source: 'bundled' },
];

describe('workflowsForScope', () => {
  test('shows only repo-local workflows on a project page', () => {
    expect(workflowsForScope(workflows, true).map(workflow => workflow.name)).toEqual([
      'project-flow',
    ]);
  });

  test('shows bundled defaults on the unscoped workflows page', () => {
    expect(workflowsForScope(workflows, false).map(workflow => workflow.name)).toEqual([
      'bundled-flow',
    ]);
  });
});
