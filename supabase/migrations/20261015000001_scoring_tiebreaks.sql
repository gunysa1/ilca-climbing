-- Scoring tie-breaks, aligned with the temporary ILCA app and IFSC results (docs/reference-analysis.md).
-- Mirrors src/lib/scoring.ts; keep both in sync.
--   ifsc2025: points desc, previous-round rank asc (countback, missing last),
--             top attempts asc, zone attempts asc; remaining ties share a rank.
--   classic:  unchanged (tops, zones, top attempts, zone attempts).

create or replace function public.boulder_points(zone_attempt int, top_attempt int) returns numeric
  language sql immutable as $$
  select greatest(case
    when top_attempt  is not null then 25 - 0.1 * (top_attempt - 1)
    when zone_attempt is not null then 10 - 0.1 * (zone_attempt - 1)
    else 0 end, 0)::numeric(5,1);
$$;

-- Rounds of a category are ordered by kind (qualification < semifinal < final), at most one per kind,
-- so a round is at depth 0, 1 or 2 and its countback round is the latest earlier round.
create or replace view public.round_scores with (security_invoker = true) as
with totals as (
  select g.climber_id, r.id as round_id, r.scoring,
         count(br.top_attempt)                              as tops,
         count(br.zone_attempt)                             as zones,
         coalesce(sum(br.top_attempt), 0)                   as top_attempts,
         coalesce(sum(br.zone_attempt), 0)                  as zone_attempts,
         coalesce(sum(public.boulder_points(br.zone_attempt, br.top_attempt)), 0)::numeric(6,1) as points,
         (select count(*) from public.rounds p
           where p.category_id = r.category_id and p.kind < r.kind)            as depth,
         (select p.id from public.rounds p
           where p.category_id = r.category_id and p.kind < r.kind
           order by p.kind desc limit 1)                                         as prev_round_id
  from public.rounds r
  join public.registrations g on g.category_id = r.category_id
  left join public.boulder_results br on br.round_id = r.id and br.climber_id = g.climber_id
  group by g.climber_id, r.id, r.scoring, r.category_id, r.kind
),
d0 as (
  select t.*, null::bigint as prev_rank from totals t where t.depth = 0
),
r0 as (
  select d0.*, case d0.scoring
    when 'ifsc2025' then rank() over (partition by d0.round_id
      order by d0.points desc, d0.prev_rank asc nulls last, d0.top_attempts asc, d0.zone_attempts asc)
    else rank() over (partition by d0.round_id
      order by d0.tops desc, d0.zones desc, d0.top_attempts asc, d0.zone_attempts asc)
  end as rank from d0
),
d1 as (
  select t.*, p.rank as prev_rank from totals t
  left join r0 p on p.round_id = t.prev_round_id and p.climber_id = t.climber_id
  where t.depth = 1
),
r1 as (
  select d1.*, case d1.scoring
    when 'ifsc2025' then rank() over (partition by d1.round_id
      order by d1.points desc, d1.prev_rank asc nulls last, d1.top_attempts asc, d1.zone_attempts asc)
    else rank() over (partition by d1.round_id
      order by d1.tops desc, d1.zones desc, d1.top_attempts asc, d1.zone_attempts asc)
  end as rank from d1
),
d2 as (
  select t.*, p.rank as prev_rank from totals t
  left join r1 p on p.round_id = t.prev_round_id and p.climber_id = t.climber_id
  where t.depth = 2
),
r2 as (
  select d2.*, case d2.scoring
    when 'ifsc2025' then rank() over (partition by d2.round_id
      order by d2.points desc, d2.prev_rank asc nulls last, d2.top_attempts asc, d2.zone_attempts asc)
    else rank() over (partition by d2.round_id
      order by d2.tops desc, d2.zones desc, d2.top_attempts asc, d2.zone_attempts asc)
  end as rank from d2
)
select climber_id, round_id, scoring, tops, zones, top_attempts, zone_attempts, points, rank, prev_rank
from (select * from r0 union all select * from r1 union all select * from r2) ranked;
