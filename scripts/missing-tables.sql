-- ════════════════════════════════════════════════════════════════
-- missing-tables.sql
-- הרץ פעם אחת ב-Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════

-- ── audit_log ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  action      text        NOT NULL,
  target_id   text,
  target_type text,
  metadata    jsonb       NOT NULL DEFAULT '{}',
  ip          text,
  request_id  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_service_only ON public.audit_log;
CREATE POLICY audit_log_service_only ON public.audit_log FOR ALL USING (false) WITH CHECK (false);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON public.audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action       ON public.audit_log (action, created_at DESC);

-- ── usage_events ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usage_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name text        NOT NULL,
  metadata   jsonb       NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usage_events_service_only ON public.usage_events;
CREATE POLICY usage_events_service_only ON public.usage_events FOR ALL USING (false) WITH CHECK (false);
CREATE INDEX IF NOT EXISTS idx_usage_events_user_created ON public.usage_events (user_id, created_at DESC);
