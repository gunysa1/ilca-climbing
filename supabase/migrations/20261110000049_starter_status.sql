-- DNS / DSQ: a climber on a round's start list can be marked "did not start" or "disqualified".
-- round_starters.status: null (climbs), 'dns' or 'dsq'. A marked climber is unranked (rank null, like a climber who
-- never climbed) and the others rank as if the climber were absent, also when results were entered before the mark;
-- generate_start_list() advances only ranked climbers, so they are not advanced; the result triggers refuse new
-- and changed results for them (deleting one stays allowed). Only the admin writes round_starters (starters_admin).
-- The scoring views change, so full cache rebuilds are queued at the end.

alter table public.round_starters add column status text check (status in ('dns', 'dsq'));

-- Results only for climbers on the round's start list, and not for a marked one. The judge pad's offline outbox
-- treats this refusal (check_violation, "climber is marked DNS/DSQ in this round") as final and drops the entry.
-- A marked climber's row may still change in its bookkeeping (updated_by, locked, updated_at, climber_id when
-- profiles are merged): the refusal applies on insert and on an update of the result columns.
create or replace function public.boulder_results_check_registration() returns trigger
  language plpgsql security definer set search_path = public as $$
declare st text; changed boolean;
begin
  select s.status into st from round_starters s where s.round_id = new.round_id and s.climber_id = new.climber_id;
  if not found then
    raise exception 'climber % is not on the start list of this round', new.climber_id;
  end if;
  if st is not null then
    if tg_op = 'INSERT' then changed := true;
    elsif tg_table_name = 'boulder_results' then
      changed := (new.attempts, new.zone_attempt, new.top_attempt) is distinct from (old.attempts, old.zone_attempt, old.top_attempt);
    else
      changed := (new.hold, new.plus, new.top, new.time_ms) is distinct from (old.hold, old.plus, old.top, old.time_ms);
    end if;
    if changed then
      raise exception 'climber is marked DNS/DSQ in this round' using errcode = 'check_violation';
    end if;
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

-- ---------------------------------------------------------------------------- merge_profiles
-- Latest definition: 20261018000040; the duplicate's start-list rows are copied with their status.
create or replace function public.merge_profiles(p_keep uuid, p_drop uuid, p_apply boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  k profiles;
  d profiles;
  kp profile_private;
  dp profile_private;
  r record;
  ix record;
  n bigint;
  hit boolean;
  cond text;
  moves jsonb := '{}';
  diffs jsonb := '[]';
  conflicts jsonb := '[]';
  report jsonb;
  total bigint := 0;
  me uuid := public.my_profile_id();
begin
  if not public.has_role('admin') then
    raise exception 'only admins merge profiles' using errcode = 'insufficient_privilege';
  end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'pick two different profiles';
  end if;
  if p_apply then
    perform 1 from profiles where id in (p_keep, p_drop) order by id for update;
  end if;
  select * into k from profiles where id = p_keep;
  if not found then raise exception 'unknown profile %', p_keep; end if;
  select * into d from profiles where id = p_drop;
  if not found then raise exception 'unknown profile %', p_drop; end if;
  select * into kp from profile_private where id = p_keep;
  select * into dp from profile_private where id = p_drop;

  -- What moves
  for r in select * from private.profile_refs() loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into n using p_drop;
    if n > 0 then moves := moves || jsonb_build_object(r.tbl::text || '.' || r.col, n); total := total + n; end if;
  end loop;

  -- How the profiles differ: [{field, keep, drop, result}]
  select coalesce(jsonb_agg(jsonb_build_object('field', f, 'keep', kv, 'drop', dv, 'result', coalesce(kv, dv)) order by o), '[]')
  into diffs
  from (values
      (1, 'full_name', k.full_name, d.full_name),
      (2, 'full_name_he', k.full_name_he, d.full_name_he),
      (3, 'gender', k.gender::text, d.gender::text),
      (4, 'club', k.club, d.club),
      (5, 'country', k.country, d.country),
      (6, 'ifsc_id', k.ifsc_id, d.ifsc_id),
      (7, 'login', (select email from auth.users where id = k.user_id), (select email from auth.users where id = d.user_id)),
      (8, 'birth_date', kp.birth_date::text, dp.birth_date::text),
      (9, 'phone', kp.phone, dp.phone),
      (10, 'email', kp.email, dp.email),
      (11, 'emergency_contact', kp.emergency_contact, dp.emergency_contact),
      (12, 'medical_notes', kp.medical_notes, dp.medical_notes)) v (o, f, kv, dv)
  where kv is distinct from dv;

  -- Conflicts: [{kind, text, ...names}]
  if k.user_id is not null and d.user_id is not null then
    conflicts := conflicts || jsonb_build_object('kind', 'two_logins', 'text', 'both profiles are linked to a login');
  end if;
  if k.ifsc_id is not null and d.ifsc_id is not null and k.ifsc_id <> d.ifsc_id then
    conflicts := conflicts || jsonb_build_object('kind', 'different_ifsc', 'text',
      format('different IFSC ids (%s, %s)', k.ifsc_id, d.ifsc_id), 'keep', k.ifsc_id, 'drop', d.ifsc_id);
  end if;
  conflicts := conflicts || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'round', 'text', format('both climbed %s, %s, %s', co.name, c.name, ro.kind),
             'competition', co.name, 'competition_he', co.name_he, 'category', c.name, 'category_he', c.name_he,
             'round', ro.kind) order by co.starts_on, c.name, ro.kind)
    from rounds ro join categories c on c.id = ro.category_id join competitions co on co.id = c.competition_id
    where ro.id in (
      select a.round_id from round_starters a join round_starters b using (round_id)
        where a.climber_id = p_keep and b.climber_id = p_drop
      union select a.round_id from boulder_results a join boulder_results b using (round_id)
        where a.climber_id = p_keep and b.climber_id = p_drop
      union select a.round_id from lead_results a join lead_results b using (round_id)
        where a.climber_id = p_keep and b.climber_id = p_drop)), '[]');
  conflicts := conflicts || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'registration', 'text', format('both are registered in %s, %s', co.name, c.name),
             'competition', co.name, 'competition_he', co.name_he, 'category', c.name, 'category_he', c.name_he)
             order by co.starts_on, c.name)
    from registrations a join registrations b using (category_id)
    join categories c on c.id = a.category_id join competitions co on co.id = c.competition_id
    where a.climber_id = p_keep and b.climber_id = p_drop), '[]');
  conflicts := conflicts || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'international', 'text', format('both have a result for %s (%s)', b.event_name, b.starts_on),
             'event', b.event_name, 'date', b.starts_on, 'season', b.season, 'discipline', b.discipline) order by b.starts_on)
    from international_results a join international_results b
      on (a.ifsc_event_id = b.ifsc_event_id and a.ifsc_dcat_id = b.ifsc_dcat_id)
      or (a.season = b.season and a.discipline = b.discipline and a.starts_on = b.starts_on
          and private.profile_name_key(a.event_name) = private.profile_name_key(b.event_name))
    where a.climber_id = p_keep and b.climber_id = p_drop), '[]');
  conflicts := conflicts || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'world_ranking', 'text', format('both have a world ranking for %s %s', b.season, b.discipline),
             'season', b.season, 'discipline', b.discipline) order by b.season, b.discipline)
    from world_rankings a join world_rankings b using (season, discipline)
    where a.climber_id = p_keep and b.climber_id = p_drop), '[]');
  conflicts := conflicts || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'live_round', 'text', format('%s is on the start list of a live round: %s, %s, %s',
             p.full_name, co.name, c.name, ro.kind), 'name', p.full_name, 'competition', co.name, 'competition_he', co.name_he,
             'category', c.name, 'category_he', c.name_he, 'round', ro.kind) order by co.starts_on, c.name, ro.kind)
    from round_starters s join profiles p on p.id = s.climber_id
    join rounds ro on ro.id = s.round_id join categories c on c.id = ro.category_id join competitions co on co.id = c.competition_id
    where s.climber_id in (p_keep, p_drop) and ro.status = 'live'), '[]');
  conflicts := conflicts || coalesce((
    select jsonb_agg(distinct jsonb_build_object('kind', 'live_judge', 'text', format('%s judges a live round: %s, %s, %s',
             p.full_name, co.name, c.name, ro.kind), 'name', p.full_name, 'competition', co.name, 'competition_he', co.name_he,
             'category', c.name, 'category_he', c.name_he, 'round', ro.kind))
    from judge_assignments j join profiles p on p.id = j.judge_id
    join rounds ro on ro.id = j.round_id join categories c on c.id = ro.category_id join competitions co on co.id = c.competition_id
    where j.judge_id in (p_keep, p_drop) and ro.status = 'live'), '[]');
  -- Any other unique key that would collide (tables handled above or below are left out).
  for r in select * from private.profile_refs() where fk and tbl not in (
      'public.registrations'::regclass, 'public.round_starters'::regclass, 'public.boulder_results'::regclass,
      'public.lead_results'::regclass, 'public.world_rankings'::regclass, 'public.coach_athletes'::regclass,
      'public.judge_assignments'::regclass, 'public.judge_claims'::regclass, 'public.ifsc_dismissed'::regclass,
      'public.profile_private'::regclass, 'public.profile_not_duplicates'::regclass) loop
    for ix in
      select i.indexrelid, i.indkey::int2[] as keys, i.indnullsnotdistinct as nnd
      from pg_index i join pg_attribute a on a.attrelid = r.tbl and a.attname = r.col
      where i.indrelid = r.tbl and i.indisunique and i.indpred is null and a.attnum = any(i.indkey::int2[])
        and not 0 = any(i.indkey::int2[])
    loop
      select coalesce(string_agg(format(case when ix.nnd then 'k.%1$I is not distinct from x.%1$I' else 'k.%1$I = x.%1$I' end,
               a.attname), ' and '), 'true')
      into cond
      from unnest(ix.keys) u (attnum) join pg_attribute a on a.attrelid = r.tbl and a.attnum = u.attnum
      where a.attname <> r.col;
      execute format('select exists (select 1 from %1$s x join %1$s k on %2$s where x.%3$I = $1 and k.%3$I = $2)', r.tbl, cond, r.col)
        into hit using p_drop, p_keep;
      if hit then
        conflicts := conflicts || jsonb_build_object('kind', 'unique', 'text',
          format('%s: both have a row with the same %s', r.tbl, ix.indexrelid::regclass), 'table', r.tbl::text);
      end if;
    end loop;
  end loop;

  report := jsonb_build_object(
    'keep', jsonb_build_object('id', k.id, 'full_name', k.full_name, 'club', k.club, 'birth_year', extract(year from kp.birth_date)),
    'drop', jsonb_build_object('id', d.id, 'full_name', d.full_name, 'club', d.club, 'birth_year', extract(year from dp.birth_date)),
    'moves', moves, 'rows', total, 'differences', diffs, 'conflicts', conflicts, 'applied', false);
  if not p_apply then return report; end if;
  if jsonb_array_length(conflicts) > 0 then
    raise exception 'cannot merge: %', (select string_agg(x ->> 'text', '; ') from jsonb_array_elements(conflicts) x)
      using detail = conflicts::text;
  end if;

  -- The stamp and ifsc_id triggers stand aside only with both the setting and this transaction's mark.
  perform set_config('ilca.merging', 'on', true);
  insert into private.merge_marks values (txid_current());

  -- The profile: the login and IFSC id leave the duplicate first (both are unique), then keep's empty fields fill.
  update profiles set user_id = null, ifsc_id = null where id = p_drop;
  update profiles set full_name_he = coalesce(k.full_name_he, d.full_name_he), gender = coalesce(k.gender, d.gender),
    club = coalesce(k.club, d.club), ifsc_id = coalesce(k.ifsc_id, d.ifsc_id), user_id = coalesce(k.user_id, d.user_id)
  where id = p_keep;
  if dp.id is not null then
    insert into profile_private (id, birth_date, phone, emergency_contact, medical_notes, email)
    values (p_keep, dp.birth_date, dp.phone, dp.emergency_contact, dp.medical_notes, dp.email)
    on conflict (id) do update set
      birth_date = coalesce(profile_private.birth_date, excluded.birth_date),
      phone = coalesce(profile_private.phone, excluded.phone),
      emergency_contact = coalesce(profile_private.emergency_contact, excluded.emergency_contact),
      medical_notes = coalesce(profile_private.medical_notes, excluded.medical_notes),
      email = coalesce(profile_private.email, excluded.email);
    delete from profile_private where id = p_drop;
  end if;

  -- Competitions. round_totals references round_starters (round_id, climber_id) and results need a starter,
  -- so the kept climber's starter rows come first and the duplicate's go last.
  update registrations set climber_id = p_keep where climber_id = p_drop;
  insert into round_starters (round_id, climber_id, start_order, prev_place, group_label, status)
  select round_id, p_keep, start_order, prev_place, group_label, status from round_starters where climber_id = p_drop;
  update round_totals set climber_id = p_keep where climber_id = p_drop;
  update boulder_results set climber_id = p_keep where climber_id = p_drop;
  update lead_results set climber_id = p_keep where climber_id = p_drop;
  delete from round_starters where climber_id = p_drop;
  begin
    update boulder_results set updated_by = p_keep where updated_by = p_drop;
    update lead_results set updated_by = p_keep where updated_by = p_drop;
  exception when raise_exception then
    -- the start-list check of a result the duplicate entered (as a judge) for a climber no longer on that list
    raise exception 'cannot merge: the duplicate entered a result for a climber who is no longer on that round''s start list; fix or delete that result first (%)', sqlerrm;
  end;
  update score_events set climber_id = p_keep where climber_id = p_drop;
  update score_events set judge_id = p_keep where judge_id = p_drop;
  update lead_events set climber_id = p_keep where climber_id = p_drop;
  update lead_events set judge_id = p_keep where judge_id = p_drop;
  update appeals set climber_id = p_keep where climber_id = p_drop;
  update appeal_details set created_by = p_keep where created_by = p_drop;
  update appeal_details set resolved_by = p_keep where resolved_by = p_drop;

  -- Judging and coaching links (an existing identical link of keep wins).
  delete from judge_assignments x where x.judge_id = p_drop and exists (select 1 from judge_assignments y
    where y.judge_id = p_keep and y.round_id = x.round_id and y.boulder_id is not distinct from x.boulder_id);
  update judge_assignments set judge_id = p_keep where judge_id = p_drop;
  delete from judge_claims x where x.climber_id = p_drop and exists (select 1 from judge_claims y
    where y.climber_id = p_keep and y.boulder_id = x.boulder_id);
  update judge_claims set climber_id = p_keep where climber_id = p_drop;
  update judge_claims set judge_id = p_keep where judge_id = p_drop;
  delete from coach_athletes where (coach_id, climber_id) in ((p_keep, p_drop), (p_drop, p_keep));  -- a link between the two
  delete from coach_athletes x where x.coach_id = p_drop and exists (select 1 from coach_athletes y
    where y.coach_id = p_keep and y.climber_id = x.climber_id);
  update coach_athletes set coach_id = p_keep where coach_id = p_drop;
  delete from coach_athletes x where x.climber_id = p_drop and exists (select 1 from coach_athletes y
    where y.climber_id = p_keep and y.coach_id = x.coach_id);
  update coach_athletes set climber_id = p_keep where climber_id = p_drop;
  update coach_notes set coach_id = p_keep where coach_id = p_drop;
  update coach_notes set climber_id = p_keep where climber_id = p_drop;

  -- Rankings inputs and IFSC
  update international_results set climber_id = p_keep where climber_id = p_drop;
  update ranking_adjustments set climber_id = p_keep where climber_id = p_drop;
  update world_rankings set climber_id = p_keep where climber_id = p_drop;
  update ifsc_pending set suggested_profile = p_keep where suggested_profile = p_drop;
  delete from ifsc_dismissed x where x.climber_id = p_drop and exists (select 1 from ifsc_dismissed y
    where y.climber_id = p_keep and y.ifsc_event_id = x.ifsc_event_id and y.ifsc_dcat_id = x.ifsc_dcat_id);
  update ifsc_dismissed set climber_id = p_keep where climber_id = p_drop;
  update client_errors set profile_id = p_keep where profile_id = p_drop;  -- the staff app's error reports (039)
  -- "Not the same person" marks: the duplicate's carry over to keep (a mark between the two goes).
  delete from profile_not_duplicates where (a, b) in ((least(p_keep, p_drop), greatest(p_keep, p_drop)));
  insert into profile_not_duplicates (a, b, created_at)
  select least(o, p_keep), greatest(o, p_keep), created_at
  from (select case when a = p_drop then b else a end as o, created_at from profile_not_duplicates
        where p_drop in (a, b)) x
  on conflict do nothing;
  delete from profile_not_duplicates where p_drop in (a, b);

  -- The duplicate's climber page rows (the moved rounds are queued for rebuilding by the triggers).
  delete from climber_cache_entries where climber_id = p_drop;

  delete from private.merge_marks where xact = txid_current();
  perform set_config('ilca.merging', '', true);

  -- Safety net: nothing may still reference the duplicate.
  for r in select * from private.profile_refs() loop
    execute format('select exists (select 1 from %s where %I = $1)', r.tbl, r.col) into hit using p_drop;
    if hit then
      raise exception 'cannot merge: %.% still points at the duplicate and merging does not handle that table yet (nothing was changed)', r.tbl, r.col;
    end if;
  end loop;
  delete from profiles where id = p_drop;

  report := jsonb_set(report, '{applied}', 'true');
  -- Stored without private values: those fields only say that they differed; no birth years.
  insert into profile_merges (merged_by, keep_id, keep_name, drop_id, drop_name, report)
  values (me, p_keep, k.full_name, p_drop, d.full_name,
    report #- '{keep,birth_year}' #- '{drop,birth_year}' || jsonb_build_object('differences', (
      select coalesce(jsonb_agg(case when x ->> 'field' in ('login', 'birth_date', 'phone', 'email', 'emergency_contact', 'medical_notes')
                                     then jsonb_build_object('field', x ->> 'field', 'differed', true) else x end order by o), '[]')
      from jsonb_array_elements(report -> 'differences') with ordinality e (x, o))));
  return report;
end $$;
