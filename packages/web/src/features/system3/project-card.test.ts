import { describe, expect, test } from 'bun:test';
import { presentProjectCard } from './project-card';

describe('presentProjectCard', () => {
  test('uses plain-language stage labels', () => {
    expect(
      presentProjectCard({ stage: 'delivered', attention: 'none', freshness: 'current' })
    ).toMatchObject({ label: 'Đã bàn giao', tone: 'good' });
    expect(
      presentProjectCard({ stage: 'executing', attention: 'none', freshness: 'current' })
    ).toMatchObject({ label: 'Đang chạy', tone: 'running' });
  });

  test('lets failures, staleness and required input win over the stage', () => {
    expect(
      presentProjectCard({ stage: 'delivered', attention: 'failed', freshness: 'stale' }).label
    ).toBe('Gặp lỗi');
    expect(
      presentProjectCard({ stage: 'delivered', attention: 'none', freshness: 'partially_stale' })
        .label
    ).toBe('Cần chạy lại');
    expect(
      presentProjectCard({ stage: 'draft', attention: 'input_required', freshness: 'current' })
        .label
    ).toBe('Cần bổ sung');
  });
});
