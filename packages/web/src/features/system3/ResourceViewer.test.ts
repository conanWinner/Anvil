import { describe, expect, test } from 'bun:test';
import { selectModelResourceBlocks } from './ResourceViewer';
import type { System3PresentationBlock } from './types';

const blocks = [
  {
    kind: 'facts',
    title: 'Model comparison',
    items: [
      { label: 'model', value: 'router9/model-a' },
      { label: 'status', value: 'Hoàn tất' },
    ],
  },
  {
    kind: 'table',
    title: 'Model output · router9/model-a',
    columns: ['rows'],
    rows: [['4']],
    truncated: false,
  },
  { kind: 'markdown', markdown: '**Python solution · models/0/solution.py**\n```py\nA\n```' },
  {
    kind: 'facts',
    title: 'Model comparison',
    items: [
      { label: 'model', value: 'router9/model-b' },
      { label: 'status', value: 'Hoàn tất' },
    ],
  },
  {
    kind: 'table',
    title: 'Model output · router9/model-b',
    columns: ['rows'],
    rows: [['9']],
    truncated: false,
  },
  { kind: 'markdown', markdown: '**Python solution · models/1/solution.py**\n```py\nB\n```' },
] satisfies System3PresentationBlock[];

describe('selectModelResourceBlocks', () => {
  test('selects only exact model output and code', () => {
    const output = selectModelResourceBlocks(blocks, {
      model: 'router9/model-b',
      content: 'output',
    });
    expect(output.unavailable).toBe(false);
    expect(output.blocks).toHaveLength(2);
    expect(output.blocks[1]).toMatchObject({
      title: 'Model output · router9/model-b',
      rows: [['9']],
    });
    const secondCode = selectModelResourceBlocks(blocks, {
      model: 'router9/model-b',
      content: 'code',
    });
    expect(secondCode.unavailable).toBe(false);
    expect(secondCode.blocks[1]).toMatchObject({
      kind: 'markdown',
      markdown: expect.stringContaining('models/1/solution.py'),
    });

    const code = selectModelResourceBlocks(blocks, {
      model: 'router9/model-a',
      content: 'code',
    });
    expect(code.unavailable).toBe(false);
    expect(code.blocks[1]).toMatchObject({
      kind: 'markdown',
      markdown: expect.stringContaining('models/0/solution.py'),
    });
  });

  test('reports unavailable for missing, failed, or unverified model content', () => {
    expect(
      selectModelResourceBlocks(blocks, { model: 'router9/other', content: 'output' })
    ).toEqual({
      blocks: [],
      unavailable: true,
    });
    const failedBlocks = blocks
      .map((block, index) =>
        index === 1 ? { ...block, title: 'Model output · router9/model-a' } : block
      )
      .map((block, index) =>
        index === 0 && block.kind === 'facts'
          ? {
              ...block,
              items: block.items.map(item =>
                item.label === 'status' ? { ...item, value: 'Không hoàn tất' } : item
              ),
            }
          : block
      ) satisfies System3PresentationBlock[];
    expect(
      selectModelResourceBlocks(failedBlocks, { model: 'router9/model-a', content: 'code' })
    ).toEqual({
      blocks: [failedBlocks[0]!],
      unavailable: true,
    });
    const missingCode = [blocks[0], blocks[1], blocks[3], blocks[4], blocks[5]];
    expect(
      selectModelResourceBlocks(missingCode, { model: 'router9/model-b', content: 'code' })
    ).toEqual({
      blocks: [blocks[3]!],
      unavailable: true,
    });
    const malformedMarkdown = [
      blocks[0]!,
      blocks[1]!,
      { kind: 'markdown', markdown: 42 } as unknown as System3PresentationBlock,
    ];
    expect(
      selectModelResourceBlocks(malformedMarkdown, { model: 'router9/model-a', content: 'code' })
    ).toEqual({
      blocks: [blocks[0]!],
      unavailable: true,
    });
    const duplicateModel = [...blocks.slice(0, 3), blocks[0]!, ...blocks.slice(3)];
    expect(
      selectModelResourceBlocks(duplicateModel, { model: 'router9/model-a', content: 'output' })
    ).toEqual({
      blocks: [],
      unavailable: true,
    });
  });
});
