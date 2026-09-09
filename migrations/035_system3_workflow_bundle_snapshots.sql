-- Immutable executable bundles pin the exact Technical Workflow definitions
-- that an Approval Manifest is allowed to start. Existing history remains
-- readable: the runtime binding fields deliberately remain nullable.
CREATE TABLE IF NOT EXISTS remote_agent_system3_workflow_bundle_snapshots (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  compilation_id UUID NOT NULL REFERENCES remote_agent_system3_compilations(id) ON DELETE CASCADE,
  activity_id VARCHAR(8) NOT NULL CHECK (activity_id IN ('TW-06', 'TW-07', 'TW-09')),
  schema_version INTEGER NOT NULL,
  compiler_version VARCHAR(80) NOT NULL,
  template_id VARCHAR(255) NOT NULL,
  execution_mode VARCHAR(20) NOT NULL CHECK (execution_mode IN ('full', 'experiment', 'delivery')),
  definition JSONB NOT NULL,
  definition_hash VARCHAR(80) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(compilation_id, activity_id)
);

CREATE INDEX IF NOT EXISTS idx_system3_workflow_bundle_snapshots_project
  ON remote_agent_system3_workflow_bundle_snapshots(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system3_workflow_bundle_snapshots_compilation
  ON remote_agent_system3_workflow_bundle_snapshots(compilation_id, activity_id);

ALTER TABLE remote_agent_system3_project_executions
  ADD COLUMN IF NOT EXISTS bundle_snapshot_id UUID
    REFERENCES remote_agent_system3_workflow_bundle_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE remote_agent_system3_project_executions
  ADD COLUMN IF NOT EXISTS bundle_hash VARCHAR(80);
ALTER TABLE remote_agent_system3_project_executions
  ADD COLUMN IF NOT EXISTS runtime_bindings JSONB;

ALTER TABLE remote_agent_system3_verifications
  ADD COLUMN IF NOT EXISTS bundle_snapshot_id UUID
    REFERENCES remote_agent_system3_workflow_bundle_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE remote_agent_system3_verifications
  ADD COLUMN IF NOT EXISTS bundle_hash VARCHAR(80);
ALTER TABLE remote_agent_system3_verifications
  ADD COLUMN IF NOT EXISTS runtime_bindings JSONB;

ALTER TABLE remote_agent_system3_delivery_manifests
  ADD COLUMN IF NOT EXISTS bundle_snapshot_id UUID
    REFERENCES remote_agent_system3_workflow_bundle_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE remote_agent_system3_delivery_manifests
  ADD COLUMN IF NOT EXISTS bundle_hash VARCHAR(80);
ALTER TABLE remote_agent_system3_delivery_manifests
  ADD COLUMN IF NOT EXISTS runtime_bindings JSONB;
