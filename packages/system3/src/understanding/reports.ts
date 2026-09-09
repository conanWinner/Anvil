import type { BlueprintAnalysis } from '../contracts';
import type { UnderstandingReport } from './schemas';

function markdownTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const escape = (value: string): string => value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
  return [
    `| ${headers.map(escape).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(value => escape(value)).join(' | ')} |`),
  ].join('\n');
}

function sourceLabel(analysis: Extract<BlueprintAnalysis, { schemaVersion: 2 }>): string {
  const pointer = analysis.problemProfile.businessGoal?.sourcePointers[0];
  if (!pointer) return 'Chưa có vị trí nguồn';
  if (pointer.jsonPointer) return `${pointer.filename}#${pointer.jsonPointer}`;
  if (pointer.page) return `${pointer.filename}, trang ${String(pointer.page)}`;
  return `${pointer.filename}:${String(pointer.startLine ?? 1)}`;
}

export function createUnderstandingReports(input: {
  analysis: Extract<BlueprintAnalysis, { schemaVersion: 2 }>;
  previous: BlueprintAnalysis | null;
}): UnderstandingReport[] {
  const { analysis } = input;
  const reports: UnderstandingReport[] = [];
  reports.push({
    id: 'project-overview',
    title: 'Tổng quan dự án',
    markdown: [
      '# Tổng quan dự án',
      '',
      `**Mục tiêu kinh doanh:** ${analysis.businessGoal ?? 'Chưa xác định'}`,
      '',
      `**Mục tiêu kỹ thuật:** ${analysis.technicalObjective ?? 'Chưa xác định'}`,
      '',
      `**Biến mục tiêu:** ${analysis.targetDefinition ?? 'Chưa xác định'}`,
      '',
      `**Môi trường:** ${analysis.runtime.cpuOnly ? 'Chỉ CPU' : 'Chưa xác định'}; RAM ${analysis.runtime.ramGb === null ? 'chưa xác định' : `${String(analysis.runtime.ramGb)} GB`}`,
      '',
      `**Nguồn chính:** ${sourceLabel(analysis)}`,
    ].join('\n'),
    data: {
      businessGoal: analysis.businessGoal,
      technicalObjective: analysis.technicalObjective,
      targetDefinition: analysis.targetDefinition,
      runtime: analysis.runtime,
    },
  });
  reports.push({
    id: 'requirements-report',
    title: 'Danh sách yêu cầu',
    markdown: [
      '# Danh sách yêu cầu',
      '',
      markdownTable(
        ['Mã', 'Loại', 'Ưu tiên', 'Yêu cầu', 'Điều kiện nghiệm thu', 'Nguồn'],
        analysis.requirements.map(requirement => [
          requirement.id,
          requirement.kind,
          requirement.priority ?? 'Chưa xác định',
          requirement.statement,
          requirement.acceptanceCriterion || 'Còn thiếu',
          requirement.sourcePointer,
        ])
      ),
    ].join('\n'),
    data: { requirements: analysis.requirements },
  });
  const declaration = analysis.datasetUnderstanding.declaration;
  const profile = analysis.datasetUnderstanding.profile;
  reports.push({
    id: 'dataset-understanding',
    title: 'Hiểu dữ liệu',
    markdown: [
      '# Hiểu dữ liệu',
      '',
      `**Trạng thái liên kết:** ${analysis.datasetUnderstanding.availability === 'linked' ? 'Đã liên kết Dataset' : analysis.datasetUnderstanding.availability === 'inaccessible' ? 'Không thể đọc Dataset' : 'Chưa liên kết Dataset'}`,
      '',
      `**Biến mục tiêu do System 2 khai báo:** ${declaration?.targetColumn ?? declaration?.targetDefinition ?? 'Chưa xác định'}`,
      '',
      `**Số dòng quan sát:** ${profile ? String(profile.rowCount) : 'Chưa kiểm tra'}`,
      '',
      `**Số cột quan sát:** ${profile ? String(profile.columnCount) : 'Chưa kiểm tra'}`,
      '',
      `**Đối chiếu:** ${analysis.datasetUnderstanding.comparisonStatus === 'matched' ? 'Khớp với mô tả' : analysis.datasetUnderstanding.comparisonStatus === 'mismatch' ? 'Có điểm không khớp' : 'Chưa kiểm tra'}`,
    ].join('\n'),
    data: { datasetUnderstanding: analysis.datasetUnderstanding },
  });
  if (profile) {
    reports.push({
      id: 'dataset-profile',
      title: 'Hồ sơ Dataset',
      markdown: [
        '# Hồ sơ Dataset',
        '',
        `Tệp: **${profile.filename}**`,
        '',
        `Số dòng trùng: **${String(profile.duplicateRowCount)}**`,
        '',
        markdownTable(
          ['Cột', 'Kiểu quan sát', 'Ô thiếu', 'Giá trị khác nhau'],
          profile.columns.map(column => [
            column.name,
            column.inferredType,
            String(column.missingCount),
            String(column.distinctCount),
          ])
        ),
      ].join('\n'),
      data: { profile },
    });
  }
  reports.push({
    id: 'open-issues-and-decisions',
    title: 'Vấn đề và quyết định',
    markdown: [
      '# Vấn đề và quyết định',
      '',
      ...(analysis.extractionQuality.issues.length === 0
        ? ['Không có vấn đề đang mở.']
        : analysis.extractionQuality.issues.map(
            item =>
              `- **${item.title}** — ${item.detail}${item.requiresDecision ? ' _(cần người dùng quyết định)_' : ''}`
          )),
    ].join('\n'),
    data: { issues: analysis.extractionQuality.issues },
  });
  const previousRequirements = new Set(input.previous?.requirements.map(item => item.id) ?? []);
  const currentRequirements = new Set(analysis.requirements.map(item => item.id));
  const added = [...currentRequirements].filter(id => !previousRequirements.has(id));
  const removed = [...previousRequirements].filter(id => !currentRequirements.has(id));
  reports.push({
    id: 'source-change-report',
    title: 'Thay đổi so với Bản hiểu trước',
    markdown: [
      '# Thay đổi so với Bản hiểu trước',
      '',
      input.previous === null
        ? 'Đây là Bản hiểu đầu tiên của dự án.'
        : `Yêu cầu mới: ${added.length === 0 ? 'không có' : added.join(', ')}. Yêu cầu bị bỏ: ${removed.length === 0 ? 'không có' : removed.join(', ')}.`,
    ].join('\n'),
    data: {
      hasPrevious: input.previous !== null,
      addedRequirementIds: added,
      removedRequirementIds: removed,
    },
  });
  const quality = analysis.extractionQuality;
  reports.push({
    id: 'extraction-quality-report',
    title: 'Chất lượng trích xuất',
    markdown: [
      '# Chất lượng trích xuất',
      '',
      `**Kết quả:** ${quality.status}`,
      '',
      markdownTable(
        ['Nhóm', 'Số lượng'],
        [
          ['Tổng thành phần', String(quality.totalComponents)],
          ['Đã trích xuất', String(quality.extractedComponents)],
          ['Đã bỏ qua có lý do', String(quality.ignoredComponents)],
          ['Không hỗ trợ', String(quality.unsupportedComponents)],
          ['Chưa phân loại', String(quality.unclassifiedComponents)],
        ]
      ),
      '',
      `Chương còn thiếu: ${quality.missingChapters.length === 0 ? 'không có' : quality.missingChapters.join(', ')}`,
    ].join('\n'),
    data: { quality },
  });
  return reports;
}
