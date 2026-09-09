import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  buildMarkdownRequirementCitationBlock,
  friendlyDecisionQuestion,
} from './system3-activity-resources';

describe('friendlyDecisionQuestion', () => {
  test('presents a manual-review marker as readable text', () => {
    expect(
      friendlyDecisionQuestion(
        '- {"tag":"[Manual Review Required]","issue":"Người dùng chưa chọn cách giải thích.","suggestion":"Xác nhận với người dùng."}'
      )
    ).toBe('Người dùng chưa chọn cách giải thích.');
  });

  test('removes a plain marker without changing the project question', () => {
    expect(friendlyDecisionQuestion('[Manual Review Required] Chọn ngưỡng cảnh báo')).toBe(
      'Chọn ngưỡng cảnh báo'
    );
  });
});

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

describe('buildMarkdownRequirementCitationBlock', () => {
  test('shows the exact requested row only after verifying its complete parent table', async () => {
    const markdown =
      '| ID | Requirement |\r\n| --- | --- |\r\n| FR-01 | First |\r\n| FR-02 | Second |';
    const normalized = markdown.replaceAll('\r\n', '\n');
    const block = await buildMarkdownRequirementCitationBlock({
      analysis: {
        requirements: [
          {
            id: 'FR-02',
            statement: 'Second',
            sourcePointers: [
              {
                sourceVersionId: 'table-v1',
                filename: 'table.md',
                headingPath: [],
                startLine: 1,
                endLine: 4,
                excerptHash: sha256(normalized),
              },
            ],
          },
        ],
      },
      sources: [
        {
          id: 'table-v1',
          filename: 'table.md',
          mediaType: 'text/markdown',
          sizeBytes: Buffer.byteLength(markdown),
          contentHash: sha256(markdown),
          storageKey: 'table',
          storageStatus: 'ready',
        },
      ],
      readSource: async () => new TextEncoder().encode(markdown),
    });
    expect(block.items[0]).toMatchObject({
      status: 'verified',
      startLine: 4,
      endLine: 4,
      excerpt: '| FR-02 | Second |',
    });
  });
  const sourceVersionId = 'source-version-1';
  const markdown = '# Blueprint\n\n## Requirements\n\n- The system must preserve provenance.\n';
  const lines = markdown.split(/\r?\n/u);
  const pointer = {
    sourceVersionId,
    filename: 'blueprint.md',
    headingPath: ['Blueprint', 'Requirements'],
    startLine: 5,
    endLine: 5,
    excerptHash: sha256(lines.slice(4, 5).join('\n')),
  };

  test('uses the exact pinned source version and verifies both hashes before exposing an excerpt', async () => {
    const readIds: string[] = [];
    const block = await buildMarkdownRequirementCitationBlock({
      analysis: {
        requirements: [
          {
            id: 'REQ-1',
            statement: 'Preserve provenance',
            sourcePointers: [pointer],
          },
        ],
      },
      sources: [
        {
          id: sourceVersionId,
          filename: 'blueprint.md',
          mediaType: 'text/markdown; charset=utf-8',
          sizeBytes: Buffer.byteLength(markdown),
          contentHash: sha256(markdown),
          storageKey: 'pinned-key',
          storageStatus: 'ready',
        },
        {
          id: 'newer-source-version',
          filename: 'blueprint.md',
          mediaType: 'text/markdown',
          sizeBytes: Buffer.byteLength('# newer'),
          contentHash: sha256('# newer'),
          storageKey: 'newer-key',
          storageStatus: 'ready',
        },
      ],
      readSource: async source => {
        readIds.push(source.id);
        return new TextEncoder().encode(markdown);
      },
    });

    expect(readIds).toEqual([sourceVersionId]);
    expect(block.items).toEqual([
      expect.objectContaining({
        filename: 'blueprint.md',
        sourceVersionId,
        startLine: 5,
        endLine: 5,
        headingPath: ['Blueprint', 'Requirements'],
        excerpt: '- The system must preserve provenance.',
        status: 'verified',
        reason: null,
        truncated: false,
      }),
    ]);

    const sourceHashMismatch = await buildMarkdownRequirementCitationBlock({
      analysis: {
        requirements: [{ id: 'REQ-source-hash', statement: 'Hash', sourcePointers: [pointer] }],
      },
      sources: [
        {
          id: sourceVersionId,
          filename: 'blueprint.md',
          mediaType: 'text/markdown',
          sizeBytes: Buffer.byteLength(markdown),
          contentHash: sha256('different source bytes'),
          storageKey: 'pinned-key',
          storageStatus: 'ready',
        },
      ],
      readSource: async () => new TextEncoder().encode(markdown),
    });
    expect(sourceHashMismatch.items[0]).toEqual(
      expect.objectContaining({ status: 'unavailable', excerpt: null })
    );
  });

  test('keeps malformed pointers and hash mismatches unavailable without exposing an excerpt', async () => {
    const block = await buildMarkdownRequirementCitationBlock({
      analysis: {
        requirements: [
          {
            id: 'REQ-malformed',
            statement: 'Malformed',
            sourcePointers: [{ ...pointer, startLine: 5.5 }],
          },
          {
            id: 'REQ-mismatch',
            statement: 'Mismatch',
            sourcePointers: [{ ...pointer, excerptHash: sha256('different') }],
          },
        ],
      },
      sources: [
        {
          id: sourceVersionId,
          filename: 'blueprint.md',
          mediaType: 'text/markdown',
          sizeBytes: Buffer.byteLength(markdown),
          contentHash: sha256(markdown),
          storageKey: 'pinned-key',
          storageStatus: 'ready',
        },
      ],
      readSource: async () => new TextEncoder().encode(markdown),
    });

    expect(block.items).toEqual([
      expect.objectContaining({ status: 'unavailable', excerpt: null }),
      expect.objectContaining({ status: 'unavailable', excerpt: null }),
    ]);
  });

  test('bounds entries and excerpts, preserves historical missing citations, and does not mutate analysis', async () => {
    const longLine = `- ${'x'.repeat(1_300)}`;
    const longMarkdown = `# Blueprint\n\n${longLine}\n`;
    const longLines = longMarkdown.split(/\r?\n/u);
    const analysis = {
      requirements: Array.from({ length: 25 }, (_, index) => ({
        id: `REQ-${String(index)}`,
        statement: 'Bounded',
        sourcePointers: [
          index === 24
            ? { ...pointer, sourceVersionId: 'historical-missing' }
            : {
                ...pointer,
                startLine: 3,
                endLine: 3,
                excerptHash: sha256(longLines.slice(2, 3).join('\n')),
              },
        ],
      })),
    };
    const before = structuredClone(analysis);
    const block = await buildMarkdownRequirementCitationBlock({
      analysis,
      sources: [
        {
          id: sourceVersionId,
          filename: 'blueprint.md',
          mediaType: 'text/markdown',
          sizeBytes: Buffer.byteLength(longMarkdown),
          contentHash: sha256(longMarkdown),
          storageKey: 'pinned-key',
          storageStatus: 'ready',
        },
      ],
      readSource: async () => new TextEncoder().encode(longMarkdown),
    });

    expect(block.items).toHaveLength(24);
    expect(block.title).toContain('chỉ hiển thị 24 mục');
    expect(block.items[0]).toEqual(
      expect.objectContaining({ truncated: true, status: 'verified' })
    );
    expect(analysis).toEqual(before);

    const missingBlock = await buildMarkdownRequirementCitationBlock({
      analysis: { requirements: [analysis.requirements[24]!] },
      sources: [],
      readSource: async () => new Uint8Array(),
    });
    expect(missingBlock.items[0]).toEqual(
      expect.objectContaining({ status: 'unavailable', excerpt: null })
    );
  });
});
