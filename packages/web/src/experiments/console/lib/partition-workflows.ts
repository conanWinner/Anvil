/**
 * Partition a filtered workflow list into recommended (declared order) and rest.
 * Moved from legacy components/workflows/ into the console lib.
 */
export function partitionWorkflows<T extends { name: string }>(
  filtered: T[],
  recommendedNames: readonly string[]
): { recommended: T[]; rest: T[] } {
  if (recommendedNames.length === 0) return { recommended: [], rest: filtered };
  const byName = new Map(filtered.map(wf => [wf.name, wf]));
  const unique = [...new Set(recommendedNames)];
  const recommendedSet = new Set(unique);
  const recommended = unique.map(n => byName.get(n)).filter((wf): wf is T => wf !== undefined);
  const rest = filtered.filter(wf => !recommendedSet.has(wf.name));
  return { recommended, rest };
}
