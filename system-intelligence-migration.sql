-- system_intelligence_logs — QA Observability table
-- Run this in Supabase SQL Editor

create table if not exists public.system_intelligence_logs (
  id              uuid        primary key default gen_random_uuid(),
  trace_id        uuid        not null default gen_random_uuid(),
  parent_trace_id uuid,
  user_id         uuid        references auth.users(id) on delete set null,
  agent_name      text        not null,
  interaction_type text       not null check (interaction_type in ('ui_click','api_call','agent_logic','llm_call','webhook','scheduled')),
  user_input      text,
  agent_reasoning jsonb       default '{}',
  final_output    text,
  latency_ms      integer,
  status          text        not null check (status in ('SUCCESS','LOGIC_FAIL','TECH_ERROR','TIMEOUT','PARTIAL')),
  error_details   text,
  environment     text        not null default 'production',
  created_at      timestamptz not null default now()
);

create index if not exists idx_sil_trace    on public.system_intelligence_logs(trace_id);
create index if not exists idx_sil_parent   on public.system_intelligence_logs(parent_trace_id);
create index if not exists idx_sil_user     on public.system_intelligence_logs(user_id);
create index if not exists idx_sil_agent    on public.system_intelligence_logs(agent_name);
create index if not exists idx_sil_created  on public.system_intelligence_logs(created_at desc);
create index if not exists idx_sil_status   on public.system_intelligence_logs(status);

alter table public.system_intelligence_logs enable row level security;

create policy "admin_read_intelligence_logs" on public.system_intelligence_logs
  for select using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

-- Auto-cleanup: delete logs older than 30 days (called by uptime cron)
create or replace function public.cleanup_intelligence_logs()
returns void language sql as $$
  delete from public.system_intelligence_logs
  where created_at < now() - interval '30 days';
$$;
