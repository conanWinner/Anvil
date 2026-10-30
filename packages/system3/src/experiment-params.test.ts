import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chooseProbeOverride,
  findIgnoredOverrides,
  findOverrideProblems,
  readReportedParams,
} from './experiment-params';

describe('chooseProbeOverride', () => {
  test('moves a whole number up and a fraction down, staying in a plausible range', () => {
    expect(chooseProbeOverride({ n_estimators: 300, subsample: 0.8 })).toEqual({
      n_estimators: 301,
    });
    expect(chooseProbeOverride({ subsample: 0.8 })).toEqual({ subsample: 0.4 });
  });

  test('skips values at the edge of a range and non-numeric values', () => {
    expect(chooseProbeOverride({ C: 1, l1_ratio: 0, solver: 'lbfgs', fit: true })).toBeNull();
    expect(chooseProbeOverride({ seed_offset: -3 })).toBeNull();
  });
});

describe('findOverrideProblems', () => {
  const defaults = { rf: { n_estimators: 100, max_depth: null, criterion: 'gini' } };

  test('accepts known names, and any scalar where the default is null', () => {
    expect(
      findOverrideProblems(defaults, { rf: { n_estimators: 50, max_depth: 4, criterion: 'log' } })
    ).toEqual([]);
  });

  test('rejects unknown variants, unknown names and changed types', () => {
    expect(findOverrideProblems(defaults, { xgb: { eta: 0.1 } })).toHaveLength(1);
    expect(findOverrideProblems(defaults, { rf: { depth: 1 } })).toHaveLength(1);
    expect(findOverrideProblems(defaults, { rf: { n_estimators: '50' } })).toHaveLength(1);
  });

  test('a prototype name is not a parameter', () => {
    expect(findOverrideProblems(defaults, { rf: { constructor: 1 } })).toHaveLength(1);
  });
});

test('findIgnoredOverrides lists what the run did not report using', () => {
  expect(findIgnoredOverrides({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual(['b']);
  expect(findIgnoredOverrides({ a: 1 }, null)).toEqual(['a']);
  expect(findIgnoredOverrides({}, null)).toEqual([]);
});

describe('readReportedParams', () => {
  const write = async (content: string): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), 'anvil-params-'));
    await mkdir(join(root, 'reported'));
    await writeFile(join(root, 'reported', 'rf.json'), content);
    return root;
  };

  test('reads the flat params object', async () => {
    const root = await write(JSON.stringify({ params: { n: 3 }, train_rows: 9 }));
    expect(await readReportedParams(root, 'rf')).toEqual({ n: 3 });
  });

  test('returns null for missing, malformed or nested params', async () => {
    expect(await readReportedParams(await write('{not json'), 'rf')).toBeNull();
    expect(await readReportedParams(await write('{"train_rows": 1}'), 'rf')).toBeNull();
    expect(await readReportedParams(await write('{"params": {"a": {"b": 1}}}'), 'rf')).toBeNull();
    expect(await readReportedParams(await write('null'), 'rf')).toBeNull();
  });

  test('never follows a link written by agent code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'anvil-params-'));
    await writeFile(join(root, 'secret.json'), '{"params": {"leaked": 1}}');
    await mkdir(join(root, 'reported'));
    await symlink(join(root, 'secret.json'), join(root, 'reported', 'rf.json'));
    expect(await readReportedParams(root, 'rf')).toBeNull();
  });
});
