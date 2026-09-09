import { createHash } from 'node:crypto';
import type { System3SourceKind } from './contracts';
import type { System3SourceValidationCheck, System3SourceValidationReport } from './store';
import { inspectSystem3CsvText } from './csv-contract';

interface SourcePolicy {
  readonly extensions: readonly string[];
  readonly maxBytes: number;
}

const MIB = 1024 * 1024;

export const SYSTEM3_SOURCE_POLICIES: Readonly<Record<System3SourceKind, SourcePolicy>> = {
  blueprint: { extensions: ['.md', '.json', '.pdf'], maxBytes: 10 * MIB },
  dataset: { extensions: ['.csv'], maxBytes: 25 * MIB },
  constraints: { extensions: ['.json', '.yaml', '.yml', '.md'], maxBytes: 2 * MIB },
  data_dictionary: {
    extensions: ['.csv', '.json', '.yaml', '.yml', '.md', '.pdf'],
    maxBytes: 10 * MIB,
  },
  user_brief: { extensions: ['.md', '.txt', '.pdf'], maxBytes: 10 * MIB },
  supporting_document: {
    extensions: ['.md', '.txt', '.json', '.yaml', '.yml', '.pdf'],
    maxBytes: 10 * MIB,
  },
};

export class System3SourceValidationError extends Error {
  readonly status: 400 | 413 | 415 | 422;
  readonly report: System3SourceValidationReport;

  constructor(
    status: 400 | 413 | 415 | 422,
    message: string,
    checks: System3SourceValidationCheck[]
  ) {
    super(message);
    this.name = 'System3SourceValidationError';
    this.status = status;
    this.report = { schemaVersion: 1, outcome: 'rejected', checks, warnings: [] };
  }
}

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index < 0 ? '' : filename.slice(index).toLowerCase();
}

function check(
  id: string,
  label: string,
  status: System3SourceValidationCheck['status'],
  message: string
): System3SourceValidationCheck {
  return { id, label, status, message };
}

function validateSize(
  kind: System3SourceKind,
  sizeBytes: number,
  checks: System3SourceValidationCheck[]
): void {
  if (sizeBytes === 0) {
    checks.push(check('size', 'Dung lượng', 'failed', 'Tệp rỗng.'));
    throw new System3SourceValidationError(400, 'Tệp nguồn không được để trống', checks);
  }
  if (sizeBytes > SYSTEM3_SOURCE_POLICIES[kind].maxBytes) {
    checks.push(check('size', 'Dung lượng', 'failed', 'Tệp vượt giới hạn của loại nguồn.'));
    throw new System3SourceValidationError(413, 'Tệp nguồn vượt giới hạn dung lượng', checks);
  }
  checks.push(check('size', 'Dung lượng', 'passed', 'Dung lượng nằm trong giới hạn cho phép.'));
}

export function assertSystem3SourceSize(kind: System3SourceKind, sizeBytes: number): void {
  validateSize(kind, sizeBytes, []);
}

function decodeUtf8(bytes: Uint8Array, checks: System3SourceValidationCheck[]): string {
  if (bytes.includes(0)) {
    checks.push(check('text-content', 'Nội dung văn bản', 'failed', 'Tệp chứa byte NUL.'));
    throw new System3SourceValidationError(422, 'Tệp văn bản chứa dữ liệu nhị phân', checks);
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    checks.push(check('utf8', 'Mã hóa UTF-8', 'passed', 'Tệp văn bản đọc được bằng UTF-8.'));
    return text;
  } catch {
    checks.push(check('utf8', 'Mã hóa UTF-8', 'failed', 'Tệp không phải UTF-8 hợp lệ.'));
    throw new System3SourceValidationError(422, 'Tệp văn bản phải dùng UTF-8 hợp lệ', checks);
  }
}

function validatePdf(bytes: Uint8Array, checks: System3SourceValidationCheck[]): void {
  // PDF structure tokens are ASCII, so UTF-8 decoding is sufficient for the
  // byte-level checks below even when the remaining binary data is not text.
  const head = new TextDecoder().decode(bytes.slice(0, 8));
  const body = new TextDecoder().decode(bytes);
  if (!head.startsWith('%PDF-') || !body.includes('%%EOF')) {
    checks.push(
      check('pdf-structure', 'Cấu trúc PDF', 'failed', 'Không tìm thấy cấu trúc PDF hợp lệ.')
    );
    throw new System3SourceValidationError(422, 'Cấu trúc PDF không hợp lệ', checks);
  }
  if (/\/Encrypt\b|\/JavaScript\b|\/JS\b|\/EmbeddedFile\b/.test(body)) {
    checks.push(
      check(
        'pdf-safety',
        'An toàn PDF',
        'failed',
        'PDF mã hóa hoặc chứa JavaScript/tệp đính kèm không được hỗ trợ.'
      )
    );
    throw new System3SourceValidationError(
      422,
      'PDF chứa nội dung chủ động không được hỗ trợ',
      checks
    );
  }
  checks.push(check('pdf-structure', 'Cấu trúc PDF', 'passed', 'PDF có cấu trúc cơ bản hợp lệ.'));
  checks.push(
    check('pdf-safety', 'An toàn PDF', 'passed', 'Không phát hiện nội dung PDF chủ động.')
  );
}

function validateStructuredText(
  extension: string,
  text: string,
  checks: System3SourceValidationCheck[]
): void {
  try {
    if (extension === '.json') JSON.parse(text);
    if (extension === '.yaml' || extension === '.yml') Bun.YAML.parse(text);
  } catch {
    checks.push(
      check('structure', 'Cấu trúc nội dung', 'failed', `Tệp ${extension} không hợp lệ.`)
    );
    throw new System3SourceValidationError(422, `Nội dung ${extension} không hợp lệ`, checks);
  }
  if (extension === '.csv') {
    try {
      const inspection = inspectSystem3CsvText(text);
      checks.push(
        check(
          'csv-contract',
          'Hợp đồng CSV',
          'passed',
          `CSV hợp lệ với ${inspection.headers.length.toString()} cột và ${inspection.rowCount.toString()} dòng dữ liệu.`
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'CSV không hợp lệ';
      checks.push(check('csv-contract', 'Hợp đồng CSV', 'failed', message));
      throw new System3SourceValidationError(422, message, checks);
    }
  }
  if (['.json', '.yaml', '.yml'].includes(extension)) {
    checks.push(
      check('structure', 'Cấu trúc nội dung', 'passed', `${extension} parse thành công.`)
    );
  }
}

export interface ValidatedSystem3Source {
  readonly contentHash: string;
  readonly extension: string;
  readonly mediaType: string;
  readonly report: System3SourceValidationReport;
}

export function validateSystem3Source(input: {
  kind: System3SourceKind;
  filename: string;
  bytes: Uint8Array;
}): ValidatedSystem3Source {
  const policy = SYSTEM3_SOURCE_POLICIES[input.kind];
  const checks: System3SourceValidationCheck[] = [];
  validateSize(input.kind, input.bytes.byteLength, checks);

  const extension = extensionOf(input.filename);
  if (!policy.extensions.includes(extension)) {
    checks.push(check('file-type', 'Loại tệp', 'failed', 'Phần mở rộng không phù hợp loại nguồn.'));
    throw new System3SourceValidationError(
      415,
      'Phần mở rộng không phù hợp với loại nguồn',
      checks
    );
  }
  checks.push(
    check('file-type', 'Loại tệp', 'passed', `${extension} được hỗ trợ cho loại nguồn này.`)
  );

  if (extension === '.pdf') validatePdf(input.bytes, checks);
  else {
    const text = decodeUtf8(input.bytes, checks);
    validateStructuredText(extension, text, checks);
  }

  const mediaType =
    extension === '.pdf'
      ? 'application/pdf'
      : extension === '.json'
        ? 'application/json'
        : extension === '.csv'
          ? 'text/csv'
          : extension === '.yaml' || extension === '.yml'
            ? 'application/yaml'
            : extension === '.md'
              ? 'text/markdown'
              : 'text/plain';
  const warnings =
    extension === '.pdf'
      ? ['PDF đã được tiếp nhận; activity Hiểu dự án cần parser PDF tương thích để đọc nội dung.']
      : [];
  return {
    contentHash: `sha256:${createHash('sha256').update(input.bytes).digest('hex')}`,
    extension,
    mediaType,
    report: { schemaVersion: 1, outcome: 'accepted', checks, warnings },
  };
}
