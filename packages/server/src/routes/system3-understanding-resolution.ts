import {
  applyUnderstandingDecisionAnswers,
  profileDatasetCsvStream,
  streamSystem3Source,
  type BlueprintAnalysis,
  type System3Store,
  type UnderstandingDecisionAnswer,
} from '@anvil/system3';

/** Resolve answers against immutable source bytes, never the current source alias. */
export async function resolvePinnedUnderstandingAnalysis(input: {
  projectId: string;
  analysis: BlueprintAnalysis;
  inputSnapshotId: string | null;
  decisions: readonly UnderstandingDecisionAnswer[];
  store: Pick<System3Store, 'listUnderstandingInputSnapshots' | 'getSourceVersion'>;
  getArtifactsRoot: () => Promise<string>;
}): Promise<BlueprintAnalysis> {
  if (input.analysis.schemaVersion !== 2) {
    return applyUnderstandingDecisionAnswers(input.analysis, input.decisions);
  }
  let selectedTarget: string | null = null;
  for (const decision of input.decisions) {
    if (
      decision.binding?.kind === 'dataset_target_column' &&
      decision.status === 'answered' &&
      decision.answer !== null
    ) {
      if (selectedTarget !== null && selectedTarget !== decision.answer) {
        throw new Error('Conflicting Dataset target decisions require resolution');
      }
      selectedTarget = decision.answer;
    }
  }
  const currentProfile = input.analysis.datasetUnderstanding.profile;
  if (selectedTarget === null || currentProfile?.targetColumn === selectedTarget) {
    return applyUnderstandingDecisionAnswers(input.analysis, input.decisions);
  }
  if (input.inputSnapshotId === null) {
    throw new Error('Pinned Understanding input is unavailable for Dataset reprofiling');
  }
  const inputSnapshot = (await input.store.listUnderstandingInputSnapshots(input.projectId)).find(
    snapshot => snapshot.id === input.inputSnapshotId
  );
  const pinnedRef = inputSnapshot?.sourceRefs.find(
    source =>
      source.sourceVersionId === currentProfile?.sourceVersionId && source.kind === 'dataset'
  );
  if (!inputSnapshot || !pinnedRef || !currentProfile) {
    throw new Error('Pinned Dataset Source Version is unavailable for the selected target');
  }
  const source = await input.store.getSourceVersion(input.projectId, pinnedRef.sourceVersionId);
  if (
    source?.storageStatus !== 'ready' ||
    source.kind !== 'dataset' ||
    source.contentHash !== pinnedRef.contentHash
  ) {
    throw new Error('Pinned Dataset Source Version no longer matches the Understanding input');
  }
  const reprofiledDataset = await profileDatasetCsvStream({
    filename: source.filename,
    sourceVersionId: source.id,
    chunks: streamSystem3Source({
      artifactsRoot: await input.getArtifactsRoot(),
      storageKey: source.storageKey,
    }),
    expectedContentHash: pinnedRef.contentHash,
    targetColumn: selectedTarget,
  });
  return applyUnderstandingDecisionAnswers(input.analysis, input.decisions, reprofiledDataset);
}
