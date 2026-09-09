import { createHash } from 'node:crypto';
import { analyzeBlueprintMarkdown } from './blueprint';
import { parseSystem3CsvText } from './csv-contract';
import type { System3LifecycleActivityId, System3ResourceType } from './activity-resources';
import {
  system3ImpactChangeSchema,
  system3ImpactManifestSchema,
  type BlueprintAnalysis,
  type System3ChangeKind,
  type System3ImpactChange,
  type System3ImpactConfidence,
  type System3ImpactManifest,
  type System3ImpactResource,
  type System3SourceKind,
} from './contracts';

export const SYSTEM3_CHANGE_DETECTOR_VERSION = 'system3-change-detector@3' as const;

export function system3ChangeDetectionIdempotencyKey(sourceVersionId: string): string {
  return `source:${sourceVersionId}:${SYSTEM3_CHANGE_DETECTOR_VERSION}`;
}

export interface System3ChangeSourceInput {
  id: string;
  sourceId: string;
  kind: System3SourceKind;
  filename: string;
  mediaType: string;
  contentHash: string;
  bytes: Uint8Array;
}

export interface System3ChangeResourceInput {
  resourceType: System3ResourceType;
  resourceId: string;
  activityId: System3LifecycleActivityId;
  sourceVersionIds: readonly string[];
  status: 'pending' | 'current' | 'stale' | 'superseded' | 'failed';
}

export interface System3SemanticFallbackCandidate {
  kind: System3ChangeKind;
  entityType: string;
  entityKey: string | null;
  summary: string;
  sourcePointers: string[];
  confidence: number;
}

export interface System3SemanticFallbackResult {
  provider: string;
  model: string;
  candidates: System3SemanticFallbackCandidate[];
  attempts: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number;
}

export interface System3ImpactDependencyEdge {
  fromKind: string;
  fromId: string;
  toKind: string;
  toId: string;
  reason: string;
}

export type System3SemanticFallback = (input: {
  kind: System3SourceKind;
  filename: string;
  previousText: string | null;
  currentText: string;
}) => Promise<System3SemanticFallbackResult>;

interface DetectionResult {
  changes: System3ImpactChange[];
  confidence: System3ImpactConfidence;
  uncertainties: string[];
  parserVersion: string;
  fallbackText: { previous: string | null; current: string } | null;
}

const downstreamActivities: readonly System3LifecycleActivityId[] = [
  'TW-02',
  'TW-03',
  'OP-04',
  'OP-05',
  'TW-06',
  'TW-07',
  'OP-08',
  'TW-09',
];

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function displayValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const rendered = typeof value === 'string' ? value : canonicalJson(value);
  return rendered.length <= 2000 ? rendered : `${rendered.slice(0, 1997)}...`;
}

function extension(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index < 0 ? '' : filename.slice(index).toLowerCase();
}

function decodeText(source: System3ChangeSourceInput): string | null {
  if (source.mediaType === 'application/pdf' || extension(source.filename) === '.pdf') return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(source.bytes);
  } catch {
    return null;
  }
}

function canonicalMarkdown(text: string): string {
  return text
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pointerExists(pointer: string, text: string): boolean {
  const match = /:(\d+)(?:$|[-:])/u.exec(pointer);
  if (!match?.[1]) return false;
  const line = Number.parseInt(match[1], 10);
  return line > 0 && line <= text.split(/\r?\n/u).length;
}

function change(
  input: Omit<System3ImpactChange, 'detector'> & {
    detector?: System3ImpactChange['detector'];
  }
): System3ImpactChange {
  return system3ImpactChangeSchema.parse({ detector: 'deterministic', ...input });
}

function entityLabel(key: string): string {
  const labels: Readonly<Record<string, string>> = {
    business_goal: 'Mục tiêu nghiệp vụ',
    target_definition: 'Mục tiêu dự đoán',
    runtime: 'Môi trường chạy',
    modules: 'Các phần chức năng',
    manual_reviews: 'Các mục cần người dùng xem lại',
  };
  return labels[key] ?? key;
}

function compareField(
  changes: System3ImpactChange[],
  key: string,
  previous: unknown,
  current: unknown,
  kind: System3ChangeKind = 'content'
): void {
  if (canonicalJson(previous) === canonicalJson(current)) return;
  changes.push(
    change({
      kind,
      changeType: previous == null ? 'added' : current == null ? 'removed' : 'modified',
      entityType: key,
      entityKey: key,
      summary: `${entityLabel(key)} đã thay đổi.`,
      sourcePointers: [],
      confidence: 'high',
      previousValue: displayValue(previous),
      currentValue: displayValue(current),
    })
  );
}

function compareRequirements(
  previous: BlueprintAnalysis['requirements'],
  current: BlueprintAnalysis['requirements']
): System3ImpactChange[] {
  const changes: System3ImpactChange[] = [];
  const before = new Map(previous.map(item => [item.id, item]));
  const after = new Map(current.map(item => [item.id, item]));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
  for (const id of ids) {
    const left = before.get(id);
    const right = after.get(id);
    if (canonicalJson(left) === canonicalJson(right)) continue;
    changes.push(
      change({
        kind: 'requirement',
        changeType: left === undefined ? 'added' : right === undefined ? 'removed' : 'modified',
        entityType: 'requirement',
        entityKey: id,
        summary: `Yêu cầu ${id} đã ${left === undefined ? 'được thêm' : right === undefined ? 'bị xóa' : 'được sửa'}.`,
        sourcePointers: [right?.sourcePointer ?? left?.sourcePointer].filter(
          (value): value is string => value !== undefined
        ),
        confidence: 'high',
        previousValue: displayValue(left?.statement ?? left),
        currentValue: displayValue(right?.statement ?? right),
      })
    );
  }
  return changes;
}

function parseStructured(text: string, filename: string): unknown {
  const kind = extension(filename);
  if (kind === '.json') return JSON.parse(text) as unknown;
  if (kind === '.yaml' || kind === '.yml') return Bun.YAML.parse(text);
  return null;
}

function detectBlueprint(
  previous: System3ChangeSourceInput | null,
  current: System3ChangeSourceInput
): DetectionResult {
  if (previous === null) {
    return firstSource(decodeText(current) ?? '', 'system3-blueprint-diff@2');
  }
  const currentText = decodeText(current);
  const previousText = decodeText(previous);
  if (currentText === null || previousText === null) {
    return unsupported('Không có bộ trích xuất text an toàn cho định dạng blueprint này.');
  }
  try {
    const currentAnalysis =
      extension(current.filename) === '.json'
        ? (parseStructured(currentText, current.filename) as BlueprintAnalysis)
        : analyzeBlueprintMarkdown(currentText, null);
    const previousAnalysis =
      extension(previous.filename) === '.json'
        ? (parseStructured(previousText ?? '', previous.filename) as BlueprintAnalysis)
        : analyzeBlueprintMarkdown(previousText ?? '', null);
    if (
      canonicalJson(previousAnalysis) === canonicalJson(currentAnalysis) &&
      canonicalMarkdown(previousText) === canonicalMarkdown(currentText)
    ) {
      return formattingOnly(currentText, previousText, 'system3-blueprint-diff@2');
    }
    const changes = compareRequirements(
      previousAnalysis.requirements ?? [],
      currentAnalysis.requirements ?? []
    );
    compareField(
      changes,
      'business_goal',
      previousAnalysis.businessGoal,
      currentAnalysis.businessGoal
    );
    compareField(
      changes,
      'technical_objective',
      previousAnalysis.technicalObjective,
      currentAnalysis.technicalObjective
    );
    compareField(
      changes,
      'target_definition',
      previousAnalysis.targetDefinition,
      currentAnalysis.targetDefinition,
      'target'
    );
    compareField(changes, 'runtime', previousAnalysis.runtime, currentAnalysis.runtime, 'runtime');
    compareField(changes, 'modules', previousAnalysis.modules, currentAnalysis.modules);
    compareField(
      changes,
      'manual_reviews',
      previousAnalysis.manualReviews,
      currentAnalysis.manualReviews
    );
    return {
      changes:
        changes.length > 0
          ? changes
          : [
              change({
                kind: 'content',
                changeType: 'modified',
                entityType: 'blueprint',
                entityKey: null,
                summary:
                  'Nội dung bản mô tả đã thay đổi ngoài các trường mà hệ thống đã nhận diện.',
                sourcePointers: [],
                confidence: 'medium',
              }),
            ],
      confidence: changes.length > 0 ? 'high' : 'medium',
      uncertainties:
        changes.length > 0 ? [] : ['Một phần bản mô tả chưa được liên kết với mục dữ liệu cụ thể.'],
      parserVersion: 'system3-blueprint-diff@2',
      fallbackText: { previous: previousText, current: currentText },
    };
  } catch {
    return {
      ...unsupported('Bản mô tả không khớp cấu trúc chuẩn hoặc cách đọc tài liệu hiện có.'),
      fallbackText: { previous: previousText, current: currentText },
    };
  }
}

function datasetFingerprint(text: string): {
  columns: string[];
  rowCount: number;
  rowFingerprint: string;
} {
  const rows = parseSystem3CsvText(text);
  const columns = rows[0] ?? [];
  if (columns.length === 0) throw new Error('CSV has no header');
  const rowHashes = rows
    .slice(1)
    .map(row => digest(canonicalJson(row)))
    .sort();
  return { columns, rowCount: rowHashes.length, rowFingerprint: digest(rowHashes.join(':')) };
}

function detectDataset(
  previous: System3ChangeSourceInput | null,
  current: System3ChangeSourceInput,
  targetColumn: string | null
): DetectionResult {
  if (previous === null) {
    return firstSource(decodeText(current) ?? '', 'system3-dataset-diff@2');
  }
  const currentText = decodeText(current);
  const previousText = decodeText(previous);
  if (currentText === null || previousText === null) {
    return unsupported('Tệp dữ liệu không đọc được dưới dạng CSV UTF-8.');
  }
  try {
    const before = datasetFingerprint(previousText ?? '');
    const after = datasetFingerprint(currentText);
    if (canonicalJson(before) === canonicalJson(after)) {
      return formattingOnly(currentText, previousText, 'system3-dataset-diff@2');
    }
    const schemaChanged = canonicalJson(before.columns) !== canonicalJson(after.columns);
    const targetChanged =
      targetColumn !== null &&
      before.columns.includes(targetColumn) !== after.columns.includes(targetColumn);
    const kind: System3ChangeKind = targetChanged
      ? 'target'
      : schemaChanged
        ? 'schema'
        : 'row_only';
    const summary = targetChanged
      ? `Sự tồn tại của cột mục tiêu '${targetColumn ?? ''}' đã thay đổi.`
      : schemaChanged
        ? 'Cấu trúc cột của tệp dữ liệu đã thay đổi.'
        : `Dữ liệu thay đổi nhưng giữ nguyên ${after.columns.length.toString()} cột.`;
    return {
      changes: [
        change({
          kind,
          changeType: 'modified',
          entityType: kind === 'row_only' ? 'dataset_rows' : 'dataset_schema',
          entityKey: targetChanged ? targetColumn : null,
          summary,
          sourcePointers: ['dataset.csv:1'],
          confidence: targetColumn === null && schemaChanged ? 'medium' : 'high',
          previousValue: displayValue(
            schemaChanged ? before.columns : { rowCount: before.rowCount }
          ),
          currentValue: displayValue(schemaChanged ? after.columns : { rowCount: after.rowCount }),
        }),
      ],
      confidence: targetColumn === null && schemaChanged ? 'medium' : 'high',
      uncertainties:
        targetColumn === null
          ? ['Chưa có cột mục tiêu được xác nhận để kiểm tra thay đổi của mục tiêu.']
          : [],
      parserVersion: 'system3-dataset-diff@2',
      fallbackText: null,
    };
  } catch {
    return unsupported('Không thể tạo dấu nhận diện an toàn cho tệp dữ liệu.');
  }
}

function flatten(value: unknown, prefix = ''): Map<string, string> {
  const result = new Map<string, string>();
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix.length > 0 ? `${prefix}.${key}` : key;
      for (const [nestedKey, nestedValue] of flatten(child, path))
        result.set(nestedKey, nestedValue);
    }
  } else result.set(prefix || '$', canonicalJson(value));
  return result;
}

function classifyPath(path: string): System3ChangeKind {
  if (/delivery|package|handoff/u.test(path)) return 'delivery';
  if (/runtime|cpu|ram|gpu|timeout/u.test(path)) return 'runtime';
  if (/policy|permission|security|privacy/u.test(path)) return 'policy';
  if (path.includes('target')) return 'target';
  return 'content';
}

function detectStructuredOrText(
  previous: System3ChangeSourceInput | null,
  current: System3ChangeSourceInput
): DetectionResult {
  if (previous === null) {
    return firstSource(decodeText(current) ?? '', 'system3-structured-diff@2');
  }
  const currentText = decodeText(current);
  const previousText = decodeText(previous);
  if (currentText === null || previousText === null) {
    return unsupported('Định dạng này chưa có cách đọc văn bản an toàn.');
  }
  try {
    const currentValue = parseStructured(currentText, current.filename);
    const previousValue = parseStructured(previousText ?? '', previous.filename);
    if (currentValue !== null && previousValue !== null) {
      if (canonicalJson(currentValue) === canonicalJson(previousValue)) {
        return formattingOnly(currentText, previousText, 'system3-structured-diff@2');
      }
      const before = flatten(previousValue);
      const after = flatten(currentValue);
      const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
      const changes = paths.flatMap(path => {
        if (before.get(path) === after.get(path)) return [];
        return [
          change({
            kind: classifyPath(path),
            changeType: !before.has(path) ? 'added' : !after.has(path) ? 'removed' : 'modified',
            entityType: 'constraint_field',
            entityKey: path,
            summary: `Trường '${path}' đã thay đổi.`,
            sourcePointers: [`${current.filename}:${path}`],
            confidence: 'high',
            previousValue: displayValue(before.get(path)),
            currentValue: displayValue(after.get(path)),
          }),
        ];
      });
      return {
        changes,
        confidence: 'high',
        uncertainties: [],
        parserVersion: 'system3-structured-diff@2',
        fallbackText: { previous: previousText, current: currentText },
      };
    }
    if (canonicalMarkdown(previousText ?? '') === canonicalMarkdown(currentText)) {
      return formattingOnly(currentText, previousText, 'system3-text-diff@2');
    }
    return {
      changes: [
        change({
          kind: 'content',
          changeType: 'modified',
          entityType: current.kind,
          entityKey: null,
          summary: 'Nội dung văn bản đã thay đổi và cần xác định rõ ý nghĩa của thay đổi.',
          sourcePointers: [],
          confidence: 'medium',
        }),
      ],
      confidence: 'medium',
      uncertainties: ['Văn bản tự do chưa được liên kết đầy đủ với từng yêu cầu hoặc mục dữ liệu.'],
      parserVersion: 'system3-text-diff@2',
      fallbackText: { previous: previousText, current: currentText },
    };
  } catch {
    return {
      ...unsupported('Không thể chuẩn hóa nội dung nguồn.'),
      fallbackText: { previous: previousText, current: currentText },
    };
  }
}

function firstSource(currentText: string, parserVersion: string): DetectionResult {
  return {
    changes: [
      change({
        kind: 'first_source',
        changeType: 'added',
        entityType: 'source',
        entityKey: null,
        summary: 'Đây là phiên bản đầu tiên của nguồn này.',
        sourcePointers: [],
        confidence: 'high',
      }),
    ],
    confidence: 'high',
    uncertainties: [],
    parserVersion,
    fallbackText: { previous: null, current: currentText },
  };
}

function formattingOnly(
  current: string,
  previous: string | null,
  parserVersion: string
): DetectionResult {
  return {
    changes: [
      change({
        kind: 'formatting_only',
        changeType: 'modified',
        entityType: 'source_format',
        entityKey: null,
        summary: 'Dữ liệu gốc thay đổi nhưng nội dung sau khi chuẩn hóa không đổi.',
        sourcePointers: [],
        confidence: 'high',
      }),
    ],
    confidence: 'high',
    uncertainties: [],
    parserVersion,
    fallbackText: { previous, current },
  };
}

function unsupported(reason: string): DetectionResult {
  return {
    changes: [
      change({
        kind: 'unknown',
        changeType: 'modified',
        entityType: 'source',
        entityKey: null,
        summary: reason,
        sourcePointers: [],
        confidence: 'low',
        detector: 'conservative_fallback',
      }),
    ],
    confidence: 'low',
    uncertainties: [reason],
    parserVersion: 'system3-unsupported-source@1',
    fallbackText: null,
  };
}

function uniqueActivities(
  values: readonly System3LifecycleActivityId[]
): System3LifecycleActivityId[] {
  const set = new Set(values);
  return downstreamActivities.filter(value => set.has(value));
}

function activitiesForChanges(
  changes: readonly System3ImpactChange[]
): System3LifecycleActivityId[] {
  const kinds = new Set(changes.map(item => item.kind));
  if (kinds.size === 1 && kinds.has('formatting_only')) return [];
  if (kinds.size === 1 && kinds.has('delivery')) return ['OP-04', 'OP-05', 'OP-08', 'TW-09'];
  if (kinds.size === 1 && kinds.has('row_only')) {
    return ['TW-02', 'OP-04', 'OP-05', 'TW-06', 'TW-07', 'OP-08', 'TW-09'];
  }
  return [...downstreamActivities];
}

function resourceImpact(
  resources: readonly System3ChangeResourceInput[],
  affectedActivities: readonly System3LifecycleActivityId[],
  sourceIds: readonly string[],
  changes: readonly System3ImpactChange[],
  dependencyEdges: readonly System3ImpactDependencyEdge[]
): { affected: System3ImpactResource[]; reusable: System3ImpactResource[] } {
  const affectedSet = new Set(affectedActivities);
  const adjacency = new Map<string, { key: string; reason: string }[]>();
  for (const edge of dependencyEdges) {
    const from = `${edge.fromKind}:${edge.fromId}`;
    const to = `${edge.toKind}:${edge.toId}`;
    const values = adjacency.get(from) ?? [];
    values.push({ key: to, reason: edge.reason });
    adjacency.set(from, values);
  }
  const parents = new Map<string, { parent: string; reason: string }>();
  const queue = [
    ...sourceIds.map(id => `source_version:${id}`),
    ...changes.flatMap(item =>
      item.entityKey === null ? [] : [`${item.entityType}:${item.entityKey}`]
    ),
  ];
  const reached = new Set(queue);
  for (const current of queue) {
    for (const next of adjacency.get(current) ?? []) {
      if (reached.has(next.key)) continue;
      reached.add(next.key);
      parents.set(next.key, { parent: current, reason: next.reason });
      queue.push(next.key);
    }
  }
  const dependencyPath = (resourceId: string): string[] => {
    const target = `resource:${resourceId}`;
    if (!reached.has(target)) return [];
    const path = [target];
    let cursor = target;
    while (parents.has(cursor)) {
      const value = parents.get(cursor);
      if (!value) break;
      path.unshift(value.parent);
      cursor = value.parent;
    }
    return path;
  };
  const affected: System3ImpactResource[] = [];
  const reusable: System3ImpactResource[] = [];
  for (const resource of resources) {
    if (resource.status !== 'current') continue;
    const hasPinnedDependency = resource.sourceVersionIds.some(id => sourceIds.includes(id));
    const graphPath = dependencyPath(resource.resourceId);
    const hasGraphDependency = graphPath.length > 0;
    const item: System3ImpactResource = {
      resourceType: resource.resourceType,
      resourceId: resource.resourceId,
      activityId: resource.activityId,
      reason:
        affectedSet.has(resource.activityId) || hasPinnedDependency || hasGraphDependency
          ? hasGraphDependency
            ? 'Bản đồ quan hệ chứng minh kết quả này phụ thuộc vào nội dung đã thay đổi.'
            : hasPinnedDependency
              ? 'Kết quả này dùng trực tiếp phiên bản nguồn đã được thay thế.'
              : 'Hoạt động tạo ra kết quả nằm trong phạm vi cần kiểm tra lại.'
          : 'Bước tạo kết quả và phiên bản nguồn được dùng không nằm trong phạm vi ảnh hưởng đã chứng minh.',
      dependencyPath: hasGraphDependency
        ? graphPath
        : hasPinnedDependency
          ? [`source_version:${sourceIds[0] ?? 'unknown'}`, `resource:${resource.resourceId}`]
          : ['policy:system3-impact-policy@3', `activity:${resource.activityId}`],
    };
    if (affectedSet.has(resource.activityId) || hasPinnedDependency || hasGraphDependency)
      affected.push(item);
    else reusable.push(item);
  }
  return { affected, reusable };
}

function proposedRerun(
  changes: readonly System3ImpactChange[],
  activities: readonly System3LifecycleActivityId[]
): System3ImpactManifest['proposedRerun'] {
  const kinds = new Set(changes.map(item => item.kind));
  if (activities.length === 0) {
    return {
      mode: 'none',
      activityIds: [],
      executableScope: 'none',
      reason: 'Nội dung sau khi chuẩn hóa không đổi; không cần làm lại các bước phía sau.',
    };
  }
  if (kinds.size === 1 && kinds.has('delivery')) {
    return {
      mode: 'scoped',
      activityIds: [...activities],
      executableScope: 'delivery',
      reason:
        'Thay đổi chỉ nằm trong yêu cầu bàn giao; kết quả xây dựng đã xác minh có thể được xem xét giữ lại.',
    };
  }
  if (kinds.size === 1 && kinds.has('row_only')) {
    return {
      mode: 'scoped',
      activityIds: [...activities],
      executableScope: 'experiment',
      reason:
        'Chỉ số dòng dữ liệu thay đổi; giữ lại mã đã duyệt, áp dụng đúng Source Version mới rồi chạy lại dữ liệu, thử nghiệm và xác minh.',
    };
  }
  return {
    mode: 'full',
    activityIds: [...activities],
    executableScope: 'full',
    reason:
      'Thay đổi ảnh hưởng bước Hiểu dự án hoặc còn điểm chưa chắc chắn nên cần làm lại đầy đủ.',
  };
}

function validateFallbackCandidates(
  result: System3SemanticFallbackResult,
  currentText: string
): System3ImpactChange[] {
  return result.candidates.flatMap(candidate => {
    if (
      candidate.confidence < 0.5 ||
      candidate.confidence > 1 ||
      candidate.sourcePointers.length === 0 ||
      candidate.sourcePointers.some(pointer => !pointerExists(pointer, currentText))
    ) {
      return [];
    }
    return [
      change({
        kind: candidate.kind,
        changeType: 'modified',
        entityType: candidate.entityType,
        entityKey: candidate.entityKey,
        summary: candidate.summary,
        sourcePointers: candidate.sourcePointers,
        confidence: candidate.confidence >= 0.8 ? 'high' : 'medium',
        detector: 'llm_candidate',
      }),
    ];
  });
}

function changedExcerpt(
  previous: string | null,
  current: string,
  maxChars = 6000
): {
  previous: string | null;
  current: string;
} {
  const currentLines = current.split(/\r?\n/u);
  const previousLines = previous?.split(/\r?\n/u) ?? [];
  let prefix = 0;
  while (
    prefix < currentLines.length &&
    prefix < previousLines.length &&
    currentLines[prefix] === previousLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < currentLines.length - prefix &&
    suffix < previousLines.length - prefix &&
    currentLines[currentLines.length - 1 - suffix] ===
      previousLines[previousLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const render = (lines: readonly string[], start: number, end: number): string =>
    lines
      .slice(start, end)
      .map((line, index) => `L${(start + index + 1).toString()}: ${line}`)
      .join('\n')
      .slice(0, maxChars);
  const currentStart = Math.max(0, prefix - 3);
  const currentEnd = Math.min(currentLines.length, currentLines.length - suffix + 3);
  const previousStart = Math.max(0, prefix - 3);
  const previousEnd = Math.min(previousLines.length, previousLines.length - suffix + 3);
  return {
    previous:
      previous === null
        ? null
        : render(previousLines, previousStart, previousEnd || previousLines.length),
    current: render(currentLines, currentStart, currentEnd || currentLines.length),
  };
}

export async function detectSystem3SourceChange(input: {
  projectId: string;
  operationId: string;
  current: System3ChangeSourceInput;
  previous: System3ChangeSourceInput | null;
  knowledgeSnapshotId: string | null;
  targetColumn: string | null;
  resources: readonly System3ChangeResourceInput[];
  dependencyEdges?: readonly System3ImpactDependencyEdge[];
  semanticFallback?: System3SemanticFallback;
  now?: string;
}): Promise<System3ImpactManifest> {
  let detected =
    input.current.kind === 'blueprint'
      ? detectBlueprint(input.previous, input.current)
      : input.current.kind === 'dataset'
        ? detectDataset(input.previous, input.current, input.targetColumn)
        : detectStructuredOrText(input.previous, input.current);
  let llm: System3ImpactManifest['llmAssistance'] = {
    used: false,
    provider: null,
    model: null,
    promptVersion: null,
    candidateCount: 0,
    attempts: 0,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    durationMs: null,
    outcome: 'not_used',
  };
  if (
    input.semanticFallback !== undefined &&
    detected.fallbackText !== null &&
    (detected.confidence !== 'high' || detected.uncertainties.length > 0)
  ) {
    try {
      const excerpts = changedExcerpt(
        detected.fallbackText.previous,
        detected.fallbackText.current
      );
      const result = await input.semanticFallback({
        kind: input.current.kind,
        filename: input.current.filename,
        previousText: excerpts.previous,
        currentText: excerpts.current,
      });
      const candidates = validateFallbackCandidates(result, detected.fallbackText.current);
      if (candidates.length > 0) {
        detected = {
          ...detected,
          changes: [...detected.changes, ...candidates],
          confidence: 'medium',
          uncertainties: [
            ...detected.uncertainties,
            'Kết quả hỗ trợ tự động chỉ là gợi ý; không được thu hẹp phạm vi khi thiếu bằng chứng theo quy tắc.',
          ],
        };
      }
      llm = {
        used: true,
        provider: result.provider,
        model: result.model,
        promptVersion: 'system3-change-semantic-fallback@2',
        candidateCount: candidates.length,
        attempts: result.attempts,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        outcome: 'succeeded',
      };
    } catch {
      detected = {
        ...detected,
        confidence: 'low',
        uncertainties: [
          ...detected.uncertainties,
          'Phần hỗ trợ tự động không khả dụng; hệ thống giữ phạm vi rộng để bảo đảm an toàn.',
        ],
      };
      llm = { ...llm, attempts: 2, outcome: 'failed' };
    }
  }
  const affectedActivities = uniqueActivities(activitiesForChanges(detected.changes));
  const resourceResult = resourceImpact(
    input.resources,
    affectedActivities,
    [input.current.id, input.previous?.id ?? ''].filter(Boolean),
    detected.changes,
    input.dependencyEdges ?? []
  );
  const dependencyEdges = input.dependencyEdges ?? [];
  const dependencyNodes = new Set(
    dependencyEdges.flatMap(edge => [
      `${edge.fromKind}:${edge.fromId}`,
      `${edge.toKind}:${edge.toId}`,
    ])
  );
  const dependencyGraphHash = `sha256:${digest(canonicalJson(dependencyEdges))}`;
  const manifest = {
    schemaVersion: 3 as const,
    detectorVersion: SYSTEM3_CHANGE_DETECTOR_VERSION,
    projectId: input.projectId,
    operationId: input.operationId,
    sourceVersionId: input.current.id,
    previousSourceVersionId: input.previous?.id ?? null,
    basis: {
      sourceId: input.current.sourceId,
      kind: input.current.kind,
      currentContentHash: input.current.contentHash,
      previousContentHash: input.previous?.contentHash ?? null,
      knowledgeSnapshotId: input.knowledgeSnapshotId,
      dependencyGraphVersion: 'system3-dependency-graph@2' as const,
      dependencyGraphHash,
      dependencyNodeCount: dependencyNodes.size,
      dependencyEdgeCount: dependencyEdges.length,
      dependencyCoverage: input.resources.some(resource => resource.sourceVersionIds.length === 0)
        ? ('partial' as const)
        : ('complete' as const),
      parserVersion: detected.parserVersion,
      policyVersion: 'system3-impact-policy@3' as const,
    },
    analysisMode:
      llm.used && llm.candidateCount > 0
        ? ('llm_assisted' as const)
        : detected.confidence === 'low'
          ? ('conservative_fallback' as const)
          : ('deterministic' as const),
    confidence: detected.confidence,
    changes: detected.changes,
    affectedActivities,
    affectedResources: resourceResult.affected,
    reusableResources: resourceResult.reusable,
    proposedRerun: proposedRerun(detected.changes, affectedActivities),
    uncertainties: detected.uncertainties,
    llmAssistance: llm,
    summary:
      detected.changes.length === 1
        ? (detected.changes[0]?.summary ?? 'Đã phân tích thay đổi nguồn.')
        : `Phát hiện ${detected.changes.length.toString()} thay đổi có thể ảnh hưởng ${affectedActivities.length.toString()} bước phía sau.`,
    createdAt: input.now ?? new Date().toISOString(),
  };
  return system3ImpactManifestSchema.parse(manifest);
}
