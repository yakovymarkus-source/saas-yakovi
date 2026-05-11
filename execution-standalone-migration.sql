-- execution_standalone_migration.sql
-- Allow execution agent to run without a prior strategy report (standalone mode)
-- Run this in Supabase SQL Editor: https://app.supabase.com/project/saqvsbiehmxlmpsvguis/sql

ALTER TABLE public.execution_jobs
  ALTER COLUMN strategy_report_id DROP NOT NULL;

ALTER TABLE public.execution_jobs
  ADD COLUMN IF NOT EXISTS custom_brief jsonb;
