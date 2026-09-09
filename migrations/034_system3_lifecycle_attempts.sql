-- A Lifecycle Attempt is an immutable, user-visible retry/test cycle. It is
-- deliberately separate from generic Workflow Runs: one attempt may contain
-- several Technical Workflows and one shared isolated worktree.
CREATE TABLE IF NOT EXISTS remote_agent_system3_lifecycle_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL,
  base_attempt_id UUID REFERENCES remote_agent_system3_lifecycle_attempts(id) ON DELETE SET NULL,
  start_activity_id VARCHAR(16) NOT NULL,
  scope VARCHAR(16) NOT NULL,
  input_mode VARCHAR(16) NOT NULL,
  basis JSONB NOT NULL,
  preview_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  conversation_id UUID,
  isolation_environment_id UUID,
  branch_name TEXT,
  working_path TEXT,
  lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'active',
  run_status VARCHAR(16) NOT NULL DEFAULT 'preparing',
  cleanup_status VARCHAR(16) NOT NULL DEFAULT 'not_started',
  checkpoint_activity_id VARCHAR(16),
  next_activity_id VARCHAR(16),
  cleanup_manifest JSONB,
  created_by_user_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  cleaned_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(project_id, sequence),
  UNIQUE(project_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_system3_lifecycle_attempts_project
  ON remote_agent_system3_lifecycle_attempts(project_id, sequence DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_system3_lifecycle_attempts_one_active
  ON remote_agent_system3_lifecycle_attempts(project_id)
  WHERE lifecycle_status = 'active';

-- Existing projects have truthful, minimal historical provenance. We do not
-- manufacture a run branch or pinned snapshot for work that predates attempts.
INSERT INTO remote_agent_system3_lifecycle_attempts (
  project_id, sequence, start_activity_id, scope, input_mode, basis, preview_hash, idempotency_key,
  lifecycle_status, run_status, cleanup_status, created_at, completed_at
)
SELECT project.id, 1, 'OP-00', 'full', 'current',
  jsonb_build_object(
    'schemaVersion', 1,
    'sourceVersionIds', '[]'::jsonb,
    'sourceHashes', '[]'::jsonb,
    'knowledgeSnapshotId', project.active_knowledge_snapshot_id,
    'readinessContractId', NULL,
    'compilationId', NULL,
    'approvalId', NULL,
    'executionId', NULL,
    'verificationId', NULL,
    'baseCommitSha', NULL,
    'resources', jsonb_build_object('legacy', true)
  ),
  'legacy:' || project.id::text, 'legacy:' || project.id::text,
  'superseded', 'completed', 'not_started', project.created_at, project.updated_at
FROM remote_agent_system3_projects project
WHERE NOT EXISTS (
  SELECT 1 FROM remote_agent_system3_lifecycle_attempts attempt
  WHERE attempt.project_id = project.id
);
