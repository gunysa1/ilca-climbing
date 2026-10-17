-- One round trip for the public home page: rounds that are live now (with who is on the wall), the
-- next competitions and the latest finished ones with their winners. Security invoker: row level
-- security applies as for separate queries (drafts are invisible to the public); drafts are also left
-- out explicitly, for staff who can read them. Explicit public columns only: never profile_private,
-- never who entered a score. Winners: rank 1 of each category's last round (the final if there is one)
-- from round_ranks_for, the source the results pages use; ties list every rank-1 climber.
-- "Today" is Israel's date. The rankings and favorites load separately (season_rankings, favorites_page).
create function public.home_page() returns json
  language sql stable set search_path = public as $$
  with today as (select (now() at time zone 'Asia/Jerusalem')::date as d),
  live as (
    select r.id, r.kind, r.scoring, c.id as category_id, c.name as category, c.name_he as category_he, c.gender,
           co.id as competition_id, co.name as competition, co.name_he as competition_he, co.starts_on
    from rounds r
    join categories c on c.id = r.category_id
    join competitions co on co.id = c.competition_id
    where r.status = 'live' and co.status <> 'draft'
  ),
  latest as (
    select co.id, co.name, co.name_he, co.venue, co.starts_on, co.ends_on
    from competitions co where co.status = 'finished'
    order by co.ends_on desc, co.starts_on desc, co.id limit 3
  ),
  last_rounds as (  -- each category's last round that was climbed
    select distinct on (c.id) r.id, r.kind, c.id as category_id, c.name, c.name_he, c.gender, c.competition_id
    from latest l
    join categories c on c.competition_id = l.id
    join rounds r on r.category_id = c.id
    where r.status <> 'planned'
    order by c.id, r.kind desc
  ),
  winners as (
    select lr.competition_id, lr.category_id, lr.name, lr.name_he, lr.gender, lr.kind, rr.round_id, rr.climber_id
    from public.round_ranks_for(array(select id from last_rounds)) rr
    join last_rounds lr on lr.id = rr.round_id
    where rr.rank = 1
  )
  select json_build_object(
    'today', (select d from today),
    'live', coalesce((
      select json_agg(json_build_object(
        'round_id', l.id, 'kind', l.kind, 'scoring', l.scoring,
        'category', json_build_object('id', l.category_id, 'name', l.category, 'name_he', l.category_he, 'gender', l.gender),
        'competition', json_build_object('id', l.competition_id, 'name', l.competition, 'name_he', l.competition_he),
        'on_wall', coalesce((
          select json_agg(json_build_object('boulder_id', w.boulder_id, 'number', b.number, 'climber_id', w.climber_id,
                                            'full_name', p.full_name, 'full_name_he', p.full_name_he) order by b.number)
          from public.on_wall(l.id) w
          join boulders b on b.id = w.boulder_id
          join profiles p on p.id = w.climber_id), '[]'::json))
        order by l.starts_on, l.competition_id, l.category, l.kind)
      from live l), '[]'::json),
    'upcoming', coalesce((
      select json_agg(json_build_object('id', u.id, 'name', u.name, 'name_he', u.name_he, 'venue', u.venue,
                                        'starts_on', u.starts_on, 'ends_on', u.ends_on) order by u.starts_on, u.id)
      from (select co.* from competitions co, today
            where co.starts_on >= today.d and co.status = 'published'
            order by co.starts_on, co.id limit 3) u), '[]'::json),
    'latest', coalesce((
      select json_agg(json_build_object('id', l.id, 'name', l.name, 'name_he', l.name_he, 'venue', l.venue,
        'starts_on', l.starts_on, 'ends_on', l.ends_on,
        'winners', coalesce((
          select json_agg(json_build_object('category_id', w.category_id, 'category', w.name, 'category_he', w.name_he,
                                            'gender', w.gender, 'round_id', w.round_id, 'round_kind', w.kind,
                                            'climber_id', w.climber_id, 'full_name', p.full_name,
                                            'full_name_he', p.full_name_he, 'club', p.club)
                          order by w.name, p.full_name)
          from winners w join profiles p on p.id = w.climber_id
          where w.competition_id = l.id), '[]'::json))
        order by l.ends_on desc, l.starts_on desc, l.id)
      from latest l), '[]'::json));
$$;
grant execute on function public.home_page() to anon, authenticated;

-- The home page's favorites: the starred climbers' public profiles and history, in one request
-- (only made when the device has favorites).
create function public.favorites_page(p_climbers uuid[]) returns json
  language sql stable set search_path = public as $$
  select json_build_object(
    'profiles', coalesce((
      select json_agg(json_build_object('id', p.id, 'full_name', p.full_name, 'full_name_he', p.full_name_he,
                                        'club', p.club, 'country', p.country))
      from public.profiles p where p.id = any(p_climbers)), '[]'::json),
    'history', coalesce((select json_agg(to_json(h)) from public.climber_history_for(p_climbers) h), '[]'::json));
$$;
grant execute on function public.favorites_page(uuid[]) to anon, authenticated;
