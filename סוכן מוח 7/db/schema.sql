CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id TEXT,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  objective TEXT,
  currency TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT campaigns_user_source_external_unique UNIQUE (user_id, source, external_id)
);

CREATE TABLE IF NOT EXISTS analysis_results (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logs (
  id UUID PRIMARY KEY,
  request_id TEXT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  analysis_id UUID REFERENCES analysis_results(id) ON DELETE SET NULL,
  level TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_user_id ON analysis_results(user_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_campaign_id ON analysis_results(campaign_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_input_hash ON analysis_results(input_hash);
CREATE INDEX IF NOT EXISTS idx_logs_user_campaign ON logs(user_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_logs_request_id ON logs(request_id);
CREATE INDEX IF NOT EXISTS idx_logs_analysis_id ON logs(analysis_id);


CREATE TABLE IF NOT EXISTS campaign_strategies (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_payload JSONB NOT NULL,
  verdict_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT campaign_strategies_unique UNIQUE (campaign_id, user_id)
);

CREATE TABLE IF NOT EXISTS campaign_assets (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  version INTEGER NOT NULL,
  angle TEXT NOT NULL,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT campaign_assets_campaign_type_version_unique UNIQUE (campaign_id, user_id, type, version)
);

CREATE TABLE IF NOT EXISTS campaign_optimizations (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  input_payload JSONB NOT NULL,
  diagnosis_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_strategies_campaign_user ON campaign_strategies(campaign_id, user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_assets_campaign_user_type ON campaign_assets(campaign_id, user_id, type);
CREATE INDEX IF NOT EXISTS idx_campaign_optimizations_campaign_user ON campaign_optimizations(campaign_id, user_id);
