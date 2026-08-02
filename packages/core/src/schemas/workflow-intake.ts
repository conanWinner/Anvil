import { z } from '@hono/zod-openapi';

export const workflowIntakeDraftStatusSchema = z.enum([
  'draft',
  'ready',
  'starting',
  'started',
  'discarded',
]);

export const workflowIntakeDraftRowSchema = z.object({
  id: z.string(),
  codebase_id: z.string(),
  workflow_name: z.string(),
  conversation_id: z.string().nullable().default(null),
  definition_hash: z.string(),
  status: workflowIntakeDraftStatusSchema,
  values: z.union([z.string(), z.record(z.string(), z.unknown())]),
  current_field: z.string().nullable(),
  validation_errors: z.union([z.string(), z.array(z.string())]),
  started_run_id: z.string().nullable(),
  created_by_user_id: z.string().nullable(),
  updated_by_user_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type WorkflowIntakeDraftStatus = z.infer<typeof workflowIntakeDraftStatusSchema>;
export type WorkflowIntakeDraftRow = z.infer<typeof workflowIntakeDraftRowSchema>;
