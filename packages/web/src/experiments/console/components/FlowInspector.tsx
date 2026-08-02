import { X } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { invalidate, useEntity } from '../store/cache';
import { K } from '../store/keys';
import * as skill from '../skills';
import type { WorkflowFlowNode, WorkflowNodeIoResponse } from '../skills/flow';
import type { ArtifactFile } from '../skills/runs';
import { ensureUtc, formatVietnamDateTime } from '../../../lib/format';
import { ArtifactContent, ArtifactKindIcon, describeArtifact } from './ArtifactPresentation';

type InspectorTab = 'overview' | 'inputs' | 'outputs' | 'artifacts' | 'events';

function JsonValue({ value }: { value: unknown }): ReactElement {
  return (
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-inset p-3 font-mono text-[11px] leading-5 text-text-secondary">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Field({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b border-border py-2 text-xs last:border-0">
      <span className="text-text-tertiary">{label}</span>
      <span className="min-w-0 break-words font-mono text-text-secondary">{value}</span>
    </div>
  );
}

function NodeArtifacts({
  node,
  mappedInputs,
  mappedOutputs,
}: {
  node: WorkflowFlowNode;
  mappedInputs: Record<string, string>;
  mappedOutputs: Record<string, string>;
}): ReactElement {
  const artifactRunId = node.childRunId ?? node.runId;
  const key =
    artifactRunId === null ? `noop:artifacts:${node.nodePath}` : K.artifacts(artifactRunId);
  const {
    data: files,
    loading,
    error,
  } = useEntity<ArtifactFile[]>(key, () =>
    artifactRunId === null ? Promise.resolve([]) : skill.listRunArtifacts(artifactRunId)
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);

  const byNewest = (left: ArtifactFile, right: ArtifactFile): number =>
    new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();
  const resultFiles = (files ?? [])
    .filter(file => !describeArtifact(file.path).technical)
    .sort(byNewest);
  const technicalFiles = (files ?? [])
    .filter(file => describeArtifact(file.path).technical)
    .sort(byNewest);
  const phaseStartedAt =
    node.startedAt === null ? null : new Date(ensureUtc(node.startedAt)).getTime();
  const createdInPhase = (file: ArtifactFile): boolean =>
    phaseStartedAt === null || new Date(file.modifiedAt).getTime() >= phaseStartedAt;
  const phaseResultFiles = resultFiles.filter(createdInPhase);
  const inheritedResultFiles = resultFiles.filter(file => !createdInPhase(file));

  useEffect(() => {
    const nextFiles = [...(files ?? [])].sort(
      (left, right) => new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime()
    );
    setSelected(
      nextFiles.find(
        file =>
          !describeArtifact(file.path).technical &&
          (node.startedAt === null ||
            new Date(ensureUtc(file.modifiedAt)).getTime() >=
              new Date(ensureUtc(node.startedAt)).getTime())
      )?.path ??
        nextFiles.find(file => !describeArtifact(file.path).technical)?.path ??
        nextFiles[0]?.path ??
        null
    );
  }, [artifactRunId, files, node.startedAt]);

  useEffect(() => {
    if (artifactRunId === null || selected === null) {
      setContent(null);
      return;
    }
    setContent(null);
    setContentError(null);
    void skill
      .fetchArtifact(artifactRunId, selected)
      .then(setContent)
      .catch((fetchError: unknown) => {
        setContentError(fetchError instanceof Error ? fetchError.message : 'Không thể đọc file');
      });
  }, [artifactRunId, selected]);

  const renderFiles = (items: ArtifactFile[]): ReactElement => (
    <div className="space-y-1.5">
      {items.map(file => {
        const presentation = describeArtifact(file.path);
        const active = selected === file.path;
        return (
          <button
            key={file.path}
            type="button"
            onClick={() => {
              setSelected(file.path);
            }}
            className={`flex w-full gap-2 rounded-lg border p-2.5 text-left ${
              active
                ? 'border-[color:var(--brand-cyan)] bg-[color:var(--brand-cyan)]/[0.04]'
                : 'border-border hover:bg-surface-hover'
            }`}
          >
            <span className="mt-0.5 text-text-tertiary">
              <ArtifactKindIcon technical={presentation.technical} />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-text-primary">
                {presentation.title}
              </span>
              <span className="mt-0.5 block text-[10px] leading-4 text-text-tertiary">
                {presentation.description}
              </span>
              <span className="mt-1 block truncate font-mono text-[9px] text-text-tertiary">
                {file.path}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-4">
      {loading ? <p className="text-xs text-text-tertiary">Đang tải file kết quả…</p> : null}
      {error !== undefined ? <p className="text-xs text-error">{error.message}</p> : null}
      {!loading && (files?.length ?? 0) === 0 ? (
        <p className="rounded border border-border p-3 text-xs text-text-tertiary">
          Step này chưa ghi file kết quả nào.
        </p>
      ) : null}
      {phaseResultFiles.length > 0 ? (
        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
            Kết quả tạo trong phase · {phaseResultFiles.length.toString()}
          </h3>
          {renderFiles(phaseResultFiles)}
        </section>
      ) : null}
      {inheritedResultFiles.length > 0 ? (
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
            Đầu vào kế thừa từ phase trước · {inheritedResultFiles.length.toString()}
          </summary>
          <div className="border-t border-border p-2">{renderFiles(inheritedResultFiles)}</div>
        </details>
      ) : null}
      {technicalFiles.length > 0 ? (
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
            File kỹ thuật · {technicalFiles.length.toString()}
          </summary>
          <div className="border-t border-border p-2">{renderFiles(technicalFiles)}</div>
        </details>
      ) : null}
      {selected !== null ? (
        <section className="border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="truncate text-xs font-semibold text-text-primary">
              {describeArtifact(selected).title}
            </h3>
            {artifactRunId !== null ? (
              <a
                href={`/api/artifacts/${encodeURIComponent(artifactRunId)}/${selected
                  .split('/')
                  .map(encodeURIComponent)
                  .join('/')}`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-[10px] text-[color:var(--brand-cyan)] hover:underline"
              >
                Mở file gốc ↗
              </a>
            ) : null}
          </div>
          {contentError !== null ? <p className="text-xs text-error">{contentError}</p> : null}
          {content === null && contentError === null ? (
            <p className="text-xs text-text-tertiary">Đang đọc nội dung…</p>
          ) : content !== null ? (
            <ArtifactContent path={selected} content={content} />
          ) : null}
        </section>
      ) : null}
      <details className="rounded-lg border border-border bg-surface-inset">
        <summary className="cursor-pointer px-3 py-2 text-[10px] text-text-tertiary">
          Xem artifact mapping kỹ thuật
        </summary>
        <div className="space-y-3 border-t border-border p-3">
          <JsonValue value={{ inputs: mappedInputs, outputs: mappedOutputs }} />
        </div>
      </details>
    </div>
  );
}

export function FlowInspector({
  rootRunId,
  node,
  onClose,
}: {
  rootRunId: string | null;
  node: WorkflowFlowNode;
  onClose: () => void;
}): ReactElement {
  const [tab, setTab] = useState<InspectorTab>('overview');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  useEffect(() => {
    setTab('overview');
    setFeedback(null);
  }, [node.nodePath]);

  const ioKey =
    rootRunId !== null && node.runId !== null
      ? K.flowNodeIo(rootRunId, node.nodePath)
      : `noop:flow-io:${node.nodePath}`;
  const {
    data: io,
    error: ioError,
    loading: ioLoading,
  } = useEntity<WorkflowNodeIoResponse | null>(ioKey, () =>
    rootRunId !== null && node.runId !== null
      ? skill.getWorkflowNodeIo(rootRunId, node.nodePath)
      : Promise.resolve(null)
  );
  const latest = io?.attempts.at(-1);

  const runAction = async (
    action: 'continue' | 'approve' | 'reject' | 'resume' | 'cancel' | 'abandon'
  ): Promise<void> => {
    if (rootRunId === null) return;
    setBusy(action);
    setFeedback(null);
    try {
      if (action === 'continue') await skill.continueRun(rootRunId);
      if (action === 'approve') await skill.approveRun(rootRunId, comment.trim() || undefined);
      if (action === 'reject')
        await skill.rejectRun(rootRunId, comment.trim() || 'Rejected from Flow');
      if (action === 'resume') await skill.resumeRun(rootRunId);
      if (action === 'cancel') await skill.cancelRun(rootRunId);
      if (action === 'abandon') await skill.abandonRun(rootRunId);
      setFeedback(`${action} accepted`);
      invalidate('flow');
      invalidate('runs');
      invalidate('flow-runs');
      invalidate(K.run(rootRunId));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const tabs: readonly { key: InspectorTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'inputs', label: 'Inputs' },
    { key: 'outputs', label: 'Outputs' },
    { key: 'artifacts', label: 'Artifacts' },
    { key: 'events', label: 'Events' },
  ];

  return (
    <aside className="flex h-full w-[390px] shrink-0 flex-col border-l border-border bg-surface max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:w-full">
      <header className="flex items-start gap-3 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-text-primary">{node.label}</div>
          <div className="mt-1 font-mono text-[10px] text-text-tertiary">{node.nodePath}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-7 place-items-center rounded hover:bg-surface-hover"
          aria-label="Close inspector"
        >
          <X className="size-4" />
        </button>
      </header>

      <nav
        className="flex overflow-x-auto border-b border-border px-2"
        aria-label="Node detail tabs"
      >
        {tabs.map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setTab(item.key);
            }}
            className={`border-b-2 px-2.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${
              tab === item.key
                ? 'border-[color:var(--brand-magenta)] text-text-primary'
                : 'border-transparent text-text-tertiary hover:text-text-primary'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {node.partialTelemetry ? (
          <div className="mb-3 rounded border border-warning/30 bg-warning/[0.05] p-2 text-[11px] text-warning">
            Partial telemetry: this run predates node I/O manifests.
          </div>
        ) : null}
        {ioError !== undefined ? (
          <div className="mb-3 rounded border border-error/30 bg-error/[0.05] p-2 font-mono text-[10px] text-error">
            {ioError.message}
          </div>
        ) : null}

        {tab === 'overview' ? (
          <div>
            <Field label="Status" value={node.effectiveStatus} />
            <Field label="Persisted" value={node.persistedStatus} />
            <Field label="Type" value={node.kind} />
            <Field label="Depends on" value={node.dependsOn.join(', ') || 'none'} />
            <Field label="Attempts" value={node.attemptCount.toString()} />
            <Field label="Provider" value={node.provider ?? 'n/a'} />
            <Field label="Model" value={node.model ?? 'n/a'} />
            <Field label="Child run" value={node.childRunId ?? 'n/a'} />
            {node.ui.phase !== undefined ? <Field label="Phase" value={node.ui.phase} /> : null}
            {node.ui.gate !== undefined ? <Field label="Gate" value={node.ui.gate} /> : null}
            {node.error !== null ? (
              <div className="mt-3 rounded border border-error/30 bg-error/[0.05] p-3 text-xs text-error">
                {node.error}
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'inputs' ? (
          <div className="space-y-4">
            <section>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                Declared
              </h3>
              <JsonValue value={latest?.declaredInputs ?? node.declaredInputs} />
            </section>
            <section>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                Resolved
              </h3>
              {ioLoading ? (
                <p className="text-xs text-text-tertiary">Loading resolved inputs…</p>
              ) : (
                <JsonValue value={latest?.resolvedInputs ?? {}} />
              )}
            </section>
          </div>
        ) : null}

        {tab === 'outputs' ? (
          <div className="space-y-4">
            <section>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                Contract
              </h3>
              <JsonValue value={node.declaredOutputs} />
            </section>
            <section>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                Actual output
              </h3>
              {ioLoading ? (
                <p className="text-xs text-text-tertiary">Loading output…</p>
              ) : (
                <JsonValue value={latest?.output.value ?? latest?.output.preview ?? null} />
              )}
              {latest?.output.artifactPath !== undefined ? (
                <a
                  href={`/api/artifacts/${encodeURIComponent(node.runId ?? rootRunId ?? '')}/${latest.output.artifactPath
                    .split('/')
                    .map(encodeURIComponent)
                    .join('/')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block break-all font-mono text-[10px] text-[color:var(--brand-cyan)] hover:underline"
                >
                  Full output: {latest.output.artifactPath}
                </a>
              ) : null}
            </section>
          </div>
        ) : null}

        {tab === 'artifacts' ? (
          <NodeArtifacts
            node={node}
            mappedInputs={latest?.artifacts.inputs ?? {}}
            mappedOutputs={latest?.artifacts.outputs ?? {}}
          />
        ) : null}

        {tab === 'events' ? (
          <div className="space-y-2">
            {(io?.events ?? []).map(event => (
              <div key={event.id} className="rounded border border-border bg-surface-inset p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-text-primary">
                    {event.event_type}
                  </span>
                  <span
                    className="font-mono text-[9px] text-text-tertiary"
                    title={event.created_at}
                  >
                    {formatVietnamDateTime(event.created_at, {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-[10px] text-text-tertiary">
                    Raw data
                  </summary>
                  <div className="mt-2">
                    <JsonValue value={event.data} />
                  </div>
                </details>
              </div>
            ))}
            {!ioLoading && (io?.events.length ?? 0) === 0 ? (
              <p className="text-xs text-text-tertiary">No node events.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {rootRunId !== null && node.actions.length > 0 ? (
        <footer className="border-t border-border p-4">
          {node.actions.includes('approve') || node.actions.includes('reject') ? (
            <input
              value={comment}
              onChange={event => {
                setComment(event.target.value);
              }}
              placeholder="Optional approval comment / rejection reason"
              className="mb-3 w-full rounded border border-border-bright bg-surface-inset px-3 py-2 text-xs outline-none focus:border-[color:var(--brand-magenta)]"
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            {node.actions.map(action => (
              <button
                key={action}
                type="button"
                disabled={busy !== null}
                onClick={() => void runAction(action)}
                className={`rounded px-3 py-2 text-xs font-semibold disabled:opacity-50 ${
                  action === 'continue' || action === 'approve' || action === 'resume'
                    ? 'brand-bar text-white'
                    : action === 'reject' || action === 'cancel'
                      ? 'border border-error/40 text-error hover:bg-error/10'
                      : 'border border-border-bright text-text-secondary hover:bg-surface-hover'
                }`}
              >
                {busy === action
                  ? `${action}…`
                  : action === 'continue'
                    ? 'Continue to next phase'
                    : action}
              </button>
            ))}
          </div>
          {feedback !== null ? (
            <div className="mt-2 font-mono text-[10px] text-text-secondary">{feedback}</div>
          ) : null}
        </footer>
      ) : null}
    </aside>
  );
}
