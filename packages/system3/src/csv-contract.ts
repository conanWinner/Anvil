import { parse as parseSync } from 'csv-parse/sync';

export const SYSTEM3_CSV_LIMITS = {
  maxRows: 250_000,
  maxColumns: 512,
  maxRecordBytes: 1024 * 1024,
  maxDistinctValuesPerColumn: 50_000,
  maxTrackedDistinctValues: 250_000,
} as const;

export const SYSTEM3_CSV_PARSE_OPTIONS = {
  bom: true,
  relax_column_count: false,
  skip_empty_lines: true,
  trim: false,
  max_record_size: SYSTEM3_CSV_LIMITS.maxRecordBytes,
} as const;

export class System3CsvContractError extends Error {
  constructor(
    readonly code:
      | 'empty_header'
      | 'blank_header'
      | 'duplicate_header'
      | 'too_many_columns'
      | 'too_many_rows'
      | 'too_many_distinct_values',
    message: string
  ) {
    super(message);
    this.name = 'System3CsvContractError';
  }
}

export function validateSystem3CsvHeaders(rawHeaders: readonly string[]): string[] {
  if (rawHeaders.length === 0) {
    throw new System3CsvContractError('empty_header', 'CSV không có hàng tiêu đề');
  }
  if (rawHeaders.length > SYSTEM3_CSV_LIMITS.maxColumns) {
    throw new System3CsvContractError(
      'too_many_columns',
      `CSV vượt giới hạn ${SYSTEM3_CSV_LIMITS.maxColumns.toString()} cột`
    );
  }
  const blankIndex = rawHeaders.findIndex(header => header.trim().length === 0);
  if (blankIndex >= 0) {
    throw new System3CsvContractError(
      'blank_header',
      `Tên cột CSV ở vị trí ${(blankIndex + 1).toString()} đang để trống`
    );
  }
  const seen = new Set<string>();
  for (const header of rawHeaders) {
    if (seen.has(header)) {
      throw new System3CsvContractError('duplicate_header', `CSV có tên cột trùng lặp: ${header}`);
    }
    seen.add(header);
  }
  return [...rawHeaders];
}

export function assertSystem3CsvRowLimit(rowCount: number): void {
  if (rowCount > SYSTEM3_CSV_LIMITS.maxRows) {
    throw new System3CsvContractError(
      'too_many_rows',
      `CSV vượt giới hạn ${SYSTEM3_CSV_LIMITS.maxRows.toString()} dòng dữ liệu`
    );
  }
}

export function parseSystem3CsvText(text: string): string[][] {
  const records = parseSync(text, SYSTEM3_CSV_PARSE_OPTIONS);
  validateSystem3CsvHeaders(records[0] ?? []);
  const rowCount = Math.max(0, records.length - 1);
  assertSystem3CsvRowLimit(rowCount);
  return records;
}

export function inspectSystem3CsvText(text: string): { headers: string[]; rowCount: number } {
  const records = parseSystem3CsvText(text);
  const headers = [...(records[0] ?? [])];
  const rowCount = Math.max(0, records.length - 1);
  return { headers, rowCount };
}
