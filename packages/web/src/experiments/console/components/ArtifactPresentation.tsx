import { FileCode2, FileText, Settings2 } from 'lucide-react';
import type { ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

export interface ArtifactPresentation {
  title: string;
  description: string;
  technical: boolean;
}

const PRESENTATIONS: Record<string, Omit<ArtifactPresentation, 'technical'>> = {
  'intake_manifest.json': {
    title: 'Nguồn đầu vào đã xác nhận',
    description: 'Blueprint, dataset và yêu cầu người dùng được dùng cho lần chạy này.',
  },
  'system2_original.md': {
    title: 'Blueprint gốc từ System 2',
    description: 'Tài liệu nguồn bất biến mà System 3 tiếp nhận.',
  },
  'user_input.json': {
    title: 'Yêu cầu bổ sung',
    description: 'Các ràng buộc và ưu tiên do người dùng xác nhận.',
  },
  'run_request.json': {
    title: 'Yêu cầu thực thi chuẩn hóa',
    description: 'Đầu vào đã được chuyển thành contract mà pipeline có thể chạy.',
  },
  'canonical_artifacts.json': {
    title: 'Thông tin dự án chuẩn hóa',
    description: 'Mục tiêu, yêu cầu và acceptance criteria được trích xuất từ Blueprint.',
  },
  'dataset_profile.json': {
    title: 'Hồ sơ dataset',
    description: 'Số dòng, cột, target và mức sẵn sàng của dữ liệu.',
  },
  'dataset_state.json': {
    title: 'Trạng thái nguồn dữ liệu',
    description: 'Cho biết dataset thật đã sẵn sàng, chỉ có metadata hay chưa được cung cấp.',
  },
  'system2_metadata.json': {
    title: 'Dấu vết Blueprint',
    description: 'Hash, kích thước và nguồn của Blueprint để kiểm tra tính bất biến.',
  },
  'project_overview.json': {
    title: 'Tổng quan dự án',
    description: 'Bản tóm tắt dễ đọc về bài toán và phạm vi triển khai.',
  },
  'readiness_report.json': {
    title: 'Báo cáo mức sẵn sàng',
    description: 'Trạng thái từng gate, bằng chứng và điều kiện còn thiếu trước bước kế tiếp.',
  },
  'extraction_report.json': {
    title: 'Kết quả trích xuất Blueprint',
    description: 'Các phần đã nhận diện và cảnh báo cần người dùng kiểm tra lại.',
  },
  'run_manifest.json': {
    title: 'Danh mục kết quả của run',
    description: 'Danh sách artifact và provenance được ghi nhận trong lần chạy.',
  },
  'final_implementation_contract.json': {
    title: 'Hợp đồng triển khai cần duyệt',
    description: 'Scope, dữ liệu, cách kiểm thử và tiêu chí được khóa trước khi build.',
  },
  'implementation_plan.json': {
    title: 'Kế hoạch triển khai',
    description: 'Các sprint, task và kết quả cần tạo trong giai đoạn build.',
  },
  'test_results.json': {
    title: 'Kết quả kiểm thử',
    description: 'Các test đã chạy, trạng thái pass/fail và lỗi nếu có.',
  },
  'data_run.json': {
    title: 'Kết quả xử lý dữ liệu',
    description: 'Tóm tắt dữ liệu sau khi pipeline chuẩn bị xong.',
  },
  'experiment_results.json': {
    title: 'Kết quả thí nghiệm',
    description: 'Metric của baseline và thông tin có thể tái lập thí nghiệm.',
  },
  'requirement_evidence.json': {
    title: 'Bằng chứng theo yêu cầu',
    description: 'Mỗi requirement được ánh xạ tới test, file hoặc kết quả xác minh.',
  },
  'verification_report.json': {
    title: 'Báo cáo xác minh cuối',
    description: 'Kết luận G5 và các điều kiện giao hàng còn thiếu.',
  },
  'verification_report.md': {
    title: 'Báo cáo xác minh cuối',
    description: 'Kết luận dễ đọc về G5, requirement evidence và gói bàn giao.',
  },
  'requirement_evidence_map.json': {
    title: 'Bản đồ bằng chứng yêu cầu',
    description: 'Cho biết từng requirement đã được chứng minh bằng file hoặc test nào.',
  },
  'final_gate.json': {
    title: 'Kết quả gate G5',
    description: 'Kết luận cuối cùng về mức sẵn sàng để bàn giao project.',
  },
  'final_report.md': {
    title: 'Báo cáo bàn giao',
    description: 'Bản tổng hợp dành cho người đọc về kết quả, giới hạn và cách sử dụng.',
  },
  'generated_project.tar.gz': {
    title: 'Gói project đã tạo',
    description: 'Gói mã nguồn và tài liệu có thể tải xuống để bàn giao.',
  },
};

export function describeArtifact(path: string): ArtifactPresentation {
  const basename = path.split('/').pop() ?? path;
  const technical =
    path.startsWith('execution/') ||
    path.startsWith('composition/') ||
    path.startsWith('logs/') ||
    path.includes('/__pycache__/') ||
    basename.endsWith('.pyc') ||
    (path.startsWith('workspace/generated_project/') &&
      !path.endsWith('/README.md') &&
      !path.includes('/reports/')) ||
    basename === 'io.json' ||
    basename === 'manifest.json';
  const known = PRESENTATIONS[basename];
  if (known !== undefined) return { ...known, technical };
  if (basename.endsWith('.md') || basename.endsWith('.mdx')) {
    return {
      title: basename.replace(/[-_]/g, ' ').replace(/\.mdx?$/, ''),
      description: 'Tài liệu có định dạng, có thể đọc trực tiếp trong Anvil.',
      technical,
    };
  }
  if (basename.endsWith('.json')) {
    return {
      title: basename.replace(/[-_]/g, ' ').replace(/\.json$/, ''),
      description: technical
        ? 'Dữ liệu kỹ thuật phục vụ truy vết và khôi phục lần chạy.'
        : 'Kết quả có cấu trúc do workflow tạo ra.',
      technical,
    };
  }
  return {
    title: basename,
    description: technical
      ? 'File kỹ thuật phục vụ thực thi hoặc truy vết.'
      : 'File kết quả do workflow tạo ra.',
    technical,
  };
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, value => value.toUpperCase());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function simpleValue(value: unknown): string {
  if (value === null) return 'Không có';
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Không có';
    if (value.every(item => ['string', 'number', 'boolean'].includes(typeof item))) {
      return value.map(String).join(', ');
    }
    return `${value.length.toString()} mục`;
  }
  const record = asRecord(value);
  if (record !== null) return `${Object.keys(record).length.toString()} trường`;
  if (typeof value === 'bigint') return value.toString();
  return 'Không thể hiển thị giá trị này';
}

function statusLabel(value: unknown): string {
  if (value === 'passed') return 'Đã đạt';
  if (value === 'blocked') return 'Đang bị chặn';
  if (value === 'conditional_pass') return 'Đạt có điều kiện';
  if (value === 'not_evaluated') return 'Chưa đánh giá';
  return simpleValue(value);
}

function ReadinessSummary({ data }: { data: Record<string, unknown> }): ReactElement {
  const gates = Array.isArray(data.gates) ? data.gates.map(asRecord).filter(Boolean) : [];
  const ready = data.allRequiredPassed === true;
  return (
    <div className="space-y-3">
      <div
        className={`rounded-lg border p-3 text-sm ${
          ready
            ? 'border-success/30 bg-success/[0.06] text-success'
            : 'border-warning/30 bg-warning/[0.06] text-warning'
        }`}
      >
        {ready
          ? 'Các gate bắt buộc đã đạt. Workflow có thể chuyển sang bước tiếp theo.'
          : 'Còn gate đang bị chặn. Xem từng mục bên dưới để biết cần bổ sung gì.'}
      </div>
      {gates.map((gate, index) => {
        if (gate === null) return null;
        const gateId =
          typeof gate.id === 'string' || typeof gate.id === 'number'
            ? String(gate.id)
            : `Gate ${(index + 1).toString()}`;
        const gateName = typeof gate.name === 'string' ? gate.name : 'Readiness gate';
        const blockers = Array.isArray(gate.blockers)
          ? gate.blockers.filter((item): item is string => typeof item === 'string')
          : [];
        const evidence = Array.isArray(gate.evidence)
          ? gate.evidence.filter((item): item is string => typeof item === 'string')
          : [];
        return (
          <article key={gateId} className="rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-text-primary">
                  {gateId} · {gateName}
                </div>
                {blockers.length > 0 ? (
                  <div className="mt-2 text-xs text-error">Cần xử lý: {blockers.join(', ')}</div>
                ) : null}
                {evidence.length > 0 ? (
                  <div className="mt-1 text-[11px] text-text-tertiary">
                    Bằng chứng: {evidence.join(', ')}
                  </div>
                ) : null}
              </div>
              <span className="shrink-0 rounded border border-border px-2 py-1 text-[10px] font-semibold text-text-secondary">
                {statusLabel(gate.status)}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function FriendlyJson({ path, data }: { path: string; data: unknown }): ReactElement {
  const record = asRecord(data);
  if (record === null) {
    return <div className="rounded border border-border p-3 text-sm">{simpleValue(data)}</div>;
  }
  if (path.endsWith('readiness_report.json') && Array.isArray(record.gates)) {
    return <ReadinessSummary data={record} />;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {Object.entries(record).map(([key, value]) => (
        <div
          key={key}
          className="grid grid-cols-[minmax(120px,0.4fr)_minmax(0,1fr)] gap-3 border-b border-border px-3 py-2.5 text-xs last:border-0"
        >
          <span className="font-medium text-text-secondary">{humanizeKey(key)}</span>
          <span className="min-w-0 break-words text-text-primary">{simpleValue(value)}</span>
        </div>
      ))}
    </div>
  );
}

export function ArtifactContent({
  path,
  content,
}: {
  path: string;
  content: string;
}): ReactElement {
  const basename = path.split('/').pop() ?? path;
  const isMarkdown = basename.endsWith('.md') || basename.endsWith('.mdx');
  const isJson = basename.endsWith('.json');
  let parsed: unknown = null;
  let parsedJson = false;
  if (isJson) {
    try {
      parsed = JSON.parse(content) as unknown;
      parsedJson = true;
    } catch {
      parsedJson = false;
    }
  }

  return (
    <div className="space-y-4">
      {isMarkdown ? (
        <div className="chat-markdown max-w-[820px] text-[13px] leading-relaxed text-text-primary">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkBreaks]}
            rehypePlugins={[rehypeHighlight]}
          >
            {content}
          </ReactMarkdown>
        </div>
      ) : parsedJson ? (
        <FriendlyJson path={path} data={parsed} />
      ) : (
        <pre className="max-w-[1100px] whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-text-primary">
          {content}
        </pre>
      )}
      {parsedJson ? (
        <details className="rounded-lg border border-border bg-surface-inset">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs text-text-tertiary">
            <FileCode2 className="size-3.5" /> Xem JSON kỹ thuật
          </summary>
          <pre className="max-h-[420px] overflow-auto border-t border-border p-3 font-mono text-[11px] leading-5 text-text-secondary">
            {JSON.stringify(parsed, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export function ArtifactKindIcon({ technical }: { technical: boolean }): ReactElement {
  return technical ? <Settings2 className="size-4" /> : <FileText className="size-4" />;
}
