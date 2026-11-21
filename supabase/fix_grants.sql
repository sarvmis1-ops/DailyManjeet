-- =====================================================================
-- LifeOS — fix "permission denied for table ..." (error 42501)
-- This project does not auto-grant table privileges to the API roles,
-- so logged-in users could not read or write anything.
-- Grants go to `authenticated` only; RLS still limits each user to own rows.
-- Run once in: Supabase Dashboard → SQL Editor → New query → Run.
-- =====================================================================

begin;

grant usage on schema public to authenticated;

grant select, insert, update, delete on table
  public.tasks, public.projects, public.notes, public.images, public.accounts,
  public.finance, public.learning, public.syllabus, public.health, public.office,
  public.journal, public.quotes, public.calc, public.focus, public.habits,
  public.pins, public.drawings, public.locations, public.dash_images,
  public.recordings, public.vocab_done, public.alarms
to authenticated;

-- tables created later in public get the same privileges automatically
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

commit;

-- Check: should list 22 rows, each with DELETE, INSERT, SELECT, UPDATE
select table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where grantee = 'authenticated' and table_schema = 'public'
group by table_name
order by table_name;
