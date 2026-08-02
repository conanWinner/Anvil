import { describe, expect, test } from 'bun:test';
import { system3Store } from './store';

describe('system3Store', () => {
  test('starts from an explicit empty project until an API flow is loaded', () => {
    expect(system3Store.getSnapshot()).toMatchObject({
      id: '',
      stage: 'draft',
      phases: [],
      planCompiled: false,
      manifestApproved: false,
    });
  });

  test('fails fast when approval is attempted before compilation', async () => {
    expect(system3Store.approve()).rejects.toThrow('Compile preview trước khi approve');
  });
});
