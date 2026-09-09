-- Fence every project-operation worker with a per-claim token. A retry or
-- explicit takeover clears the old token, so late callbacks cannot commit.
ALTER TABLE remote_agent_system3_project_operations
  ADD COLUMN IF NOT EXISTS owner_claim_token TEXT;
