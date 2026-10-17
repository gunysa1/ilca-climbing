-- Finished national ranking tables. The rankings page fetched a season's whole ranking data (~790 KB) and
-- computed the tables in the browser; it now reads the one table it shows. The rankings-build edge function
-- computes every table of a season with the app's own ranking code (src/lib/rankings.ts, via rankingTables.ts)
-- from the season's cached payload (season_rankings_cache, migration 033) and stores them here; pg_cron calls it
-- when a payload is newer than its tables (supabase/cron/ranking_tables.sql). Until a table is stored the pages
-- compute it as before.
--
-- Code version: each table carries the RANKING_CODE_VERSION (src/lib/rankingTables.ts) of the code that built
-- it. The pages pass their own version and get a table only when it matches (else they compute it), so a
-- deploy of changed ranking code never shows tables of the old calculation; the build treats tables of another
-- version as due.
--
-- Visibility: the tables are built only from the cached payload, which is exactly what an anonymous visitor can
-- read (migration 033), so their rows (names, clubs, events, points) are public: anyone reads them. Writes only
-- through store_ranking_tables() / ranking_tables_invalidate(), for the service role (the edge function);
-- nobody writes the table directly.

create table public.ranking_tables (
  season          text not null check (season ~ '^\d{4}-\d{2}$'),
  rank_class      text not null check (rank_class in ('senior', 'U21', 'U19', 'U17')),
  gender          text not null check (gender in ('male', 'female')),
  discipline      text not null check (discipline in ('boulder', 'lead')),
  rows            jsonb not null check (jsonb_typeof(rows) = 'array'),
  meta            jsonb not null check (jsonb_typeof(meta) = 'object'),
  -- built_at of the season_rankings_cache payload the table was computed from ('-infinity': due again)
  source_built_at timestamptz not null,
  -- RANKING_CODE_VERSION of the code that computed it
  code_version    int not null check (code_version > 0),
  built_at        timestamptz not null default now(),
  primary key (season, rank_class, gender, discipline)
);
alter table public.ranking_tables enable row level security;
create policy ranking_tables_read on public.ranking_tables for select to anon, authenticated using (true);
revoke all on public.ranking_tables from anon, authenticated, service_role;
grant select on public.ranking_tables to anon, authenticated;

-- The seasons whose stored tables are missing, from an older payload, or from another code version (p_version:
-- the caller's; null = the newest version stored, as pg_cron asks), newest season first. Definer: the cache is
-- closed (migration 033). Called by pg_cron (as postgres, to decide whether to call the function) and by the
-- edge function (service role).
create function public.ranking_tables_due(p_version int default null) returns table (season text)
  language sql stable security definer set search_path = public as $$
  with v as (select coalesce(p_version, (select max(t.code_version) from public.ranking_tables t)) as version)
  select c.season from public.season_rankings_cache c, v
  where not exists (select 1 from public.ranking_tables t
                    where t.season = c.season and t.source_built_at >= c.built_at and t.code_version = v.version)
  order by c.season desc;
$$;

-- Every stored season due again ({"all": true}); the tables stay served until rebuilt.
create function public.ranking_tables_invalidate() returns void
  language sql security definer set search_path = public as $$
  update public.ranking_tables set source_built_at = '-infinity';
$$;

-- A season's cached payload with its built_at (one statement: the two belong together), or null.
create function public.ranking_tables_input(p_season text) returns json
  language sql stable security definer set search_path = public as $$
  select json_build_object('payload', c.payload, 'built_at', c.built_at) from public.season_rankings_cache c where c.season = p_season;
$$;

-- Replaces a season's tables with the ones built from the payload of p_source_built_at by code p_code_version.
-- false (and nothing changed) when the stored tables come from a newer payload, or from the same or a newer
-- payload by a newer code version (two builds racing, or an old deployment still running).
create function public.store_ranking_tables(p_season text, p_source_built_at timestamptz, p_code_version int, p_tables jsonb)
  returns boolean language plpgsql security definer set search_path = public as $$
begin
  if jsonb_typeof(p_tables) is distinct from 'array' then
    raise exception 'p_tables must be an array' using errcode = 'check_violation';
  end if;
  if p_source_built_at is null or coalesce(p_code_version, 0) < 1 then
    raise exception 'p_source_built_at and a code version (>= 1) are required' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.store_ranking_tables'), hashtext(p_season));
  if exists (select 1 from ranking_tables where season = p_season
             and (source_built_at > p_source_built_at
                  or (source_built_at >= p_source_built_at and code_version > p_code_version))) then
    return false;
  end if;
  delete from ranking_tables where season = p_season;
  insert into ranking_tables (season, rank_class, gender, discipline, rows, meta, source_built_at, code_version)
  select p_season, t ->> 'rank_class', t ->> 'gender', t ->> 'discipline', t -> 'rows', t -> 'meta', p_source_built_at, p_code_version
  from jsonb_array_elements(p_tables) t;
  return true;
end $$;

revoke execute on function public.ranking_tables_due(int), public.ranking_tables_invalidate(), public.ranking_tables_input(text),
  public.store_ranking_tables(text, timestamptz, int, jsonb) from public, anon, authenticated;
grant execute on function public.ranking_tables_due(int), public.ranking_tables_invalidate(), public.ranking_tables_input(text),
  public.store_ranking_tables(text, timestamptz, int, jsonb) to service_role;

-- The rankings page in one request: the seasons with ranked competitions (newest first, from p_first_season;
-- what the page listed before, under the caller's RLS), the season shown (p_season, else the newest) and its
-- stored table of the caller's code version p_version (null when not stored: the page computes it).
-- Invoker: reads only what the caller may.
create function public.ranking_page(p_version int, p_first_season text, p_season text, p_class text, p_gender text, p_discipline text)
  returns json language sql stable security invoker set search_path = public as $$
  with s as (select distinct co.season from public.competitions co
             where co.series <> 'other' and co.season >= p_first_season),
       cur as (select coalesce(p_season, (select max(season) from s)) as season)
  select json_build_object(
    'seasons', coalesce((select json_agg(s.season order by s.season desc) from s), '[]'::json),
    'season', (select season from cur),
    'table', (select json_build_object('rows', t.rows, 'meta', t.meta)
              from public.ranking_tables t, cur
              where t.season = cur.season and t.rank_class = p_class and t.gender = p_gender and t.discipline = p_discipline
                and t.code_version = p_version));
$$;
grant execute on function public.ranking_page(int, text, text, text, text, text) to anon, authenticated;

-- Home's ranking section: the top of the stored senior tables (code version p_version) of the given seasons
-- (rank <= p_top, ties included). A season missing from the result has no tables of that version stored.
create function public.home_rankings(p_version int, p_seasons text[], p_top int default 3)
  returns table (season text, gender text, discipline text, rows jsonb)
  language sql stable security invoker set search_path = public as $$
  select t.season, t.gender, t.discipline,
         coalesce((select jsonb_agg(r order by ord) from jsonb_array_elements(t.rows) with ordinality x(r, ord)
                   where (r ->> 'rank')::int <= p_top), '[]'::jsonb)
  from public.ranking_tables t
  where t.season = any(p_seasons) and t.rank_class = 'senior' and t.code_version = p_version
  order by t.season, t.discipline, t.gender;
$$;
grant execute on function public.home_rankings(int, text[], int) to anon, authenticated;
