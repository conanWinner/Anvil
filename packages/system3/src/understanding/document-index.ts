import { createHash } from 'node:crypto';
import type { RootContent } from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visitParents } from 'unist-util-visit-parents';
import type {
  UnderstandingChapter,
  UnderstandingComponentKind,
  UnderstandingCoverageStatus,
  UnderstandingSourcePointer,
} from './schemas';

export const UNDERSTANDING_MARKDOWN_PARSER_VERSION = 'system3-markdown-reader@2' as const;
export const UNDERSTANDING_HEADING_ALIAS_VERSION = 'system3-heading-aliases@1' as const;
export const UNDERSTANDING_EXTRACTION_POLICY_VERSION = 'system3-understanding-policy@3' as const;

const MAX_TEXT_COMPONENT_CHARS = 64 * 1024;
const MAX_CODE_COMPONENT_CHARS = 256 * 1024;

const chapterAliases: Readonly<Record<UnderstandingChapter, readonly string[]>> = {
  problem_profile: ['problem profile', 'ho so van de'],
  requirements_contract: ['requirements contract', 'hop dong yeu cau', 'yeu cau'],
  high_level_pipeline: ['high level pipeline', 'quy trinh giai phap cap cao', 'pipeline'],
  technology_stack: ['selected technology stack', 'technology stack', 'lua chon cong nghe'],
  modular_design: ['modular design package', 'modular design', 'thiet ke mo dun'],
  execution_blueprint: ['execution blueprint', 'thiet ke trien khai'],
};

export interface UnderstandingDocumentComponent {
  id: string;
  kind: UnderstandingComponentKind;
  text: string;
  raw: string;
  headingPath: string[];
  chapter: UnderstandingChapter | null;
  sourcePointer: UnderstandingSourcePointer;
  coverageStatus: UnderstandingCoverageStatus;
  coverageReason: string;
  segments: string[];
  node: RootContent;
}

export interface UnderstandingDocumentIndex {
  sourceVersionId: string;
  filename: string;
  title: string | null;
  components: UnderstandingDocumentComponent[];
  chapters: Readonly<Record<UnderstandingChapter, UnderstandingDocumentComponent[]>>;
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function normalizedHeading(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/^\s*(?:chapter\s+)?[1-6][.):\-\s]+/u, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

export function classifyUnderstandingChapterHeading(value: string): UnderstandingChapter | null {
  const normalized = normalizedHeading(value);
  for (const [chapter, aliases] of Object.entries(chapterAliases) as [
    UnderstandingChapter,
    readonly string[],
  ][]) {
    if (aliases.includes(normalized)) return chapter;
  }
  return null;
}

function componentKind(node: RootContent): UnderstandingComponentKind {
  if (node.type === 'heading') return 'heading';
  if (node.type === 'paragraph') return 'paragraph';
  if (node.type === 'list') return 'list';
  if (node.type === 'table') return 'table';
  if (node.type === 'code') return 'code';
  if (node.type === 'blockquote') return 'blockquote';
  return 'unsupported';
}

function rawForNode(markdownLines: readonly string[], node: RootContent): string {
  const start = node.position?.start.line;
  const end = node.position?.end.line;
  if (start === undefined || end === undefined) return toString(node);
  return markdownLines.slice(start - 1, end).join('\n');
}

function splitTextComponent(raw: string, kind: UnderstandingComponentKind): string[] {
  if (kind === 'code') return raw.length <= MAX_CODE_COMPONENT_CHARS ? [raw] : [];
  if (raw.length <= MAX_TEXT_COMPONENT_CHARS) return [raw];
  if (kind === 'table') {
    const lines = raw.split(/\r?\n/u);
    const header = lines.slice(0, 2);
    const rows = lines.slice(2);
    if (header.length !== 2 || header.some(line => line.length === 0)) return [];
    const headerText = header.join('\n');
    if (headerText.length > MAX_TEXT_COMPONENT_CHARS) return [];
    const segments: string[] = [];
    let current = headerText;
    for (const row of rows) {
      if (row.length + headerText.length + 1 > MAX_TEXT_COMPONENT_CHARS) return [];
      if (current.length + row.length + 1 > MAX_TEXT_COMPONENT_CHARS) {
        segments.push(current);
        current = `${headerText}\n${row}`;
      } else current = `${current}\n${row}`;
    }
    if (current !== headerText) segments.push(current);
    return segments;
  }
  const units = raw.split(/\n\s*\n|(?=^\s*(?:[-*+] |\d+[.)] ))/gmu);
  const segments: string[] = [];
  let current = '';
  for (const unit of units) {
    if (unit.length > MAX_TEXT_COMPONENT_CHARS) return [];
    if (current.length > 0 && current.length + unit.length + 2 > MAX_TEXT_COMPONENT_CHARS) {
      segments.push(current);
      current = unit;
    } else current = current.length === 0 ? unit : `${current}\n\n${unit}`;
  }
  if (current.length > 0) segments.push(current);
  return segments;
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

export function parseUnderstandingMarkdown(input: {
  markdown: string;
  sourceVersionId: string;
  filename: string;
}): UnderstandingDocumentIndex {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(input.markdown);
  const lines = input.markdown.split(/\r?\n/u);
  const headingStack: string[] = [];
  const components: UnderstandingDocumentComponent[] = [];
  const chapters = emptyChapters();
  let currentChapter: UnderstandingChapter | null = null;
  let title: string | null = null;

  visitParents(tree, (node, ancestors) => {
    const parent = ancestors.at(-1);
    if (parent?.type !== 'root') return;
    const content = node as RootContent;
    const text = toString(content).trim();
    if (content.type === 'heading') {
      if (content.depth === 1 && title === null) title = text;
      headingStack.splice(content.depth - 1);
      headingStack[content.depth - 1] = text;
      const recognized = classifyUnderstandingChapterHeading(text);
      if (recognized !== null) currentChapter = recognized;
    }
    const raw = rawForNode(lines, content);
    const kind = componentKind(content);
    const segments = splitTextComponent(raw, kind);
    const pointer: UnderstandingSourcePointer = {
      sourceVersionId: input.sourceVersionId,
      filename: input.filename,
      headingPath: [...headingStack].filter(Boolean),
      startLine: content.position?.start.line ?? null,
      endLine: content.position?.end.line ?? null,
      jsonPointer: null,
      page: null,
      boundingBox: null,
      excerptHash: digest(raw),
    };
    const component: UnderstandingDocumentComponent = {
      id: `${input.sourceVersionId}:${String(pointer.startLine ?? components.length + 1)}`,
      kind,
      text,
      raw,
      headingPath: pointer.headingPath,
      chapter: currentChapter,
      sourcePointer: pointer,
      coverageStatus:
        kind === 'heading' || text.length === 0 ? 'ignored_with_reason' : 'unclassified',
      coverageReason:
        kind === 'heading'
          ? 'Tiêu đề được dùng để xác định cấu trúc.'
          : text.length === 0
            ? 'Thành phần không có nội dung.'
            : segments.length === 0
              ? 'Thành phần vượt giới hạn và không thể chia an toàn.'
              : 'Chưa được bộ trích xuất nhận.',
      segments,
      node: content,
    };
    if (
      currentChapter === null &&
      kind !== 'heading' &&
      components.some(item => item.kind === 'heading')
    ) {
      component.coverageStatus = 'ignored_with_reason';
      component.coverageReason = 'Phần mở đầu của tài liệu được giữ làm ngữ cảnh.';
    }
    if (segments.length === 0 && kind !== 'heading') {
      component.coverageStatus = 'unsupported';
    }
    components.push(component);
    if (currentChapter !== null) chapters[currentChapter].push(component);
  });

  return {
    sourceVersionId: input.sourceVersionId,
    filename: input.filename,
    title,
    components,
    chapters,
  };
}

export function markComponent(
  component: UnderstandingDocumentComponent,
  status: UnderstandingCoverageStatus,
  reason: string
): void {
  component.coverageStatus = status;
  component.coverageReason = reason;
}
