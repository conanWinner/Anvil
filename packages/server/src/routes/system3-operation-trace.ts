import {
  EXPERIMENT_PROGRESS_EVENT_TYPE,
  experimentProgressEventSchema,
  type ExperimentProgressEvent,
} from '@anvil/system3';
import { createLogger } from '@anvil/paths';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('system3.trace');
  return cachedLog;
}

export interface System3TraceReader {
  listChildWorkflowRuns(parentWorkflowRunId: string): Promise<readonly { id: string }[]>;
  listWorkflowEvents(
    workflowRunId: string
  ): Promise<readonly { id: string; workflow_run_id: string; event_type: string; data: unknown }[]>;
}

/** Events of a workflow run and every descendant run (composed child workflows). */
async function listRunTreeEvents(
  reader: System3TraceReader,
  workflowRunId: string
): Promise<Awaited<ReturnType<System3TraceReader['listWorkflowEvents']>>[number][]> {
  const runIds: string[] = [];
  for (let pending = [workflowRunId]; pending.length > 0; ) {
    runIds.push(...pending);
    const children = await Promise.all(pending.map(id => reader.listChildWorkflowRuns(id)));
    pending = children.flat().map(run => run.id);
  }
  return (await Promise.all(runIds.map(id => reader.listWorkflowEvents(id)))).flat();
}

/**
 * Experiment trace of a System 3 operation: progress events of its workflow run and every
 * descendant run (the experiment node runs inside a composed child workflow), oldest first.
 */
export async function listSystem3OperationTrace(
  reader: System3TraceReader,
  workflowRunId: string | null
): Promise<ExperimentProgressEvent[]> {
  if (workflowRunId === null) return [];
  const rows = await listRunTreeEvents(reader, workflowRunId);
  const events: ExperimentProgressEvent[] = [];
  for (const row of rows) {
    if (row.event_type !== EXPERIMENT_PROGRESS_EVENT_TYPE) continue;
    const parsed = experimentProgressEventSchema.safeParse(row.data);
    if (parsed.success) events.push(parsed.data);
    else
      getLog().warn(
        { workflowRunId: row.workflow_run_id, eventId: row.id },
        'system3.operation_trace_event_invalid'
      );
  }
  return events.sort((left, right) => left.at.localeCompare(right.at) || left.seq - right.seq);
}

/**
 * The executor only says a workflow failed; the failing node's own error (for example why an
 * experiment build stopped) is what the user needs. Returns the last `node_failed` error of the
 * run or its descendants, or `fallback` when no node recorded one.
 */
export async function system3WorkflowFailureMessage(
  reader: System3TraceReader,
  workflowRunId: string | undefined,
  fallback: string
): Promise<string> {
  if (workflowRunId === undefined) return fallback;
  const rows = await listRunTreeEvents(reader, workflowRunId);
  for (const row of [...rows].reverse()) {
    if (row.event_type !== 'node_failed' || row.data === null || typeof row.data !== 'object')
      continue;
    const error = (row.data as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim().length > 0) return error;
  }
  return fallback;
}
