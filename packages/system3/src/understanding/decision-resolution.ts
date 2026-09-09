import type { BlueprintAnalysis } from '../contracts';
import type { DatasetProfileV2, UnderstandingDecisionBinding } from './schemas';

export interface UnderstandingDecisionAnswer {
  binding: UnderstandingDecisionBinding | null;
  status: 'pending' | 'answered';
  answer: string | null;
}

/**
 * Projects a pinned Knowledge Snapshot through its separately persisted answers.
 * The original snapshot remains immutable; callers must persist the resulting
 * plan or contract together with the answers that were used.
 */
export function applyUnderstandingDecisionAnswers(
  analysis: BlueprintAnalysis,
  decisions: readonly UnderstandingDecisionAnswer[],
  reprofiledDataset?: DatasetProfileV2
): BlueprintAnalysis {
  if (analysis.schemaVersion !== 2) return analysis;
  const resolved = structuredClone(analysis);
  for (const decision of decisions) {
    if (
      decision.binding?.kind !== 'dataset_target_column' ||
      decision.status !== 'answered' ||
      decision.answer === null
    ) {
      continue;
    }
    if (!decision.binding.allowedValues.includes(decision.answer)) {
      throw new Error('Selected target column is outside the recorded Dataset schema');
    }
    const profile = resolved.datasetUnderstanding.profile;
    if (!profile?.columns.some(column => column.name === decision.answer)) {
      throw new Error('Selected target column is absent from the profiled Dataset');
    }
    if (profile.targetColumn !== decision.answer) {
      if (reprofiledDataset === undefined) {
        throw new Error(
          'Selected target column requires the pinned Dataset Source Version to be profiled again'
        );
      }
      if (
        reprofiledDataset.sourceVersionId !== profile.sourceVersionId ||
        reprofiledDataset.targetColumn !== decision.answer ||
        !reprofiledDataset.targetExists ||
        (profile.rowFingerprint !== undefined &&
          reprofiledDataset.rowFingerprint !== profile.rowFingerprint)
      ) {
        throw new Error('Reprofiled Dataset does not match the selected target or pinned source');
      }
    }
    const effectiveProfile = structuredClone(
      profile.targetColumn === decision.answer ? profile : (reprofiledDataset ?? profile)
    );
    resolved.datasetUnderstanding.declaration = {
      ...(resolved.datasetUnderstanding.declaration ?? {
        availability: 'declared_unverified',
        unitOfAnalysis: null,
        targetDefinition: resolved.targetDefinition,
        expectedColumns: [],
        constraints: [],
        sourcePointers: [],
      }),
      targetColumn: decision.answer,
    };
    resolved.datasetUnderstanding.profile = {
      ...effectiveProfile,
    };
    resolved.datasetUnderstanding.issues = resolved.datasetUnderstanding.issues.filter(
      issue => issue.decisionBinding?.kind !== 'dataset_target_column'
    );
    resolved.datasetUnderstanding.comparisonStatus =
      resolved.datasetUnderstanding.issues.length === 0 ? 'matched' : 'mismatch';
    if (resolved.dataset !== null) {
      resolved.dataset = {
        ...resolved.dataset,
        filename: effectiveProfile.filename,
        rowCount: effectiveProfile.rowCount,
        columnCount: effectiveProfile.columnCount,
        columns: effectiveProfile.columns.map(column => column.name),
        targetColumn: effectiveProfile.targetColumn,
        targetExists: effectiveProfile.targetExists,
        targetDistribution: effectiveProfile.targetDistribution,
      };
    }
  }
  return resolved;
}
