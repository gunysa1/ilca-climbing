-- Roster import (admin UI, CSV): create categories, climber profiles (+ private rows) and
-- registrations in one transaction. security invoker: the caller's RLS applies, so only admins
-- can write; a failing row (e.g. duplicate registration) rolls back the whole import.
create function public.import_roster(
  p_categories jsonb, p_profiles jsonb, p_private jsonb, p_registrations jsonb
) returns void
  language plpgsql security invoker set search_path = public as $$
begin
  insert into categories (id, competition_id, name, name_he, gender)
  select id, competition_id, name, name_he, gender from jsonb_populate_recordset(null::categories, p_categories);

  insert into profiles (id, full_name, full_name_he, club, gender)
  select id, full_name, full_name_he, club, gender from jsonb_populate_recordset(null::profiles, p_profiles);

  insert into profile_private (id, birth_date, email)
  select id, birth_date, email from jsonb_populate_recordset(null::profile_private, p_private);

  insert into registrations (category_id, climber_id, bib)
  select category_id, climber_id, bib from jsonb_populate_recordset(null::registrations, p_registrations);
end $$;

revoke all on function public.import_roster(jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.import_roster(jsonb, jsonb, jsonb, jsonb) to authenticated;
