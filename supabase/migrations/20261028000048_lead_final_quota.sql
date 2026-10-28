-- ILCA lead league (2026-10-28): a lead competition has a qualification and a final. Without a quota set by the
-- admin, the final takes half of the climbers ranked in the qualification (rounded up) when there are fewer than
-- 30, and 24 when there are 30 or more; climbers tied at the cutoff all go through (as before). The event
-- checklist no longer asks for a quota on a lead final.

create function public.lead_final_quota(n int) returns int
  language sql immutable set search_path = public as $$
  select case when n < 30 then ceil(n / 2.0)::int else 24 end
$$;
revoke execute on function public.lead_final_quota(int) from public, anon;
grant execute on function public.lead_final_quota(int) to authenticated;

create or replace function public.generate_start_list(p_round uuid) returns int
  language plpgsql security invoker set search_path = public as $$
declare prev uuid; quota int; cat uuid; n int; groups int; is_lead_final boolean;
begin
  select category_id, advance_quota, scoring::text = 'lead' and kind = 'final' into cat, quota, is_lead_final from rounds where id = p_round;
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
    -- A lead final without a quota of its own: the ILCA rule, from the climbers ranked in the previous round.
    if quota is null and is_lead_final then
      select public.lead_final_quota(count(*)::int) into quota from public.round_ranks_for(array[prev]) where rank is not null;
    end if;
    insert into round_starters (round_id, climber_id, start_order, prev_place)
    select p_round, climber_id, row_number() over (order by rank desc, group_label nulls first, climber_id), rank
    from public.round_ranks_for(array[prev])
    where rank is not null and (quota is null or rank <= ceil(quota::numeric / groups));
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.event_checklist(p_competition uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  comp competitions%rowtype;
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  checks jsonb := '[]';
  items jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'only admins can read the event checklist' using errcode = 'insufficient_privilege';
  end if;
  select * into comp from competitions where id = p_competition;
  if not found then
    raise exception 'competition not found' using errcode = 'no_data_found';
  end if;

  -- Published (and dated: starts_on is required by the table).
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'published', 'ok', comp.status = 'published', 'items', '[]'::jsonb));

  -- Categories without rounds (and a competition without categories).
  select coalesce(jsonb_agg(jsonb_build_object('category_id', c.id, 'label', c.name, 'label_he', c.name_he, 'gender', c.gender) order by c.name), '[]')
    into items from categories c
    where c.competition_id = comp.id and not exists (select 1 from rounds r where r.category_id = c.id);
  if not exists (select 1 from categories where competition_id = comp.id) then
    items := '[{"label": "-", "label_he": "-"}]';
  end if;
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'category_rounds', 'ok', items = '[]', 'items', items));

  -- Rounds without a boulder / route (the scoring format is never empty: the column is required).
  select coalesce(jsonb_agg(jsonb_build_object('round_id', r.id, 'category_id', c.id, 'kind', r.kind,
           'label', c.name, 'label_he', c.name_he, 'gender', c.gender) order by c.name, r.kind), '[]')
    into items from rounds r join categories c on c.id = r.category_id
    where c.competition_id = comp.id and not exists (select 1 from boulders b where b.round_id = r.id);
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'round_boulders', 'ok', items = '[]', 'items', items));

  -- First rounds: starters, and a bib for each (the bib is the registration's).
  select coalesce(jsonb_agg(jsonb_build_object('round_id', r.id, 'category_id', c.id, 'kind', r.kind,
           'label', c.name, 'label_he', c.name_he, 'gender', c.gender) order by c.name), '[]')
    into items from rounds r join categories c on c.id = r.category_id
    where c.competition_id = comp.id and public.previous_round(r.id) is null
      and not exists (select 1 from round_starters s where s.round_id = r.id);
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'first_starters', 'ok', items = '[]', 'items', items));

  select coalesce(jsonb_agg(jsonb_build_object('round_id', r.id, 'category_id', c.id, 'kind', r.kind, 'profile_id', p.id,
           'label', p.full_name, 'label_he', p.full_name_he) order by c.name, p.full_name), '[]')
    into items from rounds r
    join categories c on c.id = r.category_id
    join round_starters s on s.round_id = r.id
    join profiles p on p.id = s.climber_id
    left join registrations g on g.category_id = c.id and g.climber_id = s.climber_id
    where c.competition_id = comp.id and public.previous_round(r.id) is null and g.bib is null;
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'starter_bibs', 'ok', items = '[]', 'items', items));

  -- A round people advance to needs its quota (rounds.advance_quota: how many advance from the previous round).
  -- A lead final without one takes the ILCA rule.
  select coalesce(jsonb_agg(jsonb_build_object('round_id', r.id, 'category_id', c.id, 'kind', r.kind,
           'label', c.name, 'label_he', c.name_he, 'gender', c.gender) order by c.name, r.kind), '[]')
    into items from rounds r join categories c on c.id = r.category_id
    where c.competition_id = comp.id and r.advance_quota is null and public.previous_round(r.id) is not null
      and not (r.scoring::text = 'lead' and r.kind = 'final');  -- the ILCA rule applies (lead_final_quota)
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'advance_quota', 'ok', items = '[]', 'items', items));

  -- Boulders nobody judges (an assignment of the whole round counts).
  select coalesce(jsonb_agg(jsonb_build_object('round_id', r.id, 'category_id', c.id, 'kind', r.kind, 'number', b.number,
           'label', c.name, 'label_he', c.name_he, 'gender', c.gender) order by c.name, r.kind, b.number), '[]')
    into items from boulders b join rounds r on r.id = b.round_id join categories c on c.id = r.category_id
    where c.competition_id = comp.id and not exists (
      select 1 from judge_assignments ja
      where ja.round_id = r.id and (ja.boulder_id is null or ja.boulder_id = b.id));
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'boulder_judges', 'ok', items = '[]', 'items', items));

  -- Every assigned judge: has a login, has signed in once. Of auth.users only the sign-in time leaves.
  select coalesce(jsonb_agg(jsonb_build_object('profile_id', j.id, 'label', j.full_name, 'label_he', j.full_name_he,
           'has_login', j.user_id is not null, 'signed_in', u.last_sign_in_at is not null,
           'last_sign_in_at', u.last_sign_in_at) order by j.full_name), '[]')
    into items from (
      select distinct p.id, p.full_name, p.full_name_he, p.user_id
      from judge_assignments ja
      join rounds r on r.id = ja.round_id join categories c on c.id = r.category_id
      join profiles p on p.id = ja.judge_id
      where c.competition_id = comp.id) j
    left join auth.users u on u.id = j.user_id;
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'judges_signed_in',
    'ok', not exists (select 1 from jsonb_array_elements(items) i where not (i->>'signed_in')::boolean), 'items', items));

  -- Appeals still open from an earlier (Israel) day.
  select coalesce(jsonb_agg(jsonb_build_object('round_id', r.id, 'category_id', c.id, 'kind', r.kind, 'profile_id', a.climber_id,
           'label', c.name, 'label_he', c.name_he, 'gender', c.gender, 'created_at', a.created_at) order by a.created_at), '[]')
    into items from appeals a join rounds r on r.id = a.round_id join categories c on c.id = r.category_id
    where c.competition_id = comp.id and a.status = 'open'
      and (a.created_at at time zone 'Asia/Jerusalem')::date < today;
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'old_appeals', 'ok', items = '[]', 'items', items));

  return jsonb_build_object(
    'competition', jsonb_build_object('id', comp.id, 'name', comp.name, 'name_he', comp.name_he, 'status', comp.status,
                                      'starts_on', comp.starts_on, 'ends_on', comp.ends_on),
    'checks', checks);
end $$;
