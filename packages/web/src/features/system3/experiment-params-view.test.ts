import { describe, expect, test } from 'bun:test';
import {
  describeTrialParams,
  editsFromLatestTrials,
  editsFromParams,
  parseParamEdits,
} from './experiment-params-view';

const defaults = {
  rf: { n_estimators: 100, max_depth: null, criterion: 'gini', bootstrap: true },
};

describe('parseParamEdits', () => {
  test('sends only values that differ from the default, with the default type', () => {
    expect(
      parseParamEdits(
        defaults,
        { rf: { n_estimators: '200', max_depth: '6', criterion: 'gini', bootstrap: 'false' } },
        ['rf']
      )
    ).toEqual({
      overrides: { rf: { n_estimators: 200, max_depth: 6, bootstrap: false } },
      errors: [],
    });
  });

  test('reports a bad value instead of guessing', () => {
    const result = parseParamEdits(defaults, { rf: { n_estimators: 'nhiều', bootstrap: 'có' } }, [
      'rf',
    ]);
    expect(result.overrides).toEqual({});
    expect(result.errors).toHaveLength(2);
  });

  test('an empty number is an error, not zero', () => {
    expect(parseParamEdits(defaults, { rf: { n_estimators: ' ' } }, ['rf']).errors).toHaveLength(1);
  });

  test('ignores variants that are not selected and names the build does not know', () => {
    expect(
      parseParamEdits(defaults, { rf: { n_estimators: '5', nope: '1' } }, []).overrides
    ).toEqual({});
    expect(parseParamEdits(defaults, { rf: { nope: '1' } }, ['rf']).overrides).toEqual({});
  });

  test('a tried setting round-trips through the inputs back to its overrides', () => {
    const edits = { rf: editsFromParams({ ...defaults.rf, n_estimators: 50, max_depth: 3 }) };
    expect(parseParamEdits(defaults, edits, ['rf']).overrides).toEqual({
      rf: { n_estimators: 50, max_depth: 3 },
    });
  });
});

test('editsFromLatestTrials restores the last setting tried for each variant', () => {
  const edits = editsFromLatestTrials([
    { round: 2, variant: 'rf', params: { ...defaults.rf, max_depth: 6 } },
    { round: 1, variant: 'rf', params: { ...defaults.rf, max_depth: 3 } },
    { round: 3, variant: 'rf', params: null },
    { round: 1, variant: 'lr', params: null },
  ]);
  expect(Object.keys(edits)).toEqual(['rf']);
  expect(parseParamEdits(defaults, edits, ['rf']).overrides).toEqual({ rf: { max_depth: 6 } });
});

test('a value the code derived is not treated as something the person changed', () => {
  const trial = {
    round: 1,
    variant: 'rf',
    params: { ...defaults.rf, n_estimators: 137 },
    requested: {},
  };
  expect(parseParamEdits(defaults, editsFromLatestTrials([trial]), ['rf']).overrides).toEqual({});
  expect(describeTrialParams(trial, defaults.rf)).toBe('mặc định');
});

test('describeTrialParams shows only what changed', () => {
  expect(describeTrialParams({ params: defaults.rf }, defaults.rf)).toBe('mặc định');
  expect(describeTrialParams({ params: { ...defaults.rf, n_estimators: 50 } }, defaults.rf)).toBe(
    'n_estimators = 50'
  );
  expect(describeTrialParams({ params: null }, defaults.rf)).toBe('không báo tham số');
  expect(describeTrialParams({ params: null, requested: { max_depth: 6 } }, defaults.rf)).toBe(
    'max_depth = 6'
  );
});
