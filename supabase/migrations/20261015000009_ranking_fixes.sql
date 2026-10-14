-- Ranking fixes found by comparing imported LogLig history with LogLig's own ranks (2026-10-15):
--  * Boulder: starters without any attempt are unranked (rank null), like the results page and
--    lead_scores. They no longer advance or show a rank in history.
--  * Lead: on a single-route round, after countback the faster climbing time ranks higher
--    (IFSC final rule; LogLig applied it in the 2026 Israeli lead final). Mirrors src/lib/lead.ts.

create or replace view public.round_scores with (security_invoker = true) as
with totals as (
  select s.climber_id, r.id as round_id, r.scoring,
         count(br.top_attempt)                              as tops,
         count(br.zone_attempt)                             as zones,
         coalesce(sum(br.top_attempt), 0)                   as top_attempts,
         coalesce(sum(br.zone_attempt), 0)                  as zone_attempts,
         coalesce(sum(public.boulder_points(br.zone_attempt, br.top_attempt)), 0)::numeric(6,1) as points,
         s.prev_place::bigint                               as prev_rank,
         coalesce(sum(br.attempts), 0) > 0                  as climbed
  from public.rounds r
  join public.round_starters s on s.round_id = r.id
  left join public.boulder_results br on br.round_id = r.id and br.climber_id = s.climber_id
  where r.scoring::text in ('ifsc2025', 'classic')
  group by s.climber_id, r.id, r.scoring, s.prev_place
)
select climber_id, round_id, scoring, tops, zones, top_attempts, zone_attempts, points,
       case when not climbed then null
            when scoring = 'ifsc2025' then rank() over (partition by round_id, climbed
              order by points desc, prev_rank asc nulls last, top_attempts asc, zone_attempts asc)
            else rank() over (partition by round_id, climbed
              order by tops desc, zones desc, top_attempts asc, zone_attempts asc)
       end as rank,
       prev_rank
from totals;

create or replace view public.lead_scores with (security_invoker = true) as
with rounds_l as (
  select r.id as round_id, (select count(*) from public.boulders b where b.round_id = r.id) as n_routes
  from public.rounds r where r.scoring::text = 'lead'
),
climbed as (
  select s.round_id, s.climber_id, s.prev_place
  from public.round_starters s join rounds_l rl on rl.round_id = s.round_id
  where exists (select 1 from public.lead_results x where x.round_id = s.round_id and x.climber_id = s.climber_id)
),
heights as (
  select c.round_id, c.climber_id, b.id as route_id, lr.time_ms,
         coalesce(case when lr.top then 1000000 else lr.hold * 2 + (case when lr.plus then 1 else 0 end) end, 0) as hv
  from climbed c
  join public.boulders b on b.round_id = c.round_id
  left join public.lead_results lr on lr.boulder_id = b.id and lr.climber_id = c.climber_id
),
route_points as (
  select h.*, rank() over (partition by route_id order by hv desc)
              + (count(*) over (partition by route_id, hv) - 1) / 2.0 as pts
  from heights h
),
scored as (
  select c.round_id, c.climber_id, c.prev_place, rl.n_routes,
         case when rl.n_routes = 1 then max(rp.hv)::numeric
              else round(exp(avg(ln(rp.pts)))::numeric, 9) end as points,
         case when rl.n_routes = 1 then max(rp.time_ms) end as time_ms
  from climbed c
  join rounds_l rl on rl.round_id = c.round_id
  join route_points rp on rp.round_id = c.round_id and rp.climber_id = c.climber_id
  group by c.round_id, c.climber_id, c.prev_place, rl.n_routes
)
select s.climber_id, rl.round_id, rl.n_routes,
       sc.points,
       case when sc.climber_id is null then null else
         rank() over (partition by rl.round_id, sc.climber_id is null
           order by case when rl.n_routes = 1 then -sc.points else sc.points end,
                    sc.prev_place asc nulls last, sc.time_ms asc nulls last)
       end as rank,
       s.prev_place::bigint as prev_rank
from rounds_l rl
join public.round_starters s on s.round_id = rl.round_id
left join scored sc on sc.round_id = s.round_id and sc.climber_id = s.climber_id;
