import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeBlueprintMarkdown, profileDatasetCsv } from './blueprint';

test('extracts the canonical DESIGN_B_2 facts', async () => {
  const blueprint = await readFile(
    resolve(import.meta.dir, '../../../docs/system_2/DESIGN_B_2.md'),
    'utf8'
  );
  const analysis = analyzeBlueprintMarkdown(blueprint, null);
  expect(analysis.requirements).toHaveLength(13);
  expect(analysis.targetDefinition).toContain('90 ngày');
  expect(analysis.runtime).toEqual({ cpuOnly: true, ramGb: 8 });
  expect(analysis.modules).toHaveLength(12);
  expect(analysis.manualReviews).toHaveLength(5);
  expect(analysis.requirements[0]?.sourcePointer).toBe('blueprint.md:132');
});

test('profiles a target column without making an ML claim', () => {
  expect(profileDatasetCsv('sample.csv', 'id,target\n1,yes\n2,no\n')).toMatchObject({
    rowCount: 2,
    targetExists: true,
    targetDistribution: { yes: 1, no: 1 },
  });
});
