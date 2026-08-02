import { describe, expect, test } from 'bun:test';
import { elapsedSince, formatClock, formatRelativeToBaseline } from './format';

describe('console time formatting', () => {
  test('renders backend UTC timestamps in Vietnam time', () => {
    expect(formatClock('2026-07-15 09:19:57')).toBe('16:19:57');
  });

  test('treats timezone-less SQLite timestamps as UTC for elapsed time', () => {
    expect(elapsedSince('2026-07-15 09:19:57', '2026-07-15 09:20:02')).toBe(5);
  });

  test('keeps relative event offsets independent of display timezone', () => {
    expect(formatRelativeToBaseline('2026-07-15 09:21:02', '2026-07-15 09:19:57')).toBe('+01:05');
  });
});
