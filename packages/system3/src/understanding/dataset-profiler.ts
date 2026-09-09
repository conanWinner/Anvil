import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { datasetProfileV2Schema, type DatasetProfileV2 } from './schemas';
import {
  assertSystem3CsvRowLimit,
  SYSTEM3_CSV_LIMITS,
  SYSTEM3_CSV_PARSE_OPTIONS,
  System3CsvContractError,
  validateSystem3CsvHeaders,
} from '../csv-contract';

const MAX_TARGET_VALUES = 50;

type InferredType = DatasetProfileV2['columns'][number]['inferredType'];

function mergeType(current: InferredType, value: string): InferredType {
  if (value.trim().length === 0) return current;
  const next: InferredType = /^(?:true|false)$/iu.test(value)
    ? 'boolean'
    : /^[+-]?\d+$/u.test(value)
      ? 'integer'
      : /^[+-]?(?:\d+\.\d*|\d*\.\d+)$/u.test(value)
        ? 'number'
        : !Number.isNaN(Date.parse(value)) && /[-/:T]/u.test(value)
          ? 'datetime'
          : 'string';
  if (current === 'empty') return next;
  if (current === next) return current;
  if (
    (current === 'integer' && next === 'number') ||
    (current === 'number' && next === 'integer')
  ) {
    return 'number';
  }
  return 'string';
}

export async function profileDatasetCsvStream(input: {
  filename: string;
  sourceVersionId: string;
  chunks: AsyncIterable<Uint8Array>;
  expectedContentHash?: string;
  targetColumn: string | null;
  signal?: AbortSignal;
}): Promise<DatasetProfileV2> {
  const contentHasher = createHash('sha256');
  const checkedChunks = (async function* (): AsyncGenerator<Uint8Array> {
    for await (const chunk of input.chunks) {
      contentHasher.update(chunk);
      yield chunk;
    }
  })();
  const parser = Readable.from(checkedChunks).pipe(parse(SYSTEM3_CSV_PARSE_OPTIONS));
  let headers: string[] | null = null;
  let rowCount = 0;
  let invalidRowCount = 0;
  let duplicateRowCount = 0;
  let targetIndex = -1;
  const rowHashes = new Set<string>();
  const inferred: InferredType[] = [];
  const missing: number[] = [];
  const distinct: Set<string>[] = [];
  const targetCounts = new Map<string, number>();
  const orderedRowHasher = createHash('sha256');
  let trackedDistinctValues = 0;

  for await (const recordValue of parser) {
    if (input.signal?.aborted === true) throw new Error('Dataset profiling was aborted');
    if (!Array.isArray(recordValue) || recordValue.some(value => typeof value !== 'string')) {
      invalidRowCount += 1;
      continue;
    }
    const record = recordValue as string[];
    if (headers === null) {
      headers = validateSystem3CsvHeaders(record);
      targetIndex = input.targetColumn === null ? -1 : headers.indexOf(input.targetColumn);
      inferred.push(...headers.map(() => 'empty' as const));
      missing.push(...headers.map(() => 0));
      distinct.push(...headers.map(() => new Set<string>()));
      continue;
    }
    rowCount += 1;
    assertSystem3CsvRowLimit(rowCount);
    const normalized = headers.map((_, index) => record[index] ?? '');
    const rowHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    orderedRowHasher.update(rowHash);
    if (rowHashes.has(rowHash)) duplicateRowCount += 1;
    else rowHashes.add(rowHash);
    for (let index = 0; index < headers.length; index += 1) {
      const value = normalized[index] ?? '';
      if (value.length === 0) missing[index] = (missing[index] ?? 0) + 1;
      else {
        const columnDistinct = distinct[index];
        if (columnDistinct && !columnDistinct.has(value)) {
          if (
            columnDistinct.size >= SYSTEM3_CSV_LIMITS.maxDistinctValuesPerColumn ||
            trackedDistinctValues >= SYSTEM3_CSV_LIMITS.maxTrackedDistinctValues
          ) {
            throw new System3CsvContractError(
              'too_many_distinct_values',
              `CSV có quá nhiều giá trị phân biệt để lập profile chính xác tại cột ${headers[index] ?? String(index + 1)}`
            );
          }
          columnDistinct.add(value);
          trackedDistinctValues += 1;
        }
        inferred[index] = mergeType(inferred[index] ?? 'empty', value);
      }
    }
    if (targetIndex >= 0) {
      const target = normalized[targetIndex] ?? '';
      targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
    }
  }
  if (headers === null) throw new Error('Dataset CSV has no header');
  if (
    input.expectedContentHash !== undefined &&
    `sha256:${contentHasher.digest('hex')}` !== input.expectedContentHash
  ) {
    throw new Error(`Mã kiểm tra của phiên bản nguồn ${input.sourceVersionId} không khớp`);
  }
  const orderedTargets = [...targetCounts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
  );
  const visibleTargets = orderedTargets.slice(0, MAX_TARGET_VALUES);
  const targetOtherCount = orderedTargets
    .slice(MAX_TARGET_VALUES)
    .reduce((total, [, count]) => total + count, 0);
  return datasetProfileV2Schema.parse({
    filename: input.filename,
    sourceVersionId: input.sourceVersionId,
    rowCount,
    columnCount: headers.length,
    columns: headers.map((name, index) => ({
      name,
      inferredType: inferred[index] ?? 'empty',
      missingCount: missing[index] ?? 0,
      distinctCount: distinct[index]?.size ?? 0,
    })),
    targetColumn: targetIndex >= 0 ? input.targetColumn : null,
    targetExists: targetIndex >= 0,
    targetDistribution: Object.fromEntries(visibleTargets),
    targetOtherCount,
    duplicateRowCount,
    invalidRowCount,
    rowFingerprint: `sha256:${orderedRowHasher.digest('hex')}`,
    limits: SYSTEM3_CSV_LIMITS,
  });
}
