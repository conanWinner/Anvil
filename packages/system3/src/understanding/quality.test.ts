import { describe, expect, test } from 'bun:test';
import type { BlueprintExtractionResult } from './extractors';
import { evaluateUnderstandingQuality } from './quality';
import type {
  DatasetUnderstanding,
  ExtractionQuality,
  UnderstandingChapter,
  UnderstandingCoverageEntry,
  UnderstandingSourcePointer,
} from './schemas';

function sourcePointer(jsonPointer: string): UnderstandingSourcePointer {
  return {
    sourceVersionId: 'source-1',
    filename: 'blueprint.json',
    headingPath: [],
    startLine: null,
    endLine: null,
    jsonPointer,
    page: null,
    boundingBox: null,
    excerptHash: `sha256:${'0'.repeat(64)}`,
  };
}

const pointer = sourcePointer('/requirementsContract');

const chapters: readonly UnderstandingChapter[] = [
  'problem_profile',
  'requirements_contract',
  'high_level_pipeline',
  'technology_stack',
  'modular_design',
  'execution_blueprint',
];

function coverage(): UnderstandingCoverageEntry[] {
  return chapters.map(chapter => ({
    componentId: `source-1:${chapter}`,
    kind: 'paragraph',
    chapter,
    headingPath: [],
    status: 'extracted',
    reason: 'Đã trích xuất.',
    sourcePointer: pointer,
  }));
}

function datasetUnderstanding(): DatasetUnderstanding {
  return {
    availability: 'not_linked',
    declaration: null,
    profile: null,
    comparisonStatus: 'not_checked',
    issues: [],
  };
}

function extraction(): BlueprintExtractionResult {
  const pipelinePointer = sourcePointer('/highLevelPipeline/stages/0');
  const technologyPointer = sourcePointer('/technologyStack/selections/0');
  const modulePointer = sourcePointer('/modularDesign/modules/0');
  const executionPointer = sourcePointer('/executionBlueprint/items/0');
  return {
    businessGoal: 'Giảm churn',
    technicalObjective: null,
    targetDefinition: null,
    runtime: { cpuOnly: true, ramGb: 8 },
    requirements: [
      {
        id: 'FR-01',
        kind: 'FR',
        priority: null,
        source: null,
        statement: 'Dự đoán churn',
        acceptanceCriterion: 'Có dự đoán',
        sourcePointer: 'blueprint.json#/requirements/0',
        sourcePointers: [pointer],
      },
      {
        id: 'NFR-01',
        kind: 'NFR',
        priority: null,
        source: null,
        statement: 'Chạy CPU',
        acceptanceCriterion: 'Không dùng GPU',
        sourcePointer: 'blueprint.json#/requirements/1',
        sourcePointers: [pointer],
      },
    ],
    modules: ['DM-01'],
    manualReviews: [],
    problemProfile: {
      businessGoal: {
        value: 'Giảm churn',
        status: 'declared_unverified',
        sourcePointers: [pointer],
      },
      technicalObjective: null,
      successCriteria: [],
      constraints: [],
    },
    datasetDeclaration: null,
    pipeline: [
      {
        id: 'P-01',
        name: 'Chuẩn bị',
        inputs: [],
        outputs: [],
        requirementIds: ['FR-01'],
        sourcePointers: [pipelinePointer],
      },
    ],
    technologyStack: [
      {
        name: 'TypeScript',
        purpose: null,
        category: null,
        rationale: null,
        tradeoffs: [],
        requirementIds: ['NFR-01'],
        sourcePointers: [technologyPointer],
      },
    ],
    moduleDesign: [
      {
        id: 'DM-01',
        name: 'Chuẩn bị dữ liệu',
        responsibility: null,
        inputs: [],
        outputs: [],
        requirementIds: ['FR-01'],
        dependencies: [],
        sourcePointers: [modulePointer],
      },
    ],
    executionBlueprint: [
      {
        id: 'CB-01',
        kind: 'file',
        name: 'src/main.ts',
        parameters: [],
        returns: [],
        moduleIds: ['DM-01'],
        requirementIds: ['FR-01'],
        sourcePointers: [executionPointer],
      },
    ],
  };
}

function evaluate(input: BlueprintExtractionResult): ExtractionQuality {
  return evaluateUnderstandingQuality({
    extraction: input,
    coverage: coverage(),
    datasetUnderstanding: datasetUnderstanding(),
  });
}

describe('evaluateUnderstandingQuality requirement references', () => {
  test('keeps valid references warning-free and produces deterministic issue IDs', () => {
    const input = extraction();
    const before = structuredClone(input);

    const first = evaluate(input);
    const second = evaluate(input);

    expect(first.issues.filter(issue => issue.kind === 'invalid_reference')).toEqual([]);
    expect(
      first.issues.filter(issue => issue.title.includes('không có tham chiếu thiết kế'))
    ).toEqual([]);
    expect(first.issues.map(issue => issue.id)).toEqual(second.issues.map(issue => issue.id));
    const danglingInput = structuredClone(input);
    danglingInput.pipeline[0]?.requirementIds.push('FR-404');
    const danglingFirst = evaluate(danglingInput);
    const danglingSecond = evaluate(danglingInput);
    const danglingIds = danglingFirst.issues.map(issue => issue.id);
    expect(danglingIds).toEqual(danglingSecond.issues.map(issue => issue.id));
    expect(new Set(danglingIds).size).toBe(danglingIds.length);
    expect(input).toEqual(before);
  });

  test('reports dangling pipeline, technology, and execution references using their own provenance', () => {
    const input = extraction();
    input.pipeline[0]?.requirementIds.push('FR-404');
    input.technologyStack[0]?.requirementIds.push('NFR-404');
    input.executionBlueprint[0]?.requirementIds.push('DSR-404');
    input.executionBlueprint[0]?.moduleIds.push('DM-404');

    const quality = evaluate(input);
    const dangling = quality.issues.filter(issue => issue.kind === 'invalid_reference');

    expect(dangling).toHaveLength(4);
    expect(dangling.map(issue => issue.detail)).toEqual([
      'Không tìm thấy FR-404 trong Hợp đồng yêu cầu.',
      'Không tìm thấy NFR-404 trong Hợp đồng yêu cầu.',
      'Không tìm thấy DSR-404 trong Hợp đồng yêu cầu.',
      'Không tìm thấy DM-404 trong Thiết kế mô-đun.',
    ]);
    expect(dangling.every(issue => issue.severity === 'revision_required')).toBe(true);
    expect(quality.status).toBe('revision_required');
    expect(dangling.map(issue => issue.sourcePointers)).toEqual([
      input.pipeline[0]?.sourcePointers,
      input.technologyStack[0]?.sourcePointers,
      input.executionBlueprint[0]?.sourcePointers,
      input.executionBlueprint[0]?.sourcePointers,
    ]);
  });

  test('warns when a requirement has no explicit design reference without inventing one', () => {
    const input = extraction();
    input.pipeline[0]!.requirementIds = [];
    input.technologyStack[0]!.requirementIds = [];
    input.moduleDesign[0]!.requirementIds = [];
    input.executionBlueprint[0]!.requirementIds = [];

    const quality = evaluate(input);
    const uncovered = quality.issues.filter(issue =>
      issue.title.includes('không có tham chiếu thiết kế')
    );

    expect(uncovered).toHaveLength(2);
    expect(uncovered.map(issue => issue.severity)).toEqual(['warning', 'warning']);
    expect(quality.status).toBe('passed');
    expect(uncovered.map(issue => issue.sourcePointers)).toEqual([
      input.requirements[0]?.sourcePointers,
      input.requirements[1]?.sourcePointers,
    ]);
    expect(input.requirements.map(requirement => requirement.id)).toEqual(['FR-01', 'NFR-01']);
  });
});
