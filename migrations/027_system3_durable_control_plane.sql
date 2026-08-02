-- System 3 durable project operation control plane.
-- The legacy execution-only table remains readable for one compatibility release.

CREATE TABLE IF NOT EXISTS remote_agent_system3_runtime_profile_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  profile_hash VARCHAR(80) NOT NULL,
  profile JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, profile_hash)
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

CREATE TABLE IF NOT EXISTS remote_agent_system3_project_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES remote_agent_system3_projects(id) ON DELETE CASCADE,
  operation_type VARCHAR(32) NOT NULL,
  execution_id UUID REFERENCES remote_agent_system3_project_executions(id) ON DELETE SET NULL,
  workflow_run_id UUID REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  request_fingerprint VARCHAR(80) NOT NULL,
  project_version INTEGER NOT NULL,
  result JSONB,
  error TEXT,
  owner_instance_id VARCHAR(255),
  heartbeat_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, operation_type, idempotency_key)
);

ALTER TABLE remote_agent_system3_project_operations
  ADD COLUMN IF NOT EXISTS project_version INTEGER;
ALTER TABLE remote_agent_system3_project_operations
  ADD COLUMN IF NOT EXISTS owner_instance_id VARCHAR(255);
ALTER TABLE remote_agent_system3_project_operations
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE remote_agent_system3_project_operations
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE remote_agent_system3_project_operations
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP WITH TIME ZONE;

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
SELECT legacy.id,
       legacy.project_id,
       legacy.operation_type,
       legacy.execution_id,
       execution.workflow_run_id,
       legacy.status,
       legacy.idempotency_key,
       'legacy:' || legacy.id,
       project.version,
       NULL,
       legacy.error,
       legacy.created_at,
       CASE WHEN legacy.status IN ('succeeded', 'failed', 'abandoned')
            THEN legacy.updated_at ELSE NULL END,
       legacy.created_at,
       legacy.updated_at
FROM remote_agent_system3_operations legacy
JOIN remote_agent_system3_project_executions execution ON execution.id = legacy.execution_id
JOIN remote_agent_system3_projects project ON project.id = legacy.project_id
ON CONFLICT (project_id, operation_type, idempotency_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_system3_project_operations_project
  ON remote_agent_system3_project_operations(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system3_project_operations_status
  ON remote_agent_system3_project_operations(status, updated_at ASC);

ALTER TABLE remote_agent_system3_project_transitions
  ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_system3_project_transitions
  ADD COLUMN IF NOT EXISTS operation_id UUID;
ALTER TABLE remote_agent_system3_project_transitions
  ADD COLUMN IF NOT EXISTS workflow_run_id UUID REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_system3_project_transitions
  ADD COLUMN IF NOT EXISTS entity_type VARCHAR(64);
ALTER TABLE remote_agent_system3_project_transitions
  ADD COLUMN IF NOT EXISTS entity_id TEXT;
ALTER TABLE remote_agent_system3_project_transitions
  ADD COLUMN IF NOT EXISTS from_attention VARCHAR(32);
ALTER TABLE remote_agent_system3_project_transitions
  ADD COLUMN IF NOT EXISTS to_attention VARCHAR(32);
ALTER TABLE remote_agent_system3_project_transitions
  ADD COLUMN IF NOT EXISTS from_freshness VARCHAR(32);
ALTER TABLE remote_agent_system3_project_transitions
  ADD COLUMN IF NOT EXISTS to_freshness VARCHAR(32);
ALTER TABLE remote_agent_system3_project_transitions
  ADD COLUMN IF NOT EXISTS project_version INTEGER;
ALTER TABLE remote_agent_system3_project_transitions
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

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

ALTER TABLE remote_agent_system3_evidence_records
  ADD COLUMN IF NOT EXISTS verification_id UUID REFERENCES remote_agent_system3_verifications(id) ON DELETE RESTRICT;
ALTER TABLE remote_agent_system3_evidence_records
  ADD COLUMN IF NOT EXISTS validator_version VARCHAR(64) NOT NULL DEFAULT 'system3-validator@1';
ALTER TABLE remote_agent_system3_evidence_records
  ADD COLUMN IF NOT EXISTS basis_hash VARCHAR(80) NOT NULL DEFAULT 'legacy';
ALTER TABLE remote_agent_system3_delivery_manifests
  ADD COLUMN IF NOT EXISTS verification_id UUID REFERENCES remote_agent_system3_verifications(id) ON DELETE RESTRICT;
