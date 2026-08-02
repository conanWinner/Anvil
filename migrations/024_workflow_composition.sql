-- First-class parent/child workflow composition.
ALTER TABLE remote_agent_workflow_runs
  ADD COLUMN IF NOT EXISTS parent_workflow_run_id UUID
    REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE;

ALTER TABLE remote_agent_workflow_runs
  ADD COLUMN IF NOT EXISTS parent_node_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_parent_node_unique
  ON remote_agent_workflow_runs(parent_workflow_run_id, parent_node_id)
  WHERE parent_workflow_run_id IS NOT NULL;
