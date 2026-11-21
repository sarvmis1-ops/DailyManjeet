-- =====================================================================
-- LifeOS Chat — profiles, 1-to-1 + group conversations, messages, files
-- Run AFTER schema.sql in: Supabase Dashboard → SQL Editor → Run.
-- Safe to re-run.
-- Access model: you can only see conversations you are a member of;
-- all writes except "send message" go through the functions below.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- profiles: one per auth user, visible to every signed-in user
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (length(trim(display_name)) between 1 and 40),
  avatar_url    text,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
                  nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                  'User'), 40)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- back-fill users who signed up before this script
insert into public.profiles (id, display_name)
select u.id,
       left(coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
                     nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
                     'User'), 40)
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- conversations / members / messages
-- ---------------------------------------------------------------------
create table if not exists public.conversations (
  id               uuid primary key default gen_random_uuid(),
  type             text not null check (type in ('direct','group')),
  title            text check (title is null or length(trim(title)) between 1 and 60),
  created_by       uuid references public.profiles(id) on delete set null,
  direct_key       text unique,                       -- '<smaller uuid>:<bigger uuid>' for direct chats
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint conversations_kind_chk check (
    (type = 'direct' and direct_key is not null) or
    (type = 'group'  and direct_key is null and title is not null))
);

create table if not exists public.conversation_members (
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  role             text not null default 'member' check (role in ('admin','member')),
  last_read_at     timestamptz not null default now(),
  joined_at        timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  sender_id        uuid default auth.uid() references public.profiles(id) on delete set null,
  kind             text not null default 'text' check (kind in ('text','image','video','audio','file','drawing')),
  body             text not null default '' check (length(body) <= 4000),
  file_path        text,
  file_name        text,
  file_size        bigint check (file_size is null or (file_size >= 0 and file_size <= 52428800)),
  mime_type        text,
  reply_to         uuid references public.messages(id) on delete set null,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint messages_content_chk check (
    deleted_at is not null
    or (kind = 'text' and length(trim(body)) > 0)
    or (kind <> 'text' and file_path is not null))
);

create index if not exists members_user_idx       on public.conversation_members (user_id);
create index if not exists messages_conv_time_idx on public.messages (conversation_id, created_at desc);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
drop trigger if exists trg_conversations_updated_at on public.conversations;
create trigger trg_conversations_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();
drop trigger if exists trg_messages_updated_at on public.messages;
create trigger trg_messages_updated_at before update on public.messages
  for each row execute function public.set_updated_at();

-- new message → bump the conversation (definer: members can't update conversations)
create or replace function public.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;

-- server decides id/time/deleted state; a reply must point into the same conversation
create or replace function public.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id := gen_random_uuid();
  new.created_at := now();
  new.updated_at := now();
  new.deleted_at := null;
  if new.reply_to is not null and not exists (
       select 1 from public.messages r where r.id = new.reply_to and r.conversation_id = new.conversation_id) then
    new.reply_to := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_messages_before_insert on public.messages;
create trigger trg_messages_before_insert before insert on public.messages
  for each row execute function public.messages_before_insert();

drop trigger if exists trg_messages_touch_conversation on public.messages;
create trigger trg_messages_touch_conversation after insert on public.messages
  for each row execute function public.touch_conversation();

-- ---------------------------------------------------------------------
-- membership helpers (definer → no RLS recursion)
-- ---------------------------------------------------------------------
create or replace function public.is_member(c uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.conversation_members m
                 where m.conversation_id = c and m.user_id = auth.uid());
$$;

-- storage paths start with the conversation id; anything else is "not a member"
create or replace function public.is_member_path(folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_member(folder::uuid)
    else false
  end;
$$;

create or replace function public.is_admin(c uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.conversation_members m
                 where m.conversation_id = c and m.user_id = auth.uid() and m.role = 'admin');
$$;

-- ---------------------------------------------------------------------
-- RPC: conversations
-- ---------------------------------------------------------------------
create or replace function public.start_direct(other uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me  uuid := auth.uid();
  k   text;
  cid uuid;
begin
  if me is null then raise exception 'Please sign in'; end if;
  if other is null or other = me then raise exception 'Choose another person'; end if;
  if not exists (select 1 from public.profiles where id = other) then raise exception 'User not found'; end if;

  k := least(me::text, other::text) || ':' || greatest(me::text, other::text);
  insert into public.conversations (type, created_by, direct_key)
  values ('direct', me, k)
  on conflict (direct_key) do nothing;            -- both people tapping at once → same chat
  select id into cid from public.conversations where direct_key = k;

  insert into public.conversation_members (conversation_id, user_id)
  values (cid, me), (cid, other)
  on conflict do nothing;
  return cid;
end;
$$;

create or replace function public.create_group(p_title text, member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me  uuid := auth.uid();
  t   text := trim(coalesce(p_title, ''));
  cid uuid;
  n   int;
begin
  if me is null then raise exception 'Please sign in'; end if;
  if length(t) < 1 or length(t) > 60 then raise exception 'Group name must be 1–60 characters'; end if;

  insert into public.conversations (type, title, created_by) values ('group', t, me) returning id into cid;
  insert into public.conversation_members (conversation_id, user_id, role) values (cid, me, 'admin');
  insert into public.conversation_members (conversation_id, user_id)
  select cid, p.id from public.profiles p
  where p.id = any (coalesce(member_ids, '{}')) and p.id <> me
  on conflict do nothing;

  get diagnostics n = row_count;
  if n = 0 then raise exception 'Add at least one person to the group'; end if;
  return cid;
end;
$$;

create or replace function public.add_members(c uuid, member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.conversations where id = c and type = 'group') then raise exception 'Not a group'; end if;
  if not public.is_admin(c) then raise exception 'Only group admins can add people'; end if;
  insert into public.conversation_members (conversation_id, user_id)
  select c, p.id from public.profiles p where p.id = any (coalesce(member_ids, '{}'))
  on conflict do nothing;
end;
$$;

create or replace function public.remove_member(c uuid, member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.conversations where id = c and type = 'group') then raise exception 'Not a group'; end if;
  if not public.is_admin(c) then raise exception 'Only group admins can remove people'; end if;
  if member = auth.uid() then raise exception 'Use Leave group to remove yourself'; end if;
  delete from public.conversation_members where conversation_id = c and user_id = member;
end;
$$;

create or replace function public.leave_group(c uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if not exists (select 1 from public.conversations where id = c and type = 'group') then raise exception 'Direct chats can''t be left'; end if;
  if not public.is_member(c) then raise exception 'You are not in this group'; end if;

  delete from public.conversation_members where conversation_id = c and user_id = me;

  if not exists (select 1 from public.conversation_members where conversation_id = c) then
    delete from public.conversations where id = c;
  elsif not exists (select 1 from public.conversation_members where conversation_id = c and role = 'admin') then
    update public.conversation_members set role = 'admin'
    where conversation_id = c
      and user_id = (select user_id from public.conversation_members
                     where conversation_id = c order by joined_at, user_id limit 1);
  end if;
end;
$$;

create or replace function public.rename_group(c uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text := trim(coalesce(p_title, ''));
begin
  if not public.is_admin(c) then raise exception 'Only group admins can rename the group'; end if;
  if length(t) < 1 or length(t) > 60 then raise exception 'Group name must be 1–60 characters'; end if;
  update public.conversations set title = t where id = c and type = 'group';
end;
$$;

create or replace function public.mark_read(c uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversation_members set last_read_at = now()
  where conversation_id = c and user_id = auth.uid();
$$;

-- clears the message; the client removes the storage file (Storage API) first
create or replace function public.delete_message(m uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.messages
     set body = '', file_path = null, file_name = null, file_size = null, mime_type = null, deleted_at = now()
   where id = m and sender_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'You can only delete your own messages'; end if;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: lists
-- ---------------------------------------------------------------------
create or replace function public.people()
returns table (id uuid, display_name text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, u.email::text
  from public.profiles p
  join auth.users u on u.id = p.id
  where auth.uid() is not null and p.id <> auth.uid()
  order by lower(p.display_name);
$$;

create or replace function public.my_conversations()
returns table (
  id uuid, type text, title text, last_message_at timestamptz,
  last_body text, last_kind text, last_sender uuid, last_deleted boolean,
  unread int, other_id uuid, other_name text, other_email text, member_count int)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.type, c.title, coalesce(c.last_message_at, c.created_at),
         lm.body, lm.kind, lm.sender_id, (lm.deleted_at is not null),
         (select count(*)::int from public.messages x
           where x.conversation_id = c.id and x.sender_id is distinct from auth.uid()
             and x.created_at > mine.last_read_at and x.deleted_at is null),
         o.user_id, op.display_name, ou.email::text,
         (select count(*)::int from public.conversation_members mm where mm.conversation_id = c.id)
  from public.conversation_members mine
  join public.conversations c on c.id = mine.conversation_id
  left join lateral (select m.body, m.kind, m.sender_id, m.deleted_at from public.messages m
                     where m.conversation_id = c.id order by m.created_at desc limit 1) lm on true
  left join lateral (select mm.user_id from public.conversation_members mm
                     where c.type = 'direct' and mm.conversation_id = c.id and mm.user_id <> auth.uid()
                     limit 1) o on true
  left join public.profiles op on op.id = o.user_id
  left join auth.users ou on ou.id = o.user_id
  where mine.user_id = auth.uid()
  order by coalesce(c.last_message_at, c.created_at) desc;
$$;

-- ---------------------------------------------------------------------
-- RLS + grants (signed-in users only; nothing for anon)
-- ---------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;

drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists conversations_select_member on public.conversations;
create policy conversations_select_member on public.conversations for select to authenticated
  using (public.is_member(id));

drop policy if exists members_select_member on public.conversation_members;
create policy members_select_member on public.conversation_members for select to authenticated
  using (public.is_member(conversation_id));

drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages for select to authenticated
  using (public.is_member(conversation_id));
drop policy if exists messages_insert_member on public.messages;
create policy messages_insert_member on public.messages for insert to authenticated
  with check (
    public.is_member(conversation_id)
    and sender_id = (select auth.uid())
    and deleted_at is null
    and (file_path is null or file_path like conversation_id::text || '/%'));

revoke all on public.profiles, public.conversations, public.conversation_members, public.messages from anon;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, last_seen_at) on public.profiles to authenticated;
grant select on public.conversations, public.conversation_members to authenticated;
grant select, insert on public.messages to authenticated;

revoke execute on function
  public.is_member(uuid), public.is_member_path(text), public.is_admin(uuid),
  public.start_direct(uuid), public.create_group(text, uuid[]), public.add_members(uuid, uuid[]),
  public.remove_member(uuid, uuid), public.leave_group(uuid), public.rename_group(uuid, text),
  public.mark_read(uuid), public.delete_message(uuid), public.people(), public.my_conversations()
from public, anon;
grant execute on function
  public.is_member(uuid), public.is_member_path(text), public.is_admin(uuid),
  public.start_direct(uuid), public.create_group(text, uuid[]), public.add_members(uuid, uuid[]),
  public.remove_member(uuid, uuid), public.leave_group(uuid), public.rename_group(uuid, text),
  public.mark_read(uuid), public.delete_message(uuid), public.people(), public.my_conversations()
to authenticated;
revoke execute on function public.handle_new_user(), public.touch_conversation(), public.messages_before_insert() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Realtime (RLS-aware postgres_changes)
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['messages','conversation_members','conversations'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Storage: private 'chat' bucket, path <conversation_id>/<uuid>_<name>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat', 'chat', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists chat_files_select_member on storage.objects;
create policy chat_files_select_member on storage.objects for select to authenticated
  using (bucket_id = 'chat' and public.is_member_path((storage.foldername(name))[1]));

drop policy if exists chat_files_insert_member on storage.objects;
create policy chat_files_insert_member on storage.objects for insert to authenticated
  with check (bucket_id = 'chat' and public.is_member_path((storage.foldername(name))[1]));

drop policy if exists chat_files_delete_owner on storage.objects;
create policy chat_files_delete_owner on storage.objects for delete to authenticated
  using (bucket_id = 'chat' and owner_id = (select auth.uid())::text);

commit;

-- Check: 4 rows, rls_enabled = true, privileges listed for authenticated
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       (select string_agg(distinct g.privilege_type, ', ')
          from information_schema.role_table_grants g
         where g.grantee = 'authenticated' and g.table_schema = 'public' and g.table_name = c.relname) as privileges
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('profiles','conversations','conversation_members','messages')
order by c.relname;
