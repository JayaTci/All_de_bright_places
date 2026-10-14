-- Creates the journal and its database-enforced editor and publication boundaries.
create table public.editor_accounts (
  user_id uuid primary key references auth.users(id) on delete restrict,
  username text not null unique check (username in ('ruby','jayatci'))
);
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '' check (length(description) <= 4000),
  category text not null check (category in ('Travel','Adventure','Food','Learning','Creative','Everyday','Other')),
  visibility text not null default 'private' check (visibility in ('public','private')),
  position bigint not null, revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.goal_participants (
  goal_id uuid not null references public.goals(id) on delete cascade,
  username text not null check (username in ('ruby','jayatci')),
  completed_on date, primary key(goal_id,username)
);
create table public.memories (
  id uuid primary key default gen_random_uuid(), goal_id uuid not null references public.goals(id) on delete cascade,
  author text not null check (author in ('ruby','jayatci')), occurred_on date not null,
  note text not null check (length(btrim(note)) between 1 and 4000), revision bigint not null default 1,
  deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.photos (
  id uuid primary key default gen_random_uuid(), memory_id uuid not null references public.memories(id) on delete cascade,
  caption text not null default '' check (length(caption) <= 500),
  width integer check (width between 1 and 2048), height integer check (height between 1 and 2048),
  ready boolean not null default false, created_at timestamptz not null default now(),
  check (not ready or (width is not null and height is not null))
);
create index goals_order on public.goals(position,id);
create index memories_goal on public.memories(goal_id);
create index photos_memory on public.photos(memory_id);
create schema if not exists journal_private;
revoke all on schema journal_private from public;
grant usage on schema journal_private to anon, authenticated;

-- Checks immutable allowlist membership and MFA claims without recursive account RLS.
create function journal_private.is_editor() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'aal' = 'aal2',false) and exists(select 1 from public.editor_accounts where user_id = auth.uid());
$$;
-- Rejects callers before security-definer mutations can bypass row policies.
create function journal_private.require_editor() returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not journal_private.is_editor() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
end;
$$;
-- Resolves publication and Trash state for child row and object policies.
create function journal_private.can_read_goal(p_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.goals where id=p_id and (journal_private.is_editor() or (visibility='public' and deleted_at is null)));
$$;
-- Resolves a memory through its parent while keeping deleted memories editor-only.
create function journal_private.can_read_memory(p_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.memories where id=p_id and (deleted_at is null or journal_private.is_editor()) and journal_private.can_read_goal(goal_id));
$$;
alter table public.editor_accounts enable row level security;
alter table public.goals enable row level security;
alter table public.goal_participants enable row level security;
alter table public.memories enable row level security;
alter table public.photos enable row level security;
revoke all on public.editor_accounts,public.goals,public.goal_participants,public.memories,public.photos from anon,authenticated;
grant select on public.goals,public.goal_participants,public.memories,public.photos to anon,authenticated;
grant select on public.editor_accounts to authenticated;
grant update(width,height,ready) on public.photos to authenticated;
create policy editor_self on public.editor_accounts for select to authenticated using(user_id=auth.uid());
create policy goal_read on public.goals for select using(journal_private.is_editor() or (visibility='public' and deleted_at is null));
create policy participant_read on public.goal_participants for select using(journal_private.can_read_goal(goal_id));
create policy memory_read on public.memories for select using(journal_private.can_read_memory(id));
create policy photo_read on public.photos for select using(journal_private.can_read_memory(memory_id) and (ready or journal_private.is_editor()));
create policy photo_finalize on public.photos for update to authenticated using(journal_private.is_editor() and exists(select 1 from public.memories m join public.goals g on g.id=m.goal_id where m.id=memory_id and m.deleted_at is null and g.deleted_at is null)) with check(journal_private.is_editor());

-- Validates complete goal input before inserts or participant replacement.
create function journal_private.validate_goal(p jsonb) returns void language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(p->'participants') is distinct from 'array' then raise exception 'INVALID_PARTICIPANTS'; end if;
  if jsonb_array_length(p->'participants') not between 1 and 2
    or exists(select 1 from jsonb_array_elements_text(p->'participants') x where x not in ('ruby','jayatci'))
    or (select count(distinct x) from jsonb_array_elements_text(p->'participants') x) <> jsonb_array_length(p->'participants')
  then raise exception 'INVALID_PARTICIPANTS'; end if;
end;
$$;
-- Creates a goal and participants atomically, serializing manual order allocation.
create function public.create_goal(p_payload jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  perform journal_private.require_editor(); perform journal_private.validate_goal(p_payload);
  perform pg_advisory_xact_lock(621401);
  insert into public.goals(title,description,category,visibility,position)
  values(btrim(p_payload->>'title'),coalesce(p_payload->>'description',''),p_payload->>'category',coalesce(p_payload->>'visibility','private'),coalesce((select max(position) from public.goals),0)+1) returning id into result;
  insert into public.goal_participants(goal_id,username) select result,x from jsonb_array_elements_text(p_payload->'participants') x;
  return result;
end;
$$;
-- Mutates a goal under a revision lock; ordering swaps both neighbors in one transaction.
create function public.mutate_goal(p_id uuid,p_revision bigint,p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare current_goal public.goals; neighbor public.goals;
begin
  perform journal_private.require_editor();
  perform pg_advisory_xact_lock(621401);
  select * into current_goal from public.goals where id=p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if current_goal.revision<>p_revision then raise exception 'CONFLICT'; end if;
  if current_goal.deleted_at is not null and p_action<>'restore' then raise exception 'TRASHED'; end if;
  case p_action
  when 'edit' then
    perform journal_private.validate_goal(p_payload);
    update public.goals set title=btrim(p_payload->>'title'),description=coalesce(p_payload->>'description',''),category=p_payload->>'category',visibility=p_payload->>'visibility' where id=p_id;
    delete from public.goal_participants where goal_id=p_id and username not in(select jsonb_array_elements_text(p_payload->'participants'));
    insert into public.goal_participants(goal_id,username) select p_id,x from jsonb_array_elements_text(p_payload->'participants') x on conflict do nothing;
  when 'complete' then
    update public.goal_participants set completed_on=(p_payload->>'completedOn')::date where goal_id=p_id and username=p_payload->>'username';
    if not found then raise exception 'INVALID_PARTICIPANT'; end if;
  when 'trash' then update public.goals set deleted_at=now() where id=p_id;
  when 'restore' then update public.goals set deleted_at=null where id=p_id;
  when 'move' then
    if p_payload->>'direction' not in ('up','down') or p_payload->>'direction' is null then raise exception 'INVALID_DIRECTION'; end if;
    if p_payload->>'direction'='up' then
      select * into neighbor from public.goals where deleted_at is null and (position,id)<(current_goal.position,current_goal.id) order by position desc,id desc limit 1 for update;
    else
      select * into neighbor from public.goals where deleted_at is null and (position,id)>(current_goal.position,current_goal.id) order by position,id limit 1 for update;
    end if;
    if neighbor.id is not null then
      update public.goals set position=current_goal.position,revision=revision+1,updated_at=now() where id=neighbor.id;
      update public.goals set position=neighbor.position where id=p_id;
    end if;
  else raise exception 'INVALID_ACTION';
  end case;
  update public.goals set revision=revision+1,updated_at=now() where id=p_id;
  return p_id;
end;
$$;
-- Adds an authored memory only to a live goal using the immutable editor identity.
create function public.create_memory(p_goal_id uuid,p_occurred_on date,p_note text) returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  perform journal_private.require_editor();
  perform 1 from public.goals where id=p_goal_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.memories(goal_id,author,occurred_on,note) values(p_goal_id,(select username from public.editor_accounts where user_id=auth.uid()),p_occurred_on,btrim(p_note)) returning id into result;
  return result;
end;
$$;
-- Edits or hides a live memory, rejecting concurrent stale drafts.
create function public.mutate_memory(p_id uuid,p_revision bigint,p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare current_memory public.memories; parent_goal uuid;
begin
  perform journal_private.require_editor();
  select goal_id into parent_goal from public.memories where id=p_id;
  perform 1 from public.goals where id=parent_goal and deleted_at is null for update;
  if not found then raise exception 'TRASHED'; end if;
  select * into current_memory from public.memories where id=p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if current_memory.revision<>p_revision then raise exception 'CONFLICT'; end if;
  if current_memory.deleted_at is not null then raise exception 'TRASHED'; end if;
  case p_action
  when 'edit' then update public.memories set note=btrim(p_payload->>'note'),occurred_on=(p_payload->>'occurredOn')::date where id=p_id;
  when 'delete' then update public.memories set deleted_at=now() where id=p_id;
  else raise exception 'INVALID_ACTION'; end case;
  update public.memories set revision=revision+1,updated_at=now() where id=p_id;
  return p_id;
end;
$$;
-- Reserves one pending photo while locking its memory to enforce the ten-photo cap.
create function public.reserve_photo(p_memory_id uuid,p_caption text) returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; parent_goal uuid;
begin
  perform journal_private.require_editor();
  select goal_id into parent_goal from public.memories where id=p_memory_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.goals where id=parent_goal and deleted_at is null for update;
  if not found then raise exception 'TRASHED'; end if;
  perform 1 from public.memories where id=p_memory_id and deleted_at is null for update;
  if not found then raise exception 'TRASHED'; end if;
  if (select count(*) from public.photos where memory_id=p_memory_id)>=10 then raise exception 'PHOTO_LIMIT'; end if;
  insert into public.photos(memory_id,caption) values(p_memory_id,coalesce(p_caption,'')) returning id into result;
  return result;
end;
$$;
-- Removes a failed reservation so retries do not consume the attachment limit.
create function public.cancel_photo(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform journal_private.require_editor();
  delete from public.photos where id=p_id and not ready;
end;
$$;
revoke all on all functions in schema journal_private from public;
grant execute on function journal_private.is_editor(),journal_private.can_read_goal(uuid),journal_private.can_read_memory(uuid) to anon,authenticated;
revoke all on function public.create_goal(jsonb),public.mutate_goal(uuid,bigint,text,jsonb),public.create_memory(uuid,date,text),public.mutate_memory(uuid,bigint,text,jsonb),public.reserve_photo(uuid,text),public.cancel_photo(uuid) from public,anon;
grant execute on function public.create_goal(jsonb),public.mutate_goal(uuid,bigint,text,jsonb),public.create_memory(uuid,date,text),public.mutate_memory(uuid,bigint,text,jsonb),public.reserve_photo(uuid,text),public.cancel_photo(uuid) to authenticated;

-- Deletes attachment metadata after the application removes both storage variants.
create function public.delete_photo(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform journal_private.require_editor();
  delete from public.photos p using public.memories m,public.goals g where p.id=p_id and m.id=p.memory_id and g.id=m.goal_id and m.deleted_at is null and g.deleted_at is null;
end;
$$;
revoke all on function public.delete_photo(uuid) from public,anon;
grant execute on function public.delete_photo(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('journal-photos','journal-photos',false,3145728,array['image/webp']);
-- Matches only generated photo variants and applies live parent permissions.
create function journal_private.can_read_object(p_name text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.photos p where p_name in ('display/'||p.id::text||'.webp','thumbnail/'||p.id::text||'.webp') and journal_private.can_read_memory(p.memory_id) and (p.ready or journal_private.is_editor()));
$$;
-- Restricts writes to photo reservations attached to live journal content.
create function journal_private.can_write_object(p_name text) returns boolean language sql stable security definer set search_path = '' as $$
  select journal_private.is_editor() and exists(select 1 from public.photos p join public.memories m on m.id=p.memory_id join public.goals g on g.id=m.goal_id where p_name in ('display/'||p.id::text||'.webp','thumbnail/'||p.id::text||'.webp') and m.deleted_at is null and g.deleted_at is null);
$$;
revoke all on function journal_private.can_read_object(text),journal_private.can_write_object(text) from public;
grant execute on function journal_private.can_read_object(text),journal_private.can_write_object(text) to anon,authenticated;
create policy journal_download on storage.objects for select to anon,authenticated using(bucket_id='journal-photos' and storage.allow_only_operation('object.get_authenticated') and journal_private.can_read_object(name));
create policy journal_list on storage.objects for select to authenticated using(bucket_id='journal-photos' and storage.allow_only_operation('object.list') and journal_private.is_editor());
create policy journal_remove_lookup on storage.objects for select to authenticated using(bucket_id='journal-photos' and storage.allow_any_operation(array['object.delete','object.delete_many']) and journal_private.can_write_object(name));
create policy journal_upload on storage.objects for insert to authenticated with check(bucket_id='journal-photos' and journal_private.can_write_object(name));
create policy journal_remove on storage.objects for delete to authenticated using(bucket_id='journal-photos' and journal_private.can_write_object(name));
