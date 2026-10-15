-- Public climber page: history rows link to their round.
create or replace view public.climber_history with (security_invoker = true) as
select x.climber_id, co.id as competition_id, co.name as competition, co.name_he as competition_he,
       co.starts_on, c.name as category, c.name_he as category_he, r.kind as round, r.status as round_status,
       x.tops, x.zones, x.top_attempts, x.zone_attempts, x.points::numeric(6,1) as points, x.rank,
       (select count(*) from public.round_starters s2 where s2.round_id = r.id) as starters,
       r.scoring::text as discipline,
       r.id as round_id
from (
  select climber_id, round_id, tops, zones, top_attempts, zone_attempts, points, rank from public.round_scores
  union all
  select climber_id, round_id, null, null, null, null, null, rank from public.lead_scores
) x
join public.rounds r       on r.id = x.round_id
join public.categories c   on c.id = r.category_id
join public.competitions co on co.id = c.competition_id;
