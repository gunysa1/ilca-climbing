-- Totals-only boulder rounds: older LogLig boulder results (2020-2025) publish only per-round totals
-- ("2T 3Z 3 5" = tops, zones, attempts to tops, attempts to zones) without per-boulder detail.
-- Such rounds have no boulders; round_scores takes the stored totals instead of summing results.
-- Written by admins only (imports, corrections); readable like boulder_results.

create table public.round_totals (
  round_id      uuid not null,
  climber_id    uuid not null,
  tops          int not null check (tops >= 0),
  zones         int not null check (zones >= 0),  -- old pages can show a top without a zone ("1T 0Z")
  top_attempts  int not null check (top_attempts >= tops),
  zone_attempts int not null check (zone_attempts >= zones),
  primary key (round_id, climber_id),
  foreign key (round_id, climber_id) references public.round_starters (round_id, climber_id) on delete cascade
);

alter table public.round_totals enable row level security;
create policy totals_read on public.round_totals for select
  using (public.round_is_public(round_id) or public.has_role('admin'));
create policy totals_admin on public.round_totals for all
  using (public.has_role('admin')) with check (public.has_role('admin'));
revoke all on public.round_totals from anon, authenticated;
grant select on public.round_totals to anon, authenticated;
grant insert, update, delete on public.round_totals to authenticated;

create or replace view public.round_scores with (security_invoker = true) as
with totals as (
  select s.climber_id, r.id as round_id, r.scoring,
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
  group by s.climber_id, r.id, r.scoring, s.prev_place, s.group_label,
           rt.round_id, rt.tops, rt.zones, rt.top_attempts, rt.zone_attempts
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
