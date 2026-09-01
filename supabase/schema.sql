-- Job Tracker: per-account applications in YOUR Supabase project.
-- Run this in the SQL editor (once). Then turn off "Confirm email"
-- under Authentication → Providers → Email if you want to sign in
-- immediately on a personal app.

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

alter table public.applications enable row level security;

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
