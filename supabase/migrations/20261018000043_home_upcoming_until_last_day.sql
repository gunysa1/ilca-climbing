-- Home page: a multi-day competition stays under "upcoming" until its last day. Before, upcoming took
-- starts_on >= today, so on day 2 of a 2-day event, between rounds (nothing live, not finished yet), the event
-- was in none of the three lists. Upcoming now takes ends_on >= today (still ordered by starts_on, at most 3,
-- not live right now) and flags `today` when the competition is on (started, not ended). Otherwise as 030.
create or replace function public.home_page(p_live_only boolean default false) returns json
  language plpgsql stable set search_path = public set jit = off as $$
declare live json; today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  select coalesce(json_agg(json_build_object(
      'round_id', r.id, 'kind', r.kind, 'scoring', r.scoring,
      'category', json_build_object('id', c.id, 'name', c.name, 'name_he', c.name_he, 'gender', c.gender),
      'competition', json_build_object('id', co.id, 'name', co.name, 'name_he', co.name_he),
      'on_wall', coalesce((
        select json_agg(json_build_object('boulder_id', w.boulder_id, 'number', b.number, 'climber_id', w.climber_id,
                                          'full_name', p.full_name, 'full_name_he', p.full_name_he) order by b.number)
        from public.on_wall(r.id) w
        join boulders b on b.id = w.boulder_id
        join profiles p on p.id = w.climber_id), '[]'::json))
      order by co.starts_on, co.id, c.name, r.kind), '[]'::json)
  into live
  from rounds r
  join categories c on c.id = r.category_id
  join competitions co on co.id = c.competition_id
  where r.status = 'live' and co.status <> 'draft';

  if p_live_only then
    return json_build_object('live', live);
  end if;

  return (
  with latest as (
    select co.id, co.name, co.name_he, co.venue, co.starts_on, co.ends_on
    from competitions co where co.status = 'finished'
    order by co.ends_on desc, co.starts_on desc, co.id limit 3
  ),
  last_rounds as (  -- each category's last round that was climbed, unless it was climbed in groups
    select x.* from (
      select distinct on (c.id) r.id, r.kind, c.id as category_id, c.name, c.name_he, c.gender, c.competition_id
      from latest l
      join categories c on c.competition_id = l.id
      join rounds r on r.category_id = c.id
      where r.status <> 'planned'
      order by c.id, r.kind desc
    ) x
    where (select count(distinct coalesce(s.group_label, '')) from round_starters s where s.round_id = x.id) <= 1
  ),
  winners as (
    select lr.competition_id, lr.category_id, lr.name, lr.name_he, lr.gender, lr.kind, rr.round_id, rr.climber_id
    from public.round_ranks_for(array(select id from last_rounds)) rr
    join last_rounds lr on lr.id = rr.round_id
    where rr.rank = 1
  )
  select json_build_object(
    'live', live,
    'upcoming', coalesce((
      select json_agg(json_build_object('id', u.id, 'name', u.name, 'name_he', u.name_he, 'venue', u.venue,
                                        'starts_on', u.starts_on, 'ends_on', u.ends_on, 'today', u.starts_on <= today)
                      order by u.starts_on, u.id)
      from (select co.id, co.name, co.name_he, co.venue, co.starts_on, co.ends_on from competitions co
            where co.ends_on >= today and co.status = 'published'
              and not exists (select 1 from categories c join rounds r on r.category_id = c.id
                              where c.competition_id = co.id and r.status = 'live')
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
      from latest l), '[]'::json)));
end $$;
