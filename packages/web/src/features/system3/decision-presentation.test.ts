import { describe, expect, test } from 'bun:test';
import { presentDecisionQuestion } from './decision-presentation';

describe('presentDecisionQuestion', () => {
  test('extracts the issue and suggestion from a manual-review JSON record', () => {
    const result = presentDecisionQuestion(
      '- {"tag":"[Manual Review Required]","issue":"Cần xác nhận mức giải thích.","suggestion":"Chọn global hoặc local."}'
    );

    expect(result.summary).toBe('Cần xác nhận mức giải thích.');
    expect(result.suggestion).toBe('Chọn global hoặc local.');
    expect(result.showOriginal).toBe(true);
  });

  test('removes the manual-review marker from plain Markdown text', () => {
    const result = presentDecisionQuestion(
      '- [Manual Review Required] Xác nhận ngưỡng định lượng trước khi sử dụng.'
    );

    expect(result.summary).toBe('Xác nhận ngưỡng định lượng trước khi sử dụng.');
    expect(result.suggestion).toBeNull();
    expect(result.showOriginal).toBe(true);
  });

  test('uses the fallback as friendly copy for a structured field review', () => {
    const result = presentDecisionQuestion(
      '{"field":"data_profile.feature_availability","fallback":"Giả định có thể sử dụng bảng giao dịch.","severity":"WARN","suggestion":"Yêu cầu người dùng kiểm tra."}'
    );

    expect(result.summary).toBe('Giả định có thể sử dụng bảng giao dịch.');
    expect(result.suggestion).toBe('Yêu cầu người dùng kiểm tra.');
    expect(result.showOriginal).toBe(true);
  });

  test('keeps an ordinary decision question unchanged', () => {
    const result = presentDecisionQuestion('Chọn cột mục tiêu cho Dataset.');

    expect(result.summary).toBe('Chọn cột mục tiêu cho Dataset.');
    expect(result.suggestion).toBeNull();
    expect(result.showOriginal).toBe(false);
  });
});
