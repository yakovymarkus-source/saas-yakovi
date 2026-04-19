-- strategy-agent-migration.sql
-- Creates 3 tables: strategy_jobs, strategy_steps, strategy_reports
-- Depends on: research_reports (for FK) and set_updated_at() function (already exists)

-- ── strategy_jobs ─────────────────────────────────────────────────────────────
create table if not exists public.strategy_jobs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  research_report_id  uuid not null references public.research_reports(id) on delete cascade,
  niche               text not null,
  status              text not null default 'queued'
                        check (status in ('queued','running','completed','failed')),
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

create index if not exists strategy_jobs_user_id_idx    on public.strategy_jobs(user_id);
create index if not exists strategy_jobs_status_idx     on public.strategy_jobs(status);
create index if not exists strategy_jobs_created_at_idx on public.strategy_jobs(created_at desc);

create trigger set_strategy_jobs_updated_at
  before update on public.strategy_jobs
  for each row execute function public.set_updated_at();

alter table public.strategy_jobs enable row level security;

create policy "users see own strategy jobs"
  on public.strategy_jobs for select
  using (auth.uid() = user_id);

create policy "service role full access strategy_jobs"
  on public.strategy_jobs for all
  using (true)
  with check (true);


-- ── strategy_steps ────────────────────────────────────────────────────────────
create table if not exists public.strategy_steps (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.strategy_jobs(id) on delete cascade,
  step_index  int  not null,
  step_key    text not null,
  message     text not null,
  status      text not null default 'running'
                check (status in ('running','done','error','skipped')),
  data        jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists strategy_steps_job_id_idx    on public.strategy_steps(job_id);
create index if not exists strategy_steps_step_idx_idx  on public.strategy_steps(job_id, step_index);

alter table public.strategy_steps enable row level security;

create policy "users see own strategy steps"
  on public.strategy_steps for select
  using (
    exists (
      select 1 from public.strategy_jobs j
      where j.id = strategy_steps.job_id and j.user_id = auth.uid()
    )
  );

create policy "service role full access strategy_steps"
  on public.strategy_steps for all
  using (true)
  with check (true);


-- ── strategy_reports ─────────────────────────────────────────────────────────
create table if not exists public.strategy_reports (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.strategy_jobs(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  research_report_id  uuid not null references public.research_reports(id) on delete cascade,
  niche               text not null,
  -- Output Contract blocks
  product             jsonb not null default '{}'::jsonb,
  positioning         jsonb not null default '{}'::jsonb,
  strategy            jsonb not null default '{}'::jsonb,
  test_plan           jsonb not null default '{}'::jsonb,
  metrics             jsonb not null default '{}'::jsonb,
  risks               jsonb not null default '[]'::jsonb,
  fallback_options    jsonb not null default '[]'::jsonb,
  -- Meta
  confidence          int  not null default 0,
  validation_passed   boolean not null default false,
  ai_calls_made       int  not null default 0,
  generation_ms       int,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists strategy_reports_user_id_idx   on public.strategy_reports(user_id);
create index if not exists strategy_reports_job_id_idx    on public.strategy_reports(job_id);
create index if not exists strategy_reports_niche_idx     on public.strategy_reports(niche);
create index if not exists strategy_reports_created_at_idx on public.strategy_reports(created_at desc);

create trigger set_strategy_reports_updated_at
  before update on public.strategy_reports
  for each row execute function public.set_updated_at();

alter table public.strategy_reports enable row level security;

create policy "users see own strategy reports"
  on public.strategy_reports for select
  using (auth.uid() = user_id);

create policy "service role full access strategy_reports"
  on public.strategy_reports for all
  using (true)
  with check (true);
