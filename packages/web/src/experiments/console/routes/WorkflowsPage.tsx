import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams, Link } from 'react-router';
import { Search, X, Play, Plus } from 'lucide-react';
import {
  Bug,
  GitMerge,
  Rocket,
  RefreshCw,
  TestTube,
  Workflow,
  Eye,
  Lightbulb,
  Wrench,
  Zap,
  Bot,
  Pencil,
  type LucideIcon,
} from 'lucide-react';
import { useEntity } from '../store/cache';
import { K } from '../store/keys';
import * as skill from '../skills';
import { startRun } from '../skills/startRun';
import { partitionWorkflows } from '../lib/partition-workflows';
import {
  parseWorkflowDescription,
  getWorkflowDisplayName,
  getWorkflowCategory,
  getWorkflowTags,
  getWorkflowIconName,
  CATEGORIES,
  type WorkflowCategory,
  type WorkflowIconName,
} from '../lib/workflow-metadata';
import { EmptyState } from '../components/EmptyState';
import { ProjectViewTabs } from '../components/ProjectViewTabs';
import type { Project } from '../primitives/project';
import type { Workflow as WorkflowType } from '../primitives/workflow';

// ---------------------------------------------------------------------------
// Icon map (mirrors legacy WorkflowCard)
// ---------------------------------------------------------------------------

const ICON_MAP: Record<WorkflowIconName, LucideIcon> = {
  Bug,
  GitMerge,
  Rocket,
  RefreshCw,
  TestTube,
  Workflow,
  Eye,
  Lightbulb,
  Wrench,
  Zap,
  Bot,
};

// ---------------------------------------------------------------------------
// WorkflowCard — console-native version (no legacy deps, console routes)
// ---------------------------------------------------------------------------

interface WorkflowCardProps {
  workflow: WorkflowType;
  isSelected: boolean;
  onToggle: (name: string) => void;
  onRun: (name: string) => void;
  /** Optional cwd for builder link */
  projectCwd?: string;
}

function WorkflowCard({
  workflow,
  isSelected,
  onToggle,
  onRun,
  projectCwd: _projectCwd,
}: WorkflowCardProps): ReactElement {
  const parsed = parseWorkflowDescription(workflow.description ?? '');
  const displayName = getWorkflowDisplayName(workflow.name);
  const category = getWorkflowCategory(workflow.name, workflow.description ?? '');
  // Console Workflow primitive has no tags field — fall back to inference
  const tags = getWorkflowTags(workflow.name, parsed, undefined);
  const iconName = getWorkflowIconName(workflow.name, category);
  const WORKFLOW_ICON = ICON_MAP[iconName] ?? Workflow;

  const hasSections =
    parsed.whenToUse || parsed.triggers.length > 0 || parsed.does || parsed.constraints;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Select workflow: ${displayName}`}
      aria-pressed={isSelected}
      onClick={(): void => {
        onToggle(workflow.name);
      }}
      onKeyDown={(e): void => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle(workflow.name);
        }
      }}
      className={`flex flex-col rounded-lg border p-4 transition-colors cursor-pointer h-full ${
        isSelected
          ? 'border-accent bg-accent/5'
          : 'border-border bg-surface hover:bg-surface-hover hover:border-border/80'
      }`}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3 shrink-0">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-elevated text-text-secondary">
          <WORKFLOW_ICON className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-text-primary leading-tight">{displayName}</h3>
          <p className="text-xs text-text-tertiary font-mono mt-0.5 truncate">{workflow.name}</p>
        </div>
      </div>

      {/* Metadata sections */}
      {hasSections ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 mb-3 text-xs flex-1">
          <div className="space-y-2">
            {parsed.whenToUse && (
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-bright">
                  When to use
                </span>
                <p className="text-text-secondary mt-0.5 line-clamp-3 leading-relaxed">
                  {parsed.whenToUse}
                </p>
              </div>
            )}
            {parsed.does && (
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-bright">
                  Does
                </span>
                <p className="text-text-secondary mt-0.5 line-clamp-2 leading-relaxed">
                  {parsed.does}
                </p>
              </div>
            )}
          </div>
          <div className="space-y-2">
            {parsed.triggers.length > 0 && (
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-bright">
                  Triggers
                </span>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {parsed.triggers.slice(0, 4).map(trigger => (
                    <span
                      key={trigger}
                      className="inline-block rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] text-text-secondary"
                    >
                      {trigger}
                    </span>
                  ))}
                  {parsed.triggers.length > 4 && (
                    <span className="inline-block text-[10px] text-text-tertiary">
                      +{parsed.triggers.length - 4} more
                    </span>
                  )}
                </div>
              </div>
            )}
            {parsed.constraints && (
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-warning">
                  Not for
                </span>
                <p className="text-text-secondary mt-0.5 line-clamp-2 leading-relaxed">
                  {parsed.constraints}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        workflow.description && (
          <p className="text-xs text-text-secondary mb-3 line-clamp-3 flex-1">
            {workflow.description}
          </p>
        )
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-border/50 mt-auto shrink-0">
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 3).map(tag => (
            <span
              key={tag}
              className="inline-block rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-medium text-text-secondary"
            >
              #{tag}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {/* Edit button — points to console builder */}
          <Link
            to={`/console/builder?edit=${encodeURIComponent(workflow.name)}`}
            onClick={(e): void => {
              e.stopPropagation();
            }}
            className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
            title="Edit in builder"
          >
            <Pencil className="size-3.5" />
          </Link>
          <button
            onClick={(e): void => {
              e.stopPropagation();
              onRun(workflow.name);
            }}
            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors"
            title="Configure and run workflow"
          >
            <Play className="size-3" />
            Run
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkflowsPage — console route
// ---------------------------------------------------------------------------

interface WorkflowListResult {
  workflows: WorkflowType[];
  recommended: string[];
}

export function WorkflowsPage(): ReactElement {
  const { projectId } = useParams<{ projectId?: string }>();
  const navigate = useNavigate();

  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<WorkflowCategory>('All');
  const messageInputRef = useRef<HTMLInputElement | null>(null);

  // Load project so we can get cwd for the workflow list
  const { data: project } = useEntity<Project | null>(
    projectId !== undefined ? K.project(projectId) : 'noop:no-project',
    () => (projectId !== undefined ? skill.getProject(projectId) : Promise.resolve(null))
  );

  const cwd = project?.path;

  const {
    data: workflowsResult,
    loading,
    error,
  } = useEntity<WorkflowListResult>(
    projectId !== undefined ? K.workflows(projectId, cwd) : K.workflows('global', undefined),
    () => skill.listWorkflows(cwd)
  );

  const workflows = workflowsResult?.workflows;
  const recommendedNames = workflowsResult?.recommended ?? [];

  // Focus message input when a workflow is selected
  useEffect(() => {
    if (selectedWorkflow !== null) {
      requestAnimationFrame(() => {
        messageInputRef.current?.focus();
      });
    }
  }, [selectedWorkflow]);

  // Reset selection when filters change
  useEffect(() => {
    setSelectedWorkflow(null);
    setRunMessage('');
    setRunError(null);
  }, [searchQuery, activeCategory]);

  const { filteredWorkflows, recommendedWorkflows, restWorkflows } = useMemo(() => {
    if (!workflows) {
      return { filteredWorkflows: [], recommendedWorkflows: [], restWorkflows: [] };
    }
    const filtered = workflows.filter(wf => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesName = wf.name.toLowerCase().includes(q);
        const matchesDesc = (wf.description ?? '').toLowerCase().includes(q);
        if (!matchesName && !matchesDesc) return false;
      }
      if (activeCategory !== 'All') {
        const cat = getWorkflowCategory(wf.name, wf.description ?? '');
        if (cat !== activeCategory) return false;
      }
      return true;
    });
    const { recommended, rest } = partitionWorkflows(filtered, recommendedNames);
    return { filteredWorkflows: filtered, recommendedWorkflows: recommended, restWorkflows: rest };
  }, [workflows, searchQuery, activeCategory, recommendedNames]);

  const handleRun = async (workflowName: string): Promise<void> => {
    if (!runMessage.trim() || running || projectId === undefined) return;
    setRunning(true);
    setRunError(null);
    try {
      await startRun({ projectId, workflow: workflowName, message: runMessage.trim() });
      setRunMessage('');
      setSelectedWorkflow(null);
      // Navigate to the runs page so the user can see the run appear
      navigate(`/console/p/${projectId}`);
    } catch (e: unknown) {
      setRunError(e instanceof Error ? e.message : 'Failed to start workflow.');
    } finally {
      setRunning(false);
    }
  };

  const displayName = selectedWorkflow !== null ? getWorkflowDisplayName(selectedWorkflow) : '';
  const hasWorkflows = workflows != null && workflows.length > 0;

  return (
    <section className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-6 py-4">
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-base font-medium text-text-primary">
              {project?.name ?? 'Workflows'}
            </h1>
            <p className="text-xs text-text-tertiary">{project?.path ?? 'Loading…'}</p>
          </div>
          <Link
            to="/console/builder"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
          >
            <Plus className="size-4" />
            New Workflow
          </Link>
        </div>
        {projectId !== undefined ? (
          <ProjectViewTabs projectId={projectId} active="workflows" />
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-4">
        {error !== undefined ? (
          <EmptyState title="Could not load workflows." hint={error.message} />
        ) : loading ? (
          <EmptyState title="Loading…" />
        ) : !hasWorkflows ? (
          <EmptyState
            title="No workflows found."
            hint={
              projectId !== undefined
                ? 'Add workflow definitions to .anvil/workflows/ in the project root.'
                : 'Bundled defaults should appear here automatically.'
            }
          />
        ) : filteredWorkflows.length === 0 ? (
          <EmptyState title="No workflows match your search." />
        ) : (
          <div className="space-y-5">
            {recommendedWorkflows.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">
                  Recommended for this project
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {recommendedWorkflows.map(wf => (
                    <WorkflowCard
                      key={wf.name}
                      workflow={wf}
                      isSelected={selectedWorkflow === wf.name}
                      onToggle={(name): void => {
                        setSelectedWorkflow(selectedWorkflow === name ? null : name);
                        setRunMessage('');
                        setRunError(null);
                      }}
                      onRun={(name): void => {
                        setSelectedWorkflow(name);
                        setRunMessage('');
                        setRunError(null);
                      }}
                      projectCwd={cwd}
                    />
                  ))}
                </div>
                {restWorkflows.length > 0 && <hr className="border-border" />}
              </div>
            )}
            {restWorkflows.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {restWorkflows.map(wf => (
                  <WorkflowCard
                    key={wf.name}
                    workflow={wf}
                    isSelected={selectedWorkflow === wf.name}
                    onToggle={(name): void => {
                      setSelectedWorkflow(selectedWorkflow === name ? null : name);
                      setRunMessage('');
                      setRunError(null);
                    }}
                    onRun={(name): void => {
                      setSelectedWorkflow(name);
                      setRunMessage('');
                      setRunError(null);
                    }}
                    projectCwd={cwd}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Search + category strip — only when there are workflows */}
      {hasWorkflows && (
        <div className="shrink-0 border-t border-border px-6 py-3 flex items-center gap-3 bg-surface-elevated/60">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-text-tertiary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e): void => {
                setSearchQuery(e.target.value);
              }}
              placeholder="Search workflows…"
              className="w-full pl-8 pr-3 py-1.5 rounded-md border border-border bg-surface font-mono text-[12.5px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={(): void => {
                  setActiveCategory(cat);
                }}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  activeCategory === cat
                    ? 'bg-primary text-white'
                    : 'bg-surface text-text-secondary hover:text-text-primary border border-border'
                }`}
                style={activeCategory !== cat ? { borderColor: 'var(--border)' } : undefined}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sticky run bar */}
      {selectedWorkflow !== null && (
        <div className="shrink-0 border-t border-accent/40 bg-surface-elevated px-6 py-3 shadow-[0_-4px_20px_rgba(59,130,246,0.12)]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm font-medium text-text-primary">{displayName}</span>
              <button
                onClick={(): void => {
                  setSelectedWorkflow(null);
                  setRunMessage('');
                  setRunError(null);
                }}
                className="p-0.5 rounded text-text-tertiary hover:text-text-primary transition-colors"
                title="Dismiss"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <input
              ref={messageInputRef}
              type="text"
              value={runMessage}
              onChange={(e): void => {
                setRunMessage(e.target.value);
              }}
              placeholder="Enter a message for this workflow…"
              className="flex-1 min-w-0 px-3 py-1.5 rounded-md border border-border bg-surface font-mono text-[12.5px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
              style={{ borderColor: 'var(--border)' }}
              onKeyDown={(e): void => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleRun(selectedWorkflow);
                }
              }}
              disabled={running}
            />
            <button
              onClick={(): void => {
                void handleRun(selectedWorkflow);
              }}
              disabled={running || !runMessage.trim() || projectId === undefined}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {running ? 'Starting…' : 'Run'}
            </button>
          </div>
          {projectId === undefined && (
            <p className="text-[11px] text-text-tertiary mt-1">
              Select a project from the sidebar to run this workflow.
            </p>
          )}
          {runError !== null && <p className="text-[11px] text-error mt-1">{runError}</p>}
        </div>
      )}
    </section>
  );
}
