-- Climbers too young for the senior ranking in a season. IFSC's minimum age for senior events
-- (World Cups, World Championships), by the age reached in the calendar year: 16 until 2024
-- (IFSC Rules 2023/2024), 17 from 2025 (IFSC General Assembly 2023). ILCA's age classes use the
-- year the season ends, so 2024-25 (2025) excludes those born in 2009 and later.
-- Like season_age_classes(): reads the private birth date but exposes only "below the minimum",
-- and only for climbers with a public result in a ranked competition that season.
create function public.season_senior_too_young(p_season text)
returns table (climber_id uuid)
  language sql stable security definer set search_path = public as $$
  select p.id
  from profile_private p
  where p_season ~ '^\d{4}-\d{2}$' and p.birth_date is not null
    and (left(p_season, 4)::int + 1) - extract(year from p.birth_date)::int
        < case when left(p_season, 4)::int + 1 <= 2024 then 16 else 17 end
    and exists (select 1 from round_starters s
                 join rounds r on r.id = s.round_id
                 join categories c on c.id = r.category_id
                 join competitions co on co.id = c.competition_id
                 where s.climber_id = p.id and co.season = p_season and co.series <> 'other'
                   and public.round_is_public(r.id));
$$;
revoke execute on function public.season_senior_too_young(text) from public;
grant execute on function public.season_senior_too_young(text) to anon, authenticated;
