import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock3,
  Download,
  FileArchive,
  FileText,
  Info,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  System3PresentationBlock,
  System3ResourceDescriptor,
  System3ResourcePresentation,
} from './types';

export interface ModelResourceView {
  model: string;
  content: 'code' | 'output';
}

export interface ModelResourceSelection {
  blocks: readonly System3PresentationBlock[];
  unavailable: boolean;
}

export function selectModelResourceBlocks(
  blocks: readonly System3PresentationBlock[],
  modelView: ModelResourceView
): ModelResourceSelection {
  const groups: {
    metadata: System3PresentationBlock;
    modelIndex: number;
    blocks: System3PresentationBlock[];
  }[] = [];
  for (const block of blocks) {
    if (
      block.kind === 'facts' &&
      block.title === 'Model comparison' &&
      block.items.some(item => item.label === 'model')
    ) {
      groups.push({ metadata: block, modelIndex: groups.length, blocks: [] });
      continue;
    }
    groups.at(-1)?.blocks.push(block);
  }
  const matchingGroups = groups.filter(
    item =>
      item.metadata.kind === 'facts' &&
      item.metadata.items.some(fact => fact.label === 'model' && fact.value === modelView.model)
  );
  const group = matchingGroups.length === 1 ? matchingGroups[0] : undefined;
  if (group?.metadata.kind !== 'facts') {
    return { blocks: [], unavailable: true };
  }
  const status = group.metadata.items.find(item => item.label === 'status')?.value;
  const outputTitle = `Model output · ${modelView.model}`;
  const outputIndex = group.blocks.findIndex(
    block => block.kind === 'table' && block.title === outputTitle
  );
  if (status !== 'Hoàn tất' || outputIndex < 0) {
    return { blocks: [group.metadata], unavailable: true };
  }
  if (modelView.content === 'output') {
    const output = group.blocks[outputIndex];
    return output?.kind === 'table'
      ? { blocks: [group.metadata, output], unavailable: false }
      : { blocks: [group.metadata], unavailable: true };
  }
  const code = group.blocks[outputIndex + 1];
  const expectedCodePath = `**Python solution · models/${group.modelIndex.toString()}/solution.py**`;
  return code?.kind === 'markdown' &&
    typeof code.markdown === 'string' &&
    code.markdown.includes(expectedCodePath)
    ? { blocks: [group.metadata, code], unavailable: false }
    : { blocks: [group.metadata], unavailable: true };
}

function statusLabel(status: System3ResourceDescriptor['status']): string {
  if (status === 'current') return 'Đang dùng';
  if (status === 'candidate') return 'Bản nháp';
  if (status === 'stale') return 'Cần cập nhật';
  if (status === 'superseded') return 'Phiên bản cũ';
  if (status === 'failed') return 'Lỗi';
  return 'Đang xử lý';
}

function statusIcon(status: System3ResourceDescriptor['status']): ReactElement {
  if (status === 'current') return <Check size={14} />;
  if (status === 'stale' || status === 'failed') return <AlertTriangle size={14} />;
  return <Clock3 size={14} />;
}

export function ResourceList({
  resources,
  empty,
  onOpen,
}: {
  resources: readonly System3ResourceDescriptor[];
  empty: string;
  onOpen: (resource: System3ResourceDescriptor, opener: HTMLElement) => void;
}): ReactElement {
  if (resources.length === 0) return <p className="s3-resource-empty">{empty}</p>;
  return (
    <div className="s3-resource-list">
      {resources.map(resource => (
        <button
          key={`${resource.resourceType}:${resource.id}:${resource.relation}`}
          type="button"
          className="s3-resource-card"
          onClick={event => {
            onOpen(resource, event.currentTarget);
          }}
        >
          <span className="s3-resource-card-icon" aria-hidden="true">
            {resource.mediaType.includes('gzip') ? (
              <FileArchive size={17} />
            ) : (
              <FileText size={17} />
            )}
          </span>
          <span className="s3-resource-card-copy">
            <strong>{resource.title}</strong>
            <small>{resource.summary}</small>
            <span>
              {resource.version === null ? null : `v${resource.version.toString()} · `}
              {resource.createdAt === null
                ? 'Chưa có thời điểm tạo'
                : new Date(resource.createdAt).toLocaleString('vi-VN')}
            </span>
          </span>
          <span className={`s3-resource-status ${resource.status}`}>
            {statusIcon(resource.status)} {statusLabel(resource.status)}
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function Block({
  block,
  downloadUrl,
}: {
  block: System3PresentationBlock;
  downloadUrl: string | null;
}): ReactElement {
  if (block.kind === 'callout') {
    return (
      <section className={`s3-presentation-callout ${block.tone}`}>
        <Info size={17} aria-hidden="true" />
        <div>
          {block.title === null ? null : <h3>{block.title}</h3>}
          <p>{block.body}</p>
        </div>
      </section>
    );
  }
  if (block.kind === 'facts') {
    return (
      <section className="s3-presentation-section">
        {block.title === null ? null : <h3>{block.title}</h3>}
        <dl className="s3-presentation-facts">
          {block.items.map(item => (
            <div key={`${item.label}:${item.value}`}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  if (block.kind === 'markdown') {
    return (
      <section className="s3-presentation-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.markdown}</ReactMarkdown>
      </section>
    );
  }
  if (block.kind === 'citations') {
    return (
      <section className="s3-presentation-section s3-source-citations">
        <h3>{block.title}</h3>
        <p>Đoạn Markdown từ phiên bản nguồn đã dùng; không phải bản tóm tắt của AI.</p>
        {block.items.map((citation, index) => (
          <details
            key={`${citation.sourceVersionId}:${index.toString()}`}
            className="s3-source-citation"
          >
            <summary>Xem nguồn {citation.label}</summary>
            <p className="s3-source-citation-location">
              {citation.filename}
              {citation.startLine === null
                ? ''
                : ` · Dòng ${citation.startLine.toString()}–${(citation.endLine ?? citation.startLine).toString()}`}
            </p>
            {citation.headingPath.length === 0 ? null : <p>{citation.headingPath.join(' → ')}</p>}
            {citation.status === 'verified' && citation.excerpt !== null ? (
              <>
                <p className="s3-source-citation-verified">
                  <Check size={14} aria-hidden="true" /> Đã đối chiếu với nguồn đã ghim
                </p>
                <blockquote className="s3-source-citation-excerpt">{citation.excerpt}</blockquote>
              </>
            ) : (
              <p role="status">{citation.reason ?? 'Chưa thể xác minh đoạn nguồn này.'}</p>
            )}
            {citation.truncated ? (
              <p>Đoạn xem trước đã được rút ngắn; nội dung nguồn gốc vẫn được giữ nguyên.</p>
            ) : null}
          </details>
        ))}
      </section>
    );
  }
  if (block.kind === 'table') {
    return (
      <section className="s3-presentation-section">
        {block.title === null ? null : <h3>{block.title}</h3>}
        <div className="s3-presentation-table-wrap">
          <table className="s3-presentation-table">
            <caption className="s3-visually-hidden">
              {block.title ?? 'Bảng dữ liệu của tài nguyên'}
            </caption>
            <thead>
              <tr>
                {block.columns.map(column => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${rowIndex.toString()}:${cellIndex.toString()}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {block.truncated ? (
          <p className="s3-resource-empty">
            Preview đã được giới hạn để giao diện luôn phản hồi nhanh.
          </p>
        ) : null}
      </section>
    );
  }
  if (block.kind === 'checklist') {
    return (
      <section className="s3-presentation-section">
        {block.title === null ? null : <h3>{block.title}</h3>}
        <ul className="s3-presentation-checklist">
          {block.items.map(item => (
            <li key={`${item.label}:${item.status}`} className={item.status}>
              <span>
                {item.status === 'passed' ? <Check size={14} /> : <AlertTriangle size={14} />}
              </span>
              <div>
                <strong>{item.label}</strong>
                {item.detail === null ? null : <small>{item.detail}</small>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  if (block.kind === 'timeline') {
    return (
      <section className="s3-presentation-section">
        {block.title === null ? null : <h3>{block.title}</h3>}
        <ol className="s3-presentation-timeline">
          {block.items.map(item => (
            <li key={`${item.title}:${item.at ?? ''}`}>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
              <small>{item.at === null ? '' : new Date(item.at).toLocaleString('vi-VN')}</small>
            </li>
          ))}
        </ol>
      </section>
    );
  }
  if (block.kind === 'fileTree') {
    return (
      <section className="s3-presentation-section">
        {block.title === null ? null : <h3>{block.title}</h3>}
        <ul className="s3-file-tree">
          {block.files.map(file => (
            <li key={file.path}>
              <code>{file.path}</code>
              <span>
                {file.sizeBytes === null ? '' : `${file.sizeBytes.toLocaleString('vi-VN')} B`}
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  if (block.kind === 'evidence') {
    return (
      <section className="s3-presentation-section">
        {block.title === null ? null : <h3>{block.title}</h3>}
        <div className="s3-evidence-blocks">
          {block.items.map(item => (
            <article key={item.requirement}>
              <div>
                <strong>{item.requirement}</strong>
                <span>{item.status}</span>
              </div>
              <ul>
                {item.proof.map(proof => (
                  <li key={proof}>{proof}</li>
                ))}
              </ul>
              {item.reason === null ? null : <p>{item.reason}</p>}
            </article>
          ))}
        </div>
      </section>
    );
  }
  return (
    <section className="s3-presentation-download">
      <FileArchive size={20} />
      <div>
        <strong>{block.filename}</strong>
        <small>
          {block.sizeBytes === null
            ? 'Bản gốc bất biến'
            : `${block.sizeBytes.toLocaleString('vi-VN')} bytes`}
        </small>
      </div>
      {downloadUrl === null ? null : (
        <a className="s3-button s3-button-secondary" href={downloadUrl}>
          <Download size={14} /> {block.label}
        </a>
      )}
    </section>
  );
}

export function InlineResourceViewer({
  projectId,
  resource,
  opener,
  onClose,
  modelView,
}: {
  projectId: string;
  resource: System3ResourceDescriptor;
  opener: HTMLElement | null;
  onClose: () => void;
  modelView?: ModelResourceView;
}): ReactElement {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [presentation, setPresentation] = useState<System3ResourcePresentation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [technical, setTechnical] = useState<string | null>(null);
  const [technicalLoading, setTechnicalLoading] = useState(false);
  const resourceUrl = `/api/system3/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resource.resourceType)}/${encodeURIComponent(resource.id)}`;
  const modelSelection =
    presentation !== null && modelView !== undefined
      ? selectModelResourceBlocks(presentation.blocks, modelView)
      : null;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setPresentation(null);
    void fetch(resourceUrl, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Không thể mở kết quả (${response.status.toString()})`);
        return response.json() as Promise<System3ResourcePresentation>;
      })
      .then(setPresentation)
      .catch(fetchError => {
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return;
        setError(fetchError instanceof Error ? fetchError.message : 'Không thể mở kết quả');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return (): void => {
      controller.abort();
    };
  }, [resourceUrl]);

  useEffect(() => {
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', handleKey);
    return (): void => {
      window.removeEventListener('keydown', handleKey);
      opener?.focus();
    };
  }, [onClose, opener]);

  const loadTechnical = (): void => {
    if (technical !== null || technicalLoading) return;
    if (!resource.mediaType.includes('json') && !resource.mediaType.startsWith('text/')) {
      setTechnical('Đây là file nhị phân. Hãy dùng nút tải bản gốc để kiểm tra nội dung.');
      return;
    }
    setTechnicalLoading(true);
    const contentUrl = `${resourceUrl}/content`;
    void fetch(contentUrl)
      .then(async response => {
        if (!response.ok)
          throw new Error(`Không thể tải thông tin kỹ thuật (${response.status.toString()})`);
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('json')) return JSON.stringify(await response.json(), null, 2);
        return response.text();
      })
      .then(setTechnical)
      .catch(loadError => {
        setTechnical(
          loadError instanceof Error ? loadError.message : 'Không thể tải thông tin kỹ thuật'
        );
      })
      .finally(() => {
        setTechnicalLoading(false);
      });
  };

  return (
    <div className="s3-resource-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        ref={panelRef}
        className="s3-resource-viewer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="s3-resource-title"
        onMouseDown={event => {
          event.stopPropagation();
        }}
      >
        <header className="s3-resource-viewer-head">
          <div>
            <p className="s3-kicker">
              {resource.activityId} · {statusLabel(resource.status)}
            </p>
            <h2 id="s3-resource-title">{presentation?.title ?? resource.title}</h2>
            <p>{presentation?.summary ?? resource.summary}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="s3-icon-button"
            onClick={onClose}
            aria-label="Đóng phần xem kết quả"
          >
            <X size={18} />
          </button>
        </header>
        <div className="s3-resource-viewer-body">
          {loading ? (
            <p className="s3-resource-empty">Đang chuẩn bị bản trình bày dễ đọc…</p>
          ) : null}
          {error === null ? null : (
            <section className="s3-presentation-callout danger">
              <AlertTriangle size={17} />
              <div>
                <h3>Không thể hiển thị preview</h3>
                <p>{error}</p>
              </div>
            </section>
          )}
          {modelSelection?.unavailable ? (
            <section className="s3-presentation-callout warning" role="status">
              <AlertTriangle size={17} aria-hidden="true" />
              <div>
                <h3>Nội dung chưa khả dụng</h3>
                <p>
                  Chưa có {modelView?.content === 'code' ? 'code' : 'output'} đã xác minh cho model
                  này. Tải bản gốc để kiểm tra thêm.
                </p>
              </div>
            </section>
          ) : null}
          {(modelSelection?.blocks ?? presentation?.blocks ?? []).map((block, index) => (
            <Block
              key={`${block.kind}:${index.toString()}`}
              block={block}
              downloadUrl={presentation?.downloadUrl ?? null}
            />
          ))}
          {presentation?.technicalDetailsAvailable ? (
            <details
              className="s3-technical-resource"
              onToggle={event => {
                if (event.currentTarget.open) loadTechnical();
              }}
            >
              <summary>Thông tin kỹ thuật</summary>
              <p>ID, hash và dữ liệu gốc chỉ dùng khi cần đối soát hoặc gỡ lỗi.</p>
              {technicalLoading ? <p>Đang tải…</p> : null}
              {technical === null ? null : <pre>{technical}</pre>}
            </details>
          ) : null}
        </div>
        <footer className="s3-resource-viewer-actions">
          <button type="button" className="s3-button s3-button-secondary" onClick={onClose}>
            Quay lại bước đang xem
          </button>
          {presentation?.downloadUrl === null || presentation?.downloadUrl === undefined ? null : (
            <a className="s3-button" href={presentation.downloadUrl}>
              <Download size={14} /> Tải bản gốc
            </a>
          )}
        </footer>
      </aside>
    </div>
  );
}
