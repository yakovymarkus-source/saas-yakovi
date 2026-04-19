-- ============================================================
-- Research Agent Migration
-- Run in Supabase SQL Editor
-- ============================================================

-- ── data_source_providers ──────────────────────────────────
-- Admin-managed registry of data source providers
-- (Google Trends, Meta Ads Library, SerpAPI, Reddit, etc.)
create table if not exists public.data_source_providers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,           -- 'claude_researcher', 'serpapi', 'meta_ads_library', etc.
  label       text not null,                  -- Display name shown in admin UI
  category    text not null,                  -- 'search', 'social', 'ads', 'news', 'communities', 'user_data'
  is_active   boolean not null default true,
  is_builtin  boolean not null default false, -- Cannot be deleted if true
  config      jsonb not null default '{}',    -- Provider-specific config (endpoint, model, etc.)
  api_key_env text,                           -- Env var name that holds the API key (nullable)
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.data_source_providers enable row level security;
-- Only admins can manage providers (enforced at function level via requireAdmin)
drop policy if exists providers_admin_all on public.data_source_providers;
create policy providers_admin_all on public.data_source_providers
  using (true) with check (true); -- Function-level auth enforces admin check

-- Seed built-in providers
insert into public.data_source_providers (name, label, category, is_active, is_builtin, config, api_key_env, notes) values
  ('claude_researcher',  'Claude AI Researcher',       'ai',          true,  true,  '{"model":"claude-sonnet-4-6","max_tokens":4000}',  'ANTHROPIC_API_KEY',  'Uses Claude to simulate market research from training knowledge'),
  ('meta_ads_library',   'Meta Ads Library',           'ads',         false, false, '{"api_version":"v19.0"}',                          'META_APP_SECRET',    'Requires Meta App with Ads Library access'),
  ('google_trends',      'Google Trends',              'search',      false, false, '{}',                                               null,                 'Public endpoint, no key needed'),
  ('serpapi',            'SerpAPI (Google Search)',    'search',      false, false, '{"engine":"google"}',                              'SERPAPI_KEY',        'Paid API for Google search results'),
  ('reddit_api',         'Reddit API',                 'communities', false, false, '{"limit":100}',                                    'REDDIT_CLIENT_ID',   'Requires Reddit OAuth app'),
  ('tiktok_creative',    'TikTok Creative Center',     'ads',         false, false, '{}',                                               null,                 'Public endpoint for trending ads'),
  ('google_news_rss',    'Google News RSS',            'news',        false, false, '{}',                                               null,                 'Free RSS feed'),
  ('google_search_console','Google Search Console',   'user_data',   false, false, '{}',                                               null,                 'Requires user OAuth — personal data only')
on conflict (name) do nothing;

drop trigger if exists set_data_source_providers_updated_at on public.data_source_providers;
create trigger set_data_source_providers_updated_at
  before update on public.data_source_providers
  for each row execute procedure public.set_updated_at();

-- ── research_jobs ──────────────────────────────────────────
create table if not exists public.research_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'queued'
                    check (status in ('queued','running','completed','failed','cancelled')),
  depth_level     text not null default 'low'
                    check (depth_level in ('low','medium','high')),
  -- Input
  business_name   text,
  niche           text not null,
  target_audience text,
  main_offer      text,
  -- Budget tracking
  max_competitors int not null default 5,
  max_signals     int not null default 30,
  max_ai_calls    int not null default 8,
  ai_calls_used   int not null default 0,
  -- Timing
  estimated_minutes int,
  started_at      timestamptz,
  completed_at    timestamptz,
  -- Result reference
  report_id       uuid,
  error_message   text,
  -- Credits used
  credits_used    int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.research_jobs enable row level security;
drop policy if exists research_jobs_select_own  on public.research_jobs;
drop policy if exists research_jobs_insert_own  on public.research_jobs;
drop policy if exists research_jobs_update_own  on public.research_jobs;
create policy research_jobs_select_own on public.research_jobs for select using (auth.uid() = user_id);
create policy research_jobs_insert_own on public.research_jobs for insert with check (auth.uid() = user_id);
create policy research_jobs_update_own on public.research_jobs for update using (auth.uid() = user_id);

create index if not exists idx_research_jobs_user    on public.research_jobs (user_id, created_at desc);
create index if not exists idx_research_jobs_status  on public.research_jobs (status);

drop trigger if exists set_research_jobs_updated_at on public.research_jobs;
create trigger set_research_jobs_updated_at
  before update on public.research_jobs
  for each row execute procedure public.set_updated_at();

-- ── research_steps ─────────────────────────────────────────
-- Live progress log — each step the agent performs
create table if not exists public.research_steps (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.research_jobs(id) on delete cascade,
  step_index  int  not null,
  step_key    text not null,  -- 'discovery','dedup','expansion','avatar','analysis','patterns','gaps','scoring','report'
  message     text not null,  -- Human-readable Hebrew progress message
  detail      text,           -- Optional extra detail
  status      text not null default 'running' check (status in ('running','done','error','skipped')),
  data        jsonb,          -- Optional structured data from this step
  created_at  timestamptz not null default now()
);

alter table public.research_steps enable row level security;
drop policy if exists research_steps_select_own on public.research_steps;
create policy research_steps_select_own on public.research_steps
  for select using (
    exists (
      select 1 from public.research_jobs j
      where j.id = research_steps.job_id and j.user_id = auth.uid()
    )
  );
-- Insert allowed from service role only (server-side writes)
create policy research_steps_service_insert on public.research_steps
  for insert with check (true);

create index if not exists idx_research_steps_job on public.research_steps (job_id, step_index);

-- ── research_entities ──────────────────────────────────────
-- Discovered competitors / market entities
create table if not exists public.research_entities (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.research_jobs(id) on delete cascade,
  name             text not null,
  primary_domain   text,
  description      text,
  main_offering    text,
  key_message      text,
  platforms        text[],           -- ['website','facebook','instagram','tiktok','google']
  confidence_score int default 70,   -- 0-100
  priority         text default 'medium' check (priority in ('low','medium','high')),
  score            int default 50,   -- Decision layer score 0-100
  raw_data         jsonb default '{}',
  created_at       timestamptz not null default now()
);

alter table public.research_entities enable row level security;
drop policy if exists research_entities_select_own on public.research_entities;
create policy research_entities_select_own on public.research_entities
  for select using (
    exists (select 1 from public.research_jobs j where j.id = research_entities.job_id and j.user_id = auth.uid())
  );
create policy research_entities_service_insert on public.research_entities
  for insert with check (true);

create index if not exists idx_research_entities_job on public.research_entities (job_id);

-- ── research_signals ───────────────────────────────────────
-- Avatar signals — pains, fears, desires, frustrations, language patterns
create table if not exists public.research_signals (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.research_jobs(id) on delete cascade,
  type        text not null check (type in ('pain','fear','desire','frustration','language','trigger','belief')),
  text        text not null,
  context     text,
  source_type text default 'ai_research',  -- 'comment','review','community','ai_research'
  frequency   int  default 1,              -- How many times this pattern appeared
  confidence  int  default 70,
  segment     text,                        -- Which audience segment this belongs to
  created_at  timestamptz not null default now()
);

alter table public.research_signals enable row level security;
drop policy if exists research_signals_select_own on public.research_signals;
create policy research_signals_select_own on public.research_signals
  for select using (
    exists (select 1 from public.research_jobs j where j.id = research_signals.job_id and j.user_id = auth.uid())
  );
create policy research_signals_service_insert on public.research_signals
  for insert with check (true);

create index if not exists idx_research_signals_job  on public.research_signals (job_id);
create index if not exists idx_research_signals_type on public.research_signals (job_id, type);

-- ── research_insights ──────────────────────────────────────
-- Patterns, gaps, opportunities discovered
create table if not exists public.research_insights (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.research_jobs(id) on delete cascade,
  type            text not null check (type in ('pattern','gap','opportunity','threat','trend')),
  title           text not null,
  description     text not null,
  evidence        text[],         -- Evidence references / quotes
  impact_score    int default 50, -- 0-100
  confidence      int default 70, -- 0-100
  priority        text default 'medium' check (priority in ('low','medium','high')),
  related_entities uuid[],        -- Competitor IDs this relates to
  action_required boolean default false,
  created_at      timestamptz not null default now()
);

alter table public.research_insights enable row level security;
drop policy if exists research_insights_select_own on public.research_insights;
create policy research_insights_select_own on public.research_insights
  for select using (
    exists (select 1 from public.research_jobs j where j.id = research_insights.job_id and j.user_id = auth.uid())
  );
create policy research_insights_service_insert on public.research_insights
  for insert with check (true);

create index if not exists idx_research_insights_job on public.research_insights (job_id, priority);

-- ── research_reports ───────────────────────────────────────
-- Final structured output — persisted forever, never deleted
create table if not exists public.research_reports (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.research_jobs(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  niche           text not null,
  depth_level     text not null,
  -- Structured output (the full Output Contract JSON)
  market_map      jsonb not null default '{}',
  avatar          jsonb not null default '{}',
  insights        jsonb not null default '{}',
  recommendations jsonb not null default '[]',
  -- Quality metrics
  data_quality_score  int default 0,   -- 0-100
  confidence_score    int default 0,   -- 0-100
  entities_count      int default 0,
  signals_count       int default 0,
  -- Metadata
  sources_used    text[],
  ai_calls_made   int default 0,
  generation_ms   int,
  -- Cache control — report stays forever, just flagged as stale after 30d
  is_stale        boolean not null default false,
  stale_at        timestamptz,
  created_at      timestamptz not null default now()
);

alter table public.research_reports enable row level security;
drop policy if exists research_reports_select_own on public.research_reports;
create policy research_reports_select_own on public.research_reports
  for select using (auth.uid() = user_id);
create policy research_reports_service_insert on public.research_reports
  for insert with check (true);
create policy research_reports_service_update on public.research_reports
  for update using (true);

create index if not exists idx_research_reports_user  on public.research_reports (user_id, created_at desc);
create index if not exists idx_research_reports_niche on public.research_reports (niche, depth_level, is_stale);

-- ── research_cache ─────────────────────────────────────────
-- Shared market-level cache — niche data usable across users (anonymised)
-- Never deleted, marked stale after 30 days, refreshed with a peek check
create table if not exists public.research_cache (
  id            uuid primary key default gen_random_uuid(),
  cache_key     text not null unique,  -- hash of (niche + depth_level)
  niche         text not null,
  depth_level   text not null,
  -- Anonymised aggregate data (no user PII)
  entities_data  jsonb not null default '[]',
  signals_data   jsonb not null default '[]',
  insights_data  jsonb not null default '[]',
  -- Staleness
  is_stale       boolean not null default false,
  stale_after    timestamptz not null default (now() + interval '30 days'),
  refresh_count  int not null default 0,
  last_used_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.research_cache enable row level security;
-- Cache is shared — readable by all authenticated users, writable by service role
drop policy if exists research_cache_select_all on public.research_cache;
create policy research_cache_select_all on public.research_cache for select using (auth.role() = 'authenticated');
create policy research_cache_service_write on public.research_cache for all using (true) with check (true);

create index if not exists idx_research_cache_key   on public.research_cache (cache_key);
create index if not exists idx_research_cache_niche on public.research_cache (niche, depth_level, is_stale);

drop trigger if exists set_research_cache_updated_at on public.research_cache;
create trigger set_research_cache_updated_at
  before update on public.research_cache
  for each row execute procedure public.set_updated_at();

-- ── Stale cache auto-mark (runs daily via pg_cron if available) ──
-- If pg_cron not available, the function checks stale_after on read
-- update public.research_cache set is_stale = true
--   where stale_after < now() and is_stale = false;

-- ── Helper: mark research_jobs report_id on insert ─────────
create or replace function public.link_report_to_job()
returns trigger language plpgsql security definer as $$
begin
  update public.research_jobs set report_id = new.id where id = new.job_id;
  return new;
end;
$$;
drop trigger if exists link_report_to_job_trigger on public.research_reports;
create trigger link_report_to_job_trigger
  after insert on public.research_reports
  for each row execute procedure public.link_report_to_job();

-- ── entity_sources ─────────────────────────────────────────
-- Per-platform source data for each discovered competitor
create table if not exists public.entity_sources (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references public.research_entities(id) on delete cascade,
  job_id      uuid not null references public.research_jobs(id) on delete cascade,
  platform    text not null check (platform in ('website','google','meta','instagram','tiktok','linkedin','youtube','other')),
  url         text,
  raw_data    jsonb not null default '{}',
  scraped_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
alter table public.entity_sources enable row level security;
create policy entity_sources_select_own on public.entity_sources
  for select using (exists (select 1 from public.research_jobs j where j.id = entity_sources.job_id and j.user_id = auth.uid()));
create policy entity_sources_service_insert on public.entity_sources for insert with check (true);
create index if not exists idx_entity_sources_entity on public.entity_sources (entity_id);
create index if not exists idx_entity_sources_job    on public.entity_sources (job_id);

-- ── entity_assets ──────────────────────────────────────────
-- Content assets (ads, landing pages, posts) per competitor
create table if not exists public.entity_assets (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references public.research_entities(id) on delete cascade,
  job_id      uuid not null references public.research_jobs(id) on delete cascade,
  type        text not null check (type in ('website','ad','post','landing_page','video','other')),
  platform    text,
  content     text,
  headline    text,
  cta         text,
  message     text,
  source_url  text,
  created_at  timestamptz not null default now()
);
alter table public.entity_assets enable row level security;
create policy entity_assets_select_own on public.entity_assets
  for select using (exists (select 1 from public.research_jobs j where j.id = entity_assets.job_id and j.user_id = auth.uid()));
create policy entity_assets_service_insert on public.entity_assets for insert with check (true);
create index if not exists idx_entity_assets_entity on public.entity_assets (entity_id);
create index if not exists idx_entity_assets_job    on public.entity_assets (job_id);

-- ── research_usage_logs ────────────────────────────────────
-- Per-AI-call usage tracking for cost control and audit
create table if not exists public.research_usage_logs (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.research_jobs(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  action        text not null,   -- step name: 'discovery', 'avatar', 'patterns', etc.
  provider      text not null default 'claude_researcher',
  tokens_used   int  not null default 0,
  cost_estimate numeric(10,6) not null default 0,  -- USD estimate
  success       boolean not null default true,
  error_msg     text,
  created_at    timestamptz not null default now()
);
alter table public.research_usage_logs enable row level security;
create policy usage_logs_select_own on public.research_usage_logs
  for select using (auth.uid() = user_id);
create policy usage_logs_service_insert on public.research_usage_logs for insert with check (true);
create index if not exists idx_usage_logs_job  on public.research_usage_logs (job_id);
create index if not exists idx_usage_logs_user on public.research_usage_logs (user_id, created_at desc);
