create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  avatar_url text null,
  onboarding_completed boolean not null default false,
  total_campaigns integer not null default 0,
  total_analyses integer not null default 0,
  latest_campaign_id uuid null,
  latest_analysis_id uuid null,
  last_activity_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz null,
  check (char_length(full_name) <= 80),
  check (char_length(email) <= 120)
);

alter table public.profiles add column if not exists total_campaigns integer not null default 0;
alter table public.profiles add column if not exists total_analyses integer not null default 0;
alter table public.profiles add column if not exists latest_campaign_id uuid null;
alter table public.profiles add column if not exists latest_analysis_id uuid null;
alter table public.profiles add column if not exists last_activity_at timestamptz null;

create table if not exists public.user_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  action_type text null,
  entity_type text null,
  entity_id text null,
  status text not null default 'success',
  category text not null default 'general',
  metadata jsonb not null default '{}'::jsonb,
  campaign_id uuid null,
  analysis_id uuid null,
  created_at timestamptz not null default timezone('utc', now()),
  check (char_length(action) between 3 and 120),
  check (char_length(category) between 2 and 40)
);

alter table public.user_history add column if not exists action_type text null;
alter table public.user_history add column if not exists entity_type text null;
alter table public.user_history add column if not exists entity_id text null;
alter table public.user_history add column if not exists status text not null default 'success';
alter table public.user_history add column if not exists campaign_id uuid null;
alter table public.user_history add column if not exists analysis_id uuid null;

update public.user_history
set
  action_type = coalesce(action_type, action),
  entity_type = coalesce(entity_type, split_part(action, '.', 1), 'account'),
  status = coalesce(status, case
    when action like '%.failure' then 'failure'
    when action like '%.requested' then 'requested'
    when action like '%.completed' then 'completed'
    else 'success'
  end)
where action_type is null or entity_type is null or status is null;

create table if not exists public.request_rate_limits (
  actor_key text not null,
  endpoint text not null,
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (actor_key, endpoint, window_start)
);

create table if not exists public.request_rate_limit_state (
  actor_hash text not null,
  endpoint text not null,
  failure_count integer not null default 0 check (failure_count >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  blocked_until timestamptz null,
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (actor_hash, endpoint)
);

create table if not exists public.account_deletions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  original_email text not null,
  archived_email text not null,
  reason text not null default 'user_requested',
  deleted_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_profiles_deleted_at on public.profiles (deleted_at);
create index if not exists idx_profiles_last_activity_at on public.profiles (last_activity_at desc);
create index if not exists idx_user_history_user_created on public.user_history (user_id, created_at desc);
create index if not exists idx_user_history_action_type on public.user_history (user_id, action_type, created_at desc);
create index if not exists idx_user_history_campaign_id on public.user_history (campaign_id) where campaign_id is not null;
create index if not exists idx_user_history_analysis_id on public.user_history (analysis_id) where analysis_id is not null;
create index if not exists idx_request_rate_limits_actor_endpoint_window on public.request_rate_limits (actor_key, endpoint, window_start desc);
create index if not exists idx_request_rate_limit_state_blocked on public.request_rate_limit_state (endpoint, blocked_until);
create index if not exists idx_account_deletions_user_deleted_at on public.account_deletions (user_id, deleted_at desc);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_request_rate_limits_updated_at on public.request_rate_limits;
create trigger trg_request_rate_limits_updated_at
before update on public.request_rate_limits
for each row execute function public.set_updated_at();

drop trigger if exists trg_request_rate_limit_state_updated_at on public.request_rate_limit_state;
create trigger trg_request_rate_limit_state_updated_at
before update on public.request_rate_limit_state
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (user_id) do update
  set email = excluded.email,
      full_name = excluded.full_name;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.refresh_user_linkage_summary(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_campaigns integer := 0;
  v_total_analyses integer := 0;
  v_latest_campaign_id uuid := null;
  v_latest_analysis_id uuid := null;
  v_last_activity_at timestamptz := null;
begin
  if p_user_id is null then
    return;
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'campaigns'
  ) then
    execute 'select count(*)::int from public.campaigns where user_id = $1'
      into v_total_campaigns
      using p_user_id;

    execute '
      select id
      from public.campaigns
      where user_id = $1
      order by updated_at desc nulls last, created_at desc nulls last
      limit 1
    '
      into v_latest_campaign_id
      using p_user_id;
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'analyses'
  ) then
    execute 'select count(*)::int from public.analyses where user_id = $1'
      into v_total_analyses
      using p_user_id;

    execute '
      select id
      from public.analyses
      where user_id = $1
      order by updated_at desc nulls last, created_at desc nulls last
      limit 1
    '
      into v_latest_analysis_id
      using p_user_id;
  end if;

  select greatest(
    coalesce((select max(created_at) from public.user_history where user_id = p_user_id), to_timestamp(0)),
    coalesce((select max(coalesce(updated_at, created_at)) from public.campaigns where user_id = p_user_id), to_timestamp(0)),
    coalesce((select max(coalesce(updated_at, created_at)) from public.analyses where user_id = p_user_id), to_timestamp(0))
  )
  into v_last_activity_at;

  if v_last_activity_at = to_timestamp(0) then
    v_last_activity_at := null;
  end if;

  update public.profiles
  set total_campaigns = v_total_campaigns,
      total_analyses = v_total_analyses,
      latest_campaign_id = v_latest_campaign_id,
      latest_analysis_id = v_latest_analysis_id,
      last_activity_at = v_last_activity_at
  where user_id = p_user_id;
end;
$$;

create or replace function public.sync_user_linkage_from_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_user_linkage_summary(coalesce(new.user_id, old.user_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_user_history_refresh_linkage_insert on public.user_history;
create trigger trg_user_history_refresh_linkage_insert
after insert on public.user_history
for each row execute function public.sync_user_linkage_from_history();

drop trigger if exists trg_user_history_refresh_linkage_update on public.user_history;
create trigger trg_user_history_refresh_linkage_update
after update on public.user_history
for each row execute function public.sync_user_linkage_from_history();

drop trigger if exists trg_user_history_refresh_linkage_delete on public.user_history;
create trigger trg_user_history_refresh_linkage_delete
after delete on public.user_history
for each row execute function public.sync_user_linkage_from_history();

alter table public.profiles enable row level security;
alter table public.user_history enable row level security;
alter table public.request_rate_limits enable row level security;
alter table public.request_rate_limit_state enable row level security;
alter table public.account_deletions enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "user_history_select_own" on public.user_history;
create policy "user_history_select_own"
on public.user_history
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "user_history_insert_own" on public.user_history;
create policy "user_history_insert_own"
on public.user_history
for insert
to authenticated
with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "Avatar images are publicly readable" on storage.objects;
create policy "Avatar images are publicly readable"
on storage.objects
for select
to public
using (bucket_id = 'avatars');

drop policy if exists "Users can upload avatar in own folder" on storage.objects;
create policy "Users can upload avatar in own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update avatar in own folder" on storage.objects;
create policy "Users can update avatar in own folder"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete avatar in own folder" on storage.objects;
create policy "Users can delete avatar in own folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.log_linked_user_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  previous_payload jsonb;
  v_user_id uuid;
  v_entity_type text;
  v_entity_id text;
  v_status text;
  v_campaign_id uuid;
  v_analysis_id uuid;
  v_action_type text;
  v_trace_id text;
  v_request_id text;
  v_is_processed boolean := false;
  v_is_meaningful_update boolean := false;
  v_metadata jsonb;
  v_created_at timestamptz;
begin
  if TG_OP = 'DELETE' then
    payload := to_jsonb(old);
    previous_payload := to_jsonb(old);
  else
    payload := to_jsonb(new);
    previous_payload := to_jsonb(old);
  end if;

  v_user_id := nullif(payload->>'user_id', '')::uuid;

  if v_user_id is null then
    if TG_OP = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_entity_type := TG_ARGV[0];
  v_entity_id := coalesce(payload->>'id', null);
  v_trace_id := coalesce(payload->>'trace_id', previous_payload->>'trace_id', payload->>'request_id', previous_payload->>'request_id', null);
  v_request_id := coalesce(payload->>'request_id', previous_payload->>'request_id', v_trace_id, null);
  v_created_at := coalesce(
    nullif(payload->>'updated_at', '')::timestamptz,
    nullif(payload->>'created_at', '')::timestamptz,
    timezone('utc', now())
  );

  v_campaign_id := case
    when v_entity_type = 'campaign' then nullif(payload->>'id', '')::uuid
    else coalesce(nullif(payload->>'campaign_id', '')::uuid, nullif(previous_payload->>'campaign_id', '')::uuid)
  end;
  v_analysis_id := case
    when v_entity_type = 'analysis' then nullif(payload->>'id', '')::uuid
    else coalesce(nullif(payload->>'analysis_id', '')::uuid, nullif(previous_payload->>'analysis_id', '')::uuid)
  end;

  v_is_processed := v_entity_type = 'analysis' and (
    lower(coalesce(payload->>'status', '')) in ('processed', 'complete', 'completed', 'success', 'ready')
    or lower(coalesce(payload->>'processing_status', '')) in ('processed', 'complete', 'completed', 'success', 'ready')
  ) and (
    TG_OP = 'INSERT'
    or coalesce(lower(previous_payload->>'status'), '') not in ('processed', 'complete', 'completed', 'success', 'ready')
    or coalesce(lower(previous_payload->>'processing_status'), '') not in ('processed', 'complete', 'completed', 'success', 'ready')
  );

  v_is_meaningful_update := TG_OP = 'UPDATE' and (
    payload->>'name' is distinct from previous_payload->>'name'
    or payload->>'title' is distinct from previous_payload->>'title'
    or payload->>'status' is distinct from previous_payload->>'status'
    or payload->>'processing_status' is distinct from previous_payload->>'processing_status'
    or payload->>'campaign_id' is distinct from previous_payload->>'campaign_id'
    or payload->>'analysis_id' is distinct from previous_payload->>'analysis_id'
    or payload->>'updated_at' is distinct from previous_payload->>'updated_at'
  );

  v_action_type := case
    when v_entity_type = 'campaign' and TG_OP = 'INSERT' then 'campaign.created'
    when v_entity_type = 'campaign' and TG_OP = 'UPDATE' then 'campaign.updated'
    when v_entity_type = 'campaign' and TG_OP = 'DELETE' then 'campaign.deleted'
    when v_entity_type = 'analysis' and TG_OP = 'INSERT' and v_is_processed then 'analysis.processed'
    when v_entity_type = 'analysis' and TG_OP = 'INSERT' then 'analysis.created'
    when v_entity_type = 'analysis' and TG_OP = 'UPDATE' and v_is_processed then 'analysis.processed'
    when v_entity_type = 'analysis' and TG_OP = 'UPDATE' then 'analysis.updated'
    when v_entity_type = 'analysis' and TG_OP = 'DELETE' then 'analysis.deleted'
    else format('%s.%s', v_entity_type, lower(TG_OP))
  end;

  if TG_OP = 'DELETE' then
    v_status := 'deleted';
  elsif v_action_type = 'analysis.processed' then
    v_status := 'processed';
  elsif lower(coalesce(payload->>'status', '')) in ('draft', 'queued', 'running', 'processing', 'failed', 'error', 'ready', 'success', 'complete', 'completed', 'processed') then
    v_status := lower(payload->>'status');
  elsif lower(coalesce(payload->>'processing_status', '')) in ('draft', 'queued', 'running', 'processing', 'failed', 'error', 'ready', 'success', 'complete', 'completed', 'processed') then
    v_status := lower(payload->>'processing_status');
  elsif TG_OP = 'INSERT' then
    v_status := 'created';
  else
    v_status := 'success';
  end if;

  if TG_OP = 'UPDATE' and not v_is_meaningful_update and v_action_type <> 'analysis.processed' then
    return new;
  end if;

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'name', payload->>'name',
    'title', payload->>'title',
    'status', payload->>'status',
    'processing_status', payload->>'processing_status',
    'trace_id', v_trace_id,
    'request_id', v_request_id,
    'source', 'database_trigger',
    'operation', lower(TG_OP),
    'before', case when TG_OP in ('UPDATE', 'DELETE') then previous_payload else null end,
    'after', case when TG_OP in ('INSERT', 'UPDATE') then payload else null end
  ));

  insert into public.user_history (
    user_id,
    action,
    action_type,
    entity_type,
    entity_id,
    status,
    category,
    metadata,
    campaign_id,
    analysis_id,
    created_at
  ) values (
    v_user_id,
    format('%s.%s.%s', v_action_type, v_status, coalesce(v_entity_id, 'unknown')),
    v_action_type,
    v_entity_type,
    v_entity_id,
    v_status,
    v_entity_type,
    v_metadata,
    v_campaign_id,
    v_analysis_id,
    v_created_at
  );

  perform public.refresh_user_linkage_summary(v_user_id);

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'campaigns'
      and column_name = 'user_id'
  ) then
    execute 'drop trigger if exists trg_campaigns_user_history_insert on public.campaigns';
    execute 'create trigger trg_campaigns_user_history_insert after insert on public.campaigns for each row execute function public.log_linked_user_activity(''campaign'')';
    execute 'drop trigger if exists trg_campaigns_user_history_update on public.campaigns';
    execute 'create trigger trg_campaigns_user_history_update after update on public.campaigns for each row when (old.* is distinct from new.*) execute function public.log_linked_user_activity(''campaign'')';
    execute 'drop trigger if exists trg_campaigns_user_history_delete on public.campaigns';
    execute 'create trigger trg_campaigns_user_history_delete after delete on public.campaigns for each row execute function public.log_linked_user_activity(''campaign'')';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'analyses'
      and column_name = 'user_id'
  ) then
    execute 'drop trigger if exists trg_analyses_user_history_insert on public.analyses';
    execute 'create trigger trg_analyses_user_history_insert after insert on public.analyses for each row execute function public.log_linked_user_activity(''analysis'')';
    execute 'drop trigger if exists trg_analyses_user_history_update on public.analyses';
    execute 'create trigger trg_analyses_user_history_update after update on public.analyses for each row when (old.* is distinct from new.*) execute function public.log_linked_user_activity(''analysis'')';
    execute 'drop trigger if exists trg_analyses_user_history_delete on public.analyses';
    execute 'create trigger trg_analyses_user_history_delete after delete on public.analyses for each row execute function public.log_linked_user_activity(''analysis'')';
  end if;
end $$;

update public.profiles p
set total_campaigns = coalesce(src.total_campaigns, 0),
    total_analyses = coalesce(src.total_analyses, 0),
    latest_campaign_id = src.latest_campaign_id,
    latest_analysis_id = src.latest_analysis_id,
    last_activity_at = src.last_activity_at
from (
  select
    prof.user_id,
    coalesce(c.total_campaigns, 0) as total_campaigns,
    coalesce(a.total_analyses, 0) as total_analyses,
    c.latest_campaign_id,
    a.latest_analysis_id,
    greatest(
      coalesce(h.last_activity_at, to_timestamp(0)),
      coalesce(c.last_campaign_activity_at, to_timestamp(0)),
      coalesce(a.last_analysis_activity_at, to_timestamp(0))
    ) as last_activity_at
  from public.profiles prof
  left join (
    select user_id,
           count(*)::int as total_campaigns,
           (array_agg(id order by coalesce(updated_at, created_at) desc))[1] as latest_campaign_id,
           max(coalesce(updated_at, created_at)) as last_campaign_activity_at
    from public.campaigns
    group by user_id
  ) c on c.user_id = prof.user_id
  left join (
    select user_id,
           count(*)::int as total_analyses,
           (array_agg(id order by coalesce(updated_at, created_at) desc))[1] as latest_analysis_id,
           max(coalesce(updated_at, created_at)) as last_analysis_activity_at
    from public.analyses
    group by user_id
  ) a on a.user_id = prof.user_id
  left join (
    select user_id, max(created_at) as last_activity_at
    from public.user_history
    group by user_id
  ) h on h.user_id = prof.user_id
) src
where p.user_id = src.user_id;
