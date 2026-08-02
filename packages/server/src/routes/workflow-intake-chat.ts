import type { WorkflowIntakeField } from '@anvil/workflows/schemas/workflow';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export const INTAKE_REVIEW_FIELD = '__review__';

export async function storeManagedIntakeAttachment(options: {
  root: string;
  codebaseId: string;
  draftId: string;
  originalName: string;
  bytes: Uint8Array;
}): Promise<{ path: string; safeName: string; sha256: string }> {
  const sha256 = createHash('sha256').update(options.bytes).digest('hex');
  const safeName = basename(options.originalName).replace(/[^\p{L}\p{N}._-]/gu, '_') || 'upload';
  const directory = join(options.root, options.codebaseId, options.draftId);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${sha256}-${safeName}`);
  try {
    await writeFile(path, options.bytes, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return { path, safeName, sha256 };
}

export function buildIntakeStartCommand(
  workflowName: string,
  encodedInputs: string,
  message: string
): string {
  // A confirmed intake always starts a fresh root run. The API has already
  // rejected any active run, so --force only bypasses the stale failed-run
  // prompt that would otherwise swallow this deterministic dispatch.
  return `/workflow run ${workflowName} --force --inputs-json ${encodedInputs} ${message}`;
}

const NEGATIVE_ANSWERS = new Set([
  'không',
  'khong',
  'không có',
  'khong co',
  'none',
  'no',
  'not provided',
  'cung cấp sau',
  'cung cap sau',
]);

export function isIntakeConfirmation(message: string): boolean {
  return ['xác nhận', 'xac nhan', 'đồng ý', 'dong y', 'start', 'bắt đầu', 'bat dau'].includes(
    message.trim().toLowerCase()
  );
}

export function requestedIntakeEdit(message: string): string | null {
  const match = /^\/edit\s+([\w-]+)$/i.exec(message.trim());
  return match?.[1] ?? null;
}

export function extractIntakePath(message: string, control: 'file' | 'dataset'): string {
  const value = message.trim();
  const wrapped = /`([^`]+)`|"([^"]+)"|'([^']+)'/.exec(value);
  const wrappedValue = wrapped?.[1] ?? wrapped?.[2] ?? wrapped?.[3];
  if (wrappedValue?.trim()) return wrappedValue.trim();

  const extension = control === 'file' ? 'md' : 'csv|tsv|jsonl|parquet|xlsx|xls';
  const path = new RegExp(
    `(?:\\.{0,2}/|/)?(?:[\\p{L}\\p{N}_.@+-]+/)*[\\p{L}\\p{N}_.@+-]+\\.(?:${extension})(?=\\s|$)`,
    'iu'
  ).exec(value)?.[0];
  return path ?? value;
}

export function parseIntakeAnswer(field: WorkflowIntakeField, message: string): unknown {
  const value = message.trim();
  switch (field.control) {
    case 'file':
      return { kind: 'project_file', path: extractIntakePath(value, 'file') };
    case 'dataset': {
      const normalized = value.toLowerCase();
      if (NEGATIVE_ANSWERS.has(normalized)) return { mode: 'not_provided' };
      if (['metadata-only', 'metadata only', 'chỉ metadata'].includes(normalized)) {
        return { mode: 'metadata_only' };
      }
      if (['synthetic', 'dữ liệu mẫu', 'du lieu mau'].includes(normalized)) {
        return { mode: 'synthetic_requested' };
      }
      return { mode: 'local_path', path: extractIntakePath(value, 'dataset') };
    }
    case 'textarea':
      return { notes: NEGATIVE_ANSWERS.has(value.toLowerCase()) ? '' : value };
    case 'approval_policy':
      return defaultApprovalPolicy();
  }
}

export function defaultApprovalPolicy(): Record<string, boolean> {
  return {
    allow_auto_revision_for_safe_items: true,
    require_approval_for_scope_change: true,
    require_approval_for_target_change: true,
    require_approval_for_acceptance_change: true,
  };
}

export function nextIntakeField(
  fields: readonly WorkflowIntakeField[],
  values: Record<string, unknown>,
  afterInput?: string
): WorkflowIntakeField | null {
  const start =
    afterInput === undefined ? 0 : fields.findIndex(field => field.input === afterInput) + 1;
  for (let index = Math.max(0, start); index < fields.length; index++) {
    const field = fields[index];
    if (field === undefined || values[field.input] !== undefined) continue;
    if (field.control === 'approval_policy') {
      values[field.input] = field.default ?? defaultApprovalPolicy();
      continue;
    }
    return field;
  }
  return null;
}

export function intakePrompt(
  field: WorkflowIntakeField,
  suggestions: readonly string[] = []
): string {
  const guidance =
    field.control === 'file'
      ? 'Nhập đường dẫn chính xác của file trong project, hoặc dùng nút đính kèm để chọn file bên ngoài.'
      : field.control === 'dataset'
        ? 'Nhập đường dẫn file/thư mục dataset, hoặc trả lời `không`, `metadata-only`, hay `synthetic`.'
        : 'Bạn có thể trả lời `không` nếu không có yêu cầu bổ sung.';
  const suggestionText =
    suggestions.length > 0
      ? `\n\nFile có thể chọn trong project:\n${suggestions.map(path => `- \`${path}\``).join('\n')}`
      : '';
  return `${field.prompt}\n\n${guidance}${suggestionText}`;
}

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  if (record.kind === 'uploaded' && typeof record.original_name === 'string') {
    return `${record.original_name} (đã tải lên)`;
  }
  if (typeof record.path === 'string') return record.path;
  if (typeof record.notes === 'string') return record.notes || 'Không có';
  if (typeof record.mode === 'string') return record.mode;
  if (typeof record.allow_auto_revision_for_safe_items === 'boolean') {
    return record.allow_auto_revision_for_safe_items
      ? 'Tự sửa mục an toàn; thay đổi quan trọng luôn cần duyệt'
      : 'Luôn yêu cầu duyệt';
  }
  return JSON.stringify(value);
}

export function intakeSummary(
  title: string,
  fields: readonly WorkflowIntakeField[],
  values: Record<string, unknown>
): string {
  const rows = fields.map(field => `- **${field.input}:** ${describeValue(values[field.input])}`);
  return [
    `### ${title}`,
    '',
    ...rows,
    '',
    'Trả lời **Xác nhận** để bắt đầu workflow, hoặc `/edit <tên_input>` để sửa.',
    'Dùng `/stop` nếu muốn tạm dừng và giữ lại bản nháp.',
  ].join('\n');
}
