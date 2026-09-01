-- Job Tracker: per-account applications in YOUR Supabase project.
-- Run this in the SQL editor (once, or again after pulling schema changes).
-- Then turn off "Confirm email" under Authentication → Providers → Email
-- if you want to sign in immediately on a personal app.
--
-- Limits below match src/lib/applications.ts LIMITS. Re-run this file after
-- upgrading; it is idempotent. They exist in Postgres so a script that skips
-- the UI still cannot flood or corrupt the table.

create table if not exists public.applications (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  company text not null,
  title text not null,
  date_applied text not null,
  received_offer boolean not null default false,
  posting_url text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists applications_user_id_idx
  on public.applications (user_id);

-- Internal write log for per-account rate limits. No client policies.
create table if not exists public.application_write_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists application_write_log_user_created_idx
  on public.application_write_log (user_id, created_at);

alter table public.applications enable row level security;
alter table public.application_write_log enable row level security;

revoke all on public.application_write_log from anon, authenticated, public;

-- Field CHECKs: oversized or garbage values are rejected even if the
-- browser validation is skipped.
alter table public.applications drop constraint if exists applications_company_len;
alter table public.applications add constraint applications_company_len
  check (char_length(company) between 1 and 200);

alter table public.applications drop constraint if exists applications_title_len;
alter table public.applications add constraint applications_title_len
  check (char_length(title) between 1 and 200);

alter table public.applications drop constraint if exists applications_date_applied_fmt;
alter table public.applications add constraint applications_date_applied_fmt
  check (date_applied ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

alter table public.applications drop constraint if exists applications_posting_url_len;
alter table public.applications add constraint applications_posting_url_len
  check (char_length(posting_url) <= 2048);

alter table public.applications drop constraint if exists applications_posting_url_http;
alter table public.applications add constraint applications_posting_url_http
  check (posting_url = '' or posting_url ~* '^https?://');

drop policy if exists "applications_select_own" on public.applications;
create policy "applications_select_own"
  on public.applications
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "applications_insert_own" on public.applications;
create policy "applications_insert_own"
  on public.applications
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "applications_update_own" on public.applications;
create policy "applications_update_own"
  on public.applications
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "applications_delete_own" on public.applications;
create policy "applications_delete_own"
  on public.applications
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- 500 listings per account. AFTER STATEMENT so a bulk INSERT of 501 rows
-- rolls back as a whole. Advisory lock serializes concurrent writers.
create or replace function public.enforce_application_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  uid uuid := auth.uid();
begin
  if uid is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select count(*) into n
  from public.applications
  where user_id = uid;
  if n > 500 then
    raise exception 'Too many listings (max 500 per account). Delete some before adding more.';
  end if;
  return null;
end;
$$;

drop trigger if exists applications_quota on public.applications;
create trigger applications_quota
  after insert on public.applications
  for each statement
  execute function public.enforce_application_quota();

-- 30 INSERT statements per 10 minutes per account. A CSV import is one
-- statement (many rows) and still counts as one write. A tight add-loop
-- is 30+ statements and is blocked.
create or replace function public.enforce_application_write_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
  uid uuid := auth.uid();
begin
  if uid is null then
    return null;
  end if;

  delete from public.application_write_log
  where user_id = uid
    and created_at < now() - interval '1 hour';

  insert into public.application_write_log (user_id) values (uid);

  select count(*) into recent
  from public.application_write_log
  where user_id = uid
    and created_at > now() - interval '10 minutes';

  if recent > 30 then
    raise exception 'Too many listing writes in a short time. Try again in a few minutes.';
  end if;
  return null;
end;
$$;

drop trigger if exists applications_write_rate on public.applications;
create trigger applications_write_rate
  after insert on public.applications
  for each statement
  execute function public.enforce_application_write_rate();

revoke all on function public.enforce_application_quota() from public, anon, authenticated;
revoke all on function public.enforce_application_write_rate() from public, anon, authenticated;

-- CSV import used to DELETE then INSERT as two HTTP calls. If the insert was
-- rejected (quota / rate / CHECK), the delete had already committed. One
-- RPC keeps both in a single transaction so a rejected import cannot wipe
-- the account.
create or replace function public.replace_own_applications(p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to continue.';
  end if;

  n := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
  if n > 500 then
    raise exception 'Too many listings (max 500 per account). Delete some before adding more.';
  end if;

  delete from public.applications
  where user_id = auth.uid();

  if n = 0 then
    return;
  end if;

  insert into public.applications (
    id, user_id, company, title, date_applied, received_offer, posting_url
  )
  select
    (item->>'id')::uuid,
    auth.uid(),
    item->>'company',
    item->>'title',
    item->>'date_applied',
    coalesce((item->>'received_offer')::boolean, false),
    coalesce(item->>'posting_url', '')
  from jsonb_array_elements(p_rows) as item;
end;
$$;

revoke all on function public.replace_own_applications(jsonb) from public, anon;
grant execute on function public.replace_own_applications(jsonb) to authenticated;
