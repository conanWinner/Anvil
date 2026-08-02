import { ChevronDown, ChevronRight, GitBranch, Workflow } from 'lucide-react';
import type { ReactElement } from 'react';
import type { WorkflowFlowNode, WorkflowFlowTree } from '../skills/flow';

interface FlowCanvasProps {
  workflows: WorkflowFlowTree[];
  expanded: ReadonlySet<string>;
  selectedNodePath: string | null;
  onToggle: (nodePath: string) => void;
  onSelect: (node: WorkflowFlowNode) => void;
}

const STATUS_CLASS: Record<WorkflowFlowNode['effectiveStatus'], string> = {
  pending: 'border-border-bright bg-surface-elevated text-text-tertiary',
  running:
    'border-[color:var(--running)] bg-[color:color-mix(in_oklch,var(--running),transparent_92%)] text-[color:var(--running)]',
  paused: 'border-warning/60 bg-warning/[0.06] text-warning',
  completed: 'border-success/50 bg-success/[0.04] text-success',
  failed: 'border-error/60 bg-error/[0.06] text-error',
  skipped: 'border-border-bright bg-surface-inset text-text-tertiary',
  cancelled: 'border-border-bright bg-surface-inset text-text-tertiary',
  inconsistent: 'border-error bg-error/[0.08] text-error',
};

function statusDot(status: WorkflowFlowNode['effectiveStatus']): string {
  if (status === 'completed') return '✓';
  if (status === 'failed' || status === 'inconsistent') return '!';
  if (status === 'paused') return 'Ⅱ';
  if (status === 'running') return '●';
  if (status === 'skipped') return '–';
  if (status === 'cancelled') return '×';
  return '○';
}

function durationLabel(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms < 1000) return `${ms.toString()}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000).toString()}m ${Math.round((ms % 60000) / 1000).toString()}s`;
}

function WorkflowLane({
  tree,
  childByParent,
  expanded,
  selectedNodePath,
  onToggle,
  onSelect,
  depth,
}: {
  tree: WorkflowFlowTree;
  childByParent: ReadonlyMap<string, WorkflowFlowTree>;
  expanded: ReadonlySet<string>;
  selectedNodePath: string | null;
  onToggle: (nodePath: string) => void;
  onSelect: (node: WorkflowFlowNode) => void;
  depth: number;
}): ReactElement {
  return (
    <section
      className="rounded-xl border border-border bg-surface/95 p-4 shadow-sm"
      aria-label={`Workflow ${tree.workflowName}`}
    >
      <header className="mb-4 flex items-center gap-2 border-b border-border pb-3">
        <Workflow className="size-4 text-[color:var(--node-workflow)]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-text-primary">
            {tree.ui.label ?? tree.workflowName}
          </div>
          <div className="truncate font-mono text-[10px] text-text-tertiary">
            {tree.workflowName}
          </div>
        </div>
        {tree.ui.phase !== undefined ? (
          <span className="rounded border border-border-bright px-2 py-0.5 text-[10px] font-semibold uppercase text-text-secondary">
            Phase {tree.ui.phase}
          </span>
        ) : null}
        <span className="font-mono text-[10px] uppercase text-text-tertiary">
          {tree.effectiveStatus}
        </span>
      </header>

      <div className="space-y-3">
        {tree.nodes.map((node, index) => {
          const child = childByParent.get(node.nodePath);
          const isExpanded = child !== undefined && expanded.has(node.nodePath);
          const selected = selectedNodePath === node.nodePath;
          const duration = durationLabel(node.durationMs);
          return (
            <div key={node.nodePath} className="relative">
              {index > 0 ? (
                <span
                  className="absolute -top-3 left-6 h-3 border-l border-border-bright"
                  aria-hidden
                />
              ) : null}
              <div
                className={`group flex min-h-16 items-center gap-3 rounded-lg border px-3 py-2.5 transition-all ${STATUS_CLASS[node.effectiveStatus]} ${
                  selected
                    ? 'ring-2 ring-[color:var(--brand-magenta)] ring-offset-2 ring-offset-surface'
                    : ''
                }`}
              >
                {child !== undefined ? (
                  <button
                    type="button"
                    onClick={() => {
                      onToggle(node.nodePath);
                    }}
                    className="grid size-7 shrink-0 place-items-center rounded hover:bg-white/5"
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.label}`}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                  </button>
                ) : (
                  <span className="grid size-7 shrink-0 place-items-center rounded-full border border-current/30 font-mono text-[11px]">
                    {statusDot(node.effectiveStatus)}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onSelect(node);
                  }}
                  className="min-w-0 flex-1 text-left"
                  aria-current={selected ? 'true' : undefined}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-text-primary">
                      {node.label}
                    </span>
                    <span className="rounded bg-surface-inset px-1.5 py-0.5 font-mono text-[9px] uppercase text-text-tertiary">
                      {node.kind}
                    </span>
                    {node.ui.gate !== undefined ? (
                      <span className="rounded border border-warning/40 px-1.5 py-0.5 font-mono text-[9px] text-warning">
                        {node.ui.gate}
                      </span>
                    ) : null}
                    {node.transition?.status === 'awaiting_continue' ? (
                      <span className="rounded border border-brand-cyan/40 px-1.5 py-0.5 font-mono text-[9px] text-brand-cyan">
                        Waiting to continue
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-text-tertiary">
                    <span>{node.nodeId}</span>
                    {node.dependsOn.length > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <GitBranch className="size-3" /> {node.dependsOn.join(', ')}
                      </span>
                    ) : null}
                    {duration !== null ? <span>{duration}</span> : null}
                    <span>{node.inputCount.toString()} in</span>
                    <span>{node.outputCount.toString()} out</span>
                    {node.artifactCount > 0 ? (
                      <span>
                        {node.artifactCount.toString()}{' '}
                        {node.kind === 'workflow' ? 'files total' : 'artifacts'}
                      </span>
                    ) : null}
                  </div>
                </button>
              </div>

              {child !== undefined && isExpanded ? (
                <div className="ml-6 mt-3 border-l border-[color:var(--node-workflow)]/40 pl-5">
                  <WorkflowLane
                    tree={child}
                    childByParent={childByParent}
                    expanded={expanded}
                    selectedNodePath={selectedNodePath}
                    onToggle={onToggle}
                    onSelect={onSelect}
                    depth={depth + 1}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function FlowCanvas({
  workflows,
  expanded,
  selectedNodePath,
  onToggle,
  onSelect,
}: FlowCanvasProps): ReactElement {
  const root = workflows.find(tree => tree.parentNodePath === null);
  const childByParent = new Map(
    workflows
      .filter(
        (tree): tree is WorkflowFlowTree & { parentNodePath: string } =>
          tree.parentNodePath !== null
      )
      .map(tree => [tree.parentNodePath, tree])
  );
  if (root === undefined) {
    return (
      <div className="grid h-full place-items-center text-sm text-text-tertiary">
        No workflow graph is available.
      </div>
    );
  }
  return (
    <div
      className="h-full overflow-auto p-6"
      style={{
        background:
          'radial-gradient(circle at 1px 1px, color-mix(in oklch, white, transparent 95%) 1px, transparent 0) 0 0 / 26px 26px',
      }}
    >
      <div className="mx-auto max-w-4xl">
        <WorkflowLane
          tree={root}
          childByParent={childByParent}
          expanded={expanded}
          selectedNodePath={selectedNodePath}
          onToggle={onToggle}
          onSelect={onSelect}
          depth={0}
        />
      </div>
    </div>
  );
}
