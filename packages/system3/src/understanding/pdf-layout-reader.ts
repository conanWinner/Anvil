import { createHash } from 'node:crypto';
import type { Paragraph, RootContent } from 'mdast';
import { getDocumentProxy } from 'unpdf';
import {
  classifyUnderstandingChapterHeading,
  type UnderstandingDocumentComponent,
  type UnderstandingDocumentIndex,
} from './document-index';
import type { UnderstandingChapter } from './schemas';

export const UNDERSTANDING_PDF_PARSER_VERSION = 'system3-pdf-layout-reader@2' as const;

interface PositionedText {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function positionedText(value: unknown): PositionedText | null {
  if (value === null || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const transform = item.transform;
  if (
    typeof item.str !== 'string' ||
    !Array.isArray(transform) ||
    typeof transform[4] !== 'number' ||
    typeof transform[5] !== 'number'
  ) {
    return null;
  }
  return {
    text: item.str,
    x: transform[4],
    y: transform[5],
    width: typeof item.width === 'number' ? item.width : 0,
    height:
      typeof item.height === 'number'
        ? item.height
        : typeof transform[3] === 'number'
          ? Math.abs(transform[3])
          : 0,
  };
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function syntheticParagraph(text: string): Paragraph {
  return { type: 'paragraph', children: [{ type: 'text', value: text }] };
}

function emptyChapters(): Record<UnderstandingChapter, UnderstandingDocumentComponent[]> {
  return {
    problem_profile: [],
    requirements_contract: [],
    high_level_pipeline: [],
    technology_stack: [],
    modular_design: [],
    execution_blueprint: [],
  };
}

export async function readUnderstandingPdf(input: {
  bytes: Uint8Array;
  sourceVersionId: string;
  filename: string;
}): Promise<UnderstandingDocumentIndex> {
  const pdf = await getDocumentProxy(input.bytes);
  const components: UnderstandingDocumentComponent[] = [];
  const chapters = emptyChapters();
  let currentChapter: UnderstandingChapter | null = null;
  let chapterHeading: string | null = null;
  let headingPath: string[] = [];
  let title: string | null = null;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items
      .map(positionedText)
      .filter((value): value is PositionedText => value !== null);
    if (items.length === 0) continue;
    const positiveHeights = items
      .map(item => item.height)
      .filter(height => height > 0)
      .sort((a, b) => a - b);
    const medianHeight = positiveHeights[Math.floor(positiveHeights.length / 2)] ?? 10;
    const lines = new Map<number, PositionedText[]>();
    for (const item of items) {
      const key = Math.round(item.y * 2) / 2;
      const row = lines.get(key) ?? [];
      row.push(item);
      lines.set(key, row);
    }
    const ordered = [...lines.entries()].sort((left, right) => right[0] - left[0]);
    for (const [, row] of ordered) {
      row.sort((left, right) => left.x - right.x);
      const text = row
        .map(item => item.text)
        .join(' ')
        .replace(/\s+/gu, ' ')
        .trim();
      if (!text) continue;
      const maxHeight = Math.max(...row.map(item => item.height));
      const looksLikeHeading = maxHeight >= medianHeight * 1.2 || /^\s*[1-6][.)]\s+/u.test(text);
      if (looksLikeHeading && title === null) title = text;
      const recognized = looksLikeHeading ? classifyUnderstandingChapterHeading(text) : null;
      if (recognized !== null) {
        currentChapter = recognized;
        chapterHeading = text;
        headingPath = [text];
      } else if (looksLikeHeading) {
        headingPath = chapterHeading === null ? [text] : [chapterHeading, text];
      }
      const minX = Math.min(...row.map(item => item.x));
      const minY = Math.min(...row.map(item => item.y));
      const maxX = Math.max(...row.map(item => item.x + item.width));
      const maxY = Math.max(...row.map(item => item.y + item.height));
      const node: RootContent = looksLikeHeading
        ? {
            type: 'heading',
            depth: recognized === null ? 3 : 2,
            children: [{ type: 'text', value: text }],
          }
        : syntheticParagraph(text);
      const component: UnderstandingDocumentComponent = {
        id: `${input.sourceVersionId}:page-${String(pageNumber)}:${String(components.length + 1)}`,
        kind: looksLikeHeading ? 'heading' : 'paragraph',
        text,
        raw: text,
        headingPath: [...headingPath],
        chapter: currentChapter,
        sourcePointer: {
          sourceVersionId: input.sourceVersionId,
          filename: input.filename,
          headingPath: [...headingPath],
          startLine: null,
          endLine: null,
          jsonPointer: null,
          page: pageNumber,
          boundingBox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
          excerptHash: digest(text),
        },
        coverageStatus: looksLikeHeading ? 'ignored_with_reason' : 'unclassified',
        coverageReason: looksLikeHeading
          ? 'Tiêu đề PDF được dùng để dựng cấu trúc bố cục.'
          : 'Chưa được bộ trích xuất nhận.',
        segments: [text],
        node,
      };
      components.push(component);
      if (currentChapter !== null) chapters[currentChapter].push(component);
    }
  }
  if (components.length === 0) {
    throw new Error('PDF không chứa lớp chữ có thể đọc; TW-02 chưa hỗ trợ nhận dạng chữ từ ảnh');
  }
  return {
    sourceVersionId: input.sourceVersionId,
    filename: input.filename,
    title,
    components,
    chapters,
  };
}
