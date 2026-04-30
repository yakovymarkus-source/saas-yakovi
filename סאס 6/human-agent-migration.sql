-- Human Agent: memory, conversations, dev tickets
-- Run this migration in Supabase SQL editor

CREATE TABLE IF NOT EXISTS public.human_agent_memory (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  onboarding_completed boolean     NOT NULL DEFAULT false,
  gender_preference    text        NOT NULL DEFAULT 'male' CHECK (gender_preference IN ('male', 'female')),
  birth_date           date,
  business_goals       jsonb       NOT NULL DEFAULT '[]',
  personal_notes       jsonb       NOT NULL DEFAULT '[]',
  successes            jsonb       NOT NULL DEFAULT '[]',
  communication_style  jsonb       NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.human_agent_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS human_agent_memory_own ON public.human_agent_memory;
CREATE POLICY human_agent_memory_own ON public.human_agent_memory
  FOR ALL USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.human_agent_conversations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_date date        NOT NULL DEFAULT CURRENT_DATE,
  messages     jsonb       NOT NULL DEFAULT '[]',
  summary      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, session_date)
);

ALTER TABLE public.human_agent_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS human_agent_conversations_own ON public.human_agent_conversations;
CREATE POLICY human_agent_conversations_own ON public.human_agent_conversations
  FOR ALL USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.human_agent_dev_tickets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description text        NOT NULL,
  context     jsonb       NOT NULL DEFAULT '{}',
  urgency     text        NOT NULL DEFAULT 'medium' CHECK (urgency IN ('low', 'medium', 'high')),
  status      text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.human_agent_dev_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS human_agent_dev_tickets_own ON public.human_agent_dev_tickets;
CREATE POLICY human_agent_dev_tickets_own ON public.human_agent_dev_tickets
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_human_agent_memory_user         ON public.human_agent_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_human_agent_conversations_user  ON public.human_agent_conversations(user_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_human_agent_dev_tickets_user    ON public.human_agent_dev_tickets(user_id);

DROP TRIGGER IF EXISTS set_human_agent_memory_updated_at ON public.human_agent_memory;
CREATE TRIGGER set_human_agent_memory_updated_at
  BEFORE UPDATE ON public.human_agent_memory
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS set_human_agent_conversations_updated_at ON public.human_agent_conversations;
CREATE TRIGGER set_human_agent_conversations_updated_at
  BEFORE UPDATE ON public.human_agent_conversations
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS set_human_agent_dev_tickets_updated_at ON public.human_agent_dev_tickets;
CREATE TRIGGER set_human_agent_dev_tickets_updated_at
  BEFORE UPDATE ON public.human_agent_dev_tickets
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
