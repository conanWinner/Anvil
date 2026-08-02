-- Remote Coding Agent - Combined Schema
-- Version: Combined (final state after migrations 001-020)
-- Description: Complete database schema (idempotent - safe to run multiple times)
--
-- 14 Tables (+ the remote_agent_auth_* Better Auth tables, listed inline below):
--   1. remote_agent_codebases
--   1b. remote_agent_codebase_env_vars
--   1c. remote_agent_users
--   1d. remote_agent_user_identities
--   2. remote_agent_conversations
--   3. remote_agent_sessions
--   4. remote_agent_isolation_environments
--   5. remote_agent_workflow_runs
--   6. remote_agent_workflow_events
--   6b. remote_agent_workflow_node_sessions
--   7. remote_agent_messages
--   8. remote_agent_user_github_tokens
--   9. remote_agent_user_provider_keys
--   10. remote_agent_user_ai_prefs
--
-- Dropped tables (via migrations):
--   - remote_agent_command_templates (017)
--
-- Dropped columns (via migrations):
--   - conversations.worktree_path (007)
--   - conversations.isolation_env_id_legacy (007)
--   - conversations.isolation_provider (007)

-- ============================================================================
-- Table 1: Codebases
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_codebases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  repository_url VARCHAR(500),
  default_cwd VARCHAR(500) NOT NULL,
  default_branch VARCHAR(255),
  ai_assistant_type VARCHAR(20) DEFAULT 'claude',
  allow_env_keys BOOLEAN NOT NULL DEFAULT FALSE,
  commands JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE remote_agent_codebases IS
  'Repository metadata: name, URL, working directory, default branch, AI assistant type, and command paths (JSONB)';

-- ============================================================================
-- Table 1b: Codebase Env Vars
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_codebase_env_vars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codebase_id UUID NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,
  key VARCHAR(255) NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(codebase_id, key)
);

CREATE INDEX IF NOT EXISTS idx_codebase_env_vars_codebase_id
  ON remote_agent_codebase_env_vars(codebase_id);

COMMENT ON TABLE remote_agent_codebase_env_vars IS
  'Per-project env vars merged into Options.env on Claude SDK calls. Managed via Web UI or config.';

-- ============================================================================
-- Table 1c: Users (Anvil identity, platform-agnostic)
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name VARCHAR(255),
  email VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE remote_agent_users IS
  'Anvil-internal user identity. Created on first sight by any adapter; populated via per-platform user-info lookups.';

-- ============================================================================
-- Table 1d: User Identities (per-platform mapping → users.id)
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
  platform VARCHAR(32) NOT NULL,
  platform_user_id VARCHAR(255) NOT NULL,
  platform_display_name VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(platform, platform_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_id
  ON remote_agent_user_identities(user_id);

COMMENT ON TABLE remote_agent_user_identities IS
  'Maps platform-native user IDs (Slack U-ids, Telegram chat ids, GitHub logins, Discord snowflakes) to Anvil user UUIDs.';

-- ============================================================================
-- Table 2: Conversations
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_type VARCHAR(20) NOT NULL,
  platform_conversation_id VARCHAR(255) NOT NULL,
  codebase_id UUID REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
  cwd VARCHAR(500),
  ai_assistant_type VARCHAR(20) DEFAULT 'claude',
  isolation_env_id UUID,  -- FK added after isolation_environments table exists
  title VARCHAR(255),
  client_request_id VARCHAR(128),
  deleted_at TIMESTAMP WITH TIME ZONE,
  hidden BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(platform_type, platform_conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_remote_agent_conversations_codebase
  ON remote_agent_conversations(codebase_id);
CREATE INDEX IF NOT EXISTS idx_conversations_hidden
  ON remote_agent_conversations(hidden);
CREATE INDEX IF NOT EXISTS idx_conversations_codebase
  ON remote_agent_conversations(codebase_id) WHERE deleted_at IS NULL;
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS client_request_id VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_client_request_id
  ON remote_agent_conversations(client_request_id) WHERE client_request_id IS NOT NULL;

COMMENT ON COLUMN remote_agent_conversations.isolation_env_id IS
  'UUID reference to isolation_environments table (the only isolation reference)';

-- ============================================================================
-- Table 3: Sessions
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES remote_agent_conversations(id) ON DELETE CASCADE,
  codebase_id UUID REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
  ai_assistant_type VARCHAR(20) NOT NULL,
  assistant_session_id VARCHAR(255),
  active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb,
  parent_session_id UUID REFERENCES remote_agent_sessions(id),
  transition_reason TEXT,
  ended_reason TEXT,
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_remote_agent_sessions_conversation
  ON remote_agent_sessions(conversation_id, active);
CREATE INDEX IF NOT EXISTS idx_remote_agent_sessions_codebase
  ON remote_agent_sessions(codebase_id);
CREATE INDEX IF NOT EXISTS idx_sessions_parent
  ON remote_agent_sessions(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_conversation_started
  ON remote_agent_sessions(conversation_id, started_at DESC);

COMMENT ON COLUMN remote_agent_sessions.parent_session_id IS
  'Links to the previous session in this conversation (for audit trail)';
COMMENT ON COLUMN remote_agent_sessions.transition_reason IS
  'Why this session was created: plan-to-execute, isolation-changed, reset-requested, etc.';
COMMENT ON COLUMN remote_agent_sessions.ended_reason IS
  'Why this session was deactivated: reset-requested, cwd-changed, conversation-closed, etc.';

-- ============================================================================
-- Table 4: Isolation Environments
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_isolation_environments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codebase_id           UUID NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,

  -- Workflow identification (what work this is for)
  workflow_type         TEXT NOT NULL,        -- 'issue', 'pr', 'review', 'thread', 'task'
  workflow_id           TEXT NOT NULL,        -- '42', 'pr-99', 'thread-abc123'

  -- Implementation details
  provider              TEXT NOT NULL DEFAULT 'worktree',
  working_path          TEXT NOT NULL,        -- Actual filesystem path
  branch_name           TEXT NOT NULL,        -- Git branch name

  -- Lifecycle
  status                TEXT NOT NULL DEFAULT 'active',  -- 'active', 'destroyed'
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by_platform   TEXT,                 -- 'github', 'slack', etc.

  -- Cross-reference metadata (for linking)
  metadata              JSONB DEFAULT '{}'
);

-- Partial unique index: only active environments need uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_workflow
  ON remote_agent_isolation_environments (codebase_id, workflow_type, workflow_id)
  WHERE status = 'active';

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_isolation_env_codebase
  ON remote_agent_isolation_environments(codebase_id);
CREATE INDEX IF NOT EXISTS idx_isolation_env_status
  ON remote_agent_isolation_environments(status);
CREATE INDEX IF NOT EXISTS idx_isolation_env_workflow
  ON remote_agent_isolation_environments(workflow_type, workflow_id);

-- Add FK from conversations to isolation_environments (deferred to avoid circular dependency)
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS isolation_env_id UUID
    REFERENCES remote_agent_isolation_environments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_isolation_env_id
  ON remote_agent_conversations(isolation_env_id);

COMMENT ON TABLE remote_agent_isolation_environments IS
  'Work-centric isolated environments with independent lifecycle';
COMMENT ON COLUMN remote_agent_isolation_environments.workflow_type IS
  'Type of work: issue, pr, review, thread, task';
COMMENT ON COLUMN remote_agent_isolation_environments.workflow_id IS
  'Identifier for the work (issue number, PR number, thread hash, etc.)';

-- ============================================================================
-- Table 5: Workflow Runs
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name VARCHAR(255) NOT NULL,
  conversation_id UUID REFERENCES remote_agent_conversations(id) ON DELETE CASCADE,
  codebase_id UUID REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
  current_step_index INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed
  user_message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  parent_conversation_id UUID REFERENCES remote_agent_conversations(id) ON DELETE SET NULL,
  parent_workflow_run_id UUID REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  parent_node_id VARCHAR(255),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  working_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_conversation
  ON remote_agent_workflow_runs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status
  ON remote_agent_workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_parent_conv
  ON remote_agent_workflow_runs(parent_conversation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_parent_node_unique
  ON remote_agent_workflow_runs(parent_workflow_run_id, parent_node_id)
  WHERE parent_workflow_run_id IS NOT NULL;

-- Partial index for efficient staleness queries on running workflows
CREATE INDEX IF NOT EXISTS idx_workflow_runs_last_activity
  ON remote_agent_workflow_runs(last_activity_at)
  WHERE status = 'running';

COMMENT ON TABLE remote_agent_workflow_runs IS
  'Tracks workflow execution state for resumption and observability';

-- ============================================================================
-- Table 6: Workflow Events
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_workflow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  step_index INTEGER,
  step_name VARCHAR(255),
  data JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workflow_events_run_id
  ON remote_agent_workflow_events(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_events_type
  ON remote_agent_workflow_events(event_type);
-- Global created_at index for the dashboard event poller's cross-run tail
-- (WHERE created_at >= $1 ORDER BY created_at ASC).
CREATE INDEX IF NOT EXISTS idx_workflow_events_created_at
  ON remote_agent_workflow_events(created_at);

COMMENT ON TABLE remote_agent_workflow_events IS
  'Lean UI-relevant workflow events for observability (step transitions, artifacts, errors)';

-- ============================================================================
-- Workflow node sessions (persist_session opt-in across re-runs)
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_workflow_node_sessions (
  workflow_name VARCHAR(255) NOT NULL,
  node_id VARCHAR(255) NOT NULL,
  scope_key TEXT NOT NULL,
  provider VARCHAR(50) NOT NULL,
  provider_session_id TEXT NOT NULL,
  last_run_id UUID REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (workflow_name, node_id, scope_key, provider)
);

CREATE INDEX IF NOT EXISTS idx_workflow_node_sessions_scope
  ON remote_agent_workflow_node_sessions(scope_key);
CREATE INDEX IF NOT EXISTS idx_workflow_node_sessions_workflow
  ON remote_agent_workflow_node_sessions(workflow_name);

COMMENT ON TABLE remote_agent_workflow_node_sessions IS
  'Per-node provider session IDs persisted across workflow re-runs. Keyed by (workflow, node, scope, provider). Scope is typically conversation UUID. No cascade on conversation delete (soft delete + never-reused UUID = harmless orphans); a future hard-delete path must delete by scope_key.';

-- ============================================================================
-- Table 7: Messages
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES remote_agent_conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
  ON remote_agent_messages(conversation_id, created_at ASC);

-- ============================================================================
-- Cleanup: Drop legacy objects from older schemas
-- ============================================================================

-- Drop command_templates table (replaced by file-based commands in .anvil/commands)
DROP TABLE IF EXISTS remote_agent_command_templates;
DROP INDEX IF EXISTS idx_remote_agent_command_templates_name;

-- Drop legacy columns from conversations (if upgrading from older schema)
ALTER TABLE remote_agent_conversations DROP COLUMN IF EXISTS worktree_path;
ALTER TABLE remote_agent_conversations DROP COLUMN IF EXISTS isolation_env_id_legacy;
ALTER TABLE remote_agent_conversations DROP COLUMN IF EXISTS isolation_provider;
DROP INDEX IF EXISTS idx_conversations_isolation;

-- Drop legacy constraint from isolation_environments (if upgrading from older schema)
ALTER TABLE remote_agent_isolation_environments
  DROP CONSTRAINT IF EXISTS unique_workflow;

-- ============================================================================
-- Idempotent ALTER statements for upgrading existing databases
-- (These are no-ops on fresh installs since columns exist in CREATE TABLE above)
-- ============================================================================

-- From migration 006: isolation_env_id + last_activity_at on conversations
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS isolation_env_id UUID
    REFERENCES remote_agent_isolation_environments(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- From migration 009: last_activity_at on workflow_runs
ALTER TABLE remote_agent_workflow_runs
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- From migration 010: parent_session_id + transition_reason on sessions
ALTER TABLE remote_agent_sessions
  ADD COLUMN IF NOT EXISTS parent_session_id UUID REFERENCES remote_agent_sessions(id);
ALTER TABLE remote_agent_sessions
  ADD COLUMN IF NOT EXISTS transition_reason TEXT;

-- From migration 013: title + deleted_at on conversations
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- From migration 015: parent_conversation_id + hidden
ALTER TABLE remote_agent_workflow_runs
  ADD COLUMN IF NOT EXISTS parent_conversation_id UUID
    REFERENCES remote_agent_conversations(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_workflow_runs
  ADD COLUMN IF NOT EXISTS parent_workflow_run_id UUID
    REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE;
ALTER TABLE remote_agent_workflow_runs
  ADD COLUMN IF NOT EXISTS parent_node_id VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_parent_node_unique
  ON remote_agent_workflow_runs(parent_workflow_run_id, parent_node_id)
  WHERE parent_workflow_run_id IS NOT NULL;
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE;

-- From migration 016: ended_reason on sessions
ALTER TABLE remote_agent_sessions
  ADD COLUMN IF NOT EXISTS ended_reason TEXT;

-- From migration 021: allow_env_keys on codebases
ALTER TABLE remote_agent_codebases
  ADD COLUMN IF NOT EXISTS allow_env_keys BOOLEAN NOT NULL DEFAULT FALSE;

-- From migration 023: detected default branch on codebases
ALTER TABLE remote_agent_codebases
  ADD COLUMN IF NOT EXISTS default_branch VARCHAR(255);

-- User identity foreign keys (nullable on the four primary tables).
-- All FKs use ON DELETE SET NULL so future user deletion never cascades destructively.
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS user_id UUID
    REFERENCES remote_agent_users(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_messages
  ADD COLUMN IF NOT EXISTS user_id UUID
    REFERENCES remote_agent_users(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_workflow_runs
  ADD COLUMN IF NOT EXISTS user_id UUID
    REFERENCES remote_agent_users(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_isolation_environments
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID
    REFERENCES remote_agent_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_user_id
  ON remote_agent_conversations(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_runs_user_id
  ON remote_agent_workflow_runs(user_id) WHERE user_id IS NOT NULL;

-- From PR-C: per-user GitHub user-to-server tokens (device flow), encrypted at rest.
-- One row per Anvil user; cascades on user deletion. github_user_id is the
-- numeric anchor for the commit no-reply email (survives username changes).
CREATE TABLE IF NOT EXISTS remote_agent_user_github_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
  github_user_id BIGINT NOT NULL,
  github_login VARCHAR(255) NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  access_token_expires_at TIMESTAMP WITH TIME ZONE,
  refresh_token_expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Phase 2: per-user AI-provider credentials (BYO API key + subscription login),
-- encrypted at rest with the existing token-crypto key. One row per
-- (user_id, provider); cascades on user deletion. Exactly one of
-- api_key_encrypted / oauth_creds_encrypted is populated per row; `kind`
-- records which. Gated on TOKEN_ENCRYPTION_KEY at the application layer.
CREATE TABLE IF NOT EXISTS remote_agent_user_provider_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
  provider VARCHAR(64) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  api_key_encrypted TEXT,
  oauth_creds_encrypted TEXT,
  label VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- Named provider connections. A user may keep several accounts for the same
-- vendor and chooses exactly one default connection per vendor.
CREATE TABLE IF NOT EXISTS remote_agent_user_provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
  provider VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  api_key_encrypted TEXT,
  oauth_creds_encrypted TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, provider, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_provider_connections_one_default
  ON remote_agent_user_provider_connections(user_id, provider)
  WHERE is_default = TRUE;

INSERT INTO remote_agent_user_provider_connections
  (id, user_id, provider, name, kind, api_key_encrypted, oauth_creds_encrypted, is_default, created_at, updated_at)
SELECT id, user_id, provider, COALESCE(NULLIF(label, ''), provider), kind,
       api_key_encrypted, oauth_creds_encrypted, TRUE, created_at, updated_at
FROM remote_agent_user_provider_keys legacy
WHERE NOT EXISTS (
  SELECT 1 FROM remote_agent_user_provider_connections current
  WHERE current.user_id = legacy.user_id AND current.provider = legacy.provider
);

-- #1955: credential rows are vendor-keyed (claude→anthropic, codex→openai,
-- copilot→github-copilot) so one credential can serve every agent that
-- consumes the vendor. Idempotent data fix: where both a legacy and a vendor
-- row exist for the same user, the vendor row wins (rare — requires having
-- connected both ids pre-rename); then legacy rows are renamed in place.
-- Tested on SQLite (adapters/sqlite.test.ts covers rename, conflict, and
-- idempotency); the Postgres DML below is the same statements but is NOT
-- covered by an automated test — verified manually on the multi-user smoke.
-- Survivable either way: reads normalize legacy ids (normalizeCredentialVendor).
DELETE FROM remote_agent_user_provider_keys
WHERE provider IN ('claude', 'codex', 'copilot')
  AND EXISTS (
    SELECT 1 FROM remote_agent_user_provider_keys v
    WHERE v.user_id = remote_agent_user_provider_keys.user_id
      AND v.provider = CASE remote_agent_user_provider_keys.provider
        WHEN 'claude' THEN 'anthropic'
        WHEN 'codex' THEN 'openai'
        WHEN 'copilot' THEN 'github-copilot'
      END
  );
UPDATE remote_agent_user_provider_keys SET provider = 'anthropic' WHERE provider = 'claude';
UPDATE remote_agent_user_provider_keys SET provider = 'openai' WHERE provider = 'codex';
UPDATE remote_agent_user_provider_keys SET provider = 'github-copilot' WHERE provider = 'copilot';

-- Phase 3: per-user AI preferences (model tiers, @custom aliases, default
-- assistant). NON-encrypted — model names are not secrets (mirrors
-- codebase_env_vars, not the provider-key store). One row per user; cascades
-- on user deletion. `tiers` / `aliases` are JSON-as-TEXT (parsed in the
-- store layer so SQLite and Postgres behave identically).
CREATE TABLE IF NOT EXISTS remote_agent_user_ai_prefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
  tiers TEXT,
  aliases TEXT,
  default_provider VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Durable pre-run workflow intake drafts. This is additive: completed and
-- active workflow runs continue to use their existing records unchanged.
CREATE TABLE IF NOT EXISTS remote_agent_workflow_intake_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codebase_id UUID NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,
  workflow_name VARCHAR(255) NOT NULL,
  definition_hash VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  "values" JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_field VARCHAR(255),
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_run_id UUID REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES remote_agent_conversations(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_intakes_active_unique
  ON remote_agent_workflow_intake_drafts(codebase_id, workflow_name)
  WHERE status IN ('draft', 'ready', 'starting');

CREATE INDEX IF NOT EXISTS idx_workflow_intakes_codebase
  ON remote_agent_workflow_intake_drafts(codebase_id, updated_at DESC);
ALTER TABLE remote_agent_workflow_intake_drafts
  ADD COLUMN IF NOT EXISTS conversation_id UUID
    REFERENCES remote_agent_conversations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_intakes_conversation
  ON remote_agent_workflow_intake_drafts(conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS remote_agent_conversation_memory_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codebase_id UUID NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES remote_agent_conversations(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  source_last_message_id UUID REFERENCES remote_agent_messages(id) ON DELETE SET NULL,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_handoffs_codebase
  ON remote_agent_conversation_memory_handoffs(codebase_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS remote_agent_project_memory_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codebase_id UUID NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,
  source_conversation_id UUID REFERENCES remote_agent_conversations(id) ON DELETE SET NULL,
  handoff_id UUID REFERENCES remote_agent_conversation_memory_handoffs(id) ON DELETE SET NULL,
  category VARCHAR(16) NOT NULL,
  content TEXT NOT NULL,
  origin VARCHAR(16) NOT NULL DEFAULT 'extracted',
  user_edited BOOLEAN NOT NULL DEFAULT FALSE,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_memory_active
  ON remote_agent_project_memory_entries(codebase_id, pinned DESC, updated_at DESC)
  WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_project_memory_source
  ON remote_agent_project_memory_entries(source_conversation_id)
  WHERE source_conversation_id IS NOT NULL;

-- System 3 Project control plane. Generic workflow runs remain untouched: a
-- System 3 project links to a codebase and keeps its immutable source and
-- understanding records in domain-owned tables.
CREATE TABLE IF NOT EXISTS remote_agent_system3_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codebase_id UUID NOT NULL UNIQUE REFERENCES remote_agent_codebases(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  stage VARCHAR(32) NOT NULL,
  attention VARCHAR(32) NOT NULL,
  freshness VARCHAR(32) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  template_id VARCHAR(255) NOT NULL,
  active_knowledge_snapshot_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS remote_agent_system3_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL,
  role VARCHAR(16) NOT NULL,
  display_name TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_by_user_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS remote_agent_system3_source_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES remote_agent_system3_sources(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL,
  role VARCHAR(16) NOT NULL,
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  lineage_version INTEGER NOT NULL,
  content_hash VARCHAR(80) NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_key TEXT NOT NULL,
  storage_status VARCHAR(16) NOT NULL DEFAULT 'ready',
  validation_report JSONB NOT NULL,
  created_by_user_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL,
  origin TEXT NOT NULL DEFAULT 'web',
  operation_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, kind, version),
  UNIQUE(source_id, lineage_version)
);

-- Upgrade installations whose System 3 source table predates logical source
-- lineages. The combined schema is applied idempotently on every PG startup.
ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS source_id UUID;
ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS role VARCHAR(16);
ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS original_filename TEXT;
ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS media_type TEXT;
ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS lineage_version INTEGER;
ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS storage_status VARCHAR(16);
ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS validation_report JSONB;
ALTER TABLE remote_agent_system3_source_versions
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS origin TEXT;
ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS operation_id UUID;
ALTER TABLE remote_agent_system3_source_versions ADD COLUMN IF NOT EXISTS intake_report_artifact_id UUID;

INSERT INTO remote_agent_system3_sources (id, project_id, kind, role, display_name, status)
SELECT gen_random_uuid(), legacy.project_id, legacy.kind, 'primary', legacy.kind, 'active'
FROM (
  SELECT DISTINCT project_id, kind
  FROM remote_agent_system3_source_versions
  WHERE source_id IS NULL
) legacy
WHERE NOT EXISTS (
  SELECT 1 FROM remote_agent_system3_sources source
  WHERE source.project_id = legacy.project_id AND source.kind = legacy.kind
);

UPDATE remote_agent_system3_source_versions version
SET source_id = source.id
FROM remote_agent_system3_sources source
WHERE version.source_id IS NULL
  AND source.id = (
    SELECT candidate.id
    FROM remote_agent_system3_sources candidate
    WHERE candidate.project_id = version.project_id AND candidate.kind = version.kind
    ORDER BY candidate.created_at ASC, candidate.id ASC LIMIT 1
  );

UPDATE remote_agent_system3_source_versions
SET role = COALESCE(role, 'primary'),
    original_filename = COALESCE(original_filename, filename),
    media_type = COALESCE(media_type, 'application/octet-stream'),
    lineage_version = COALESCE(lineage_version, version),
    storage_status = COALESCE(storage_status, 'ready'),
    validation_report = COALESCE(
      validation_report,
      '{"schemaVersion":1,"outcome":"accepted","checks":[],"warnings":["Migrated legacy source"]}'::jsonb
    ),
    origin = COALESCE(origin, 'legacy');

ALTER TABLE remote_agent_system3_source_versions ALTER COLUMN source_id SET NOT NULL;
ALTER TABLE remote_agent_system3_source_versions ALTER COLUMN role SET NOT NULL;
ALTER TABLE remote_agent_system3_source_versions ALTER COLUMN original_filename SET NOT NULL;
ALTER TABLE remote_agent_system3_source_versions ALTER COLUMN media_type SET NOT NULL;
ALTER TABLE remote_agent_system3_source_versions ALTER COLUMN lineage_version SET NOT NULL;
ALTER TABLE remote_agent_system3_source_versions ALTER COLUMN storage_status SET NOT NULL;
ALTER TABLE remote_agent_system3_source_versions ALTER COLUMN validation_report SET NOT NULL;
ALTER TABLE remote_agent_system3_source_versions ALTER COLUMN origin SET NOT NULL;
ALTER TABLE remote_agent_system3_source_versions
  DROP CONSTRAINT IF EXISTS remote_agent_system3_source_versions_project_id_storage_key_key;

CREATE TABLE IF NOT EXISTS remote_agent_system3_knowledge_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  analysis JSONB NOT NULL,
  artifact_key TEXT NOT NULL,
  workflow_run_id UUID REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS remote_agent_system3_readiness_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  knowledge_snapshot_id UUID NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE RESTRICT,
  workflow_run_id UUID NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE RESTRICT,
  contract JSONB NOT NULL,
  contract_hash TEXT NOT NULL,
  artifact_key TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system3_readiness_project
  ON remote_agent_system3_readiness_contracts(project_id, created_at DESC);
ALTER TABLE remote_agent_system3_knowledge_snapshots
  ADD COLUMN IF NOT EXISTS workflow_run_id UUID
    REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'remote_agent_system3_projects_active_snapshot_fkey'
  ) THEN
    ALTER TABLE remote_agent_system3_projects
      ADD CONSTRAINT remote_agent_system3_projects_active_snapshot_fkey
      FOREIGN KEY (active_knowledge_snapshot_id)
      REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS remote_agent_system3_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  knowledge_snapshot_id UUID NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  question TEXT NOT NULL,
  why TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  options JSONB NOT NULL,
  affected_phases JSONB NOT NULL,
  status VARCHAR(16) NOT NULL,
  answer TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system3_sources_project_kind
  ON remote_agent_system3_source_versions(project_id, kind, version DESC);
CREATE INDEX IF NOT EXISTS idx_system3_source_lineage_versions
  ON remote_agent_system3_source_versions(source_id, lineage_version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_system3_source_lineage_version_unique
  ON remote_agent_system3_source_versions(source_id, lineage_version);

CREATE INDEX IF NOT EXISTS idx_system3_snapshots_project
  ON remote_agent_system3_knowledge_snapshots(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system3_decisions_project_status
  ON remote_agent_system3_decisions(project_id, status, created_at ASC);

CREATE TABLE IF NOT EXISTS remote_agent_system3_compilations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  knowledge_snapshot_id UUID NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE RESTRICT,
  plan JSONB NOT NULL,
  definition_hash VARCHAR(80) NOT NULL,
  capability_registry_hash VARCHAR(80) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system3_compilations_project
  ON remote_agent_system3_compilations(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS remote_agent_system3_product_workflow_versions (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  template_id VARCHAR(255) NOT NULL,
  definition_hash VARCHAR(80) NOT NULL,
  definition JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system3_workflow_versions_project
  ON remote_agent_system3_product_workflow_versions(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS remote_agent_system3_runtime_profile_versions (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  profile_hash VARCHAR(80) NOT NULL,
  profile JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, profile_hash)
);

CREATE TABLE IF NOT EXISTS remote_agent_system3_input_snapshots (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  knowledge_snapshot_id UUID NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE RESTRICT,
  source_ids JSONB NOT NULL,
  source_hashes JSONB NOT NULL,
  runtime_profile_version_id UUID NOT NULL REFERENCES remote_agent_system3_runtime_profile_versions(id) ON DELETE RESTRICT,
  runtime_profile_hash VARCHAR(80) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
ALTER TABLE remote_agent_system3_input_snapshots
  ADD COLUMN IF NOT EXISTS runtime_profile_version_id UUID
    REFERENCES remote_agent_system3_runtime_profile_versions(id) ON DELETE RESTRICT;
INSERT INTO remote_agent_system3_runtime_profile_versions (id, project_id, profile_hash, profile)
SELECT gen_random_uuid(), input.project_id, input.runtime_profile_hash,
       COALESCE(compilation.plan->'runtimeProfile', compilation.plan->'phases'->0->'resourceProfile',
                '{"cpuOnly":true,"ramGb":null}'::jsonb)
FROM remote_agent_system3_input_snapshots input
LEFT JOIN remote_agent_system3_compilations compilation
  ON compilation.plan->>'inputSnapshotId' = input.id::text
WHERE input.runtime_profile_version_id IS NULL
ON CONFLICT (project_id, profile_hash) DO NOTHING;
UPDATE remote_agent_system3_input_snapshots input
SET runtime_profile_version_id = profile.id
FROM remote_agent_system3_runtime_profile_versions profile
WHERE input.runtime_profile_version_id IS NULL
  AND profile.project_id = input.project_id
  AND profile.profile_hash = input.runtime_profile_hash;
ALTER TABLE remote_agent_system3_input_snapshots
  ALTER COLUMN runtime_profile_version_id SET NOT NULL;
CREATE TABLE IF NOT EXISTS remote_agent_system3_capability_registry_snapshots (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  registry_hash VARCHAR(80) NOT NULL,
  registry JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS remote_agent_system3_compilation_bases (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  compilation_id UUID NOT NULL UNIQUE REFERENCES remote_agent_system3_compilations(id) ON DELETE CASCADE,
  product_workflow_version_id UUID NOT NULL REFERENCES remote_agent_system3_product_workflow_versions(id) ON DELETE RESTRICT,
  input_snapshot_id UUID NOT NULL REFERENCES remote_agent_system3_input_snapshots(id) ON DELETE RESTRICT,
  capability_registry_snapshot_id UUID NOT NULL REFERENCES remote_agent_system3_capability_registry_snapshots(id) ON DELETE RESTRICT,
  compiler_version VARCHAR(80) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS remote_agent_system3_execution_plan_snapshots (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  compilation_id UUID NOT NULL UNIQUE REFERENCES remote_agent_system3_compilations(id) ON DELETE CASCADE,
  definition_hash VARCHAR(80) NOT NULL,
  plan JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS remote_agent_system3_project_transitions (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  from_stage VARCHAR(32),
  to_stage VARCHAR(32) NOT NULL,
  actor_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL,
  operation_id UUID,
  workflow_run_id UUID REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
  entity_type VARCHAR(64),
  entity_id TEXT,
  from_attention VARCHAR(32),
  to_attention VARCHAR(32),
  from_freshness VARCHAR(32),
  to_freshness VARCHAR(32),
  project_version INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system3_transitions_project
  ON remote_agent_system3_project_transitions(project_id, created_at DESC);
ALTER TABLE remote_agent_system3_project_transitions ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_system3_project_transitions ADD COLUMN IF NOT EXISTS operation_id UUID;
ALTER TABLE remote_agent_system3_project_transitions ADD COLUMN IF NOT EXISTS workflow_run_id UUID REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_system3_project_transitions ADD COLUMN IF NOT EXISTS entity_type VARCHAR(64);
ALTER TABLE remote_agent_system3_project_transitions ADD COLUMN IF NOT EXISTS entity_id TEXT;
ALTER TABLE remote_agent_system3_project_transitions ADD COLUMN IF NOT EXISTS from_attention VARCHAR(32);
ALTER TABLE remote_agent_system3_project_transitions ADD COLUMN IF NOT EXISTS to_attention VARCHAR(32);
ALTER TABLE remote_agent_system3_project_transitions ADD COLUMN IF NOT EXISTS from_freshness VARCHAR(32);
ALTER TABLE remote_agent_system3_project_transitions ADD COLUMN IF NOT EXISTS to_freshness VARCHAR(32);
ALTER TABLE remote_agent_system3_project_transitions ADD COLUMN IF NOT EXISTS project_version INTEGER;
ALTER TABLE remote_agent_system3_project_transitions ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS remote_agent_system3_approval_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  compilation_id UUID NOT NULL REFERENCES remote_agent_system3_compilations(id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(255) NOT NULL,
  manifest JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS remote_agent_system3_project_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  approval_id UUID NOT NULL REFERENCES remote_agent_system3_approval_manifests(id) ON DELETE RESTRICT,
  workflow_run_id UUID NOT NULL UNIQUE REFERENCES remote_agent_workflow_runs(id) ON DELETE RESTRICT,
  definition_hash VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system3_executions_project
  ON remote_agent_system3_project_executions(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS remote_agent_system3_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  execution_id UUID NOT NULL REFERENCES remote_agent_system3_project_executions(id) ON DELETE CASCADE,
  operation_type VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, operation_type, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_system3_operations_project
  ON remote_agent_system3_operations(project_id, created_at DESC);

-- A project operation is independent from a workflow execution: analysis,
-- readiness and compilation can be durable, retryable operations too.
CREATE TABLE IF NOT EXISTS remote_agent_system3_project_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL,
  execution_id UUID REFERENCES remote_agent_system3_project_executions(id) ON DELETE SET NULL,
  workflow_run_id UUID REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  project_version INTEGER NOT NULL,
  result JSONB,
  error TEXT,
  owner_instance_id TEXT,
  heartbeat_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, operation_type, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_system3_project_operations_project
  ON remote_agent_system3_project_operations(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system3_project_operations_status
  ON remote_agent_system3_project_operations(status, updated_at ASC);

ALTER TABLE remote_agent_system3_project_operations
  ADD COLUMN IF NOT EXISTS project_version INTEGER;
ALTER TABLE remote_agent_system3_project_operations
  ADD COLUMN IF NOT EXISTS owner_instance_id TEXT;
ALTER TABLE remote_agent_system3_project_operations
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
ALTER TABLE remote_agent_system3_project_operations
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE remote_agent_system3_project_operations
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

UPDATE remote_agent_system3_project_operations operation
SET project_version = project.version
FROM remote_agent_system3_projects project
WHERE operation.project_id = project.id
  AND operation.project_version IS NULL;

ALTER TABLE remote_agent_system3_project_operations
  ALTER COLUMN project_version SET NOT NULL;

INSERT INTO remote_agent_system3_project_operations
  (id, project_id, operation_type, execution_id, workflow_run_id, status,
   idempotency_key, request_fingerprint, project_version, result, error,
   started_at, finished_at, created_at, updated_at)
SELECT legacy.id, legacy.project_id, legacy.operation_type, legacy.execution_id,
       execution.workflow_run_id, legacy.status, legacy.idempotency_key,
       'legacy:' || legacy.id, project.version, NULL, legacy.error,
       legacy.created_at,
       CASE WHEN legacy.status IN ('succeeded', 'failed', 'abandoned')
            THEN legacy.updated_at ELSE NULL END,
       legacy.created_at, legacy.updated_at
FROM remote_agent_system3_operations legacy
JOIN remote_agent_system3_project_executions execution ON execution.id = legacy.execution_id
JOIN remote_agent_system3_projects project ON project.id = legacy.project_id
ON CONFLICT (project_id, operation_type, idempotency_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS remote_agent_system3_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  execution_id UUID NOT NULL REFERENCES remote_agent_system3_project_executions(id) ON DELETE RESTRICT,
  workflow_run_id UUID NOT NULL UNIQUE REFERENCES remote_agent_workflow_runs(id) ON DELETE RESTRICT,
  input_artifact_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL,
  validator_version VARCHAR(64) NOT NULL,
  basis_hash VARCHAR(80) NOT NULL,
  evidence_map JSONB,
  gate JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS remote_agent_system3_evidence_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  execution_id UUID NOT NULL REFERENCES remote_agent_system3_project_executions(id) ON DELETE CASCADE,
  verification_id UUID REFERENCES remote_agent_system3_verifications(id) ON DELETE RESTRICT,
  requirement_id VARCHAR(255),
  status VARCHAR(20) NOT NULL,
  validator_version VARCHAR(64) NOT NULL DEFAULT 'system3-validator@1',
  basis_hash VARCHAR(80) NOT NULL DEFAULT 'legacy',
  evidence JSONB NOT NULL,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system3_evidence_execution
  ON remote_agent_system3_evidence_records(execution_id, created_at ASC);

CREATE TABLE IF NOT EXISTS remote_agent_system3_delivery_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  execution_id UUID NOT NULL UNIQUE REFERENCES remote_agent_system3_project_executions(id) ON DELETE CASCADE,
  verification_id UUID REFERENCES remote_agent_system3_verifications(id) ON DELETE RESTRICT,
  package_storage_key TEXT NOT NULL,
  package_filename TEXT NOT NULL,
  content_hash VARCHAR(80) NOT NULL,
  size_bytes BIGINT NOT NULL,
  manifest JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS remote_agent_system3_impact_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  source_version_id UUID NOT NULL REFERENCES remote_agent_system3_source_versions(id) ON DELETE CASCADE,
  operation_id UUID REFERENCES remote_agent_system3_project_operations(id) ON DELETE SET NULL,
  previous_source_version_id UUID REFERENCES remote_agent_system3_source_versions(id) ON DELETE SET NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  detector_version VARCHAR(80) NOT NULL DEFAULT 'system3-change-detector@1',
  basis_hash VARCHAR(80),
  manifest_hash VARCHAR(80),
  manifest JSONB,
  affected_phases JSONB NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system3_impacts_project
  ON remote_agent_system3_impact_manifests(project_id, created_at DESC);
DROP INDEX IF EXISTS idx_system3_impacts_source_version;
CREATE UNIQUE INDEX IF NOT EXISTS idx_system3_impacts_source_basis_detector
  ON remote_agent_system3_impact_manifests(source_version_id, basis_hash, detector_version);
CREATE INDEX IF NOT EXISTS idx_system3_impacts_operation
  ON remote_agent_system3_impact_manifests(operation_id);

CREATE TABLE IF NOT EXISTS remote_agent_system3_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  knowledge_snapshot_id UUID NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE CASCADE,
  requirement_key VARCHAR(255) NOT NULL,
  kind VARCHAR(64) NOT NULL,
  priority VARCHAR(32),
  source TEXT,
  statement TEXT NOT NULL,
  acceptance_criterion TEXT NOT NULL,
  source_pointer TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(knowledge_snapshot_id, requirement_key)
);
CREATE INDEX IF NOT EXISTS idx_system3_requirements_project
  ON remote_agent_system3_requirements(project_id, knowledge_snapshot_id);

CREATE TABLE IF NOT EXISTS remote_agent_system3_knowledge_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  knowledge_snapshot_id UUID NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE CASCADE,
  fact_key VARCHAR(255) NOT NULL,
  value JSONB NOT NULL,
  source_pointer TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(knowledge_snapshot_id, fact_key)
);

CREATE TABLE IF NOT EXISTS remote_agent_system3_open_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  knowledge_snapshot_id UUID NOT NULL REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE CASCADE,
  issue_key VARCHAR(255) NOT NULL,
  title TEXT NOT NULL,
  source_pointer TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(knowledge_snapshot_id, issue_key)
);

CREATE TABLE IF NOT EXISTS remote_agent_system3_dependency_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  from_kind VARCHAR(32) NOT NULL,
  from_id VARCHAR(255) NOT NULL,
  to_kind VARCHAR(32) NOT NULL,
  to_id VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, from_kind, from_id, to_kind, to_id)
);
CREATE INDEX IF NOT EXISTS idx_system3_dependency_edges_project
  ON remote_agent_system3_dependency_edges(project_id, from_kind, from_id);

CREATE TABLE IF NOT EXISTS remote_agent_system3_artifact_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  execution_id UUID REFERENCES remote_agent_system3_project_executions(id) ON DELETE CASCADE,
  knowledge_snapshot_id UUID REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE CASCADE,
  source_version_id UUID REFERENCES remote_agent_system3_source_versions(id) ON DELETE SET NULL,
  operation_id UUID REFERENCES remote_agent_system3_project_operations(id) ON DELETE SET NULL,
  artifact_key TEXT NOT NULL,
  artifact_kind VARCHAR(64) NOT NULL,
  version INTEGER NOT NULL,
  content_hash VARCHAR(80) NOT NULL,
  size_bytes BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, artifact_key, version)
);
ALTER TABLE remote_agent_system3_artifact_versions
  ADD COLUMN IF NOT EXISTS source_version_id UUID
  REFERENCES remote_agent_system3_source_versions(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_system3_artifact_versions
  ADD COLUMN IF NOT EXISTS operation_id UUID
  REFERENCES remote_agent_system3_project_operations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_system3_artifacts_project
  ON remote_agent_system3_artifact_versions(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS remote_agent_system3_understanding_input_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL UNIQUE REFERENCES remote_agent_system3_project_operations(id) ON DELETE CASCADE,
  knowledge_snapshot_id UUID REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE SET NULL,
  workflow_run_id UUID REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
  source_ids JSONB NOT NULL,
  source_hashes JSONB NOT NULL,
  parser_version VARCHAR(80) NOT NULL,
  extraction_policy_version VARCHAR(80) NOT NULL,
  capability_registry_hash VARCHAR(80) NOT NULL,
  runtime_profile JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system3_understanding_inputs_project
  ON remote_agent_system3_understanding_input_snapshots(project_id, created_at DESC);

ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS activity_id VARCHAR(8);
ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS workflow_run_id UUID;
ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS workflow_node_id TEXT;
ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS media_type TEXT;
ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS schema_id TEXT;
ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS schema_version TEXT;
ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS visibility VARCHAR(16);
ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS status VARCHAR(16);
ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS stale_reason TEXT;
ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS source_version_ids JSONB;
ALTER TABLE remote_agent_system3_artifact_versions ADD COLUMN IF NOT EXISTS parent_resource_ids JSONB;

CREATE TABLE IF NOT EXISTS remote_agent_system3_source_intake_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL UNIQUE
    REFERENCES remote_agent_system3_project_operations(id) ON DELETE CASCADE,
  source_version_id UUID REFERENCES remote_agent_system3_source_versions(id) ON DELETE SET NULL,
  artifact_key TEXT NOT NULL,
  report JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system3_source_intake_reports_project
  ON remote_agent_system3_source_intake_reports(project_id, created_at DESC);

-- ============================================================================
-- Web auth (opt-in): role on the canonical user + Better Auth tables
-- ============================================================================
--
-- `role` is the durable identity seam: everyone defaults to 'admin' for now;
-- 'member' is reserved for future per-resource scoping. Visibility stays open.
ALTER TABLE remote_agent_users
  ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'admin';

-- Better Auth tables (PostgreSQL only). Generated by `@better-auth/cli generate`
-- against packages/server/src/auth/instance.ts (modelName-renamed to the
-- `remote_agent_auth_*` prefix), then made idempotent with IF NOT EXISTS so the
-- bundled-schema auto-apply on startup converges. Better Auth owns these tables
-- and the column shape (text ids, camelCase columns) — Anvil never queries them
-- directly; a session is mapped to the canonical remote_agent_users row via
-- user_identities('web', <betterAuthUserId>). Always created on Postgres (the
-- IF NOT EXISTS apply runs on every boot); populated only when web auth is
-- enabled (BETTER_AUTH_SECRET + DATABASE_URL), harmless empty tables otherwise.
CREATE TABLE IF NOT EXISTS remote_agent_auth_user (
  "id" text NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  "image" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS remote_agent_auth_session (
  "id" text NOT NULL PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES remote_agent_auth_user ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS remote_agent_auth_account (
  "id" text NOT NULL PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES remote_agent_auth_user ("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS remote_agent_auth_verification (
  "id" text NOT NULL PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
-- OP-01 V3 artifact metadata/provenance repair is also kept as the standalone
-- idempotent migration migrations/031_system3_op01_v3_provenance.sql. New
-- databases already receive complete metadata from current write paths.
