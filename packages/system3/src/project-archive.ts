import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export const PROJECT_ARCHIVE_LIMITS = {
  compressedBytes: 64 * 1024 * 1024,
  expandedBytes: 128 * 1024 * 1024,
  fileBytes: 64 * 1024 * 1024,
  entries: 4096,
} as const;

interface ArchiveEntry {
  path: string;
  directory: boolean;
  bytes: Uint8Array;
}

function field(header: Buffer, start: number, length: number): string {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return new TextDecoder('utf-8', { fatal: true }).decode(end < 0 ? bytes : bytes.subarray(0, end));
}

function octal(header: Buffer, start: number, length: number): number {
  const value = field(header, start, length).trim();
  if (!/^[0-7]+$/.test(value)) throw new Error('Invalid archive numeric field');
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed)) throw new Error('Invalid archive numeric field');
  return parsed;
}

export function validateProjectArchive(archive: Uint8Array): ArchiveEntry[] {
  if (archive.byteLength > PROJECT_ARCHIVE_LIMITS.compressedBytes)
    throw new Error('Project archive exceeds the compressed-size limit');
  let tar: Buffer;
  try {
    tar = gunzipSync(archive, { maxOutputLength: PROJECT_ARCHIVE_LIMITS.expandedBytes });
  } catch (cause) {
    throw new Error('Project archive is invalid or exceeds the expanded-size limit', { cause });
  }
  const entries: ArchiveEntry[] = [];
  const paths = new Set<string>();
  let root: string | undefined;
  let offset = 0;
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (tar.byteLength - offset < 1024 || tar.subarray(offset).some(byte => byte !== 0))
        throw new Error('Invalid project archive trailer');
      if (entries.length === 0) throw new Error('Project archive is empty');
      return entries;
    }
    if (entries.length >= PROJECT_ARCHIVE_LIMITS.entries)
      throw new Error('Project archive exceeds the entry-count limit');
    const checksum = header.reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0
    );
    if (checksum !== octal(header, 148, 8)) throw new Error('Invalid archive header checksum');
    const magic = header.toString('ascii', 257, 263);
    if (magic !== 'ustar\0' && magic !== 'ustar ')
      throw new Error('Project archive contains an unsupported header format');
    // ponytail: only regular files/directories in GNU/USTAR archives; add a vetted
    // parser before supporting PAX, long names, links, sparse files or special devices.
    const type = header[156];
    if (type !== 0 && type !== 48 && type !== 53)
      throw new Error('Project archive contains a link or unsupported entry type');
    // GNU tar uses this area for atime/ctime and sparse metadata, not USTAR prefix.
    const prefix = magic === 'ustar\0' ? field(header, 345, 155) : '';
    const name = `${prefix ? `${prefix}/` : ''}${field(header, 0, 100)}`;
    const directory = type === 53;
    const path = directory ? name.replace(/\/$/, '') : name;
    const parts = path.split('/');
    if (
      /[\\:]/.test(path) ||
      Array.from(path).some(
        character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      ) ||
      parts.some(part => part === '' || part === '.' || part === '..') ||
      (root !== undefined && parts[0] !== root) ||
      (parts.length === 1 && !directory) ||
      paths.has(path)
    )
      throw new Error('Project archive contains an unsafe or duplicate path');
    root = parts[0];
    paths.add(path);
    const size = octal(header, 124, 12);
    if (size > PROJECT_ARCHIVE_LIMITS.fileBytes)
      throw new Error('Project archive exceeds the file-size limit');
    if (directory && size !== 0) throw new Error('Invalid archive directory size');
    const end = offset + 512 + Math.ceil(size / 512) * 512;
    if (end > tar.byteLength) throw new Error('Project archive is truncated');
    entries.push({
      path: parts.slice(1).join('/'),
      directory,
      bytes: tar.subarray(offset + 512, offset + 512 + size),
    });
    offset = end;
  }
  throw new Error('Project archive is missing its trailer');
}

export async function extractProjectArchive(
  archive: Uint8Array,
  destination: string,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted();
  const entries = validateProjectArchive(archive);
  // A new directory and exclusive files prevent overwriting existing data or following links.
  await mkdir(destination);
  for (const entry of entries) {
    signal.throwIfAborted();
    if (entry.path === '') continue;
    const path = join(destination, entry.path);
    if (entry.directory) await mkdir(path, { recursive: true });
    else {
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, entry.bytes, { flag: 'wx', mode: 0o600 });
    }
  }
}
