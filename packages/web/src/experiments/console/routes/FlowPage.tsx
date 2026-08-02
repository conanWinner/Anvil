import { ChevronsDown, ChevronsUp, ExternalLink, Maximize2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { FlowCanvas } from '../components/FlowCanvas';
import { FlowInspector } from '../components/FlowInspector';
import { RunActionBar } from '../components/RunActionBar';
import { ProjectViewTabs } from '../components/ProjectViewTabs';
import { useDashboardSSE } from '../lib/sse';
import type { Project } from '../primitives/project';
import type { Run } from '../primitives/run';
import * as skill from '../skills';
import type { WorkflowFlowNode, WorkflowFlowResponse, WorkflowFlowTree } from '../skills/flow';
import { invalidate, useEntity } from '../store/cache';
import { K } from '../store/keys';
import { ensureUtc, formatVietnamDateTime } from '../../../lib/format';

function runLabel(run: Run): string {
  const stamp = formatVietnamDateTime(run.startedAt, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${run.workflow} · ${run.status} · ${stamp}`;
}

export function FlowPage(): ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  useDashboardSSE();

  const { data: project, error: projectError } = useEntity<Project | null>(
    projectId !== undefined ? K.project(projectId) : 'noop:flow-project',
    () => (projectId !== undefined ? skill.getProject(projectId) : Promise.resolve(null))
  );
  const { data: runResult } = useEntity<{ runs: Run[]; total: number }>(
    projectId !== undefined ? K.flowRuns(projectId) : 'noop:flow-runs',
    async () => {
      if (projectId === undefined) return { runs: [], total: 0 };
      const result = await skill.listRuns({ codebaseId: projectId, rootOnly: true, limit: 50 });
      return { runs: result.runs, total: result.total };
    }
  );
  const runs = runResult?.runs ?? [];
  const selectedRunId = searchParams.get('run') ?? runs[0]?.id ?? null;

  useEffect(() => {
    if (runs.length === 0 || searchParams.get('run') !== null) return;
    const latest = runs[0];
    if (latest === undefined) return;
    const next = new URLSearchParams(searchParams);
    next.set('run', latest.id);
    setSearchParams(next, { replace: true });
  }, [runs, searchParams, setSearchParams]);

  const {
    data: flow,
    error: flowError,
    refetch: refetchFlow,
  } = useEntity<WorkflowFlowResponse | null>(
    selectedRunId !== null ? K.flow(selectedRunId) : 'noop:flow-run',
    () => (selectedRunId !== null ? skill.getWorkflowFlow(selectedRunId) : Promise.resolve(null))
  );

  const trees: WorkflowFlowTree[] = flow?.tree.workflows ?? [];
  const selectedNodePath = searchParams.get('node');
  const selectedNode = useMemo(
    () =>
      trees.flatMap(tree => tree.nodes).find(node => node.nodePath === selectedNodePath) ?? null,
    [trees, selectedNodePath]
  );
  const expandablePaths = useMemo(
    () =>
      new Set(trees.flatMap(tree => (tree.parentNodePath !== null ? [tree.parentNodePath] : []))),
    [trees]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || selectedNodePath === null) return;
      const next = new URLSearchParams(searchParams);
      next.delete('node');
      setSearchParams(next, { replace: true });
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [searchParams, selectedNodePath, setSearchParams]);

  if (projectId === undefined) {
    return (
      <div className="grid h-full place-items-center text-sm text-error">Invalid project.</div>
    );
  }
  if (projectError !== undefined) {
    return (
      <div className="grid h-full place-items-center text-sm text-error">
        {projectError.message}
      </div>
    );
  }
  if (project === undefined || project === null) {
    return (
      <div className="grid h-full place-items-center text-sm text-text-tertiary">
        Loading project…
      </div>
    );
  }

  const selectedRun = runs.find(run => run.id === selectedRunId) ?? null;
  const cancelledNode = trees
    .flatMap(tree => tree.nodes)
    .find(node => node.effectiveStatus === 'cancelled');
  const dataError = flowError;
  const selectedRunDuration =
    selectedRun?.finishedAt !== null && selectedRun?.finishedAt !== undefined
      ? Math.max(
          0,
          new Date(ensureUtc(selectedRun.finishedAt)).getTime() -
            new Date(ensureUtc(selectedRun.startedAt)).getTime()
        )
      : null;

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border bg-surface px-6 pb-3 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">{project.name}</h1>
            <p className="mt-1 font-mono text-[11px] text-text-tertiary">{project.path}</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedRunId !== null ? (
              <Link
                to={`/console/p/${projectId}/r/${selectedRunId}`}
                className="inline-flex items-center gap-1.5 rounded border border-border-bright px-3 py-2 text-xs text-text-secondary hover:bg-surface-hover"
              >
                Run detail <ExternalLink className="size-3" />
              </Link>
            ) : null}
            <ProjectViewTabs projectId={projectId} active="flow" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {runs.length > 0 ? (
            <select
              value={selectedRunId ?? ''}
              onChange={event => {
                const next = new URLSearchParams(searchParams);
                next.set('run', event.target.value);
                next.delete('node');
                setSearchParams(next);
              }}
              className="min-w-72 rounded border border-border-bright bg-surface-inset px-3 py-2 text-xs text-text-primary outline-none"
              aria-label="Select root workflow run"
            >
              {runs.map(run => (
                <option key={run.id} value={run.id}>
                  {runLabel(run)}
                </option>
              ))}
            </select>
          ) : null}

          {selectedRun !== null ? (
            <>
              <span className="rounded border border-border px-2 py-1 font-mono text-[10px] uppercase text-text-secondary">
                {flow?.tree.workflows.find(tree => tree.parentNodePath === null)?.effectiveStatus ??
                  selectedRun.status}
              </span>
              <span className="font-mono text-[10px] text-text-tertiary">
                {formatVietnamDateTime(selectedRun.startedAt, {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {selectedRunDuration !== null
                  ? ` · ${(selectedRunDuration / 1000).toFixed(1)}s`
                  : ''}
              </span>
            </>
          ) : null}

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setExpanded(new Set(expandablePaths));
              }}
              className="grid size-8 place-items-center rounded border border-border-bright text-text-secondary hover:bg-surface-hover"
              title="Expand all child workflows"
              aria-label="Expand all child workflows"
            >
              <ChevronsDown className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setExpanded(new Set());
              }}
              className="grid size-8 place-items-center rounded border border-border-bright text-text-secondary hover:bg-surface-hover"
              title="Collapse all child workflows"
              aria-label="Collapse all child workflows"
            >
              <ChevronsUp className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                canvasRef.current?.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
              }}
              className="grid size-8 place-items-center rounded border border-border-bright text-text-secondary hover:bg-surface-hover"
              title="Fit view"
              aria-label="Fit view"
            >
              <Maximize2 className="size-4" />
            </button>
            {selectedRunId !== null ? (
              <button
                type="button"
                onClick={() => {
                  refetchFlow();
                  invalidate(K.flowRuns(projectId));
                }}
                className="grid size-8 place-items-center rounded border border-border-bright text-text-secondary hover:bg-surface-hover"
                title="Refresh flow"
                aria-label="Refresh flow"
              >
                <RefreshCw className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {flow?.snapshot.warning !== null && flow?.snapshot.warning !== undefined ? (
        <div className="border-b border-warning/30 bg-warning/[0.05] px-6 py-2 text-xs text-warning">
          {flow.snapshot.warning}
        </div>
      ) : null}
      {(flow?.inconsistencies.length ?? 0) > 0 ? (
        <div className="border-b border-error/30 bg-error/[0.05] px-6 py-2 text-xs text-error">
          Execution state is inconsistent:{' '}
          {flow?.inconsistencies.map(item => item.message).join(' ')}
        </div>
      ) : null}
      {selectedNode !== null ? (
        <div className="border-b border-border bg-surface-inset px-6 py-2 font-mono text-[10px] text-text-tertiary">
          {trees.find(tree => tree.nodes.some(node => node.nodePath === selectedNode.nodePath))
            ?.workflowName ?? 'workflow'}{' '}
          / {selectedNode.label}
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div ref={canvasRef} className="min-w-0 flex-1 overflow-hidden">
          {dataError !== undefined ? (
            <div className="grid h-full place-items-center p-8 text-center">
              <div>
                <p className="text-sm text-error">Could not load Flow.</p>
                <p className="mt-2 font-mono text-[11px] text-text-tertiary">{dataError.message}</p>
              </div>
            </div>
          ) : trees.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-text-tertiary">
              <div className="space-y-2 text-center">
                <p>Chưa có run nào cho project này.</p>
                <Link
                  className="text-accent-bright hover:underline"
                  to={`/console/p/${projectId}/chat`}
                >
                  Prepare in Chat
                </Link>
              </div>
            </div>
          ) : (
            <FlowCanvas
              workflows={trees}
              expanded={expanded}
              selectedNodePath={selectedNodePath}
              onToggle={nodePath => {
                setExpanded(current => {
                  const next = new Set(current);
                  if (next.has(nodePath)) next.delete(nodePath);
                  else next.add(nodePath);
                  return next;
                });
              }}
              onSelect={(node: WorkflowFlowNode) => {
                const next = new URLSearchParams(searchParams);
                next.set('node', node.nodePath);
                setSearchParams(next);
              }}
            />
          )}
        </div>

        {selectedNode !== null ? (
          <FlowInspector
            rootRunId={flow?.tree.rootRunId ?? selectedRunId}
            node={selectedNode}
            onClose={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('node');
              setSearchParams(next, { replace: true });
            }}
          />
        ) : null}
      </div>
      {selectedRun !== null ? (
        <RunActionBar
          run={selectedRun}
          allowResume={cancelledNode === undefined}
          blockedReason={cancelledNode?.error ?? null}
        />
      ) : null}
    </section>
  );
}
