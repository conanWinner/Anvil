-- Durable pre-run workflow intake drafts. Existing workflow runs remain untouched.
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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_intakes_active_unique
  ON remote_agent_workflow_intake_drafts(codebase_id, workflow_name)
  WHERE status IN ('draft', 'ready', 'starting');

CREATE INDEX IF NOT EXISTS idx_workflow_intakes_codebase
  ON remote_agent_workflow_intake_drafts(codebase_id, updated_at DESC);
