import { createHash } from 'node:crypto';
import type { Nodes } from 'mdast';
import { toString } from 'mdast-util-to-string';
import type { System3ManualReviewV2, System3RequirementV2 } from '../../contracts';
import type { DatasetDeclaration, UnderstandingSourcePointer } from '../schemas';
import type {
  codeDesignItemSchema,
  moduleDesignSchema,
  pipelineStageSchema,
  problemProfileV2Schema,
  technologySelectionSchema,
} from '../schemas';
import type { z } from '@hono/zod-openapi';
import {
  markComponent,
  type UnderstandingDocumentComponent,
  type UnderstandingDocumentIndex,
} from '../document-index';

type ProblemProfile = z.infer<typeof problemProfileV2Schema>;
type PipelineStage = z.infer<typeof pipelineStageSchema>;
type TechnologySelection = z.infer<typeof technologySelectionSchema>;
type ModuleDesign = z.infer<typeof moduleDesignSchema>;
type CodeDesignItem = z.infer<typeof codeDesignItemSchema>;

export interface BlueprintExtractionResult {
  businessGoal: string | null;
  technicalObjective: string | null;
  targetDefinition: string | null;
  runtime: { cpuOnly: boolean; ramGb: number | null };
  requirements: System3RequirementV2[];
  modules: string[];
  manualReviews: System3ManualReviewV2[];
  problemProfile: ProblemProfile;
  datasetDeclaration: DatasetDeclaration | null;
  pipeline: PipelineStage[];
  technologyStack: TechnologySelection[];
  moduleDesign: ModuleDesign[];
  executionBlueprint: CodeDesignItem[];
}

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function classifyRootProblemHeading(value: string): boolean {
  const heading = normalized(value).replace(/^\d+\s+/u, '');
  return heading === 'problem profile' || heading === 'ho so van de';
}

function sourcePointerText(pointer: UnderstandingSourcePointer): string {
  return `${pointer.filename}:${String(pointer.startLine ?? 1)}`;
}

function markExtracted(component: UnderstandingDocumentComponent, reason: string): void {
  markComponent(component, 'extracted', reason);
}

function prepareChapter(components: readonly UnderstandingDocumentComponent[]): void {
  for (const component of components) {
    if (component.coverageStatus === 'unclassified') {
      markComponent(
        component,
        'ignored_with_reason',
        'Nội dung nằm trong chương đã nhận dạng nhưng không tạo trường dữ liệu riêng.'
      );
    }
  }
}

function boldField(
  components: readonly UnderstandingDocumentComponent[],
  labels: readonly string[]
): {
  value: string;
  pointer: UnderstandingSourcePointer;
  component: UnderstandingDocumentComponent;
} | null {
  const wanted = new Set(labels.map(normalized));
  for (const component of components) {
    for (const line of component.raw.split(/\r?\n/u)) {
      const match = /^\s*\*\*([^*]+):\*\*\s*(.+?)\s*$/u.exec(line);
      if (match?.[1] && match[2] && wanted.has(normalized(match[1]))) {
        return { value: match[2].trim(), pointer: component.sourcePointer, component };
      }
    }
  }
  return null;
}

function listItems(component: UnderstandingDocumentComponent): string[] {
  if (component.node.type !== 'list') return [];
  return component.node.children.map(item => toString(item).trim()).filter(Boolean);
}

function tableRows(component: UnderstandingDocumentComponent): string[][] {
  if (component.node.type !== 'table') return [];
  return component.node.children.map(row =>
    row.children.map(cell => toString(cell as Nodes).trim())
  );
}

function tableRecords(component: UnderstandingDocumentComponent): Record<string, string>[] {
  const rows = tableRows(component);
  const headers = (rows[0] ?? []).map(header => normalized(header).replace(/\s+/gu, '_'));
  return rows
    .slice(1)
    .map(row =>
      Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? '']))
    );
}

function identifierList(value: string, expression: RegExp): string[] {
  return [...new Set(value.match(expression) ?? [])];
}

function sourced(
  value: string,
  pointer: UnderstandingSourcePointer
): NonNullable<ProblemProfile['businessGoal']> {
  return { value, status: 'declared_unverified' as const, sourcePointers: [pointer] };
}

function extractProblemProfile(index: UnderstandingDocumentIndex): {
  profile: ProblemProfile;
  declaration: DatasetDeclaration | null;
  businessGoal: string | null;
  technicalObjective: string | null;
  targetDefinition: string | null;
  runtime: { cpuOnly: boolean; ramGb: number | null };
} {
  const components = index.chapters.problem_profile;
  prepareChapter(components);
  const business = boldField(components, ['Business Goal', 'Mục tiêu kinh doanh']);
  const technical = boldField(components, ['Technical Objective', 'Mục tiêu kỹ thuật']);
  if (business) markExtracted(business.component, 'Đã trích xuất mục tiêu kinh doanh.');
  if (technical) markExtracted(technical.component, 'Đã trích xuất mục tiêu kỹ thuật.');
  for (const component of components) {
    const currentHeading = component.headingPath.at(-1) ?? '';
    if (
      component.kind === 'paragraph' &&
      classifyRootProblemHeading(currentHeading) &&
      component !== business?.component &&
      component !== technical?.component
    ) {
      markComponent(component, 'unclassified', 'Đoạn mô tả chưa khớp trường dữ liệu có cấu trúc.');
    }
  }

  const successCriteria: ProblemProfile['successCriteria'] = [];
  const constraints: ProblemProfile['constraints'] = [];
  for (const component of components) {
    const path = normalized(component.headingPath.join(' / '));
    const items = listItems(component);
    if (path.includes('success criteria') || path.includes('tieu chi thanh cong')) {
      successCriteria.push(...items.map(value => sourced(value, component.sourcePointer)));
      if (items.length > 0) markExtracted(component, 'Đã trích xuất tiêu chí thành công.');
    }
    if (path.includes('constraint') || path.includes('rang buoc')) {
      constraints.push(...items.map(value => sourced(value, component.sourcePointer)));
      if (items.length > 0) markExtracted(component, 'Đã trích xuất ràng buộc.');
    }
  }

  const problemText = components.map(component => component.raw).join('\n');
  const targetMatch = /"target_definition"\s*:\s*"((?:\\.|[^"\\])*)"/u.exec(problemText);
  let targetDefinition: string | null = null;
  if (targetMatch?.[1]) {
    try {
      targetDefinition = JSON.parse(`"${targetMatch[1]}"`) as string;
    } catch {
      targetDefinition = targetMatch[1];
    }
  }
  const targetColumnMatch =
    /\b(?:target(?:\s+column)?|bien muc tieu)\s*[:=]\*{0,2}\s*[`'"]?([A-Za-z_][\w.-]*)/iu.exec(
      problemText
    );
  if (targetColumnMatch) {
    const targetComponent = components.find(component =>
      component.raw.includes(targetColumnMatch[0])
    );
    if (targetComponent) markExtracted(targetComponent, 'Đã trích xuất tên cột mục tiêu.');
  }
  const expectedColumnsMatch = /"expected_columns"\s*:\s*\[([^\]]*)\]/u.exec(problemText);
  const expectedColumns = expectedColumnsMatch?.[1]
    ? identifierList(expectedColumnsMatch[1], /[A-Za-z][A-Za-z0-9_]*/gu).slice(0, 200)
    : [];
  const declarationPointer =
    components.find(component =>
      normalized(component.headingPath.join(' ')).includes('data profile')
    )?.sourcePointer ?? components[0]?.sourcePointer;
  const declaration = declarationPointer
    ? {
        availability: 'declared_unverified' as const,
        unitOfAnalysis: problemText.includes('customer_unique_id') ? 'customer_unique_id' : null,
        targetColumn: targetColumnMatch?.[1] ?? null,
        targetDefinition,
        expectedColumns,
        constraints: constraints.map(item => item.value),
        sourcePointers: [declarationPointer],
      }
    : null;
  const ramMatch =
    /RAM\s*[≤<]?\s*(\d+)\s*GB/iu.exec(problemText) ?? /(\d+)\s*GB\s*RAM/iu.exec(problemText);

  return {
    profile: {
      businessGoal: business ? sourced(business.value, business.pointer) : null,
      technicalObjective: technical ? sourced(technical.value, technical.pointer) : null,
      successCriteria,
      constraints,
    },
    declaration,
    businessGoal: business?.value ?? null,
    technicalObjective: technical?.value ?? null,
    targetDefinition,
    runtime: {
      cpuOnly: /CPU-only|CPU only|không có GPU/iu.test(problemText),
      ramGb: ramMatch?.[1] ? Number.parseInt(ramMatch[1], 10) : null,
    },
  };
}

function extractRequirements(index: UnderstandingDocumentIndex): System3RequirementV2[] {
  const components = index.chapters.requirements_contract;
  prepareChapter(components);
  const requirements: System3RequirementV2[] = [];
  for (const component of components) {
    if (component.kind !== 'table') continue;
    const records = tableRecords(component);
    for (const record of records) {
      const id = record.id ?? '';
      if (!/^(?:FR|NFR|DSR)-\d+$/iu.test(id)) continue;
      const statement = record.requirement ?? record.yeu_cau ?? '';
      if (!statement) continue;
      requirements.push({
        id,
        kind: record.type || id.split('-')[0] || 'unknown',
        priority: record.priority || null,
        source: record.source || null,
        statement,
        acceptanceCriterion:
          record.acceptance_criteria ||
          record.acceptance_criterion ||
          record.dieu_kien_nghiem_thu ||
          '',
        sourcePointer: sourcePointerText(component.sourcePointer),
        sourcePointers: [component.sourcePointer],
      });
    }
    if (records.length > 0) markExtracted(component, 'Đã trích xuất bảng yêu cầu.');
  }
  return requirements;
}

function extractPipeline(index: UnderstandingDocumentIndex): PipelineStage[] {
  const components = index.chapters.high_level_pipeline;
  prepareChapter(components);
  const stages: PipelineStage[] = [];
  for (const component of components) {
    if (component.node.type !== 'heading' || component.node.depth < 3) continue;
    const match = /^(?:Phase|Giai đoạn)\s*([\w.-]+)\s*:\s*(.+)$/iu.exec(component.text);
    if (!match?.[1] || !match[2]) continue;
    stages.push({
      id: match[1],
      name: match[2].trim(),
      inputs: [],
      outputs: [],
      requirementIds: [],
      sourcePointers: [component.sourcePointer],
    });
    markExtracted(component, 'Đã trích xuất giai đoạn của quy trình cấp cao.');
  }
  return stages;
}

function extractTechnologyStack(index: UnderstandingDocumentIndex): TechnologySelection[] {
  const components = index.chapters.technology_stack;
  prepareChapter(components);
  const selections: TechnologySelection[] = [];
  for (const component of components) {
    if (component.kind !== 'table') continue;
    for (const record of tableRecords(component)) {
      const name = record.technology || record.tool || record.cong_nghe || Object.values(record)[0];
      if (!name) continue;
      const joined = Object.values(record).join(' ');
      selections.push({
        name,
        purpose: record.purpose || record.muc_dich || null,
        category: record.type || record.category || record.loai || null,
        rationale: record.rationale || record.reason || record.ly_do || null,
        tradeoffs: [],
        requirementIds: identifierList(joined, /\b(?:FR|NFR|DSR)-\d+\b/giu),
        sourcePointers: [component.sourcePointer],
      });
    }
    markExtracted(component, 'Đã trích xuất bảng lựa chọn công nghệ.');
  }
  return selections;
}

function fieldFromFollowing(
  components: readonly UnderstandingDocumentComponent[],
  start: number,
  label: string
): string | null {
  for (let index = start + 1; index < components.length; index += 1) {
    const component = components[index];
    if (!component) break;
    if (component.node.type === 'heading' && component.node.depth <= 3) break;
    const expression = new RegExp(`^\\s*[-*]\\s*\\*\\*${label}:\\*\\*\\s*(.+)$`, 'imu');
    const match = expression.exec(component.raw);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractModules(index: UnderstandingDocumentIndex): ModuleDesign[] {
  const components = index.chapters.modular_design;
  prepareChapter(components);
  const modules: ModuleDesign[] = [];
  for (let indexValue = 0; indexValue < components.length; indexValue += 1) {
    const component = components[indexValue];
    if (component?.node.type !== 'heading') continue;
    const match = /\b(DM-\d{2})\b\s*[—-]?\s*(.*)$/u.exec(component.text);
    if (!match?.[1]) continue;
    const block: UnderstandingDocumentComponent[] = [];
    for (let cursor = indexValue + 1; cursor < components.length; cursor += 1) {
      const next = components[cursor];
      if (!next) break;
      if (next.node.type === 'heading' && /\bDM-\d{2}\b/u.test(next.text)) break;
      block.push(next);
    }
    const raw = block.map(item => item.raw).join('\n');
    modules.push({
      id: match[1],
      name: match[2]?.trim() || match[1],
      responsibility: fieldFromFollowing(components, indexValue, 'Purpose'),
      inputs: (fieldFromFollowing(components, indexValue, 'Inputs') ?? '')
        .split(/,|;/u)
        .map(value => value.trim())
        .filter(Boolean),
      outputs: (fieldFromFollowing(components, indexValue, 'Outputs') ?? '')
        .split(/,|;/u)
        .map(value => value.trim())
        .filter(Boolean),
      requirementIds: identifierList(raw, /\b(?:FR|NFR|DSR)-\d+\b/giu),
      dependencies: identifierList(
        fieldFromFollowing(components, indexValue, 'Depends on') ?? '',
        /\bDM-\d{2}\b/gu
      ),
      sourcePointers: [component.sourcePointer],
    });
    markExtracted(component, 'Đã trích xuất mô-đun thiết kế.');
    for (const item of block) {
      if (item.coverageStatus === 'ignored_with_reason') {
        markExtracted(item, `Nội dung chi tiết của ${match[1]}.`);
      }
    }
  }
  return modules;
}

function extractExecutionBlueprint(index: UnderstandingDocumentIndex): CodeDesignItem[] {
  const components = index.chapters.execution_blueprint;
  prepareChapter(components);
  const items: CodeDesignItem[] = [];
  for (const component of components) {
    if (component.node.type !== 'heading') continue;
    const cb = /\b(CB-\d{2})\b\s*[—-]?\s*(.*)$/u.exec(component.text);
    const file = /^File:\s*`?([^`]+)`?$/iu.exec(component.text);
    const folder = /^Folder:\s*`?([^`]+)`?$/iu.exec(component.text);
    if (!cb && !file && !folder) continue;
    const name = cb?.[2]?.trim() || file?.[1]?.trim() || folder?.[1]?.trim() || component.text;
    items.push({
      id: cb?.[1] ?? null,
      kind: file ? 'file' : folder || name.endsWith('/') ? 'folder' : 'unknown',
      name,
      parameters: [],
      returns: [],
      moduleIds: identifierList(component.raw, /\bDM-\d{2}\b/gu),
      requirementIds: identifierList(component.raw, /\b(?:FR|NFR|DSR)-\d+\b/giu),
      sourcePointers: [component.sourcePointer],
    });
    markExtracted(component, 'Đã trích xuất cấu trúc triển khai.');
  }
  for (const component of components) {
    if (component.kind === 'code' && component.segments.length > 0) {
      markExtracted(component, 'Đã giữ nguyên khối cấu trúc hoặc cấu hình do System 2 khai báo.');
    }
  }
  return items;
}

function extractManualReviews(index: UnderstandingDocumentIndex): System3ManualReviewV2[] {
  const reviews: System3ManualReviewV2[] = [];
  for (const component of index.components) {
    if (
      !/\[Manual Review Required\]|\bTBD\b|chưa xác định|cần (?:người dùng )?xác nhận/iu.test(
        component.raw
      )
    ) {
      continue;
    }
    const relevantLines = component.raw
      .split(/\r?\n/u)
      .filter(line =>
        /\[Manual Review Required\]|\bTBD\b|chưa xác định|cần (?:người dùng )?xác nhận/iu.test(line)
      );
    for (const line of relevantLines) {
      const key = createHash('sha256').update(`${component.id}:${line}`).digest('hex').slice(0, 12);
      reviews.push({
        id: `manual-review-${key}`,
        text: line.trim(),
        sourcePointer: sourcePointerText(component.sourcePointer),
        sourcePointers: [component.sourcePointer],
      });
    }
    markExtracted(component, 'Đã ghi nhận dấu hiệu cần người dùng xem xét.');
  }
  return reviews;
}

export function extractBlueprintFromIndex(
  index: UnderstandingDocumentIndex
): BlueprintExtractionResult {
  const problem = extractProblemProfile(index);
  const requirements = extractRequirements(index);
  const moduleDesign = extractModules(index);
  return {
    businessGoal: problem.businessGoal,
    technicalObjective: problem.technicalObjective,
    targetDefinition: problem.targetDefinition,
    runtime: problem.runtime,
    requirements,
    modules: moduleDesign.map(module => module.id),
    manualReviews: extractManualReviews(index),
    problemProfile: problem.profile,
    datasetDeclaration: problem.declaration,
    pipeline: extractPipeline(index),
    technologyStack: extractTechnologyStack(index),
    moduleDesign,
    executionBlueprint: extractExecutionBlueprint(index),
  };
}
