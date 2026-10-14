-- RLS isolation tests. Run with: npm run test:db
-- Each block switches to a role/user and asserts what it can and cannot do.
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test',   '{"full_name":"Admin"}'),
  ('00000000-0000-0000-0000-00000000000c', 'coach@test',   '{"full_name":"Coach"}'),
  ('00000000-0000-0000-0000-00000000000d', 'coach2@test',  '{"full_name":"Other Coach"}'),
  ('00000000-0000-0000-0000-00000000000e', 'judge@test',   '{"full_name":"Judge"}'),
  ('00000000-0000-0000-0000-000000000001', 'noa@test',     '{"full_name":"Noa"}'),
  ('00000000-0000-0000-0000-000000000002', 'tamar@test',   '{"full_name":"Tamar"}');

insert into user_roles values
  ('00000000-0000-0000-0000-00000000000a', 'admin'),
  ('00000000-0000-0000-0000-00000000000c', 'coach'),
  ('00000000-0000-0000-0000-00000000000d', 'coach'),
  ('00000000-0000-0000-0000-00000000000e', 'judge');

update profile_private set phone = '050-1111111', medical_notes = 'asthma'
  where id = '00000000-0000-0000-0000-000000000001';
update profile_private set phone = '050-2222222'
  where id = '00000000-0000-0000-0000-000000000002';

insert into coach_athletes values
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000001');

insert into competitions (id, name, starts_on, ends_on, status) values
  ('10000000-0000-0000-0000-000000000001', 'Israeli Cup #1', '2026-10-01', '2026-10-01', 'published'),
  ('10000000-0000-0000-0000-000000000002', 'Secret draft',   '2026-12-01', '2026-12-01', 'draft');
insert into categories (id, competition_id, name, gender) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Open Women', 'female'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Open Women', 'female');
insert into rounds (id, category_id, kind, status) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'qualification', 'live'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'final', 'planned');
insert into boulders (id, round_id, number) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 1),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 2),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', 1);
insert into registrations values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 1),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 2);
-- judge assigned to boulder 1 of the live qualification only
insert into judge_assignments (round_id, boulder_id, judge_id) values
  ('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e');

create function pg_temp.login(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  if uid is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;

create function pg_temp.assert(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;

-- Expect a statement to be rejected (RLS / privilege / check).
create function pg_temp.denied(stmt text, msg text) returns void language plpgsql as $$
declare n int;
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'FAIL (allowed): %', msg; end if;
  exception
    when insufficient_privilege or check_violation or raise_exception or unique_violation then
      if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'ok - denied: %', msg;
end $$;

set client_min_messages = notice;

-- ---------------------------------------------------------------- judge
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
insert into boulder_results (boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt)
  values ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
          '30000000-0000-0000-0000-000000000001', 3, 1, 3);
insert into boulder_results (boulder_id, climber_id, round_id, attempts, zone_attempt)
  values ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
          '30000000-0000-0000-0000-000000000001', 2, 2);
select pg_temp.assert((select count(*) from boulder_results) = 2, 'judge scores assigned boulder');
select pg_temp.denied($$insert into boulder_results (boulder_id, climber_id, round_id, attempts)
  values ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
          '30000000-0000-0000-0000-000000000001', 1)$$, 'judge scores unassigned boulder');
select pg_temp.denied($$insert into boulder_results (boulder_id, climber_id, round_id, attempts)
  values ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
          '30000000-0000-0000-0000-000000000002', 1)$$, 'judge scores a round that is not live');
select pg_temp.assert((select count(*) from profile_private) = 1, 'judge sees only own private row');
select pg_temp.assert((select count(*) from coach_notes) = 0, 'judge sees no coach notes');
select pg_temp.denied($$update user_roles set role = 'admin' where user_id = auth.uid()$$, 'judge escalates role');
select pg_temp.denied($$insert into user_roles values (auth.uid(), 'admin')$$, 'judge grants self admin');
reset role;

-- ---------------------------------------------------------------- climber
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.assert((select count(*) from profile_private) = 1, 'climber sees only own private profile');
select pg_temp.assert((select medical_notes from profile_private) = 'asthma', 'climber reads own medical notes');
select pg_temp.denied($$update boulder_results set top_attempt = 1, zone_attempt = 1 where climber_id = auth.uid()$$,
  'climber edits own score');
select pg_temp.denied($$insert into boulder_results (boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt)
  values ('40000000-0000-0000-0000-000000000002', auth.uid(), '30000000-0000-0000-0000-000000000001', 1, 1, 1)$$,
  'climber inserts own score');
select pg_temp.denied($$update profile_private set phone = 'x' where id = '00000000-0000-0000-0000-000000000002'$$,
  'climber edits another climber private data');
select pg_temp.assert((select count(*) from competitions) = 1, 'climber does not see draft competitions');
select pg_temp.assert(
  (select points from climber_history where climber_id = auth.uid() and round = 'qualification') = 24.8,
  'climber history shows IFSC 2025 points (top on 3rd attempt = 24.8)');
select pg_temp.assert(
  (select rank from climber_history where climber_id = auth.uid() and round = 'qualification') = 1,
  'climber history shows rank');
reset role;

-- ---------------------------------------------------------------- coach
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.assert((select count(*) from profile_private) = 2, 'coach sees own + linked athlete private data');
select pg_temp.assert(not exists (select 1 from profile_private where id = '00000000-0000-0000-0000-000000000002'),
  'coach cannot see unlinked athlete private data');
insert into coach_notes (coach_id, climber_id, body, shared_with_climber)
  values (auth.uid(), '00000000-0000-0000-0000-000000000001', 'Work on heel hooks', true),
         (auth.uid(), '00000000-0000-0000-0000-000000000001', 'Private: nervous in finals', false);
select pg_temp.denied($$insert into coach_notes (coach_id, climber_id, body)
  values (auth.uid(), '00000000-0000-0000-0000-000000000002', 'x')$$, 'coach notes on unlinked athlete');
select pg_temp.denied($$insert into boulder_results (boulder_id, climber_id, round_id, attempts)
  values ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
          '30000000-0000-0000-0000-000000000001', 1)$$, 'coach writes scores');
reset role;

select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select pg_temp.assert((select count(*) from coach_notes) = 0, 'other coach cannot read notes');
reset role;

select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.assert((select count(*) from coach_notes) = 1, 'climber sees only shared coach notes');
reset role;

-- ---------------------------------------------------------------- anonymous
select pg_temp.login(null);
select pg_temp.assert((select count(*) from boulder_results) = 2, 'public reads live results');
select pg_temp.assert((select count(*) from profile_private) = 0, 'public sees no private data');
select pg_temp.denied($$select updated_by from boulder_results$$, 'public reads judge identity');
select pg_temp.assert((select count(*) from competitions) = 1, 'public sees published competitions only');
reset role;

-- ---------------------------------------------------------------- audit
select pg_temp.assert((select count(*) from score_events) = 2, 'every score change is audited');
select pg_temp.assert((select bool_and(judge_id = '00000000-0000-0000-0000-00000000000e') from score_events),
  'audit records the judge');

-- ---------------------------------------------------------------- integrity
select pg_temp.denied($$insert into boulder_results (boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt)
  values ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002',
          '30000000-0000-0000-0000-000000000001', 1, null, 1)$$, 'top without zone rejected');

-- ---------------------------------------------------------------- scoring tie-breaks
-- Same order as src/lib/scoring.ts: points, previous-round rank, top attempts, zone attempts.
-- Qualification: both 34.9 points; Tamar has fewer top attempts (1 vs 2) -> Tamar 1st.
-- Final: both 25.0 and equal attempts; countback to qualification -> Tamar 1st again.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into competitions (id, name, starts_on, ends_on, status) values
  ('10000000-0000-0000-0000-000000000003', 'Tie-break cup', '2026-11-01', '2026-11-01', 'published');
insert into categories (id, competition_id, name, gender) values
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'Open Women', 'female');
insert into rounds (id, category_id, kind, status) values
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'qualification', 'closed'),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000003', 'final', 'closed');
insert into boulders (id, round_id, number) values
  ('40000000-0000-0000-0000-000000000031', '30000000-0000-0000-0000-000000000003', 1),
  ('40000000-0000-0000-0000-000000000032', '30000000-0000-0000-0000-000000000003', 2),
  ('40000000-0000-0000-0000-000000000041', '30000000-0000-0000-0000-000000000004', 1);
insert into registrations values
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 1),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 2);
insert into boulder_results (boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt) values
  -- Noa: top on 2nd (24.9) + zone on 1st (10.0) = 34.9, top attempts 2
  ('40000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 2, 1, 2),
  ('40000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 3, 1, null),
  -- Tamar: top on 1st (25.0) + zone on 2nd (9.9) = 34.9, top attempts 1
  ('40000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', 1, 1, 1),
  ('40000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', 3, 2, null);
-- The final's start list comes from the qualification ranking (seeds = qualification places).
select generate_start_list('30000000-0000-0000-0000-000000000004');
insert into boulder_results (boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt) values
  -- Final: both flash
  ('40000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004', 1, 1, 1),
  ('40000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', 1, 1, 1);
select set_config('request.jwt.claim.sub', '', false);

select pg_temp.login(null);
select pg_temp.assert(
  (select array_agg(points::text || '#' || rank order by climber_id) from round_scores
    where round_id = '30000000-0000-0000-0000-000000000003') = '{34.9#2,34.9#1}',
  'equal points: fewer top attempts ranks higher');
select pg_temp.assert(
  (select array_agg(prev_rank::text || '>' || rank order by climber_id) from round_scores
    where round_id = '30000000-0000-0000-0000-000000000004') = '{2>2,1>1}',
  'equal points and attempts: countback to previous round');
select pg_temp.assert(
  (select rank from climber_history where climber_id = '00000000-0000-0000-0000-000000000001'
     and competition_id = '10000000-0000-0000-0000-000000000003' and round = 'final') = 2,
  'climber history uses tie-broken rank');
select pg_temp.assert(public.boulder_points(150, null) = 0 and public.boulder_points(1, 300) = 0,
  'points never go below zero');
reset role;

-- ---------------------------------------------------------------- start lists and advancement
-- Registrations fill the first round's start list automatically; later rounds are generated.
select pg_temp.assert(
  (select count(*) from round_starters where round_id = '30000000-0000-0000-0000-000000000003') = 2
  and (select array_agg(start_order || ':' || climber_id order by start_order) from round_starters
       where round_id = '30000000-0000-0000-0000-000000000004')
      = array['1:00000000-0000-0000-0000-000000000001', '2:00000000-0000-0000-0000-000000000002'],
  'final start list: qualifiers in reverse ranking order (worst first) with seeds');
select pg_temp.assert(
  (select array_agg(prev_place order by climber_id) from round_starters
    where round_id = '30000000-0000-0000-0000-000000000004') = '{2,1}',
  'start list stores previous-round places');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
-- semi-final with quota 1 in category 1: only the qualification winner (Noa, 24.8) advances
insert into rounds (id, category_id, kind, status, advance_quota) values
  ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', 'semifinal', 'planned', 1);
select generate_start_list('30000000-0000-0000-0000-000000000005');
select pg_temp.assert(
  (select array_agg(climber_id) from round_starters where round_id = '30000000-0000-0000-0000-000000000005')
    = array['00000000-0000-0000-0000-000000000001'::uuid],
  'advancement takes the top advance_quota of the previous round');
select pg_temp.denied($$select generate_start_list('30000000-0000-0000-0000-000000000003')$$,
  'regenerate a start list once results exist');
update registrations set age_class = 'U19'
  where category_id = '20000000-0000-0000-0000-000000000001' and climber_id = '00000000-0000-0000-0000-000000000002';
select pg_temp.assert((select age_class from registrations where climber_id = '00000000-0000-0000-0000-000000000002'
  and category_id = '20000000-0000-0000-0000-000000000001') = 'U19', 'admin sets an age class');
-- ties at the cutoff all advance: quota 1, both climbers tied for 1st in a fresh category
insert into categories (id, competition_id, name, gender) values
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 'Tie Men', 'male');
insert into rounds (id, category_id, kind, status) values
  ('30000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000004', 'qualification', 'closed');
insert into rounds (id, category_id, kind, status, advance_quota) values
  ('30000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000004', 'final', 'planned', 1);
insert into registrations (category_id, climber_id, bib) values
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 1),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 2);
select generate_start_list('30000000-0000-0000-0000-000000000007');
select pg_temp.assert((select count(*) from round_starters where round_id = '30000000-0000-0000-0000-000000000007') = 2,
  'climbers tied at the cutoff all advance');
delete from registrations where category_id = '20000000-0000-0000-0000-000000000004'
  and climber_id = '00000000-0000-0000-0000-000000000002';
select pg_temp.assert(not exists (select 1 from round_starters where round_id = '30000000-0000-0000-0000-000000000006'
  and climber_id = '00000000-0000-0000-0000-000000000002'), 'unregistering removes the first-round starter');
reset role;

select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.denied($$select generate_start_list('30000000-0000-0000-0000-000000000005')$$, 'climber generates a start list');
select pg_temp.assert((select count(*) from round_starters where round_id = '30000000-0000-0000-0000-000000000003') = 2,
  'start lists of public rounds are readable');
reset role;
-- results only for climbers on the round's start list (Tamar did not advance to the semi-final)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into boulders (id, round_id, number) values
  ('40000000-0000-0000-0000-000000000051', '30000000-0000-0000-0000-000000000005', 1);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.denied($$insert into boulder_results (boulder_id, climber_id, round_id, attempts)
  values ('40000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000002',
          '30000000-0000-0000-0000-000000000005', 1)$$, 'result for a climber not on the start list');
reset role;

-- ---------------------------------------------------------------- profiles without accounts
-- Admin imports a climber who has no login, registers them, later links a parent's new account.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into profiles (id, full_name, club) values
  ('50000000-0000-0000-0000-000000000001', 'Imported Kid', 'Haifa Climbing');
insert into profile_private (id, email, medical_notes) values
  ('50000000-0000-0000-0000-000000000001', 'kid@test', 'peanut allergy');
insert into registrations values
  ('20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 3);
select pg_temp.assert((select user_id from profiles where id = '50000000-0000-0000-0000-000000000001') is null,
  'admin creates a climber profile without an account');
select pg_temp.assert(
  (select count(*) from admin_accounts() where email in ('noa@test', 'judge@test')) = 2,
  'admin lists accounts with emails');
select pg_temp.denied($$update profiles set user_id = '00000000-0000-0000-0000-00000000000a'
  where id = '50000000-0000-0000-0000-000000000001'$$, 'admin sets user_id directly (must use link_account)');
reset role;

select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.denied($$select * from admin_accounts()$$, 'climber lists accounts');
select pg_temp.denied($$select link_account('50000000-0000-0000-0000-000000000001', auth.uid())$$,
  'climber links themselves to another profile');
select pg_temp.denied($$update profiles set user_id = null where id = auth.uid()$$, 'climber unlinks own profile');
select pg_temp.assert(not exists (select 1 from profile_private where id = '50000000-0000-0000-0000-000000000001'),
  'climber cannot read an unlinked profile''s private data');
update profiles set club = 'Tel Aviv Boulders' where id = auth.uid();
select pg_temp.assert((select club from profiles where id = auth.uid()) = 'Tel Aviv Boulders',
  'climber still edits own public profile');
reset role;

-- a parent signs up (trigger creates an empty profile), admin links the imported profile
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000f', 'kid@test', '{"full_name":"Kid"}');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select link_account('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000f');
select pg_temp.assert(
  (select user_id from profiles where id = '50000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-00000000000f'
  and not exists (select 1 from profiles where id = '00000000-0000-0000-0000-00000000000f'),
  'link_account attaches the account and drops its empty auto profile');
select pg_temp.denied($$select link_account('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')$$,
  'link_account refuses an account whose own profile has data');
reset role;

select pg_temp.login('00000000-0000-0000-0000-00000000000f');
select pg_temp.assert(my_profile_id() = '50000000-0000-0000-0000-000000000001', 'linked account resolves its profile');
select pg_temp.assert((select medical_notes from profile_private) = 'peanut allergy',
  'linked account reads its private data');
select pg_temp.assert(
  (select count(*) from climber_history where climber_id = my_profile_id() and round = 'qualification') = 1,
  'linked account sees its history');
reset role;

-- roster import is one transaction, under the caller's RLS
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select import_roster(
  '[{"id":"20000000-0000-0000-0000-000000000009","competition_id":"10000000-0000-0000-0000-000000000001","name":"U19 Girls","name_he":null,"gender":"female"}]',
  '[{"id":"50000000-0000-0000-0000-000000000002","full_name":"Roster Kid","full_name_he":null,"club":"X","gender":"female"}]',
  '[{"id":"50000000-0000-0000-0000-000000000002","birth_date":"2009-01-02","email":null}]',
  '[{"category_id":"20000000-0000-0000-0000-000000000009","climber_id":"50000000-0000-0000-0000-000000000002","bib":7,"age_class":"U17"}]');
select pg_temp.assert(
  (select bib from registrations where climber_id = '50000000-0000-0000-0000-000000000002') = 7,
  'admin imports a roster (category, profile, private row, registration)');
select pg_temp.assert(
  (select age_class from registrations where climber_id = '50000000-0000-0000-0000-000000000002') = 'U17'
  and exists (select 1 from round_starters s join rounds r on r.id = s.round_id
              where s.climber_id = '50000000-0000-0000-0000-000000000002') is false,
  'roster import keeps the age class (no rounds yet, so no starters)');
select pg_temp.denied($$select import_roster('[]',
  '[{"id":"50000000-0000-0000-0000-000000000004","full_name":"Half Import","full_name_he":null,"club":null,"gender":null}]', '[]',
  '[{"category_id":"20000000-0000-0000-0000-000000000009","climber_id":"50000000-0000-0000-0000-000000000002","bib":8}]')$$,
  'roster import with a duplicate registration');
select pg_temp.assert(not exists (select 1 from profiles where id = '50000000-0000-0000-0000-000000000004'),
  'failed roster import leaves nothing behind');
reset role;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.denied($$select import_roster('[]',
  '[{"id":"50000000-0000-0000-0000-000000000003","full_name":"Sneaky","full_name_he":null,"club":null,"gender":null}]', '[]', '[]')$$,
  'climber imports a roster');
reset role;

-- admin corrects a result after the round closed; the audit records the admin
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
update boulder_results set attempts = 2, zone_attempt = 1, top_attempt = 2
  where boulder_id = '40000000-0000-0000-0000-000000000041' and climber_id = '00000000-0000-0000-0000-000000000001';
select pg_temp.assert(
  (select judge_id from score_events where boulder_id = '40000000-0000-0000-0000-000000000041'
     and climber_id = '00000000-0000-0000-0000-000000000001' order by id desc limit 1) = my_profile_id(),
  'admin correction on a closed round is audited with the admin');
reset role;

-- coach linked by profile id (not account id)
insert into coach_athletes values ('00000000-0000-0000-0000-00000000000c', '50000000-0000-0000-0000-000000000001');
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.assert(exists (select 1 from profile_private where id = '50000000-0000-0000-0000-000000000001'),
  'coach reads linked imported athlete');
reset role;

-- ---------------------------------------------------------------- function privileges (Supabase advisors)
-- Supabase grants EXECUTE on new functions to anon directly; admin-only and trigger functions must not keep it.
select pg_temp.assert(not has_function_privilege('anon', f, 'execute'), 'anon cannot execute ' || f)
from unnest(array['public.admin_accounts()', 'public.link_account(uuid,uuid)', 'public.unlink_account(uuid)',
                  'public.import_roster(jsonb,jsonb,jsonb,jsonb)', 'public.generate_start_list(uuid)']) f;
select pg_temp.assert(not has_function_privilege(r, f, 'execute'), r || ' cannot execute trigger ' || f)
from unnest(array['anon', 'authenticated']) r,
     unnest(array['public.handle_new_user()', 'public.boulder_results_stamp()',
                  'public.boulder_results_check_registration()', 'public.registrations_sync_starters()',
                  'public.rounds_seed_starters()']) f;
select pg_temp.assert(has_function_privilege('authenticated', 'public.admin_accounts()', 'execute')
  and has_function_privilege('anon', 'public.has_role(public.app_role)', 'execute'),
  'admins (authenticated) keep admin RPCs; RLS helpers stay executable');

\echo ALL RLS TESTS PASSED
