/**
 * Turns a verification evidence map into Evidence records. A requirement is recorded as `passed`
 * only by a mode that verifies whole requirements (model comparison). In experiment mode, passing
 * approved criteria stays `not_verified` at requirement level, and each criterion has its own row
 * with no requirement id, so nothing can read one check as proof of a whole requirement.
 */

export interface ProjectedEvidence {
  requirementId: string | null;
  status: 'passed' | 'failed' | 'not_verified';
  evidence: string[];
  reason: string | null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === 'object' && !Array.isArray(item)
      )
    : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function requirementStatus(kind: unknown, status: unknown): ProjectedEvidence['status'] {
  if (kind === 'model_comparison' && status === 'passed') return 'passed';
  if (kind === 'experiment' && status === 'failed') return 'failed';
  return 'not_verified';
}

export function projectVerificationEvidence(map: Record<string, unknown>): ProjectedEvidence[] {
  const requirements = records(map.requirements).map(
    (value): ProjectedEvidence => ({
      requirementId: typeof value.requirementId === 'string' ? value.requirementId : null,
      status: requirementStatus(map.kind, value.status),
      evidence:
        map.kind === 'model_comparison' && typeof map.inputHash === 'string'
          ? [map.inputHash]
          : map.kind === 'experiment'
            ? strings(value.criteria)
            : [],
      reason: typeof value.reason === 'string' ? value.reason : 'Outside the approved MVP scope',
    })
  );
  const mvpChecks = records(map.mvpChecks).map(
    (value): ProjectedEvidence => ({
      requirementId: null,
      status: value.status === 'passed' ? 'passed' : 'failed',
      evidence: [typeof value.id === 'string' ? value.id : 'MVP-CHECK'],
      reason: null,
    })
  );
  const contractChecks = records(map.contractChecks).map(
    (value): ProjectedEvidence => ({
      requirementId: null,
      status:
        value.status === 'passed'
          ? 'passed'
          : value.status === 'failed'
            ? 'failed'
            : 'not_verified',
      evidence: [value.criterionId, value.fixtureHash].filter(
        (item): item is string => typeof item === 'string'
      ),
      reason: typeof value.reason === 'string' ? value.reason : null,
    })
  );
  return [...mvpChecks, ...contractChecks, ...requirements];
}
