import { expect, test } from 'bun:test';
import { within } from './sandbox-process';

test('within only accepts the root itself or paths below it', () => {
  expect(within('/work/a', '/work/a')).toBe(true);
  expect(within('/work/a', '/work/a/b')).toBe(true);
  expect(within('/work/a', '/work/ab')).toBe(false);
  // Same length prefix position holds a separator but the path is elsewhere.
  expect(within('/tmp/xyz/build', '/tmp/abc/runs/x')).toBe(false);
  expect(within('/work/a/', '/work/a/b')).toBe(true);
});
