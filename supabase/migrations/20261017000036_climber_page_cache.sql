-- Faster climber page. climber_page() took ~1 s for an anonymous visitor on the busiest climber (208 ms as
-- postgres, which bypasses RLS): a climber's ranks need every starter's scores in each of their rounds,
-- and under RLS every boulder_results row costs four policy function calls (round_is_public, can_judge,
-- has_role twice), every round_starters row a nested rounds -> categories -> competition check. Worse,
-- the planner fetched each starter's results through the climber_id index (all their rounds, ever) and
-- ran the policy on each row before matching the round: ~20x the rows needed.
--  1. An index on boulder_results (round_id, climber_id): the policy now runs on the round's rows only.
--  2. A stored copy of the climber page's history rows of closed rounds, per round, built as anon (the
--     rankings cache pattern of migration 033) and served by a definer reader. Live rounds are always
--     built live (a judge's write shows at once); everything is built live until a climber's closed
--     rounds are stored, and while the refresh is behind (a change pending for more than 5 minutes).
--
-- Visibility: the stored rows are what an anonymous visitor gets from the invoker build, nothing more.
-- The refresh builds them as the anon role with no JWT claims, so RLS decides exactly as for an anonymous
-- request: no draft competitions, no planned rounds, only the history columns (no profile data at all).
-- The reader also checks the current state: only rows of rounds that are closed now, in competitions
-- that are not drafts now, so unpublishing hides them at once. They are served to every caller (staff
-- too); only refresh_climber_cache() writes them.
--
-- Staleness without locks: writes append the rounds they touch to climber_cache_changes from statement
-- triggers (appends never wait on each other). The refresh marks those rounds stale, deletes the changes
-- it read and rebuilds live, never-built and stale rounds in batches; a change committed while it builds
-- stays pending for the next run. A stale closed round keeps serving its previous rows until rebuilt
-- (about a minute; a closed round changes only by an admin's correction).
--
-- The helpers live in schema private, which the API does not expose (PostgREST serves public only);
-- anon and authenticated keep USAGE and EXECUTE because climber_page runs them as the caller.

-- The composite index serves every lookup by round_id alone too.
create index boulder_results_round_climber_idx on public.boulder_results (round_id, climber_id);
drop index public.boulder_results_round_id_idx;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- Every round the refresh has built (with or without rows anon may see), and whether it changed since.
create table public.climber_cache_rounds (
  round_id uuid primary key,  -- no foreign key: deleting a round must not wait for the cache
  stale    boolean not null default false,
  built_at timestamptz not null default now()
);
-- One climber page history row (climber_page_entry) per climber and round, as anon sees it.
create table public.climber_cache_entries (
  climber_id uuid not null,
  round_id   uuid not null references public.climber_cache_rounds (round_id) on delete cascade,
  entry      json not null,
  primary key (climber_id, round_id)
);
create index on public.climber_cache_entries (round_id);
create table public.climber_cache_changes (
  id       bigint generated always as identity primary key,
  round_id uuid,  -- null: every round
  at       timestamptz not null default now()
);
-- Only the definer functions below touch them.
alter table public.climber_cache_rounds enable row level security;
alter table public.climber_cache_entries enable row level security;
alter table public.climber_cache_changes enable row level security;
revoke all on public.climber_cache_rounds, public.climber_cache_entries, public.climber_cache_changes
  from anon, authenticated, service_role;
revoke all on sequence public.climber_cache_changes_id_seq from anon, authenticated, service_role;

-- The columns the climber page reads (src/pages/Climber.tsx, lib/climberStats.ts): no climber_id (the page's
-- own), tops, zones, attempts or points. One definition for the stored rows and the live builds.
create function private.climber_page_entry(h public.climber_history) returns json
  language sql immutable set search_path = public as $$
  select json_build_object('round_id', h.round_id, 'competition_id', h.competition_id, 'competition', h.competition,
    'competition_he', h.competition_he, 'starts_on', h.starts_on, 'category', h.category, 'category_he', h.category_he,
    'round', h.round, 'round_status', h.round_status, 'discipline', h.discipline, 'rank', h.rank, 'starters', h.starters);
$$;

-- climber_history rows of every starter of the given rounds (climber_history_for() takes climbers). The
-- starters count is the rows per round: round_scores and lead_scores_for return one row per visible starter,
-- the same rows the count in climber_history_for sees. Security invoker: RLS as the caller.
create function private.round_history_for(p_rounds uuid[]) returns setof public.climber_history
  language sql stable security invoker set search_path = public as $$
  select x.climber_id, co.id, co.name, co.name_he, co.starts_on, c.name, c.name_he, r.kind, r.status,
         x.tops, x.zones, x.top_attempts, x.zone_attempts, x.points::numeric(6,1), x.rank,
         count(*) over (partition by x.round_id), r.scoring::text, r.id
  from (
    select sc.climber_id, sc.round_id, sc.tops, sc.zones, sc.top_attempts, sc.zone_attempts, sc.points, sc.rank
    from public.round_scores sc where sc.round_id = any(p_rounds)
    union all
    select l.climber_id, l.round_id, null, null, null, null, null, l.rank
    from public.lead_scores_for(coalesce(p_rounds, '{}')) l  -- (null would mean every lead round)
  ) x
  join public.rounds r        on r.id = x.round_id
  join public.categories c    on c.id = r.category_id
  join public.competitions co on co.id = c.competition_id;
$$;

-- The stored rows of the given rounds, as the caller sees them (the refresh calls it as anon). Planned
-- rounds are left out (the page shows none).
create function private.climber_cache_build(p_rounds uuid[])
returns table (round_id uuid, climber_id uuid, entry json)
  language sql stable security invoker set search_path = public as $$
  select h.round_id, h.climber_id, private.climber_page_entry(h)
  from private.round_history_for(p_rounds) h where h.round_status <> 'planned';
$$;

-- The climber's stored rows of rounds closed now in competitions not drafts now (anon's view, see above),
-- or null when the caller must build everything live: a closed round the climber started in has not been
-- built yet, or the refresh is behind (its oldest pending change is more than 5 minutes old: a stopped
-- cron degrades to slow but current pages).
create function private.climber_history_cached(p_climber uuid) returns json
  language sql stable security definer set search_path = public as $$
  select case
    when (select ch.at from climber_cache_changes ch order by ch.id limit 1) < now() - interval '5 minutes' then null
    when exists (select 1 from round_starters s join rounds r on r.id = s.round_id
                 where s.climber_id = p_climber and r.status = 'closed'
                   and not exists (select 1 from climber_cache_rounds b where b.round_id = s.round_id)) then null
    else coalesce((
      select json_agg(e.entry order by e.round_id)
      from climber_cache_entries e
      join rounds r on r.id = e.round_id
      join categories c on c.id = r.category_id
      join competitions co on co.id = c.competition_id
      where e.climber_id = p_climber and r.status = 'closed' and co.status <> 'draft'), '[]'::json)
  end;
$$;

revoke execute on function private.climber_page_entry(public.climber_history), private.round_history_for(uuid[]),
  private.climber_cache_build(uuid[]), private.climber_history_cached(uuid) from public;
grant execute on function private.climber_page_entry(public.climber_history), private.round_history_for(uuid[]),
  private.climber_cache_build(uuid[]), private.climber_history_cached(uuid) to anon, authenticated, service_role;

-- Same name, arguments and shape as before (history entries now carry only the columns the page reads).
-- Security invoker: the live builds and the profile / competitions parts run as the caller. The stored
-- rows cover closed rounds; the climber's live rounds are built here, every time.
create or replace function public.climber_page(p_climber uuid) returns json
  language plpgsql stable security invoker set search_path = public as $$
declare h json := private.climber_history_cached(p_climber); live uuid[];
begin
  if h is null then
    select coalesce(json_agg(private.climber_page_entry(x) order by x.round_id), '[]'::json) into h
    from public.climber_history_for(array[p_climber]) x where x.round_status <> 'planned';
  else
    select array_agg(s.round_id) into live
    from public.round_starters s join public.rounds r on r.id = s.round_id
    where s.climber_id = p_climber and r.status = 'live';
    if live is not null then
      select coalesce(json_agg(y.entry order by y.round_id), '[]'::json) into h
      from (select (e ->> 'round_id')::uuid as round_id, e as entry from json_array_elements(h) e
            union all
            select x.round_id, private.climber_page_entry(x)
            from private.round_history_for(live) x where x.climber_id = p_climber) y;
    end if;
  end if;
  return json_build_object(
    'profile', (select json_build_object('id', p.id, 'full_name', p.full_name, 'full_name_he', p.full_name_he,
                                         'club', p.club, 'country', p.country, 'gender', p.gender)
                from public.profiles p where p.id = p_climber),
    'history', h,
    'competitions', coalesce((
      select json_agg(json_build_object('id', co.id, 'season', co.season, 'series', co.series) order by co.id)
      from public.competitions co
      where co.id in (select (e ->> 'competition_id')::uuid from json_array_elements(h) e)), '[]'::json));
end $$;
grant execute on function public.climber_page(uuid) to anon, authenticated;

-- Marks changed rounds stale and (re)builds live, never-built and stale rounds, 100 per statement, until
-- p_budget has passed; returns how many rounds it built. Run by pg_cron as postgres every minute
-- (supabase/cron/climber_cache.sql; never exposed). Not security definer: set role is not allowed in one.
create function public.refresh_climber_cache(p_budget interval default '20 seconds') returns int
  language plpgsql set search_path = public as $$
declare pending bigint[]; changed uuid[]; all_rounds boolean; me text := current_user; t0 timestamptz := clock_timestamp();
        batch uuid[]; r_ids uuid[]; c_ids uuid[]; entries json[]; n int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('public.refresh_climber_cache')) then return 0; end if;
  select coalesce(array_agg(id), '{}'), coalesce(array_agg(distinct round_id) filter (where round_id is not null), '{}'),
         coalesce(bool_or(round_id is null), false)
  into pending, changed, all_rounds
  from climber_cache_changes;
  update climber_cache_rounds set stale = true where not stale and (all_rounds or round_id = any(changed));
  -- deleted rounds (their delete marked them; entries cascade)
  delete from climber_cache_rounds b
  where (all_rounds or b.round_id = any(changed)) and not exists (select 1 from rounds r where r.id = b.round_id);
  delete from climber_cache_changes where id = any(pending);
  loop
    select array_agg(x.id) into batch from (
      select r.id from rounds r left join climber_cache_rounds b on b.round_id = r.id
      where b.round_id is null or b.stale
      -- live first (fresh when they close), then never built (their climbers' pages are built live)
      order by r.status <> 'live', b.round_id is not null, r.id
      limit 100) x;
    exit when batch is null;
    -- An anonymous visitor: no JWT claims (auth.uid() is null, so no admin / judge / coach / self rows).
    perform set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
    set local role anon;
    select array_agg(e.round_id), array_agg(e.climber_id), array_agg(e.entry) into r_ids, c_ids, entries
    from private.climber_cache_build(batch) e;
    execute format('set local role %I', me);
    insert into climber_cache_rounds (round_id, stale, built_at) select unnest(batch), false, now()
      on conflict (round_id) do update set stale = false, built_at = excluded.built_at;
    delete from climber_cache_entries where round_id = any(batch);
    insert into climber_cache_entries (round_id, climber_id, entry)
      select * from unnest(coalesce(r_ids, '{}'), coalesce(c_ids, '{}'), coalesce(entries, '{}'));
    n := n + cardinality(batch);
    exit when clock_timestamp() - t0 > p_budget;
  end loop;
  return n;
end $$;
revoke execute on function public.refresh_climber_cache(interval) from public, anon, authenticated, service_role;

-- Change marker: the rounds a statement wrote (results, start lists, routes, rounds) or whose names and
-- visibility it changed (categories, competitions). Definer (the change log is closed), never callable
-- directly. A statement that changed no row marks nothing; a truncate marks every round.
-- (A statement is planned only when it runs: each branch names only the transition table its trigger has.)
create function public.climber_cache_touch() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  col text := case when tg_table_name in ('rounds', 'categories', 'competitions') then 'id' else 'round_id' end;
  k uuid[];
begin
  if tg_op = 'TRUNCATE' then
    insert into climber_cache_changes (round_id) values (null);
    return null;
  elsif tg_op = 'INSERT' then select array_agg(distinct (to_jsonb(x) ->> col)::uuid) into k from new_rows x;
  elsif tg_op = 'DELETE' then select array_agg(distinct (to_jsonb(x) ->> col)::uuid) into k from old_rows x;
  else select array_agg(distinct y.id) into k
       from (select (to_jsonb(x) ->> col)::uuid as id from new_rows x
             union select (to_jsonb(x) ->> col)::uuid from old_rows x) y;
  end if;
  if k is null then return null; end if;
  if tg_table_name = 'categories' then
    insert into climber_cache_changes (round_id) select r.id from rounds r where r.category_id = any(k);
  elsif tg_table_name = 'competitions' then
    insert into climber_cache_changes (round_id)
    select r.id from rounds r join categories c on c.id = r.category_id where c.competition_id = any(k);
  else
    insert into climber_cache_changes (round_id) select unnest(k);
  end if;
  return null;
end $$;
revoke execute on function public.climber_cache_touch() from public, anon, authenticated, service_role;

-- Every table the build reads, directly or through round_scores / lead_scores_for and the RLS policies
-- anon is checked against (user_roles and judge_assignments never decide for anon; registrations reach
-- the rows only through round_starters, which their trigger writes; profiles are not stored).
do $$
declare t text;
begin
  foreach t in array array['boulder_results', 'lead_results', 'round_starters', 'round_totals', 'boulders',
                           'rounds', 'categories', 'competitions'] loop
    execute format('create trigger climber_cache_ins after insert on public.%I referencing new table as new_rows
                      for each statement execute function public.climber_cache_touch()', t);
    execute format('create trigger climber_cache_upd after update on public.%I referencing old table as old_rows new table as new_rows
                      for each statement execute function public.climber_cache_touch()', t);
    execute format('create trigger climber_cache_del after delete on public.%I referencing old table as old_rows
                      for each statement execute function public.climber_cache_touch()', t);
    execute format('create trigger climber_cache_trunc after truncate on public.%I
                      for each statement execute function public.climber_cache_touch()', t);
  end loop;
end $$;
