import { createHash } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join, normalize, sep } from 'node:path';
import type { System3SourceKind } from './contracts';

function safeFilename(filename: string): string {
  const clean = basename(filename).replace(/[^A-Za-z0-9._-]/g, '_');
  return clean.length > 0 ? clean : 'source';
}

function safePath(artifactsRoot: string, storageKey: string): string {
  const root = normalize(artifactsRoot);
  const candidate = normalize(join(root, storageKey));
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`))
    throw new Error('Unsafe System 3 artifact path');
  return candidate;
}

export interface StoredSystem3Source {
  filename: string;
  contentHash: string;
  sizeBytes: number;
  storageKey: string;
  created: boolean;
}

export interface StagedSystem3Source {
  filename: string;
  contentHash: string;
  sizeBytes: number;
  temporaryStorageKey: string;
  storageKey: string;
}

async function verifyStoredBytes(
  path: string,
  expectedHash: string,
  expectedSizeBytes: number
): Promise<void> {
  const storedBytes = await readFile(path);
  const storedHash = `sha256:${createHash('sha256').update(storedBytes).digest('hex')}`;
  if (storedHash !== expectedHash || storedBytes.byteLength !== expectedSizeBytes) {
    throw new Error('Persisted System 3 source failed content verification');
  }
}

/**
 * Writes the request body into an operation-owned staging location. Retrying
 * the same operation is safe: an existing staged file must match byte-for-byte.
 */
export async function stageSystem3Source(input: {
  artifactsRoot: string;
  operationId: string;
  kind: System3SourceKind;
  filename: string;
  bytes: Uint8Array;
}): Promise<StagedSystem3Source> {
  const filename = safeFilename(input.filename);
  const contentHash = `sha256:${createHash('sha256').update(input.bytes).digest('hex')}`;
  const hash = contentHash.slice('sha256:'.length);
  const temporaryStorageKey = join('sources', '.pending', input.operationId, 'content');
  const storageKey = join('sources', input.kind, hash, 'content');
  const temporaryPath = safePath(input.artifactsRoot, temporaryStorageKey);
  await mkdir(join(temporaryPath, '..'), { recursive: true });
  await writeFile(temporaryPath, input.bytes, { flag: 'wx' }).catch(error => {
    const code = error as NodeJS.ErrnoException;
    if (code.code !== 'EEXIST') throw error;
  });
  await verifyStoredBytes(temporaryPath, contentHash, input.bytes.byteLength);
  return {
    filename,
    contentHash,
    sizeBytes: input.bytes.byteLength,
    temporaryStorageKey,
    storageKey,
  };
}

/**
 * Atomically makes a staged blob visible at its immutable Source Version
 * location. A hard link gives us no-overwrite semantics on the same volume;
 * an existing target must still match the pinned bytes.
 */
export async function promoteSystem3Source(input: {
  artifactsRoot: string;
  staged: StagedSystem3Source;
  storageKey?: string;
}): Promise<StoredSystem3Source> {
  const storageKey = input.storageKey ?? input.staged.storageKey;
  const temporaryPath = safePath(input.artifactsRoot, input.staged.temporaryStorageKey);
  const path = safePath(input.artifactsRoot, storageKey);
  let stagedExists = true;
  await verifyStoredBytes(temporaryPath, input.staged.contentHash, input.staged.sizeBytes).catch(
    async error => {
      const code = error as NodeJS.ErrnoException;
      if (code.code !== 'ENOENT') throw error;
      stagedExists = false;
      // A process may stop after the atomic promotion but before committing
      // the database state. In that case the immutable canonical blob is the
      // recovery source of truth and must still match the pinned hash/size.
      await verifyStoredBytes(path, input.staged.contentHash, input.staged.sizeBytes);
    }
  );
  await mkdir(join(path, '..'), { recursive: true });
  let created = false;
  if (stagedExists) {
    created = true;
    await link(temporaryPath, path).catch(error => {
      const code = error as NodeJS.ErrnoException;
      if (code.code !== 'EEXIST') throw error;
      created = false;
    });
  }
  await verifyStoredBytes(path, input.staged.contentHash, input.staged.sizeBytes);
  await unlink(temporaryPath).catch(error => {
    const code = error as NodeJS.ErrnoException;
    if (code.code !== 'ENOENT') throw error;
  });
  return {
    filename: input.staged.filename,
    contentHash: input.staged.contentHash,
    sizeBytes: input.staged.sizeBytes,
    storageKey,
    created,
  };
}

export async function discardStagedSystem3Source(
  artifactsRoot: string,
  temporaryStorageKey: string
): Promise<void> {
  await unlink(safePath(artifactsRoot, temporaryStorageKey)).catch(error => {
    const code = error as NodeJS.ErrnoException;
    if (code.code !== 'ENOENT') throw error;
  });
}

export async function persistSystem3Source(input: {
  artifactsRoot: string;
  kind: System3SourceKind;
  filename: string;
  bytes: Uint8Array;
}): Promise<StoredSystem3Source> {
  const staged = await stageSystem3Source({
    ...input,
    operationId: `legacy-${createHash('sha256')
      .update(`${input.kind}:${input.filename}`)
      .update(input.bytes)
      .digest('hex')}`,
  });
  return promoteSystem3Source({ artifactsRoot: input.artifactsRoot, staged });
}

export function system3SourceVersionStorageKey(input: {
  kind: System3SourceKind;
  sourceId: string;
  lineageVersion: number;
  contentHash: string;
  filename: string;
}): string {
  const hash = input.contentHash.slice('sha256:'.length);
  const version = input.lineageVersion.toString().padStart(3, '0');
  return join(
    'sources',
    input.kind,
    input.sourceId,
    `v${version}_${hash}`,
    safeFilename(input.filename)
  );
}

export async function readSystem3Source(input: {
  artifactsRoot: string;
  storageKey: string;
}): Promise<Uint8Array> {
  return readFile(safePath(input.artifactsRoot, input.storageKey));
}

export async function persistSystem3Artifact(input: {
  artifactsRoot: string;
  storageKey: string;
  body: unknown;
}): Promise<string> {
  const path = safePath(input.artifactsRoot, input.storageKey);
  const bytes = Buffer.from(`${JSON.stringify(input.body, null, 2)}\n`);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, bytes, { flag: 'wx' }).catch(async error => {
    const code = error as NodeJS.ErrnoException;
    if (code.code !== 'EEXIST') throw error;
    const existing = await readFile(path);
    if (!existing.equals(bytes)) {
      throw new Error('Immutable System 3 artifact already exists with different content');
    }
  });
  return input.storageKey;
}

export async function persistSystem3BinaryArtifact(input: {
  artifactsRoot: string;
  category: string;
  filename: string;
  bytes: Uint8Array;
}): Promise<{ storageKey: string; contentHash: string; sizeBytes: number; filename: string }> {
  const filename = safeFilename(input.filename);
  const category = safeFilename(input.category);
  const contentHash = `sha256:${createHash('sha256').update(input.bytes).digest('hex')}`;
  const storageKey = join(category, contentHash.slice('sha256:'.length, 26), filename);
  const path = safePath(input.artifactsRoot, storageKey);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, input.bytes, { flag: 'wx' }).catch(async error => {
    const code = error as NodeJS.ErrnoException;
    if (code.code !== 'EEXIST') throw error;
  });
  return { storageKey, contentHash, sizeBytes: input.bytes.byteLength, filename };
}

export async function readSystem3Artifact(input: {
  artifactsRoot: string;
  storageKey: string;
}): Promise<Uint8Array> {
  return readFile(safePath(input.artifactsRoot, input.storageKey));
}
