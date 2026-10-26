import { describe, expect, test } from 'bun:test';
import { executeSystem3ProjectBodySchema } from './schemas/system3.schemas';

describe('System 3 execution request', () => {
  test('accepts either an existing approval or an explicit compilation to approve', () => {
    const expectedVersion = 7;

    expect(
      executeSystem3ProjectBodySchema.safeParse({
        approvalId: '11111111-1111-4111-8111-111111111111',
        expectedVersion,
      }).success
    ).toBe(true);
    expect(
      executeSystem3ProjectBodySchema.safeParse({
        compilationId: '22222222-2222-4222-8222-222222222222',
        expectedVersion,
      }).success
    ).toBe(true);
    expect(
      executeSystem3ProjectBodySchema.safeParse({
        approvalId: '11111111-1111-4111-8111-111111111111',
        compilationId: '22222222-2222-4222-8222-222222222222',
        expectedVersion,
      }).success
    ).toBe(false);
  });

  test('requires a positive integer version and rejects unrecognized request fields', () => {
    expect(
      executeSystem3ProjectBodySchema.safeParse({
        compilationId: '22222222-2222-4222-8222-222222222222',
        expectedVersion: 0,
      }).success
    ).toBe(false);
    expect(
      executeSystem3ProjectBodySchema.safeParse({
        approvalId: '11111111-1111-4111-8111-111111111111',
        expectedVersion: 7,
        ignored: true,
      }).success
    ).toBe(false);
  });
});
