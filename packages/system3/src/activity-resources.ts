import { z } from '@hono/zod-openapi';

export const system3LifecycleActivityIdSchema = z.enum([
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
export type System3LifecycleActivityId = z.infer<typeof system3LifecycleActivityIdSchema>;

export const system3ResourceTypeSchema = z.enum([
  'source_version',
  'source_intake_report',
  'impact_manifest',
  'dependency_graph_snapshot',
  'input_snapshot',
  'knowledge_snapshot',
  'decision',
  'readiness_contract',
  'execution_plan',
  'approval_manifest',
  'execution_artifact',
  'verification_report',
  'evidence',
  'delivery_request',
  'delivery_manifest',
  'delivery_package',
  'workflow_run',
]);
export type System3ResourceType = z.infer<typeof system3ResourceTypeSchema>;

export const system3ResourceRelationSchema = z.enum(['input', 'output', 'evidence']);
export type System3ResourceRelation = z.infer<typeof system3ResourceRelationSchema>;

export const system3ResourceStatusSchema = z.enum([
  'pending',
  'current',
  'stale',
  'superseded',
  'failed',
]);
export type System3ResourceStatus = z.infer<typeof system3ResourceStatusSchema>;

export const system3ResourceProducerSchema = z.object({
  operationId: z.string().uuid().nullable(),
  workflowRunId: z.string().nullable(),
  workflowNodeId: z.string().nullable(),
});
export type System3ResourceProducer = z.infer<typeof system3ResourceProducerSchema>;

export const system3ResourceDescriptorSchema = z.object({
  id: z.string().min(1),
  resourceType: system3ResourceTypeSchema,
  activityId: system3LifecycleActivityIdSchema,
  relation: system3ResourceRelationSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  status: system3ResourceStatusSchema,
  version: z.number().int().positive().nullable(),
  createdAt: z.string().datetime().nullable(),
  mediaType: z.string().min(1),
  schemaVersion: z.string().nullable(),
  producer: system3ResourceProducerSchema,
  sourceVersionIds: z.array(z.string().uuid()),
  parentResourceIds: z.array(z.string().min(1)),
  staleReason: z.string().nullable(),
  hasPresentation: z.boolean(),
  hasDownload: z.boolean(),
});
export type System3ResourceDescriptor = z.infer<typeof system3ResourceDescriptorSchema>;

const presentationFactSchema = z.object({
  label: z.string(),
  value: z.string(),
  tone: z.enum(['neutral', 'positive', 'warning', 'danger']).optional(),
});

export const system3PresentationBlockSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('callout'),
    tone: z.enum(['info', 'success', 'warning', 'danger']),
    title: z.string().nullable(),
    body: z.string(),
  }),
  z.object({
    kind: z.literal('facts'),
    title: z.string().nullable(),
    items: z.array(presentationFactSchema),
  }),
  z.object({ kind: z.literal('markdown'), markdown: z.string() }),
  z.object({
    kind: z.literal('table'),
    title: z.string().nullable(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
    truncated: z.boolean(),
  }),
  z.object({
    kind: z.literal('checklist'),
    title: z.string().nullable(),
    items: z.array(
      z.object({
        label: z.string(),
        status: z.enum(['passed', 'warning', 'failed', 'pending']),
        detail: z.string().nullable(),
      })
    ),
  }),
  z.object({
    kind: z.literal('timeline'),
    title: z.string().nullable(),
    items: z.array(
      z.object({ title: z.string(), detail: z.string(), at: z.string().datetime().nullable() })
    ),
  }),
  z.object({
    kind: z.literal('fileTree'),
    title: z.string().nullable(),
    files: z.array(
      z.object({ path: z.string(), sizeBytes: z.number().int().nonnegative().nullable() })
    ),
    truncated: z.boolean(),
  }),
  z.object({
    kind: z.literal('evidence'),
    title: z.string().nullable(),
    items: z.array(
      z.object({
        requirement: z.string(),
        status: z.string(),
        proof: z.array(z.string()),
        reason: z.string().nullable(),
      })
    ),
  }),
  z.object({
    kind: z.literal('download'),
    label: z.string(),
    filename: z.string(),
    sizeBytes: z.number().int().nonnegative().nullable(),
  }),
]);
export type System3PresentationBlock = z.infer<typeof system3PresentationBlockSchema>;

export const system3ResourcePresentationSchema = z.object({
  resource: system3ResourceDescriptorSchema,
  rendererVersion: z.string(),
  title: z.string(),
  summary: z.string(),
  blocks: z.array(system3PresentationBlockSchema),
  technicalDetailsAvailable: z.boolean(),
  downloadUrl: z.string().nullable(),
});
export type System3ResourcePresentation = z.infer<typeof system3ResourcePresentationSchema>;

export const system3ActivityHistoryItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  status: z.string(),
  createdAt: z.string().datetime().nullable(),
  resource: system3ResourceDescriptorSchema.nullable().optional(),
});

export const system3ActivityViewSchema = z.object({
  activityId: system3LifecycleActivityIdSchema,
  executionKind: z.enum(['operation', 'workflow']),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  inputs: z.array(system3ResourceDescriptorSchema),
  outputs: z.array(system3ResourceDescriptorSchema),
  evidence: z.array(system3ResourceDescriptorSchema),
  technicalResources: z.array(system3ResourceDescriptorSchema),
  history: z.array(system3ActivityHistoryItemSchema),
});
export type System3ActivityView = z.infer<typeof system3ActivityViewSchema>;
