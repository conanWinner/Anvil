import { describe, expect, test } from 'bun:test';
import { ExperimentProgress, type ExperimentProgressEvent } from '@anvil/system3';
import {
  listSystem3OperationTrace,
  system3WorkflowFailureMessage,
  type System3TraceReader,
} from './system3-operation-trace';

function row(
  id: string,
  runId: string,
  event: ExperimentProgressEvent | Record<string, unknown>,
  eventType = 'system3_progress'
): { id: string; workflow_run_id: string; event_type: string; data: unknown } {
  return { id, workflow_run_id: runId, event_type: eventType, data: event };
}

describe('listSystem3OperationTrace', () => {
  test('collects progress events from the run and all descendants in order', async () => {
    const progress = new ExperimentProgress();
    progress.start({ stage: 'prepare', action: 'generate', round: 1 })('passed', 'files');
    progress.start({ stage: 'prepare', action: 'prepare_data', round: 1 })('failed', 'KeyError');
    const [first, second, third, fourth] = progress.events;
    if (!first || !second || !third || !fourth) throw new Error('expected four events');

    const reader: System3TraceReader = {
      listChildWorkflowRuns: id =>
        Promise.resolve(id === 'root' ? [{ id: 'child' }] : id === 'child' ? [{ id: 'leaf' }] : []),
      listWorkflowEvents: id =>
        Promise.resolve(
          id === 'root'
            ? [row('a', 'root', { type: 'action' }, 'node_started')]
            : id === 'child'
              ? [row('b', 'child', third), row('c', 'child', first)]
              : [row('d', 'leaf', fourth), row('e', 'leaf', second)]
        ),
    };

    const events = await listSystem3OperationTrace(reader, 'root');
    expect(events.map(event => event.seq)).toEqual([0, 1, 2, 3]);
    expect(events.at(-1)).toMatchObject({ action: 'prepare_data', status: 'failed' });
  });

  test('skips malformed progress rows and returns nothing without a workflow run', async () => {
    const reader: System3TraceReader = {
      listChildWorkflowRuns: () => Promise.resolve([]),
      listWorkflowEvents: () => Promise.resolve([row('x', 'root', { seq: 'not a number' })]),
    };
    expect(await listSystem3OperationTrace(reader, 'root')).toEqual([]);
    expect(await listSystem3OperationTrace(reader, null)).toEqual([]);
  });
});

describe('system3WorkflowFailureMessage', () => {
  test('returns the last failing node error from the run tree, else the fallback', async () => {
    const reader: System3TraceReader = {
      listChildWorkflowRuns: id => Promise.resolve(id === 'root' ? [{ id: 'child' }] : []),
      listWorkflowEvents: id =>
        Promise.resolve(
          id === 'child'
            ? [
                row('a', 'child', { error: 'first' }, 'node_failed'),
                row('b', 'child', { error: 'Experiment build stopped at prepare' }, 'node_failed'),
              ]
            : [row('c', 'root', { error: '' }, 'node_failed')]
        ),
    };
    expect(await system3WorkflowFailureMessage(reader, 'root', 'generic')).toBe(
      'Experiment build stopped at prepare'
    );
    expect(await system3WorkflowFailureMessage(reader, undefined, 'generic')).toBe('generic');
    const empty: System3TraceReader = {
      listChildWorkflowRuns: () => Promise.resolve([]),
      listWorkflowEvents: () => Promise.resolve([]),
    };
    expect(await system3WorkflowFailureMessage(empty, 'root', 'generic')).toBe('generic');
  });
});
