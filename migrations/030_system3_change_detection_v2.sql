-- OP-01 Change Detection V2: immutable, versioned impact payloads. Legacy
-- rows remain readable and are explicitly presented as broad V1 analysis.
ALTER TABLE remote_agent_system3_impact_manifests
  ADD COLUMN IF NOT EXISTS operation_id UUID
  REFERENCES remote_agent_system3_project_operations(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_system3_impact_manifests
  ADD COLUMN IF NOT EXISTS previous_source_version_id UUID
  REFERENCES remote_agent_system3_source_versions(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_system3_impact_manifests
  ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE remote_agent_system3_impact_manifests
  ADD COLUMN IF NOT EXISTS detector_version VARCHAR(80) NOT NULL DEFAULT 'system3-change-detector@1';
ALTER TABLE remote_agent_system3_impact_manifests
  ADD COLUMN IF NOT EXISTS basis_hash VARCHAR(80);
ALTER TABLE remote_agent_system3_impact_manifests
  ADD COLUMN IF NOT EXISTS manifest_hash VARCHAR(80);
ALTER TABLE remote_agent_system3_impact_manifests
  ADD COLUMN IF NOT EXISTS manifest JSONB;

UPDATE remote_agent_system3_impact_manifests
SET basis_hash = COALESCE(basis_hash, 'legacy:' || id::text),
    manifest_hash = COALESCE(manifest_hash, 'legacy:' || id::text)
WHERE basis_hash IS NULL OR manifest_hash IS NULL;

DROP INDEX IF EXISTS idx_system3_impacts_source_version;
CREATE UNIQUE INDEX IF NOT EXISTS idx_system3_impacts_source_basis_detector
  ON remote_agent_system3_impact_manifests(source_version_id, basis_hash, detector_version);
CREATE INDEX IF NOT EXISTS idx_system3_impacts_operation
  ON remote_agent_system3_impact_manifests(operation_id);
