import { describe, expect, spyOn, test } from 'bun:test';
import { getExecutionRequest, latestProjectOperation, system3Store } from './store';
import type { System3OperationResponse } from '@/lib/api';

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

  test('selects the newest operation from project history', () => {
    const operation = (id: string, createdAt: string): System3OperationResponse => ({
      id,
      projectId: 'project-1',
      executionId: null,
      type: 'analyze',
      status: 'succeeded',
      idempotencyKey: `key-${id}`,
      error: null,
      requestFingerprint: 'fingerprint',
      projectVersion: 1,
      result: null,
      workflowRunId: null,
      ownerInstanceId: null,
      heartbeatAt: null,
      startedAt: null,
      finishedAt: null,
      createdAt,
      updatedAt: createdAt,
    });
    const older = { ...operation('older', '2026-01-01T00:00:00Z'), projectVersion: 3 };
    const newer = { ...operation('newer', '2026-01-01T00:00:00Z'), projectVersion: 4 };
    expect(latestProjectOperation([newer, older])).toBe(newer);
    expect(latestProjectOperation([older, newer])).toBe(newer);
    expect(latestProjectOperation([operation('later', '2026-01-02T00:00:00Z'), newer])?.id).toBe(
      'later'
    );
    const intake = operation('intake', '2026-01-01T00:00:00Z');
    const analysis = {
      ...operation('analysis', '2026-01-01T00:00:00Z'),
      updatedAt: '2026-01-01T00:00:03Z',
    };
    expect(latestProjectOperation([analysis, intake])).toBe(analysis);
    expect(latestProjectOperation([intake, analysis])).toBe(analysis);
    expect(latestProjectOperation([])).toBeUndefined();
  });

  test('stops operation observation when its AbortSignal is aborted', async () => {
    let historyRequests = 0;
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async () => {
          historyRequests += 1;
          return new Response(JSON.stringify({ operations: [] }), {
            headers: { 'Content-Type': 'application/json' },
          });
        },
        { preconnect: (): void => {} }
      )
    );
    const controller = new AbortController();
    try {
      const observation = system3Store.watchOperations('project-1', controller.signal, () => {});
      while (historyRequests === 0) await Promise.resolve();
      controller.abort();
      await observation;
      expect(historyRequests).toBe(1);
    } finally {
      controller.abort();
      fetchSpy.mockRestore();
    }
  });

  test('reuses the execution request key for the same plan after a reload', () => {
    const values = new Map<string, string>();
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: {
        getItem: (key: string): string | null => values.get(key) ?? null,
        setItem: (key: string, value: string): void => {
          values.set(key, value);
        },
      },
    });
    try {
      const first = getExecutionRequest('project-1', 'compilation-1', 7);
      expect(getExecutionRequest('project-1', 'compilation-1', 8)).toEqual(first);
      expect(getExecutionRequest('project-1', 'compilation-2', 7)).not.toEqual(first);
      expect(() => getExecutionRequest('project-1', 'compilation-3', Number.NaN)).toThrow(
        'Project version không hợp lệ'
      );
      values.set(
        'system3:execute:project-1:compilation-4',
        JSON.stringify({ idempotencyKey: '  ', expectedVersion: 7, status: 'pending' })
      );
      expect(() => getExecutionRequest('project-1', 'compilation-4', 7)).toThrow(
        'Không thể đọc hoặc lưu request chống chạy trùng'
      );
      values.set(
        'system3:execute:project-1:compilation-5',
        JSON.stringify({ idempotencyKey: 'key', expectedVersion: 7, status: 'succeeded' })
      );
      expect(getExecutionRequest('project-1', 'compilation-5', 8)).toEqual({
        idempotencyKey: 'key',
        expectedVersion: 7,
      });
    } finally {
      if (originalDescriptor)
        Object.defineProperty(globalThis, 'sessionStorage', originalDescriptor);
      else Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
  });

  test('reports blocked session storage instead of submitting without an idempotency key', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: (): never => {
        throw new Error('storage disabled');
      },
    });
    try {
      expect(() => getExecutionRequest('project-1', 'compilation-1', 1)).toThrow(
        'Không thể đọc hoặc lưu request chống chạy trùng'
      );
    } finally {
      if (originalDescriptor)
        Object.defineProperty(globalThis, 'sessionStorage', originalDescriptor);
      else Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
  });
});
