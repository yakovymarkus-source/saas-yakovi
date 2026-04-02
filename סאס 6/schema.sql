create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (auth.uid() = id);
create policy profiles_update_own on public.profiles for update using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();

create table if not exists public.user_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('ga4','meta','google_ads')),
  account_id text,
  property_id text,
  metadata jsonb not null default '{}'::jsonb,
  secret_ciphertext text not null,
  secret_iv text not null,
  secret_tag text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table public.user_integrations enable row level security;
drop policy if exists integrations_select_own on public.user_integrations;
drop policy if exists integrations_insert_own on public.user_integrations;
drop policy if exists integrations_update_own on public.user_integrations;
drop policy if exists integrations_delete_own on public.user_integrations;
create policy integrations_select_own on public.user_integrations for select using (auth.uid() = user_id);
create policy integrations_insert_own on public.user_integrations for insert with check (auth.uid() = user_id);
create policy integrations_update_own on public.user_integrations for update using (auth.uid() = user_id);
create policy integrations_delete_own on public.user_integrations for delete using (auth.uid() = user_id);
create index if not exists idx_user_integrations_user_provider on public.user_integrations (user_id, provider);

drop trigger if exists set_user_integrations_updated_at on public.user_integrations;
create trigger set_user_integrations_updated_at before update on public.user_integrations for each row execute procedure public.set_updated_at();

create table if not exists public.api_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  range_preset text not null,
  metric text not null,
  payload jsonb not null,
  fresh_until timestamptz not null,
  stale_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.api_cache enable row level security;
drop policy if exists cache_select_own on public.api_cache;
drop policy if exists cache_modify_own on public.api_cache;
create policy cache_select_own on public.api_cache for select using (auth.uid() = user_id);
create policy cache_modify_own on public.api_cache for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists idx_api_cache_user_source on public.api_cache (user_id, source, range_preset, metric);
create index if not exists idx_api_cache_fresh_until on public.api_cache (fresh_until);

create table if not exists public.rate_limit_windows (
  scope_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (scope_key, window_started_at)
);

alter table public.rate_limit_windows enable row level security;
drop policy if exists rate_limit_service_only on public.rate_limit_windows;
create policy rate_limit_service_only on public.rate_limit_windows for all using (false) with check (false);

create or replace function public.consume_rate_limit(
  p_scope_key text,
  p_max_requests integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
as $$
declare
  v_window_started_at timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
  v_retry integer := p_window_seconds - mod(extract(epoch from now())::integer, p_window_seconds);
begin
  insert into public.rate_limit_windows(scope_key, window_started_at, request_count, updated_at)
  values (p_scope_key, v_window_started_at, 1, now())
  on conflict (scope_key, window_started_at)
  do update set request_count = public.rate_limit_windows.request_count + 1, updated_at = now()
  returning request_count into v_count;

  allowed := v_count <= p_max_requests;
  retry_after_seconds := case when allowed then 0 else v_retry end;
  return next;
end;
$$;

create table if not exists public.request_logs (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  correlation_id text,
  function_name text not null,
  level text not null,
  message text not null,
  ip text,
  user_agent text,
  duration_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.request_logs enable row level security;
drop policy if exists request_logs_service_only on public.request_logs;
create policy request_logs_service_only on public.request_logs for all using (false) with check (false);
create index if not exists idx_request_logs_created_at on public.request_logs (created_at desc);

create table if not exists public.request_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_name text not null,
  metric_value numeric not null,
  dimensions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.request_metrics enable row level security;
drop policy if exists request_metrics_service_only on public.request_metrics;
create policy request_metrics_service_only on public.request_metrics for all using (false) with check (false);
create index if not exists idx_request_metrics_name_created on public.request_metrics (metric_name, created_at desc);

create table if not exists public.provider_health (
  provider text primary key,
  consecutive_failures integer not null default 0,
  last_status text,
  last_error text,
  last_checked_at timestamptz,
  circuit_open_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.provider_health enable row level security;
drop policy if exists provider_health_service_only on public.provider_health;
create policy provider_health_service_only on public.provider_health for all using (false) with check (false);

drop trigger if exists set_provider_health_updated_at on public.provider_health;
create trigger set_provider_health_updated_at before update on public.provider_health for each row execute procedure public.set_updated_at();

create table if not exists public.campaigns (
  id text primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.campaigns enable row level security;
drop policy if exists campaigns_owner_access on public.campaigns;
create policy campaigns_owner_access on public.campaigns for all using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

drop trigger if exists set_campaigns_updated_at on public.campaigns;
create trigger set_campaigns_updated_at before update on public.campaigns for each row execute procedure public.set_updated_at();

create table if not exists public.campaign_memberships (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  unique (campaign_id, user_id)
);

alter table public.campaign_memberships enable row level security;
drop policy if exists campaign_memberships_select_member on public.campaign_memberships;
drop policy if exists campaign_memberships_write_owner on public.campaign_memberships;
create policy campaign_memberships_select_member on public.campaign_memberships for select using (auth.uid() = user_id);
create policy campaign_memberships_write_owner on public.campaign_memberships for all using (false) with check (false);

create table if not exists public.analysis_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id text not null,
  request_id text,
  timestamp timestamptz not null default now(),
  version text not null,
  raw_snapshot jsonb not null,
  metrics jsonb not null,
  scores jsonb not null,
  bottlenecks jsonb not null,
  confidence numeric not null,
  created_at timestamptz not null default now()
);

alter table public.analysis_results enable row level security;
drop policy if exists analysis_results_select_own on public.analysis_results;
create policy analysis_results_select_own on public.analysis_results for select using (auth.uid() = user_id);
create index if not exists idx_analysis_results_user_campaign_ts on public.analysis_results (user_id, campaign_id, timestamp desc);

create table if not exists public.decision_history (
  id uuid primary key default gen_random_uuid(),
  analysis_result_id uuid not null references public.analysis_results(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id text not null,
  timestamp timestamptz not null default now(),
  version text not null,
  verdict text not null,
  reason text not null,
  confidence numeric not null,
  created_at timestamptz not null default now()
);

alter table public.decision_history enable row level security;
drop policy if exists decision_history_select_own on public.decision_history;
create policy decision_history_select_own on public.decision_history for select using (auth.uid() = user_id);
create index if not exists idx_decision_history_user_campaign_ts on public.decision_history (user_id, campaign_id, timestamp desc);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  analysis_result_id uuid not null references public.analysis_results(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id text not null,
  timestamp timestamptz not null default now(),
  version text not null,
  issue text not null,
  root_cause text not null,
  action text not null,
  expected_impact text not null,
  urgency numeric not null,
  effort numeric not null,
  confidence numeric not null,
  priority_score numeric not null,
  created_at timestamptz not null default now()
);

alter table public.recommendations enable row level security;
drop policy if exists recommendations_select_own on public.recommendations;
create policy recommendations_select_own on public.recommendations for select using (auth.uid() = user_id);
create index if not exists idx_recommendations_user_campaign_ts on public.recommendations (user_id, campaign_id, timestamp desc);

create table if not exists public.campaign_snapshots (
  id uuid primary key default gen_random_uuid(),
  analysis_result_id uuid not null references public.analysis_results(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id text not null,
  timestamp timestamptz not null default now(),
  version text not null,
  raw_metrics_snapshot jsonb not null,
  computed_scores jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.campaign_snapshots enable row level security;
drop policy if exists campaign_snapshots_select_own on public.campaign_snapshots;
create policy campaign_snapshots_select_own on public.campaign_snapshots for select using (auth.uid() = user_id);
create index if not exists idx_campaign_snapshots_user_campaign_ts on public.campaign_snapshots (user_id, campaign_id, timestamp desc);

create table if not exists public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id text not null,
  status text not null check (status in ('queued','running','done','failed')),
  payload jsonb not null default '{}'::jsonb,
  result_payload jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sync_jobs enable row level security;
drop policy if exists sync_jobs_select_own on public.sync_jobs;
drop policy if exists sync_jobs_insert_own on public.sync_jobs;
create policy sync_jobs_select_own on public.sync_jobs for select using (auth.uid() = user_id);
create policy sync_jobs_insert_own on public.sync_jobs for insert with check (auth.uid() = user_id);

drop trigger if exists set_sync_jobs_updated_at on public.sync_jobs;
create trigger set_sync_jobs_updated_at before update on public.sync_jobs for each row execute procedure public.set_updated_at();


alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists preferences jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists onboarding_completed boolean not null default false;
alter table public.profiles add column if not exists deleted_at timestamptz;

create index if not exists idx_profiles_deleted_at on public.profiles (deleted_at);


create or replace function public.persist_analysis_atomic(p_payload jsonb)
returns uuid
language plpgsql
security definer
as $$
declare
  v_analysis_id uuid;
  v_analysis jsonb := coalesce(p_payload->'analysis_result', '{}'::jsonb);
  v_snapshot jsonb := coalesce(p_payload->'campaign_snapshot', '{}'::jsonb);
  v_decision jsonb;
  v_recommendation jsonb;
begin
  insert into public.analysis_results (
    user_id,
    campaign_id,
    request_id,
    timestamp,
    version,
    raw_snapshot,
    metrics,
    scores,
    bottlenecks,
    confidence
  )
  values (
    (v_analysis->>'user_id')::uuid,
    v_analysis->>'campaign_id',
    v_analysis->>'request_id',
    coalesce((v_analysis->>'timestamp')::timestamptz, now()),
    v_analysis->>'version',
    coalesce(v_analysis->'raw_snapshot', '{}'::jsonb),
    coalesce(v_analysis->'metrics', '{}'::jsonb),
    coalesce(v_analysis->'scores', '{}'::jsonb),
    coalesce(v_analysis->'bottlenecks', '[]'::jsonb),
    coalesce((v_analysis->>'confidence')::numeric, 0)
  )
  returning id into v_analysis_id;

  insert into public.campaign_snapshots (
    analysis_result_id,
    user_id,
    campaign_id,
    timestamp,
    version,
    raw_metrics_snapshot,
    computed_scores
  )
  values (
    v_analysis_id,
    (v_snapshot->>'user_id')::uuid,
    v_snapshot->>'campaign_id',
    coalesce((v_snapshot->>'timestamp')::timestamptz, now()),
    v_snapshot->>'version',
    coalesce(v_snapshot->'raw_metrics_snapshot', '{}'::jsonb),
    coalesce(v_snapshot->'computed_scores', '{}'::jsonb)
  );

  for v_decision in select value from jsonb_array_elements(coalesce(p_payload->'decisions', '[]'::jsonb)) loop
    insert into public.decision_history (
      analysis_result_id,
      user_id,
      campaign_id,
      timestamp,
      version,
      verdict,
      reason,
      confidence
    )
    values (
      v_analysis_id,
      (v_decision->>'user_id')::uuid,
      v_decision->>'campaign_id',
      coalesce((v_decision->>'timestamp')::timestamptz, now()),
      v_decision->>'version',
      v_decision->>'verdict',
      v_decision->>'reason',
      coalesce((v_decision->>'confidence')::numeric, 0)
    );
  end loop;

  for v_recommendation in select value from jsonb_array_elements(coalesce(p_payload->'recommendations', '[]'::jsonb)) loop
    insert into public.recommendations (
      analysis_result_id,
      user_id,
      campaign_id,
      timestamp,
      version,
      issue,
      root_cause,
      action,
      expected_impact,
      urgency,
      effort,
      confidence,
      priority_score
    )
    values (
      v_analysis_id,
      (v_recommendation->>'user_id')::uuid,
      v_recommendation->>'campaign_id',
      coalesce((v_recommendation->>'timestamp')::timestamptz, now()),
      v_recommendation->>'version',
      v_recommendation->>'issue',
      v_recommendation->>'root_cause',
      v_recommendation->>'action',
      v_recommendation->>'expected_impact',
      coalesce((v_recommendation->>'urgency')::numeric, 0),
      coalesce((v_recommendation->>'effort')::numeric, 0),
      coalesce((v_recommendation->>'confidence')::numeric, 0),
      coalesce((v_recommendation->>'priority_score')::numeric, 0)
    );
  end loop;

  return v_analysis_id;
end;
$$;
