import { createHash } from 'node:crypto';
import type { BlueprintExtractionResult } from './extractors';
import type {
  DatasetUnderstanding,
  ExtractionQuality,
  UnderstandingChapter,
  UnderstandingCoverageEntry,
  UnderstandingIssue,
  UnderstandingSourcePointer,
} from './schemas';
import {
  UNDERSTANDING_EXTRACTION_POLICY_VERSION,
  UNDERSTANDING_HEADING_ALIAS_VERSION,
  UNDERSTANDING_MARKDOWN_PARSER_VERSION,
} from './document-index';

const requiredChapters: readonly UnderstandingChapter[] = [
  'problem_profile',
  'requirements_contract',
  'high_level_pipeline',
  'technology_stack',
  'modular_design',
  'execution_blueprint',
];

function issueId(kind: string, key: string): string {
  return `${kind}-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
}

function issue(input: Omit<UnderstandingIssue, 'id'> & { key: string }): UnderstandingIssue {
  return { id: issueId(input.kind, input.key), ...input };
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function evaluateUnderstandingQuality(input: {
  extraction: BlueprintExtractionResult;
  coverage: UnderstandingCoverageEntry[];
  datasetUnderstanding: DatasetUnderstanding;
  parserVersion?: string;
  additionalIssues?: readonly UnderstandingIssue[];
}): ExtractionQuality {
  const issues: UnderstandingIssue[] = [];
  const fallbackPointer: UnderstandingSourcePointer | null =
    input.coverage[0]?.sourcePointer ??
    input.extraction.problemProfile.businessGoal?.sourcePointers[0] ??
    null;
  const chapterSet = new Set(
    input.coverage
      .map(entry => entry.chapter)
      .filter((chapter): chapter is UnderstandingChapter => chapter !== null)
  );
  const missingChapters = requiredChapters.filter(chapter => !chapterSet.has(chapter));
  for (const chapter of missingChapters) {
    issues.push(
      issue({
        key: chapter,
        kind: 'missing_required_field',
        severity: 'revision_required',
        title: 'Thiếu chương System 2 bắt buộc',
        detail: `Không tìm thấy chương ${chapter}.`,
        requiresDecision: false,
        sourcePointers: fallbackPointer ? [fallbackPointer] : [],
      })
    );
  }
  if (input.extraction.businessGoal === null) {
    issues.push(
      issue({
        key: 'business-goal',
        kind: 'missing_required_field',
        severity: 'revision_required',
        title: 'Thiếu mục tiêu kinh doanh',
        detail: 'Blueprint chưa cung cấp mục tiêu kinh doanh rõ ràng.',
        requiresDecision: false,
        sourcePointers: fallbackPointer ? [fallbackPointer] : [],
      })
    );
  }
  if (input.extraction.requirements.length === 0) {
    issues.push(
      issue({
        key: 'requirements',
        kind: 'missing_required_field',
        severity: 'revision_required',
        title: 'Không có yêu cầu có cấu trúc',
        detail: 'Không tìm thấy yêu cầu FR, NFR hoặc DSR hợp lệ.',
        requiresDecision: false,
        sourcePointers: fallbackPointer ? [fallbackPointer] : [],
      })
    );
  }
  for (const requirement of input.extraction.requirements) {
    if (requirement.acceptanceCriterion.trim().length === 0) {
      issues.push(
        issue({
          key: `acceptance:${requirement.id}`,
          kind: 'missing_required_field',
          severity: 'revision_required',
          title: `Yêu cầu ${requirement.id} thiếu điều kiện nghiệm thu`,
          detail: 'Anvil không tự tạo điều kiện nghiệm thu thay cho nguồn.',
          requiresDecision: false,
          sourcePointers: requirement.sourcePointers,
        })
      );
    }
  }
  for (const id of duplicateValues(input.extraction.requirements.map(item => item.id))) {
    const sources = input.extraction.requirements
      .filter(item => item.id === id)
      .flatMap(item => item.sourcePointers);
    issues.push(
      issue({
        key: `requirement:${id}`,
        kind: 'duplicate_identifier',
        severity: 'revision_required',
        title: `Mã yêu cầu ${id} bị trùng`,
        detail: 'Mỗi mã yêu cầu phải xác định đúng một yêu cầu.',
        requiresDecision: false,
        sourcePointers: sources,
      })
    );
  }
  for (const id of duplicateValues(input.extraction.moduleDesign.map(item => item.id))) {
    const sources = input.extraction.moduleDesign
      .filter(item => item.id === id)
      .flatMap(item => item.sourcePointers);
    issues.push(
      issue({
        key: `module:${id}`,
        kind: 'duplicate_identifier',
        severity: 'revision_required',
        title: `Mã mô-đun ${id} bị trùng`,
        detail: 'Mỗi mã mô-đun phải xác định đúng một mô-đun.',
        requiresDecision: false,
        sourcePointers: sources,
      })
    );
  }
  const requirementIds = new Set(input.extraction.requirements.map(item => item.id));
  const moduleIds = new Set(input.extraction.moduleDesign.map(item => item.id));
  const explicitlyReferencedRequirementIds = new Set<string>();
  const checkRequirementReferences = (input: {
    ownerKey: string;
    ownerLabel: string;
    requirementIds: readonly string[];
    sourcePointers: UnderstandingSourcePointer[];
  }): void => {
    for (const requirementId of input.requirementIds) {
      if (requirementIds.has(requirementId)) {
        explicitlyReferencedRequirementIds.add(requirementId);
        continue;
      }
      issues.push(
        issue({
          key: `${input.ownerKey}:requirement:${requirementId}`,
          kind: 'invalid_reference',
          severity: 'revision_required',
          title: `${input.ownerLabel} trỏ tới yêu cầu không tồn tại`,
          detail: `Không tìm thấy ${requirementId} trong Hợp đồng yêu cầu.`,
          requiresDecision: false,
          sourcePointers: input.sourcePointers,
        })
      );
    }
  };
  for (const [index, module] of input.extraction.moduleDesign.entries()) {
    checkRequirementReferences({
      ownerKey: `module:${String(index)}:${module.id}`,
      ownerLabel: module.id,
      requirementIds: module.requirementIds,
      sourcePointers: module.sourcePointers,
    });
    for (const dependency of module.dependencies) {
      if (!moduleIds.has(dependency)) {
        issues.push(
          issue({
            key: `module:${String(index)}:${module.id}:dependency:${dependency}`,
            kind: 'invalid_reference',
            severity: 'revision_required',
            title: `${module.id} trỏ tới mô-đun không tồn tại`,
            detail: `Không tìm thấy ${dependency} trong Thiết kế mô-đun.`,
            requiresDecision: false,
            sourcePointers: module.sourcePointers,
          })
        );
      }
    }
  }
  for (const [index, stage] of input.extraction.pipeline.entries()) {
    checkRequirementReferences({
      ownerKey: `pipeline:${String(index)}:${stage.id}`,
      ownerLabel: `Giai đoạn ${stage.id}`,
      requirementIds: stage.requirementIds,
      sourcePointers: stage.sourcePointers,
    });
  }
  for (const [index, selection] of input.extraction.technologyStack.entries()) {
    checkRequirementReferences({
      ownerKey: `technology:${String(index)}:${selection.name}`,
      ownerLabel: `Công nghệ ${selection.name}`,
      requirementIds: selection.requirementIds,
      sourcePointers: selection.sourcePointers,
    });
  }
  for (const [index, item] of input.extraction.executionBlueprint.entries()) {
    const itemLabel = item.id ?? item.name;
    checkRequirementReferences({
      ownerKey: `execution:${String(index)}:${itemLabel}`,
      ownerLabel: `Mục triển khai ${itemLabel}`,
      requirementIds: item.requirementIds,
      sourcePointers: item.sourcePointers,
    });
    for (const moduleId of item.moduleIds) {
      if (moduleIds.has(moduleId)) continue;
      issues.push(
        issue({
          key: `execution:${String(index)}:${itemLabel}:module:${moduleId}`,
          kind: 'invalid_reference',
          severity: 'revision_required',
          title: `Mục triển khai ${itemLabel} trỏ tới mô-đun không tồn tại`,
          detail: `Không tìm thấy ${moduleId} trong Thiết kế mô-đun.`,
          requiresDecision: false,
          sourcePointers: item.sourcePointers,
        })
      );
    }
  }
  for (const requirement of input.extraction.requirements) {
    if (explicitlyReferencedRequirementIds.has(requirement.id)) continue;
    issues.push(
      issue({
        key: `uncovered-requirement:${requirement.id}`,
        kind: 'missing_required_field',
        severity: 'warning',
        title: `Yêu cầu ${requirement.id} không có tham chiếu thiết kế`,
        detail:
          'Không có Pipeline, lựa chọn công nghệ, mô-đun hoặc mục triển khai nào tham chiếu rõ ràng đến yêu cầu này. Anvil không tự suy đoán ánh xạ.',
        requiresDecision: false,
        sourcePointers: requirement.sourcePointers,
      })
    );
  }
  for (const review of input.extraction.manualReviews) {
    issues.push(
      issue({
        key: review.id,
        kind: 'manual_review',
        severity: 'warning',
        title: 'Cần người dùng xác nhận',
        detail: review.text,
        requiresDecision: true,
        sourcePointers: review.sourcePointers,
      })
    );
  }
  issues.push(...input.datasetUnderstanding.issues, ...(input.additionalIssues ?? []));
  for (const entry of input.coverage) {
    if (entry.status === 'unsupported') {
      issues.push(
        issue({
          key: entry.componentId,
          kind: 'unsupported_content',
          severity: 'revision_required',
          title: 'Có nội dung chưa được hỗ trợ',
          detail: entry.reason,
          requiresDecision: false,
          sourcePointers: [entry.sourcePointer],
        })
      );
    } else if (entry.status === 'unclassified') {
      issues.push(
        issue({
          key: entry.componentId,
          kind: 'unclassified_content',
          severity: 'revision_required',
          title: 'Có nội dung chưa phân loại',
          detail: entry.reason,
          requiresDecision: false,
          sourcePointers: [entry.sourcePointer],
        })
      );
    }
  }
  const status: ExtractionQuality['status'] = issues.some(item => item.severity === 'blocking')
    ? 'blocked'
    : issues.some(item => item.severity === 'revision_required')
      ? 'revision_required'
      : issues.some(item => item.requiresDecision)
        ? 'decision_required'
        : 'passed';
  return {
    status,
    parserVersion: input.parserVersion ?? UNDERSTANDING_MARKDOWN_PARSER_VERSION,
    extractionPolicyVersion: UNDERSTANDING_EXTRACTION_POLICY_VERSION,
    headingAliasVersion: UNDERSTANDING_HEADING_ALIAS_VERSION,
    totalComponents: input.coverage.length,
    extractedComponents: input.coverage.filter(item => item.status === 'extracted').length,
    ignoredComponents: input.coverage.filter(item => item.status === 'ignored_with_reason').length,
    unsupportedComponents: input.coverage.filter(item => item.status === 'unsupported').length,
    unclassifiedComponents: input.coverage.filter(item => item.status === 'unclassified').length,
    missingChapters,
    issues,
    coverage: input.coverage,
  };
}
