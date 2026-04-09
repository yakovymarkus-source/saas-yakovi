-- ══════════════════════════════════════════════════════════════════════════════
-- phase-a-production-fix.sql
-- הרץ קובץ זה ב-Supabase SQL Editor של הפרודקשן
--
-- סדר הרצה:
--   1. הרץ את schema.sql (הקובץ הבסיסי — עם IF NOT EXISTS)
--   2. הרץ את schema-addendum.sql (הקובץ הנוסף — עם IF NOT EXISTS)
--   3. הרץ את הקובץ הזה (stripe columns + ניקוי)
--
-- כל הפקודות בקובץ זה בטוחות לריצה כפולה (idempotent).
-- ══════════════════════════════════════════════════════════════════════════════

-- ── STEP A-3: הוספת עמודות Stripe לטבלת subscriptions ────────────────────────
-- נדרש עבור billing-webhook שמחפש עמודות אלה בעת עדכון מנוי
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id      text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id  text;

-- אינדקס מהיר לחיפוש מנוי לפי customer ID (נדרש ב-billing-webhook)
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON public.subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ── STEP A-4: ניקוי sync_jobs תקועים ─────────────────────────────────────────
-- jobs שנוצרו לפני תיקון הסכמה יישארו תקועים לנצח כי ה-RPC חסר.
-- לאחר הרצת schema.sql + schema-addendum.sql, נקה אותם ואפשר למשתמשים
-- להתחיל מחדש.
DELETE FROM public.sync_jobs
WHERE status IN ('queued', 'failed');

-- ── STEP A-5: וידוא admin ─────────────────────────────────────────────────────
-- schema-addendum.sql כבר מגדיר את האדמין אוטומטית, אך זו שמירה כפולה
UPDATE public.profiles
  SET is_admin = true
  WHERE email = 'yakovymarkus@gmail.com';

-- ── STEP A-6: בדיקת עמודות קריטיות אחרי הרצה ────────────────────────────────
-- הרץ את ה-SELECT הבאים לאחר שכל הקבצים רצו — כולם חייבים לחזור שורות:

-- בדיקה 1: עמודות subscriptions
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'subscriptions'
  AND column_name  IN ('payment_status','stripe_customer_id','stripe_subscription_id');
-- חייב לחזור 3 שורות

-- בדיקה 2: עמודת is_admin בprofiles
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'profiles'
  AND column_name  = 'is_admin';
-- חייב לחזור שורה אחת

-- בדיקה 3: RPCs קריטיים
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name   IN ('persist_analysis_atomic','set_payment_pending','activate_payment');
-- חייב לחזור 3 שורות

-- בדיקה 4: טבלאות חדשות
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name   IN ('business_profiles','ab_tests','strategy_memory','user_intelligence');
-- חייב לחזור 4 שורות

-- בדיקה 5: RLS מופעל
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('campaigns','profiles','subscriptions','sync_jobs','user_integrations');
-- כל השורות חייבות להציג rowsecurity = true
