-- Two fixes after the first real use (2026-10-18):
--  * Rankings: a season's cached payload counts as changed only when its content changed. Competition structure
--    and people mark every season (rankings_cache_touch_all), so setting up an upcoming competition rebuilt all
--    seven seasons' payloads and made every season's stored tables due again; the build (two seasons a minute,
--    newest first) never reached the older ones while the admin kept editing.
--  * Event checklist: the advance quota lives on the round people advance TO (generate_start_list reads the
--    round's own advance_quota); the check looked at the round they advance from. Items also carry the
--    category's gender (two categories with the same English name, e.g. men's and women's "Seniors").

create or replace function public.refresh_rankings_cache() returns int
  language plpgsql set search_path = public as $$
declare pending bigint[]; seasons text[]; all_seasons boolean; me text := current_user; s text; v json; n int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('public.refresh_rankings_cache')) then return 0; end if;
  select coalesce(array_agg(id), '{}'), coalesce(array_agg(distinct season) filter (where season is not null), '{}'),
         coalesce(bool_or(season is null), false)
  into pending, seasons, all_seasons
  from rankings_cache_changes;
  for s in
    select x.season from (
      select season from competitions where season is not null
      union select season from international_results
      union select season from ranking_adjustments
      union select season from world_rankings
      union select season from season_rankings_cache) x  -- a season whose last competition moved away: emptied
    where all_seasons
       or x.season = any(seasons)
       or not exists (select 1 from season_rankings_cache c where c.season = x.season)
    order by x.season
  loop
    -- An anonymous visitor: no JWT claims (auth.uid() is null, so no admin / judge / coach / self rows).
    perform set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
    set local role anon;
    v := public.season_rankings_build(s);
    execute format('set local role %I', me);
    -- unchanged content keeps its built_at: nothing downstream (ranking tables) becomes due
    insert into season_rankings_cache (season, payload, built_at) values (s, v, now())
      on conflict (season) do update set payload = excluded.payload, built_at = excluded.built_at
      where season_rankings_cache.payload::text is distinct from excluded.payload::text;
    if found then n := n + 1; end if;
  end loop;
  delete from rankings_cache_changes where id = any(pending);
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
  select coalesce(jsonb_agg(jsonb_build_object('round_id', r.id, 'category_id', c.id, 'kind', r.kind,
           'label', c.name, 'label_he', c.name_he, 'gender', c.gender) order by c.name, r.kind), '[]')
    into items from rounds r join categories c on c.id = r.category_id
    where c.competition_id = comp.id and r.advance_quota is null and public.previous_round(r.id) is not null;
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
