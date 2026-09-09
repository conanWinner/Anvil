import { createHash } from 'node:crypto';
import type { UnderstandingSourcePointer } from './schemas';

export interface SupplementalFact {
  key: string;
  value: unknown;
  sourcePointer: UnderstandingSourcePointer;
}

function flatten(value: unknown, prefix = ''): [string, unknown][] {
  if (value === null || typeof value !== 'object') return [[prefix || '/', value]];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flatten(item, `${prefix}/${String(index)}`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
    flatten(item, `${prefix}/${key.replace(/~/gu, '~0').replace(/\//gu, '~1')}`)
  );
}

export function readSupplementalStructuredSource(input: {
  text: string;
  sourceVersionId: string;
  filename: string;
  mediaType: string;
}): SupplementalFact[] {
  const extension = input.filename.slice(input.filename.lastIndexOf('.')).toLowerCase();
  const parsed: unknown =
    extension === '.json' || input.mediaType.includes('json')
      ? (JSON.parse(input.text) as unknown)
      : Bun.YAML.parse(input.text);
  return flatten(parsed).map(([key, value]) => ({
    key,
    value,
    sourcePointer: {
      sourceVersionId: input.sourceVersionId,
      filename: input.filename,
      headingPath: [],
      startLine: null,
      endLine: null,
      jsonPointer: key,
      page: null,
      boundingBox: null,
      excerptHash: `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`,
    },
  }));
}
