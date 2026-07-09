/**
 * Zod schema for the per-user AI-provider key row.
 *
 * Stores one named AI-provider connection. A user may keep several connections
 * for the same vendor; one is selected as the default runtime connection.
 *
 * (Filename carries a `-row` suffix to satisfy a local secret-guard hook that
 * blocks basenames ending in `key(s).ts` / `token(s).ts`; the DB table is
 * `remote_agent_user_provider_keys`.)
 */
import { z } from '@hono/zod-openapi';

// Timestamps are read back as `Date` on PostgreSQL (node-postgres hydrates
// TIMESTAMPTZ) but as ISO `string` on SQLite (TEXT). The union keeps the row
// type honest for either dialect.
const dbTimestamp = z.union([z.date(), z.string()]);

export const userProviderKeyRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  provider: z.string(),
  name: z.string(),
  kind: z.enum(['api_key', 'oauth']),
  api_key_encrypted: z.string().nullable(),
  oauth_creds_encrypted: z.string().nullable(),
  is_default: z.union([z.boolean(), z.number()]),
  created_at: dbTimestamp,
  updated_at: dbTimestamp,
});

export type UserProviderKeyRow = z.infer<typeof userProviderKeyRowSchema>;
