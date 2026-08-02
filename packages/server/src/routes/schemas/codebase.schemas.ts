/**
 * Zod schemas for codebase API endpoints.
 */
import { z } from '@hono/zod-openapi';
import { codebaseRowSchema } from '@anvil/core/schemas/codebase';

/** A codebase record (wire shape with ISO string dates). */
export const codebaseSchema = codebaseRowSchema
  .extend({
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .openapi('Codebase');

/** GET /api/codebases response. */
export const codebaseListResponseSchema = z.array(codebaseSchema).openapi('CodebaseListResponse');

/** Path params for routes with :id (codebase ID). */
export const codebaseIdParamsSchema = z.object({ id: z.string() });

const newProjectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
    message: 'Project name may contain only letters, numbers, dots, underscores, and hyphens',
  });

/** POST /api/codebases request body. Exactly one registration mode must be provided. */
export const addCodebaseBodySchema = z
  .object({
    url: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    create: z.object({ name: newProjectNameSchema }).optional(),
  })
  .refine(b => [b.url, b.path, b.create].filter(value => value !== undefined).length === 1, {
    message: 'Provide exactly one of "url", "path", or "create"',
  })
  .openapi('AddCodebaseBody');

/** DELETE /api/codebases/:id response. */
export const deleteCodebaseResponseSchema = z
  .object({ success: z.boolean() })
  .openapi('DeleteCodebaseResponse');

/** Response for GET /api/codebases/:id/env — returns only keys, never values */
export const codebaseEnvVarsResponseSchema = z
  .object({
    keys: z.array(z.string()),
  })
  .openapi('CodebaseEnvVarsResponse');

/** Body for PUT /api/codebases/:id/env — upsert one key-value pair */
export const setEnvVarBodySchema = z
  .object({
    key: z.string().min(1).max(255),
    value: z.string(),
  })
  .openapi('SetEnvVarBody');

/** Path params for routes with :id/:key */
export const codebaseEnvVarParamsSchema = z.object({
  id: z.string(),
  key: z.string(),
});

/** Response for PUT/DELETE /api/codebases/:id/env */
export const envVarMutationResponseSchema = z
  .object({ success: z.boolean() })
  .openapi('EnvVarMutationResponse');

export const codebaseWorkflowIntakeParamsSchema = z.object({
  id: z.string(),
  workflowName: z.string().min(1),
});

export const workflowIntakeDraftSchema = z
  .object({
    id: z.string(),
    codebaseId: z.string(),
    workflowName: z.string(),
    definitionHash: z.string(),
    status: z.enum(['draft', 'ready', 'starting', 'started', 'discarded']),
    values: z.record(z.string(), z.unknown()),
    currentField: z.string().nullable(),
    validationErrors: z.array(z.string()),
    startedRunId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowIntakeDraft');

export const patchWorkflowIntakeBodySchema = z
  .object({
    values: z.record(z.string(), z.unknown()).optional(),
    currentField: z.string().nullable().optional(),
  })
  .openapi('PatchWorkflowIntakeBody');

export const startWorkflowIntakeBodySchema = z
  .object({
    conversationId: z.string().min(1),
    message: z.string().min(1).default('Start workflow from confirmed intake'),
  })
  .openapi('StartWorkflowIntakeBody');

export const workflowIntakeStartResponseSchema = z
  .object({ accepted: z.boolean(), status: z.string(), runId: z.string().nullable() })
  .openapi('WorkflowIntakeStartResponse');

export const workflowIntakeChatBodySchema = z
  .object({
    conversationId: z.string().min(1),
    message: z.string().trim().min(1),
  })
  .openapi('WorkflowIntakeChatBody');

export const workflowIntakeChatResponseSchema = z
  .object({
    draft: workflowIntakeDraftSchema,
    state: z.enum(['collecting', 'review', 'confirmed', 'stopped']),
    shouldStart: z.boolean(),
  })
  .openapi('WorkflowIntakeChatResponse');

export const workflowIntakeAttachmentResponseSchema = z
  .object({
    draft: workflowIntakeDraftSchema,
    state: z.enum(['collecting', 'review']),
    attachment: z.object({
      input: z.string(),
      name: z.string(),
      path: z.string(),
      size: z.number().int().nonnegative(),
      mime: z.string(),
      sha256: z.string(),
    }),
  })
  .openapi('WorkflowIntakeAttachmentResponse');
