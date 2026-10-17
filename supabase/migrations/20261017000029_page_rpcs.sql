-- One round trip each for the national rankings page and the climber page (were: rounds in 1000-row
-- pages, then profiles in chunks of 150; and profile, then history). Security invoker: row level
-- security applies as for the separate queries. Built only from the existing set-returning functions
-- in a single statement, so it stays within the anon statement timeout. A json scalar: no 1000-row cap.
-- Birth dates never leave: season_age_classes / season_senior_too_young expose a class / "below the
-- minimum" only, profiles are the public columns.
create function public.season_rankings(p_season text) returns json
  language sql stable set search_path = public as $$
  with rr as (select * from public.season_ranking_rounds(p_season)),
       ic as (select * from public.international_results where season = p_season),
       adj as (select * from public.ranking_adjustments where season = p_season),
       wr as (select * from public.world_rankings where season = p_season),
       ids as (select climber_id from rr union select climber_id from ic union select climber_id from wr)
  select json_build_object(
    'rounds', coalesce((select json_agg(to_json(rr)) from rr), '[]'::json),
    'age_classes', coalesce((select json_agg(to_json(a)) from public.season_age_classes(p_season) a), '[]'::json),
    'too_young', coalesce((select json_agg(y.climber_id) from public.season_senior_too_young(p_season) y), '[]'::json),
    'intl', coalesce((select json_agg(to_json(ic)) from ic), '[]'::json),
    'adjustments', coalesce((select json_agg(to_json(adj)) from adj), '[]'::json),
    'world', coalesce((select json_agg(to_json(wr)) from wr), '[]'::json),
    'profiles', coalesce((
      select json_agg(json_build_object('id', p.id, 'full_name', p.full_name, 'full_name_he', p.full_name_he,
                                        'club', p.club, 'country', p.country, 'gender', p.gender))
      from public.profiles p where p.id in (select climber_id from ids)), '[]'::json));
$$;
grant execute on function public.season_rankings(text) to anon, authenticated;

create function public.climber_page(p_climber uuid) returns json
  language sql stable set search_path = public as $$
  with h as (select * from public.climber_history_for(array[p_climber]))
  select json_build_object(
    'profile', (select json_build_object('id', p.id, 'full_name', p.full_name, 'full_name_he', p.full_name_he,
                                         'club', p.club, 'country', p.country, 'gender', p.gender)
                from public.profiles p where p.id = p_climber),
    'history', coalesce((select json_agg(to_json(h)) from h), '[]'::json),
    'competitions', coalesce((
      select json_agg(json_build_object('id', co.id, 'season', co.season, 'series', co.series))
      from public.competitions co where co.id in (select competition_id from h)), '[]'::json));
$$;
grant execute on function public.climber_page(uuid) to anon, authenticated;

-- lead_scores_for(null) means every round: a climber or season without rounds made these two compute
-- (and, for a season, return) all lead rounds. An empty array computes nothing.
create or replace function public.climber_history_for(p_climbers uuid[])
returns setof public.climber_history
  language plpgsql stable security invoker set search_path = public as $$
declare ids uuid[];
begin
  select array_agg(distinct s.round_id) into ids from public.round_starters s where s.climber_id = any(p_climbers);
  ids := coalesce(ids, '{}');  -- null would mean "every round" to lead_scores_for
  return query
  select x.climber_id, co.id, co.name, co.name_he, co.starts_on, c.name, c.name_he, r.kind, r.status,
         x.tops, x.zones, x.top_attempts, x.zone_attempts, x.points::numeric(6,1), x.rank,
         (select count(*) from public.round_starters s2 where s2.round_id = r.id), r.scoring::text, r.id
  from (
    select sc.climber_id, sc.round_id, sc.tops, sc.zones, sc.top_attempts, sc.zone_attempts, sc.points, sc.rank
    from public.round_scores sc where sc.round_id = any(ids) and sc.climber_id = any(p_climbers)
    union all
    select l.climber_id, l.round_id, null, null, null, null, null, l.rank
    from public.lead_scores_for(ids) l where l.climber_id = any(p_climbers)
  ) x
  join public.rounds r        on r.id = x.round_id
  join public.categories c    on c.id = r.category_id
  join public.competitions co on co.id = c.competition_id;
end $$;

create or replace function public.season_ranking_rounds(p_season text)
returns setof public.ranking_rounds
  language plpgsql stable security invoker set search_path = public as $$
declare ids uuid[];
begin
  select array_agg(r.id) into ids
  from public.rounds r join public.categories c on c.id = r.category_id join public.competitions co on co.id = c.competition_id
  where co.season = p_season and co.series <> 'other' and r.status <> 'planned';
  ids := coalesce(ids, '{}');  -- null would mean "every round" to lead_scores_for
  return query
  select co.id, coalesce(co.name_he, co.name), co.starts_on, co.season, co.series,
         case when r.scoring::text = 'lead' then 'lead' else 'boulder' end,
         c.id, coalesce(c.name_he, c.name), c.gender, r.kind, rr.climber_id, rr.rank
  from public.round_ranks_for(ids) rr
  join public.rounds r        on r.id = rr.round_id
  join public.categories c    on c.id = r.category_id
  join public.competitions co on co.id = c.competition_id
  order by co.id, c.id, r.kind, rr.climber_id;
end $$;
