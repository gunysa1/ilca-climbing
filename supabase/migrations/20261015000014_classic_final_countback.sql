-- Classic (T/Z) rounds: in a final, countback to the previous-round place breaks ties left after
-- tops, zones and attempts. Matches how LogLig ranked the older totals-only rounds (10,775 of 10,828
-- imported ranks identical with it, 10,755 without; countback in every round: 10,731) and ILCA's
-- published 2024-25 youth rankings. Mirrors src/lib/scoring.ts (isFinal).

create or replace view public.round_scores with (security_invoker = true) as
with totals as (
  select s.climber_id, r.id as round_id, r.scoring, r.kind,
         coalesce(rt.tops, count(br.top_attempt))                      as tops,
         coalesce(rt.zones, count(br.zone_attempt))                    as zones,
         coalesce(rt.top_attempts, coalesce(sum(br.top_attempt), 0))   as top_attempts,
         coalesce(rt.zone_attempts, coalesce(sum(br.zone_attempt), 0)) as zone_attempts,
         coalesce(sum(public.boulder_points(br.zone_attempt, br.top_attempt)), 0)::numeric(6,1) as points,
         s.prev_place::bigint                                          as prev_rank,
         rt.round_id is not null or coalesce(sum(br.attempts), 0) > 0 as climbed,
         s.group_label
  from public.rounds r
  join public.round_starters s on s.round_id = r.id
  left join public.boulder_results br on br.round_id = r.id and br.climber_id = s.climber_id
  left join public.round_totals rt on rt.round_id = r.id and rt.climber_id = s.climber_id
  where r.scoring::text in ('ifsc2025', 'classic')
  group by s.climber_id, r.id, r.scoring, r.kind, s.prev_place, s.group_label,
           rt.round_id, rt.tops, rt.zones, rt.top_attempts, rt.zone_attempts
)
select climber_id, round_id, scoring, tops, zones, top_attempts, zone_attempts, points,
       case when not climbed then null
            when scoring = 'ifsc2025' then rank() over (partition by round_id, group_label, climbed
              order by points desc, prev_rank asc nulls last, top_attempts asc, zone_attempts asc)
            else rank() over (partition by round_id, group_label, climbed
              order by tops desc, zones desc, top_attempts asc, zone_attempts asc,
                       case when kind = 'final' then prev_rank end asc nulls last)
       end as rank,
       prev_rank,
       group_label
from totals;
