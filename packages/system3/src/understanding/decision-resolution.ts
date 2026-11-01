import type { BlueprintAnalysis } from '../contracts';
import type { BlueprintDecision, DatasetProfileV2, UnderstandingDecisionBinding } from './schemas';

export interface UnderstandingDecisionAnswer {
  binding: UnderstandingDecisionBinding | null;
  status: 'pending' | 'answered';
  answer: string | null;
}

/**
 * Applies answered blueprint reviews. The source pointers of an added requirement are the finding's
 * own, and its id says it did not come from System 2.
 */
function applyBlueprintReviews(
  resolved: Extract<BlueprintAnalysis, { schemaVersion: 2 }>,
  decisions: readonly UnderstandingDecisionAnswer[]
): void {
  const applied: BlueprintDecision[] = [];
  for (const decision of decisions) {
    const binding = decision.binding;
    if (binding?.kind !== 'blueprint_review' || decision.status !== 'answered') continue;
    const option = binding.options.find(item => item.value === decision.answer);
    if (!option) throw new Error('Selected review option is outside the recorded finding');
    if (option.effect === 'add_requirement' && option.newRequirement) {
      const anchor = resolved.requirements[0]?.sourcePointers;
      if (!anchor) throw new Error('A requirement cannot be added to a blueprint without any');
      resolved.requirements.push({
        id: `ADD-${binding.findingId.slice(0, 6)}`,
        kind: 'FR',
        priority: null,
        source: 'Người dùng chấp nhận đề xuất của Anvil',
        statement: option.newRequirement.statement,
        acceptanceCriterion: option.newRequirement.acceptanceCriterion,
        sourcePointer: 'blueprint-review',
        sourcePointers: anchor,
      });
    }
    applied.push({
      findingId: binding.findingId,
      title: binding.title,
      quote: binding.quote,
      requirementId: binding.requirementId,
      answer: option.label,
      effect: option.effect,
      instruction: option.instruction,
    });
  }
  if (applied.length > 0) resolved.blueprintDecisions = applied;
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
  applyBlueprintReviews(resolved, decisions);
  return resolved;
}
