# מדריך הפעלה לפרודקשן — CampaignBrain
## 3 שלבים לביצוע ידני

---

## שלב 1 — Supabase SQL Editor

### כיצד מגיעים:
1. https://supabase.com → כנס לפרויקט
2. בתפריט השמאלי: **SQL Editor**
3. לחץ **+ New query**
4. הדבק את כל הבלוק הבא **כולל הכל** ולחץ **Run**

### ⚠️ חשוב לפני הרצה:
- אם קיימים 2+ שורות באותו `user_id` בטבלת `subscriptions` — הרץ קודם:
  `DELETE FROM public.subscriptions WHERE id NOT IN (SELECT MIN(id) FROM public.subscriptions GROUP BY user_id);`
- הרץ את כל הבלוק פעם אחת. הכל idempotent — בטוח להרצה חוזרת.

---

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- CAMPAIGNBRAIN — FULL PRODUCTION SCHEMA
-- הרץ בלוק זה פעם אחת ב-Supabase SQL Editor
-- כל הפקודות בטוחות לריצה חוזרת (IF NOT EXISTS / OR REPLACE)
-- ════════════════════════════════════════════════════════════════════════════

-- ── פונקציית עזר גלובלית ────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ── טבלה: profiles ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text NOT NULL,
  name       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url          text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS preferences         jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deleted_at          timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin            boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at ON public.profiles (deleted_at);

-- טריגר: יצירת profile אוטומטית עם כל הרשמה
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', SPLIT_PART(NEW.email,'@',1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── admin bootstrap ──────────────────────────────────────────────────────────
UPDATE public.profiles SET is_admin = true WHERE email = 'yakovymarkus@gmail.com';

CREATE OR REPLACE FUNCTION public.auto_assign_admin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.email = 'yakovymarkus@gmail.com' THEN NEW.is_admin := true; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_auto_assign_admin ON public.profiles;
CREATE TRIGGER trg_auto_assign_admin
  BEFORE INSERT OR UPDATE OF email ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.auto_assign_admin();

-- ── טבלה: subscriptions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan       text NOT NULL DEFAULT 'free',
  status     text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS payment_status       text DEFAULT 'none' CHECK (payment_status IN ('none','pending','verified'));
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id   text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscriptions_select_own ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_insert_own ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_update_own ON public.subscriptions;
CREATE POLICY subscriptions_select_own ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY subscriptions_insert_own ON public.subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY subscriptions_update_own ON public.subscriptions FOR UPDATE USING (auth.uid() = user_id);

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_unique;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON public.subscriptions (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- ── טבלה: campaigns ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaigns (
  id            text PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaigns_owner_access ON public.campaigns;
CREATE POLICY campaigns_owner_access ON public.campaigns
  FOR ALL USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);
DROP TRIGGER IF EXISTS set_campaigns_updated_at ON public.campaigns;
CREATE TRIGGER set_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── טבלה: sync_jobs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sync_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id    text NOT NULL,
  status         text NOT NULL CHECK (status IN ('queued','running','done','failed')),
  payload        jsonb NOT NULL DEFAULT '{}',
  result_payload jsonb,
  error_message  text,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_jobs_select_own ON public.sync_jobs;
DROP POLICY IF EXISTS sync_jobs_insert_own ON public.sync_jobs;
CREATE POLICY sync_jobs_select_own ON public.sync_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY sync_jobs_insert_own ON public.sync_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS set_sync_jobs_updated_at ON public.sync_jobs;
CREATE TRIGGER set_sync_jobs_updated_at
  BEFORE UPDATE ON public.sync_jobs FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ניקוי jobs תקועים מלפני תיקון הסכמה
DELETE FROM public.sync_jobs WHERE status IN ('queued','failed');

-- ── טבלה: user_integrations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_integrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider         text NOT NULL CHECK (provider IN ('ga4','meta','google_ads')),
  account_id       text,
  property_id      text,
  metadata         jsonb NOT NULL DEFAULT '{}',
  secret_ciphertext text NOT NULL,
  secret_iv        text NOT NULL,
  secret_tag       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);
ALTER TABLE public.user_integrations ADD COLUMN IF NOT EXISTS account_name      text;
ALTER TABLE public.user_integrations ADD COLUMN IF NOT EXISTS token_expires_at  timestamptz;
ALTER TABLE public.user_integrations ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'active'
  CHECK (connection_status IN ('active','expired','error','revoked'));
ALTER TABLE public.user_integrations ADD COLUMN IF NOT EXISTS oauth_scopes      text[];
ALTER TABLE public.user_integrations ADD COLUMN IF NOT EXISTS last_sync_at      timestamptz;
ALTER TABLE public.user_integrations ADD COLUMN IF NOT EXISTS last_error        text;

ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS integrations_select_own ON public.user_integrations;
DROP POLICY IF EXISTS integrations_insert_own ON public.user_integrations;
DROP POLICY IF EXISTS integrations_update_own ON public.user_integrations;
DROP POLICY IF EXISTS integrations_delete_own ON public.user_integrations;
CREATE POLICY integrations_select_own ON public.user_integrations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY integrations_insert_own ON public.user_integrations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY integrations_update_own ON public.user_integrations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY integrations_delete_own ON public.user_integrations FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_integrations_user_provider ON public.user_integrations (user_id, provider);
CREATE INDEX IF NOT EXISTS idx_user_integrations_status_expires ON public.user_integrations (connection_status, token_expires_at);

DROP TRIGGER IF EXISTS set_user_integrations_updated_at ON public.user_integrations;
CREATE TRIGGER set_user_integrations_updated_at
  BEFORE UPDATE ON public.user_integrations FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- טריגר: auto-expire token
CREATE OR REPLACE FUNCTION public.sync_connection_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.token_expires_at IS NOT NULL
     AND NEW.token_expires_at < now()
     AND NEW.connection_status = 'active'
  THEN NEW.connection_status := 'expired'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_sync_connection_status ON public.user_integrations;
CREATE TRIGGER trg_sync_connection_status
  BEFORE INSERT OR UPDATE ON public.user_integrations
  FOR EACH ROW EXECUTE PROCEDURE public.sync_connection_status();

-- ── טבלאות תמיכה (api_cache, request_logs, provider_health, oauth_nonces) ───
CREATE TABLE IF NOT EXISTS public.api_cache (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key    text NOT NULL UNIQUE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source       text NOT NULL,
  range_preset text NOT NULL,
  metric       text NOT NULL,
  payload      jsonb NOT NULL,
  fresh_until  timestamptz NOT NULL,
  stale_until  timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cache_select_own ON public.api_cache;
DROP POLICY IF EXISTS cache_modify_own ON public.api_cache;
CREATE POLICY cache_select_own ON public.api_cache FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY cache_modify_own ON public.api_cache FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_api_cache_user_source ON public.api_cache (user_id, source, range_preset, metric);

CREATE TABLE IF NOT EXISTS public.oauth_nonces (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce      text NOT NULL UNIQUE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider   text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.oauth_nonces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oauth_nonces_service_only ON public.oauth_nonces;
CREATE POLICY oauth_nonces_service_only ON public.oauth_nonces FOR ALL USING (false) WITH CHECK (false);
CREATE INDEX IF NOT EXISTS idx_oauth_nonces_user_provider ON public.oauth_nonces (user_id, provider);
CREATE INDEX IF NOT EXISTS idx_oauth_nonces_expires ON public.oauth_nonces (expires_at);

CREATE TABLE IF NOT EXISTS public.request_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   text NOT NULL,
  function_name text NOT NULL,
  level        text NOT NULL,
  message      text NOT NULL,
  ip           text,
  metadata     jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.request_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS request_logs_service_only ON public.request_logs;
CREATE POLICY request_logs_service_only ON public.request_logs FOR ALL USING (false) WITH CHECK (false);
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON public.request_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS public.provider_health (
  provider              text PRIMARY KEY,
  consecutive_failures  integer NOT NULL DEFAULT 0,
  last_status           text,
  last_error            text,
  last_checked_at       timestamptz,
  circuit_open_until    timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.provider_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_health_service_only ON public.provider_health;
CREATE POLICY provider_health_service_only ON public.provider_health FOR ALL USING (false) WITH CHECK (false);
DROP TRIGGER IF EXISTS set_provider_health_updated_at ON public.provider_health;
CREATE TRIGGER set_provider_health_updated_at
  BEFORE UPDATE ON public.provider_health FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── טבלאות ניתוח: analysis_results, decision_history, recommendations ────────
CREATE TABLE IF NOT EXISTS public.analysis_results (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id text NOT NULL,
  request_id  text,
  timestamp   timestamptz NOT NULL DEFAULT now(),
  version     text NOT NULL,
  raw_snapshot jsonb NOT NULL,
  metrics     jsonb NOT NULL,
  scores      jsonb NOT NULL,
  bottlenecks jsonb NOT NULL,
  confidence  numeric NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.analysis_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analysis_results_select_own ON public.analysis_results;
CREATE POLICY analysis_results_select_own ON public.analysis_results FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_user_campaign_ts ON public.analysis_results (user_id, campaign_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS public.decision_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_result_id uuid NOT NULL REFERENCES public.analysis_results(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id        text NOT NULL,
  timestamp          timestamptz NOT NULL DEFAULT now(),
  version            text NOT NULL,
  verdict            text NOT NULL,
  reason             text NOT NULL,
  confidence         numeric NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.decision_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS decision_history_select_own ON public.decision_history;
CREATE POLICY decision_history_select_own ON public.decision_history FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_decision_history_user_campaign_ts ON public.decision_history (user_id, campaign_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS public.recommendations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_result_id uuid NOT NULL REFERENCES public.analysis_results(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id        text NOT NULL,
  timestamp          timestamptz NOT NULL DEFAULT now(),
  version            text NOT NULL,
  issue              text NOT NULL,
  root_cause         text NOT NULL,
  action             text NOT NULL,
  expected_impact    text NOT NULL,
  urgency            numeric NOT NULL,
  effort             numeric NOT NULL,
  confidence         numeric NOT NULL,
  priority_score     numeric NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recommendations_select_own ON public.recommendations;
CREATE POLICY recommendations_select_own ON public.recommendations FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_user_campaign_ts ON public.recommendations (user_id, campaign_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS public.campaign_snapshots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_result_id uuid NOT NULL REFERENCES public.analysis_results(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id        text NOT NULL,
  timestamp          timestamptz NOT NULL DEFAULT now(),
  version            text NOT NULL,
  raw_metrics_snapshot jsonb NOT NULL,
  computed_scores    jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.campaign_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_snapshots_select_own ON public.campaign_snapshots;
CREATE POLICY campaign_snapshots_select_own ON public.campaign_snapshots FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_snapshots_user_campaign_ts ON public.campaign_snapshots (user_id, campaign_id, timestamp DESC);

-- ── RPC: persist_analysis_atomic ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.persist_analysis_atomic(p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_analysis_id uuid;
  v_analysis    jsonb := COALESCE(p_payload->'analysis_result', '{}');
  v_snapshot    jsonb := COALESCE(p_payload->'campaign_snapshot', '{}');
  v_decision    jsonb;
  v_reco        jsonb;
BEGIN
  INSERT INTO public.analysis_results (user_id,campaign_id,request_id,timestamp,version,raw_snapshot,metrics,scores,bottlenecks,confidence)
  VALUES (
    (v_analysis->>'user_id')::uuid,
    v_analysis->>'campaign_id',
    v_analysis->>'request_id',
    COALESCE((v_analysis->>'timestamp')::timestamptz, now()),
    v_analysis->>'version',
    COALESCE(v_analysis->'raw_snapshot','{}'),
    COALESCE(v_analysis->'metrics','{}'),
    COALESCE(v_analysis->'scores','{}'),
    COALESCE(v_analysis->'bottlenecks','[]'),
    COALESCE((v_analysis->>'confidence')::numeric, 0)
  ) RETURNING id INTO v_analysis_id;

  INSERT INTO public.campaign_snapshots (analysis_result_id,user_id,campaign_id,timestamp,version,raw_metrics_snapshot,computed_scores)
  VALUES (
    v_analysis_id,
    (v_snapshot->>'user_id')::uuid,
    v_snapshot->>'campaign_id',
    COALESCE((v_snapshot->>'timestamp')::timestamptz, now()),
    v_snapshot->>'version',
    COALESCE(v_snapshot->'raw_metrics_snapshot','{}'),
    COALESCE(v_snapshot->'computed_scores','{}')
  );

  FOR v_decision IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'decisions','[]')) LOOP
    INSERT INTO public.decision_history (analysis_result_id,user_id,campaign_id,timestamp,version,verdict,reason,confidence)
    VALUES (v_analysis_id,(v_decision->>'user_id')::uuid,v_decision->>'campaign_id',
      COALESCE((v_decision->>'timestamp')::timestamptz,now()),v_decision->>'version',
      v_decision->>'verdict',v_decision->>'reason',COALESCE((v_decision->>'confidence')::numeric,0));
  END LOOP;

  FOR v_reco IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'recommendations','[]')) LOOP
    INSERT INTO public.recommendations (analysis_result_id,user_id,campaign_id,timestamp,version,issue,root_cause,action,expected_impact,urgency,effort,confidence,priority_score)
    VALUES (v_analysis_id,(v_reco->>'user_id')::uuid,v_reco->>'campaign_id',
      COALESCE((v_reco->>'timestamp')::timestamptz,now()),v_reco->>'version',
      v_reco->>'issue',v_reco->>'root_cause',v_reco->>'action',v_reco->>'expected_impact',
      COALESCE((v_reco->>'urgency')::numeric,0),COALESCE((v_reco->>'effort')::numeric,0),
      COALESCE((v_reco->>'confidence')::numeric,0),COALESCE((v_reco->>'priority_score')::numeric,0));
  END LOOP;

  RETURN v_analysis_id;
END; $$;

-- ── RPC: set_payment_pending ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_payment_pending(p_user_id uuid, p_plan text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, status, payment_status)
  VALUES (p_user_id, p_plan, 'active', 'pending')
  ON CONFLICT (user_id) DO UPDATE SET
    plan = p_plan, payment_status = 'pending', updated_at = now();
END; $$;

-- ── RPC: activate_payment ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activate_payment(p_user_id uuid, p_plan text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, status, payment_status)
  VALUES (p_user_id, p_plan, 'active', 'verified')
  ON CONFLICT (user_id) DO UPDATE SET
    plan = p_plan, status = 'active', payment_status = 'verified', updated_at = now();
END; $$;

-- ── RPCs: integration helpers ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_integration_synced(
  p_user_id uuid, p_provider text, p_expires_at timestamptz DEFAULT NULL, p_account_name text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.user_integrations
  SET last_sync_at=now(), token_expires_at=COALESCE(p_expires_at,token_expires_at),
      connection_status='active', last_error=NULL, account_name=COALESCE(p_account_name,account_name), updated_at=now()
  WHERE user_id=p_user_id AND provider=p_provider;
END; $$;

CREATE OR REPLACE FUNCTION public.mark_integration_error(p_user_id uuid, p_provider text, p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.user_integrations
  SET connection_status='error', last_error=p_error, updated_at=now()
  WHERE user_id=p_user_id AND provider=p_provider;
END; $$;

-- ── טבלה: business_profiles ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.business_profiles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name    text,
  category         text CHECK (category IN ('ecommerce','services','lead_generation','course','saas','other')),
  offer            text,
  price_amount     numeric,
  price_currency   text NOT NULL DEFAULT 'ILS',
  pricing_model    text CHECK (pricing_model IN ('one_time','recurring','session','retainer','free')),
  target_audience  text,
  problem_solved   text,
  desired_outcome  text,
  unique_mechanism text,
  main_promise     text,
  tone_keywords    text[] NOT NULL DEFAULT '{}',
  primary_goal     text CHECK (primary_goal IN ('leads','sales','appointments','awareness')),
  monthly_budget   numeric,
  test_budget      numeric,
  completed        boolean NOT NULL DEFAULT false,
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
  BEFORE UPDATE ON public.business_profiles FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── טבלה: strategy_memory ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.strategy_memory (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id            text NOT NULL,
  period_start           timestamptz,
  period_end             timestamptz,
  data_points            integer NOT NULL DEFAULT 0,
  persistent_bottlenecks jsonb NOT NULL DEFAULT '[]',
  score_trend            text NOT NULL DEFAULT 'stable' CHECK (score_trend IN ('improving','declining','stable')),
  score_delta            numeric,
  dominant_verdict       text,
  iteration_action       jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_memory_user_campaign UNIQUE (user_id, campaign_id)
);
ALTER TABLE public.strategy_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strategy_memory_select_own      ON public.strategy_memory;
DROP POLICY IF EXISTS strategy_memory_no_client_write ON public.strategy_memory;
CREATE POLICY strategy_memory_select_own      ON public.strategy_memory FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY strategy_memory_no_client_write ON public.strategy_memory FOR ALL USING (false) WITH CHECK (false);
CREATE INDEX IF NOT EXISTS idx_strategy_memory_user_campaign ON public.strategy_memory (user_id, campaign_id);
DROP TRIGGER IF EXISTS set_strategy_memory_updated_at ON public.strategy_memory;
CREATE TRIGGER set_strategy_memory_updated_at
  BEFORE UPDATE ON public.strategy_memory FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── טבלה: ab_tests ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ab_tests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id     text,
  hypothesis      text NOT NULL,
  variable_name   text NOT NULL CHECK (variable_name IN ('headline','hook','creative','cta','offer_framing','audience','landing_order','copy')),
  control_value   text NOT NULL,
  variant_value   text NOT NULL,
  constants       text[] NOT NULL DEFAULT '{}',
  start_date      date NOT NULL DEFAULT CURRENT_DATE,
  planned_days    integer NOT NULL DEFAULT 7,
  min_impressions integer NOT NULL DEFAULT 1000,
  stop_condition  text,
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','paused','concluded','invalidated')),
  winner          text CHECK (winner IN ('control','variant','inconclusive')),
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
  BEFORE UPDATE ON public.ab_tests FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── טבלה: user_intelligence ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_intelligence (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category   text NOT NULL CHECK (category IN ('preference','pattern','insight','goal')),
  key        text NOT NULL,
  value      jsonb NOT NULL DEFAULT '{}',
  confidence numeric(3,2) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_intelligence_unique UNIQUE (user_id, category, key)
);
ALTER TABLE public.user_intelligence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_intelligence_service_only ON public.user_intelligence;
CREATE POLICY user_intelligence_service_only ON public.user_intelligence FOR ALL USING (false) WITH CHECK (false);
CREATE INDEX IF NOT EXISTS idx_user_intelligence_user ON public.user_intelligence (user_id);

-- ── טבלה: ai_requests ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id        text,
  capability        text NOT NULL,
  provider          text NOT NULL,
  model             text,
  prompt_tokens     integer,
  completion_tokens integer,
  latency_ms        integer,
  status            text NOT NULL CHECK (status IN ('success','error','timeout')),
  error_code        text,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_requests_service_only ON public.ai_requests;
CREATE POLICY ai_requests_service_only ON public.ai_requests FOR ALL USING (false) WITH CHECK (false);
CREATE INDEX IF NOT EXISTS idx_ai_requests_user_created ON public.ai_requests (user_id, created_at DESC);

-- ── בדיקת תקינות — הרץ SELECT אחרי הכל ────────────────────────────────────
-- חייב לחזור 3 שורות:
SELECT routine_name FROM information_schema.routines
WHERE routine_schema='public'
  AND routine_name IN ('persist_analysis_atomic','set_payment_pending','activate_payment');

-- חייב לחזור 5 שורות עם rowsecurity=true:
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname='public'
  AND tablename IN ('campaigns','profiles','subscriptions','sync_jobs','user_integrations');

-- חייב לחזור 3 שורות (payment_status, stripe_customer_id, stripe_subscription_id):
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='subscriptions'
  AND column_name IN ('payment_status','stripe_customer_id','stripe_subscription_id');
```

---

## שלב 2 — Supabase Auth Settings

### CA-007: הגדרת SMTP מותאם

**נתיב:** Supabase Dashboard → ⚙️ Project Settings → Authentication → **SMTP Settings**

1. הפעל את הטוגל **Enable Custom SMTP**
2. מלא את השדות:

| שדה | ערך לדוגמה (Resend) | ערך לדוגמה (SendGrid) |
|-----|---------------------|----------------------|
| **Sender name** | CampaignBrain | CampaignBrain |
| **Sender email** | noreply@campaignbrain.app | noreply@campaignbrain.app |
| **Host** | smtp.resend.com | smtp.sendgrid.net |
| **Port** | 465 | 465 |
| **Username** | resend | apikey |
| **Password** | re_xxxxxxxxxxxx | SG.xxxxxxxxxx |

3. לחץ **Save**
4. בדיקה: נסה הרשמה עם מייל אמיתי — מייל אימות חייב להגיע תוך 60 שניות

> **ספק מומלץ:** Resend.com — חינמי ל-3,000 מיילים/חודש, קל להגדרה

---

### CA-012: הפחתת JWT Expiry

**נתיב:** Supabase Dashboard → ⚙️ Project Settings → Authentication → **JWT Settings**

| שדה | ערך נוכחי | ערך חדש |
|-----|-----------|---------|
| **JWT expiry limit** | 3600 | **900** |

לחץ **Save** — יחול על כל sessions חדשים מיד.

---

## שלב 3 — Netlify + Stripe

### CA-004: הגדרת Environment Variables

**נתיב:** Netlify Dashboard → Sites → campaignbrain → Site configuration → **Environment variables**

#### איפה מוצאים כל ערך ב-Stripe:

**STRIPE_SECRET_KEY:**
- Stripe Dashboard → Developers → **API keys**
- העתק את **Secret key** (מתחיל ב-`sk_live_...`)
- ⚠️ לפרודקשן: `sk_live_...` — לא `sk_test_...`

**STRIPE_WEBHOOK_SECRET:**
- Stripe Dashboard → Developers → **Webhooks** → **+ Add endpoint**
- Endpoint URL: `https://campaignbrain.netlify.app/.netlify/functions/billing-webhook`
- Events לבחור:
  - ✅ `invoice.payment_succeeded`
  - ✅ `invoice.payment_failed`
  - ✅ `customer.subscription.deleted`
  - ✅ `customer.subscription.updated`
- לחץ **Add endpoint**
- בדף ה-webhook שנוצר: לחץ **Reveal** תחת **Signing secret**
- זה הערך שלך (מתחיל ב-`whsec_...`)

#### טבלת כל הVariables שחובה להוסיף:

| Variable Name | מאיפה להביא | חובה? |
|---------------|-------------|-------|
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → Secret key | ✅ חובה |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → Signing secret | ✅ חובה |
| `STRIPE_PRICE_STARTER` | Stripe → Product catalog → Starter plan → Price ID | אם יש |
| `STRIPE_PRICE_PRO` | Stripe → Product catalog → Pro plan → Price ID | אם יש |
| `STRIPE_PRICE_AGENCY` | Stripe → Product catalog → Agency plan → Price ID | אם יש |
| `RESEND_API_KEY` | Resend.com → API Keys | לפונקציות מייל |
| `EMAIL_FROM` | הכתובת שממנה יישלחו מיילים | לפונקציות מייל |
| `ADMIN_EMAIL` | yakovymarkus@gmail.com | להתראות admin |

#### לאחר הוספת כל הVariables:
1. לחץ **Save**
2. עבור ל: Deploys → **Trigger deploy** → **Deploy site**
3. המתן לסיום ה-deploy (~2 דקות)

---

## בדיקה סופית לאחר כל 3 השלבים

```
1. הרשמה עם מייל אמיתי → מייל אימות מגיע תוך 60 שניות
2. כניסה → sidebar מציג את התוכנית הנכונה (לא "חינמי")
3. GET /.netlify/functions/admin-overview עם admin token → 200
4. POST /.netlify/functions/payment-pending → 200 (לא 500)
5. בקשה אנונימית DELETE לcampaigns → 403 (לא 204)
```
