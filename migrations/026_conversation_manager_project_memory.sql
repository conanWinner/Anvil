-- Conversation creation idempotency, intake ownership, and project-scoped long-term memory.
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS client_request_id VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_client_request_id
  ON remote_agent_conversations(client_request_id)
  WHERE client_request_id IS NOT NULL;

ALTER TABLE remote_agent_workflow_intake_drafts
  ADD COLUMN IF NOT EXISTS conversation_id UUID
    REFERENCES remote_agent_conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_intakes_conversation
  ON remote_agent_workflow_intake_drafts(conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS remote_agent_conversation_memory_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codebase_id UUID NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES remote_agent_conversations(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  source_last_message_id UUID REFERENCES remote_agent_messages(id) ON DELETE SET NULL,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_handoffs_codebase
  ON remote_agent_conversation_memory_handoffs(codebase_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS remote_agent_project_memory_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codebase_id UUID NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,
  source_conversation_id UUID REFERENCES remote_agent_conversations(id) ON DELETE SET NULL,
  handoff_id UUID REFERENCES remote_agent_conversation_memory_handoffs(id) ON DELETE SET NULL,
  category VARCHAR(16) NOT NULL,
  content TEXT NOT NULL,
  origin VARCHAR(16) NOT NULL DEFAULT 'extracted',
  user_edited BOOLEAN NOT NULL DEFAULT FALSE,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_memory_active
  ON remote_agent_project_memory_entries(codebase_id, pinned DESC, updated_at DESC)
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_project_memory_source
  ON remote_agent_project_memory_entries(source_conversation_id)
  WHERE source_conversation_id IS NOT NULL;
