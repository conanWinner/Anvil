import { describe, expect, test } from 'bun:test';
import { describeTrialParams, editsFromParams, parseParamEdits } from './experiment-params-view';

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

test('describeTrialParams shows only what changed', () => {
  expect(describeTrialParams(defaults.rf, defaults.rf)).toBe('mặc định');
  expect(describeTrialParams({ ...defaults.rf, n_estimators: 50 }, defaults.rf)).toBe(
    'n_estimators = 50'
  );
  expect(describeTrialParams(null, defaults.rf)).toBe('không báo tham số');
});
