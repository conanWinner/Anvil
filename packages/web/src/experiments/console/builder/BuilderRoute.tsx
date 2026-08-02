/** Live project-scoped console workflow builder route. */
import { useEffect, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';
import type { BuilderWorkflow } from './types';
import { importWorkflowDefinition, toWorkflowDefinition } from './model';
import { BuilderPage } from './BuilderPage';
import { getWorkflow, listWorkflows, saveWorkflow } from '../skills/workflows';
import { startRun } from '../skills/startRun';

const EMPTY_WORKFLOW: BuilderWorkflow = {
  name: 'new-workflow',
  description: 'Describe when and why to use this workflow.',
  meta: {},
  nodes: [],
};

export function BuilderRoute(): ReactElement {
  const [searchParams] = useSearchParams();
  const editName = searchParams.get('edit');
  const cwd = searchParams.get('cwd') ?? undefined;
  const projectId = searchParams.get('projectId') ?? undefined;
  const [workflow, setWorkflow] = useState<BuilderWorkflow | null>(
    editName ? null : EMPTY_WORKFLOW
  );
  const [workflowName, setWorkflowName] = useState(editName ?? EMPTY_WORKFLOW.name);
  const [status, setStatus] = useState<string>('');
  const [runMessage, setRunMessage] = useState('Run workflow');
  const [runInputs, setRunInputs] = useState('{}');
  const [availableWorkflows, setAvailableWorkflows] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void listWorkflows(cwd)
      .then(result => {
        if (active) setAvailableWorkflows(result.workflows.map(item => item.name));
      })
      .catch(() => {
        if (active) setAvailableWorkflows([]);
      });
    return (): void => {
      active = false;
    };
  }, [cwd]);

  useEffect(() => {
    if (!editName) return;
    let active = true;
    setStatus('Loading…');
    void getWorkflow(editName, cwd)
      .then(result => {
        if (!active) return;
        setWorkflow(importWorkflowDefinition(result.workflow, result.filename));
        setWorkflowName(result.workflow.name);
        setStatus('');
      })
      .catch((error: unknown) => {
        if (active) setStatus(error instanceof Error ? error.message : String(error));
      });
    return (): void => {
      active = false;
    };
  }, [editName, cwd]);

  const persist = async (): Promise<void> => {
    if (!workflow || !workflowName.trim()) return;
    setStatus('Saving…');
    try {
      const definition = { ...toWorkflowDefinition(workflow), name: workflowName.trim() };
      await saveWorkflow(workflowName.trim(), definition, cwd);
      setStatus('Saved');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const run = async (): Promise<void> => {
    if (!projectId || !workflowName.trim()) return;
    setStatus('Starting…');
    try {
      const parsedInputs = JSON.parse(runInputs) as unknown;
      if (
        parsedInputs === null ||
        typeof parsedInputs !== 'object' ||
        Array.isArray(parsedInputs)
      ) {
        throw new Error('Run inputs must be a JSON object');
      }
      await persist();
      await startRun({
        projectId,
        workflow: workflowName.trim(),
        message: runMessage,
        inputs: parsedInputs as Record<string, unknown>,
      });
      setStatus('Run accepted');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <h1 className="text-[14px] font-semibold text-text-primary">Workflow Builder</h1>
        <input
          value={workflowName}
          onChange={event => {
            setWorkflowName(event.target.value);
          }}
          className="w-56 rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
        />
        <input
          value={runMessage}
          onChange={event => {
            setRunMessage(event.target.value);
          }}
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs"
        />
        <input
          value={runInputs}
          aria-label="Workflow inputs JSON"
          title="Workflow inputs JSON"
          onChange={event => {
            setRunInputs(event.target.value);
          }}
          className="w-48 rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
        />
        <span className="max-w-64 truncate text-xs text-text-tertiary">{status}</span>
        <button
          type="button"
          onClick={() => {
            void persist();
          }}
          className="rounded-md border border-border px-3 py-1 text-xs"
        >
          Save
        </button>
        <button
          type="button"
          disabled={!projectId}
          onClick={() => {
            void run();
          }}
          className="rounded-md bg-primary px-3 py-1 text-xs text-white disabled:opacity-40"
        >
          Run
        </button>
      </header>
      <div className="min-h-0 flex-1">
        {workflow ? (
          <BuilderPage
            key={editName ?? 'new'}
            initialWorkflow={workflow}
            onChange={setWorkflow}
            availableWorkflows={availableWorkflows.filter(name => name !== workflowName.trim())}
          />
        ) : (
          <div className="p-6 text-sm text-text-tertiary">{status}</div>
        )}
      </div>
    </div>
  );
}
