-- DNS / DSQ: a climber on a round's start list can be marked "did not start" or "disqualified".
-- round_starters.status: null (climbs), 'dns' or 'dsq'. A marked climber is unranked (rank null, like a climber who
-- never climbed) and the others rank as if the climber were absent, also when results were entered before the mark;
-- generate_start_list() advances only ranked climbers, so they are not advanced; the result triggers refuse new
-- and changed results for them (deleting one stays allowed). Only the admin writes round_starters (starters_admin).
-- The scoring views change, so full cache rebuilds are queued at the end.

alter table public.round_starters add column status text check (status in ('dns', 'dsq'));

-- Results only for climbers on the round's start list, and not for a marked one. The judge pad's offline outbox
-- treats this refusal (check_violation, "climber is marked DNS/DSQ in this round") as final and drops the entry.
create or replace function public.boulder_results_check_registration() returns trigger
  language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select s.status into st from round_starters s where s.round_id = new.round_id and s.climber_id = new.climber_id;
  if not found then
    raise exception 'climber % is not on the start list of this round', new.climber_id;
  end if;
  if st is not null then
    raise exception 'climber is marked DNS/DSQ in this round' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------- scoring
-- Latest definition: 20261015000014 (round_scores), 20261015000017 (lead_scores_for); only "climbed" changes.
create or replace view public.round_scores with (security_invoker = true) as
with totals as (
  select s.climber_id, r.id as round_id, r.scoring, r.kind,
         coalesce(rt.tops, count(br.top_attempt))                      as tops,
         coalesce(rt.zones, count(br.zone_attempt))                    as zones,
         coalesce(rt.top_attempts, coalesce(sum(br.top_attempt), 0))   as top_attempts,
         coalesce(rt.zone_attempts, coalesce(sum(br.zone_attempt), 0)) as zone_attempts,
         coalesce(sum(public.boulder_points(br.zone_attempt, br.top_attempt)), 0)::numeric(6,1) as points,
         s.prev_place::bigint                                          as prev_rank,
         (rt.round_id is not null or coalesce(sum(br.attempts), 0) > 0) and s.status is null as climbed,
         s.group_label
  from public.rounds r
  join public.round_starters s on s.round_id = r.id
  left join public.boulder_results br on br.round_id = r.id and br.climber_id = s.climber_id
  left join public.round_totals rt on rt.round_id = r.id and rt.climber_id = s.climber_id
  where r.scoring::text in ('ifsc2025', 'classic')
  group by s.climber_id, r.id, r.scoring, r.kind, s.prev_place, s.group_label, s.status,
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

-- ---------------------------------------------------------------------------- round_page
-- Latest definition: 20261015000025; the starters now carry their status.
create or replace function public.round_page(p_round uuid) returns jsonb
  language sql stable set search_path = public as $$
  select jsonb_build_object(
    'round', to_jsonb(r),
    'category', jsonb_build_object('id', c.id, 'name', c.name, 'name_he', c.name_he,
      'competition', jsonb_build_object('id', co.id, 'name', co.name, 'name_he', co.name_he)),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c2.id, 'name', c2.name, 'name_he', c2.name_he,
        'rounds', coalesce((select jsonb_agg(jsonb_build_object('id', r2.id, 'kind', r2.kind, 'status', r2.status))
                            from rounds r2 where r2.category_id = c2.id), '[]'::jsonb)) order by c2.name)
      from categories c2 where c2.competition_id = co.id), '[]'::jsonb),
    'boulders', coalesce((select jsonb_agg(to_jsonb(b) order by b.number) from boulders b where b.round_id = r.id), '[]'::jsonb),
    'starters', coalesce((
      select jsonb_agg(jsonb_build_object('climber_id', s.climber_id, 'start_order', s.start_order,
        'prev_place', s.prev_place, 'group_label', s.group_label, 'status', s.status, 'bib', g.bib, 'age_class', g.age_class,
        'profile', jsonb_build_object('id', p.id, 'full_name', p.full_name, 'full_name_he', p.full_name_he,
                                      'club', p.club, 'country', p.country)))
      from round_starters s
      join profiles p on p.id = s.climber_id
      left join registrations g on g.category_id = r.category_id and g.climber_id = s.climber_id
      where s.round_id = r.id), '[]'::jsonb),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object('boulder_id', x.boulder_id, 'climber_id', x.climber_id, 'round_id', x.round_id,
        'attempts', x.attempts, 'zone_attempt', x.zone_attempt, 'top_attempt', x.top_attempt,
        'locked', x.locked, 'updated_at', x.updated_at))
      from boulder_results x where x.round_id = r.id), '[]'::jsonb),
    'lead_results', coalesce((
      select jsonb_agg(jsonb_build_object('boulder_id', x.boulder_id, 'climber_id', x.climber_id, 'round_id', x.round_id,
        'hold', x.hold, 'plus', x.plus, 'top', x.top, 'time_ms', x.time_ms, 'locked', x.locked, 'updated_at', x.updated_at))
      from lead_results x where x.round_id = r.id), '[]'::jsonb),
    'totals', coalesce((
      select jsonb_agg(jsonb_build_object('round_id', x.round_id, 'climber_id', x.climber_id, 'tops', x.tops,
        'zones', x.zones, 'top_attempts', x.top_attempts, 'zone_attempts', x.zone_attempts))
      from round_totals x where x.round_id = r.id), '[]'::jsonb),
    'appeals', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'boulder_id', a.boulder_id, 'climber_id', a.climber_id, 'status', a.status))
      from appeals a where a.round_id = r.id), '[]'::jsonb))
  from rounds r
  join categories c on c.id = r.category_id
  join competitions co on co.id = c.competition_id
  where r.id = p_round;
$$;

-- ---------------------------------------------------------------------------- admin_log
-- Marking a starter is logged (updates only: inserts and deletes come from imports and start-list generation).
-- row_id of a round_starters row is "round_id:climber_id".
alter table public.admin_log drop constraint admin_log_table_name_check;
alter table public.admin_log add constraint admin_log_table_name_check
  check (table_name in ('competitions', 'categories', 'rounds', 'judge_assignments', 'user_roles', 'appeals', 'round_starters'));

create or replace function private.admin_log_write() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  ch jsonb;
  rid uuid;
  cid uuid;
  cascaded boolean;
begin
  -- Deleted with its parent (the cascade): the parent is gone by now. pg_trigger_depth() cannot tell, since the
  -- foreign keys' cascades queue their rows' triggers on the outer statement.
  if tg_op = 'DELETE' then
    cascaded := case tg_table_name
      when 'categories' then not exists (select 1 from competitions where id = (r ->> 'competition_id')::uuid)
      when 'rounds' then not exists (select 1 from categories where id = (r ->> 'category_id')::uuid)
      when 'judge_assignments' then not exists (select 1 from rounds where id = (r ->> 'round_id')::uuid)
      when 'appeals' then not exists (select 1 from rounds where id = (r ->> 'round_id')::uuid)
      else false end;
    if cascaded then return null; end if;
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(e.key, jsonb_build_array(o -> e.key, e.value)), '{}'::jsonb) into ch
    from jsonb_each(n) e where e.value is distinct from o -> e.key;
    if ch = '{}'::jsonb then return null; end if;
  else
    ch := r;
  end if;
  rid := case tg_table_name when 'rounds' then (r ->> 'id')::uuid
                            when 'competitions' then null when 'categories' then null when 'user_roles' then null
                            else (r ->> 'round_id')::uuid end;
  cid := case tg_table_name
           when 'competitions' then (r ->> 'id')::uuid
           when 'categories' then (r ->> 'competition_id')::uuid
           when 'rounds' then (select c.competition_id from categories c where c.id = (r ->> 'category_id')::uuid)
           when 'user_roles' then null
           else (select c.competition_id from rounds x join categories c on c.id = x.category_id where x.id = rid) end;
  insert into admin_log (actor_id, table_name, row_id, action, changes, competition_id, round_id)
  values (public.my_profile_id(), tg_table_name,
          coalesce(r ->> 'id', (r ->> 'user_id') || ':' || (r ->> 'role'),
                   (r ->> 'round_id') || ':' || (r ->> 'climber_id')), lower(tg_op), ch, cid, rid);
  return null;
end $$;
create trigger admin_log after update on public.round_starters
  for each row execute function private.admin_log_write();

-- ---------------------------------------------------------------------------- caches
-- Scoring changed: rebuild every ranking and climber page.
insert into public.rankings_cache_changes (season) values (null);
insert into public.climber_cache_changes (round_id) values (null);
