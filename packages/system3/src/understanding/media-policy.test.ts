import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import {
  understandProjectSources,
  type PinnedUnderstandingSource,
  type UnderstandingSemanticFallback,
} from './index';

function source(input: {
  id: string;
  kind: PinnedUnderstandingSource['kind'];
  filename: string;
  mediaType: string;
  body: string | Uint8Array;
}): PinnedUnderstandingSource {
  const bytes = typeof input.body === 'string' ? new TextEncoder().encode(input.body) : input.body;
  return {
    ...input,
    bytes,
    contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

const minimalBlueprint = source({
  id: 'blueprint',
  kind: 'blueprint',
  filename: 'system-2.md',
  mediaType: 'text/markdown; charset=utf-8',
  body: '# System 2',
});

function unsupportedIssues(
  result: Awaited<ReturnType<typeof understandProjectSources>>
): typeof result.analysis.extractionQuality.issues {
  return result.analysis.extractionQuality.issues.filter(
    issue => issue.kind === 'unsupported_content'
  );
}

describe('TW-02 Understanding media policy', () => {
  test('fails closed for a DOCX Blueprint even when its media type claims Markdown', async () => {
    let semanticCalls = 0;
    const semanticFallback: UnderstandingSemanticFallback = async () => {
      semanticCalls += 1;
      return {
        provider: 'test',
        model: 'test',
        candidates: [],
        attempts: 1,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        durationMs: 0,
      };
    };
    const result = await understandProjectSources({
      sources: [
        source({
          id: 'docx-blueprint',
          kind: 'blueprint',
          filename: 'system-2.docx',
          mediaType: 'text/markdown',
          body: new Uint8Array([0, 159, 146, 150]),
        }),
      ],
      semanticFallback,
    });

    expect(result.analysis.extractionQuality.status).toBe('revision_required');
    expect(result.analysis.extractionQuality.parserVersion).toBe('system3-unsupported-source@1');
    expect(unsupportedIssues(result)).toEqual([
      expect.objectContaining({
        severity: 'revision_required',
        sourcePointers: [expect.objectContaining({ filename: 'system-2.docx' })],
      }),
    ]);
    expect(semanticCalls).toBe(0);
  });

  test('reports an arbitrary binary supporting document instead of silently ignoring it', async () => {
    const result = await understandProjectSources({
      sources: [
        minimalBlueprint,
        source({
          id: 'binary-support',
          kind: 'supporting_document',
          filename: 'appendix.bin',
          mediaType: 'application/octet-stream',
          body: new Uint8Array([0, 255, 1, 2]),
        }),
      ],
    });

    expect(result.analysis.extractionQuality.status).toBe('revision_required');
    expect(unsupportedIssues(result)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'revision_required',
          sourcePointers: [expect.objectContaining({ filename: 'appendix.bin' })],
        }),
      ])
    );
  });

  test('accepts an explicit text/plain blueprint and only profiles CSV in the Dataset path', async () => {
    const textBlueprint = source({
      id: 'plain-blueprint',
      kind: 'blueprint',
      filename: 'system-2.txt',
      mediaType: 'text/plain',
      body: '# System 2',
    });
    const result = await understandProjectSources({
      sources: [
        textBlueprint,
        source({
          id: 'not-a-dataset',
          kind: 'supporting_document',
          filename: 'customers.csv',
          mediaType: 'text/csv',
          body: 'id,target\n1,yes\n',
        }),
      ],
    });

    expect(result.analysis.extractionQuality.parserVersion).toBe('system3-markdown-reader@2');
    expect(result.analysis.datasetUnderstanding.profile).toBeNull();
    expect(unsupportedIssues(result)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePointers: [expect.objectContaining({ filename: 'customers.csv' })],
        }),
      ])
    );
  });
});
