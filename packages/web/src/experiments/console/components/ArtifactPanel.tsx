import { useEffect, useState, type ReactElement } from 'react';
import { useEntity } from '../store/cache';
import { K } from '../store/keys';
import * as skill from '../skills';
import type { ArtifactFile } from '../skills/runs';
import { ArtifactContent, ArtifactKindIcon, describeArtifact } from './ArtifactPresentation';

interface ArtifactPanelProps {
  runId: string;
}

/**
 * Full-width artifact browser: sidebar of files on the left, rendered file
 * on the right. Sourced from `/api/runs/:runId/artifacts` (walks the on-disk
 * artifact dir) rather than `workflow_artifact` events — bash/script nodes
 * typically write straight to $ARTIFACTS_DIR without emitting an event.
 *
 * Friendly summaries are the default. Raw JSON stays available behind a
 * technical disclosure so users can inspect it without making it the primary UI.
 */
export function ArtifactPanel({ runId }: ArtifactPanelProps): ReactElement {
  const {
    data: files,
    error: listError,
    loading,
  } = useEntity<ArtifactFile[]>(K.artifacts(runId), () => skill.listRunArtifacts(runId));

  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setSelected(null);
  }, [runId]);

  // Auto-select the first file once the list arrives (or when the run changes).
  useEffect(() => {
    if (files !== undefined && files.length > 0 && selected === null) {
      const newestReadable = [...files]
        .filter(file => !describeArtifact(file.path).technical)
        .sort(
          (left, right) =>
            new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime()
        )[0];
      setSelected(newestReadable?.path ?? files[0].path);
    }
  }, [files, selected]);

  if (loading) {
    return <div className="p-6 text-[12px] text-text-tertiary">Loading artifacts…</div>;
  }
  if (listError !== undefined) {
    return (
      <div className="p-6 font-mono text-[12px] text-error">
        Could not list artifacts: {listError.message}
      </div>
    );
  }
  if (files === undefined || files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="text-center text-[13px] text-text-tertiary">
          <p>No artifacts written to disk for this run.</p>
          <p className="mt-2 font-mono text-[11px]">
            Workflows that emit reports or plans write them to{' '}
            <code className="rounded bg-surface-inset px-1">$ARTIFACTS_DIR</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      <ArtifactSidebar files={files} selected={selected} onSelect={setSelected} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selected !== null ? (
          <ArtifactViewer runId={runId} path={selected} />
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-text-tertiary">
            Pick a file from the left.
          </div>
        )}
      </div>
    </div>
  );
}

interface SidebarProps {
  files: ArtifactFile[];
  selected: string | null;
  onSelect: (path: string) => void;
}

function ArtifactSidebar({ files, selected, onSelect }: SidebarProps): ReactElement {
  const byNewest = (left: ArtifactFile, right: ArtifactFile): number =>
    new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();
  const resultFiles = files.filter(file => !describeArtifact(file.path).technical).sort(byNewest);
  const technicalFiles = files.filter(file => describeArtifact(file.path).technical).sort(byNewest);
  const renderFiles = (items: ArtifactFile[]): ReactElement => (
    <ul className="flex flex-col gap-1 p-2">
      {items.map(file => {
        const isSelected = selected === file.path;
        const presentation = describeArtifact(file.path);
        const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : null;
        return (
          <li key={file.path}>
            <button
              type="button"
              onClick={() => {
                onSelect(file.path);
              }}
              aria-pressed={isSelected}
              title={`${presentation.title}: ${presentation.description}`}
              className={`group flex w-full gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                isSelected ? 'bg-surface-elevated' : 'hover:bg-surface-hover'
              }`}
            >
              <span className="mt-0.5 shrink-0 text-text-tertiary">
                <ArtifactKindIcon technical={presentation.technical} />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-[12px] font-medium ${
                    isSelected ? 'text-text-primary' : 'text-text-secondary'
                  }`}
                >
                  {presentation.title}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-[10px] leading-4 text-text-tertiary">
                  {presentation.description}
                </span>
                <span className="mt-1 flex items-center justify-between gap-2 font-mono text-[9px] text-text-tertiary">
                  <span className="truncate">{dir ?? file.path}</span>
                  <span className="shrink-0 tabular-nums">{formatSize(file.size)}</span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
  return (
    <nav
      aria-label="Artifacts"
      className="flex h-full w-[260px] shrink-0 flex-col overflow-y-auto border-r border-border bg-surface-inset"
    >
      <header className="sticky top-0 z-10 border-b border-border bg-surface-inset px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
        Files · {files.length.toString()}
      </header>
      {resultFiles.length > 0 ? renderFiles(resultFiles) : null}
      {technicalFiles.length > 0 ? (
        <details className="border-t border-border">
          <summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-tertiary hover:text-text-secondary">
            Technical files · {technicalFiles.length.toString()}
          </summary>
          {renderFiles(technicalFiles)}
        </details>
      ) : null}
    </nav>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes.toString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface ViewerProps {
  runId: string;
  path: string;
}

function ArtifactViewer({ runId, path }: ViewerProps): ReactElement {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setContent(null);
    void skill
      .fetchArtifact(runId, path)
      .then(text => {
        setContent(text);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load artifact');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [runId, path]);

  const presentation = describeArtifact(path);

  return (
    <>
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-surface px-6 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text-primary">
            {presentation.title}
          </div>
          <div className="mt-0.5 text-[11px] text-text-tertiary">{presentation.description}</div>
          <div className="mt-1 truncate font-mono text-[9px] text-text-tertiary">{path}</div>
        </div>
        <a
          href={`/api/artifacts/${encodeURIComponent(runId)}/${path
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 font-mono text-[10px] text-text-tertiary transition-colors hover:text-text-primary"
        >
          open raw ↗
        </a>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <p className="font-mono text-[12px] text-text-tertiary">Loading…</p>
        ) : error !== null ? (
          <p className="font-mono text-[12px] text-error">{error}</p>
        ) : content === null ? null : (
          <ArtifactContent path={path} content={content} />
        )}
      </div>
    </>
  );
}
