-- Job Tracker: per-account applications in YOUR Supabase project.
-- Run this in the SQL editor (once, or again after pulling schema changes).
-- Then turn off "Confirm email" under Authentication → Providers → Email
-- if you want to sign in immediately on a personal app.
--
-- There is NO cap on how many listings an account keeps. Protection comes
-- from bounding how big one row can be and how fast rows can be created,
-- which is what actually protects the database. Limits below match
-- src/lib/applications.ts LIMITS. Re-running this file is idempotent.

create table if not exists public.applications (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  company text not null,
  title text not null,
  date_applied text not null,
  status text not null default 'applied',
  posting_url text not null default '',
  created_at timestamptz not null default now()
);

-- Pipeline stage. Upgrade path from the boolean received_offer column: add
-- status, carry TRUE over as 'offer', then drop the old column. Each step is
-- skipped when it has already run, so re-running this file is safe.
alter table public.applications
  add column if not exists status text not null default 'applied';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'applications'
      and column_name = 'received_offer'
  ) then
    update public.applications
      set status = 'offer'
      where received_offer and status = 'applied';
    alter table public.applications drop column received_offer;
  end if;
end $$;

-- Ordered index for the paged read the client uses. Without it, listing a
-- large account re-sorts the whole partition on every page. Its leading
-- column also serves plain user_id lookups, which makes the older
-- single-column index redundant: dropping it removes write cost from every
-- insert, which is what an account with many listings feels most.
create index if not exists applications_user_date_id_idx
  on public.applications (user_id, date_applied, id);

drop index if exists public.applications_user_id_idx;

-- Internal write log for per-account rate limits. No client policies.
create table if not exists public.application_write_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  rows int not null default 1,
  created_at timestamptz not null default now()
);

-- Upgrade path from the earlier statement-counting version of this table.
alter table public.application_write_log
  add column if not exists rows int not null default 1;

create index if not exists application_write_log_user_created_idx
  on public.application_write_log (user_id, created_at);

alter table public.applications enable row level security;
alter table public.application_write_log enable row level security;

revoke all on public.application_write_log from anon, authenticated, public;

-- Field CHECKs: oversized or garbage values are rejected even if the
-- browser validation is skipped. These bound the size of a single row,
-- which is what keeps "many rows" from meaning "unbounded bytes".
alter table public.applications drop constraint if exists applications_company_len;
alter table public.applications add constraint applications_company_len
  check (char_length(company) between 1 and 200);

alter table public.applications drop constraint if exists applications_title_len;
alter table public.applications add constraint applications_title_len
  check (char_length(title) between 1 and 200);

alter table public.applications drop constraint if exists applications_date_applied_fmt;
alter table public.applications add constraint applications_date_applied_fmt
  check (date_applied ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

alter table public.applications drop constraint if exists applications_status_valid;
alter table public.applications add constraint applications_status_valid
  check (status in ('applied', 'interviewing', 'offer', 'rejected'));

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

-- Listings are unlimited: the old 500-row ceiling and the delete-then-insert
-- import RPC are both removed. Import appends now, so nothing is deleted.
drop trigger if exists applications_quota on public.applications;
drop function if exists public.enforce_application_quota();
drop function if exists public.replace_own_applications(jsonb);

-- Rate limit on ROWS, not on total stored rows: at most 5,000 rows in one
-- statement and 20,000 rows per rolling hour per account. A real CSV import
-- lands in one statement. A script trying to manufacture millions of rows
-- is bounded no matter how long it runs, and the account still has no
-- lifetime ceiling.
create or replace function public.enforce_application_write_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n int;
  recent bigint;
begin
  if uid is null then
    return null;
  end if;

  select count(*) into n from inserted;

  if n > 5000 then
    raise exception 'Too many listings in one write (max 5000). Split the import into smaller files.';
  end if;

  delete from public.application_write_log
  where user_id = uid
    and created_at < now() - interval '1 day';

  insert into public.application_write_log (user_id, rows) values (uid, n);

  select coalesce(sum(rows), 0) into recent
  from public.application_write_log
  where user_id = uid
    and created_at > now() - interval '1 hour';

  if recent > 20000 then
    raise exception 'Too many listings added in the past hour. Try again later.';
  end if;

  return null;
end;
$$;

drop trigger if exists applications_write_rate on public.applications;
create trigger applications_write_rate
  after insert on public.applications
  referencing new table as inserted
  for each statement
  execute function public.enforce_application_write_rate();

revoke all on function public.enforce_application_write_rate() from public, anon, authenticated;
