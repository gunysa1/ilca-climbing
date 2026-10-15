-- Qualification groups (IFSC style; LogLig championships used them too): a round's start list can
-- be split into groups (A, B, ...) that are ranked separately. Advancement takes the top
-- ceil(quota / groups) of each group, seeded with the group rank.

alter table public.round_starters add column group_label text;

create or replace view public.round_scores with (security_invoker = true) as
with totals as (
  select s.climber_id, r.id as round_id, r.scoring,
         count(br.top_attempt)                              as tops,
         count(br.zone_attempt)                             as zones,
         coalesce(sum(br.top_attempt), 0)                   as top_attempts,
         coalesce(sum(br.zone_attempt), 0)                  as zone_attempts,
         coalesce(sum(public.boulder_points(br.zone_attempt, br.top_attempt)), 0)::numeric(6,1) as points,
         s.prev_place::bigint                               as prev_rank,
         coalesce(sum(br.attempts), 0) > 0                  as climbed,
         s.group_label
  from public.rounds r
  join public.round_starters s on s.round_id = r.id
  left join public.boulder_results br on br.round_id = r.id and br.climber_id = s.climber_id
  where r.scoring::text in ('ifsc2025', 'classic')
  group by s.climber_id, r.id, r.scoring, s.prev_place, s.group_label
)
select climber_id, round_id, scoring, tops, zones, top_attempts, zone_attempts, points,
       case when not climbed then null
            when scoring = 'ifsc2025' then rank() over (partition by round_id, group_label, climbed
              order by points desc, prev_rank asc nulls last, top_attempts asc, zone_attempts asc)
            else rank() over (partition by round_id, group_label, climbed
              order by tops desc, zones desc, top_attempts asc, zone_attempts asc)
       end as rank,
       prev_rank,
       group_label
from totals;

create or replace view public.lead_scores with (security_invoker = true) as
with rounds_l as (
  select r.id as round_id, (select count(*) from public.boulders b where b.round_id = r.id) as n_routes
  from public.rounds r where r.scoring::text = 'lead'
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
         case when rl.n_routes = 1 then max(rp.time_ms) end as time_ms
  from climbed c
  join rounds_l rl on rl.round_id = c.round_id
  join route_points rp on rp.round_id = c.round_id and rp.climber_id = c.climber_id
  group by c.round_id, c.climber_id, c.prev_place, c.group_label, rl.n_routes
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
left join scored sc on sc.round_id = s.round_id and sc.climber_id = s.climber_id;

create or replace view public.round_ranks with (security_invoker = true) as
select round_id, climber_id, rank, group_label from public.round_scores
union all
select round_id, climber_id, rank, group_label from public.lead_scores;

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
    select greatest(count(distinct coalesce(group_label, '')), 1) into groups from round_ranks where round_id = prev;
    insert into round_starters (round_id, climber_id, start_order, prev_place)
    select p_round, climber_id, row_number() over (order by rank desc, group_label nulls first, climber_id), rank
    from round_ranks
    where round_id = prev and rank is not null and (quota is null or rank <= ceil(quota::numeric / groups));
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
