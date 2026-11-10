-- Half holds in lead. The temporary app records a hold with up to two decimals (24.5 for an intermediate hold)
-- and ranks TOP, then the higher hold, then + on the same hold, + counting 0.1 for ranking only: 24+ = 24.1
-- (so "24.5 before 24+, before 24", and a 24.1 hold ties 24+, as there). Mirrors src/lib/lead.ts heightValue;
-- same test cases in src/lib/lead.test.ts and supabase/tests/rls_test.sql ("lead half holds").
--
-- Every place that stores or computes a lead hold:
--   lead_results.hold, lead_events.hold (the audit)       int -> numeric(5,2), still check (hold >= 0); up to 999.99
--   lead_scores_for (latest: 049)                          height = hold + 0.1 for + (was hold * 2 + 1); TOP above all
--   favorites_live (latest: 041)                           "own" text: 24.5+, 24 (trim_scale; numeric text would be 24.00)
--   boulder_results_check_registration (049)               unchanged: compares (hold, plus, top, time_ms) as values
--   lead_results_stamp / lead_events trigger (040)         unchanged: copies new.hold into lead_events (same type now)
--   round_page (049), climber_history_for, round_ranks_for unchanged: holds go out as JSON numbers (24.50 reads as 24.5),
--                                                          the others read lead_scores_for only
-- No view or policy reads the hold column itself (pg_depend), so no view has to be dropped for the type change.
-- Scoring changed: full rankings and climber cache rebuilds are queued at the end (as in 049).

alter table public.lead_results alter column hold type numeric(5,2);
alter table public.lead_events alter column hold type numeric(5,2);

-- ---------------------------------------------------------------------------- scoring
-- Latest definition: 20261110000049; only the height value (hv) changes.
create or replace function public.lead_scores_for(p_rounds uuid[])
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
  where s.status is null
    and exists (select 1 from public.lead_results x where x.round_id = s.round_id and x.climber_id = s.climber_id)
),
heights as (
  select c.round_id, c.climber_id, c.group_label, b.id as route_id, lr.time_ms,
         coalesce(case when lr.top then 1000000 else lr.hold + (case when lr.plus then 0.1 else 0 end) end, 0) as hv
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

-- ---------------------------------------------------------------------------- favorites_live
-- Latest definition: 20261018000041; only the lead "own" text (trim_scale) changes.
create or replace function public.favorites_live(p_climbers uuid[]) returns json
  language plpgsql stable security invoker set search_path = public set jit = off as $$
declare
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  cl uuid[] := coalesce(p_climbers[1:200], '{}');
  ids uuid[];
begin
  -- most of the year nothing is on: answer at once
  if not exists (select 1 from public.competitions co where co.status <> 'draft' and co.ends_on >= today - 1 and co.starts_on <= today + 1)
     and not exists (select 1 from public.rounds r where r.status = 'live') then
    return '[]'::json;
  end if;
  select array_agg(distinct r.id) into ids
  from public.round_starters s
  join public.rounds r on r.id = s.round_id
  join public.categories c on c.id = r.category_id
  join public.competitions co on co.id = c.competition_id
  where s.climber_id = any(cl) and co.status <> 'draft'
    and ((co.ends_on >= today - 1 and co.starts_on <= today + 1)
         or exists (select 1 from public.rounds r2 join public.categories c2 on c2.id = r2.category_id
                    where c2.competition_id = co.id and r2.status = 'live'));
  ids := coalesce(ids, '{}');  -- null would mean "every round" to lead_scores_for
  return coalesce((
    select json_agg(row_to_json(q)) from (
      select x.climber_id, p.full_name, p.full_name_he, co.id as competition_id, co.name as competition, co.name_he as competition_he, co.starts_on,
             c.name as category, c.name_he as category_he, r.kind as round, r.status as round_status,
             x.tops, x.zones, x.top_attempts, x.zone_attempts, x.points::numeric(6,1) as points, x.rank,
             (select count(*) from public.round_starters s2 where s2.round_id = r.id) as starters,
             r.scoring::text as discipline, r.id as round_id,
             not exists (select 1 from public.rounds r3 where r3.category_id = r.category_id
                         and (case r3.kind when 'qualification' then 0 when 'semifinal' then 1 else 2 end)
                           < (case r.kind when 'qualification' then 0 when 'semifinal' then 1 else 2 end)) as first_round,
             case when r.scoring::text = 'lead' then
               (select string_agg(case when lr.top then 'T' else trim_scale(coalesce(lr.hold, 0))::text || case when lr.plus then '+' else '' end end, ',' order by b.number)
                from public.lead_results lr join public.boulders b on b.id = lr.boulder_id
                where lr.round_id = r.id and lr.climber_id = x.climber_id)
             else concat_ws('|', x.tops, x.zones, x.top_attempts, x.zone_attempts) end as own
      from (
        select sc.climber_id, sc.round_id, sc.tops, sc.zones, sc.top_attempts, sc.zone_attempts, sc.points, sc.rank
        from public.round_scores sc where sc.round_id = any(ids) and sc.climber_id = any(cl)
        union all
        select l.climber_id, l.round_id, null, null, null, null, null, l.rank
        from public.lead_scores_for(ids) l where l.climber_id = any(cl)
      ) x
      join public.rounds r on r.id = x.round_id
      join public.categories c on c.id = r.category_id
      join public.competitions co on co.id = c.competition_id
      join public.profiles p on p.id = x.climber_id
    ) q), '[]'::json);
end $$;

-- Scoring changed: rebuild every ranking and climber page.
insert into public.rankings_cache_changes (season) values (null);
insert into public.climber_cache_changes (round_id) values (null);
