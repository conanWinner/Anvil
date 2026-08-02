import { z } from '@hono/zod-openapi';

export const projectMemoryCategorySchema = z.enum([
  'decision',
  'requirement',
  'constraint',
  'preference',
  'fact',
]);

export const projectMemoryOriginSchema = z.enum(['extracted', 'manual']);
export const memoryHandoffStatusSchema = z.enum(['processing', 'completed', 'failed']);

export const projectMemoryEntryRowSchema = z.object({
  id: z.string(),
  codebase_id: z.string(),
  source_conversation_id: z.string().nullable(),
  handoff_id: z.string().nullable(),
  category: projectMemoryCategorySchema,
  content: z.string(),
  origin: projectMemoryOriginSchema,
  user_edited: z.boolean(),
  pinned: z.boolean(),
  active: z.boolean(),
  created_by_user_id: z.string().nullable(),
  updated_by_user_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const conversationMemoryHandoffRowSchema = z.object({
  id: z.string(),
  codebase_id: z.string(),
  conversation_id: z.string(),
  status: memoryHandoffStatusSchema,
  source_last_message_id: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable(),
});

export type ProjectMemoryCategory = z.infer<typeof projectMemoryCategorySchema>;
export type ProjectMemoryOrigin = z.infer<typeof projectMemoryOriginSchema>;
export type ProjectMemoryEntryRow = z.infer<typeof projectMemoryEntryRowSchema>;
export type ConversationMemoryHandoffRow = z.infer<typeof conversationMemoryHandoffRowSchema>;
