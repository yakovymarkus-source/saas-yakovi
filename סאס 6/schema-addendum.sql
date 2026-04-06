-- ══════════════════════════════════════════════════════════════════════════════
-- schema-addendum.sql — Multi-tenant OAuth SaaS: Addendum migrations
--
-- Run ONCE in Supabase SQL Editor AFTER the base schema.sql.
-- Adds token-status columns, account-name cache, and two helper RPCs.
-- All changes are idempotent (IF NOT EXISTS / OR REPLACE).
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Richer integration metadata ────────────────────────────────────────────
alter table public.user_integrations
  add column if not exists account_name       text,
  add column if not exists token_expires_at   timestamptz,
  add column if not exists connection_status  text not null default 'active'
    check (connection_status in ('active', 'expired', 'error', 'revoked')),
  add column if not exists oauth_scopes       text[],
  add column if not exists last_sync_at       timestamptz,
  add column if not exists last_error         text;

-- Useful for cron jobs that look for expiring / errored tokens
create index if not exists idx_user_integrations_status_expires
  on public.user_integrations (connection_status, token_expires_at);

-- ── 2. RPC: mark integration as successfully synced ───────────────────────────
create or replace function public.mark_integration_synced(
  p_user_id    uuid,
  p_provider   text,
  p_expires_at timestamptz default null,
  p_account_name text default null
)
returns void
language plpgsql
security definer
as $$
begin
  update public.user_integrations
  set
    last_sync_at      = now(),
    token_expires_at  = coalesce(p_expires_at, token_expires_at),
    connection_status = 'active',
    last_error        = null,
    account_name      = coalesce(p_account_name, account_name),
    updated_at        = now()
  where user_id = p_user_id
    and provider  = p_provider;
end;
$$;

-- ── 3. RPC: mark integration as errored ───────────────────────────────────────
create or replace function public.mark_integration_error(
  p_user_id  uuid,
  p_provider text,
  p_error    text
)
returns void
language plpgsql
security definer
as $$
begin
  update public.user_integrations
  set
    connection_status = 'error',
    last_error        = p_error,
    updated_at        = now()
  where user_id = p_user_id
    and provider  = p_provider;
end;
$$;

-- ── 4. Add oauth_nonces table (if not already present from base schema) ────────
create table if not exists public.oauth_nonces (
  id         uuid primary key default gen_random_uuid(),
  nonce      text not null unique,
  user_id    uuid not null references auth.users(id) on delete cascade,
  provider   text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.oauth_nonces enable row level security;
drop policy if exists oauth_nonces_service_only on public.oauth_nonces;
create policy oauth_nonces_service_only on public.oauth_nonces for all using (false) with check (false);

create index if not exists idx_oauth_nonces_user_provider on public.oauth_nonces (user_id, provider);
create index if not exists idx_oauth_nonces_expires on public.oauth_nonces (expires_at);

-- ── 5. Trigger: auto-mark token as expired when token_expires_at is reached ───
--   (Runs on UPDATE; useful if you refresh token_expires_at from the function)
create or replace function public.sync_connection_status()
returns trigger
language plpgsql
as $$
begin
  if new.token_expires_at is not null
     and new.token_expires_at < now()
     and new.connection_status = 'active'
  then
    new.connection_status := 'expired';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_connection_status on public.user_integrations;
create trigger trg_sync_connection_status
  before insert or update on public.user_integrations
  for each row execute procedure public.sync_connection_status();

-- ── 6. Admin bootstrap: auto-assign admin role to owner email ─────────────────
-- Grant admin to the owner account (run once, idempotent)
update public.profiles
  set is_admin = true
  where email = 'yakovymarkus@gmail.com';

-- Trigger: any future signup with this email also gets admin immediately
create or replace function public.auto_assign_admin()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.email = 'yakovymarkus@gmail.com' then
    new.is_admin := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_assign_admin on public.profiles;
create trigger trg_auto_assign_admin
  before insert or update of email on public.profiles
  for each row execute procedure public.auto_assign_admin();

-- ── 7. Manual payment verification flow ──────────────────────────────────────
-- payment_status tracks manual GrowLink verification separate from Stripe status
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'none'
    CHECK (payment_status IN ('none','pending','verified'));

-- Function for payment-pending function to call (service role)
CREATE OR REPLACE FUNCTION public.set_payment_pending(
  p_user_id uuid,
  p_plan     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, status, payment_status)
  VALUES (p_user_id, p_plan, 'active', 'pending')
  ON CONFLICT (user_id)
  DO UPDATE SET
    plan           = p_plan,
    payment_status = 'pending',
    updated_at     = now();
END;
$$;

-- Function for admin activation
CREATE OR REPLACE FUNCTION public.activate_payment(
  p_user_id uuid,
  p_plan     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, status, payment_status)
  VALUES (p_user_id, p_plan, 'active', 'verified')
  ON CONFLICT (user_id)
  DO UPDATE SET
    plan           = p_plan,
    status         = 'active',
    payment_status = 'verified',
    updated_at     = now();
END;
$$;

-- Unique constraint on user_id (subscriptions should be 1-per-user)
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_user_id_unique;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);
