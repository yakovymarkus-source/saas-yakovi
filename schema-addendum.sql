-- ══════════════════════════════════════════════════════════════════════════════
-- schema-addendum.sql — Multi-tenant OAuth SaaS: Addendum migrations
--
-- Run ONCE in Supabase SQL Editor AFTER the base schema.sql.
-- Adds token-status columns, account-name cache, and two helper RPCs.
-- All changes are idempotent (IF NOT EXISTS / OR REPLACE).
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Richer integration metadata ────────────────────────────────────────────
alter table public.user_integrations
  add column if not exists account_name       text,
  add column if not exists token_expires_at   timestamptz,
  add column if not exists connection_status  text not null default 'active'
    check (connection_status in ('active', 'expired', 'error', 'revoked')),
  add column if not exists oauth_scopes       text[],
  add column if not exists last_sync_at       timestamptz,
  add column if not exists last_error         text;

-- Useful for cron jobs that look for expiring / errored tokens
create index if not exists idx_user_integrations_status_expires
  on public.user_integrations (connection_status, token_expires_at);

-- ── 2. RPC: mark integration as successfully synced ───────────────────────────
create or replace function public.mark_integration_synced(
  p_user_id    uuid,
  p_provider   text,
  p_expires_at timestamptz default null,
  p_account_name text default null
)
returns void
language plpgsql
security definer
as $$
begin
  update public.user_integrations
  set
    last_sync_at      = now(),
    token_expires_at  = coalesce(p_expires_at, token_expires_at),
    connection_status = 'active',
    last_error        = null,
    account_name      = coalesce(p_account_name, account_name),
    updated_at        = now()
  where user_id = p_user_id
    and provider  = p_provider;
end;
$$;

-- ── 3. RPC: mark integration as errored ───────────────────────────────────────
create or replace function public.mark_integration_error(
  p_user_id  uuid,
  p_provider text,
  p_error    text
)
returns void
language plpgsql
security definer
as $$
begin
  update public.user_integrations
  set
    connection_status = 'error',
    last_error        = p_error,
    updated_at        = now()
  where user_id = p_user_id
    and provider  = p_provider;
end;
$$;

-- ── 4. Add oauth_nonces table (if not already present from base schema) ────────
create table if not exists public.oauth_nonces (
  id         uuid primary key default gen_random_uuid(),
  nonce      text not null unique,
  user_id    uuid not null references auth.users(id) on delete cascade,
  provider   text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.oauth_nonces enable row level security;
drop policy if exists oauth_nonces_service_only on public.oauth_nonces;
create policy oauth_nonces_service_only on public.oauth_nonces for all using (false) with check (false);

create index if not exists idx_oauth_nonces_user_provider on public.oauth_nonces (user_id, provider);
create index if not exists idx_oauth_nonces_expires on public.oauth_nonces (expires_at);

-- ── 5. Trigger: auto-mark token as expired when token_expires_at is reached ───
--   (Runs on UPDATE; useful if you refresh token_expires_at from the function)
create or replace function public.sync_connection_status()
returns trigger
language plpgsql
as $$
begin
  if new.token_expires_at is not null
     and new.token_expires_at < now()
     and new.connection_status = 'active'
  then
    new.connection_status := 'expired';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_connection_status on public.user_integrations;
create trigger trg_sync_connection_status
  before insert or update on public.user_integrations
  for each row execute procedure public.sync_connection_status();

-- ── 6. Admin bootstrap: auto-assign admin role to owner email ─────────────────
-- Grant admin to the owner account (run once, idempotent)
update public.profiles
  set is_admin = true
  where email = 'yakovymarkus@gmail.com';

-- Trigger: any future signup with this email also gets admin immediately
create or replace function public.auto_assign_admin()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.email = 'yakovymarkus@gmail.com' then
    new.is_admin := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_assign_admin on public.profiles;
create trigger trg_auto_assign_admin
  before insert or update of email on public.profiles
  for each row execute procedure public.auto_assign_admin();

-- ── 7. Manual payment verification flow ──────────────────────────────────────
-- payment_status tracks manual GrowLink verification separate from Stripe status
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'none'
    CHECK (payment_status IN ('none','pending','verified'));

-- Function for payment-pending function to call (service role)
CREATE OR REPLACE FUNCTION public.set_payment_pending(
  p_user_id uuid,
  p_plan     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, status, payment_status)
  VALUES (p_user_id, p_plan, 'active', 'pending')
  ON CONFLICT (user_id)
  DO UPDATE SET
    plan           = p_plan,
    payment_status = 'pending',
    updated_at     = now();
END;
$$;

-- Function for admin activation
CREATE OR REPLACE FUNCTION public.activate_payment(
  p_user_id uuid,
  p_plan     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, status, payment_status)
  VALUES (p_user_id, p_plan, 'active', 'verified')
  ON CONFLICT (user_id)
  DO UPDATE SET
    plan           = p_plan,
    status         = 'active',
    payment_status = 'verified',
    updated_at     = now();
END;
$$;

-- Unique constraint on user_id (subscriptions should be 1-per-user)
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_user_id_unique;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);

-- ── 8. Phase 4F: Strategy Memory ──────────────────────────────────────────────
--
-- One row per (user, campaign). Written by the learning engine (service role)
-- after every analyze run. Users can SELECT their own rows only.
-- Stores pre-computed trends so chat responses don't need heavy computation.
--
CREATE TABLE IF NOT EXISTS public.strategy_memory (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id            text        NOT NULL,
  period_start           timestamptz,
  period_end             timestamptz,
  data_points            integer     NOT NULL DEFAULT 0,
  persistent_bottlenecks jsonb       NOT NULL DEFAULT '[]',
  score_trend            text        NOT NULL DEFAULT 'stable'
                         CHECK (score_trend IN ('improving', 'declining', 'stable')),
  score_delta            numeric,
  dominant_verdict       text,
  iteration_action       jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_memory_user_campaign UNIQUE (user_id, campaign_id)
);

ALTER TABLE public.strategy_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_memory_select_own ON public.strategy_memory;
CREATE POLICY strategy_memory_select_own
  ON public.strategy_memory FOR SELECT
  USING (auth.uid() = user_id);

-- All writes are service-role only (admin client bypasses RLS)
DROP POLICY IF EXISTS strategy_memory_no_client_write ON public.strategy_memory;
CREATE POLICY strategy_memory_no_client_write
  ON public.strategy_memory FOR ALL
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_strategy_memory_user_campaign
  ON public.strategy_memory (user_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_strategy_memory_user_updated
  ON public.strategy_memory (user_id, updated_at DESC);

DROP TRIGGER IF EXISTS set_strategy_memory_updated_at ON public.strategy_memory;
CREATE TRIGGER set_strategy_memory_updated_at
  BEFORE UPDATE ON public.strategy_memory
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── 9. Business Profile — Static Business Memory ─────────────────────────────
--
-- One row per user. Stores the stable facts about the business: offer, pricing,
-- audience, positioning, tone, goals. Written via chat or intake flow.
-- This is the "brain" context that all other engines read from.
--
CREATE TABLE IF NOT EXISTS public.business_profiles (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Core identity
  business_name    text,
  category         text        CHECK (category IN ('ecommerce','services','lead_generation','course','saas','other')),
  -- Offer
  offer            text,                          -- one-sentence: what they sell
  price_amount     numeric,
  price_currency   text        NOT NULL DEFAULT 'ILS',
  pricing_model    text        CHECK (pricing_model IN ('one_time','recurring','session','retainer','free')),
  -- Target
  target_audience  text,                          -- who buys
  problem_solved   text,                          -- what pain it solves
  desired_outcome  text,                          -- what transformation/result the customer gets
  -- Positioning
  unique_mechanism text,                          -- the "how" that's different from competitors
  main_promise     text,                          -- headline promise
  tone_keywords    text[]      NOT NULL DEFAULT '{}',
  -- Business goals
  primary_goal     text        CHECK (primary_goal IN ('leads','sales','appointments','awareness')),
  monthly_budget   numeric,
  test_budget      numeric,
  -- Completion flag — used to detect if intake is done
  completed        boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_profiles_user_unique UNIQUE (user_id)
);

ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_profiles_select_own ON public.business_profiles;
DROP POLICY IF EXISTS business_profiles_write_own  ON public.business_profiles;
CREATE POLICY business_profiles_select_own ON public.business_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY business_profiles_write_own  ON public.business_profiles FOR ALL   USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_business_profiles_user ON public.business_profiles (user_id);

DROP TRIGGER IF EXISTS set_business_profiles_updated_at ON public.business_profiles;
CREATE TRIGGER set_business_profiles_updated_at
  BEFORE UPDATE ON public.business_profiles
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── 10. A/B Tests — Testing Architecture ──────────────────────────────────────
--
-- One row per test. Tracks: hypothesis, which variable is being tested, what's
-- constant, duration, stop condition, and final result.
-- Rule: one variable at a time. Never replace everything simultaneously.
--
CREATE TABLE IF NOT EXISTS public.ab_tests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id     text,
  -- Test definition
  hypothesis      text        NOT NULL,
  variable_name   text        NOT NULL
                  CHECK (variable_name IN ('headline','hook','creative','cta','offer_framing','audience','landing_order','copy')),
  control_value   text        NOT NULL,
  variant_value   text        NOT NULL,
  constants       text[]      NOT NULL DEFAULT '{}',   -- what must NOT change during this test
  -- Duration / stop rules
  start_date      date        NOT NULL DEFAULT CURRENT_DATE,
  planned_days    integer     NOT NULL DEFAULT 7,
  min_impressions integer     NOT NULL DEFAULT 1000,
  stop_condition  text,
  -- Status
  status          text        NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','paused','concluded','invalidated')),
  -- Result (filled when concluded)
  winner          text        CHECK (winner IN ('control','variant','inconclusive')),
  result_summary  text,
  concluded_at    date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ab_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ab_tests_select_own ON public.ab_tests;
DROP POLICY IF EXISTS ab_tests_write_own  ON public.ab_tests;
CREATE POLICY ab_tests_select_own ON public.ab_tests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY ab_tests_write_own  ON public.ab_tests FOR ALL   USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ab_tests_user_status   ON public.ab_tests (user_id, status);
CREATE INDEX IF NOT EXISTS idx_ab_tests_user_campaign ON public.ab_tests (user_id, campaign_id);

DROP TRIGGER IF EXISTS set_ab_tests_updated_at ON public.ab_tests;
CREATE TRIGGER set_ab_tests_updated_at
  BEFORE UPDATE ON public.ab_tests
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── 11. Phase 4D: User Intelligence & Adaptive Memory ────────────────────────
--
-- One row per (user, category, key). Upserted from the backend; never updated
-- by the user directly. RLS blocks direct client access entirely.
--
CREATE TABLE IF NOT EXISTS public.user_intelligence (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category    text        NOT NULL CHECK (category IN ('preference','pattern','insight','goal')),
  key         text        NOT NULL,
  value       jsonb       NOT NULL DEFAULT '{}',
  confidence  numeric(3,2) NOT NULL DEFAULT 0.5
              CHECK (confidence >= 0 AND confidence <= 1),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT  user_intelligence_unique UNIQUE (user_id, category, key)
);

CREATE INDEX IF NOT EXISTS idx_user_intelligence_user
  ON public.user_intelligence (user_id);

-- RLS: service role only — users never read/write this table directly
ALTER TABLE public.user_intelligence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_intelligence_service_only ON public.user_intelligence;
CREATE POLICY user_intelligence_service_only
  ON public.user_intelligence
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- ── 12. AI Request Log — Provider Observability ───────────────────────────────
--
-- One row per AI provider call. Written fire-and-forget by orchestrator.js.
-- Stores metadata only — no prompt text, no response content (privacy + cost).
-- Useful for: cost attribution, provider debugging, latency tracking.
-- RLS: service role only — users never read/write directly.
--
CREATE TABLE IF NOT EXISTS public.ai_requests (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id        text,
  capability        text        NOT NULL,
  provider          text        NOT NULL,
  model             text,
  prompt_tokens     integer,
  completion_tokens integer,
  latency_ms        integer,
  status            text        NOT NULL CHECK (status IN ('success', 'error', 'timeout')),
  error_code        text,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_requests_service_only ON public.ai_requests;
CREATE POLICY ai_requests_service_only
  ON public.ai_requests
  FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_ai_requests_user_created
  ON public.ai_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_requests_capability_status
  ON public.ai_requests (capability, status, created_at DESC);
