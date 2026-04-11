-- ════════════════════════════════════════════════════════════════════════════
-- CAMPAIGNBRAIN — WAVE 1 MIGRATION
-- הרץ ב-Supabase SQL Editor פעם אחת
-- כל הפקודות בטוחות לריצה חוזרת (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. הרחבת business_profiles — עמודת profile_score ────────────────────────
-- הטבלה קיימת; רק מוסיפים עמודה שחסרה
ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS profile_score int NOT NULL DEFAULT 0;

-- ── 2. הרחבת generated_assets — lifecycle columns ───────────────────────────
-- הטבלה קיימת; מוסיפים status + parent_id בלי לגעת בשאר הקוד
ALTER TABLE public.generated_assets
  ADD COLUMN IF NOT EXISTS status    text NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.generated_assets(id) ON DELETE SET NULL;

-- assets קיימים = published (הגיוני — אם נשמרו, הם היו "פעילים")
UPDATE public.generated_assets
  SET status = 'published'
  WHERE status IS NULL OR status = '';

-- הגבלה: ערכים תקינים בלבד
ALTER TABLE public.generated_assets
  DROP CONSTRAINT IF EXISTS generated_assets_status_check;
ALTER TABLE public.generated_assets
  ADD CONSTRAINT generated_assets_status_check
  CHECK (status IN ('draft','published','archived','failed'));

CREATE INDEX IF NOT EXISTS idx_generated_assets_status ON public.generated_assets (user_id, status);
CREATE INDEX IF NOT EXISTS idx_generated_assets_parent ON public.generated_assets (parent_id);

-- ── 3. asset_metrics — מדדי ביצועים לכל asset ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.asset_metrics (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id    uuid          NOT NULL REFERENCES public.generated_assets(id) ON DELETE CASCADE,
  user_id     uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  impressions int           NOT NULL DEFAULT 0,
  clicks      int           NOT NULL DEFAULT 0,
  conversions int           NOT NULL DEFAULT 0,
  revenue     numeric(10,2) NOT NULL DEFAULT 0,
  source      text,                        -- 'manual' | 'pixel' | 'import'
  recorded_at timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.asset_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metrics_select_own ON public.asset_metrics;
DROP POLICY IF EXISTS metrics_insert_own ON public.asset_metrics;
DROP POLICY IF EXISTS metrics_update_own ON public.asset_metrics;
CREATE POLICY metrics_select_own ON public.asset_metrics FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY metrics_insert_own ON public.asset_metrics FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY metrics_update_own ON public.asset_metrics FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_asset_metrics_asset ON public.asset_metrics (asset_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_metrics_user  ON public.asset_metrics (user_id, recorded_at DESC);

-- ── 4. onboarding_progress — state machine מגובה DB ─────────────────────────
-- (מחליף את profiles.onboarding_completed הבוליאני הפשוט)
CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  user_id      uuid    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  steps        jsonb   NOT NULL DEFAULT '{
    "profile_started":  false,
    "profile_complete": false,
    "first_asset":      false,
    "multiple_assets":  false,
    "has_metrics":      false,
    "has_ab_data":      false
  }',
  current_step text    NOT NULL DEFAULT 'profile_started',
  completed    boolean NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS onboarding_select_own  ON public.onboarding_progress;
DROP POLICY IF EXISTS onboarding_upsert_own  ON public.onboarding_progress;
CREATE POLICY onboarding_select_own ON public.onboarding_progress FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY onboarding_upsert_own ON public.onboarding_progress FOR ALL    USING (auth.uid() = user_id);

-- ── 5. product_events — analytics על המוצר עצמו ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  event      text        NOT NULL,   -- 'page_view','asset_created','profile_updated'...
  properties jsonb       NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;
-- רק service role כותב events (מה-functions) — משתמש לא כותב ישירות
DROP POLICY IF EXISTS product_events_service_only ON public.product_events;
CREATE POLICY product_events_service_only ON public.product_events FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_product_events_user  ON public.product_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_events_event ON public.product_events (event, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- סיום
-- ════════════════════════════════════════════════════════════════════════════
