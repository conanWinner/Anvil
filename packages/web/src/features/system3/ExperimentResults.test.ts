import { describe, expect, test } from 'bun:test';
import { coverageText } from './ExperimentResults';

describe('coverageText', () => {
  test('counts criteria against every requirement, not only the checked ones', () => {
    const text = coverageText({ total: 6, criteriaPassed: 1, notVerified: 5 });
    expect(text).toContain('1/6 yêu cầu có kiểm tra đạt');
    expect(text).toContain('5 yêu cầu chưa được kiểm chứng');
  });

  test('says which requirements the user removed', () => {
    expect(coverageText({ total: 6, criteriaPassed: 1, notVerified: 4, removed: 1 })).toContain(
      '1 yêu cầu đã bỏ theo quyết định của bạn'
    );
  });

  test('never reports a coverage number when the denominator is unknown', () => {
    for (const coverage of [{ total: null }, null]) {
      const text = coverageText(coverage);
      expect(text).toContain('Chưa biết độ phủ');
      expect(text).not.toMatch(/\d\/\d/u);
    }
  });
});
