-- Two admin tools: system_status() (the "system" box on the admin home) and admin_log (who changed
-- competitions, rounds, judge assignments, roles and appeals).

-- ---------------------------------------------------------------------------- system_status()
-- The background jobs log only to cron.job_run_details / ifsc_sync_runs, so a failing job went unnoticed (a
-- failing rankings-cache leaves the rankings old forever; a failing climber-cache makes climber pages build live,
-- slowly). One admin-only call returns what the admin home needs to show it; which part is red (a job's last
-- success older than 10 minutes, the IFSC sync's older than 26 hours, work waiting longer than 10 minutes) is
-- decided by the page (src/lib/systemStatus.ts).
--   cron: the four pg_cron jobs (supabase/cron/*.sql): scheduled, active, last run (start, status, message) and
--         last success; null with cron_error when pg_cron is not there (the local test Postgres) or not readable.
--         ranking-tables and ifsc-sync only queue an HTTP call (pg_net): their cron success says the call was
--         made; ranking_tables_due and ifsc say whether it worked.
--   rankings: each cached season's built_at; rankings_pending: changes waiting for the next rebuild.
--   climber_cache: changes waiting and stale rounds (rebuilt by the next runs).
--   ranking_tables_due: seasons whose stored tables are older than their cached payload, with that payload's age.
--   ifsc: the last sync run and the last one that went well.
-- Security definer (cron.* and the caches are closed to clients), admins only.
create function public.system_status() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  jobs jsonb;
  cron_error text;
begin
  if not public.has_role('admin') then
    raise exception 'only admins read the system status' using errcode = 'insufficient_privilege';
  end if;
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then
    cron_error := 'pg_cron is not installed';
  else
    begin
      -- dynamic: the function must compile where the cron schema does not exist
      execute $q$
        select coalesce(jsonb_agg(jsonb_build_object(
                 'name', n.name, 'scheduled', j.jobid is not null, 'active', coalesce(j.active, false), 'schedule', j.schedule,
                 'last_run', lr.start_time, 'last_status', lr.status, 'last_message', left(lr.return_message, 300),
                 'last_success', ls.at) order by n.ord), '[]'::jsonb)
        from unnest(array['rankings-cache', 'climber-cache', 'ranking-tables', 'ifsc-sync']) with ordinality n (name, ord)
        left join cron.job j on j.jobname = n.name
        left join lateral (select d.start_time, d.status, d.return_message from cron.job_run_details d
                           where d.jobid = j.jobid order by d.runid desc limit 1) lr on true
        left join lateral (select coalesce(d.end_time, d.start_time) as at from cron.job_run_details d
                           where d.jobid = j.jobid and d.status = 'succeeded' order by d.runid desc limit 1) ls on true
      $q$ into jobs;
    exception when others then
      jobs := null;
      cron_error := sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'now', now(),
    'cron', jobs,
    'cron_error', cron_error,
    'rankings', coalesce((select jsonb_agg(jsonb_build_object('season', c.season, 'built_at', c.built_at) order by c.season desc)
                          from season_rankings_cache c), '[]'::jsonb),
    'rankings_pending', (select jsonb_build_object('count', count(*), 'oldest', min(at)) from rankings_cache_changes),
    'climber_cache', jsonb_build_object(
      'pending', (select count(*) from climber_cache_changes),
      'oldest', (select min(at) from climber_cache_changes),
      'stale_rounds', (select count(*) from climber_cache_rounds where stale)),
    'ranking_tables_due', coalesce((select jsonb_agg(jsonb_build_object('season', d.season, 'source_built_at', c.built_at) order by d.season desc)
                                    from ranking_tables_due() d join season_rankings_cache c on c.season = d.season), '[]'::jsonb),
    'ifsc', jsonb_build_object(
      'last_run', (select to_jsonb(r) - 'error' || jsonb_build_object('error', left(r.error, 300))
                   from ifsc_sync_runs r order by r.started_at desc, r.id desc limit 1),
      'last_ok', (select max(coalesce(finished_at, started_at)) from ifsc_sync_runs where status = 'ok')));
end $$;
revoke all on function public.system_status() from public, anon;
grant execute on function public.system_status() to authenticated;

-- ---------------------------------------------------------------------------- admin_log
-- Score changes are logged (score_events, lead_events); now also the admin side: publishing a competition,
-- changing a round's status, scoring or quota, assigning judges, changing roles, opening and deciding appeals.
-- One row per changed row, written by triggers (whoever writes: admins, the sign-up trigger, edge functions).
-- changes: update {column: [old, new]} (changed columns only), insert / delete {column: value}. The five tables
-- hold no personal data: ids, statuses, dates and competition names (an appeal's reason and decision are in
-- appeal_details, not logged). actor_id: the writer's profile (my_profile_id()), null for the system (service
-- role, pg_cron, sign-up); like profile_merges.merged_by it is a log column, not in private.profile_refs(): merging
-- or deleting that profile leaves the id as it was (the page then shows no name). competition_id / round_id: where it belongs, for the competition and round pages (no
-- foreign keys: the log outlives deletions). Rows deleted by a cascade (a competition or round deleted) are not
-- logged one by one: the deleted parent's entry says it (except roles, whose cascade is an account deletion).
create table public.admin_log (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  actor_id       uuid,
  table_name     text not null check (table_name in ('competitions', 'rounds', 'judge_assignments', 'user_roles', 'appeals')),
  row_id         text not null,
  action         text not null check (action in ('insert', 'update', 'delete')),
  changes        jsonb not null,
  competition_id uuid,
  round_id       uuid
);
create index on public.admin_log (competition_id, at desc);
create index on public.admin_log (round_id, at desc);
create index on public.admin_log (table_name, at desc);
alter table public.admin_log enable row level security;
create policy admin_log_read on public.admin_log for select using (public.has_role('admin'));
revoke all on public.admin_log from anon, authenticated;
grant select on public.admin_log to authenticated;
revoke all on sequence public.admin_log_id_seq from anon, authenticated;

create function private.admin_log_write() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  ch jsonb;
  rid uuid;
  cid uuid;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 and tg_table_name <> 'user_roles' then
    return null;  -- deleted with its competition / round
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(e.key, jsonb_build_array(o -> e.key, e.value)), '{}'::jsonb) into ch
    from jsonb_each(n) e where e.value is distinct from o -> e.key;
    if ch = '{}'::jsonb then return null; end if;
  else
    ch := r;
  end if;
  rid := case tg_table_name when 'rounds' then (r ->> 'id')::uuid
                            when 'competitions' then null when 'user_roles' then null
                            else (r ->> 'round_id')::uuid end;
  cid := case tg_table_name
           when 'competitions' then (r ->> 'id')::uuid
           when 'rounds' then (select c.competition_id from categories c where c.id = (r ->> 'category_id')::uuid)
           when 'user_roles' then null
           else (select c.competition_id from rounds x join categories c on c.id = x.category_id where x.id = rid) end;
  insert into admin_log (actor_id, table_name, row_id, action, changes, competition_id, round_id)
  values (public.my_profile_id(), tg_table_name,
          coalesce(r ->> 'id', (r ->> 'user_id') || ':' || (r ->> 'role')), lower(tg_op), ch, cid, rid);
  return null;
end $$;
revoke all on function private.admin_log_write() from public, anon, authenticated;

create trigger admin_log after insert or update or delete on public.competitions
  for each row execute function private.admin_log_write();
create trigger admin_log after insert or update or delete on public.rounds
  for each row execute function private.admin_log_write();
create trigger admin_log after insert or update or delete on public.judge_assignments
  for each row execute function private.admin_log_write();
create trigger admin_log after insert or update or delete on public.user_roles
  for each row execute function private.admin_log_write();
create trigger admin_log after insert or update or delete on public.appeals
  for each row execute function private.admin_log_write();
