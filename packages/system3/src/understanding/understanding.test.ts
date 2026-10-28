import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'bun:test';
import { profileDatasetCsvStream } from './dataset-profiler';
import { SYSTEM3_CSV_LIMITS } from '../csv-contract';
import { applyUnderstandingDecisionAnswers } from './decision-resolution';
import { parseUnderstandingMarkdown } from './document-index';
import {
  understandProjectSources,
  verifyPinnedUnderstandingSourceStream,
  type PinnedUnderstandingSource,
} from './index';
import { readSystem2BlueprintJson } from './system2-json-reader';
import { readUnderstandingPdf } from './pdf-layout-reader';
import { readSupplementalStructuredSource } from './supplemental-reader';

function simpleTextPdf(lines: readonly string[]): Uint8Array {
  const escaped = lines.map(line => line.replace(/([()\\])/gu, '\\$1'));
  const commands = [
    'BT',
    '/F1 12 Tf',
    '50 750 Td',
    ...escaped
      .flatMap((line, index) => [index === 0 ? '' : '0 -28 Td', `(${line}) Tj`])
      .filter(Boolean),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(commands).toString()} >>\nstream\n${commands}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map(offset => `${offset.toString().padStart(10, '0')} 00000 n \n`)
    .join('');
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${xrefOffset.toString()}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

function source(input: {
  filename: string;
  body: string | Uint8Array;
  kind?: PinnedUnderstandingSource['kind'];
  id?: string;
  mediaType?: string;
}): PinnedUnderstandingSource {
  const bytes = typeof input.body === 'string' ? new TextEncoder().encode(input.body) : input.body;
  return {
    id: input.id ?? 'source-1',
    kind: input.kind ?? 'blueprint',
    filename: input.filename,
    mediaType: input.mediaType ?? 'text/markdown',
    contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    bytes,
  };
}

describe('TW-02 structural understanding', () => {
  test('pinned model comparison suppresses only the target-column Decision', async () => {
    const blueprint = [
      '# Customer summary',
      '## 1. PROBLEM PROFILE',
      '**Business Goal:** Summarize customers by state.',
      '**Technical Objective:** Emit aggregate JSON.',
      '### Data Profile',
      '{"expected_columns":["customer_state","missing_column"]}',
      '## 2. REQUIREMENTS CONTRACT',
      '| ID | Type | Priority | Source | Requirement | Acceptance Criteria |',
      '| --- | --- | --- | --- | --- | --- |',
      '| FR-01 | FR | HIGH | sample | Aggregate by state. | Counts match CSV. |',
      '## 3. HIGH-LEVEL PIPELINE',
      'Read and aggregate rows. FR-01.',
      '## 4. SELECTED TECHNOLOGY STACK',
      '| Technology |',
      '| --- |',
      '| Python |',
      '## 5. MODULAR DESIGN PACKAGE',
      '### DM-01 — Aggregate rows',
      'Group rows by state. FR-01.',
      '## 6. EXECUTION BLUEPRINT',
      '#### File: `solution.py`',
      'Print JSON to stdout. FR-01.',
    ].join('\n');
    const dataset = source({
      id: 'dataset',
      kind: 'dataset',
      filename: 'customers.csv',
      mediaType: 'text/csv',
      body: 'customer_unique_id,order_count,customer_state\na,2,SP\n',
    });
    const blueprintSource = source({ filename: 'blueprint.md', body: blueprint });
    const modelComparison = {
      schemaVersion: 1 as const,
      models: ['router9/model-a', 'router9/model-b'],
      prompt: 'Summarize customers by state.',
      harness: 'print("checks")',
      requirementIds: ['FR-01'],
    };
    const baseline = await understandProjectSources({
      sources: [blueprintSource, dataset],
    });
    const comparison = await understandProjectSources({
      sources: [blueprintSource, dataset],
      modelComparison,
    });

    expect(
      baseline.analysis.extractionQuality.issues.some(
        issue => issue.decisionBinding?.kind === 'dataset_target_column'
      )
    ).toBe(true);
    expect(comparison.analysis.targetDefinition).toBeNull();
    expect(comparison.analysis.dataset?.targetColumn).toBeNull();
    expect(
      comparison.analysis.extractionQuality.issues.some(
        issue => issue.decisionBinding?.kind === 'dataset_target_column'
      )
    ).toBe(false);
    expect(comparison.analysis.datasetUnderstanding.issues.map(issue => issue.title)).toContain(
      'Dataset thiếu cột được System 2 mô tả'
    );
  });

  test('extracts all six canonical System 2 chapters with complete coverage', async () => {
    const bytes = new Uint8Array(
      await readFile(new URL('../../../../docs/system_2/DESIGN_B_2.md', import.meta.url))
    );
    let semanticCalls = 0;
    const result = await understandProjectSources({
      sources: [source({ filename: 'DESIGN_B_2.md', body: bytes })],
      semanticFallback: async () => {
        semanticCalls += 1;
        throw new Error('Không được gọi khi toàn bộ nội dung đã được phân loại');
      },
    });
    expect(result.analysis.schemaVersion).toBe(2);
    expect(result.analysis.requirements).toHaveLength(13);
    expect(result.analysis.pipeline).toHaveLength(6);
    expect(result.analysis.moduleDesign).toHaveLength(12);
    expect(result.analysis.executionBlueprint.length).toBeGreaterThan(50);
    expect(result.analysis.extractionQuality.missingChapters).toEqual([]);
    expect(result.analysis.extractionQuality.unclassifiedComponents).toBe(0);
    expect(result.analysis.extractionQuality.unsupportedComponents).toBe(0);
    expect(result.analysis.extractionQuality.status).toBe('decision_required');
    expect(semanticCalls).toBe(0);
    expect(result.reports.map(report => report.id)).toContain('extraction-quality-report');
    expect(result.reports.map(report => report.id)).not.toContain('dataset-profile');
  });

  test('keeps PART A and PART B inside execution blueprint instead of creating extra chapters', () => {
    const markdown = [
      '# Project',
      '## 6. EXECUTION BLUEPRINT',
      '## PART A: Codebase Structure',
      '```text',
      'src/',
      '```',
      '## PART B: Function-File Mapping',
      '#### File: `src/main.ts`',
    ].join('\n');
    const index = parseUnderstandingMarkdown({
      markdown,
      sourceVersionId: 'source-1',
      filename: 'blueprint.md',
    });
    const partHeadings = index.components.filter(component => component.text.startsWith('PART'));
    expect(partHeadings).toHaveLength(2);
    expect(partHeadings.every(component => component.chapter === 'execution_blueprint')).toBe(true);
  });

  test('rejects bytes that do not match the pinned content hash', async () => {
    const blueprint = source({ filename: 'blueprint.md', body: '# Changed' });
    blueprint.contentHash = `sha256:${'0'.repeat(64)}`;
    await expect(understandProjectSources({ sources: [blueprint] })).rejects.toThrow('Mã kiểm tra');
  });

  test('reads the versioned System 2 JSON contract with JSON pointers', () => {
    const result = readSystem2BlueprintJson({
      sourceVersionId: 'source-json',
      filename: 'blueprint.json',
      json: JSON.stringify({
        schemaVersion: 1,
        problemProfile: {
          businessGoal: 'Giảm khách hàng rời bỏ',
          technicalObjective: 'Dự đoán churn',
          successCriteria: ['Có báo cáo'],
          constraints: ['CPU only, RAM 8GB'],
          dataset: {
            unitOfAnalysis: 'customer_id',
            targetColumn: 'churn_status',
            targetDefinition: 'Khách hàng ngừng mua',
            expectedColumns: ['customer_id', 'churn_status'],
            constraints: [],
          },
        },
        requirementsContract: {
          requirements: [
            {
              id: 'FR-01',
              kind: 'FR',
              statement: 'Tạo dự đoán',
              acceptanceCriterion: 'Có kết quả cho mỗi khách hàng',
            },
          ],
        },
        highLevelPipeline: { stages: [{ id: '1', name: 'Chuẩn bị' }] },
        technologyStack: { selections: [{ name: 'TypeScript' }] },
        modularDesign: { modules: [{ id: 'DM-01', name: 'Chuẩn bị dữ liệu' }] },
        executionBlueprint: { items: [{ kind: 'file', name: 'src/main.ts' }] },
        manualReviews: [],
      }),
    });
    expect(result.extraction.requirements[0]?.sourcePointers[0]?.jsonPointer).toBe(
      '/requirementsContract/requirements/0'
    );
    expect(result.coverage).toHaveLength(6);
  });

  test('reads PDF layout and preserves page and bounding box pointers', async () => {
    const index = await readUnderstandingPdf({
      bytes: simpleTextPdf([
        '1. PROBLEM PROFILE',
        'Business goal details',
        '2. REQUIREMENTS CONTRACT',
        'Requirement details',
        '3. HIGH-LEVEL PIPELINE',
        'Pipeline details',
        '4. SELECTED TECHNOLOGY STACK',
        'Technology details',
        '5. MODULAR DESIGN PACKAGE',
        'Module details',
        '6. EXECUTION BLUEPRINT',
        'Code details',
      ]),
      sourceVersionId: 'pdf-source',
      filename: 'system-2.pdf',
    });
    expect(Object.values(index.chapters).every(chapter => chapter.length > 0)).toBe(true);
    expect(index.components[0]?.sourcePointer.page).toBe(1);
    expect(index.components[0]?.sourcePointer.boundingBox?.width).toBeGreaterThan(0);
    expect(index.components[1]?.sourcePointer.headingPath).toEqual(['1. PROBLEM PROFILE']);
    expect(index.components[3]?.sourcePointer.headingPath).toEqual(['2. REQUIREMENTS CONTRACT']);
  });

  test('does not treat readable PDF text as complete requirement extraction', async () => {
    const result = await understandProjectSources({
      sources: [
        source({
          id: 'pdf-source',
          filename: 'requirements.pdf',
          mediaType: 'application/pdf',
          body: simpleTextPdf([
            '1. PROBLEM PROFILE',
            'Business Goal: Predict churn',
            '2. REQUIREMENTS CONTRACT',
            'FR-01 Predict churn with an acceptance threshold',
            '3. HIGH-LEVEL PIPELINE',
            'Prepare dataset',
            '4. SELECTED TECHNOLOGY STACK',
            'Python',
            '5. MODULAR DESIGN PACKAGE',
            'DM-01 Model',
            '6. EXECUTION BLUEPRINT',
            'src/model.py',
          ]),
        }),
      ],
    });
    expect(result.analysis.requirements).toHaveLength(0);
    expect(result.analysis.extractionQuality.status).toBe('revision_required');
    expect(result.analysis.extractionQuality.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'missing_required_field',
          title: 'Không có yêu cầu có cấu trúc',
        }),
      ])
    );
    const unreadRequirement = result.analysis.extractionQuality.coverage.find(
      entry => entry.chapter === 'requirements_contract' && entry.kind === 'paragraph'
    );
    expect(unreadRequirement?.status).not.toBe('extracted');
    expect(unreadRequirement?.sourcePointer).toMatchObject({
      sourceVersionId: 'pdf-source',
      page: 1,
      headingPath: ['2. REQUIREMENTS CONTRACT'],
    });
  });

  test('reads supplemental JSON and YAML with exact structured pointers', () => {
    const jsonFacts = readSupplementalStructuredSource({
      text: JSON.stringify({ runtime: { ramGb: 8 }, target: 'churn_status' }),
      sourceVersionId: 'constraints-json',
      filename: 'constraints.json',
      mediaType: 'application/json',
    });
    const yamlFacts = readSupplementalStructuredSource({
      text: 'runtime:\n  ramGb: 8\ntarget: churn_status\n',
      sourceVersionId: 'constraints-yaml',
      filename: 'constraints.yaml',
      mediaType: 'application/yaml',
    });
    expect(jsonFacts.find(fact => fact.key === '/runtime/ramGb')?.sourcePointer.jsonPointer).toBe(
      '/runtime/ramGb'
    );
    expect(yamlFacts.find(fact => fact.key === '/target')?.value).toBe('churn_status');
  });

  test('merges typed data dictionary and constraint facts before profiling the Dataset', async () => {
    const blueprint = source({
      filename: 'blueprint.md',
      body: [
        '# Project',
        '## 1. PROBLEM PROFILE',
        '**Business Goal:** Giảm khách hàng rời bỏ',
        '**Technical Objective:** Dự đoán churn',
        '## 2. REQUIREMENTS CONTRACT',
        '| ID | Requirement | Acceptance Criteria |',
        '| --- | --- | --- |',
        '| FR-01 | Dự đoán churn | Có kết quả |',
        '## 3. HIGH-LEVEL PIPELINE',
        '### Phase 1: Chuẩn bị',
        '## 4. SELECTED TECHNOLOGY STACK',
        '| Technology | Purpose |',
        '| --- | --- |',
        '| TypeScript | Điều phối |',
        '## 5. MODULAR DESIGN PACKAGE',
        '### DM-01 — Chuẩn bị dữ liệu',
        '## 6. EXECUTION BLUEPRINT',
        '### File: `src/main.ts`',
      ].join('\n'),
    });
    const dictionary = source({
      id: 'dictionary-1',
      kind: 'data_dictionary',
      filename: 'dictionary.json',
      mediaType: 'application/json',
      body: JSON.stringify({
        target_column: 'churn_status',
        expected_columns: ['customer_id', 'churn_status'],
      }),
    });
    const constraints = source({
      id: 'constraints-1',
      kind: 'constraints',
      filename: 'constraints.yaml',
      mediaType: 'application/yaml',
      body: 'runtime:\n  ram_gb: 16\npolicy: no_network\ndelivery: tar_gz\n',
    });
    const dataset = source({
      id: 'dataset-1',
      kind: 'dataset',
      filename: 'customers.csv',
      mediaType: 'text/csv',
      body: 'customer_id,churn_status\n1,yes\n2,no\n',
    });
    const result = await understandProjectSources({
      sources: [blueprint, dictionary, constraints, dataset],
    });
    expect(result.analysis.datasetUnderstanding.declaration).toMatchObject({
      targetColumn: 'churn_status',
      expectedColumns: ['customer_id', 'churn_status'],
    });
    expect(result.analysis.datasetUnderstanding.profile).toMatchObject({
      targetColumn: 'churn_status',
      targetExists: true,
    });
    expect(result.analysis.runtime.ramGb).toBe(16);
    expect(result.analysis.problemProfile.constraints.map(item => item.value)).toEqual(
      expect.arrayContaining(['no_network', 'tar_gz'])
    );
  });

  test('compares the candidate with the supplied previous understanding', async () => {
    const first = await understandProjectSources({
      sources: [
        source({
          filename: 'first.md',
          body: [
            '# Project',
            '## 1. PROBLEM PROFILE',
            '**Business Goal:** Giảm churn',
            '## 2. REQUIREMENTS CONTRACT',
            '| ID | Requirement | Acceptance Criteria |',
            '| --- | --- | --- |',
            '| FR-01 | Dự đoán churn | Có kết quả |',
            '## 3. HIGH-LEVEL PIPELINE',
            '### Phase 1: Chuẩn bị',
            '## 4. SELECTED TECHNOLOGY STACK',
            '| Technology |',
            '| --- |',
            '| TypeScript |',
            '## 5. MODULAR DESIGN PACKAGE',
            '### DM-01 — Chuẩn bị',
            '## 6. EXECUTION BLUEPRINT',
            '### File: `src/main.ts`',
          ].join('\n'),
        }),
      ],
    });
    const second = await understandProjectSources({
      previousAnalysis: first.analysis,
      sources: [
        source({
          filename: 'second.md',
          body: [
            '# Project',
            '## 1. PROBLEM PROFILE',
            '**Business Goal:** Giảm churn',
            '## 2. REQUIREMENTS CONTRACT',
            '| ID | Requirement | Acceptance Criteria |',
            '| --- | --- | --- |',
            '| FR-02 | Dự đoán churn | Có kết quả |',
            '## 3. HIGH-LEVEL PIPELINE',
            '### Phase 1: Chuẩn bị',
            '## 4. SELECTED TECHNOLOGY STACK',
            '| Technology |',
            '| --- |',
            '| TypeScript |',
            '## 5. MODULAR DESIGN PACKAGE',
            '### DM-01 — Chuẩn bị',
            '## 6. EXECUTION BLUEPRINT',
            '### File: `src/main.ts`',
          ].join('\n'),
        }),
      ],
    });
    const report = second.reports.find(item => item.id === 'source-change-report');
    expect(report?.data).toMatchObject({
      hasPrevious: true,
      addedRequirementIds: ['FR-02'],
      removedRequirementIds: ['FR-01'],
    });
  });

  test('splits a large Markdown table by rows and repeats its header', () => {
    const rows = Array.from(
      { length: 2_000 },
      (_, index) => `| FR-${String(index)} | ${'x'.repeat(40)} |`
    );
    const index = parseUnderstandingMarkdown({
      sourceVersionId: 'large-table',
      filename: 'large.md',
      markdown: [
        '# Project',
        '## 2. REQUIREMENTS CONTRACT',
        '| ID | Requirement |',
        '| --- | --- |',
        ...rows,
      ].join('\n'),
    });
    const table = index.components.find(component => component.kind === 'table');
    expect(table?.segments.length).toBeGreaterThan(1);
    expect(
      table?.segments.every(segment => segment.startsWith('| ID | Requirement |\n| --- | --- |'))
    ).toBe(true);
    expect(table?.coverageStatus).toBe('unclassified');
  });

  test('applies a selected Dataset target column without mutating the pinned analysis', async () => {
    const result = await understandProjectSources({
      sources: [
        source({
          filename: 'blueprint.md',
          body: [
            '# Project',
            '## 1. PROBLEM PROFILE',
            '**Business Goal:** Giảm churn',
            '## 2. REQUIREMENTS CONTRACT',
            '| ID | Requirement | Acceptance Criteria |',
            '| --- | --- | --- |',
            '| FR-01 | Dự đoán churn | Có kết quả |',
            '## 3. HIGH-LEVEL PIPELINE',
            '### Phase 1: Chuẩn bị',
            '## 4. SELECTED TECHNOLOGY STACK',
            '| Technology |',
            '| --- |',
            '| TypeScript |',
            '## 5. MODULAR DESIGN PACKAGE',
            '### DM-01 — Chuẩn bị',
            '## 6. EXECUTION BLUEPRINT',
            '### File: `src/main.ts`',
          ].join('\n'),
        }),
        source({
          id: 'dataset',
          kind: 'dataset',
          filename: 'customers.csv',
          mediaType: 'text/csv',
          body: 'customer_id,churn_status\n1,yes\n2,no\n',
        }),
      ],
    });
    const binding = result.analysis.extractionQuality.issues.find(
      issue => issue.decisionBinding?.kind === 'dataset_target_column'
    )?.decisionBinding;
    if (!binding || binding.kind !== 'dataset_target_column')
      throw new Error('Missing target binding');
    expect(() =>
      applyUnderstandingDecisionAnswers(result.analysis, [
        { binding, status: 'answered', answer: 'churn_status' },
      ])
    ).toThrow('requires the pinned Dataset Source Version');
    const reprofiled = await profileDatasetCsvStream({
      filename: 'customers.csv',
      sourceVersionId: 'dataset',
      chunks: (async function* (): AsyncGenerator<Uint8Array> {
        yield new TextEncoder().encode('customer_id,churn_status\n1,yes\n2,no\n');
      })(),
      targetColumn: 'churn_status',
    });
    const resolved = applyUnderstandingDecisionAnswers(
      result.analysis,
      [{ binding, status: 'answered', answer: 'churn_status' }],
      reprofiled
    );
    if (resolved.schemaVersion !== 2) throw new Error('Expected v2 understanding analysis');
    expect(result.analysis.dataset?.targetColumn).toBeNull();
    expect(result.analysis.dataset?.targetDistribution).toEqual({});
    expect(resolved.dataset).toMatchObject({ targetColumn: 'churn_status', targetExists: true });
    expect(resolved.dataset?.targetDistribution).toEqual({ yes: 1, no: 1 });
    expect(resolved.datasetUnderstanding.profile?.targetDistribution).toEqual({ yes: 1, no: 1 });
    expect(resolved.datasetUnderstanding.declaration?.targetColumn).toBe('churn_status');
    expect(resolved.datasetUnderstanding.comparisonStatus).toBe('matched');
    expect(resolved.datasetUnderstanding.issues).toHaveLength(0);
    expect(() =>
      applyUnderstandingDecisionAnswers(
        result.analysis,
        [{ binding, status: 'answered', answer: 'churn_status' }],
        { ...reprofiled, sourceVersionId: 'another-dataset' }
      )
    ).toThrow('does not match');
    expect(() =>
      applyUnderstandingDecisionAnswers(
        result.analysis,
        [{ binding, status: 'answered', answer: 'churn_status' }],
        { ...reprofiled, rowFingerprint: 'sha256:different-rows' }
      )
    ).toThrow('does not match');
    reprofiled.targetDistribution.yes = 99;
    reprofiled.columns[0]!.name = 'mutated';
    expect(resolved.dataset?.targetDistribution).toEqual({ yes: 1, no: 1 });
    expect(resolved.datasetUnderstanding.profile?.columns[0]?.name).toBe('customer_id');
  });

  test('profiles CSV incrementally and uses the declared target column', async () => {
    const chunks = [
      new TextEncoder().encode('id,churn_status,note\n1,yes,"first'),
      new TextEncoder().encode(' line"\n1,yes,"first line"\n2,,ok\n'),
    ];
    const profile = await profileDatasetCsvStream({
      filename: 'customers.csv',
      sourceVersionId: 'dataset-1',
      chunks: (async function* (): AsyncGenerator<Uint8Array> {
        yield* chunks;
      })(),
      targetColumn: 'churn_status',
    });
    expect(profile.rowCount).toBe(3);
    expect(profile.targetExists).toBe(true);
    expect(profile.targetDistribution.yes).toBe(2);
    expect(profile.columns.find(column => column.name === 'churn_status')?.missingCount).toBe(1);
    expect(profile.duplicateRowCount).toBe(1);
    expect(profile.rowFingerprint).toStartWith('sha256:');
    expect(profile.limits?.maxRows).toBe(250_000);
  });

  test('preserves exact CSV headers and rejects duplicate or ragged records', async () => {
    const profile = await profileDatasetCsvStream({
      filename: 'quoted.csv',
      sourceVersionId: 'dataset-quoted',
      chunks: (async function* (): AsyncGenerator<Uint8Array> {
        yield new TextEncoder().encode(
          '\uFEFF"customer,id"," target ",note\n1," yes ","a\nline"\n'
        );
      })(),
      targetColumn: ' target ',
    });
    expect(profile.columns.map(column => column.name)).toEqual(['customer,id', ' target ', 'note']);
    expect(profile.targetDistribution).toEqual({ ' yes ': 1 });

    for (const body of ['id,target,target\n1,yes,no\n', 'id,target\n1\n']) {
      await expect(
        profileDatasetCsvStream({
          filename: 'invalid.csv',
          sourceVersionId: 'dataset-invalid',
          chunks: (async function* (): AsyncGenerator<Uint8Array> {
            yield new TextEncoder().encode(body);
          })(),
          targetColumn: 'target',
        })
      ).rejects.toThrow();
    }
  });

  test('fails with a classified limit before unbounded row tracking can exhaust memory', async () => {
    const body = new TextEncoder().encode(
      `value\n${'same\n'.repeat(SYSTEM3_CSV_LIMITS.maxRows + 1)}`
    );
    const rssBefore = process.memoryUsage.rss();
    let observedRss = rssBefore;
    const chunks = (async function* (): AsyncGenerator<Uint8Array> {
      for (let offset = 0; offset < body.byteLength; offset += 8192) {
        observedRss = Math.max(observedRss, process.memoryUsage.rss());
        yield body.subarray(offset, offset + 8192);
      }
    })();

    await expect(
      profileDatasetCsvStream({
        filename: 'over-row-limit.csv',
        sourceVersionId: 'dataset-over-row-limit',
        chunks,
        targetColumn: null,
      })
    ).rejects.toThrow(`vượt giới hạn ${SYSTEM3_CSV_LIMITS.maxRows.toString()} dòng`);
    expect(observedRss - rssBefore).toBeLessThan(256 * 1024 * 1024);
  });

  test('labels a high-cardinality column as a lower bound instead of failing', async () => {
    const rows = Array.from(
      { length: SYSTEM3_CSV_LIMITS.maxDistinctValuesPerColumn + 10 },
      (_, index) => `order-${index.toString()},${index % 2 === 0 ? 'yes' : 'no'}`
    );
    const profile = await profileDatasetCsvStream({
      filename: 'high-cardinality.csv',
      sourceVersionId: 'dataset-high-cardinality',
      chunks: (async function* (): AsyncGenerator<Uint8Array> {
        yield new TextEncoder().encode(`order_id,label\n${rows.join('\n')}\n`);
      })(),
      targetColumn: 'label',
    });
    const [orderId, label] = profile.columns;
    expect(profile.rowCount).toBe(rows.length);
    expect(orderId?.distinctCountCapped).toBe(true);
    expect(orderId?.distinctCount).toBe(SYSTEM3_CSV_LIMITS.maxDistinctValuesPerColumn);
    expect(label).toMatchObject({ distinctCount: 2, distinctCountCapped: false });
    expect(profile.targetDistribution).toEqual({ yes: 25_005, no: 25_005 });
  });

  test('caps columns once the total tracked distinct values reach the limit', async () => {
    const perColumn = SYSTEM3_CSV_LIMITS.maxDistinctValuesPerColumn - 1;
    const columnCount = Math.ceil(SYSTEM3_CSV_LIMITS.maxTrackedDistinctValues / perColumn) + 1;
    const header = Array.from({ length: columnCount }, (_, column) => `c${column.toString()}`);
    const lines = Array.from({ length: perColumn }, (_, row) =>
      header.map(name => `${name}-${row.toString()}`).join(',')
    );
    const profile = await profileDatasetCsvStream({
      filename: 'wide.csv',
      sourceVersionId: 'dataset-wide',
      chunks: (async function* (): AsyncGenerator<Uint8Array> {
        yield new TextEncoder().encode(`${header.join(',')}\n${lines.join('\n')}\n`);
      })(),
      targetColumn: null,
    });
    const tracked = profile.columns
      .filter(column => column.distinctCountCapped !== true)
      .reduce((total, column) => total + column.distinctCount, 0);
    expect(profile.columns.some(column => column.distinctCountCapped === true)).toBe(true);
    expect(tracked).toBeLessThanOrEqual(SYSTEM3_CSV_LIMITS.maxTrackedDistinctValues);
  });

  test('uses an explicitly declared target column without guessing a default name', async () => {
    const blueprint = [
      '# Project',
      '## 1. PROBLEM PROFILE',
      '**Business Goal:** Giảm khách hàng rời bỏ',
      '**Target Column:** outcome',
      '## 2. REQUIREMENTS CONTRACT',
      '| ID | Type | Requirement | Acceptance Criteria |',
      '|---|---|---|---|',
      '| FR-01 | FR | Tạo dự đoán | Có kết quả |',
      '## 3. HIGH-LEVEL PIPELINE',
      '### Phase 1: Build',
      '## 4. SELECTED TECHNOLOGY STACK',
      '| Technology | Purpose |',
      '|---|---|',
      '| Bun | Runtime |',
      '## 5. MODULAR DESIGN PACKAGE',
      '### DM-01 — Core',
      '- **Outputs:** result',
      '## 6. EXECUTION BLUEPRINT',
      '#### File: `src/main.ts`',
    ].join('\n');
    const result = await understandProjectSources({
      sources: [
        source({ filename: 'blueprint.md', body: blueprint }),
        source({
          id: 'dataset-explicit-target',
          kind: 'dataset',
          filename: 'dataset.csv',
          mediaType: 'text/csv',
          body: 'id,outcome\n1,yes\n2,no\n',
        }),
      ],
    });
    expect(result.analysis.dataset?.targetColumn).toBe('outcome');
    expect(result.analysis.dataset?.targetExists).toBe(true);
  });

  test('verifies a streamed source without collecting all chunks in memory', async () => {
    const bytes = new TextEncoder().encode('a,b\n1,2\n');
    await expect(
      verifyPinnedUnderstandingSourceStream({
        id: 'dataset-stream',
        kind: 'dataset',
        filename: 'dataset.csv',
        mediaType: 'text/csv',
        contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        chunks: (async function* (): AsyncGenerator<Uint8Array> {
          yield bytes.subarray(0, 3);
          yield bytes.subarray(3);
        })(),
      })
    ).resolves.toBeUndefined();
  });

  test('rejects a streamed dataset when its pinned hash differs', async () => {
    const bytes = new TextEncoder().encode('a,b\n1,2\n');
    await expect(
      profileDatasetCsvStream({
        filename: 'dataset.csv',
        sourceVersionId: 'dataset-stream',
        chunks: (async function* (): AsyncGenerator<Uint8Array> {
          yield bytes;
        })(),
        targetColumn: null,
        expectedContentHash: `sha256:${'0'.repeat(64)}`,
      })
    ).rejects.toThrow('không khớp');
  });

  test('accepts only semantic candidates with an exact quote in the selected component', async () => {
    const markdown = [
      '# Project',
      '## 1. PROBLEM PROFILE',
      'Mục đích thật là giảm tỷ lệ rời bỏ.',
      '## 2. REQUIREMENTS CONTRACT',
      '| ID | Type | Requirement | Acceptance Criteria |',
      '|---|---|---|---|',
      '| FR-01 | FR | Tạo dự đoán | Có kết quả |',
      '## 3. HIGH-LEVEL PIPELINE',
      '### Phase 1: Build',
      '## 4. SELECTED TECHNOLOGY STACK',
      '| Technology | Purpose |',
      '|---|---|',
      '| Bun | Runtime |',
      '## 5. MODULAR DESIGN PACKAGE',
      '### DM-01 — Core',
      '- **Outputs:** result',
      '## 6. EXECUTION BLUEPRINT',
      '#### File: `src/main.ts`',
    ].join('\n');
    const result = await understandProjectSources({
      sources: [source({ filename: 'blueprint.md', body: markdown })],
      semanticFallback: async input => ({
        provider: 'test',
        model: 'test',
        candidates: [
          {
            componentId: input.components[0]?.id ?? '',
            field: 'business_goal',
            value: 'Giảm tỷ lệ rời bỏ',
            exactQuote: 'giảm tỷ lệ rời bỏ',
          },
          {
            componentId: input.components[0]?.id ?? '',
            field: 'technical_objective',
            value: 'Nội dung bịa',
            exactQuote: 'không có trong nguồn',
          },
        ],
        attempts: 1,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        durationMs: 1,
      }),
    });
    expect(result.analysis.businessGoal).toBe('Giảm tỷ lệ rời bỏ');
    expect(result.analysis.technicalObjective).toBeNull();
  });
});
