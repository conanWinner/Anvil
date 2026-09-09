ALTER TABLE remote_agent_system3_understanding_input_snapshots
  ADD COLUMN IF NOT EXISTS source_refs JSONB;

ALTER TABLE remote_agent_system3_knowledge_snapshots
  ADD COLUMN IF NOT EXISTS input_snapshot_id UUID
    REFERENCES remote_agent_system3_understanding_input_snapshots(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_system3_knowledge_snapshots
  ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE remote_agent_system3_knowledge_snapshots
  ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(16);
ALTER TABLE remote_agent_system3_knowledge_snapshots
  ADD COLUMN IF NOT EXISTS quality_status VARCHAR(32);
ALTER TABLE remote_agent_system3_knowledge_snapshots
  ADD COLUMN IF NOT EXISTS quality_report JSONB;
ALTER TABLE remote_agent_system3_knowledge_snapshots
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE remote_agent_system3_knowledge_snapshots
  ADD COLUMN IF NOT EXISTS activated_by_user_id UUID
    REFERENCES remote_agent_users(id) ON DELETE SET NULL;

UPDATE remote_agent_system3_knowledge_snapshots snapshot
SET lifecycle_status = CASE
  WHEN snapshot.id = project.active_knowledge_snapshot_id THEN 'active'
  ELSE 'superseded'
END
FROM remote_agent_system3_projects project
WHERE project.id = snapshot.project_id
  AND snapshot.lifecycle_status IS NULL;

UPDATE remote_agent_system3_knowledge_snapshots snapshot
SET input_snapshot_id = input.id
FROM remote_agent_system3_understanding_input_snapshots input
WHERE input.project_id = snapshot.project_id
  AND input.knowledge_snapshot_id = snapshot.id
  AND snapshot.input_snapshot_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_system3_snapshots_project_lifecycle
  ON remote_agent_system3_knowledge_snapshots(project_id, lifecycle_status, created_at DESC);
