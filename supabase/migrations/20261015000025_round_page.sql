-- One round trip for a round's page (results page and judge pad): the round, its category and
-- competition, the competition's categories with their rounds (the men / women switch), boulders,
-- the start list with bibs and age classes, results, totals and appeals. Was four sequential
-- requests. Security invoker: row level security and column privileges apply as for the separate
-- queries (explicit columns; never updated_by). Null when the caller can't see the round.
create function public.round_page(p_round uuid) returns jsonb
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
        'prev_place', s.prev_place, 'group_label', s.group_label, 'bib', g.bib, 'age_class', g.age_class,
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
grant execute on function public.round_page(uuid) to anon, authenticated;
