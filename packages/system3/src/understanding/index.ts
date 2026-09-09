import { createHash } from 'node:crypto';
import { blueprintAnalysisV2Schema, type BlueprintAnalysis } from '../contracts';
import { parseUnderstandingMarkdown, markComponent } from './document-index';
import { profileDatasetCsvStream } from './dataset-profiler';
import { extractBlueprintFromIndex, type BlueprintExtractionResult } from './extractors';
import { readUnderstandingPdf, UNDERSTANDING_PDF_PARSER_VERSION } from './pdf-layout-reader';
import { evaluateUnderstandingQuality } from './quality';
import { createUnderstandingReports } from './reports';
import type {
  DatasetUnderstanding,
  UnderstandingCoverageEntry,
  UnderstandingIssue,
  UnderstandingReport,
  UnderstandingSourcePointer,
} from './schemas';
import { readSystem2BlueprintJson } from './system2-json-reader';
import { readSupplementalStructuredSource, type SupplementalFact } from './supplemental-reader';

export interface PinnedUnderstandingSource {
  id: string;
  kind:
    | 'blueprint'
    | 'dataset'
    | 'constraints'
    | 'data_dictionary'
    | 'user_brief'
    | 'supporting_document';
  filename: string;
  mediaType: string;
  contentHash: string;
  bytes: Uint8Array;
}

export interface StreamedPinnedUnderstandingSource extends Omit<
  PinnedUnderstandingSource,
  'bytes'
> {
  chunks: AsyncIterable<Uint8Array>;
}

export interface UnderstandingSemanticCandidate {
  componentId: string;
  field: 'business_goal' | 'technical_objective' | 'target_definition';
  value: string;
  exactQuote: string;
}

export interface UnderstandingSemanticFallbackResult {
  provider: string;
  model: string;
  candidates: UnderstandingSemanticCandidate[];
  attempts: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number;
}

export type UnderstandingSemanticFallback = (input: {
  filename: string;
  components: readonly { id: string; text: string; sourcePointer: UnderstandingSourcePointer }[];
}) => Promise<UnderstandingSemanticFallbackResult>;

export interface UnderstandProjectResult {
  analysis: Extract<BlueprintAnalysis, { schemaVersion: 2 }>;
  reports: UnderstandingReport[];
  semanticAssistance: UnderstandingSemanticFallbackResult | null;
}

export async function verifyPinnedUnderstandingSourceStream(
  source: StreamedPinnedUnderstandingSource
): Promise<void> {
  const hasher = createHash('sha256');
  for await (const chunk of source.chunks) hasher.update(chunk);
  if (`sha256:${hasher.digest('hex')}` !== source.contentHash) {
    throw new Error(`Mã kiểm tra của phiên bản nguồn ${source.id} không khớp`);
  }
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function decodeUtf8(source: PinnedUnderstandingSource): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(source.bytes);
  } catch {
    throw new Error(`Nguồn ${source.filename} không phải văn bản UTF-8 hợp lệ`);
  }
}

function extension(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index < 0 ? '' : filename.slice(index).toLowerCase();
}

/**
 * The Understanding input policy is intentionally fail-closed.  A file name is
 * part of the pinned source identity, so a known but unsupported extension
 * (for example .docx) must not be reinterpreted from a misleading media type.
 */
type UnderstandingSourceFormat = 'markdown' | 'system2_json' | 'pdf' | 'csv' | 'yaml';
type UnderstandingSourceDescriptor = Pick<
  PinnedUnderstandingSource,
  'id' | 'filename' | 'mediaType' | 'contentHash'
>;

const markdownExtensions = new Set(['.md', '.markdown', '.mdown', '.mkdn', '.txt']);
const markdownMediaTypes = new Set(['text/markdown', 'text/x-markdown']);
const jsonMediaTypes = new Set(['application/json', 'text/json']);
const pdfMediaTypes = new Set(['application/pdf']);
const csvMediaTypes = new Set(['text/csv', 'application/csv']);
const yamlMediaTypes = new Set(['application/yaml', 'text/yaml', 'application/x-yaml']);

function normalizedMediaType(mediaType: string): string {
  return mediaType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function hasNoExtensionOr(
  source: UnderstandingSourceDescriptor,
  extensions: ReadonlySet<string>
): boolean {
  const kind = extension(source.filename);
  return kind === '' || extensions.has(kind);
}

function sourceHasFormat(
  source: UnderstandingSourceDescriptor,
  format: UnderstandingSourceFormat
): boolean {
  const kind = extension(source.filename);
  const mediaType = normalizedMediaType(source.mediaType);
  switch (format) {
    case 'markdown':
      // text/plain is supported only when the filename explicitly marks it as
      // a textual blueprint (.txt), never merely because arbitrary bytes say so.
      return (
        markdownExtensions.has(kind) ||
        (hasNoExtensionOr(source, markdownExtensions) && markdownMediaTypes.has(mediaType)) ||
        (kind === '.txt' && mediaType === 'text/plain')
      );
    case 'system2_json':
      return (
        kind === '.json' ||
        (hasNoExtensionOr(source, new Set(['.json'])) && jsonMediaTypes.has(mediaType))
      );
    case 'pdf':
      return (
        kind === '.pdf' ||
        (hasNoExtensionOr(source, new Set(['.pdf'])) && pdfMediaTypes.has(mediaType))
      );
    case 'csv':
      return (
        kind === '.csv' ||
        (hasNoExtensionOr(source, new Set(['.csv'])) && csvMediaTypes.has(mediaType))
      );
    case 'yaml':
      return (
        kind === '.yaml' ||
        kind === '.yml' ||
        (hasNoExtensionOr(source, new Set(['.yaml', '.yml'])) && yamlMediaTypes.has(mediaType))
      );
  }
}

function unsupportedSourceCoverage(
  source: UnderstandingSourceDescriptor
): UnderstandingCoverageEntry {
  const kind = extension(source.filename) || '(không có phần mở rộng)';
  return {
    componentId: `${source.id}:unsupported-source`,
    kind: 'unsupported',
    chapter: null,
    headingPath: [],
    status: 'unsupported',
    reason: `Định dạng nguồn ${kind} (${normalizedMediaType(source.mediaType) || 'không xác định'}) không được hỗ trợ cho vai trò này.`,
    sourcePointer: {
      sourceVersionId: source.id,
      filename: source.filename,
      headingPath: [],
      startLine: null,
      endLine: null,
      jsonPointer: null,
      page: null,
      boundingBox: null,
      excerptHash: source.contentHash,
    },
  };
}

function coverageFromIndex(
  components: ReturnType<typeof parseUnderstandingMarkdown>['components']
): UnderstandingCoverageEntry[] {
  return components.map(component => ({
    componentId: component.id,
    kind: component.kind,
    chapter: component.chapter,
    headingPath: component.headingPath,
    status: component.coverageStatus,
    reason: component.coverageReason,
    sourcePointer: component.sourcePointer,
  }));
}

function datasetIssue(input: Omit<UnderstandingIssue, 'id'> & { key: string }): UnderstandingIssue {
  return {
    id: `dataset-${createHash('sha256').update(input.key).digest('hex').slice(0, 12)}`,
    ...input,
  };
}

function unsupportedSourceIssue(source: UnderstandingSourceDescriptor): UnderstandingIssue {
  const coverage = unsupportedSourceCoverage(source);
  return {
    id: `unsupported-source-${createHash('sha256').update(source.id).digest('hex').slice(0, 12)}`,
    kind: 'unsupported_content',
    severity: 'revision_required',
    title: 'Nguồn có định dạng chưa được hỗ trợ',
    detail: coverage.reason,
    requiresDecision: false,
    sourcePointers: [coverage.sourcePointer],
  };
}

function datasetUnderstanding(input: {
  extraction: BlueprintExtractionResult;
  profile: Awaited<ReturnType<typeof profileDatasetCsvStream>> | null;
}): DatasetUnderstanding {
  const issues: UnderstandingIssue[] = [];
  if (input.profile === null) {
    return {
      availability: 'not_linked',
      declaration: input.extraction.datasetDeclaration,
      profile: null,
      comparisonStatus: 'not_checked',
      issues,
    };
  }
  const declaration = input.extraction.datasetDeclaration;
  if (declaration?.targetColumn === null || declaration === null) {
    issues.push(
      datasetIssue({
        key: 'target-not-declared',
        kind: 'dataset_mismatch',
        severity: 'warning',
        title: 'Chưa xác định cột mục tiêu',
        detail: 'Dataset đã liên kết nhưng System 2 chưa khai báo rõ tên cột mục tiêu.',
        requiresDecision: true,
        decisionBinding: {
          kind: 'dataset_target_column',
          allowedValues: input.profile.columns.map(column => column.name),
        },
        sourcePointers: declaration?.sourcePointers ?? [],
      })
    );
  } else if (!input.profile.targetExists) {
    issues.push(
      datasetIssue({
        key: `missing-target:${declaration.targetColumn}`,
        kind: 'dataset_mismatch',
        severity: 'revision_required',
        title: 'Dataset không có cột mục tiêu đã khai báo',
        detail: `Không tìm thấy cột ${declaration.targetColumn} trong Dataset thật.`,
        requiresDecision: false,
        sourcePointers: declaration.sourcePointers,
      })
    );
  }
  const expected = new Set(declaration?.expectedColumns ?? []);
  const actual = new Set(input.profile.columns.map(column => column.name));
  const missingExpected = [...expected].filter(column => !actual.has(column));
  if (missingExpected.length > 0) {
    issues.push(
      datasetIssue({
        key: `missing-columns:${missingExpected.join(',')}`,
        kind: 'dataset_mismatch',
        severity: 'revision_required',
        title: 'Dataset thiếu cột được System 2 mô tả',
        detail: `Các cột chưa tìm thấy: ${missingExpected.slice(0, 20).join(', ')}.`,
        requiresDecision: false,
        sourcePointers: declaration?.sourcePointers ?? [],
      })
    );
  }
  return {
    availability: 'linked',
    declaration,
    profile: input.profile,
    comparisonStatus: issues.length === 0 ? 'matched' : 'mismatch',
    issues,
  };
}

function applySupplementalFacts(
  extraction: BlueprintExtractionResult,
  facts: readonly SupplementalFact[]
): UnderstandingIssue[] {
  const issues: UnderstandingIssue[] = [];
  const declaration = (): NonNullable<BlueprintExtractionResult['datasetDeclaration']> => {
    if (extraction.datasetDeclaration !== null) return extraction.datasetDeclaration;
    const pointer = facts[0]?.sourcePointer;
    extraction.datasetDeclaration = {
      availability: 'declared_unverified',
      unitOfAnalysis: null,
      targetColumn: null,
      targetDefinition: null,
      expectedColumns: [],
      constraints: [],
      sourcePointers: pointer ? [pointer] : [],
    };
    return extraction.datasetDeclaration;
  };
  const addPointer = (pointer: UnderstandingSourcePointer): void => {
    const target = declaration();
    if (
      !target.sourcePointers.some(
        existing =>
          existing.sourceVersionId === pointer.sourceVersionId &&
          existing.jsonPointer === pointer.jsonPointer
      )
    ) {
      target.sourcePointers.push(pointer);
    }
  };
  const addConstraint = (value: string, pointer: UnderstandingSourcePointer): void => {
    const target = declaration();
    if (!target.constraints.includes(value)) target.constraints.push(value);
    if (!extraction.problemProfile.constraints.some(item => item.value === value)) {
      extraction.problemProfile.constraints.push({
        value,
        status: 'declared_unverified',
        sourcePointers: [pointer],
      });
    }
    addPointer(pointer);
  };
  for (const fact of facts) {
    const key = fact.key.toLowerCase().replace(/[^a-z0-9]+/gu, '_');
    const value =
      typeof fact.value === 'string'
        ? fact.value.trim()
        : typeof fact.value === 'number' && Number.isFinite(fact.value)
          ? String(fact.value)
          : null;
    if (value === null || value.length === 0) continue;
    if (/(?:^|_)(?:target_column|targetcolumn|target)(?:_|$)/u.test(key)) {
      const target = declaration();
      if (target.targetColumn === null) {
        target.targetColumn = value;
        addPointer(fact.sourcePointer);
      } else if (target.targetColumn !== value) {
        issues.push({
          id: `conflict-${createHash('sha256').update(`${fact.key}:${fact.value}`).digest('hex').slice(0, 12)}`,
          kind: 'conflict',
          severity: 'revision_required',
          title: 'Các nguồn khai báo cột mục tiêu khác nhau',
          detail: `Nguồn trước: ${target.targetColumn}; nguồn bổ sung: ${value}.`,
          requiresDecision: false,
          sourcePointers: [fact.sourcePointer],
        });
      }
      continue;
    }
    if (/(?:^|_)(?:target_definition|targetdefinition)(?:_|$)/u.test(key)) {
      if (extraction.targetDefinition === null) extraction.targetDefinition = value;
      else if (extraction.targetDefinition !== value) {
        issues.push({
          id: `conflict-${createHash('sha256').update(`${fact.key}:${fact.value}`).digest('hex').slice(0, 12)}`,
          kind: 'conflict',
          severity: 'revision_required',
          title: 'Các nguồn khai báo ý nghĩa biến mục tiêu khác nhau',
          detail: `Nguồn trước: ${extraction.targetDefinition}; nguồn bổ sung: ${value}.`,
          requiresDecision: false,
          sourcePointers: [fact.sourcePointer],
        });
      }
      declaration().targetDefinition = extraction.targetDefinition;
      addPointer(fact.sourcePointer);
      continue;
    }
    if (/(?:^|_)(?:expected_columns|expectedcolumns)(?:_|$)/u.test(key)) {
      const target = declaration();
      if (!target.expectedColumns.includes(value)) target.expectedColumns.push(value);
      addPointer(fact.sourcePointer);
      continue;
    }
    if (/(?:^|_)(?:ram_gb|ramgb)(?:_|$)/u.test(key) && /^\d+$/u.test(value)) {
      const ramGb = Number.parseInt(value, 10);
      if (extraction.runtime.ramGb === null) extraction.runtime.ramGb = ramGb;
      else if (extraction.runtime.ramGb !== ramGb) {
        issues.push({
          id: `conflict-${createHash('sha256').update(`${fact.key}:${fact.value}`).digest('hex').slice(0, 12)}`,
          kind: 'conflict',
          severity: 'revision_required',
          title: 'Các nguồn khai báo bộ nhớ khác nhau',
          detail: `Nguồn trước: ${String(extraction.runtime.ramGb)} GB; nguồn bổ sung: ${String(ramGb)} GB.`,
          requiresDecision: false,
          sourcePointers: [fact.sourcePointer],
        });
      }
      continue;
    }
    if (/(?:^|_)(?:constraints?|polic(?:y|ies)|delivery)(?:_|$)/u.test(key)) {
      addConstraint(value, fact.sourcePointer);
    }
  }
  return issues;
}

async function parseBlueprint(input: {
  source: PinnedUnderstandingSource;
  semanticFallback?: UnderstandingSemanticFallback;
}): Promise<{
  extraction: BlueprintExtractionResult;
  coverage: UnderstandingCoverageEntry[];
  parserVersion: string;
  semanticAssistance: UnderstandingSemanticFallbackResult | null;
  semanticFailure: string | null;
}> {
  if (sourceHasFormat(input.source, 'system2_json')) {
    const result = readSystem2BlueprintJson({
      json: decodeUtf8(input.source),
      sourceVersionId: input.source.id,
      filename: input.source.filename,
    });
    return {
      ...result,
      parserVersion: 'system3-system2-json-reader@1',
      semanticAssistance: null,
      semanticFailure: null,
    };
  }
  if (!sourceHasFormat(input.source, 'markdown') && !sourceHasFormat(input.source, 'pdf')) {
    // Do not decode arbitrary bytes and hope that they happen to resemble
    // Markdown.  We still return a normal analysis so the lifecycle can show
    // a durable, user-actionable revision requirement instead of losing the
    // source provenance in a thrown parser error.
    const index = parseUnderstandingMarkdown({
      markdown: '',
      sourceVersionId: input.source.id,
      filename: input.source.filename,
    });
    return {
      extraction: extractBlueprintFromIndex(index),
      coverage: [unsupportedSourceCoverage(input.source)],
      parserVersion: 'system3-unsupported-source@1',
      semanticAssistance: null,
      semanticFailure: null,
    };
  }
  const index = sourceHasFormat(input.source, 'pdf')
    ? await readUnderstandingPdf({
        bytes: input.source.bytes,
        sourceVersionId: input.source.id,
        filename: input.source.filename,
      })
    : parseUnderstandingMarkdown({
        markdown: decodeUtf8(input.source),
        sourceVersionId: input.source.id,
        filename: input.source.filename,
      });
  const extraction = extractBlueprintFromIndex(index);
  let semanticAssistance: UnderstandingSemanticFallbackResult | null = null;
  let semanticFailure: string | null = null;
  const candidates = index.components.filter(
    component => component.text.length > 0 && component.coverageStatus === 'unclassified'
  );
  if (input.semanticFallback && candidates.length > 0) {
    try {
      semanticAssistance = await input.semanticFallback({
        filename: input.source.filename,
        components: candidates.slice(0, 20).map(component => ({
          id: component.id,
          text: component.text.slice(0, 6_000),
          sourcePointer: component.sourcePointer,
        })),
      });
    } catch (error) {
      semanticAssistance = null;
      semanticFailure = error instanceof Error ? error.message : 'Hỗ trợ ngữ nghĩa thất bại';
    }
  }
  if (semanticAssistance) {
    for (const candidate of semanticAssistance.candidates) {
      const component = candidates.find(item => item.id === candidate.componentId);
      if (
        !component ||
        !component.text.includes(candidate.exactQuote) ||
        candidate.value.trim().length === 0
      ) {
        continue;
      }
      if (candidate.field === 'business_goal' && extraction.businessGoal === null) {
        extraction.businessGoal = candidate.value;
        extraction.problemProfile.businessGoal = {
          value: candidate.value,
          status: 'declared_unverified',
          sourcePointers: [component.sourcePointer],
        };
      } else if (
        candidate.field === 'technical_objective' &&
        extraction.technicalObjective === null
      ) {
        extraction.technicalObjective = candidate.value;
        extraction.problemProfile.technicalObjective = {
          value: candidate.value,
          status: 'declared_unverified',
          sourcePointers: [component.sourcePointer],
        };
      } else if (candidate.field === 'target_definition' && extraction.targetDefinition === null) {
        extraction.targetDefinition = candidate.value;
      } else continue;
      markComponent(
        component,
        'extracted',
        'Đã nhận ứng viên từ hỗ trợ ngữ nghĩa và kiểm tra lại trích dẫn nguồn.'
      );
    }
  }
  return {
    extraction,
    coverage: coverageFromIndex(index.components),
    parserVersion: sourceHasFormat(input.source, 'pdf')
      ? UNDERSTANDING_PDF_PARSER_VERSION
      : 'system3-markdown-reader@2',
    semanticAssistance,
    semanticFailure,
  };
}

export async function understandProjectSources(input: {
  sources: readonly PinnedUnderstandingSource[];
  datasetSource?: StreamedPinnedUnderstandingSource;
  previousAnalysis?: BlueprintAnalysis | null;
  semanticFallback?: UnderstandingSemanticFallback;
  signal?: AbortSignal;
}): Promise<UnderstandProjectResult> {
  for (const source of input.sources) {
    if (digest(source.bytes) !== source.contentHash) {
      throw new Error(`Mã kiểm tra của phiên bản nguồn ${source.id} không khớp`);
    }
  }
  const blueprint =
    input.sources.find(source => source.kind === 'blueprint') ??
    ((): never => {
      throw new Error('Understanding Input Snapshot không có Blueprint');
    })();
  const parsed = await parseBlueprint({
    source: blueprint,
    semanticFallback: input.semanticFallback,
  });
  const supplementalSources = input.sources.filter(
    source => source.kind === 'constraints' || source.kind === 'data_dictionary'
  );
  const supplementalFacts = supplementalSources.flatMap(source => {
    if (!sourceHasFormat(source, 'system2_json') && !sourceHasFormat(source, 'yaml')) return [];
    return readSupplementalStructuredSource({
      text: decodeUtf8(source),
      sourceVersionId: source.id,
      filename: source.filename,
      mediaType: source.mediaType,
    });
  });
  const unsupportedSupplementalIssues = input.sources
    .filter(
      source =>
        source.kind === 'constraints' ||
        source.kind === 'data_dictionary' ||
        source.kind === 'user_brief' ||
        source.kind === 'supporting_document'
    )
    .filter(source => {
      if (source.kind === 'constraints' || source.kind === 'data_dictionary') {
        return !sourceHasFormat(source, 'system2_json') && !sourceHasFormat(source, 'yaml');
      }
      return (
        !sourceHasFormat(source, 'markdown') &&
        !sourceHasFormat(source, 'system2_json') &&
        !sourceHasFormat(source, 'pdf')
      );
    })
    .map(unsupportedSourceIssue);
  const supplementalIssues = applySupplementalFacts(parsed.extraction, supplementalFacts);
  const inMemoryDataset = input.sources.find(source => source.kind === 'dataset') ?? null;
  const dataset = input.datasetSource ?? inMemoryDataset;
  const declaredTarget = parsed.extraction.datasetDeclaration?.targetColumn ?? null;
  const hasSupportedDataset =
    dataset !== undefined && dataset !== null && sourceHasFormat(dataset, 'csv');
  const profile =
    hasSupportedDataset && dataset
      ? await profileDatasetCsvStream({
          filename: dataset.filename,
          sourceVersionId: dataset.id,
          chunks:
            'chunks' in dataset
              ? dataset.chunks
              : (async function* (): AsyncGenerator<Uint8Array> {
                  const chunkSize = 64 * 1024;
                  for (let offset = 0; offset < dataset.bytes.byteLength; offset += chunkSize) {
                    yield dataset.bytes.subarray(
                      offset,
                      Math.min(dataset.bytes.byteLength, offset + chunkSize)
                    );
                  }
                })(),
          expectedContentHash: dataset.contentHash,
          targetColumn: declaredTarget,
          signal: input.signal,
        })
      : null;
  const datasetResult = datasetUnderstanding({ extraction: parsed.extraction, profile });
  datasetResult.issues.push(
    ...supplementalIssues,
    ...unsupportedSupplementalIssues,
    ...(dataset && !hasSupportedDataset ? [unsupportedSourceIssue(dataset)] : [])
  );
  const quality = evaluateUnderstandingQuality({
    extraction: parsed.extraction,
    coverage: parsed.coverage,
    datasetUnderstanding: datasetResult,
    parserVersion: parsed.parserVersion,
    additionalIssues:
      parsed.semanticFailure === null
        ? []
        : [
            datasetIssue({
              key: `semantic-assistance:${parsed.semanticFailure}`,
              kind: 'semantic_assistance',
              severity: 'warning',
              title: 'Hỗ trợ ngữ nghĩa không hoàn thành',
              detail: `${parsed.semanticFailure}. Kết quả có cấu trúc vẫn chỉ dựa trên bộ trích xuất xác định.`,
              requiresDecision: false,
              sourcePointers: [],
            }),
          ],
  });
  const legacyProfile = profile
    ? {
        filename: profile.filename,
        rowCount: profile.rowCount,
        columnCount: profile.columnCount,
        columns: profile.columns.map(column => column.name),
        targetColumn: profile.targetColumn,
        targetExists: profile.targetExists,
        targetDistribution: profile.targetDistribution,
      }
    : null;
  const analysis = blueprintAnalysisV2Schema.parse({
    schemaVersion: 2,
    businessGoal: parsed.extraction.businessGoal,
    technicalObjective: parsed.extraction.technicalObjective,
    targetDefinition: parsed.extraction.targetDefinition,
    runtime: parsed.extraction.runtime,
    requirements: parsed.extraction.requirements,
    modules: parsed.extraction.modules,
    manualReviews: parsed.extraction.manualReviews,
    dataset: legacyProfile,
    problemProfile: parsed.extraction.problemProfile,
    datasetUnderstanding: datasetResult,
    pipeline: parsed.extraction.pipeline,
    technologyStack: parsed.extraction.technologyStack,
    moduleDesign: parsed.extraction.moduleDesign,
    executionBlueprint: parsed.extraction.executionBlueprint,
    extractionQuality: quality,
  });
  return {
    analysis,
    reports: createUnderstandingReports({ analysis, previous: input.previousAnalysis ?? null }),
    semanticAssistance: parsed.semanticAssistance,
  };
}

export * from './schemas';
export * from './decision-resolution';
export * from './document-index';
export * from './dataset-profiler';
export * from './pdf-layout-reader';
export * from './system2-json-reader';
