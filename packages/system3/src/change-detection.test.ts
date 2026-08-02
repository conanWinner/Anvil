import { describe, expect, test } from 'bun:test';
import {
  detectSystem3SourceChange,
  system3ChangeDetectionIdempotencyKey,
  type System3ChangeSourceInput,
} from './change-detection';

const projectId = '00000000-0000-4000-8000-000000000001';
const operationId = '00000000-0000-4000-8000-000000000002';
const sourceId = '00000000-0000-4000-8000-000000000003';

test('pins OP-01 idempotency to the detector version', () => {
  expect(system3ChangeDetectionIdempotencyKey(sourceId)).toBe(
    `source:${sourceId}:system3-change-detector@3`
  );
});

function source(
  id: string,
  kind: System3ChangeSourceInput['kind'],
  filename: string,
  text: string
): System3ChangeSourceInput {
  return {
    id,
    sourceId,
    kind,
    filename,
    mediaType: filename.endsWith('.csv') ? 'text/csv' : 'text/markdown',
    contentHash: `sha256:${id.replaceAll('-', '').padEnd(64, '0').slice(0, 64)}`,
    bytes: new TextEncoder().encode(text),
  };
}

async function detect(input: {
  current: System3ChangeSourceInput;
  previous?: System3ChangeSourceInput;
  targetColumn?: string | null;
  semanticFallback?: Parameters<typeof detectSystem3SourceChange>[0]['semanticFallback'];
}) {
  return detectSystem3SourceChange({
    projectId,
    operationId,
    current: input.current,
    previous: input.previous ?? null,
    knowledgeSnapshotId: null,
    targetColumn: input.targetColumn ?? null,
    resources: [],
    ...(input.semanticFallback ? { semanticFallback: input.semanticFallback } : {}),
    now: '2026-07-29T00:00:00.000Z',
  });
}

describe('detectSystem3SourceChange', () => {
  test('treats a new source as a full Understanding input', async () => {
    const manifest = await detect({
      current: source(
        '00000000-0000-4000-8000-000000000010',
        'blueprint',
        'blueprint.md',
        '**Business Goal:** Retain customers'
      ),
    });
    expect(manifest.changes[0]?.kind).toBe('first_source');
    expect(manifest.proposedRerun.mode).toBe('full');
    expect(manifest.affectedActivities).toContain('TW-02');
  });

  test('proves formatting-only Markdown changes without staling downstream activities', async () => {
    const previous = source(
      '00000000-0000-4000-8000-000000000011',
      'blueprint',
      'blueprint.md',
      '# Title\n\n**Business Goal:** Retain customers'
    );
    const current = source(
      '00000000-0000-4000-8000-000000000012',
      'blueprint',
      'blueprint.md',
      '## Title\n**Business Goal:**   Retain customers\n'
    );
    const manifest = await detect({ current, previous });
    expect(manifest.changes[0]?.kind).toBe('formatting_only');
    expect(manifest.proposedRerun.mode).toBe('none');
    expect(manifest.affectedActivities).toEqual([]);
  });

  test('does not hide an unparsed semantic Markdown change as formatting-only', async () => {
    const previous = source(
      '00000000-0000-4000-8000-000000000021',
      'blueprint',
      'blueprint.md',
      '# Project\n\nTarget: churn'
    );
    const current = source(
      '00000000-0000-4000-8000-000000000022',
      'blueprint',
      'blueprint.md',
      '# Project\n\nTarget: churn\n\nConstraint: CPU only'
    );

    const manifest = await detect({ current, previous });

    expect(manifest.changes.map(item => item.kind)).not.toContain('formatting_only');
    expect(manifest.proposedRerun.mode).toBe('full');
    expect(manifest.affectedActivities).toContain('TW-02');
  });

  test('detects a changed canonical requirement', async () => {
    const heading =
      '| ID | Type | Priority | Source | Requirement | Acceptance Criteria |\n|---|---|---|---|---|---|';
    const previous = source(
      '00000000-0000-4000-8000-000000000013',
      'blueprint',
      'blueprint.md',
      `${heading}\n| FR-01 | FR | Must | User | Export CSV | File exists |`
    );
    const current = source(
      '00000000-0000-4000-8000-000000000014',
      'blueprint',
      'blueprint.md',
      `${heading}\n| FR-01 | FR | Must | User | Export CSV and JSON | Both files exist |`
    );
    const manifest = await detect({ current, previous });
    expect(manifest.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'requirement', entityKey: 'FR-01' })])
    );
    expect(manifest.proposedRerun.mode).toBe('full');
  });

  test('separates row-only dataset drift from schema drift', async () => {
    const previous = source(
      '00000000-0000-4000-8000-000000000015',
      'dataset',
      'data.csv',
      'id,churn\n1,0\n'
    );
    const rowChange = source(
      '00000000-0000-4000-8000-000000000016',
      'dataset',
      'data.csv',
      'id,churn\n1,0\n2,1\n'
    );
    const schemaChange = source(
      '00000000-0000-4000-8000-000000000017',
      'dataset',
      'data.csv',
      'id,churn,age\n1,0,30\n'
    );
    expect(
      (await detect({ current: rowChange, previous, targetColumn: 'churn' })).changes[0]?.kind
    ).toBe('row_only');
    expect(
      (await detect({ current: schemaChange, previous, targetColumn: 'churn' })).changes[0]?.kind
    ).toBe('schema');
  });

  test('classifies delivery-only constraint changes', async () => {
    const previous = source(
      '00000000-0000-4000-8000-000000000018',
      'constraints',
      'constraints.json',
      '{"delivery":{"format":"zip"}}'
    );
    const current = source(
      '00000000-0000-4000-8000-000000000019',
      'constraints',
      'constraints.json',
      '{"delivery":{"format":"tar"}}'
    );
    const manifest = await detect({ current, previous });
    expect(manifest.changes[0]?.kind).toBe('delivery');
    expect(manifest.proposedRerun.executableScope).toBe('delivery');
  });

  test('accepts only source-grounded LLM candidates and never narrows deterministic scope', async () => {
    const previous = source(
      '00000000-0000-4000-8000-000000000020',
      'user_brief',
      'brief.md',
      'Old goal'
    );
    const current = source(
      '00000000-0000-4000-8000-000000000021',
      'user_brief',
      'brief.md',
      'New delivery requirement'
    );
    const manifest = await detect({
      current,
      previous,
      semanticFallback: async () => ({
        provider: 'test',
        model: 'test-model',
        attempts: 1,
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 0.001,
        durationMs: 25,
        candidates: [
          {
            kind: 'delivery',
            entityType: 'delivery_requirement',
            entityKey: null,
            summary: 'Delivery requirement changed.',
            sourcePointers: ['brief.md:1'],
            confidence: 0.9,
          },
          {
            kind: 'runtime',
            entityType: 'runtime',
            entityKey: null,
            summary: 'Ungrounded candidate.',
            sourcePointers: ['brief.md:999'],
            confidence: 0.9,
          },
        ],
      }),
    });
    expect(manifest.analysisMode).toBe('llm_assisted');
    expect(manifest.llmAssistance.candidateCount).toBe(1);
    expect(manifest.llmAssistance).toMatchObject({
      attempts: 1,
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.001,
      outcome: 'succeeded',
    });
    expect(manifest.proposedRerun.mode).toBe('full');
  });

  test('sends only a bounded changed excerpt to semantic assistance', async () => {
    const unchangedPrefix = Array.from(
      { length: 400 },
      (_, index) => `Dòng giữ nguyên ${index.toString().padStart(3, '0')} ${'x'.repeat(20)}`
    );
    const unchangedSuffix = Array.from(
      { length: 400 },
      (_, index) => `Dòng cuối ${index.toString().padStart(3, '0')} ${'y'.repeat(20)}`
    );
    const previous = source(
      '00000000-0000-4000-8000-000000000023',
      'user_brief',
      'brief.md',
      [...unchangedPrefix, 'Mục tiêu cũ', ...unchangedSuffix].join('\n')
    );
    const current = source(
      '00000000-0000-4000-8000-000000000024',
      'user_brief',
      'brief.md',
      [...unchangedPrefix, 'Mục tiêu mới', ...unchangedSuffix].join('\n')
    );
    let receivedPrevious = '';
    let receivedCurrent = '';

    await detect({
      current,
      previous,
      semanticFallback: input => {
        receivedPrevious = input.previousText ?? '';
        receivedCurrent = input.currentText;
        return Promise.resolve({
          provider: 'test',
          model: 'test-model',
          attempts: 1,
          inputTokens: 20,
          outputTokens: 1,
          costUsd: 0,
          durationMs: 1,
          candidates: [],
        });
      },
    });

    expect(receivedPrevious.length).toBeLessThanOrEqual(6000);
    expect(receivedCurrent.length).toBeLessThanOrEqual(6000);
    expect(receivedPrevious).toContain('Mục tiêu cũ');
    expect(receivedCurrent).toContain('Mục tiêu mới');
    expect(receivedCurrent).not.toContain('Dòng giữ nguyên 000');
  });

  test('uses project-scoped dependency paths to explain an affected result', async () => {
    const current = source(
      '00000000-0000-4000-8000-000000000031',
      'blueprint',
      'blueprint.md',
      '**Business Goal:** Keep customers'
    );
    const manifest = await detectSystem3SourceChange({
      projectId,
      operationId,
      current,
      previous: null,
      knowledgeSnapshotId: null,
      targetColumn: null,
      resources: [
        {
          resourceType: 'knowledge_snapshot',
          resourceId: '00000000-0000-4000-8000-000000000032',
          activityId: 'TW-02',
          sourceVersionIds: [],
          status: 'current',
        },
      ],
      dependencyEdges: [
        {
          fromKind: 'source_version',
          fromId: current.id,
          toKind: 'resource',
          toId: '00000000-0000-4000-8000-000000000032',
          reason: 'test edge',
        },
      ],
      now: '2026-07-30T00:00:00.000Z',
    });
    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.basis.dependencyGraphVersion).toBe('system3-dependency-graph@2');
    expect(manifest.affectedResources[0]?.dependencyPath).toEqual([
      `source_version:${current.id}`,
      'resource:00000000-0000-4000-8000-000000000032',
    ]);
  });
});
