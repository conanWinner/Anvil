import { describe, expect, test } from 'bun:test';
import { friendlyDecisionQuestion } from './system3-activity-resources';

describe('friendlyDecisionQuestion', () => {
  test('presents a manual-review marker as readable text', () => {
    expect(
      friendlyDecisionQuestion(
        '- {"tag":"[Manual Review Required]","issue":"Người dùng chưa chọn cách giải thích.","suggestion":"Xác nhận với người dùng."}'
      )
    ).toBe('Người dùng chưa chọn cách giải thích.');
  });

  test('removes a plain marker without changing the project question', () => {
    expect(friendlyDecisionQuestion('[Manual Review Required] Chọn ngưỡng cảnh báo')).toBe(
      'Chọn ngưỡng cảnh báo'
    );
  });
});
