ALTER TABLE remote_agent_system3_decisions
  ADD COLUMN IF NOT EXISTS binding JSONB;
