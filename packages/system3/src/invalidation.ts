import type { System3SourceKind } from './contracts';

export const system3PhaseOrder = [
  'understanding',
  'readiness',
  'data',
  'features',
  'experiments',
  'explainability',
  'delivery',
] as const;

export type System3PhaseId = (typeof system3PhaseOrder)[number];

const downstream: Readonly<Record<System3PhaseId, readonly System3PhaseId[]>> = {
  understanding: ['readiness', 'data'],
  readiness: ['data'],
  data: ['features', 'experiments'],
  features: ['experiments'],
  experiments: ['explainability', 'delivery'],
  explainability: ['delivery'],
  delivery: [],
};

const sourceRoots: Readonly<Record<System3SourceKind, readonly System3PhaseId[]>> = {
  blueprint: ['understanding'],
  dataset: ['understanding', 'data'],
  constraints: ['readiness', 'data'],
  data_dictionary: ['understanding', 'data'],
  user_brief: ['understanding'],
  supporting_document: ['understanding'],
};

/** Return the deterministic dependency closure used by invalidation and rerun previews. */
export function affectedPhasesForSource(kind: System3SourceKind): System3PhaseId[] {
  const affected = new Set<System3PhaseId>();
  const pending = [...sourceRoots[kind]];
  while (pending.length > 0) {
    const phase = pending.shift();
    if (phase === undefined || affected.has(phase)) continue;
    affected.add(phase);
    pending.push(...downstream[phase]);
  }
  return system3PhaseOrder.filter(phase => affected.has(phase));
}
