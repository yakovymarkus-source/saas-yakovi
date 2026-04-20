-- orchestration_jobs table
-- Stores jobs for the analyze-campaign-background function

CREATE TABLE IF NOT EXISTS orchestration_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  user_email      TEXT,
  campaign_id     TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('research', 'strategy', 'execution', 'qa', 'analysis')),
  campaign_data   JSONB,
  analysis_data   JSONB,
  goal            JSONB,
  automation_level TEXT DEFAULT 'semi',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  result          JSONB,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS orchestration_jobs_user_id_idx ON orchestration_jobs(user_id);
CREATE INDEX IF NOT EXISTS orchestration_jobs_status_idx ON orchestration_jobs(status);
CREATE INDEX IF NOT EXISTS orchestration_jobs_campaign_id_idx ON orchestration_jobs(campaign_id);

-- Row Level Security
ALTER TABLE orchestration_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can view own orchestration jobs"
  ON orchestration_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "service role has full access"
  ON orchestration_jobs FOR ALL
  USING (true)
  WITH CHECK (true);
