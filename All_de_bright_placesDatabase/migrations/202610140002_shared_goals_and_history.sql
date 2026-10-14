-- Creates a private audit feed and restricts it to the two MFA-verified editors.
create table public.editor_history (
  id bigint generated always as identity primary key,
  actor text not null check(actor in ('ruby','jayatci')),
  goal_title text not null,
  summary text not null check(length(summary) between 1 and 240),
  changed_at timestamptz not null default now()
);
create index editor_history_recent on public.editor_history(changed_at desc,id desc);
alter table public.editor_history enable row level security;
revoke all on public.editor_history from public,anon,authenticated;
grant select on public.editor_history to authenticated;
create policy editor_history_read on public.editor_history for select to authenticated using(journal_private.is_editor());

-- Writes an audit row only when a verified allowlisted editor caused the journal mutation.
create function journal_private.record_history(p_goal_id uuid,p_summary text) returns void language plpgsql security definer set search_path = '' as $$
declare current_title text; current_actor text;
begin
  select title into current_title from public.goals where id=p_goal_id;
  select username into current_actor from public.editor_accounts where user_id=auth.uid();
  if current_title is not null and current_actor in ('ruby','jayatci') and journal_private.is_editor() then
    insert into public.editor_history(actor,goal_title,summary) values(current_actor,current_title,left(p_summary,240));
  end if;
end;
$$;

-- Captures goal creation, edits, ordering, and Trash state without storing private descriptions.
create function journal_private.audit_goal_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare change_summary text;
begin
  if tg_op='INSERT' then
    perform journal_private.record_history(new.id,'Added this goal to the list.');
    return new;
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    change_summary := case when new.deleted_at is null then 'Restored this goal from Trash.' else 'Moved this goal to Trash.' end;
  elsif new.position is distinct from old.position then
    change_summary := 'Changed the order of this goal.';
  elsif row(new.title,new.description,new.category,new.visibility) is distinct from row(old.title,old.description,old.category,old.visibility) then
    change_summary := 'Edited this goal.';
  end if;
  if change_summary is not null then perform journal_private.record_history(new.id,change_summary); end if;
  return new;
end;
$$;
create trigger goals_audit after insert or update on public.goals for each row execute function journal_private.audit_goal_change();

-- Captures participant completion and reopening while ignoring membership bookkeeping.
create function journal_private.audit_completion_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_goal uuid; completion date; person text;
begin
  parent_goal := case when tg_op='DELETE' then old.goal_id else new.goal_id end;
  completion := case when tg_op='DELETE' then old.completed_on else new.completed_on end;
  if tg_op='INSERT' then
    person := new.username;
    if new.completed_on is null then return new; end if;
  elsif tg_op='DELETE' then
    person := old.username;
    if old.completed_on is null then return old; end if;
  else
    person := new.username;
    if new.completed_on is not distinct from old.completed_on then return new; end if;
  end if;
  perform journal_private.record_history(parent_goal,case when completion is null then 'Reopened '||person||'''s part of this goal.' else 'Marked '||person||'''s part of this goal complete.' end);
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger participant_completion_audit after insert or update or delete on public.goal_participants for each row execute function journal_private.audit_completion_change();

-- Captures memory creation, edits, and removal without copying personal note text into history.
create function journal_private.audit_memory_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare change_summary text;
begin
  if tg_op='INSERT' then
    perform journal_private.record_history(new.goal_id,'Added a memory.');
    return new;
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    change_summary := 'Removed a memory.';
  elsif row(new.note,new.occurred_on) is distinct from row(old.note,old.occurred_on) then
    change_summary := 'Edited a memory.';
  end if;
  if change_summary is not null then perform journal_private.record_history(new.goal_id,change_summary); end if;
  return new;
end;
$$;
create trigger memories_audit after insert or update on public.memories for each row execute function journal_private.audit_memory_change();

-- Captures successfully published photo additions and removals attached to live memories.
create function journal_private.audit_photo_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_memory uuid; parent_goal uuid;
begin
  if tg_op='INSERT' then
    if not new.ready then return new; end if;
    parent_memory := new.memory_id;
  elsif tg_op='DELETE' then
    parent_memory := old.memory_id;
  else
    if new.ready is not true or old.ready is true then return new; end if;
    parent_memory := new.memory_id;
  end if;
  select goal_id into parent_goal from public.memories where id=parent_memory;
  perform journal_private.record_history(parent_goal,case when tg_op='DELETE' then 'Removed a photograph.' else 'Added a photograph to a memory.' end);
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger photos_audit after insert or update or delete on public.photos for each row execute function journal_private.audit_photo_change();

revoke all on function journal_private.record_history(uuid,text),journal_private.audit_goal_change(),journal_private.audit_completion_change(),journal_private.audit_memory_change(),journal_private.audit_photo_change() from public,anon,authenticated;
