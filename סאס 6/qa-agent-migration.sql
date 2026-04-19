-- qa-agent-migration.sql
-- Tables: qa_jobs, qa_steps, qa_reports

-- ── qa_jobs ────────────────────────────────────────────────────────────────────
create table if not exists public.qa_jobs (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  execution_report_id  uuid not null references public.execution_reports(id) on delete cascade,
  research_report_id   uuid references public.research_reports(id) on delete set null,
  status               text not null default 'queued'
                         check (status in ('queued','running','completed','failed')),
  verdict              text check (verdict in ('approve','improve','reject')),
  overall_score        int,
  ai_calls_used        int,
  generation_ms        int,
  report_id            uuid,
  error_message        text,
  started_at           timestamptz,
  completed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists qa_jobs_user_id_idx       on public.qa_jobs(user_id);
create index if not exists qa_jobs_status_idx        on public.qa_jobs(status);
create index if not exists qa_jobs_exec_report_idx   on public.qa_jobs(execution_report_id);
create index if not exists qa_jobs_created_at_idx    on public.qa_jobs(created_at desc);

create trigger set_qa_jobs_updated_at
  before update on public.qa_jobs
  for each row execute function public.set_updated_at();

alter table public.qa_jobs enable row level security;

create policy "users see own qa jobs"
  on public.qa_jobs for select using (auth.uid() = user_id);

create policy "service role full access qa_jobs"
  on public.qa_jobs for all using (true) with check (true);


-- ── qa_steps ───────────────────────────────────────────────────────────────────
create table if not exists public.qa_steps (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.qa_jobs(id) on delete cascade,
  step_index  numeric not null,
  step_key    text not null,
  message     text not null,
  status      text not null default 'running'
                check (status in ('running','done','error','skipped')),
  data        jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists qa_steps_job_id_idx    on public.qa_steps(job_id);
create index if not exists qa_steps_step_idx_idx  on public.qa_steps(job_id, step_index);

alter table public.qa_steps enable row level security;

create policy "users see own qa steps"
  on public.qa_steps for select using (
    exists (select 1 from public.qa_jobs j where j.id = qa_steps.job_id and j.user_id = auth.uid())
  );

create policy "service role full access qa_steps"
  on public.qa_steps for all using (true) with check (true);


-- ── qa_reports ─────────────────────────────────────────────────────────────────
create table if not exists public.qa_reports (
  id                   uuid primary key default gen_random_uuid(),
  job_id               uuid not null references public.qa_jobs(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  execution_report_id  uuid references public.execution_reports(id) on delete set null,
  research_report_id   uuid references public.research_reports(id) on delete set null,
  -- Verdict
  verdict              text not null check (verdict in ('approve','improve','reject')),
  overall_score        int  not null default 0,
  -- Check results
  checks               jsonb not null default '{}'::jsonb,
  simulation           jsonb,
  corrections          jsonb not null default '[]'::jsonb,
  routing              jsonb not null default '{}'::jsonb,
  test_plan            jsonb,
  all_issues           jsonb not null default '[]'::jsonb,
  -- Meta
  ai_calls_made        int  not null default 0,
  generation_ms        int,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists qa_reports_user_id_idx    on public.qa_reports(user_id);
create index if not exists qa_reports_job_id_idx     on public.qa_reports(job_id);
create index if not exists qa_reports_verdict_idx    on public.qa_reports(verdict);
create index if not exists qa_reports_created_at_idx on public.qa_reports(created_at desc);

create trigger set_qa_reports_updated_at
  before update on public.qa_reports
  for each row execute function public.set_updated_at();

alter table public.qa_reports enable row level security;

create policy "users see own qa reports"
  on public.qa_reports for select using (auth.uid() = user_id);

create policy "service role full access qa_reports"
  on public.qa_reports for all using (true) with check (true);
