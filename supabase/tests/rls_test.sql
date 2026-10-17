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
select pg_temp.assert((select count(*) from round_scores where round_id = '30000000-0000-0000-0000-000000000006' and rank is null) = 2,
  'starters without any result are unranked (like the results page)');
select generate_start_list('30000000-0000-0000-0000-000000000007');
select pg_temp.assert((select count(*) from round_starters where round_id = '30000000-0000-0000-0000-000000000007') = 0,
  'climbers without results do not advance');
insert into boulders (id, round_id, number) values
  ('40000000-0000-0000-0000-000000000066', '30000000-0000-0000-0000-000000000006', 1);
insert into boulder_results (boulder_id, climber_id, round_id, attempts, zone_attempt) values
  ('40000000-0000-0000-0000-000000000066', '00000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000006', 1, 1),
  ('40000000-0000-0000-0000-000000000066', '00000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000006', 1, 1);
select generate_start_list('30000000-0000-0000-0000-000000000007');
select pg_temp.assert((select count(*) from round_starters where round_id = '30000000-0000-0000-0000-000000000007') = 2,
  'climbers tied at the cutoff all advance');
insert into registrations (category_id, climber_id, bib) values
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000c', 3);
delete from registrations where category_id = '20000000-0000-0000-0000-000000000004'
  and climber_id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.assert(not exists (select 1 from round_starters where round_id = '30000000-0000-0000-0000-000000000006'
  and climber_id = '00000000-0000-0000-0000-00000000000c'), 'unregistering removes the first-round starter');
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
select pg_temp.denied($$select * from account_by_email('noa@test')$$, 'climber looks up an account by email');
reset role;
set role service_role;
select pg_temp.assert((select count(*) from account_by_email(' NOA@test ')) = 1, 'invite-judge (service role) finds an account by email');
reset role;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
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

-- ---------------------------------------------------------------- lead
-- Same cases as src/lib/lead.test.ts.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into profiles (id, full_name) values
  ('60000000-0000-0000-0000-00000000000a', 'Lead A'), ('60000000-0000-0000-0000-00000000000b', 'Lead B'),
  ('60000000-0000-0000-0000-00000000000c', 'Lead C'), ('60000000-0000-0000-0000-00000000000d', 'Lead D');
insert into categories (id, competition_id, name, gender) values
  ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'Lead Open', 'mixed');
-- single-route final with seeds a=5, b=2 (start list written directly, as an import would)
insert into rounds (id, category_id, kind, status, scoring) values
  ('30000000-0000-0000-0000-000000000061', '20000000-0000-0000-0000-000000000006', 'final', 'live', 'lead'),
  ('30000000-0000-0000-0000-000000000062', '20000000-0000-0000-0000-000000000006', 'qualification', 'live', 'lead');
insert into boulders (id, round_id, number) values
  ('40000000-0000-0000-0000-000000000061', '30000000-0000-0000-0000-000000000061', 1),
  ('40000000-0000-0000-0000-000000000062', '30000000-0000-0000-0000-000000000062', 1),
  ('40000000-0000-0000-0000-000000000063', '30000000-0000-0000-0000-000000000062', 2);
insert into registrations (category_id, climber_id) values
  ('20000000-0000-0000-0000-000000000006', '60000000-0000-0000-0000-00000000000a'),
  ('20000000-0000-0000-0000-000000000006', '60000000-0000-0000-0000-00000000000b'),
  ('20000000-0000-0000-0000-000000000006', '60000000-0000-0000-0000-00000000000c'),
  ('20000000-0000-0000-0000-000000000006', '60000000-0000-0000-0000-00000000000d');
insert into round_starters (round_id, climber_id, start_order, prev_place) values
  ('30000000-0000-0000-0000-000000000061', '60000000-0000-0000-0000-00000000000a', 1, 5),
  ('30000000-0000-0000-0000-000000000061', '60000000-0000-0000-0000-00000000000b', 2, 2),
  ('30000000-0000-0000-0000-000000000061', '60000000-0000-0000-0000-00000000000c', 3, null),
  ('30000000-0000-0000-0000-000000000061', '60000000-0000-0000-0000-00000000000d', 4, null);
insert into lead_results (boulder_id, climber_id, round_id, hold, plus, top) values
  ('40000000-0000-0000-0000-000000000061', '60000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000061', 30, true, false),
  ('40000000-0000-0000-0000-000000000061', '60000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-000000000061', 30, true, false),
  ('40000000-0000-0000-0000-000000000061', '60000000-0000-0000-0000-00000000000c', '30000000-0000-0000-0000-000000000061', 40, false, true),
  ('40000000-0000-0000-0000-000000000061', '60000000-0000-0000-0000-00000000000d', '30000000-0000-0000-0000-000000000061', 30, true, false),
-- two-route qualification: route 1 a>b>c, route 2 c>b>a (d registered, never climbs)
  ('40000000-0000-0000-0000-000000000062', '60000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000062', 40, false, false),
  ('40000000-0000-0000-0000-000000000062', '60000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-000000000062', 30, false, false),
  ('40000000-0000-0000-0000-000000000062', '60000000-0000-0000-0000-00000000000c', '30000000-0000-0000-0000-000000000062', 20, false, false),
  ('40000000-0000-0000-0000-000000000063', '60000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000062', 10, false, false),
  ('40000000-0000-0000-0000-000000000063', '60000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-000000000062', 20, false, false),
  ('40000000-0000-0000-0000-000000000063', '60000000-0000-0000-0000-00000000000c', '30000000-0000-0000-0000-000000000062', 30, false, false);
select set_config('request.jwt.claim.sub', '', false);

select pg_temp.login(null);
select pg_temp.assert(
  (select array_agg(right(climber_id::text, 1) || rank order by rank, climber_id) from lead_scores
    where round_id = '30000000-0000-0000-0000-000000000061') = '{c1,b2,a3,d4}',
  'lead single route: height (TOP > 30+), then countback');
select pg_temp.assert(
  (select array_agg(right(climber_id::text, 1) || coalesce(rank::text, '-') || ':' || coalesce(round(points, 2)::text, '')
     order by rank nulls last, climber_id) from lead_scores
    where round_id = '30000000-0000-0000-0000-000000000062') = '{a1:1.73,c1:1.73,b3:2.00,d-:}',
  'lead two routes: geometric mean of route ranks, ties share, not climbed unranked');
select pg_temp.assert((select count(*) from round_ranks where round_id = '30000000-0000-0000-0000-000000000062' and rank is not null) = 3
  and not exists (select 1 from round_scores where round_id = '30000000-0000-0000-0000-000000000062'),
  'lead rounds rank in round_ranks, not in the boulder view');
select pg_temp.denied($$select updated_by from lead_results$$, 'public reads lead judge identity');
reset role;
-- single route, same height and same seed: in a final the faster time ranks higher (IFSC rule;
-- LogLig 2026 final); in other rounds the tie stands (LogLig 2024-25 semifinals)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into categories (id, competition_id, name, gender) values
  ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'Lead Youth', 'mixed');
insert into rounds (id, category_id, kind, status, scoring) values
  ('30000000-0000-0000-0000-000000000063', '20000000-0000-0000-0000-000000000006', 'semifinal', 'live', 'lead'),
  ('30000000-0000-0000-0000-000000000065', '20000000-0000-0000-0000-000000000008', 'final', 'live', 'lead');
insert into boulders (id, round_id, number) values
  ('40000000-0000-0000-0000-000000000064', '30000000-0000-0000-0000-000000000063', 1),
  ('40000000-0000-0000-0000-000000000067', '30000000-0000-0000-0000-000000000065', 1);
insert into round_starters (round_id, climber_id, start_order, prev_place) values
  ('30000000-0000-0000-0000-000000000063', '60000000-0000-0000-0000-00000000000a', 1, 3),
  ('30000000-0000-0000-0000-000000000063', '60000000-0000-0000-0000-00000000000b', 2, 3),
  ('30000000-0000-0000-0000-000000000065', '60000000-0000-0000-0000-00000000000a', 1, 3),
  ('30000000-0000-0000-0000-000000000065', '60000000-0000-0000-0000-00000000000b', 2, 3);
insert into lead_results (boulder_id, climber_id, round_id, hold, plus, top, time_ms) values
  ('40000000-0000-0000-0000-000000000064', '60000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000063', 35, true, false, 188000),
  ('40000000-0000-0000-0000-000000000064', '60000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-000000000063', 35, true, false, 130000),
  ('40000000-0000-0000-0000-000000000067', '60000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000065', 35, true, false, 188000),
  ('40000000-0000-0000-0000-000000000067', '60000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-000000000065', 35, true, false, 130000);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.login(null);
select pg_temp.assert(
  (select array_agg(right(climber_id::text, 1) || rank order by rank) from lead_scores
    where round_id = '30000000-0000-0000-0000-000000000065') = '{b1,a2}',
  'lead final: faster time breaks a tie after countback');
select pg_temp.assert(
  (select array_agg(right(climber_id::text, 1) || rank order by climber_id) from lead_scores
    where round_id = '30000000-0000-0000-0000-000000000063') = '{a1,b1}',
  'lead semifinal: time does not break a tie');
reset role;
update rounds set time_tiebreak = false where id = '30000000-0000-0000-0000-000000000065';
select pg_temp.login(null);
select pg_temp.assert(
  (select array_agg(right(climber_id::text, 1) || rank order by climber_id) from lead_scores
    where round_id = '30000000-0000-0000-0000-000000000065') = '{a1,b1}',
  'lead final without time tie-break (imported LogLig 2022-23 finals): the tie stands');
reset role;
update rounds set time_tiebreak = true where id = '30000000-0000-0000-0000-000000000065';
select pg_temp.login(null);
select pg_temp.assert(
  (select count(*) from climber_history where climber_id = '60000000-0000-0000-0000-00000000000c'
     and discipline = 'lead' and round_id is not null) = 2,
  'public climber page: lead history rows with round links');
reset role;

select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.denied($$update lead_results set hold = 50 where round_id = '30000000-0000-0000-0000-000000000061'$$,
  'climber edits lead results');
reset role;
select pg_temp.assert((select count(*) from lead_events where round_id = '30000000-0000-0000-0000-000000000061') = 4,
  'every lead score change is audited');
select pg_temp.denied($$insert into lead_results (boulder_id, climber_id, round_id, hold, plus, top)
  values ('40000000-0000-0000-0000-000000000063', '60000000-0000-0000-0000-00000000000d', '30000000-0000-0000-0000-000000000062', 1, true, true)$$,
  'lead TOP with plus rejected');

-- ---------------------------------------------------------------- qualification groups
-- IFSC-style: two qualification groups ranked separately; advancement takes the top from each group.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into profiles (id, full_name) values
  ('70000000-0000-0000-0000-000000000001', 'G A1'), ('70000000-0000-0000-0000-000000000002', 'G A2'),
  ('70000000-0000-0000-0000-000000000003', 'G B1'), ('70000000-0000-0000-0000-000000000004', 'G B2');
insert into categories (id, competition_id, name, gender) values
  ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'Groups', 'male');
insert into rounds (id, category_id, kind, status) values
  ('30000000-0000-0000-0000-000000000071', '20000000-0000-0000-0000-000000000007', 'qualification', 'closed');
insert into rounds (id, category_id, kind, status, advance_quota) values
  ('30000000-0000-0000-0000-000000000072', '20000000-0000-0000-0000-000000000007', 'final', 'planned', 2);
insert into boulders (id, round_id, number) values
  ('40000000-0000-0000-0000-000000000071', '30000000-0000-0000-0000-000000000071', 1);
insert into registrations (category_id, climber_id) select '20000000-0000-0000-0000-000000000007', id
  from profiles where id::text like '70000000-%';
update round_starters set group_label = case when climber_id::text in ('70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002') then 'A' else 'B' end
  where round_id = '30000000-0000-0000-0000-000000000071';
-- group A: A1 tops (25), A2 zone (10); group B: B1 zone (10), B2 zone on 2 (9.9)
insert into boulder_results (boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt) values
  ('40000000-0000-0000-0000-000000000071', '70000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000071', 1, 1, 1),
  ('40000000-0000-0000-0000-000000000071', '70000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000071', 1, 1, null),
  ('40000000-0000-0000-0000-000000000071', '70000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000071', 1, 1, null),
  ('40000000-0000-0000-0000-000000000071', '70000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000071', 2, 2, null);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.assert(
  (select array_agg(right(climber_id::text, 1) || ':' || rank order by climber_id) from round_scores
    where round_id = '30000000-0000-0000-0000-000000000071') = '{1:1,2:2,3:1,4:2}',
  'qualification groups are ranked separately');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select generate_start_list('30000000-0000-0000-0000-000000000072');
select pg_temp.assert(
  (select array_agg(right(climber_id::text, 1) || ':' || prev_place order by climber_id) from round_starters
    where round_id = '30000000-0000-0000-0000-000000000072') = '{1:1,3:1}',
  'advancement from groups takes the top of each group (quota split evenly)');
reset role;

-- ---------------------------------------------------------------- totals-only rounds (LogLig history)
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into rounds (id, category_id, kind, status, scoring) values
  ('30000000-0000-0000-0000-000000000081', '20000000-0000-0000-0000-000000000008', 'qualification', 'closed', 'classic');
insert into round_starters (round_id, climber_id, start_order) values
  ('30000000-0000-0000-0000-000000000081', '60000000-0000-0000-0000-00000000000a', 1),
  ('30000000-0000-0000-0000-000000000081', '60000000-0000-0000-0000-00000000000b', 2),
  ('30000000-0000-0000-0000-000000000081', '60000000-0000-0000-0000-00000000000c', 3),
  ('30000000-0000-0000-0000-000000000081', '60000000-0000-0000-0000-00000000000d', 4)
  on conflict do nothing;
insert into round_totals (round_id, climber_id, tops, zones, top_attempts, zone_attempts) values
  ('30000000-0000-0000-0000-000000000081', '60000000-0000-0000-0000-00000000000a', 1, 2, 3, 5),
  ('30000000-0000-0000-0000-000000000081', '60000000-0000-0000-0000-00000000000b', 2, 3, 3, 5),
  ('30000000-0000-0000-0000-000000000081', '60000000-0000-0000-0000-00000000000c', 1, 2, 3, 5);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.login(null);
select pg_temp.assert(
  (select array_agg(right(climber_id::text, 1) || coalesce(rank::text, '-') || ':' || tops || 'T' || zones || 'Z'
     order by climber_id) from round_scores
    where round_id = '30000000-0000-0000-0000-000000000081') = '{a2:1T2Z,b1:2T3Z,c2:1T2Z,d-:0T0Z}',
  'totals-only round: ranked from stored totals (T, Z, attempts), no total = unranked');
select pg_temp.assert(
  (select count(*) from round_totals where round_id = '30000000-0000-0000-0000-000000000081') = 3,
  'public reads totals of a public round');
select pg_temp.assert(
  (select rank from climber_history where climber_id = '60000000-0000-0000-0000-00000000000b'
     and round_id = '30000000-0000-0000-0000-000000000081') = 1,
  'totals-only rounds appear in climber history');
select pg_temp.denied($$insert into round_totals values
  ('30000000-0000-0000-0000-000000000081', '60000000-0000-0000-0000-00000000000d', 9, 9, 9, 9)$$, 'anon writes totals');
select pg_temp.login('00000000-0000-0000-0000-000000000002');
select pg_temp.denied($$update round_totals set tops = 5 where climber_id = '60000000-0000-0000-0000-00000000000a'$$,
  'climber edits totals');
reset role;

-- classic: countback breaks a full tie only in a final (same case as scoring.test.ts)
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into categories (id, competition_id, name, gender) values
  ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000001', 'Classic', 'mixed');
insert into rounds (id, category_id, kind, status, scoring) values
  ('30000000-0000-0000-0000-000000000082', '20000000-0000-0000-0000-0000000000c1', 'semifinal', 'closed', 'classic'),
  ('30000000-0000-0000-0000-000000000083', '20000000-0000-0000-0000-0000000000c1', 'final', 'closed', 'classic');
insert into round_starters (round_id, climber_id, start_order, prev_place)
select r, c, o, p from (values
  ('30000000-0000-0000-0000-000000000082'::uuid, '60000000-0000-0000-0000-00000000000a'::uuid, 1, 4),
  ('30000000-0000-0000-0000-000000000082', '60000000-0000-0000-0000-00000000000b', 2, 2),
  ('30000000-0000-0000-0000-000000000083', '60000000-0000-0000-0000-00000000000a', 1, 4),
  ('30000000-0000-0000-0000-000000000083', '60000000-0000-0000-0000-00000000000b', 2, 2)) v(r, c, o, p)
on conflict (round_id, climber_id) do update set prev_place = excluded.prev_place;
insert into round_totals
select r, c, 1, 2, 3, 5 from unnest(array['30000000-0000-0000-0000-000000000082', '30000000-0000-0000-0000-000000000083']::uuid[]) r,
  unnest(array['60000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-00000000000b']::uuid[]) c;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.assert((select array_agg(rank order by climber_id) from round_scores
  where round_id = '30000000-0000-0000-0000-000000000082') = '{1,1}', 'classic semifinal: a full tie stands');
select pg_temp.assert((select array_agg(right(climber_id::text, 1) || rank order by rank) from round_scores
  where round_id = '30000000-0000-0000-0000-000000000083') = '{b1,a2}', 'classic final: countback breaks a full tie');

-- ---------------------------------------------------------------- claims, locked results, appeals
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b2', 'judge2@test', '{"full_name":"Judge Two"}');
insert into user_roles values ('00000000-0000-0000-0000-0000000000b2', 'judge');
insert into judge_assignments (round_id, boulder_id, judge_id) values
  ('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2');
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
select pg_temp.assert((select judge_name from claim_climber('30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')) = 'Judge', 'judge claims a climber');
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select pg_temp.assert((select judge_name from claim_climber('30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')) = 'Judge',
  'a second judge sees the climber is held by the first');
select pg_temp.assert((select count(*) from judge_claims) = 1, 'judges of the boulder see its claims');
select pg_temp.denied($$select set_on_wall('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', true)$$, 'a judge marks a climber another judge holds');
select pg_temp.login(null);
select pg_temp.assert(not exists (select 1 from on_wall('30000000-0000-0000-0000-000000000001')), 'a claim alone does not put a climber on the wall');
select pg_temp.denied($$select set_on_wall('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', true)$$, 'public marks a climber on the wall');
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
select set_on_wall('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', true);
select pg_temp.login(null);
select pg_temp.assert((select array_agg(right(boulder_id::text, 1) || ':' || right(climber_id::text, 1)) from on_wall('30000000-0000-0000-0000-000000000001'))
  = '{1:2}', 'public sees who is on the wall (boulder, climber; no judge)');
select pg_temp.denied($$select * from judge_claims$$, 'public reads judge claims');
reset role;
update rounds set status = 'closed' where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.login(null);
select pg_temp.assert(not exists (select 1 from on_wall('30000000-0000-0000-0000-000000000001')), 'nobody is on the wall in a closed round');
reset role;
update rounds set status = 'live' where id = '30000000-0000-0000-0000-000000000001';
reset role;
update judge_claims set claimed_at = now() - interval '31 seconds';
select pg_temp.login(null);
select pg_temp.assert(not exists (select 1 from on_wall('30000000-0000-0000-0000-000000000001')), 'a stale claim is not on the wall');
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select pg_temp.assert((select judge_name from claim_climber('30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')) = 'Judge Two',
  'a stale claim (30+ seconds) can be taken over');
select pg_temp.assert((select on_wall_since is null from judge_claims), 'a takeover clears the on-the-wall mark');
select release_claim('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
select pg_temp.assert(not exists (select 1 from judge_claims), 'judge releases own claim');
select pg_temp.denied($$select claim_climber('30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002')$$, 'judge claims on an unassigned boulder');
select pg_temp.login(null);
select pg_temp.denied($$select claim_climber('30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')$$, 'anon claims a climber');

select pg_temp.login('00000000-0000-0000-0000-00000000000e');
update boulder_results set locked = true
  where boulder_id = '40000000-0000-0000-0000-000000000001' and climber_id = '00000000-0000-0000-0000-000000000002';
select pg_temp.denied($$update boulder_results set attempts = attempts + 1
  where boulder_id = '40000000-0000-0000-0000-000000000001' and climber_id = '00000000-0000-0000-0000-000000000002'$$,
  'judge changes a locked result');
select claim_climber('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
select set_on_wall('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', true);
select pg_temp.login(null);
select pg_temp.assert(not exists (select 1 from on_wall('30000000-0000-0000-0000-000000000001')), 'a climber with a locked result is off the wall');
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
select claim_climber('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
select set_on_wall('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', true);
select pg_temp.assert((select array_agg(right(climber_id::text, 1)) from judge_claims where on_wall_since is not null) = '{1}',
  'one climber per boulder: marking the next takes the previous off');
select set_on_wall('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', false);
select pg_temp.login(null);
select pg_temp.assert(not exists (select 1 from on_wall('30000000-0000-0000-0000-000000000001')), 'the judge marks a climber off the wall');
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
select release_claim('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
select release_claim('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
update boulder_results set attempts = attempts + 1, locked = false
  where boulder_id = '40000000-0000-0000-0000-000000000001' and climber_id = '00000000-0000-0000-0000-000000000002';
select pg_temp.assert((select not locked from boulder_results
  where boulder_id = '40000000-0000-0000-0000-000000000001' and climber_id = '00000000-0000-0000-0000-000000000002'),
  'admin corrects and unlocks a locked result');
select pg_temp.login(null);
select pg_temp.assert((select count(*) from boulder_results where locked is not null) > 0, 'public reads whether a result is final');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into appeals (id, round_id, boulder_id, climber_id) values ('a0000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
insert into appeal_details (appeal_id, reason, created_by)
  values ('a0000000-0000-0000-0000-000000000001', 'zone was held', '00000000-0000-0000-0000-00000000000a');
select pg_temp.login(null);
select pg_temp.assert((select status::text from appeals where id = 'a0000000-0000-0000-0000-000000000001') = 'open',
  'public sees an open appeal');
select pg_temp.denied($$select reason from appeal_details$$, 'public reads appeal reasons');
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
select pg_temp.denied($$insert into appeals (round_id, climber_id)
  values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001')$$, 'judge opens an appeal');
select pg_temp.assert(not exists (select 1 from appeal_details), 'judge does not read appeal reasons');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
update appeals set status = 'upheld', resolved_at = now() where id = 'a0000000-0000-0000-0000-000000000001';
select pg_temp.assert((select status::text from appeals where id = 'a0000000-0000-0000-0000-000000000001') = 'upheld',
  'admin resolves an appeal');
reset role;

-- ---------------------------------------------------------------- national rankings
reset role;
update competitions set season = '2026-27', series = 'premier_league' where id = '10000000-0000-0000-0000-000000000001';
insert into profile_private (id, birth_date) values
  ('60000000-0000-0000-0000-00000000000a', '2009-05-01'),  -- U19 in 2026-27 (age 18)
  ('60000000-0000-0000-0000-00000000000b', '1990-01-01')   -- senior
  on conflict (id) do update set birth_date = excluded.birth_date;
insert into profiles (id, full_name) values ('60000000-0000-0000-0000-0000000000e1', 'No Results');
insert into profile_private (id, birth_date) values ('60000000-0000-0000-0000-0000000000e1', '2010-01-01')
  on conflict (id) do update set birth_date = excluded.birth_date;
select pg_temp.login(null);
select pg_temp.assert(
  (select count(*) from ranking_rounds where competition_id = '10000000-0000-0000-0000-000000000001' and rank is not null) > 0
  and not exists (select 1 from ranking_rounds where season is null),
  'public reads ranking rounds of seasonal competitions');
select pg_temp.assert(
  (select array_agg(right(climber_id::text, 2) || ':' || age_class order by climber_id) from season_age_classes('2026-27'))
    = '{0a:U19}',
  'age classes: only the class, only climbers with a public result that season');
select pg_temp.assert(not exists (select 1 from season_senior_too_young('2026-27')),
  'senior minimum: 18 in 2027 is old enough');
reset role;
update profile_private set birth_date = '2011-05-01' where id = '60000000-0000-0000-0000-00000000000a';
select pg_temp.login(null);
select pg_temp.assert(
  (select array_agg(right(climber_id::text, 2)) from season_senior_too_young('2026-27')) = '{0a}',
  'senior minimum: 16 in 2027 is below 17; only climbers with a public result that season');
reset role;
update profile_private set birth_date = '2009-05-01' where id = '60000000-0000-0000-0000-00000000000a';
update competitions set series = 'other' where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.login(null);
select pg_temp.assert(not exists (select 1 from season_senior_too_young('2026-27')),
  'senior minimum: nothing for climbers who only competed in unranked events');
select pg_temp.assert(not exists (select 1 from season_age_classes('2026-27')),
  'age classes: nothing for climbers who only competed in unranked events');
reset role;
update competitions set series = 'premier_league' where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.login(null);
select pg_temp.denied($$select birth_date from profile_private$$, 'anon reads birth dates');
select pg_temp.denied($$insert into international_results (climber_id, season, discipline, event_type, event_name, starts_on, place, field_size)
  values ('60000000-0000-0000-0000-00000000000a', '2026-27', 'lead', 'world_cup', 'WC', '2026-06-01', 1, 50)$$, 'anon adds international results');
select pg_temp.login('00000000-0000-0000-0000-000000000002');
select pg_temp.denied($$insert into ranking_adjustments (climber_id, season, discipline, points, note)
  values ('00000000-0000-0000-0000-000000000002', '2026-27', 'lead', 500, 'me')$$, 'climber adjusts own ranking');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into international_results (climber_id, season, discipline, event_type, event_name, starts_on, place, field_size, reached)
  values ('60000000-0000-0000-0000-00000000000a', '2026-27', 'lead', 'european_youth_cup', 'EYC Imst', '2026-06-01', 3, 40, 'final');
select pg_temp.login(null);
select pg_temp.assert((select count(*) from international_results) = 1, 'admin adds international results; public reads them');
select pg_temp.assert(
  (select count(*) from (select * from season_ranking_rounds('2026-27')
                         except all select * from ranking_rounds where season = '2026-27') d) = 0
  and (select count(*) from season_ranking_rounds('2026-27')) = (select count(*) from ranking_rounds where season = '2026-27')
  and (select count(*) from season_ranking_rounds('2026-27')) > 0,
  'season_ranking_rounds() returns exactly the season''s ranking_rounds rows');
select pg_temp.assert(
  (select count(*) from (select * from round_ranks_for(array(select id from rounds)) except all select * from round_ranks) d) = 0
  and (select count(*) from round_ranks_for(array(select id from rounds))) = (select count(*) from round_ranks),
  'round_ranks_for() returns exactly round_ranks for the given rounds');
select pg_temp.assert(
  (select count(*) from (select * from climber_history_for(array(select id from profiles))
                         except all select * from climber_history) d) = 0
  and (select count(*) from climber_history_for(array['60000000-0000-0000-0000-00000000000a'::uuid]))
    = (select count(*) from climber_history where climber_id = '60000000-0000-0000-0000-00000000000a')
  and (select count(*) from climber_history where climber_id = '60000000-0000-0000-0000-00000000000a') > 0,
  'climber_history_for() returns exactly the climbers'' climber_history rows');
reset role;
update competitions set season = null, series = 'other' where id = '10000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------- round_page(): one call per round page
select pg_temp.login(null);
select pg_temp.assert(
  jsonb_array_length(round_page('30000000-0000-0000-0000-000000000001') -> 'results')
    = (select count(*) from boulder_results where round_id = '30000000-0000-0000-0000-000000000001')
  and jsonb_array_length(round_page('30000000-0000-0000-0000-000000000001') -> 'starters')
    = (select count(*) from round_starters where round_id = '30000000-0000-0000-0000-000000000001')
  and jsonb_array_length(round_page('30000000-0000-0000-0000-000000000001') -> 'boulders')
    = (select count(*) from boulders where round_id = '30000000-0000-0000-0000-000000000001'),
  'round_page returns the same rows as the separate queries');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(round_page('30000000-0000-0000-0000-000000000001') -> 'results') e
  where e ? 'updated_by'), 'round_page never returns who entered a score');
select pg_temp.assert(jsonb_array_length(round_page('30000000-0000-0000-0000-000000000002') -> 'results') = 0,
  'round_page: no results of a planned round');
reset role;
insert into rounds (id, category_id, kind, status) values
  ('3d000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'qualification', 'live');
select pg_temp.login(null);
select pg_temp.assert(round_page('3d000000-0000-0000-0000-000000000001') is null, 'round_page: nothing of a draft competition');
select pg_temp.assert(jsonb_array_length(round_page('30000000-0000-0000-0000-000000000001') -> 'categories') >= 1,
  'round_page lists the competition''s categories');
reset role;

-- ---------------------------------------------------------------- deleting an account (service role)
reset role;
insert into profiles (id, full_name) values ('dddd0000-0000-0000-0000-000000000001', 'Former Judge'), ('dddd0000-0000-0000-0000-000000000002', 'Scorer');
set session_replication_role = replica; -- skip the stamp trigger: mark X2 as having entered a score
update boulder_results set updated_by = 'dddd0000-0000-0000-0000-000000000002'
  where (boulder_id, climber_id) = (select boulder_id, climber_id from boulder_results limit 1);
set session_replication_role = default;
set role service_role;
-- (separate statements: a statement sees the data as it was when it started)
select pg_temp.assert(delete_account_profile('dddd0000-0000-0000-0000-000000000001'), 'delete_account_profile removes a profile without climbing data');
select pg_temp.assert(not exists (select 1 from profiles where id = 'dddd0000-0000-0000-0000-000000000001'), 'a deleted account''s empty profile is gone');
select pg_temp.assert(not delete_account_profile('50000000-0000-0000-0000-000000000001'), 'a profile with registrations is kept');
select pg_temp.assert(exists (select 1 from profiles where id = '50000000-0000-0000-0000-000000000001'), 'the registered profile is still there');
select pg_temp.assert(not delete_account_profile('dddd0000-0000-0000-0000-000000000002'), 'a profile that entered scores is kept');
select pg_temp.assert(exists (select 1 from profiles where id = 'dddd0000-0000-0000-0000-000000000002'), 'the scorer profile is still there');
select pg_temp.assert(not delete_account_profile('00000000-0000-0000-0000-00000000000e'),
  'a profile still linked to a login is kept');
reset role;
insert into profiles (id, full_name) values ('dddd0000-0000-0000-0000-000000000003', 'Coach'),
  ('dddd0000-0000-0000-0000-000000000004', 'Has birth date');
insert into coach_notes (coach_id, climber_id, body) values
  ('dddd0000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 'works on heel hooks');
insert into profile_private (id, birth_date) values ('dddd0000-0000-0000-0000-000000000004', '2010-01-01');
set role service_role;
select pg_temp.assert(not delete_account_profile('dddd0000-0000-0000-0000-000000000003'), 'a profile with coach notes is kept');
select pg_temp.assert(exists (select 1 from coach_notes where coach_id = 'dddd0000-0000-0000-0000-000000000003'), 'the coach notes are still there');
select pg_temp.assert(not delete_account_profile('dddd0000-0000-0000-0000-000000000004'), 'a profile with private data is kept');
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.denied($$select delete_account_profile('dddd0000-0000-0000-0000-000000000002')$$, 'admin calls delete_account_profile directly');
reset role;

-- ---------------------------------------------------------------- function privileges (Supabase advisors)
-- Supabase grants EXECUTE on new functions to anon directly; admin-only and trigger functions must not keep it.
select pg_temp.assert(not has_function_privilege('anon', f, 'execute'), 'anon cannot execute ' || f)
from unnest(array['public.admin_accounts()', 'public.link_account(uuid,uuid)', 'public.unlink_account(uuid)',
                  'public.import_roster(jsonb,jsonb,jsonb,jsonb)', 'public.generate_start_list(uuid)',
                  'public.previous_round(uuid)', 'public.claim_climber(uuid,uuid,uuid)', 'public.release_claim(uuid,uuid)',
                  'public.set_on_wall(uuid,uuid,boolean)', 'public.account_by_email(text)',
                  'public.delete_account_profile(uuid)']) f;
select pg_temp.assert(prosecdef and has_function_privilege('anon', 'public.season_age_classes(text)', 'execute'),
  'season_age_classes reads private birth dates for everyone, exposing only the class')
from pg_proc where oid = 'public.season_age_classes(text)'::regprocedure;
select pg_temp.assert(prosecdef and has_function_privilege('anon', 'public.season_senior_too_young(text)', 'execute'),
  'season_senior_too_young reads private birth dates for everyone, exposing only "below the minimum"')
from pg_proc where oid = 'public.season_senior_too_young(text)'::regprocedure;
select pg_temp.assert(not prosecdef, 'previous_round runs with the caller''s rights')
from pg_proc where oid = 'public.previous_round(uuid)'::regprocedure;
select pg_temp.assert(not has_function_privilege(r, f, 'execute'), r || ' cannot execute trigger ' || f)
from unnest(array['anon', 'authenticated']) r,
     unnest(array['public.handle_new_user()', 'public.boulder_results_stamp()',
                  'public.boulder_results_check_registration()', 'public.registrations_sync_starters()',
                  'public.lead_results_stamp()',
                  'public.rounds_seed_starters()']) f;
select pg_temp.assert(has_function_privilege('authenticated', 'public.admin_accounts()', 'execute')
  and has_function_privilege('anon', 'public.has_role(public.app_role)', 'execute'),
  'admins (authenticated) keep admin RPCs; RLS helpers stay executable');

\echo ALL RLS TESTS PASSED
