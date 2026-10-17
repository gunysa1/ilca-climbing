-- IFSC sync follow-ups: corrected rows and skipped categories/athletes in the run log, a hard one-run-at-a-time
-- lock, and no birthday kept for ignored athletes.
alter table public.ifsc_sync_runs
  add column updated  int   not null default 0,
  add column warnings jsonb not null default '[]';

-- One running run at most: a second insert of status 'running' fails (unique violation), so two calls in the
-- same instant cannot both start. Older leftovers are closed first so the index can be built.
update public.ifsc_sync_runs set status = 'failed', error = 'timed out', finished_at = now()
  where status = 'running' and id <> (select max(id) from public.ifsc_sync_runs where status = 'running');
create unique index ifsc_sync_runs_one_running on public.ifsc_sync_runs (status) where status = 'running';

-- An ignored athlete's birthday was only needed for matching: cleared when ignored (by an admin or kept so by
-- the sync's upsert), and filled again by the next sync if the athlete is restored.
create function public.ifsc_pending_forget_birthday() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'ignored' then new.birthday := null; end if;
  return new;
end $$;
revoke execute on function public.ifsc_pending_forget_birthday() from public, anon, authenticated;
create trigger ifsc_pending_forget_birthday before insert or update on public.ifsc_pending
  for each row execute function public.ifsc_pending_forget_birthday();
update public.ifsc_pending set birthday = null where status = 'ignored' and birthday is not null;
