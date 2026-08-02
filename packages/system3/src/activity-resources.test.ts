import { describe, expect, test } from 'bun:test';
import {
  system3ActivityViewSchema,
  system3LifecycleActivityIdSchema,
  system3ResourcePresentationSchema,
} from './activity-resources';

describe('System 3 activity resource contracts', () => {
  test('keeps the canonical ten Lifecycle Activities in product order', () => {
    expect(system3LifecycleActivityIdSchema.options).toEqual([
      'OP-00',
      'OP-01',
      'TW-02',
      'TW-03',
      'OP-04',
      'OP-05',
      'TW-06',
      'TW-07',
      'OP-08',
      'TW-09',
    ]);
  });

  test('requires friendly presentation blocks and keeps raw data outside the payload', () => {
    const value = system3ResourcePresentationSchema.parse({
      resource: {
        id: '00000000-0000-4000-8000-000000000001',
        resourceType: 'knowledge_snapshot',
        activityId: 'TW-02',
        relation: 'output',
        title: 'Bản hiểu dự án',
        summary: 'Project đã được hiểu từ input bất biến.',
        status: 'current',
        version: 1,
        createdAt: '2026-07-29T00:00:00.000Z',
        mediaType: 'application/json',
        schemaVersion: '1',
        producer: {
          operationId: null,
          workflowRunId: 'run-1',
          workflowNodeId: null,
        },
        sourceVersionIds: [],
        parentResourceIds: [],
        staleReason: null,
        hasPresentation: true,
        hasDownload: true,
      },
      rendererVersion: 'system3-resource-renderer@1',
      title: 'Bản hiểu dự án',
      summary: 'Project đã được hiểu từ input bất biến.',
      blocks: [
        {
          kind: 'callout',
          tone: 'info',
          title: 'Anvil hiểu project như sau',
          body: 'Mục tiêu giữ chân khách hàng.',
        },
      ],
      technicalDetailsAvailable: true,
      downloadUrl:
        '/api/system3/projects/project-1/resources/knowledge_snapshot/resource-1/content',
      raw: { mustNotLeak: true },
    });

    expect(value.blocks[0]?.kind).toBe('callout');
    expect('raw' in value).toBe(false);
  });

  test('separates inputs, outputs and evidence in an activity view', () => {
    const value = system3ActivityViewSchema.parse({
      activityId: 'TW-07',
      executionKind: 'workflow',
      title: 'Xác minh kết quả độc lập',
      description: 'Kiểm tra artifact bằng validator độc lập.',
      status: 'not_started',
      inputs: [],
      outputs: [],
      evidence: [],
      technicalResources: [],
      history: [],
    });

    expect(value.activityId).toBe('TW-07');
    expect(value.inputs).toEqual([]);
    expect(value.evidence).toEqual([]);
    expect(value.technicalResources).toEqual([]);
  });
});
