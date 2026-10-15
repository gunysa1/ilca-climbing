-- Fast ranks. Postgres cannot push a filter into lead_scores (window functions over every lead round),
-- so every read computed all of them: ~3 s on the live project with the LogLig history, over the API's
-- statement timeout (climber pages, rankings). The lead calculation now lives in lead_scores_for(rounds)
-- (lead_scores is that function over all rounds, so there is still one definition), and readers ask
-- for the rounds they need:
--  * round_ranks_for(rounds)        ranks of the given rounds (boulder via round_scores, which does push down)
--  * climber_history_for(climbers)  climber_history rows of the given climbers
--  * season_ranking_rounds(season)  ranking_rounds rows of a season
-- All security invoker: RLS applies to the caller exactly as with the views.

create function public.lead_scores_for(p_rounds uuid[])
returns table (climber_id uuid, round_id uuid, n_routes bigint, points numeric, rank bigint, prev_rank bigint, group_label text)
  language sql stable security invoker set search_path = public as $$
with rounds_l as (
  select r.id as round_id, r.kind = 'final' and r.time_tiebreak as is_final,
         (select count(*) from public.boulders b where b.round_id = r.id) as n_routes
  from public.rounds r where r.scoring::text = 'lead' and (p_rounds is null or r.id = any(p_rounds))
),
climbed as (
  select s.round_id, s.climber_id, s.prev_place, s.group_label
  from public.round_starters s join rounds_l rl on rl.round_id = s.round_id
  where exists (select 1 from public.lead_results x where x.round_id = s.round_id and x.climber_id = s.climber_id)
),
heights as (
  select c.round_id, c.climber_id, c.group_label, b.id as route_id, lr.time_ms,
         coalesce(case when lr.top then 1000000 else lr.hold * 2 + (case when lr.plus then 1 else 0 end) end, 0) as hv
  from climbed c
  join public.boulders b on b.round_id = c.round_id
  left join public.lead_results lr on lr.boulder_id = b.id and lr.climber_id = c.climber_id
),
route_points as (  -- groups climb separately: route ranks within the group
  select h.*, rank() over (partition by route_id, group_label order by hv desc)
              + (count(*) over (partition by route_id, group_label, hv) - 1) / 2.0 as pts
  from heights h
),
scored as (
  select c.round_id, c.climber_id, c.prev_place, c.group_label, rl.n_routes,
         case when rl.n_routes = 1 then max(rp.hv)::numeric
              else round(exp(avg(ln(rp.pts)))::numeric, 9) end as points,
         case when rl.n_routes = 1 and rl.is_final then max(rp.time_ms) end as time_ms
  from climbed c
  join rounds_l rl on rl.round_id = c.round_id
  join route_points rp on rp.round_id = c.round_id and rp.climber_id = c.climber_id
  group by c.round_id, c.climber_id, c.prev_place, c.group_label, rl.n_routes, rl.is_final
)
select s.climber_id, rl.round_id, rl.n_routes,
       sc.points,
       case when sc.climber_id is null then null else
         rank() over (partition by rl.round_id, s.group_label, sc.climber_id is null
           order by case when rl.n_routes = 1 then -sc.points else sc.points end,
                    sc.prev_place asc nulls last, sc.time_ms asc nulls last)
       end as rank,
       s.prev_place::bigint as prev_rank,
       s.group_label
from rounds_l rl
join public.round_starters s on s.round_id = rl.round_id
left join scored sc on sc.round_id = s.round_id and sc.climber_id = s.climber_id
$$;

create or replace view public.lead_scores with (security_invoker = true) as
select * from public.lead_scores_for(null);

create function public.round_ranks_for(p_rounds uuid[])
returns table (round_id uuid, climber_id uuid, rank bigint, group_label text)
  language sql stable security invoker set search_path = public as $$
  select s.round_id, s.climber_id, s.rank, s.group_label from public.round_scores s where s.round_id = any(p_rounds)
  union all
  select l.round_id, l.climber_id, l.rank, l.group_label from public.lead_scores_for(p_rounds) l;
$$;

create function public.climber_history_for(p_climbers uuid[])
returns setof public.climber_history
  language plpgsql stable security invoker set search_path = public as $$
declare ids uuid[];
begin
  select array_agg(distinct s.round_id) into ids from public.round_starters s where s.climber_id = any(p_climbers);
  return query
  select x.climber_id, co.id, co.name, co.name_he, co.starts_on, c.name, c.name_he, r.kind, r.status,
         x.tops, x.zones, x.top_attempts, x.zone_attempts, x.points::numeric(6,1), x.rank,
         (select count(*) from public.round_starters s2 where s2.round_id = r.id), r.scoring::text, r.id
  from (
    select sc.climber_id, sc.round_id, sc.tops, sc.zones, sc.top_attempts, sc.zone_attempts, sc.points, sc.rank
    from public.round_scores sc where sc.round_id = any(ids) and sc.climber_id = any(p_climbers)
    union all
    select l.climber_id, l.round_id, null, null, null, null, null, l.rank
    from public.lead_scores_for(ids) l where l.climber_id = any(p_climbers)
  ) x
  join public.rounds r        on r.id = x.round_id
  join public.categories c    on c.id = r.category_id
  join public.competitions co on co.id = c.competition_id;
end $$;

create function public.season_ranking_rounds(p_season text)
returns setof public.ranking_rounds
  language plpgsql stable security invoker set search_path = public as $$
declare ids uuid[];
begin
  select array_agg(r.id) into ids
  from public.rounds r join public.categories c on c.id = r.category_id join public.competitions co on co.id = c.competition_id
  where co.season = p_season and co.series <> 'other' and r.status <> 'planned';
  return query
  select co.id, coalesce(co.name_he, co.name), co.starts_on, co.season, co.series,
         case when r.scoring::text = 'lead' then 'lead' else 'boulder' end,
         c.id, coalesce(c.name_he, c.name), c.gender, r.kind, rr.climber_id, rr.rank
  from public.round_ranks_for(ids) rr
  join public.rounds r        on r.id = rr.round_id
  join public.categories c    on c.id = r.category_id
  join public.competitions co on co.id = c.competition_id
  order by co.id, c.id, r.kind, rr.climber_id;
end $$;

grant execute on function public.lead_scores_for(uuid[]), public.round_ranks_for(uuid[]),
  public.climber_history_for(uuid[]), public.season_ranking_rounds(text) to anon, authenticated;

-- start lists read only the previous round's ranks
create or replace function public.generate_start_list(p_round uuid) returns int
  language plpgsql security invoker set search_path = public as $$
declare prev uuid; quota int; cat uuid; n int; groups int;
begin
  select category_id, advance_quota into cat, quota from rounds where id = p_round;
  if cat is null then raise exception 'unknown round %', p_round; end if;
  if exists (select 1 from boulder_results where round_id = p_round)
     or exists (select 1 from lead_results where round_id = p_round) then
    raise exception 'round already has results; correct them instead of regenerating the start list';
  end if;
  prev := public.previous_round(p_round);
  delete from round_starters where round_id = p_round;
  if prev is null then
    insert into round_starters (round_id, climber_id, start_order)
    select p_round, climber_id, row_number() over (order by bib nulls last, climber_id)
    from registrations where category_id = cat;
  else
    select greatest(count(distinct coalesce(group_label, '')), 1) into groups from public.round_ranks_for(array[prev]);
    insert into round_starters (round_id, climber_id, start_order, prev_place)
    select p_round, climber_id, row_number() over (order by rank desc, group_label nulls first, climber_id), rank
    from public.round_ranks_for(array[prev])
    where rank is not null and (quota is null or rank <= ceil(quota::numeric / groups));
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
