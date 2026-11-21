-- =====================================================================
-- LifeOS Study Edition — Supabase schema
-- One table per Google-Sheet tab the app used (state.cache keys).
-- Every row belongs to the logged-in user (auth.users) and is protected
-- by Row Level Security: a user can only see / change their own rows.
--
-- Run the whole file once in: Supabase Dashboard → SQL Editor → New query.
-- Safe to re-run (IF NOT EXISTS / DROP ... IF EXISTS everywhere).
-- =====================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Shared trigger: keep updated_at current on every UPDATE
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =====================================================================
-- TABLES
-- Columns are snake_case versions of the app's camelCase fields
-- (inTime → in_time, groupName → group_name, ...).
-- =====================================================================

-- Tasks  (app: Tasks)
create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title         text not null check (length(trim(title)) > 0),
  due           date,
  priority      text not null default 'normal' check (priority in ('high','normal','low')),
  notes         text not null default '',
  status        text not null default 'open'   check (status in ('open','done')),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint tasks_completed_chk check (status = 'done' or completed_at is null)
);

-- Projects  (app: Projects) — remarks is the JSON list of dated remarks
create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  status       text not null default 'Pending' check (status in ('Pending','In-Progress','Completed')),
  description  text not null default '',
  remarks      jsonb not null default '[]'::jsonb check (jsonb_typeof(remarks) = 'array'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Notes  (app: Notes)
create table if not exists public.notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null default '',
  body         text not null default '',
  tags         text not null default '',
  attachments  jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Gallery images  (app: Images) — file_path = path inside the 'lifeos' storage bucket
create table if not exists public.images (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  group_name  text not null default 'Default',
  url         text not null,
  file_path   text,
  remarks     text not null default '',
  tags        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Accounts  (app: Accounts) — opening balance per account
create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  balance     numeric(14,2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint accounts_user_name_uk unique (user_id, name)
);

-- Finance transactions  (app: Finance)
-- account is kept as text (like the app) so the built-in accounts
-- 'Cash', 'UPI', 'Bank A/c 1'... work without an accounts row.
create table if not exists public.finance (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type        text not null check (type in ('income','expense','savings-in','savings-out','transfer-in','transfer-out','future')),
  category    text not null default '',
  amount      numeric(14,2) not null check (amount >= 0),
  account     text not null default 'Cash',
  note        text not null default '',
  date        date not null default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Spaced-repetition topics  (app: Learning)
create table if not exists public.learning (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  topic         text not null check (length(trim(topic)) > 0),
  subject       text not null default '',
  notes         text not null default '',
  start_date    date not null default current_date,
  review_dates  date[] not null default '{}',
  done_dates    date[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Syllabus chapters  (app: Syllabus)
create table if not exists public.syllabus (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject     text not null check (length(trim(subject)) > 0),
  chapter     text not null check (length(trim(chapter)) > 0),
  sub         text not null default '',
  notes       text not null default '',
  status      text not null default 'pending' check (status in ('pending','done')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Health log  (app: Health) — value is text because wakeup/sleep store times
create table if not exists public.health (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type        text not null check (type in ('water','meal','exercise','sleep','wakeup','travel')),
  value       text not null default '',
  unit        text not null default '',
  meal        text check (meal is null or meal in ('Breakfast','Lunch','Dinner','Snacks')),
  note        text not null default '',
  date        date not null default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint health_meal_chk check (type = 'meal' or meal is null)
);

-- Office clock-in / clock-out  (app: Office)
create table if not exists public.office (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date           date not null default current_date,
  in_time        timestamptz not null default now(),
  out_time       timestamptz,
  total_minutes  integer check (total_minutes is null or total_minutes >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint office_out_after_in_chk check (out_time is null or out_time >= in_time)
);

-- Journal  (app: Journal)
create table if not exists public.journal (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null default current_date,
  mood        text not null default '',
  thoughts    text not null check (length(trim(thoughts)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Quotes shown on the dashboard  (app: Quotes)
create table if not exists public.quotes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text        text not null check (length(trim(text)) > 0),
  author      text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Calculator history  (app: Calc)
create table if not exists public.calc (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  expression  text not null,
  result      text not null,
  category    text not null default 'calc',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Focus / study-timer sessions  (app: Focus)
create table if not exists public.focus (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  duration      integer not null check (duration > 0),          -- minutes
  remarks       text not null default 'Study',
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint focus_completed_chk check (completed_at is null or completed_at >= started_at)
);

-- 21-day habits  (app: Habits) — days = [{ "d": "2026-11-21", "r": "remark" }, ...]
create table if not exists public.habits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  start_date  date not null default current_date,
  days        jsonb not null default '[]'::jsonb check (jsonb_typeof(days) = 'array'),
  streak      integer not null default 0 check (streak >= 0),
  status      text not null default 'active' check (status in ('active','done')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Pinned formulas / cards  (app: Pins)
create table if not exists public.pins (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type             text not null default 'formula',
  content          text not null default '',
  category         text not null default '',
  pinned           boolean not null default true,
  image_url        text,
  image_file_path  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Drawings (canvas PNG as data URL)  (app: Drawings)
create table if not exists public.drawings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default 'Drawing',
  data_url    text not null check (data_url like 'data:image/%'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Location history  (app: Locations)
create table if not exists public.locations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lat          numeric(9,6) not null check (lat between -90 and 90),
  lng          numeric(9,6) not null check (lng between -180 and 180),
  address      text not null default '',
  recorded_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Dashboard hero image  (app: DashImage)
create table if not exists public.dash_images (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  url         text not null,
  file_path   text,
  caption     text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Voice recordings  (app: Recordings)
create table if not exists public.recordings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  url          text not null,
  file_path    text,
  recorded_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Vocabulary learned per day  (app: VocabDone) — one row per user per day
create table if not exists public.vocab_done (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null default current_date,
  words       text[] not null default '{}',
  score       integer check (score is null or score >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint vocab_done_user_date_uk unique (user_id, date)
);

-- Alarms  (app: Alarms)
create table if not exists public.alarms (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  time        time not null,
  label       text not null default '',
  audio_url   text,
  audio_path  text,
  active      boolean not null default true,
  days        text not null default '',        -- repeat days, empty = every day
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Extra indexes for the app's frequent filters
-- ---------------------------------------------------------------------
create index if not exists tasks_user_due_idx        on public.tasks     (user_id, due) where status = 'open';
create index if not exists finance_user_date_idx     on public.finance   (user_id, date desc);
create index if not exists health_user_date_idx      on public.health    (user_id, date desc);
create index if not exists office_user_date_idx      on public.office    (user_id, date desc);
create index if not exists journal_user_date_idx     on public.journal   (user_id, date desc);
create index if not exists learning_review_gin_idx   on public.learning  using gin (review_dates);
create index if not exists syllabus_user_subject_idx on public.syllabus  (user_id, subject);
create index if not exists images_user_group_idx     on public.images    (user_id, group_name);

-- =====================================================================
-- For EVERY table: user index, updated_at trigger, RLS + 4 policies
-- =====================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'tasks','projects','notes','images','accounts','finance','learning',
    'syllabus','health','office','journal','quotes','calc','focus','habits',
    'pins','drawings','locations','dash_images','recordings','vocab_done','alarms'
  ]
  loop
    execute format('create index if not exists %I on public.%I (user_id, created_at desc)',
                   t || '_user_created_idx', t);

    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I
                    for each row execute function public.set_updated_at()',
                   'trg_' || t || '_updated_at', t);

    /* some projects don't auto-grant API roles — without this every call is 42501 */
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('create policy %I on public.%I for select to authenticated
                    using ((select auth.uid()) = user_id)', t || '_select_own', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('create policy %I on public.%I for insert to authenticated
                    with check ((select auth.uid()) = user_id)', t || '_insert_own', t);

    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('create policy %I on public.%I for update to authenticated
                    using ((select auth.uid()) = user_id)
                    with check ((select auth.uid()) = user_id)', t || '_update_own', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for delete to authenticated
                    using ((select auth.uid()) = user_id)', t || '_delete_own', t);
  end loop;
end;
$$;

-- =====================================================================
-- STORAGE: private bucket for images, attachments, recordings, alarm audio
-- Files must be uploaded under a folder named after the user id:
--   lifeos/<user_id>/images/xyz.jpg
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('lifeos', 'lifeos', false, 52428800)          -- 50 MB per file
on conflict (id) do nothing;

drop policy if exists lifeos_files_select_own on storage.objects;
create policy lifeos_files_select_own on storage.objects for select to authenticated
  using (bucket_id = 'lifeos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists lifeos_files_insert_own on storage.objects;
create policy lifeos_files_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'lifeos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists lifeos_files_update_own on storage.objects;
create policy lifeos_files_update_own on storage.objects for update to authenticated
  using (bucket_id = 'lifeos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'lifeos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists lifeos_files_delete_own on storage.objects;
create policy lifeos_files_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'lifeos' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
