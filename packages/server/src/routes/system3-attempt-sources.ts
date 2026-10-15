import { System3ConflictError, type System3SourceRecord, type System3Store } from '@anvil/system3';

export async function resolveSystem3LifecycleAttemptSources(input: {
  store: System3Store;
  projectId: string;
}): Promise<System3SourceRecord[]> {
  const attempt = await input.store.getActiveLifecycleAttempt(input.projectId);
  if (attempt?.lifecycleStatus !== 'active') {
    return input.store.listActiveSources(input.projectId);
  }
  if (attempt.basis.sourceVersionIds.length !== attempt.basis.sourceHashes.length) {
    throw new System3ConflictError('Source Version và hash của lượt chạy không đầy đủ');
  }
  const sources = await Promise.all(
    attempt.basis.sourceVersionIds.map(sourceVersionId =>
      input.store.getSourceVersion(input.projectId, sourceVersionId)
    )
  );
  const resolved: System3SourceRecord[] = [];
  for (const [index, source] of sources.entries()) {
    if (source?.storageStatus !== 'ready') {
      throw new System3ConflictError('Một Source Version đã ghim không còn khả dụng');
    }
    if (source.contentHash !== attempt.basis.sourceHashes[index]) {
      throw new System3ConflictError(
        'Source Version đã ghim không còn khớp với hash của lượt chạy'
      );
    }
    resolved.push(source);
  }
  return resolved;
}
