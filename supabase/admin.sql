-- Admin snippets. Run in the Supabase SQL editor (runs as the service role, bypassing RLS).
-- Replace the emails / names with real values.

-- Make someone an admin / coach / judge (a user may hold several roles).
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'admin@example.com'
on conflict do nothing;

-- Link a coach to an athlete (both are profile ids; profiles.user_id is the login account).
insert into public.coach_athletes (coach_id, climber_id)
select pc.id, pa.id
from auth.users c join public.profiles pc on pc.user_id = c.id,
     auth.users a join public.profiles pa on pa.user_id = a.id
where c.email = 'coach@example.com' and a.email = 'athlete@example.com'
on conflict do nothing;

-- Attach a login account to an imported climber profile (run as an admin user, or as service role
-- after setting request.jwt.claim.sub to an admin's id). Prefer the admin UI (People page).
-- select public.link_account('<profile-id>', (select id from auth.users where email = 'parent@example.com'));

-- Create a competition with one category, a qualification round of 5 boulders.
with comp as (
  insert into public.competitions (name, name_he, venue, starts_on, ends_on, status)
  values ('Israeli Cup #1', 'גביע ישראל #1', 'Tel Aviv', '2026-11-01', '2026-11-01', 'published')
  returning id
), cat as (
  insert into public.categories (competition_id, name, name_he, gender)
  select id, 'Open Women', 'נשים פתוח', 'female' from comp returning id
), rnd as (
  insert into public.rounds (category_id, kind, status, scoring)
  select id, 'qualification', 'planned', 'ifsc2025' from cat returning id
)
insert into public.boulders (round_id, number)
select rnd.id, n from rnd, generate_series(1, 5) n;

-- Register an athlete in a category (climber_id is a profile id; the climber needs no account).
-- insert into public.registrations (category_id, climber_id, bib) values ('<category-id>', '<profile-id>', 1);

-- Assign a judge to one boulder (or set boulder_id null for the whole round).
-- insert into public.judge_assignments (round_id, boulder_id, judge_id) values ('<round-id>', '<boulder-id>', '<judge-profile-id>');

-- Open / close a round for judging and live results.
-- update public.rounds set status = 'live'   where id = '<round-id>';
-- update public.rounds set status = 'closed' where id = '<round-id>';
