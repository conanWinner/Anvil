-- Resource presentation basis for the canonical 10 System 3 Lifecycle Activities.
-- TW-02 gets its own immutable input snapshot because compilation snapshots are
-- created later and cannot prove what Understanding actually consumed.
CREATE TABLE IF NOT EXISTS remote_agent_system3_understanding_input_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL UNIQUE
    REFERENCES remote_agent_system3_project_operations(id) ON DELETE CASCADE,
  knowledge_snapshot_id UUID
    REFERENCES remote_agent_system3_knowledge_snapshots(id) ON DELETE SET NULL,
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

UPDATE remote_agent_system3_artifact_versions
SET activity_id = COALESCE(activity_id,
      CASE artifact_kind
        WHEN 'source_intake_report' THEN 'OP-00'
        WHEN 'knowledge_snapshot' THEN 'TW-02'
        WHEN 'baseline_package' THEN 'TW-06'
        ELSE NULL
      END),
    display_name = COALESCE(display_name,
      CASE artifact_kind
        WHEN 'source_intake_report' THEN 'Báo cáo tiếp nhận nguồn'
        WHEN 'knowledge_snapshot' THEN 'Bản hiểu dự án'
        WHEN 'baseline_package' THEN 'Gói kết quả thực thi'
        ELSE artifact_kind
      END),
    summary = COALESCE(summary, 'Kết quả bất biến do System 3 tạo ra.'),
    media_type = COALESCE(media_type,
      CASE WHEN artifact_kind = 'baseline_package' THEN 'application/gzip'
           ELSE 'application/json' END),
    schema_version = COALESCE(schema_version, 'legacy'),
    visibility = COALESCE(visibility, 'user'),
    status = COALESCE(status, 'current'),
    source_version_ids = COALESCE(source_version_ids, '[]'::jsonb),
    parent_resource_ids = COALESCE(parent_resource_ids, '[]'::jsonb);
