-- execution-agent-migration.sql
-- Creates 3 tables: execution_jobs, execution_steps, execution_reports
-- Depends on: strategy_reports (for FK) and set_updated_at() function

-- ── execution_jobs ─────────────────────────────────────────────────────────────
create table if not exists public.execution_jobs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  strategy_report_id  uuid not null references public.strategy_reports(id) on delete cascade,
  status              text not null default 'queued'
                        check (status in ('queued','running','completed','failed')),
  execution_mode      text not null default 'smart'
                        check (execution_mode in ('draft','smart','premium')),
  platform            text not null default 'meta',
  asset_types         text[] not null default '{}',
  estimated_minutes   int  not null default 2,
  credits_used        int  not null default 0,
  ai_calls_used       int,
  generation_ms       int,
  report_id           uuid,
  error_message       text,
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists execution_jobs_user_id_idx    on public.execution_jobs(user_id);
create index if not exists execution_jobs_status_idx     on public.execution_jobs(status);
create index if not exists execution_jobs_strategy_idx   on public.execution_jobs(strategy_report_id);
create index if not exists execution_jobs_created_at_idx on public.execution_jobs(created_at desc);

create trigger set_execution_jobs_updated_at
  before update on public.execution_jobs
  for each row execute function public.set_updated_at();

alter table public.execution_jobs enable row level security;

create policy "users see own execution jobs"
  on public.execution_jobs for select
  using (auth.uid() = user_id);

create policy "service role full access execution_jobs"
  on public.execution_jobs for all
  using (true)
  with check (true);


-- ── execution_steps ────────────────────────────────────────────────────────────
create table if not exists public.execution_steps (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.execution_jobs(id) on delete cascade,
  step_index  numeric not null,
  step_key    text not null,
  message     text not null,
  status      text not null default 'running'
                check (status in ('running','done','error','skipped')),
  data        jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists execution_steps_job_id_idx   on public.execution_steps(job_id);
create index if not exists execution_steps_step_idx_idx on public.execution_steps(job_id, step_index);

alter table public.execution_steps enable row level security;

create policy "users see own execution steps"
  on public.execution_steps for select
  using (
    exists (
      select 1 from public.execution_jobs j
      where j.id = execution_steps.job_id and j.user_id = auth.uid()
    )
  );

create policy "service role full access execution_steps"
  on public.execution_steps for all
  using (true)
  with check (true);


-- ── execution_reports ─────────────────────────────────────────────────────────
create table if not exists public.execution_reports (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.execution_jobs(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  strategy_report_id  uuid references public.strategy_reports(id) on delete set null,
  platform            text,
  execution_mode      text,
  asset_types         text[],
  -- Content blocks
  brief               jsonb not null default '{}'::jsonb,
  message_core        jsonb not null default '{}'::jsonb,
  assets              jsonb not null default '{}'::jsonb,
  ranking             jsonb,
  self_feedback       jsonb,
  qa_handoff          jsonb not null default '{}'::jsonb,
  warnings            jsonb not null default '[]'::jsonb,
  -- Meta
  ai_calls_made       int  not null default 0,
  generation_ms       int,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists execution_reports_user_id_idx   on public.execution_reports(user_id);
create index if not exists execution_reports_job_id_idx    on public.execution_reports(job_id);
create index if not exists execution_reports_strategy_idx  on public.execution_reports(strategy_report_id);
create index if not exists execution_reports_created_at_idx on public.execution_reports(created_at desc);

create trigger set_execution_reports_updated_at
  before update on public.execution_reports
  for each row execute function public.set_updated_at();

alter table public.execution_reports enable row level security;

create policy "users see own execution reports"
  on public.execution_reports for select
  using (auth.uid() = user_id);

create policy "service role full access execution_reports"
  on public.execution_reports for all
  using (true)
  with check (true);
