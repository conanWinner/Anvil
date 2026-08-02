import { z } from '@hono/zod-openapi';
import { projectMemoryCategorySchema } from '@anvil/core/schemas/project-memory';

export const projectMemoryParamsSchema = z.object({ codebaseId: z.string() });
export const projectMemoryEntryParamsSchema = z.object({
  codebaseId: z.string(),
  entryId: z.string(),
});
export const projectMemoryEntrySchema = z.object({
  id: z.string(),
  codebase_id: z.string(),
  source_conversation_id: z.string().nullable(),
  source_conversation_title: z.string().nullable(),
  category: projectMemoryCategorySchema,
  content: z.string(),
  origin: z.enum(['extracted', 'manual']),
  user_edited: z.boolean(),
  pinned: z.boolean(),
  active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export const projectMemoryListSchema = z.object({ entries: z.array(projectMemoryEntrySchema) });
export const projectMemoryHandoffBodySchema = z.object({ conversationId: z.string() });
export const projectMemoryHandoffResponseSchema = z.object({
  updated: z.boolean(),
  entries: z.number().int().nonnegative(),
});
export const createProjectMemoryEntryBodySchema = z.object({
  category: projectMemoryCategorySchema,
  content: z.string().min(1).max(1000),
  pinned: z.boolean().optional(),
});
export const updateProjectMemoryEntryBodySchema = z.object({
  category: projectMemoryCategorySchema.optional(),
  content: z.string().min(1).max(1000).optional(),
  pinned: z.boolean().optional(),
});
