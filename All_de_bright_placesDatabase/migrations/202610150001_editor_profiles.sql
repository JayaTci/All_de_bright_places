-- Adds two public editor profiles and privately stored pictures with per-picture visibility.
create table public.editor_profiles (
  username text primary key check (username in ('ruby','jayatci')),
  bio text not null default '' check (length(bio) <= 240),
  picture_visibility text not null default 'public' check (picture_visibility in ('public','friends')),
  picture_id uuid,
  pending_picture_id uuid,
  pending_picture_at timestamptz,
  stale_picture_id uuid,
  updated_at timestamptz not null default now(),
  check (picture_id is null or pending_picture_id is null or picture_id<>pending_picture_id),
  check (stale_picture_id is null or pending_picture_id is null or stale_picture_id<>pending_picture_id),
  check (stale_picture_id is null or picture_id is null or stale_picture_id<>picture_id),
  check ((pending_picture_id is null) = (pending_picture_at is null))
);
insert into public.editor_profiles(username) values ('ruby'),('jayatci');
alter table public.editor_profiles enable row level security;
revoke all on public.editor_profiles from public,anon,authenticated;
grant select(username,bio,picture_visibility,picture_id,updated_at) on public.editor_profiles to anon,authenticated;
create policy editor_profiles_read on public.editor_profiles for select to anon,authenticated using (true);

-- Requires both a verified editor session and matching immutable account username.
create function journal_private.is_profile_owner(p_username text) returns boolean language sql stable security definer set search_path = '' as $$
  select journal_private.is_editor() and exists (
    select 1 from public.editor_accounts where user_id=auth.uid() and username=p_username
  );
$$;

-- Saves a public bio and the audience for the owner's current picture.
create function public.update_editor_profile(p_username text,p_bio text,p_visibility text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not journal_private.is_profile_owner(p_username) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_bio is null or length(p_bio)>240 or p_visibility not in ('public','friends') or p_visibility is null then raise exception 'INVALID_PROFILE'; end if;
  update public.editor_profiles set bio=btrim(p_bio),picture_visibility=p_visibility,updated_at=now() where username=p_username;
  if not found then raise exception 'NOT_FOUND'; end if;
end;
$$;

-- Reserves one upload path so the storage policy cannot accept untracked objects.
create function public.reserve_profile_picture(p_username text,p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare current_profile public.editor_profiles;
begin
  if not journal_private.is_profile_owner(p_username) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into current_profile from public.editor_profiles where username=p_username for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if current_profile.pending_picture_id is not null or current_profile.stale_picture_id is not null then raise exception 'PROFILE_BUSY'; end if;
  if p_id is null or p_id=current_profile.picture_id then raise exception 'INVALID_PROFILE'; end if;
  update public.editor_profiles set pending_picture_id=p_id,pending_picture_at=now() where username=p_username;
end;
$$;

-- Publishes a completed upload and tracks the prior object until deletion succeeds.
create function public.finalize_profile_picture(p_username text,p_id uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare old_id uuid;
begin
  if not journal_private.is_profile_owner(p_username) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select picture_id into old_id from public.editor_profiles where username=p_username and pending_picture_id=p_id and stale_picture_id is null for update;
  if not found then raise exception 'CONFLICT'; end if;
  update public.editor_profiles set picture_id=p_id,pending_picture_id=null,pending_picture_at=null,stale_picture_id=old_id,updated_at=now() where username=p_username;
  return old_id;
end;
$$;

-- Removes a failed upload reservation only after application-side object cleanup.
create function public.clear_profile_pending(p_username text,p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not journal_private.is_profile_owner(p_username) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  update public.editor_profiles set pending_picture_id=null,pending_picture_at=null where username=p_username and pending_picture_id=p_id;
end;
$$;

-- Hides a picture immediately and records its object for reliable cleanup.
create function public.remove_profile_picture(p_username text) returns uuid language plpgsql security definer set search_path = '' as $$
declare old_id uuid;
begin
  if not journal_private.is_profile_owner(p_username) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select picture_id into old_id from public.editor_profiles where username=p_username and stale_picture_id is null and pending_picture_id is null for update;
  if not found then raise exception 'PROFILE_BUSY'; end if;
  update public.editor_profiles set picture_id=null,stale_picture_id=old_id,updated_at=now() where username=p_username;
  return old_id;
end;
$$;

-- Clears stale metadata only after its old object has been removed.
create function public.clear_profile_stale(p_username text,p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not journal_private.is_profile_owner(p_username) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  update public.editor_profiles set stale_picture_id=null where username=p_username and stale_picture_id=p_id;
end;
$$;

-- Lets an owner resume cleanup after an interrupted upload, replacement, or removal.
create function public.profile_picture_cleanup_state(p_username text) returns table(pending_id uuid,pending_at timestamptz,stale_id uuid) language plpgsql stable security definer set search_path = '' as $$
begin
  if not journal_private.is_profile_owner(p_username) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  return query select pending_picture_id,pending_picture_at,stale_picture_id from public.editor_profiles where username=p_username;
end;
$$;

revoke all on function journal_private.is_profile_owner(text) from public;
grant execute on function journal_private.is_profile_owner(text) to authenticated;
revoke all on function public.update_editor_profile(text,text,text),public.reserve_profile_picture(text,uuid),public.finalize_profile_picture(text,uuid),public.clear_profile_pending(text,uuid),public.remove_profile_picture(text),public.clear_profile_stale(text,uuid),public.profile_picture_cleanup_state(text) from public,anon;
grant execute on function public.update_editor_profile(text,text,text),public.reserve_profile_picture(text,uuid),public.finalize_profile_picture(text,uuid),public.clear_profile_pending(text,uuid),public.remove_profile_picture(text),public.clear_profile_stale(text,uuid),public.profile_picture_cleanup_state(text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-pictures','profile-pictures',false,3145728,array['image/webp']);

-- Permits only the active object and enforces Friends access with MFA on every read.
create function journal_private.can_read_profile_picture(p_name text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.editor_profiles p
    where p.picture_id is not null and p_name=p.username||'/'||p.picture_id::text||'.webp'
      and (p.picture_visibility='public' or journal_private.is_editor())
  );
$$;

-- Ties new object creation to the owner's current reservation.
create function journal_private.can_upload_profile_picture(p_name text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.editor_profiles p
    where p.pending_picture_id is not null and p_name=p.username||'/'||p.pending_picture_id::text||'.webp'
      and journal_private.is_profile_owner(p.username)
  );
$$;

-- Lets the owner remove only the reserved or retired object, never the live picture.
create function journal_private.can_delete_profile_picture(p_name text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.editor_profiles p
    where journal_private.is_profile_owner(p.username)
      and p_name in (p.username||'/'||p.pending_picture_id::text||'.webp',p.username||'/'||p.stale_picture_id::text||'.webp')
  );
$$;
revoke all on function journal_private.can_read_profile_picture(text),journal_private.can_upload_profile_picture(text),journal_private.can_delete_profile_picture(text) from public;
grant execute on function journal_private.can_read_profile_picture(text) to anon,authenticated;
grant execute on function journal_private.can_upload_profile_picture(text),journal_private.can_delete_profile_picture(text) to authenticated;
create policy profile_picture_download on storage.objects for select to anon,authenticated
  using(bucket_id='profile-pictures' and storage.allow_only_operation('object.get_authenticated') and journal_private.can_read_profile_picture(name));
create policy profile_picture_remove_lookup on storage.objects for select to authenticated
  using(bucket_id='profile-pictures' and storage.allow_any_operation(array['object.delete','object.delete_many']) and journal_private.can_delete_profile_picture(name));
create policy profile_picture_upload on storage.objects for insert to authenticated
  with check(bucket_id='profile-pictures' and journal_private.can_upload_profile_picture(name));
create policy profile_picture_remove on storage.objects for delete to authenticated
  using(bucket_id='profile-pictures' and journal_private.can_delete_profile_picture(name));
