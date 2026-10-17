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

-- profiles.ifsc_id is an IFSC athlete number. Every writer so far (tools/ifsc, the sync, the admin confirm) wrote
-- String(<int>), so validating at once is expected to pass; it is a separate statement so a stray value would
-- show up as a clear "violated by some row" error (the migration then rolls back as a whole).
alter table public.profiles add constraint profiles_ifsc_id_number check (ifsc_id ~ '^[1-9][0-9]*$') not valid;
alter table public.profiles validate constraint profiles_ifsc_id_number;

-- A changed IFSC link (admin edit or unlink; the sync only fills an empty one): the climber's world positions of
-- the current season (Israel calendar, September to August) belonged to the old athlete and are deleted (the
-- `{ athlete }` run or the next daily run writes the new ones). The old athlete is kept as ignored, without a
-- suggestion, so the sync never links them again by itself; an admin can restore them under Rankings. Their name
-- is unknown here ("IFSC #<id>") until the next run that sees them.
create function public.profiles_ifsc_id_changed() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  y int := extract(year from today)::int - case when extract(month from today) < 9 then 1 else 0 end;
begin
  delete from public.world_rankings
    where climber_id = new.id and season = y || '-' || lpad(((y + 1) % 100)::text, 2, '0');
  if old.ifsc_id is not null then
    insert into public.ifsc_pending (ifsc_athlete_id, firstname, lastname, status)
      values (old.ifsc_id::int, 'IFSC', '#' || old.ifsc_id, 'ignored')
      on conflict (ifsc_athlete_id) do update set status = 'ignored', suggested_profile = null, score = null;
  end if;
  return null;
end $$;
revoke execute on function public.profiles_ifsc_id_changed() from public, anon, authenticated;
create trigger profiles_ifsc_id_changed after update of ifsc_id on public.profiles
  for each row when (old.ifsc_id is distinct from new.ifsc_id) execute function public.profiles_ifsc_id_changed();
