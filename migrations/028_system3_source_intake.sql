-- Source Intake: separate a logical source from its immutable versions and
-- persist enough validation/provenance data to reproduce every accepted input.
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

ALTER TABLE remote_agent_system3_artifact_versions
  ADD COLUMN IF NOT EXISTS source_version_id UUID
  REFERENCES remote_agent_system3_source_versions(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_system3_artifact_versions
  ADD COLUMN IF NOT EXISTS operation_id UUID
  REFERENCES remote_agent_system3_project_operations(id) ON DELETE SET NULL;

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
  AND source.project_id = version.project_id
  AND source.kind = version.kind
  AND source.id = (
    SELECT candidate.id
    FROM remote_agent_system3_sources candidate
    WHERE candidate.project_id = version.project_id AND candidate.kind = version.kind
    ORDER BY candidate.created_at ASC, candidate.id ASC
    LIMIT 1
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_system3_source_lineage_version_unique
  ON remote_agent_system3_source_versions(source_id, lineage_version);
CREATE INDEX IF NOT EXISTS idx_system3_source_lineage_versions
  ON remote_agent_system3_source_versions(source_id, lineage_version DESC);

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_system3_impacts_source_version
  ON remote_agent_system3_impact_manifests(source_version_id);
