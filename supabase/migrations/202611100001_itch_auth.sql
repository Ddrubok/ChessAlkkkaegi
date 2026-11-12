-- Private OAuth hand-off. Only the service role can read or mutate these rows.
create table if not exists public.itch_oauth_pending (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  link_user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  callback_code text,
  callback_error text,
  claimed_at timestamptz,
  check (expires_at <= created_at + interval '5 minutes'),
  check (callback_code is null or length(callback_code) between 1 and 2048),
  check (callback_error is null or callback_error = 'access_denied'),
  check (callback_code is null or callback_error is null)
);
create index if not exists itch_oauth_pending_expiry on public.itch_oauth_pending(expires_at);
alter table public.itch_oauth_pending enable row level security;
revoke all on public.itch_oauth_pending from public, anon, authenticated;
grant all on public.itch_oauth_pending to service_role;

-- One row serializes admission across every Edge Function instance. The array
-- holds at most 60 accepted start times in the trailing 60 seconds.
create schema if not exists itch_auth_private;
revoke all on schema itch_auth_private from public, anon, authenticated;
create table if not exists itch_auth_private.start_budget (
  id boolean primary key default true check (id),
  admitted_at timestamptz[] not null default '{}'
);
insert into itch_auth_private.start_budget (id) values (true) on conflict (id) do nothing;
revoke all on itch_auth_private.start_budget from public, anon, authenticated;

-- Returns a stable result code; callers never write pending rows directly.
create or replace function public.itch_oauth_start(p_hash text, p_challenge text, p_link_user_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_times timestamptz[];
  v_now timestamptz;
  v_live integer;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$'
    or p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'invalid itch OAuth start' using errcode = '22023';
  end if;

  select admitted_at into v_times from itch_auth_private.start_budget where id = true for update;
  if not found then raise exception 'itch OAuth admission unavailable'; end if;
  v_now := clock_timestamp();
  if exists (select 1 from public.itch_oauth_pending where state_hash = p_hash and expires_at > v_now) then
    return 'duplicate';
  end if;

  -- The expiry index keeps each cleanup bounded, even after a long idle period.
  delete from public.itch_oauth_pending where state_hash in (
    select state_hash from public.itch_oauth_pending
     where expires_at <= v_now order by expires_at limit 32
  );
  -- An old state may be outside that batch; remove that one row before insert.
  delete from public.itch_oauth_pending where state_hash = p_hash and expires_at <= v_now;

  select coalesce(array_agg(t order by t), '{}'::timestamptz[]) into v_times
    from unnest(v_times) as t where t > v_now - interval '1 minute';
  if cardinality(v_times) >= 60 then return 'rate_limited'; end if;
  select count(*) into v_live from (
    select 1 from public.itch_oauth_pending where expires_at > v_now limit 200
  ) as live_rows;
  if v_live >= 200 then return 'rate_limited'; end if;

  insert into public.itch_oauth_pending (state_hash, code_challenge, link_user_id, created_at, expires_at)
    values (p_hash, p_challenge, p_link_user_id, v_now, v_now + interval '5 minutes');
  update itch_auth_private.start_budget set admitted_at = array_append(v_times, v_now) where id = true;
  return 'started';
end $$;
revoke all on function public.itch_oauth_start(text,text,uuid) from public, anon, authenticated;
grant execute on function public.itch_oauth_start(text,text,uuid) to service_role;

create table if not exists public.itch_identities (
  itch_user_id text primary key check (itch_user_id ~ '^[0-9]{1,32}$'),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.itch_identities enable row level security;
revoke all on public.itch_identities from public, anon, authenticated;
grant all on public.itch_identities to service_role;

-- Public schema is exposed by PostgREST, but EXECUTE is service-role only.
create or replace function public.itch_oauth_callback(p_hash text, p_code text, p_error text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.itch_oauth_pending
     set callback_code = p_code, callback_error = p_error
   where state_hash = p_hash and expires_at > now() and claimed_at is null
     and callback_code is null and callback_error is null
     and ((p_code is not null and p_error is null and length(p_code) between 1 and 2048)
       or (p_code is null and p_error = 'access_denied'));
  return found;
end $$;
-- Capture the code before clearing it; the claim removes it in one transaction.
create or replace function public.itch_oauth_claim(p_hash text, p_challenge text)
returns table(code text, error text, link_user_id uuid) language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select p.callback_code, p.callback_error, p.link_user_id into r
    from public.itch_oauth_pending p
   where p.state_hash = p_hash and p.code_challenge = p_challenge
     and p.expires_at > now() and p.claimed_at is null
     and (p.callback_code is not null or p.callback_error is not null)
   for update;
  if not found then return; end if;
  update public.itch_oauth_pending p set claimed_at = now(), callback_code = null
    where p.state_hash = p_hash;
  code := r.callback_code; error := r.callback_error; link_user_id := r.link_user_id;
  return next;
end $$;
create or replace function public.itch_oauth_cancel(p_hash text, p_challenge text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from public.itch_oauth_pending
   where state_hash = p_hash and code_challenge = p_challenge and claimed_at is null;
  return found;
end $$;
revoke all on function public.itch_oauth_callback(text,text,text) from public, anon, authenticated;
revoke all on function public.itch_oauth_claim(text,text) from public, anon, authenticated;
revoke all on function public.itch_oauth_cancel(text,text) from public, anon, authenticated;
grant execute on function public.itch_oauth_callback(text,text,text) to service_role;
grant execute on function public.itch_oauth_claim(text,text) to service_role;
grant execute on function public.itch_oauth_cancel(text,text) to service_role;
