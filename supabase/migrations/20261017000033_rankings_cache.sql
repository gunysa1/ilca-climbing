-- Precomputed season data for the rankings page. season_rankings() took ~0.7 s per call on the live
-- project; it now returns a stored payload, rebuilt once a minute by pg_cron (supabase/cron/rankings_cache.sql)
-- after a change to anything the payload is built from. The ranking itself is still computed in the
-- browser (src/lib/rankings.ts); only its inputs are cached.
--
-- Visibility: the payload is what an anonymous visitor gets from the invoker build, nothing more. The
-- refresh builds it as the anon role (set local role anon, no JWT claims), so RLS decides exactly as for
-- an anonymous request: no draft competitions, no planned rounds, no birth dates. The stored payload is
-- served to every caller (staff too), and only refresh_rankings_cache() writes it.
--
-- Staleness without locks: writes append to rankings_cache_changes (a season, or null = every season)
-- from statement-level triggers. Appends never wait on each other, so judges' writes never queue behind
-- the refresh or behind each other. The refresh reads the pending changes first, builds in later
-- statements (which see every change it read), and deletes only those changes: a change committed while
-- it builds stays pending for the next run. Until a season's first refresh, season_rankings() builds live.

create table public.season_rankings_cache (
  season   text primary key check (season ~ '^\d{4}-\d{2}$'),
  payload  json not null,
  built_at timestamptz not null default now()
);
create table public.rankings_cache_changes (
  id     bigint generated always as identity primary key,
  season text,  -- null: every season
  at     timestamptz not null default now()
);
-- Only the definer functions below touch them.
alter table public.season_rankings_cache enable row level security;
alter table public.rankings_cache_changes enable row level security;
revoke all on public.season_rankings_cache, public.rankings_cache_changes from anon, authenticated, service_role;

-- The former season_rankings() body (migration 029), unchanged. Security invoker: RLS as the caller, so
-- executing it reveals nothing the caller could not read with the separate queries. anon keeps EXECUTE:
-- the refresh runs it as anon, and season_rankings() runs it in the caller's context before the first refresh.
create function public.season_rankings_build(p_season text) returns json
  language sql stable security invoker set search_path = public as $$
  with rr as (select * from public.season_ranking_rounds(p_season)),
       ic as (select * from public.international_results where season = p_season),
       adj as (select * from public.ranking_adjustments where season = p_season),
       wr as (select * from public.world_rankings where season = p_season),
       ids as (select climber_id from rr union select climber_id from ic union select climber_id from wr)
  select json_build_object(
    'rounds', coalesce((select json_agg(to_json(rr)) from rr), '[]'::json),
    'age_classes', coalesce((select json_agg(to_json(a)) from public.season_age_classes(p_season) a), '[]'::json),
    'too_young', coalesce((select json_agg(y.climber_id) from public.season_senior_too_young(p_season) y), '[]'::json),
    'intl', coalesce((select json_agg(to_json(ic)) from ic), '[]'::json),
    'adjustments', coalesce((select json_agg(to_json(adj)) from adj), '[]'::json),
    'world', coalesce((select json_agg(to_json(wr)) from wr), '[]'::json),
    'profiles', coalesce((
      select json_agg(json_build_object('id', p.id, 'full_name', p.full_name, 'full_name_he', p.full_name_he,
                                        'club', p.club, 'country', p.country, 'gender', p.gender))
      from public.profiles p where p.id in (select climber_id from ids)), '[]'::json));
$$;
revoke execute on function public.season_rankings_build(text) from public;
grant execute on function public.season_rankings_build(text) to anon, authenticated, service_role;

-- The stored payload (anon's view, see above) or null before the season's first refresh.
create function public.season_rankings_cached(p_season text) returns json
  language sql stable security definer set search_path = public as $$
  select payload from public.season_rankings_cache where season = p_season;
$$;
revoke execute on function public.season_rankings_cached(text) from public;
grant execute on function public.season_rankings_cached(text) to anon, authenticated, service_role;

-- Same name and arguments as before (no client change). Security invoker: a definer cannot build in the
-- caller's context, so the live fallback runs here, as the caller.
create or replace function public.season_rankings(p_season text) returns json
  language plpgsql stable security invoker set search_path = public as $$
declare v json := public.season_rankings_cached(p_season);
begin
  if v is not null then return v; end if;  -- possibly up to a refresh old: stale while revalidating
  return public.season_rankings_build(p_season);
end $$;
grant execute on function public.season_rankings(text) to anon, authenticated;

-- Rebuilds the seasons with pending changes and the seasons not cached yet; returns how many it rebuilt.
-- Run by pg_cron as postgres (never exposed). Not security definer: set role is not allowed in one.
create function public.refresh_rankings_cache() returns int
  language plpgsql set search_path = public as $$
declare pending bigint[]; all_seasons boolean; me text := current_user; s text; v json; n int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('public.refresh_rankings_cache')) then return 0; end if;
  select coalesce(array_agg(id), '{}'), coalesce(bool_or(season is null), false) into pending, all_seasons
  from rankings_cache_changes;
  for s in
    select x.season from (
      select season from competitions where season is not null
      union select season from international_results
      union select season from ranking_adjustments
      union select season from world_rankings
      union select season from season_rankings_cache) x  -- a season whose last competition moved away: emptied
    where all_seasons
       or x.season in (select ch.season from rankings_cache_changes ch where ch.id = any(pending))
       or not exists (select 1 from season_rankings_cache c where c.season = x.season)
    order by x.season
  loop
    -- An anonymous visitor: no JWT claims (auth.uid() is null, so no admin / judge / coach / self rows).
    perform set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
    set local role anon;
    v := public.season_rankings_build(s);
    execute format('set local role %I', me);
    insert into season_rankings_cache (season, payload, built_at) values (s, v, now())
      on conflict (season) do update set payload = excluded.payload, built_at = excluded.built_at;
    n := n + 1;
  end loop;
  delete from rankings_cache_changes where id = any(pending);
  return n;
end $$;
revoke execute on function public.refresh_rankings_cache() from public, anon, authenticated, service_role;

-- Change markers: definer (the change log is closed), never callable directly. Postgres allows transition
-- tables only on single-event triggers, so the row-aware markers come as an insert, an update and a delete
-- trigger per table, all named new_rows / old_rows.
-- Results and start lists: the seasons of the rounds written (a round outside any season changes nothing).
-- (A statement is planned only when it runs: each branch names only the transition table its trigger has.)
create function public.rankings_cache_touch_rounds() returns trigger
  language plpgsql security definer set search_path = public as $$
declare rids uuid[];
begin
  if tg_op = 'INSERT' then select array_agg(distinct round_id) into rids from new_rows;
  elsif tg_op = 'DELETE' then select array_agg(distinct round_id) into rids from old_rows;
  else select array_agg(distinct x.round_id) into rids
       from (select round_id from new_rows union select round_id from old_rows) x;
  end if;
  insert into rankings_cache_changes (season)
  select distinct co.season
  from rounds r join categories c on c.id = r.category_id join competitions co on co.id = c.competition_id
  where r.id = any(rids) and co.season is not null;
  return null;
end $$;

-- International results, adjustments, world rankings: the seasons written.
create function public.rankings_cache_touch_seasons() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    insert into rankings_cache_changes (season) select distinct season from new_rows;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    insert into rankings_cache_changes (season) select distinct season from old_rows;
  end if;
  return null;
end $$;

-- Competition structure, people, truncates: every season (rare writes; a name or birth date can count in any).
create function public.rankings_cache_touch_all() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into rankings_cache_changes (season) values (null);
  return null;
end $$;

revoke execute on function public.rankings_cache_touch_rounds(), public.rankings_cache_touch_seasons(),
  public.rankings_cache_touch_all() from public, anon, authenticated, service_role;

-- Every table the build reads, directly or through season_ranking_rounds / round_ranks_for / round_scores /
-- lead_scores_for / season_age_classes / season_senior_too_young and the RLS policies anon is checked
-- against (registrations reach the payload only through round_starters, which their trigger writes).
do $$
declare t text; fn text;
begin
  foreach t in array array['boulder_results', 'lead_results', 'round_starters', 'round_totals',
                           'international_results', 'ranking_adjustments', 'world_rankings'] loop
    fn := case when t in ('international_results', 'ranking_adjustments', 'world_rankings')
               then 'rankings_cache_touch_seasons' else 'rankings_cache_touch_rounds' end;
    execute format('create trigger rankings_cache_ins after insert on public.%I referencing new table as new_rows
                      for each statement execute function public.%I()', t, fn);
    execute format('create trigger rankings_cache_upd after update on public.%I referencing old table as old_rows new table as new_rows
                      for each statement execute function public.%I()', t, fn);
    execute format('create trigger rankings_cache_del after delete on public.%I referencing old table as old_rows
                      for each statement execute function public.%I()', t, fn);
    execute format('create trigger rankings_cache_trunc after truncate on public.%I
                      for each statement execute function public.rankings_cache_touch_all()', t);
  end loop;
  foreach t in array array['competitions', 'categories', 'rounds', 'boulders', 'profiles', 'profile_private'] loop
    execute format('create trigger rankings_cache_all after insert or update or delete or truncate on public.%I
                      for each statement execute function public.rankings_cache_touch_all()', t);
  end loop;
end $$;
