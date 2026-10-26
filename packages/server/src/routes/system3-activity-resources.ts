import { createHash } from 'node:crypto';
import { z } from '@hono/zod-openapi';
import {
  modelComparisonModelReportSchema,
  system3LifecycleActivityIdSchema,
  type System3ActivityView,
  type System3ArtifactVersionRecord,
  type System3LifecycleActivityId,
  type ModelComparisonModelReport,
  type System3PresentationBlock,
  type System3ResourceDescriptor,
  type System3ResourcePresentation,
  type System3ResourceRelation,
  type System3ResourceStatus,
  type System3ResourceType,
  type System3Store,
  validateProjectArchive,
} from '@anvil/system3';

const RENDERER_VERSION = 'system3-resource-renderer@2';
const MAX_MARKDOWN_CITATIONS = 24;
const MAX_CITATION_EXCERPT_CHARS = 1_200;
const MAX_CITATION_SOURCE_BYTES = 512 * 1024;
const MAX_COMPARISON_FILE_BYTES = 64 * 1024;
const comparisonManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    inputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    datasetHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    configHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    reports: z.array(modelComparisonModelReportSchema).min(2).max(4),
  })
  .strict();

interface CitationPointer {
  sourceVersionId: string;
  filename: string;
  headingPath: string[];
  startLine: number | null;
  endLine: number | null;
  excerptHash: string;
}

interface CitationSource {
  id: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  storageKey: string;
  storageStatus: string;
  contentHash: string;
}

interface CitationRequirement {
  id: string;
  statement: string;
  sourcePointers?: unknown;
}

function citationDigest(value: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function isCitationPointer(value: unknown): value is CitationPointer {
  if (value === null || typeof value !== 'object') return false;
  const pointer = value as Record<string, unknown>;
  return (
    typeof pointer.sourceVersionId === 'string' &&
    typeof pointer.filename === 'string' &&
    Array.isArray(pointer.headingPath) &&
    pointer.headingPath.every(value => typeof value === 'string') &&
    (pointer.startLine === null ||
      (typeof pointer.startLine === 'number' &&
        Number.isSafeInteger(pointer.startLine) &&
        pointer.startLine > 0)) &&
    (pointer.endLine === null ||
      (typeof pointer.endLine === 'number' &&
        Number.isSafeInteger(pointer.endLine) &&
        pointer.endLine > 0)) &&
    typeof pointer.excerptHash === 'string'
  );
}

function citationItem(input: {
  label: string;
  pointer: CitationPointer | null;
  status: 'verified' | 'unavailable';
  excerpt?: string | null;
  reason?: string | null;
  truncated?: boolean;
}): Extract<System3PresentationBlock, { kind: 'citations' }>['items'][number] {
  return {
    label: input.label,
    filename: input.pointer?.filename || 'Nguồn không xác định',
    sourceVersionId: input.pointer?.sourceVersionId || 'unknown',
    startLine: input.pointer?.startLine ?? null,
    endLine: input.pointer?.endLine ?? null,
    headingPath: input.pointer?.headingPath.slice() ?? [],
    excerpt: input.excerpt ?? null,
    status: input.status,
    reason: input.reason ?? null,
    truncated: input.truncated ?? false,
  };
}

/**
 * Produces a bounded, provenance-preserving read model. Source bytes are only
 * rendered after their complete stored hash and the parser's line-normalized
 * excerpt hash both match the immutable pointer.
 */
export async function buildMarkdownRequirementCitationBlock(input: {
  analysis: { requirements: readonly CitationRequirement[] };
  sources: readonly CitationSource[];
  readSource: (source: CitationSource) => Promise<Uint8Array>;
}): Promise<Extract<System3PresentationBlock, { kind: 'citations' }>> {
  const sources = new Map(input.sources.map(source => [source.id, source]));
  const verifiedTexts = new Map<string, Promise<{ text: string | null; reason: string | null }>>();
  const readVerifiedText = (
    source: CitationSource
  ): Promise<{ text: string | null; reason: string | null }> => {
    const cached = verifiedTexts.get(source.id);
    if (cached !== undefined) return cached;
    const result = (async (): Promise<{ text: string | null; reason: string | null }> => {
      if (source.storageStatus !== 'ready') {
        return { text: null, reason: 'Phiên bản nguồn chưa sẵn sàng để đối chiếu.' };
      }
      if (source.sizeBytes > MAX_CITATION_SOURCE_BYTES) {
        return { text: null, reason: 'Nguồn quá lớn để xác minh nhanh trong phần xem trước.' };
      }
      try {
        const bytes = await input.readSource(source);
        if (bytes.byteLength > MAX_CITATION_SOURCE_BYTES) {
          return { text: null, reason: 'Nguồn quá lớn để xác minh nhanh trong phần xem trước.' };
        }
        if (citationDigest(bytes) !== source.contentHash) {
          return { text: null, reason: 'Nội dung nguồn không khớp phiên bản đã ghim.' };
        }
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), reason: null };
      } catch {
        return { text: null, reason: 'Không thể đọc nguồn để xác minh đoạn trích.' };
      }
    })();
    verifiedTexts.set(source.id, result);
    return result;
  };

  const items: Extract<System3PresentationBlock, { kind: 'citations' }>['items'] = [];
  for (const requirement of input.analysis.requirements) {
    const pointers =
      Array.isArray(requirement.sourcePointers) && requirement.sourcePointers.length > 0
        ? requirement.sourcePointers
        : [null];
    for (const rawPointer of pointers) {
      if (items.length >= MAX_MARKDOWN_CITATIONS) break;
      const label = `${requirement.id}: ${requirement.statement}`;
      if (!isCitationPointer(rawPointer)) {
        items.push(
          citationItem({
            label,
            pointer: null,
            status: 'unavailable',
            reason: 'Vị trí nguồn không hợp lệ.',
          })
        );
        continue;
      }
      const source = sources.get(rawPointer.sourceVersionId);
      if (source === undefined) {
        items.push(
          citationItem({
            label,
            pointer: rawPointer,
            status: 'unavailable',
            reason: 'Phiên bản nguồn đã ghim không còn khả dụng.',
          })
        );
        continue;
      }
      if (
        !/\.(?:md|mdown|markdown)$/iu.test(source.filename) ||
        source.mediaType.split(';', 1)[0]?.trim().toLowerCase() !== 'text/markdown'
      ) {
        items.push(
          citationItem({
            label,
            pointer: rawPointer,
            status: 'unavailable',
            reason: 'Đoạn trích chỉ hỗ trợ nguồn Markdown.',
          })
        );
        continue;
      }
      if (source.filename !== rawPointer.filename) {
        items.push(
          citationItem({
            label,
            pointer: rawPointer,
            status: 'unavailable',
            reason: 'Tên nguồn không khớp phiên bản đã ghim.',
          })
        );
        continue;
      }
      const verified = await readVerifiedText(source);
      if (verified.text === null) {
        items.push(
          citationItem({
            label,
            pointer: rawPointer,
            status: 'unavailable',
            reason: verified.reason,
          })
        );
        continue;
      }
      if (
        rawPointer.startLine === null ||
        rawPointer.endLine === null ||
        rawPointer.endLine < rawPointer.startLine
      ) {
        items.push(
          citationItem({
            label,
            pointer: rawPointer,
            status: 'unavailable',
            reason: 'Đoạn trích Markdown cần phạm vi dòng hợp lệ.',
          })
        );
        continue;
      }
      // Matches parseUnderstandingMarkdown(): split CRLF, then join excerpt lines with LF.
      const lines = verified.text.split(/\r?\n/u);
      if (rawPointer.startLine > lines.length || rawPointer.endLine > lines.length) {
        items.push(
          citationItem({
            label,
            pointer: rawPointer,
            status: 'unavailable',
            reason: 'Vị trí dòng không còn trong phiên bản nguồn đã ghim.',
          })
        );
        continue;
      }
      const excerpt = lines.slice(rawPointer.startLine - 1, rawPointer.endLine).join('\n');
      if (citationDigest(excerpt) !== rawPointer.excerptHash) {
        items.push(
          citationItem({
            label,
            pointer: rawPointer,
            status: 'unavailable',
            reason: 'Đoạn trích không khớp thông tin nguồn đã lưu.',
          })
        );
        continue;
      }
      // Only narrow an already verified table to an unambiguous exact ID cell.
      // Otherwise retain its original range; never guess from prose or substrings.
      const excerptLines = excerpt.split('\n');
      const matchingRows = excerptLines
        .map((line, index) => ({ line, index }))
        .filter(
          ({ line }) =>
            line.trimStart().startsWith('|') && line.split('|')[1]?.trim() === requirement.id
        );
      const matchingRow = matchingRows.length === 1 ? matchingRows[0] : undefined;
      const displayExcerpt = matchingRow?.line ?? excerpt;
      const displayPointer =
        matchingRow === undefined
          ? rawPointer
          : {
              ...rawPointer,
              startLine: rawPointer.startLine + matchingRow.index,
              endLine: rawPointer.startLine + matchingRow.index,
            };
      items.push(
        citationItem({
          label,
          pointer: displayPointer,
          status: 'verified',
          excerpt: displayExcerpt.slice(0, MAX_CITATION_EXCERPT_CHARS),
          truncated: displayExcerpt.length > MAX_CITATION_EXCERPT_CHARS,
        })
      );
    }
    if (items.length >= MAX_MARKDOWN_CITATIONS) break;
  }
  const allPointerCount = input.analysis.requirements.reduce(
    (total, requirement) =>
      total +
      (Array.isArray(requirement.sourcePointers) && requirement.sourcePointers.length > 0
        ? requirement.sourcePointers.length
        : 1),
    0
  );
  return {
    kind: 'citations',
    title:
      allPointerCount > MAX_MARKDOWN_CITATIONS
        ? `Nguồn của các yêu cầu (chỉ hiển thị ${String(MAX_MARKDOWN_CITATIONS)} mục)`
        : 'Nguồn của các yêu cầu',
    items,
  };
}

export function friendlyDecisionQuestion(question: string): string {
  const trimmed = question.trim();
  const jsonCandidate = trimmed.replace(/^[-*]\s*/, '');
  if (jsonCandidate.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(jsonCandidate);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'issue' in parsed &&
        typeof parsed.issue === 'string' &&
        parsed.issue.trim().length > 0
      ) {
        return parsed.issue.trim();
      }
    } catch {
      // The original question remains authoritative when the marker is not valid JSON.
    }
  }
  const withoutMarker = trimmed
    .replace(/\[Manual Review Required\]/gi, '')
    .replace(/^[-*\s:]+/, '')
    .trim();
  return withoutMarker || 'Cần người dùng xác nhận trước khi tiếp tục.';
}

const ACTIVITY_COPY: Readonly<
  Record<
    System3LifecycleActivityId,
    { executionKind: 'operation' | 'workflow'; title: string; description: string }
  >
> = {
  'OP-00': {
    executionKind: 'operation',
    title: 'Tiếp nhận nguồn đầu vào',
    description: 'Kiểm tra file và lưu thành Source Version không bị ghi đè.',
  },
  'OP-01': {
    executionKind: 'operation',
    title: 'Phát hiện thay đổi',
    description: 'Xác định nguồn mới ảnh hưởng đến phần nào của project.',
  },
  'TW-02': {
    executionKind: 'workflow',
    title: 'Hiểu dự án',
    description: 'Tạo bản hiểu dự án từ đúng các phiên bản nguồn đã khóa.',
  },
  'TW-03': {
    executionKind: 'workflow',
    title: 'Kiểm tra mức độ sẵn sàng',
    description: 'Kiểm tra các điều kiện bắt buộc trước khi chuẩn bị kế hoạch.',
  },
  'OP-04': {
    executionKind: 'operation',
    title: 'Chuẩn bị kế hoạch thực thi',
    description: 'Chuyển project đã sẵn sàng thành Execution Plan chính xác.',
  },
  'OP-05': {
    executionKind: 'operation',
    title: 'Phê duyệt kế hoạch',
    description: 'Ghi nhận chính xác kế hoạch, input và quyền đã được duyệt.',
  },
  'TW-06': {
    executionKind: 'workflow',
    title: 'Thực thi kế hoạch đã duyệt',
    description: 'Chạy Project Workflow Version trong môi trường được cô lập.',
  },
  'TW-07': {
    executionKind: 'workflow',
    title: 'Xác minh kết quả độc lập',
    description: 'Kiểm tra kết quả bằng validator và Evidence độc lập.',
  },
  'OP-08': {
    executionKind: 'operation',
    title: 'Yêu cầu bàn giao',
    description: 'Kiểm tra gate và ghi nhận yêu cầu bàn giao rõ ràng.',
  },
  'TW-09': {
    executionKind: 'workflow',
    title: 'Tạo gói bàn giao',
    description: 'Tạo package và Delivery Manifest từ kết quả đã xác minh.',
  },
};

interface ResourceContext {
  project: NonNullable<Awaited<ReturnType<System3Store['getProject']>>>;
  sources: Awaited<ReturnType<System3Store['listSources']>>;
  reports: Awaited<ReturnType<System3Store['listSourceIntakeReports']>>;
  impacts: Awaited<ReturnType<System3Store['listImpactManifests']>>;
  understandingInputs: Awaited<ReturnType<System3Store['listUnderstandingInputSnapshots']>>;
  knowledge: Awaited<ReturnType<System3Store['getActiveUnderstanding']>>;
  knowledgeSnapshots: Awaited<ReturnType<System3Store['listUnderstandingSnapshots']>>;
  decisions: Awaited<ReturnType<System3Store['listDecisions']>>;
  readiness: Awaited<ReturnType<System3Store['getLatestReadinessContract']>>;
  compilations: Awaited<ReturnType<System3Store['listCompilations']>>;
  approvals: Awaited<ReturnType<System3Store['listApprovals']>>;
  executions: Awaited<ReturnType<System3Store['listExecutions']>>;
  verifications: Awaited<ReturnType<System3Store['listVerifications']>>;
  operations: Awaited<ReturnType<System3Store['listOperations']>>;
  deliveries: Awaited<ReturnType<System3Store['listDeliveries']>>;
  artifacts: Awaited<ReturnType<System3Store['listArtifactVersions']>>;
  transitions: Awaited<ReturnType<System3Store['listTransitions']>>;
  evidence: Awaited<ReturnType<System3Store['listEvidence']>>;
}

async function loadContext(
  store: System3Store,
  projectId: string
): Promise<ResourceContext | null> {
  const project = await store.getProject(projectId);
  if (project === null) return null;
  const [
    sources,
    reports,
    impacts,
    understandingInputs,
    knowledge,
    knowledgeSnapshots,
    decisions,
    readiness,
    compilations,
    approvals,
    executions,
    verifications,
    operations,
    deliveries,
    artifacts,
    transitions,
  ] = await Promise.all([
    store.listSources(projectId),
    store.listSourceIntakeReports(projectId),
    store.listImpactManifests(projectId),
    store.listUnderstandingInputSnapshots(projectId),
    store.getActiveUnderstanding(projectId),
    store.listUnderstandingSnapshots(projectId),
    store.listDecisions(projectId),
    store.getLatestReadinessContract(projectId),
    store.listCompilations(projectId),
    store.listApprovals(projectId),
    store.listExecutions(projectId),
    store.listVerifications(projectId),
    store.listOperations(projectId),
    store.listDeliveries(projectId),
    store.listArtifactVersions(projectId),
    store.listTransitions(projectId),
  ]);
  const evidence = (
    await Promise.all(executions.map(execution => store.listEvidence(execution.id)))
  ).flat();
  return {
    project,
    sources,
    reports,
    impacts,
    understandingInputs,
    knowledge,
    knowledgeSnapshots,
    decisions,
    readiness,
    compilations,
    approvals,
    executions,
    verifications,
    operations,
    deliveries,
    artifacts,
    transitions,
    evidence,
  };
}

function descriptor(input: {
  id: string;
  resourceType: System3ResourceType;
  activityId: System3LifecycleActivityId;
  relation: System3ResourceRelation;
  title: string;
  summary: string;
  status?: System3ResourceStatus;
  version?: number | null;
  createdAt?: string | null;
  mediaType?: string;
  schemaVersion?: string | null;
  operationId?: string | null;
  workflowRunId?: string | null;
  sourceVersionIds?: string[];
  parentResourceIds?: string[];
  staleReason?: string | null;
  hasDownload?: boolean;
}): System3ResourceDescriptor {
  return {
    id: input.id,
    resourceType: input.resourceType,
    activityId: input.activityId,
    relation: input.relation,
    title: input.title,
    summary: input.summary,
    status: input.status ?? 'current',
    version: input.version ?? null,
    createdAt: input.createdAt ?? null,
    mediaType: input.mediaType ?? 'application/json',
    schemaVersion: input.schemaVersion ?? '1',
    producer: {
      operationId: input.operationId ?? null,
      workflowRunId: input.workflowRunId ?? null,
      workflowNodeId: null,
    },
    sourceVersionIds: input.sourceVersionIds ?? [],
    parentResourceIds: input.parentResourceIds ?? [],
    staleReason: input.staleReason ?? null,
    hasPresentation: true,
    hasDownload: input.hasDownload ?? true,
  };
}

function artifactDescriptor(
  artifact: System3ArtifactVersionRecord,
  activityId: System3LifecycleActivityId,
  relation: System3ResourceRelation
): System3ResourceDescriptor {
  return descriptor({
    id: artifact.id,
    resourceType:
      artifact.artifactKind === 'understanding_report'
        ? 'understanding_report'
        : 'execution_artifact',
    activityId,
    relation,
    title: artifact.displayName ?? 'Kết quả thực thi',
    summary: artifact.summary ?? 'Kết quả bất biến do System 3 tạo ra.',
    status: artifact.status ?? 'current',
    version: artifact.version,
    createdAt: artifact.createdAt,
    mediaType: artifact.mediaType ?? 'application/octet-stream',
    schemaVersion: artifact.schemaVersion,
    operationId: artifact.operationId,
    workflowRunId: artifact.workflowRunId,
    sourceVersionIds: artifact.sourceVersionIds,
    parentResourceIds: artifact.parentResourceIds,
    staleReason: artifact.staleReason,
  });
}

function orderedImpacts(context: ResourceContext): ResourceContext['impacts'] {
  const sources = new Map(context.sources.map(source => [source.id, source]));
  return [...context.impacts].sort((left, right) => {
    const leftSource = sources.get(left.sourceVersionId);
    const rightSource = sources.get(right.sourceVersionId);
    const sourceCreatedAt = (rightSource?.createdAt ?? '').localeCompare(
      leftSource?.createdAt ?? ''
    );
    if (sourceCreatedAt !== 0) return sourceCreatedAt;
    const sourceVersion = (rightSource?.version ?? 0) - (leftSource?.version ?? 0);
    if (sourceVersion !== 0) return sourceVersion;
    const impactCreatedAt = right.createdAt.localeCompare(left.createdAt);
    if (impactCreatedAt !== 0) return impactCreatedAt;
    const schemaVersion = right.schemaVersion - left.schemaVersion;
    if (schemaVersion !== 0) return schemaVersion;
    return right.id.localeCompare(left.id);
  });
}

function activityResources(
  context: ResourceContext,
  activityId: System3LifecycleActivityId
): {
  inputs: System3ResourceDescriptor[];
  outputs: System3ResourceDescriptor[];
  evidence: System3ResourceDescriptor[];
  technicalResources: System3ResourceDescriptor[];
} {
  const inputs: System3ResourceDescriptor[] = [];
  const outputs: System3ResourceDescriptor[] = [];
  const evidence: System3ResourceDescriptor[] = [];
  const technicalResources: System3ResourceDescriptor[] = [];
  const latestImpact = orderedImpacts(context)[0] ?? null;
  const currentReadiness =
    context.readiness?.knowledgeSnapshotId === context.knowledge?.id &&
    context.project.freshness === 'current'
      ? context.readiness
      : null;
  for (const source of context.sources) {
    const isCurrent =
      context.sources.find(value => value.sourceId === source.sourceId)?.id === source.id;
    const sourceResource = descriptor({
      id: source.id,
      resourceType: 'source_version',
      activityId,
      relation: activityId === 'OP-00' ? 'output' : 'input',
      title: source.originalFilename,
      summary: `${source.kind} · ${source.role === 'primary' ? 'nguồn chính' : 'nguồn bổ sung'}`,
      status: isCurrent ? 'current' : 'superseded',
      version: source.version,
      createdAt: source.createdAt,
      mediaType: source.mediaType,
      schemaVersion: null,
      operationId: source.operationId,
      sourceVersionIds: [source.id],
    });
    if (activityId === 'OP-00') outputs.push(sourceResource);
    if (
      activityId === 'OP-01' &&
      latestImpact !== null &&
      (source.id === latestImpact.sourceVersionId ||
        source.id === latestImpact.previousSourceVersionId)
    ) {
      inputs.push({
        ...sourceResource,
        summary:
          source.id === latestImpact.sourceVersionId
            ? 'Phiên bản nguồn đang được kiểm tra.'
            : 'Phiên bản nguồn trước được dùng để so sánh.',
      });
    }
    if (activityId === 'TW-02') inputs.push(sourceResource);
  }
  if (activityId === 'OP-00') {
    for (const [index, report] of context.reports.entries()) {
      outputs.push(
        descriptor({
          id: report.id,
          resourceType: 'source_intake_report',
          activityId,
          relation: 'output',
          title: `Báo cáo tiếp nhận · ${report.report.originalFilename}`,
          summary: 'Kết quả kiểm tra định dạng, lưu trữ và phát hiện thay đổi.',
          status:
            index > 0 ? 'superseded' : report.report.outcome === 'rejected' ? 'failed' : 'current',
          createdAt: report.createdAt,
          operationId: report.operationId,
          sourceVersionIds: report.sourceVersionId === null ? [] : [report.sourceVersionId],
        })
      );
    }
  }
  if (activityId === 'OP-01') {
    if (latestImpact !== null) {
      if (latestImpact.manifest?.basis.dependencyGraphHash !== undefined) {
        technicalResources.push(
          descriptor({
            id: latestImpact.id,
            resourceType: 'dependency_graph_snapshot',
            activityId,
            relation: 'input',
            title: 'Thông tin quan hệ dùng khi kiểm tra',
            summary: 'Số quan hệ, mức độ đầy đủ và đường ảnh hưởng tại thời điểm OP-01 chạy.',
            schemaVersion: latestImpact.manifest.basis.dependencyGraphVersion,
            operationId: latestImpact.operationId,
            createdAt: latestImpact.createdAt,
            sourceVersionIds: [latestImpact.sourceVersionId],
          })
        );
      }
      outputs.push(
        descriptor({
          id: latestImpact.id,
          resourceType: 'impact_manifest',
          activityId,
          relation: 'output',
          title: 'Báo cáo ảnh hưởng hiện tại',
          summary: latestImpact.reason,
          schemaVersion: latestImpact.schemaVersion.toString(),
          operationId: latestImpact.operationId,
          createdAt: latestImpact.createdAt,
          sourceVersionIds: [latestImpact.sourceVersionId],
        })
      );
    }
  }
  if (activityId === 'TW-02') {
    for (const snapshot of context.understandingInputs) {
      inputs.push(
        descriptor({
          id: snapshot.id,
          resourceType: 'input_snapshot',
          activityId,
          relation: 'input',
          title: 'Input Snapshot của lần Hiểu dự án',
          summary: `${snapshot.sourceIds.length.toString()} phiên bản nguồn đã được khóa trước khi chạy.`,
          status: snapshot.knowledgeSnapshotId === context.knowledge?.id ? 'current' : 'superseded',
          createdAt: snapshot.createdAt,
          workflowRunId: snapshot.workflowRunId,
          operationId: snapshot.operationId,
          sourceVersionIds: snapshot.sourceIds,
        })
      );
    }
    for (const knowledge of context.knowledgeSnapshots) {
      const isActive = knowledge.lifecycleStatus === 'active';
      outputs.push(
        descriptor({
          id: knowledge.id,
          resourceType: 'knowledge_snapshot',
          activityId,
          relation: 'output',
          title: 'Bản hiểu dự án',
          summary: 'Mục tiêu, yêu cầu, dữ liệu và vấn đề được trích xuất từ nguồn đã khóa.',
          status:
            knowledge.lifecycleStatus === 'candidate'
              ? 'candidate'
              : knowledge.lifecycleStatus === 'stale'
                ? 'stale'
                : isActive
                  ? context.project.freshness === 'current'
                    ? 'current'
                    : 'stale'
                  : 'superseded',
          createdAt: knowledge.createdAt,
          workflowRunId: knowledge.workflowRunId,
          staleReason:
            isActive && context.project.freshness !== 'current'
              ? 'Nguồn liên quan đã thay đổi.'
              : null,
        })
      );
    }
    for (const artifact of context.artifacts.filter(
      value => value.artifactKind === 'understanding_report'
    )) {
      const resource = artifactDescriptor(artifact, activityId, 'output');
      if (artifact.visibility === 'technical') technicalResources.push(resource);
      else outputs.push(resource);
    }
    for (const decision of context.decisions.filter(
      value => value.knowledgeSnapshotId === context.knowledge?.id
    )) {
      const isCurrent = decision.knowledgeSnapshotId === context.knowledge?.id;
      outputs.push(
        descriptor({
          id: decision.id,
          resourceType: 'decision',
          activityId,
          relation: 'output',
          title: decision.title,
          summary: friendlyDecisionQuestion(decision.question),
          status: isCurrent
            ? decision.status === 'answered'
              ? 'current'
              : 'pending'
            : 'superseded',
          createdAt: decision.createdAt,
          parentResourceIds: [decision.knowledgeSnapshotId],
        })
      );
    }
  }
  if (activityId === 'TW-03') {
    if (context.knowledge !== null) {
      inputs.push(
        descriptor({
          id: context.knowledge.id,
          resourceType: 'knowledge_snapshot',
          activityId,
          relation: 'input',
          title: 'Bản hiểu dự án đang dùng',
          summary: 'Knowledge Snapshot được dùng để kiểm tra mức độ sẵn sàng.',
          createdAt: context.knowledge.createdAt,
          workflowRunId: context.knowledge.workflowRunId,
        })
      );
    }
    for (const decision of context.decisions.filter(
      value => value.knowledgeSnapshotId === context.knowledge?.id
    )) {
      inputs.push(
        descriptor({
          id: decision.id,
          resourceType: 'decision',
          activityId,
          relation: 'input',
          title: decision.title,
          summary: decision.answer ?? 'Chưa có câu trả lời.',
          status: decision.status === 'answered' ? 'current' : 'pending',
          createdAt: decision.updatedAt,
        })
      );
    }
    if (currentReadiness !== null) {
      outputs.push(
        descriptor({
          id: currentReadiness.id,
          resourceType: 'readiness_contract',
          activityId,
          relation: 'output',
          title: 'Readiness Contract',
          summary: 'Kết quả kiểm tra các điều kiện phải đạt trước khi compile.',
          status: 'current',
          createdAt: currentReadiness.createdAt,
          workflowRunId: currentReadiness.workflowRunId,
          parentResourceIds: [currentReadiness.knowledgeSnapshotId],
        })
      );
    }
  }
  const latestCompilation = context.compilations[0];
  if (activityId === 'OP-04') {
    if (currentReadiness !== null) {
      inputs.push(
        descriptor({
          id: currentReadiness.id,
          resourceType: 'readiness_contract',
          activityId,
          relation: 'input',
          title: 'Readiness Contract được dùng',
          summary: 'Bản kiểm tra sẵn sàng làm cơ sở cho kế hoạch.',
          createdAt: currentReadiness.createdAt,
        })
      );
    }
    for (const [index, compilation] of context.compilations.entries()) {
      outputs.push(
        descriptor({
          id: compilation.id,
          resourceType: 'execution_plan',
          activityId,
          relation: 'output',
          title: 'Execution Plan',
          summary: 'Kế hoạch kỹ thuật đã khóa workflow, input, capability và runtime.',
          status:
            index === 0
              ? context.project.freshness === 'current'
                ? 'current'
                : 'stale'
              : 'superseded',
          createdAt: compilation.createdAt,
          parentResourceIds: [compilation.knowledgeSnapshotId],
        })
      );
    }
  }
  const latestApproval = context.approvals[0];
  if (activityId === 'OP-05') {
    if (latestCompilation !== undefined) {
      inputs.push(
        descriptor({
          id: latestCompilation.id,
          resourceType: 'execution_plan',
          activityId,
          relation: 'input',
          title: 'Execution Plan cần phê duyệt',
          summary: 'Kế hoạch chính xác được đưa ra để người dùng review.',
          createdAt: latestCompilation.createdAt,
        })
      );
    }
    for (const [index, approval] of context.approvals.entries()) {
      outputs.push(
        descriptor({
          id: approval.id,
          resourceType: 'approval_manifest',
          activityId,
          relation: 'output',
          title: 'Approval Manifest',
          summary: 'Bản ghi bất biến về kế hoạch và quyền đã được phê duyệt.',
          status:
            index === 0
              ? context.project.freshness === 'current'
                ? 'current'
                : 'stale'
              : 'superseded',
          createdAt: approval.createdAt,
          parentResourceIds: [approval.compilationId],
        })
      );
    }
  }
  const baselineArtifacts = context.artifacts.filter(
    value => value.artifactKind === 'baseline_package'
  );
  if (activityId === 'TW-06') {
    if (latestApproval !== undefined) {
      inputs.push(
        descriptor({
          id: latestApproval.id,
          resourceType: 'approval_manifest',
          activityId,
          relation: 'input',
          title: 'Approval Manifest đang dùng',
          summary: 'Chỉ kế hoạch đã được phê duyệt mới được thực thi.',
          createdAt: latestApproval.createdAt,
        })
      );
    }
    outputs.push(
      ...baselineArtifacts.map(value => artifactDescriptor(value, activityId, 'output'))
    );
    for (const [index, execution] of context.executions.entries()) {
      outputs.push(
        descriptor({
          id: execution.workflowRunId,
          resourceType: 'workflow_run',
          activityId,
          relation: 'output',
          title: 'Lần chạy thực thi',
          summary: 'Workflow Run chứa node, event, log và các file kỹ thuật.',
          status:
            index > 0
              ? 'superseded'
              : execution.status === 'failed'
                ? 'failed'
                : execution.status === 'completed'
                  ? 'current'
                  : 'pending',
          createdAt: execution.createdAt,
          workflowRunId: execution.workflowRunId,
          hasDownload: false,
        })
      );
    }
  }
  const latestVerification = context.verifications[0];
  if (activityId === 'TW-07') {
    inputs.push(...baselineArtifacts.map(value => artifactDescriptor(value, activityId, 'input')));
    for (const [index, verification] of context.verifications.entries()) {
      outputs.push(
        descriptor({
          id: verification.id,
          resourceType: 'verification_report',
          activityId,
          relation: 'output',
          title: 'Báo cáo xác minh',
          summary: 'Kết luận độc lập trên immutable execution artifact.',
          status:
            index > 0
              ? 'superseded'
              : verification.status === 'failed'
                ? 'failed'
                : verification.status === 'completed'
                  ? 'current'
                  : 'pending',
          createdAt: verification.createdAt,
          workflowRunId: verification.workflowRunId,
          parentResourceIds: [verification.inputArtifactId],
        })
      );
      for (const item of context.evidence.filter(
        value => value.verificationId === verification.id
      )) {
        evidence.push(
          descriptor({
            id: item.id,
            resourceType: 'evidence',
            activityId,
            relation: 'evidence',
            title: item.requirementId ?? 'Bằng chứng kiểm tra runtime',
            summary: item.reason ?? (item.evidence.join(' · ') || 'Evidence đã được ghi nhận.'),
            status:
              index > 0
                ? 'superseded'
                : item.status === 'failed'
                  ? 'failed'
                  : item.status === 'passed'
                    ? 'current'
                    : 'pending',
            createdAt: item.createdAt,
            parentResourceIds: [verification.id],
          })
        );
      }
    }
  }
  const deliveryOperations = context.operations.filter(value => value.type === 'delivery');
  const deliveryOperation = deliveryOperations[0];
  if (activityId === 'OP-08') {
    if (latestVerification !== undefined) {
      inputs.push(
        descriptor({
          id: latestVerification.id,
          resourceType: 'verification_report',
          activityId,
          relation: 'input',
          title: 'Verification hiện hành',
          summary: 'Chỉ verification đã đạt mới được dùng để yêu cầu bàn giao.',
          createdAt: latestVerification.createdAt,
        })
      );
    }
    for (const [index, operation] of deliveryOperations.entries()) {
      outputs.push(
        descriptor({
          id: operation.id,
          resourceType: 'delivery_request',
          activityId,
          relation: 'output',
          title: 'Yêu cầu bàn giao',
          summary: 'Yêu cầu chủ động của người dùng sau khi gate được kiểm tra.',
          status:
            index > 0
              ? 'superseded'
              : operation.status === 'failed'
                ? 'failed'
                : operation.status === 'succeeded'
                  ? 'current'
                  : 'pending',
          createdAt: operation.createdAt,
          operationId: operation.id,
          workflowRunId: operation.workflowRunId,
        })
      );
    }
  }
  if (activityId === 'TW-09') {
    if (deliveryOperation !== undefined) {
      inputs.push(
        descriptor({
          id: deliveryOperation.id,
          resourceType: 'delivery_request',
          activityId,
          relation: 'input',
          title: 'Yêu cầu bàn giao đã chấp nhận',
          summary: 'Cơ sở để bắt đầu Technical Workflow tạo package.',
          createdAt: deliveryOperation.createdAt,
        })
      );
    }
    for (const [index, delivery] of context.deliveries.entries()) {
      const deliveryStatus: System3ResourceStatus = index === 0 ? 'current' : 'superseded';
      outputs.push(
        descriptor({
          id: delivery.id,
          resourceType: 'delivery_manifest',
          activityId,
          relation: 'output',
          title: 'Delivery Manifest',
          summary: 'Bản kê nguồn, kế hoạch, execution, verification và giới hạn.',
          status: deliveryStatus,
          createdAt: delivery.createdAt,
          parentResourceIds: delivery.verificationId === null ? [] : [delivery.verificationId],
        }),
        descriptor({
          id: delivery.id,
          resourceType: 'delivery_package',
          activityId,
          relation: 'output',
          title: delivery.packageFilename,
          summary: 'Gói bàn giao bất biến đã được tạo từ verification hiện hành.',
          status: deliveryStatus,
          createdAt: delivery.createdAt,
          mediaType: 'application/gzip',
          hasDownload: true,
        })
      );
    }
  }
  return { inputs, outputs, evidence, technicalResources };
}

function statusFor(resources: ReturnType<typeof activityResources>): string {
  const all = [...resources.inputs, ...resources.outputs, ...resources.evidence];
  if (all.some(value => value.status === 'failed')) return 'failed';
  if (all.some(value => value.status === 'stale')) return 'stale';
  if (resources.outputs.length > 0 || resources.evidence.length > 0) return 'completed';
  if (resources.inputs.length > 0) return 'ready';
  return 'not_started';
}

export async function getSystem3ActivityResourceView(
  store: System3Store,
  projectId: string,
  rawActivityId: string
): Promise<System3ActivityView | null> {
  const parsed = system3LifecycleActivityIdSchema.safeParse(rawActivityId);
  if (!parsed.success) return null;
  const context = await loadContext(store, projectId);
  if (context === null) return null;
  const resources = activityResources(context, parsed.data);
  const copy = ACTIVITY_COPY[parsed.data];
  const relevantKinds = new Set([
    parsed.data.startsWith('OP') ? parsed.data.slice(3).toLowerCase() : '',
    copy.title.toLowerCase(),
  ]);
  const impactHistory =
    parsed.data === 'OP-01'
      ? orderedImpacts(context)
          .slice(1)
          .map(impact => ({
            id: impact.id,
            title: `Báo cáo ảnh hưởng cũ · phiên bản ${impact.schemaVersion.toString()}`,
            detail: friendlyImpactText(impact.reason),
            status: 'đã thay thế',
            createdAt: impact.createdAt,
            resource: descriptor({
              id: impact.id,
              resourceType: 'impact_manifest',
              activityId: parsed.data,
              relation: 'output',
              title: `Báo cáo ảnh hưởng phiên bản ${impact.schemaVersion.toString()}`,
              summary: friendlyImpactText(impact.reason),
              status: 'superseded',
              schemaVersion: impact.schemaVersion.toString(),
              operationId: impact.operationId,
              createdAt: impact.createdAt,
              sourceVersionIds: [impact.sourceVersionId],
            }),
          }))
      : [];
  const history = [
    ...impactHistory,
    ...context.transitions
      .filter(item => item.entityType !== null || relevantKinds.has(item.reason.toLowerCase()))
      .slice(0, 20)
      .map(item => ({
        id: item.id,
        title: item.reason,
        detail: `${item.fromStage ?? 'khởi tạo'} → ${item.toStage}`,
        status: item.toAttention ?? 'none',
        createdAt: item.createdAt,
      })),
    ...context.operations
      .filter(operation => {
        const map: Partial<Record<System3LifecycleActivityId, string>> = {
          'OP-00': 'source_intake',
          'OP-01': 'change_detection',
          'TW-02': 'analyze',
          'TW-03': 'readiness',
          'OP-04': 'compile',
          'TW-06': 'execute',
          'TW-07': 'verify',
          'OP-08': 'delivery',
          'TW-09': 'delivery',
        };
        return map[parsed.data] === operation.type;
      })
      .map(operation => ({
        id: operation.id,
        title: `Operation ${operation.type}`,
        detail: operation.error ?? 'Operation được System 3 Control Plane ghi nhận.',
        status: operation.status,
        createdAt: operation.createdAt,
      })),
  ].sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''));
  return {
    activityId: parsed.data,
    executionKind: copy.executionKind,
    title: copy.title,
    description: copy.description,
    status: statusFor(resources),
    ...resources,
    history,
  };
}

function simpleValue(value: unknown): string {
  if (value === null || value === undefined) return 'Không có';
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `${value.length.toString()} mục`;
  if (typeof value === 'object') return `${Object.keys(value).length.toString()} trường`;
  return 'Không thể hiển thị';
}

function factsFromRecord(
  title: string | null,
  value: Readonly<Record<string, unknown>>,
  limit = 12
): System3PresentationBlock {
  return {
    kind: 'facts',
    title,
    items: Object.entries(value)
      .slice(0, limit)
      .map(([label, item]) => ({ label, value: simpleValue(item) })),
  };
}

function sameModelReport(
  left: ModelComparisonModelReport,
  right: ModelComparisonModelReport
): boolean {
  return (
    left.runId === right.runId &&
    left.model === right.model &&
    left.inputHash === right.inputHash &&
    left.promptHash === right.promptHash &&
    left.codeHash === right.codeHash &&
    left.outputHash === right.outputHash &&
    left.harnessHash === right.harnessHash &&
    left.status === right.status &&
    left.error === right.error &&
    left.usage.status === right.usage.status &&
    left.checks?.length === right.checks?.length &&
    (left.checks === null ||
      (right.checks !== null &&
        left.checks.every((check, index) => {
          const verified = right.checks?.[index];
          return (
            check.requirementId === verified?.requirementId &&
            check.passed === verified.passed &&
            check.detail === verified.detail
          );
        })))
  );
}

function comparisonText(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_COMPARISON_FILE_BYTES)
    throw new Error('Comparison file exceeds the preview limit');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Builds a bounded preview only from archive files pinned by completed verification evidence. */
export function buildModelComparisonArtifactBlocks(input: {
  archiveBytes: Uint8Array;
  artifactContentHash: string;
  verificationInputHash: string;
  verificationModels: readonly ModelComparisonModelReport[];
}): System3PresentationBlock[] {
  if (citationDigest(input.archiveBytes) !== input.artifactContentHash)
    throw new Error('Execution artifact content hash mismatch');
  const entries = new Map(
    validateProjectArchive(input.archiveBytes).map(entry => [entry.path, entry.bytes])
  );
  const manifestBytes = entries.get('comparison.json');
  if (manifestBytes === undefined) throw new Error('Comparison manifest is missing');
  const manifest = comparisonManifestSchema.parse(JSON.parse(comparisonText(manifestBytes)));
  const verifiedModels = input.verificationModels.map(report =>
    modelComparisonModelReportSchema.parse(report)
  );
  if (
    manifest.inputHash !== input.verificationInputHash ||
    manifest.reports.length !== verifiedModels.length ||
    !manifest.reports.every((report, index) => {
      const verified = verifiedModels[index];
      return (
        verified !== undefined &&
        report.inputHash === input.verificationInputHash &&
        sameModelReport(report, verified)
      );
    })
  ) {
    throw new Error('Comparison manifest does not match verified model evidence');
  }

  const blocks: System3PresentationBlock[] = [];
  for (const [index, report] of manifest.reports.entries()) {
    blocks.push(
      factsFromRecord('Model comparison', {
        model: report.model,
        status: report.status === 'completed' ? 'Hoàn tất' : 'Không hoàn tất',
      })
    );
    if (report.status === 'completed') {
      if (report.codeHash === null || report.outputHash === null)
        throw new Error('Completed model is missing code or output hashes');
      const solutionPath = `models/${String(index)}/solution.py`;
      const outputPath = `models/${String(index)}/candidate-output.json`;
      const codeBytes = entries.get(solutionPath);
      const outputBytes = entries.get(outputPath);
      if (codeBytes === undefined || outputBytes === undefined)
        throw new Error('Verified comparison files are missing');
      if (
        citationDigest(codeBytes) !== report.codeHash ||
        citationDigest(outputBytes) !== report.outputHash
      )
        throw new Error('Comparison code or output hash mismatch');
      const code = comparisonText(codeBytes);
      const outputValue: unknown = JSON.parse(comparisonText(outputBytes));
      if (
        outputValue === null ||
        typeof outputValue !== 'object' ||
        Array.isArray(outputValue) ||
        Object.keys(outputValue).length > 64
      ) {
        throw new Error('Candidate output is not a bounded JSON object');
      }
      const fence = '`'.repeat(
        Math.max(3, ...[...code.matchAll(/`+/gu)].map(match => match[0].length + 1))
      );
      const markdown = [
        `**Python solution · models/${String(index)}/solution.py**`,
        '',
        `${fence}python`,
        code,
        code.endsWith('\n') ? fence : `\n${fence}`,
      ].join('\n');
      blocks.push(
        {
          kind: 'table',
          title: `Model output · ${report.model}`,
          columns: ['Trường', 'Giá trị'],
          rows: Object.entries(outputValue as Record<string, unknown>).map(([key, value]) => [
            key,
            simpleValue(value),
          ]),
          truncated: false,
        },
        {
          kind: 'markdown',
          markdown,
        }
      );
    }
  }
  return blocks;
}

function friendlyImpactText(value: string): string {
  return value
    .replaceAll('Activity và Source Version basis', 'Bước tạo kết quả và phiên bản nguồn được dùng')
    .replaceAll('Understanding', 'bước Hiểu dự án')
    .replaceAll('uncertainty', 'điểm chưa chắc chắn')
    .replaceAll('downstream', 'các bước phía sau');
}

function technicalDownloadUrl(projectId: string, resource: System3ResourceDescriptor): string {
  return `/api/system3/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resource.resourceType)}/${encodeURIComponent(resource.id)}/content`;
}

export async function getSystem3ResourcePresentation(
  store: System3Store,
  projectId: string,
  resourceType: System3ResourceType,
  resourceId: string,
  readArtifact?: (storageKey: string) => Promise<Uint8Array>
): Promise<System3ResourcePresentation | null> {
  const context = await loadContext(store, projectId);
  if (context === null) return null;
  let found: System3ResourceDescriptor | undefined;
  for (const activityId of system3LifecycleActivityIdSchema.options) {
    const resources = activityResources(context, activityId);
    found = [...resources.inputs, ...resources.outputs, ...resources.evidence].find(
      value => value.resourceType === resourceType && value.id === resourceId
    );
    if (found !== undefined) break;
  }
  if (found === undefined) return null;
  const blocks: System3PresentationBlock[] = [];
  if (found.status === 'stale') {
    blocks.push({
      kind: 'callout',
      tone: 'warning',
      title: 'Kết quả cần cập nhật',
      body: found.staleReason ?? 'Nguồn liên quan đã thay đổi.',
    });
  }
  if (resourceType === 'source_version') {
    const source = context.sources.find(value => value.id === resourceId);
    if (source === undefined) return null;
    blocks.push(
      {
        kind: 'facts',
        title: 'Thông tin nguồn',
        items: [
          { label: 'Loại nguồn', value: source.kind },
          { label: 'Vai trò', value: source.role === 'primary' ? 'Nguồn chính' : 'Nguồn bổ sung' },
          { label: 'Phiên bản', value: source.version.toString() },
          { label: 'Định dạng', value: source.mediaType },
          { label: 'Dung lượng', value: `${source.sizeBytes.toLocaleString('vi-VN')} bytes` },
          { label: 'Nguồn gốc', value: source.origin },
        ],
      },
      {
        kind: 'checklist',
        title: 'Kiểm tra tiếp nhận',
        items: source.validationReport.checks.map(check => ({
          label: check.label,
          status: check.status,
          detail: check.message,
        })),
      }
    );
  } else if (resourceType === 'source_intake_report') {
    const report = context.reports.find(value => value.id === resourceId)?.report;
    if (report === undefined) return null;
    blocks.push(
      {
        kind: 'callout',
        tone: report.outcome === 'rejected' ? 'danger' : 'success',
        title: 'Kết quả tiếp nhận',
        body:
          report.outcome === 'unchanged'
            ? 'Nội dung giống phiên bản hiện tại nên Anvil không tạo bản sao mới.'
            : report.outcome === 'rejected'
              ? 'Nguồn bị từ chối và không trở thành Source Version sẵn sàng.'
              : 'Nguồn đã được kiểm tra và lưu thành phiên bản bất biến.',
      },
      factsFromRecord('Thông tin file', {
        filename: report.originalFilename,
        kind: report.kind,
        role: report.role,
        sizeBytes: report.sizeBytes,
        storageStatus: report.storageStatus,
        changeDetection: report.changeDetection.status,
      }),
      {
        kind: 'checklist',
        title: 'Các kiểm tra đã thực hiện',
        items: report.validationReport.checks.map(check => ({
          label: check.label,
          status: check.status,
          detail: check.message,
        })),
      }
    );
  } else if (resourceType === 'dependency_graph_snapshot') {
    const manifest = context.impacts.find(value => value.id === resourceId)?.manifest;
    if (manifest === undefined || manifest === null) return null;
    blocks.push(
      {
        kind: 'callout',
        tone: manifest.basis.dependencyCoverage === 'partial' ? 'warning' : 'success',
        title: 'Mức độ đầy đủ của quan hệ',
        body:
          manifest.basis.dependencyCoverage === 'partial'
            ? 'Một số kết quả cũ chưa ghi đủ nguồn gốc. Hệ thống đã mở rộng phạm vi kiểm tra để giữ an toàn.'
            : 'Các kết quả hiện tại đã ghi đủ phiên bản nguồn để lần theo quan hệ.',
      },
      factsFromRecord('Thông tin quan hệ', {
        'Số điểm': manifest.basis.dependencyNodeCount ?? 0,
        'Số quan hệ': manifest.basis.dependencyEdgeCount ?? 0,
        'Phiên bản cách kiểm tra': manifest.basis.dependencyGraphVersion,
      })
    );
  } else if (resourceType === 'impact_manifest') {
    const impact = context.impacts.find(value => value.id === resourceId);
    if (impact === undefined) return null;
    const manifest = impact.manifest;
    if (manifest === null) {
      blocks.push(
        {
          kind: 'callout',
          tone: 'warning',
          title: 'Báo cáo OP-01 phiên bản cũ',
          body: 'Báo cáo này chỉ xác định phạm vi rộng theo loại nguồn. Hãy chạy lại OP-01 để có so sánh chi tiết, không tạo provenance giả cho lịch sử cũ.',
        },
        {
          kind: 'checklist',
          title: 'Phần từng được đánh dấu cần cập nhật',
          items: impact.affectedPhases.map(phase => ({
            label: phase,
            status: 'warning',
            detail: impact.reason,
          })),
        }
      );
    } else {
      const activityLabels: Readonly<Record<string, string>> = {
        'TW-02': 'Hiểu dự án',
        'TW-03': 'Kiểm tra mức độ sẵn sàng',
        'OP-04': 'Chuẩn bị kế hoạch thực thi',
        'OP-05': 'Phê duyệt kế hoạch',
        'TW-06': 'Thực thi kế hoạch đã duyệt',
        'TW-07': 'Xác minh kết quả độc lập',
        'OP-08': 'Yêu cầu bàn giao',
        'TW-09': 'Tạo gói bàn giao',
      };
      const confidenceLabel = { high: 'Cao', medium: 'Trung bình', low: 'Thấp' }[
        manifest.confidence
      ];
      const analysisLabel = {
        deterministic: 'So sánh theo quy tắc',
        llm_assisted: 'Quy tắc có hỗ trợ phân loại',
        conservative_fallback: 'Mở rộng phạm vi để giữ an toàn',
        legacy_broad: 'Báo cáo lịch sử phạm vi rộng',
      }[manifest.analysisMode];
      const rerunLabel = {
        none: 'Không cần làm lại',
        scoped: 'Làm lại một phần',
        full: 'Làm lại đầy đủ',
      }[manifest.proposedRerun.mode];
      const executionLabel = {
        none: 'Không thực hiện',
        full: 'Toàn bộ',
        experiment: 'Phần dữ liệu và thử nghiệm',
        delivery: 'Phần bàn giao',
      }[manifest.proposedRerun.executableScope];
      const changeKindLabels: Readonly<Record<string, string>> = {
        first_source: 'Nguồn đầu tiên',
        formatting_only: 'Chỉ thay đổi trình bày',
        content: 'Nội dung',
        requirement: 'Yêu cầu',
        schema: 'Cấu trúc dữ liệu',
        row_only: 'Dòng dữ liệu',
        target: 'Mục tiêu dự đoán',
        runtime: 'Môi trường chạy',
        policy: 'Chính sách',
        delivery: 'Bàn giao',
        unknown: 'Chưa xác định',
      };
      const changeTypeLabels: Readonly<Record<string, string>> = {
        added: 'Đã thêm',
        modified: 'Đã sửa',
        removed: 'Đã xóa',
        unchanged: 'Không đổi',
      };
      const resourceTypeLabels: Readonly<Record<string, string>> = {
        knowledge_snapshot: 'Bản hiểu dự án',
        understanding_report: 'Báo cáo Hiểu dự án',
        readiness_contract: 'Kết quả kiểm tra sẵn sàng',
        execution_plan: 'Kế hoạch thực hiện',
        approval_manifest: 'Bản ghi phê duyệt',
        execution_artifact: 'Kết quả thực hiện',
        verification_report: 'Báo cáo xác minh',
        evidence: 'Bằng chứng',
        delivery_manifest: 'Bản kê bàn giao',
        delivery_package: 'Gói bàn giao',
      };
      const entityLabels: Readonly<Record<string, string>> = {
        business_goal: 'Mục tiêu nghiệp vụ',
        target_definition: 'Mục tiêu dự đoán',
        runtime: 'Môi trường chạy',
        modules: 'Các phần chức năng',
        manual_reviews: 'Các mục cần người dùng xem lại',
        dataset_rows: 'Các dòng dữ liệu',
        dataset_schema: 'Cấu trúc dữ liệu',
        source: 'Nguồn đầu vào',
        source_format: 'Cách trình bày nguồn',
      };
      blocks.push(
        {
          kind: 'callout',
          tone:
            manifest.proposedRerun.mode === 'none'
              ? 'success'
              : manifest.confidence === 'low'
                ? 'warning'
                : 'info',
          title:
            manifest.proposedRerun.mode === 'none'
              ? 'Không cần làm lại các bước phía sau'
              : 'Đã xác định vùng ảnh hưởng',
          body: friendlyImpactText(manifest.summary),
        },
        factsFromRecord('Kết luận', {
          'Mức chắc chắn': confidenceLabel,
          'Cách kiểm tra': analysisLabel,
          'Phạm vi đề xuất': rerunLabel,
          'Phạm vi thực hiện': executionLabel,
          'Có dùng hỗ trợ tự động': manifest.llmAssistance.used ? 'Có, chỉ để gợi ý' : 'Không',
        }),
        {
          kind: 'table',
          title: 'Nội dung đã thay đổi',
          columns: ['Loại', 'Thao tác', 'Mục', 'Kết luận', 'Độ chắc chắn'],
          rows: manifest.changes.map(change => [
            changeKindLabels[change.kind] ?? change.kind,
            changeTypeLabels[change.changeType] ?? change.changeType,
            entityLabels[change.entityKey ?? change.entityType] ??
              change.entityKey ??
              change.entityType,
            friendlyImpactText(change.summary),
            { high: 'Cao', medium: 'Trung bình', low: 'Thấp' }[change.confidence],
          ]),
          truncated: false,
        },
        {
          kind: 'table',
          title: 'So sánh nội dung cũ và mới',
          columns: ['Mục', 'Nội dung cũ', 'Nội dung mới'],
          rows: manifest.changes.map(change => [
            entityLabels[change.entityKey ?? change.entityType] ??
              change.entityKey ??
              change.entityType,
            change.previousValue ?? 'Không có hoặc báo cáo cũ chưa lưu',
            change.currentValue ?? 'Không có hoặc báo cáo cũ chưa lưu',
          ]),
          truncated: false,
        },
        {
          kind: 'checklist',
          title: 'Các bước cần đánh giá lại',
          items:
            manifest.affectedActivities.length === 0
              ? [
                  {
                    label: 'Không có bước phía sau cần làm lại',
                    status: 'passed',
                    detail: friendlyImpactText(manifest.proposedRerun.reason),
                  },
                ]
              : manifest.affectedActivities.map(activityId => ({
                  label: `${activityLabels[activityId] ?? activityId} · ${activityId}`,
                  status: 'warning' as const,
                  detail: friendlyImpactText(manifest.proposedRerun.reason),
                })),
        },
        {
          kind: 'checklist',
          title: 'Kết quả cần cập nhật',
          items:
            manifest.affectedResources.length === 0
              ? [
                  {
                    label: 'Chưa có kết quả cụ thể cần cập nhật',
                    status: 'passed',
                    detail:
                      manifest.affectedActivities.length > 0
                        ? 'Chưa có kết quả hiện tại ở các bước bị ảnh hưởng.'
                        : 'Nội dung chuẩn hóa không thay đổi.',
                  },
                ]
              : manifest.affectedResources.map(resource => ({
                  label: `${activityLabels[resource.activityId] ?? resource.activityId} · ${resourceTypeLabels[resource.resourceType] ?? 'Kết quả'}`,
                  status: 'warning' as const,
                  detail: friendlyImpactText(resource.reason),
                })),
        },
        {
          kind: 'checklist',
          title: 'Kết quả có thể giữ lại',
          items:
            manifest.reusableResources.length === 0
              ? [
                  {
                    label: 'Chưa có kết quả nào được chứng minh có thể giữ lại',
                    status: 'pending',
                    detail: null,
                  },
                ]
              : manifest.reusableResources.map(resource => ({
                  label: `${activityLabels[resource.activityId] ?? resource.activityId} · ${resourceTypeLabels[resource.resourceType] ?? 'Kết quả'}`,
                  status: 'passed' as const,
                  detail: friendlyImpactText(resource.reason),
                })),
        }
      );
      if (manifest.uncertainties.length > 0) {
        blocks.push({
          kind: 'callout',
          tone: 'warning',
          title: 'Điểm chưa xác định chắc chắn',
          body: friendlyImpactText(manifest.uncertainties.join(' ')),
        });
      }
    }
  } else if (resourceType === 'input_snapshot') {
    const snapshot = context.understandingInputs.find(value => value.id === resourceId);
    if (snapshot === undefined) return null;
    blocks.push(
      {
        kind: 'callout',
        tone: 'info',
        title: 'Input đã được khóa trước khi chạy',
        body: 'TW-02 chỉ đọc những Source Version nằm trong snapshot này.',
      },
      factsFromRecord('Bộ xử lý', {
        parserVersion: snapshot.parserVersion,
        extractionPolicyVersion: snapshot.extractionPolicyVersion,
        runtimeProfile: snapshot.runtimeProfile,
      }),
      {
        kind: 'table',
        title: 'Nguồn đã pin',
        columns: ['Source Version', 'Mã nội dung rút gọn'],
        rows: snapshot.sourceIds.map((id, index) => [
          id,
          snapshot.sourceHashes[index]?.slice(0, 20) ?? 'Không có',
        ]),
        truncated: false,
      }
    );
  } else if (resourceType === 'knowledge_snapshot') {
    const knowledge = context.knowledgeSnapshots.find(value => value.id === resourceId);
    if (knowledge === undefined) return null;
    const analysis = knowledge.analysis;
    blocks.push(
      {
        kind: 'callout',
        tone: 'info',
        title: 'Anvil hiểu project như sau',
        body: analysis.businessGoal ?? 'Blueprint chưa cung cấp mục tiêu kinh doanh rõ ràng.',
      },
      {
        kind: 'facts',
        title: 'Tổng quan',
        items: [
          { label: 'Mục tiêu kỹ thuật', value: analysis.technicalObjective ?? 'Chưa xác định' },
          { label: 'Target', value: analysis.targetDefinition ?? 'Chưa xác định' },
          { label: 'Số yêu cầu', value: analysis.requirements.length.toString() },
          {
            label: 'Dataset thật',
            value: analysis.dataset === null ? 'Chưa liên kết/kiểm tra' : 'Đã profile',
          },
        ],
      },
      {
        kind: 'table',
        title: 'Yêu cầu',
        columns: ['Mã', 'Nội dung', 'Tiêu chí chấp nhận'],
        rows: analysis.requirements
          .slice(0, 50)
          .map(item => [item.id, item.statement, item.acceptanceCriterion]),
        truncated: analysis.requirements.length > 50,
      },
      {
        kind: 'checklist',
        title: 'Vấn đề cần người dùng xác nhận',
        items: analysis.manualReviews.map(item => ({
          label: item.text,
          status: 'pending',
          detail: item.sourcePointer,
        })),
      }
    );
    blocks.push(
      await buildMarkdownRequirementCitationBlock({
        analysis,
        sources: context.sources,
        readSource: async source => {
          if (readArtifact === undefined) throw new Error('Source reader is unavailable');
          return readArtifact(source.storageKey);
        },
      })
    );
  } else if (resourceType === 'understanding_report') {
    const artifact = context.artifacts.find(
      value => value.id === resourceId && value.artifactKind === 'understanding_report'
    );
    if (artifact === undefined) return null;
    if (artifact.mediaType === 'text/markdown' && readArtifact) {
      const bytes = await readArtifact(artifact.artifactKey);
      blocks.push({ kind: 'markdown', markdown: new TextDecoder('utf-8').decode(bytes) });
    } else {
      blocks.push({
        kind: 'callout',
        tone: 'info',
        title: 'Dữ liệu kỹ thuật của báo cáo',
        body: 'Mở phần tải xuống để xem dữ liệu máy đọc; bản Markdown thân thiện được hiển thị ở danh sách kết quả.',
      });
    }
    const knowledge =
      artifact.knowledgeSnapshotId === null
        ? undefined
        : context.knowledgeSnapshots.find(value => value.id === artifact.knowledgeSnapshotId);
    if (knowledge !== undefined) {
      blocks.push(
        await buildMarkdownRequirementCitationBlock({
          analysis: knowledge.analysis,
          sources: context.sources,
          readSource: async source => {
            if (readArtifact === undefined) throw new Error('Source reader is unavailable');
            return readArtifact(source.storageKey);
          },
        })
      );
    }
  } else if (resourceType === 'decision') {
    const decision = context.decisions.find(value => value.id === resourceId);
    if (decision === undefined) return null;
    blocks.push(
      {
        kind: 'callout',
        tone: decision.status === 'answered' ? 'success' : 'warning',
        title: decision.title,
        body: friendlyDecisionQuestion(decision.question),
      },
      factsFromRecord('Vì sao cần quyết định', {
        reason: decision.why,
        recommendation: decision.recommendation,
        answer: decision.answer,
      }),
      {
        kind: 'checklist',
        title: 'Các lựa chọn',
        items: decision.options.map(option => ({
          label: option,
          status: decision.answer === option ? 'passed' : 'pending',
          detail: null,
        })),
      }
    );
  } else if (resourceType === 'readiness_contract') {
    const readiness = context.readiness;
    if (readiness?.id !== resourceId) return null;
    blocks.push(
      {
        kind: 'callout',
        tone: 'info',
        title: 'Kết quả kiểm tra sẵn sàng',
        body: 'Các gate bên dưới được tính bằng quy tắc xác định trước.',
      },
      factsFromRecord('Readiness Contract', readiness.contract)
    );
  } else if (resourceType === 'execution_plan') {
    const compilation = context.compilations.find(value => value.id === resourceId);
    if (compilation === undefined) return null;
    const phases = Array.isArray(compilation.plan.phases) ? compilation.plan.phases : [];
    blocks.push(
      {
        kind: 'callout',
        tone: 'info',
        title: 'Kế hoạch chưa đồng nghĩa với phê duyệt',
        body: 'Execution Plan chỉ được chạy sau khi có Approval Manifest còn hiệu lực.',
      },
      {
        kind: 'facts',
        title: 'Basis đã khóa',
        items: [
          { label: 'Compiler', value: simpleValue(compilation.plan.compilerVersion) },
          {
            label: 'Product Workflow Version',
            value: simpleValue(compilation.plan.productWorkflowVersionId),
          },
          { label: 'Input Snapshot', value: simpleValue(compilation.plan.inputSnapshotId) },
          { label: 'Số phase kỹ thuật', value: phases.length.toString() },
        ],
      },
      {
        kind: 'table',
        title: 'Thứ tự thực thi',
        columns: ['Phase', 'Technical Workflow', 'Quyền'],
        rows: phases.map(value => {
          const row =
            value !== null && typeof value === 'object' && !Array.isArray(value)
              ? (value as Record<string, unknown>)
              : {};
          return [
            simpleValue(row.phaseId),
            simpleValue(row.workflow),
            Array.isArray(row.permissions) ? row.permissions.join(', ') : 'Không có',
          ];
        }),
        truncated: false,
      }
    );
  } else if (resourceType === 'approval_manifest') {
    const approval = context.approvals.find(value => value.id === resourceId);
    if (approval === undefined) return null;
    blocks.push(
      {
        kind: 'callout',
        tone: 'success',
        title: 'Kế hoạch đã được phê duyệt',
        body: 'Approval chỉ áp dụng cho đúng manifest và basis bên dưới.',
      },
      factsFromRecord('Approval Manifest', approval.manifest)
    );
  } else if (resourceType === 'execution_artifact') {
    const artifact = context.artifacts.find(value => value.id === resourceId);
    if (artifact === undefined) return null;
    blocks.push(
      factsFromRecord('Thông tin gói kết quả', {
        kind: artifact.artifactKind,
        version: artifact.version,
        sizeBytes: artifact.sizeBytes,
        status: artifact.status ?? 'current',
      }),
      {
        kind: 'download',
        label: 'Tải gói kết quả bất biến',
        filename: found.title,
        sizeBytes: artifact.sizeBytes,
      }
    );
    const verification =
      artifact.executionId === null
        ? undefined
        : context.verifications.find(value => value.executionId === artifact.executionId);
    const comparisonEvidence = verification?.evidenceMap;
    if (verification !== undefined && comparisonEvidence?.kind === 'model_comparison') {
      try {
        if (readArtifact === undefined) throw new Error('Artifact reader is unavailable');
        const reports = z
          .array(modelComparisonModelReportSchema)
          .min(2)
          .max(4)
          .parse(comparisonEvidence.models);
        const inputHash = z
          .string()
          .regex(/^sha256:[a-f0-9]{64}$/)
          .parse(comparisonEvidence.inputHash);
        const archiveBytes = await readArtifact(artifact.artifactKey);
        blocks.unshift(
          ...buildModelComparisonArtifactBlocks({
            archiveBytes,
            artifactContentHash: artifact.contentHash,
            verificationInputHash: inputHash,
            verificationModels: reports,
          })
        );
      } catch {
        blocks.push({
          kind: 'callout',
          tone: 'warning',
          title: 'Không thể xác minh bản xem trước',
          body: 'Code và output không khớp bằng chứng xác minh. Artifact bất biến vẫn có thể tải xuống để kiểm tra.',
        });
      }
    }
  } else if (resourceType === 'verification_report') {
    const verification = context.verifications.find(value => value.id === resourceId);
    if (verification === undefined) return null;
    blocks.push(
      {
        kind: 'callout',
        tone:
          verification.status === 'completed'
            ? 'success'
            : verification.status === 'failed'
              ? 'danger'
              : 'info',
        title: 'Kết luận xác minh',
        body: verification.error ?? `Trạng thái: ${verification.status}`,
      },
      factsFromRecord('Verification basis', {
        validatorVersion: verification.validatorVersion,
        basisHash: verification.basisHash.slice(0, 20),
        gate: verification.gate,
      })
    );
  } else if (resourceType === 'evidence') {
    const item = context.evidence.find(value => value.id === resourceId);
    if (item === undefined) return null;
    blocks.push({
      kind: 'evidence',
      title: 'Bằng chứng đã ghi nhận',
      items: [
        {
          requirement: item.requirementId ?? 'Kiểm tra runtime',
          status: item.status,
          proof: item.evidence,
          reason: item.reason,
        },
      ],
    });
  } else if (resourceType === 'delivery_request') {
    const operation = context.operations.find(
      value => value.id === resourceId && value.type === 'delivery'
    );
    if (operation === undefined) return null;
    blocks.push(
      {
        kind: 'callout',
        tone: operation.status === 'failed' ? 'danger' : 'info',
        title: 'Yêu cầu bàn giao',
        body: operation.error ?? 'Yêu cầu đã được System 3 Control Plane ghi nhận.',
      },
      factsFromRecord('Trạng thái xử lý', {
        status: operation.status,
        projectVersion: operation.projectVersion,
        createdAt: operation.createdAt,
      })
    );
  } else if (resourceType === 'delivery_manifest' || resourceType === 'delivery_package') {
    const delivery = context.deliveries.find(value => value.id === resourceId);
    if (delivery === undefined) return null;
    if (resourceType === 'delivery_manifest') {
      blocks.push(
        {
          kind: 'callout',
          tone: 'success',
          title: 'Gói bàn giao đã được tạo',
          body: 'Manifest này truy ngược package về execution và verification đã dùng.',
        },
        factsFromRecord('Delivery Manifest', delivery.manifest)
      );
    } else {
      blocks.push(
        factsFromRecord('Thông tin package', {
          filename: delivery.packageFilename,
          sizeBytes: delivery.sizeBytes,
          createdAt: delivery.createdAt,
        }),
        {
          kind: 'download',
          label: 'Tải package',
          filename: delivery.packageFilename,
          sizeBytes: delivery.sizeBytes,
        }
      );
    }
  } else if (resourceType === 'workflow_run') {
    blocks.push({
      kind: 'callout',
      tone: 'info',
      title: 'Lần chạy kỹ thuật',
      body: 'Node, event, log và file kỹ thuật nằm trong Technical Console. Project truth vẫn thuộc System 3 Control Plane.',
    });
  }
  return {
    resource: found,
    rendererVersion: RENDERER_VERSION,
    title: found.title,
    summary: found.summary,
    blocks,
    technicalDetailsAvailable: true,
    downloadUrl: found.hasDownload ? technicalDownloadUrl(projectId, found) : null,
  };
}

export async function getSystem3ResourceRawValue(
  store: System3Store,
  projectId: string,
  resourceType: System3ResourceType,
  resourceId: string
): Promise<unknown> {
  const context = await loadContext(store, projectId);
  if (context === null) return null;
  if (resourceType === 'source_intake_report')
    return context.reports.find(value => value.id === resourceId)?.report ?? null;
  if (resourceType === 'impact_manifest')
    return context.impacts.find(value => value.id === resourceId) ?? null;
  if (resourceType === 'dependency_graph_snapshot') {
    const manifest = context.impacts.find(value => value.id === resourceId)?.manifest;
    return manifest === null || manifest === undefined
      ? null
      : {
          version: manifest.basis.dependencyGraphVersion,
          hash: manifest.basis.dependencyGraphHash ?? null,
          nodeCount: manifest.basis.dependencyNodeCount ?? 0,
          edgeCount: manifest.basis.dependencyEdgeCount ?? 0,
          coverage: manifest.basis.dependencyCoverage ?? 'partial',
          usedPaths: manifest.affectedResources.map(resource => resource.dependencyPath),
        };
  }
  if (resourceType === 'input_snapshot')
    return context.understandingInputs.find(value => value.id === resourceId) ?? null;
  if (resourceType === 'knowledge_snapshot') {
    return context.knowledgeSnapshots.find(value => value.id === resourceId) ?? null;
  }
  if (resourceType === 'understanding_report') {
    return (
      context.artifacts.find(
        value => value.id === resourceId && value.artifactKind === 'understanding_report'
      ) ?? null
    );
  }
  if (resourceType === 'decision')
    return context.decisions.find(value => value.id === resourceId) ?? null;
  if (resourceType === 'readiness_contract')
    return context.readiness?.id === resourceId ? context.readiness : null;
  if (resourceType === 'execution_plan')
    return context.compilations.find(value => value.id === resourceId) ?? null;
  if (resourceType === 'approval_manifest')
    return context.approvals.find(value => value.id === resourceId) ?? null;
  if (resourceType === 'verification_report')
    return context.verifications.find(value => value.id === resourceId) ?? null;
  if (resourceType === 'evidence')
    return context.evidence.find(value => value.id === resourceId) ?? null;
  if (resourceType === 'delivery_request')
    return (
      context.operations.find(value => value.id === resourceId && value.type === 'delivery') ?? null
    );
  if (resourceType === 'delivery_manifest')
    return context.deliveries.find(value => value.id === resourceId)?.manifest ?? null;
  if (resourceType === 'workflow_run') return { workflowRunId: resourceId };
  return null;
}
