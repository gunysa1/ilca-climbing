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

-- The ranking season of today in Israel (September to August), e.g. '2026-27'.
create function pg_temp.cur_season() returns text language sql as $$
  select y || '-' || lpad(((y + 1) % 100)::text, 2, '0')
  from (select extract(year from d)::int - case when extract(month from d) < 9 then 1 else 0 end y
        from (select (now() at time zone 'Asia/Jerusalem')::date d) a) b
$$;

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
select pg_temp.denied($$update profiles set ifsc_id = '99999' where id = my_profile_id()$$,
  'a climber links their own profile to an IFSC athlete (the sync would import that athlete''s results)');
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
-- world_rankings: public read, admin write.
select pg_temp.denied($$insert into world_rankings (climber_id, season, discipline, position, as_of)
  values ('60000000-0000-0000-0000-00000000000a', '2026-27', 'lead', 12, '2026-10-01')$$, 'anon adds world rankings');
select pg_temp.login('00000000-0000-0000-0000-000000000002');
select pg_temp.denied($$insert into world_rankings (climber_id, season, discipline, position, as_of)
  values ('00000000-0000-0000-0000-000000000002', '2026-27', 'lead', 12, '2026-10-01')$$, 'non-admin adds world rankings');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into world_rankings (climber_id, season, discipline, position, as_of)
  values ('60000000-0000-0000-0000-00000000000a', '2026-27', 'lead', 12, '2026-10-01');
update world_rankings set position = 9 where climber_id = '60000000-0000-0000-0000-00000000000a';
select pg_temp.login(null);
select pg_temp.assert((select position from world_rankings where season = '2026-27' and discipline = 'lead') = 9,
  'admin adds and updates world rankings; public reads them');
-- ifsc_pending / ifsc_sync_runs: admin only; ifsc_event_id public like the rest of international_results.
select pg_temp.denied($$select * from ifsc_pending$$, 'anon reads pending IFSC athletes');
select pg_temp.denied($$select * from ifsc_sync_runs$$, 'anon reads IFSC sync runs');
select pg_temp.denied($$select * from ifsc_dismissed$$, 'anon reads dismissed IFSC results');
select pg_temp.denied($$insert into ifsc_dismissed (climber_id, ifsc_event_id, ifsc_dcat_id)
  values ('60000000-0000-0000-0000-00000000000a', 1, 3)$$, 'anon dismisses IFSC results');
select pg_temp.login('00000000-0000-0000-0000-000000000002');
select pg_temp.denied($$select * from ifsc_dismissed$$, 'non-admin reads dismissed IFSC results');
select pg_temp.denied($$insert into ifsc_dismissed (climber_id, ifsc_event_id, ifsc_dcat_id)
  values ('60000000-0000-0000-0000-00000000000a', 1, 3)$$, 'non-admin dismisses IFSC results');
select pg_temp.denied($$select * from ifsc_pending$$, 'non-admin reads pending IFSC athletes');
select pg_temp.denied($$select * from ifsc_sync_runs$$, 'non-admin reads IFSC sync runs');
select pg_temp.denied($$insert into ifsc_pending (ifsc_athlete_id, firstname, lastname) values (1, 'A', 'B')$$, 'non-admin adds pending IFSC athletes');
select pg_temp.denied($$insert into ifsc_sync_runs (status) values ('ok')$$, 'non-admin adds IFSC sync runs');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into ifsc_pending (ifsc_athlete_id, firstname, lastname, birthday, suggested_profile, score, results)
  values (4242, 'Test', 'Climber', '2008-01-01', '60000000-0000-0000-0000-00000000000a', 0.62, '[{"season":"2026-27"}]');
insert into ifsc_sync_runs (status, added, updated, warnings) values ('ok', 3, 2, '["IFSC /api/v1/events/1/result/3: HTTP 404"]');
select pg_temp.assert((select updated = 2 and warnings ->> 0 like '%HTTP 404' from ifsc_sync_runs),
  'admin reads corrected rows and warnings of IFSC sync runs');
-- Hard lock: one running run at most.
insert into ifsc_sync_runs (status) values ('running');
select pg_temp.denied($$insert into ifsc_sync_runs (status) values ('running')$$, 'two IFSC sync runs running at once');
update ifsc_sync_runs set status = 'failed' where status = 'running';
insert into ifsc_sync_runs (status) values ('running');
delete from ifsc_sync_runs where status <> 'ok';
insert into ifsc_dismissed (climber_id, ifsc_event_id, ifsc_dcat_id) values ('60000000-0000-0000-0000-00000000000a', 1500, 3);
select pg_temp.assert((select count(*) from ifsc_dismissed where ifsc_event_id = 1500 and ifsc_dcat_id = 3) = 1,
  'admin dismisses IFSC results and reads them');
select pg_temp.assert((select birthday from ifsc_pending where ifsc_athlete_id = 4242) = '2008-01-01', 'pending athletes keep their birthday');
update ifsc_pending set status = 'ignored' where ifsc_athlete_id = 4242;
select pg_temp.assert((select birthday from ifsc_pending where ifsc_athlete_id = 4242) is null, 'ignoring an IFSC athlete clears the birthday');
update ifsc_pending set birthday = '2008-01-01' where ifsc_athlete_id = 4242;
select pg_temp.assert((select birthday from ifsc_pending where ifsc_athlete_id = 4242) is null, 'an ignored IFSC athlete keeps no birthday');
-- A new IFSC link drops the climber's world positions of the current season (they were someone else's); other
-- seasons stay. cur_season: the season of today in Israel (September to August).
insert into world_rankings (climber_id, season, discipline, position, as_of)
  values ('60000000-0000-0000-0000-00000000000a', '2020-21', 'boulder', 3, '2020-10-01'),
         ('60000000-0000-0000-0000-00000000000a', pg_temp.cur_season(), 'boulder', 4, current_date)
  on conflict do nothing;
select pg_temp.denied($$update profiles set ifsc_id = 'abc' where id = '60000000-0000-0000-0000-00000000000a'$$, 'an IFSC id that is not a number');
select pg_temp.denied($$update profiles set ifsc_id = '0123' where id = '60000000-0000-0000-0000-00000000000a'$$, 'an IFSC id with a leading zero');
update profiles set ifsc_id = '4242' where id = '60000000-0000-0000-0000-00000000000a';
select pg_temp.assert((select count(*) from world_rankings where climber_id = '60000000-0000-0000-0000-00000000000a'
    and season = pg_temp.cur_season()) = 0
  and (select count(*) from world_rankings where climber_id = '60000000-0000-0000-0000-00000000000a' and season = '2020-21') = 1,
  'changing profiles.ifsc_id drops the climber''s current-season world positions only');
delete from world_rankings where season = '2020-21';
insert into world_rankings (climber_id, season, discipline, position, as_of)
  values ('60000000-0000-0000-0000-00000000000a', '2026-27', 'lead', 9, '2026-10-01') on conflict do nothing;
select pg_temp.assert((select status from ifsc_pending where ifsc_athlete_id = 4242) = 'ignored'
  and (select added from ifsc_sync_runs) = 3
  and (select ifsc_id from profiles where id = '60000000-0000-0000-0000-00000000000a') = '4242',
  'admin writes and reads ifsc_pending / ifsc_sync_runs and sets profiles.ifsc_id');
select pg_temp.denied($$update profiles set ifsc_id = '4242' where id = '00000000-0000-0000-0000-000000000001'$$,
  'two profiles share one IFSC athlete');
update international_results set ifsc_event_id = 1234, ifsc_dcat_id = 3 where event_name = 'EYC Imst';
select pg_temp.login(null);
select pg_temp.assert((select ifsc_event_id from international_results) = 1234
  and (select ifsc_dcat_id from international_results) = 3, 'public reads international_results.ifsc_event_id');
reset role;
set role service_role;
update profiles set ifsc_id = '4343' where id = '50000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.assert((select ifsc_id from profiles where id = '50000000-0000-0000-0000-000000000001') = '4343',
  'the service role (sync) sets profiles.ifsc_id');
-- People admin: unlink (sets null; results stay) is admin-only; ignored athletes can be restored.
select pg_temp.login('00000000-0000-0000-0000-00000000000f');
select pg_temp.denied($$update profiles set ifsc_id = null where id = my_profile_id()$$,
  'a climber unlinks their own profile from its IFSC athlete');
select pg_temp.denied($$update ifsc_pending set status = 'pending' where ifsc_athlete_id = 4242$$, 'non-admin restores an ignored IFSC athlete');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
update profiles set ifsc_id = null where id = '50000000-0000-0000-0000-000000000001';
update ifsc_pending set status = 'pending' where ifsc_athlete_id = 4242;
select pg_temp.assert((select ifsc_id from profiles where id = '50000000-0000-0000-0000-000000000001') is null
  and (select status from ifsc_pending where ifsc_athlete_id = 4242) = 'pending',
  'admin unlinks a profile from its IFSC athlete and restores an ignored one');
select pg_temp.assert((select status = 'ignored' and suggested_profile is null and firstname || ' ' || lastname = 'IFSC #4343'
  from ifsc_pending where ifsc_athlete_id = 4343),
  'an unlinked IFSC athlete is kept as ignored without a suggestion (the sync never re-links it by itself)');
delete from ifsc_pending where ifsc_athlete_id = 4343;
reset role;
insert into profiles (id, full_name) values ('60000000-0000-0000-0000-0000000000f3', 'World Ranking Temp');
insert into world_rankings (climber_id, season, discipline, position, as_of)
  values ('60000000-0000-0000-0000-0000000000f3', '2026-27', 'boulder', 5, '2026-10-01');
delete from profiles where id = '60000000-0000-0000-0000-0000000000f3';
select pg_temp.assert((select count(*) from world_rankings where climber_id = '60000000-0000-0000-0000-0000000000f3') = 0
  and (select count(*) from world_rankings) = 1, 'deleting a profile removes its world rankings');
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
-- season_rankings() / climber_page(): one call per page, same rows as the separate functions
select pg_temp.assert(
  json_array_length(season_rankings('2026-27') -> 'rounds') = (select count(*) from season_ranking_rounds('2026-27'))
  and json_array_length(season_rankings('2026-27') -> 'rounds') > 0
  and json_array_length(season_rankings('2026-27') -> 'age_classes') = (select count(*) from season_age_classes('2026-27'))
  and json_array_length(season_rankings('2026-27') -> 'intl') = (select count(*) from international_results where season = '2026-27')
  and json_array_length(season_rankings('2026-27') -> 'world') = (select count(*) from world_rankings where season = '2026-27'),
  'season_rankings returns the same rows as the separate queries');
select pg_temp.assert(
  (select count(*) from json_array_elements(season_rankings('2026-27') -> 'rounds') e
    where not exists (select 1 from json_array_elements(season_rankings('2026-27') -> 'profiles') p
                      where p ->> 'id' = e ->> 'climber_id')) = 0,
  'season_rankings: a profile for every climber in the rounds');
select pg_temp.assert(season_rankings('2026-27')::text !~* 'birth' and season_rankings('2026-27')::text !~ '2009-05-01',
  'season_rankings carries no birth dates');
-- a draft competition with a ranked season and series stays invisible
reset role;
update competitions set season = '2026-27', series = 'premier_league' where id = '10000000-0000-0000-0000-000000000002';
insert into rounds (id, category_id, kind, status) values ('3e000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'qualification', 'live');
insert into round_starters (round_id, climber_id) values ('3e000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-0000000000e1')
  on conflict do nothing;
select pg_temp.login(null);
select pg_temp.assert(season_rankings('2026-27')::text !~ '3e000000-0000-0000-0000-000000000001'
  and season_rankings('2026-27')::text !~ '10000000-0000-0000-0000-000000000002'
  and climber_page('60000000-0000-0000-0000-0000000000e1')::text !~ '10000000-0000-0000-0000-000000000002'
  and json_array_length(climber_page('60000000-0000-0000-0000-0000000000e1') -> 'history') = 0,
  'season_rankings and climber_page: nothing of a draft competition');
reset role;
delete from round_starters where round_id = '3e000000-0000-0000-0000-000000000001';
delete from rounds where id = '3e000000-0000-0000-0000-000000000001';
update competitions set season = null, series = 'other' where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.login(null);
select pg_temp.assert(json_array_length(season_rankings('2031-32') -> 'rounds') = 0
  and json_array_length(season_rankings('2031-32') -> 'profiles') = 0, 'season_rankings: empty season');
select pg_temp.assert(
  json_array_length(climber_page('60000000-0000-0000-0000-00000000000a') -> 'history')
    = (select count(*) from climber_history where climber_id = '60000000-0000-0000-0000-00000000000a')
  and json_array_length(climber_page('60000000-0000-0000-0000-00000000000a') -> 'history') > 0
  and climber_page('60000000-0000-0000-0000-00000000000a') -> 'profile' ->> 'full_name' is not null
  and exists (select 1 from json_array_elements(climber_page('60000000-0000-0000-0000-00000000000a') -> 'competitions') c
              where c ->> 'id' = '10000000-0000-0000-0000-000000000001' and c ->> 'series' = 'premier_league'),
  'climber_page returns profile, history and the history''s competitions');
select pg_temp.assert(climber_page('60000000-0000-0000-0000-00000000000a')::text !~* 'birth',
  'climber_page carries no birth date');
select pg_temp.assert((climber_page('99999999-0000-0000-0000-000000000009') -> 'profile')::text = 'null'
  and json_array_length(climber_page('99999999-0000-0000-0000-000000000009') -> 'history') = 0,
  'climber_page: nothing for an unknown climber');

-- ---------------------------------------------------------------- rankings cache (migration 033)
-- Everything above ran on the live fallback (no cache rows yet). The refresh builds as anon.
reset role;
select pg_temp.assert(not exists (select 1 from season_rankings_cache) and exists (select 1 from rankings_cache_changes),
  'before the first refresh: no cached seasons, writes left pending changes');
-- (the refresh and the checks in separate statements: a statement sees the data as it was when it started)
select refresh_rankings_cache() as rebuilt \gset
select pg_temp.assert(:rebuilt > 0 and not exists (select 1 from rankings_cache_changes)
  and exists (select 1 from season_rankings_cache where season = '2026-27'),
  'refresh_rankings_cache builds every season and clears the pending changes');
select pg_temp.assert(refresh_rankings_cache() = 0, 'refresh_rankings_cache: nothing pending, nothing rebuilt');
select pg_temp.login(null);
select season_rankings_build('2026-27')::text as anon_build \gset
reset role;
select pg_temp.assert((select payload::text from season_rankings_cache where season = '2026-27') = :'anon_build'
  and json_array_length((select payload from season_rankings_cache where season = '2026-27') -> 'rounds') > 0,
  'the cached payload is exactly what anon gets from the invoker build');
-- season_rankings serves the stored row (a marker payload proves it), to everyone.
update season_rankings_cache set payload = '{"marker": true}' where season = '2026-27';
select pg_temp.login(null);
select pg_temp.assert(season_rankings('2026-27') ->> 'marker' = 'true', 'anon: season_rankings returns the cached payload');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.assert(season_rankings('2026-27') ->> 'marker' = 'true', 'admin: season_rankings returns the same cached payload');
reset role;
update season_rankings_cache set payload = :'anon_build'::json where season = '2026-27';
-- A draft competition in the season, with a live round and a result: staff see it, the cache never does,
-- even when the refresh runs in a session carrying an admin's JWT claims.
update competitions set season = '2026-27', series = 'premier_league' where id = '10000000-0000-0000-0000-000000000002';
insert into rounds (id, category_id, kind, status) values ('3e000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'qualification', 'live');
insert into boulders (id, round_id, number) values ('4e000000-0000-0000-0000-000000000001', '3e000000-0000-0000-0000-000000000002', 1);
insert into round_starters (round_id, climber_id) values ('3e000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-0000000000e1')
  on conflict do nothing;
insert into boulder_results (boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt)
  values ('4e000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-0000000000e1', '3e000000-0000-0000-0000-000000000002', 1, 1, 1);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.assert(season_rankings_build('2026-27')::text ~ '10000000-0000-0000-0000-000000000002'
  and season_rankings_build('2026-27')::text ~ '60000000-0000-0000-0000-0000000000e1',
  'admin''s own build includes the draft competition (the fixture is visible to staff)');
reset role;  -- postgres, still with the admin's claims
select pg_temp.assert(current_setting('request.jwt.claim.sub') = '00000000-0000-0000-0000-00000000000a'
  and refresh_rankings_cache() > 0, 'refresh with an admin''s claims in the session');
select pg_temp.assert(payload::text !~ '3e000000-0000-0000-0000-000000000002'
  and payload::text !~ '10000000-0000-0000-0000-000000000002' and payload::text !~ '20000000-0000-0000-0000-000000000002'
  and payload::text !~ '60000000-0000-0000-0000-0000000000e1',
  'the cache holds nothing of a draft competition (rounds, categories, its climbers'' profiles)')
from season_rankings_cache where season = '2026-27';
select pg_temp.assert(payload::text !~* 'birth' and payload::text !~ '2009-05-01' and payload::text !~ '1990-01-01'
  and payload::text !~ '2010-01-01' and payload::text !~ '050-1111111' and payload::text !~ '050-2222222' and payload::text !~* 'asthma',
  'the cache holds no birth dates or other private data') from season_rankings_cache;
select pg_temp.login(null);
select season_rankings_build('2026-27')::text as anon_build \gset
reset role;
select pg_temp.assert((select payload::text from season_rankings_cache where season = '2026-27') = :'anon_build',
  'with a draft in the season the cache still equals anon''s build');
-- Publishing it (a status change) reaches the cache with the next refresh.
update competitions set status = 'published' where id = '10000000-0000-0000-0000-000000000002';
select refresh_rankings_cache() as rebuilt \gset
select pg_temp.assert(:rebuilt > 0 and payload::text ~ '10000000-0000-0000-0000-000000000002'
  and payload::text ~ '60000000-0000-0000-0000-0000000000e1',
  'a published draft appears in the cache after the refresh') from season_rankings_cache where season = '2026-27';
update competitions set status = 'draft' where id = '10000000-0000-0000-0000-000000000002';
delete from boulder_results where round_id = '3e000000-0000-0000-0000-000000000002';
delete from round_starters where round_id = '3e000000-0000-0000-0000-000000000002';
delete from rounds where id = '3e000000-0000-0000-0000-000000000002';
update competitions set season = null, series = 'other' where id = '10000000-0000-0000-0000-000000000002';
select refresh_rankings_cache() as rebuilt \gset
select pg_temp.assert(:rebuilt > 0 and not exists (select 1 from rankings_cache_changes), 'refreshed after the cleanup');
-- A result write marks its season (only) as changed; until the refresh, the old payload is served.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
update boulder_results set attempts = attempts where round_id = '30000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.assert((select array_agg(distinct season) from rankings_cache_changes) = '{2026-27}',
  'a write to boulder_results marks its round''s season changed');
update season_rankings_cache set payload = '{"marker": "stale"}' where season = '2026-27';
select pg_temp.login(null);
select pg_temp.assert(season_rankings('2026-27') ->> 'marker' = 'stale', 'a changed season serves the stored payload until the refresh');
reset role;
select refresh_rankings_cache() as rebuilt \gset
select pg_temp.assert(:rebuilt = 1 and not exists (select 1 from rankings_cache_changes)
  and (select payload::text from season_rankings_cache where season = '2026-27') = :'anon_build',
  'the refresh rebuilds only the changed season');
update round_starters set group_label = group_label where round_id = '99999999-0000-0000-0000-000000000009';
update world_rankings set position = position where season = '2026-27';
select pg_temp.assert((select array_agg(distinct season) from rankings_cache_changes) = '{2026-27}',
  'an empty statement marks nothing; world_rankings marks its own season');
update profiles set club = club where id = '60000000-0000-0000-0000-00000000000a';
select pg_temp.assert(exists (select 1 from rankings_cache_changes where season is null), 'a profile write marks every season');
select refresh_rankings_cache() as rebuilt \gset
-- Statements that change no row mark nothing: anon is refused outright (no write privilege), a signed-in
-- non-admin's writes match no row under RLS.
select pg_temp.login(null);
select pg_temp.denied(format('update public.%I set %I = %I', t, c, c), 'anon writes ' || t)
from (values ('competitions', 'name'), ('categories', 'name'), ('rounds', 'kind'), ('boulders', 'number'),
             ('profiles', 'club'), ('profile_private', 'phone'), ('boulder_results', 'attempts'),
             ('lead_results', 'hold'), ('round_starters', 'start_order'), ('round_totals', 'tops'),
             ('international_results', 'place'), ('ranking_adjustments', 'points'), ('world_rankings', 'position')) v(t, c);
select pg_temp.denied(format('delete from public.%I', t), 'anon deletes from ' || t)
from unnest(array['competitions', 'categories', 'rounds', 'boulders', 'profiles', 'profile_private', 'boulder_results',
                  'lead_results', 'round_starters', 'round_totals', 'international_results', 'ranking_adjustments',
                  'world_rankings']) t;
select pg_temp.login('00000000-0000-0000-0000-000000000002');
do $$  -- (a write the role may not make at all is refused before any trigger: also fine)
declare t text; c text;
begin
  for t, c in values ('competitions', 'name'), ('categories', 'name'), ('rounds', 'kind'), ('boulders', 'number'),
                     ('boulder_results', 'attempts'), ('lead_results', 'hold'), ('round_starters', 'start_order'),
                     ('round_totals', 'tops'), ('international_results', 'place'), ('ranking_adjustments', 'points'),
                     ('world_rankings', 'position') loop
    begin execute format('update public.%I set %I = %I', t, c, c); exception when insufficient_privilege then null; end;
    begin execute format('delete from public.%I', t); exception when insufficient_privilege then null; end;
  end loop;
end $$;
update profiles set club = club where id = '60000000-0000-0000-0000-00000000000a';  -- not her profile: no row
update profile_private set phone = phone where id = '60000000-0000-0000-0000-00000000000a';
delete from profiles where id = '60000000-0000-0000-0000-00000000000a';
reset role;
select pg_temp.assert(not exists (select 1 from rankings_cache_changes),
  'anon and non-admin writes that change no row append nothing to rankings_cache_changes');
insert into rankings_cache_changes (season) values (null);
select refresh_rankings_cache() as rebuilt \gset
select pg_temp.assert(:rebuilt = (select count(*) from season_rankings_cache) and not exists (select 1 from rankings_cache_changes),
  'every season rebuilt');
reset role;
update competitions set season = null, series = 'other' where id = '10000000-0000-0000-0000-000000000001';
select refresh_rankings_cache() as rebuilt \gset
select pg_temp.assert(:rebuilt > 0
  and json_array_length((select payload from season_rankings_cache where season = '2026-27') -> 'rounds') = 0,
  'a season whose competitions moved away is rebuilt empty');

-- ---------------------------------------------------------------- ranking tables (migration 035)
-- The rankings-build edge function (service role) stores the finished tables; everyone reads them.
reset role;
select pg_temp.assert(not exists (select 1 from ranking_tables), 'no ranking tables before the first build');
select pg_temp.login(null);
select pg_temp.assert(ranking_page(1, '2023-24', null, 'senior', 'female', 'boulder') ->> 'table' is null
  and (ranking_page(1, '2023-24', null, 'senior', 'female', 'boulder') ->> 'season')
      is not distinct from (select max(season) from competitions where series <> 'other' and season >= '2023-24')
  and (select array_agg(s order by s desc) from json_array_elements_text(ranking_page(1, '2023-24', null, 'senior', 'female', 'boulder') -> 'seasons') s)
      is not distinct from (select array_agg(distinct season order by season desc) from competitions where series <> 'other' and season >= '2023-24'),
  'ranking_page before a build: the seasons (newest first) and no table');
select pg_temp.denied($$select * from ranking_tables_due()$$, 'anon lists the due seasons');
select pg_temp.denied($$select ranking_tables_input('2026-27')$$, 'anon reads a season''s cached payload through the build input');
select pg_temp.denied($$select store_ranking_tables('2026-27', now(), 1, '[]')$$, 'anon stores ranking tables');
select pg_temp.denied($$select ranking_tables_invalidate()$$, 'anon invalidates ranking tables');
select pg_temp.denied($$insert into ranking_tables (season, rank_class, gender, discipline, rows, meta, source_built_at, code_version)
  values ('2026-27', 'senior', 'female', 'boulder', '[]', '{}', now(), 1)$$, 'anon writes ranking tables');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.denied($$select * from ranking_tables_due()$$, 'admin lists the due seasons (only the function does)');
select pg_temp.denied($$select store_ranking_tables('2026-27', now(), 1, '[]')$$, 'admin stores ranking tables directly');
select pg_temp.denied($$select ranking_tables_invalidate()$$, 'admin invalidates ranking tables directly');
select pg_temp.denied($$insert into ranking_tables (season, rank_class, gender, discipline, rows, meta, source_built_at, code_version)
  values ('2026-27', 'senior', 'female', 'boulder', '[]', '{}', now(), 1)$$, 'admin writes ranking tables');
reset role;
select array_agg(season order by season desc)::text as cached from season_rankings_cache \gset
set role service_role;
select pg_temp.assert((select array_agg(season) from ranking_tables_due(1))::text = :'cached'
  and (select array_agg(season) from ranking_tables_due()) = (select array_agg(season) from ranking_tables_due(1)),
  'service role: every cached season is due before a build, newest first');
select pg_temp.assert(ranking_tables_input('2026-27') -> 'payload' is not null
  and ranking_tables_input('2031-32') is null, 'service role: the build input of a cached season (null for none)');
select pg_temp.denied($$insert into ranking_tables (season, rank_class, gender, discipline, rows, meta, source_built_at, code_version)
  values ('2026-27', 'senior', 'female', 'boulder', '[]', '{}', now(), 1)$$, 'service role writes ranking tables directly');
select (ranking_tables_input('2026-27') ->> 'built_at')::timestamptz as src \gset
select pg_temp.assert(store_ranking_tables('2026-27', :'src', 1, $$[
  {"rank_class": "senior", "gender": "female", "discipline": "boulder", "meta": {"criteria": "ilca2027", "provisional": true},
   "rows": [{"rank": 1, "climber_id": "a"}, {"rank": 2, "climber_id": "b"}, {"rank": 3, "climber_id": "c"}, {"rank": 3, "climber_id": "d"}, {"rank": 5, "climber_id": "e"}]},
  {"rank_class": "senior", "gender": "male", "discipline": "lead", "meta": {}, "rows": []},
  {"rank_class": "U17", "gender": "female", "discipline": "boulder", "meta": {}, "rows": [{"rank": 1, "climber_id": "y"}]}]$$),
  'service role stores a season''s tables');
select pg_temp.assert(not exists (select 1 from ranking_tables_due(1) where season = '2026-27')
  and not exists (select 1 from ranking_tables_due() where season = '2026-27')
  and exists (select 1 from ranking_tables_due(2) where season = '2026-27'),
  'a stored season is no longer due for its code version; another version finds it due');
select pg_temp.assert(not store_ranking_tables('2026-27', '2000-01-01', 1, '[]')
  and not store_ranking_tables('2026-27', '2000-01-01', 2, '[]'),
  'a build from an older payload does not replace newer tables (whatever its version)');
select pg_temp.denied($$select store_ranking_tables('2026-27', now(), 1, '[{"rank_class": "U9", "gender": "female", "discipline": "boulder", "meta": {}, "rows": []}]')$$,
  'store refuses an unknown class');
select pg_temp.denied($$select store_ranking_tables('2026-27', now(), 1, '[{"rank_class": "U17", "gender": "female", "discipline": "boulder", "meta": {}, "rows": {}}]')$$,
  'store refuses rows that are not an array');
select pg_temp.denied($$select store_ranking_tables('2026-27', now(), 1, '{}')$$, 'store refuses tables that are not an array');
select pg_temp.denied($$select store_ranking_tables('2026-27', now(), 0, '[]')$$, 'store refuses a code version below 1');
select pg_temp.denied($$select store_ranking_tables('2026-27', null, 1, '[]')$$, 'store refuses a missing source');
reset role;
select pg_temp.assert((select count(*) from ranking_tables where season = '2026-27') = 3
  and (select source_built_at from ranking_tables where season = '2026-27' limit 1) = (select built_at from season_rankings_cache where season = '2026-27')
  and (select bool_and(code_version = 1) from ranking_tables),
  'the stored tables carry their payload''s built_at and code version; the refused stores changed nothing');
select pg_temp.login(null);
select pg_temp.assert(ranking_page(1, '2023-24', '2026-27', 'senior', 'female', 'boulder') #>> '{table,rows,3,climber_id}' = 'd'
  and ranking_page(1, '2023-24', '2026-27', 'senior', 'female', 'boulder') #>> '{table,meta,criteria}' = 'ilca2027'
  and ranking_page(1, '2023-24', '2026-27', 'senior', 'female', 'boulder') ->> 'season' = '2026-27'
  and ranking_page(1, '2023-24', '2026-27', 'U19', 'female', 'boulder') ->> 'table' is null
  and ranking_page(1, '2023-24', '2026-27', 'senior', 'female', 'speed') ->> 'table' is null,
  'anon: ranking_page returns the stored table (null for one not stored)');
select pg_temp.assert(ranking_page(2, '2023-24', '2026-27', 'senior', 'female', 'boulder') ->> 'table' is null
  and ranking_page(2, '2023-24', '2026-27', 'senior', 'female', 'boulder') ->> 'season' = '2026-27'
  and not exists (select 1 from home_rankings(2, array['2026-27'])),
  'a page of another code version gets no stored table (it computes)');
select pg_temp.assert((select count(*) from ranking_tables) = 3, 'anon reads the ranking tables');
select pg_temp.assert((select string_agg(gender || ' ' || discipline || ' ' || jsonb_array_length(rows), ', ' order by discipline, gender)
  from home_rankings(1, array['2026-27', '2025-26'])) = 'female boulder 4, male lead 0'
  and (select rows #>> '{3,climber_id}' from home_rankings(1, array['2026-27']) where discipline = 'boulder') = 'd',
  'home_rankings: the top 3 of the stored senior tables (ties included)');
select pg_temp.denied($$update ranking_tables set rows = '[]'$$, 'anon changes ranking tables');
select pg_temp.denied($$delete from ranking_tables$$, 'anon deletes ranking tables');
select pg_temp.login('00000000-0000-0000-0000-000000000002');
select pg_temp.assert((select count(*) from ranking_tables) = 3, 'a signed-in climber reads the ranking tables');
select pg_temp.denied($$delete from ranking_tables$$, 'a signed-in climber deletes ranking tables');
reset role;
-- A newer code version replaces the tables of the same payload; an older one then cannot put its tables back.
set role service_role;
-- (one write per statement: a statement sees the data as it was when it started)
select pg_temp.assert(store_ranking_tables('2026-27', :'src', 2, '[{"rank_class": "senior", "gender": "female", "discipline": "boulder", "meta": {}, "rows": []}]'),
  'a newer code version replaces the tables of the same payload');
select pg_temp.assert(not store_ranking_tables('2026-27', :'src', 1, '[]'), 'the older version''s build of the same payload is refused');
select pg_temp.assert(exists (select 1 from ranking_tables_due(1) where season = '2026-27')
  and not exists (select 1 from ranking_tables_due() where season = '2026-27'),
  'due: for the older version yes; for pg_cron (the newest stored version) no');
reset role;
select pg_temp.assert((select count(*) from ranking_tables) = 1 and (select code_version from ranking_tables) = 2,
  'the newer version''s tables stay');
-- {"all": true}: every season due again, the tables still served meanwhile
set role service_role;
select ranking_tables_invalidate();
select pg_temp.assert(exists (select 1 from ranking_tables_due(2) where season = '2026-27')
  and exists (select 1 from ranking_tables_due() where season = '2026-27'),
  'invalidate makes every stored season due');
reset role;
select pg_temp.assert((select count(*) from ranking_tables) = 1, 'invalidated tables are still served');
set role service_role;
select pg_temp.assert(store_ranking_tables('2026-27', :'src', 2, '[]'), 'an invalidated season takes the rebuild');
reset role;
-- a refresh that rebuilds the season makes it due again
delete from ranking_tables;
set role service_role;
select pg_temp.assert(store_ranking_tables('2026-27', :'src', 1, '[]'), 'stored again');
reset role;
insert into rankings_cache_changes (season) values ('2026-27');
select refresh_rankings_cache() as rebuilt \gset
select pg_temp.assert(exists (select 1 from ranking_tables_due(1) where season = '2026-27'), 'a rebuilt payload makes its season due again');
delete from ranking_tables;

-- ---------------------------------------------------------------- climber page cache (migration 036)
-- Everything above ran on the live build (no round built yet). The refresh builds as anon. Noa climbs in
-- closed rounds (30..03, 30..06: stored) and a live one (30..01: always built live).
reset role;
-- the history a caller gets from the live build (the page before 036, page columns only)
create function pg_temp.live_history(c uuid) returns text language sql stable as $$
  select coalesce(json_agg(private.climber_page_entry(x) order by x.round_id), '[]'::json)::text
  from climber_history_for(array[c]) x where x.round_status <> 'planned';
$$;
select pg_temp.assert(not exists (select 1 from climber_cache_rounds) and exists (select 1 from climber_cache_changes),
  'before the first refresh: no built rounds, writes left pending changes');
select pg_temp.login(null);
select pg_temp.assert(private.climber_history_cached('00000000-0000-0000-0000-000000000001') is null
  and private.climber_history_cached('60000000-0000-0000-0000-00000000000a') is null,
  'a climber whose closed rounds were not built yet has no stored history (climber_page builds live)');
select climber_page('00000000-0000-0000-0000-000000000001')::text as live_noa,
       climber_page('60000000-0000-0000-0000-00000000000a')::text as live_lead \gset
select pg_temp.assert((:'live_noa'::json -> 'history')::text = pg_temp.live_history('00000000-0000-0000-0000-000000000001')
  and json_array_length(:'live_noa'::json -> 'history') >= 3 and json_array_length(:'live_lead'::json -> 'history') > 0
  and :'live_noa' !~ '"tops"' and :'live_noa' !~ '"points"' and :'live_noa' !~ '"climber_id"' and :'live_noa' ~ '"starters"',
  'climber_page history: only the columns the page reads');
-- round_history_for (every starter of some rounds) = climber_history_for (some climbers), both ways
select pg_temp.assert(not exists (
    (select * from climber_history_for(array(select distinct climber_id from round_starters))
     except all
     select * from private.round_history_for(array(select id from rounds)))
    union all
    (select * from private.round_history_for(array(select id from rounds))
     except all
     select * from climber_history_for(array(select distinct climber_id from round_starters))))
  and (select count(distinct climber_id) from private.round_history_for(array(select id from rounds))) >= 5,
  'round_history_for and climber_history_for return the same rows for every climber (ranks, starters counts)');
-- The refresh runs in a session carrying an admin's JWT claims: it still builds as anon.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
reset role;
select refresh_climber_cache() as built \gset
select pg_temp.assert(:built = (select count(*) from rounds) and not exists (select 1 from climber_cache_changes)
  and not exists (select 1 from climber_cache_rounds where stale)
  and (select count(*) from climber_cache_rounds) = (select count(*) from rounds),
  'refresh_climber_cache builds every round and clears the pending changes');
select pg_temp.assert(refresh_climber_cache() = 0, 'refresh_climber_cache: nothing pending, nothing built');
select pg_temp.login(null);
select pg_temp.assert(climber_page('00000000-0000-0000-0000-000000000001')::text = :'live_noa'
  and climber_page('60000000-0000-0000-0000-00000000000a')::text = :'live_lead'
  and private.climber_history_cached('00000000-0000-0000-0000-000000000001') is not null,
  'climber_page from the stored rows equals the live build (boulder and lead)');
create temp table anon_build as
  select round_id, climber_id, entry::text as entry from private.climber_cache_build(array(select id from rounds));
reset role;
select pg_temp.assert(not exists (select round_id, climber_id, entry::text from climber_cache_entries except select * from anon_build)
  and not exists (select * from anon_build except select round_id, climber_id, entry::text from climber_cache_entries)
  and exists (select 1 from anon_build),
  'the stored rows are exactly what anon gets from the invoker build');
-- climber_page serves the stored rows of closed rounds (a marker row proves it), to everyone; never of live ones.
update climber_cache_entries set entry = '{"marker": "closed", "round_id": "30000000-0000-0000-0000-000000000003", "competition_id": "10000000-0000-0000-0000-000000000003"}'
  where climber_id = '00000000-0000-0000-0000-000000000001' and round_id = '30000000-0000-0000-0000-000000000003';
update climber_cache_entries set entry = '{"marker": "live"}'
  where climber_id = '00000000-0000-0000-0000-000000000001' and round_id = '30000000-0000-0000-0000-000000000001';
select pg_temp.login(null);
select pg_temp.assert(climber_page('00000000-0000-0000-0000-000000000001')::text ~ '"marker": "closed"'
  and climber_page('00000000-0000-0000-0000-000000000001')::text !~ '"marker": "live"',
  'anon: climber_page returns the stored rows of closed rounds, live rounds built live');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.assert(climber_page('00000000-0000-0000-0000-000000000001')::text ~ '"marker": "closed"',
  'admin: climber_page returns the same stored rows');
-- A write to a live round shows at once: a new starter changes Noa's field size in 30..01 before any refresh.
reset role;
insert into round_starters (round_id, climber_id) values ('30000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-0000000000e1');
select pg_temp.login(null);
select pg_temp.assert(
  (select (e ->> 'starters')::int from json_array_elements(climber_page('00000000-0000-0000-0000-000000000001') -> 'history') e
   where e ->> 'round_id' = '30000000-0000-0000-0000-000000000001')
  = 1 + (select (e ->> 'starters')::int from json_array_elements(:'live_noa'::json -> 'history') e
         where e ->> 'round_id' = '30000000-0000-0000-0000-000000000001'),
  'a write to a live round shows on the climber page at once (no refresh)');
reset role;
delete from round_starters where round_id = '30000000-0000-0000-0000-000000000001' and climber_id = '60000000-0000-0000-0000-0000000000e1';
-- A draft competition with a closed round and a result: staff see it, the stored rows never do.
insert into rounds (id, category_id, kind, status) values ('3e000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', 'qualification', 'live');
insert into boulders (id, round_id, number) values ('4e000000-0000-0000-0000-000000000003', '3e000000-0000-0000-0000-000000000003', 1);
insert into round_starters (round_id, climber_id) values ('3e000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-0000000000e1')
  on conflict do nothing;
insert into boulder_results (boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt)
  values ('4e000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-0000000000e1', '3e000000-0000-0000-0000-000000000003', 1, 1, 1);
update rounds set status = 'closed' where id = '3e000000-0000-0000-0000-000000000003';
select pg_temp.login(null);
select pg_temp.assert(private.climber_history_cached('60000000-0000-0000-0000-0000000000e1') is null
  and json_array_length(climber_page('60000000-0000-0000-0000-0000000000e1') -> 'history') = 0,
  'a new closed round not built yet: climber_page builds live (and anon sees nothing of the draft)');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.assert(exists (select 1 from private.climber_cache_build(array['3e000000-0000-0000-0000-000000000003'::uuid])),
  'admin''s own build includes the draft round (the fixture is visible to staff)');
reset role;  -- postgres, still with the admin's claims
select refresh_climber_cache() as built \gset
select pg_temp.assert(:built > 0 and exists (select 1 from climber_cache_rounds where round_id = '3e000000-0000-0000-0000-000000000003')
  and not exists (select 1 from climber_cache_entries where round_id = '3e000000-0000-0000-0000-000000000003'
                  or climber_id = '60000000-0000-0000-0000-0000000000e1' or entry::text ~ '10000000-0000-0000-0000-000000000002'
                  or entry::text ~ '20000000-0000-0000-0000-000000000002'),
  'the stored rows hold nothing of a draft competition (built, with no rows)');
select pg_temp.assert(not exists (select 1 from climber_cache_entries
  where entry::text ~* 'birth|asthma|050-|2009-05-01|1990-01-01|2010-01-01|Secret draft|full_name|club'),
  'the stored rows hold no profile or private data');
select pg_temp.assert(not exists (select 1 from climber_cache_entries e join rounds r on r.id = e.round_id where r.status = 'planned'),
  'the stored rows hold no planned round');
select pg_temp.login(null);
select pg_temp.assert(private.climber_history_cached('60000000-0000-0000-0000-0000000000e1')::text = '[]'
  and climber_page('60000000-0000-0000-0000-0000000000e1')::text !~ '10000000-0000-0000-0000-000000000002',
  'once built, the draft round serves nothing');
-- Publishing it (a competition write) marks the competition's rounds; the refresh rebuilds them.
reset role;
update competitions set status = 'published' where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.assert((select array_agg(distinct round_id) from climber_cache_changes) = '{3e000000-0000-0000-0000-000000000003}',
  'a competition write marks its rounds (only)');
select refresh_climber_cache() as built \gset
select pg_temp.login(null);
select pg_temp.assert(climber_page('60000000-0000-0000-0000-0000000000e1')::text ~ '10000000-0000-0000-0000-000000000002'
  and json_array_length(climber_page('60000000-0000-0000-0000-0000000000e1') -> 'history') = 1,
  'a published draft appears on the climber page after the refresh');
-- Back to draft: hidden at once, before the refresh (the reader checks the competition now).
reset role;
update competitions set status = 'draft' where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.assert(exists (select 1 from climber_cache_entries where round_id = '3e000000-0000-0000-0000-000000000003'),
  '(the stored row of the unpublished competition is still there)');
select pg_temp.login(null);
select pg_temp.assert(json_array_length(climber_page('60000000-0000-0000-0000-0000000000e1') -> 'history') = 0
  and climber_page('60000000-0000-0000-0000-0000000000e1')::text !~ '10000000-0000-0000-0000-000000000002',
  'an unpublished competition is served nothing, even before the refresh');
reset role;
select refresh_climber_cache() as built \gset
select pg_temp.assert(not exists (select 1 from climber_cache_entries where round_id = '3e000000-0000-0000-0000-000000000003'),
  'back to draft: gone from the stored rows after the refresh');
-- Deleting the round deletes its stored rows with the next refresh.
delete from boulder_results where round_id = '3e000000-0000-0000-0000-000000000003';
delete from rounds where id = '3e000000-0000-0000-0000-000000000003';
select refresh_climber_cache() as built \gset
select pg_temp.assert(not exists (select 1 from climber_cache_rounds where round_id = '3e000000-0000-0000-0000-000000000003')
  and not exists (select 1 from climber_cache_changes), 'a deleted round leaves the cache');
-- A correction in a closed round marks it (only); until the refresh, its stored rows are served.
update climber_cache_entries set entry = '{"marker": "closed", "round_id": "30000000-0000-0000-0000-000000000003", "competition_id": "10000000-0000-0000-0000-000000000003"}'
  where climber_id = '00000000-0000-0000-0000-000000000001' and round_id = '30000000-0000-0000-0000-000000000003';
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
update boulder_results set attempts = attempts where round_id = '30000000-0000-0000-0000-000000000003';
reset role;
select pg_temp.assert((select array_agg(distinct round_id) from climber_cache_changes) = '{30000000-0000-0000-0000-000000000003}',
  'a write to boulder_results marks its round changed');
select pg_temp.login(null);
select pg_temp.assert(climber_page('00000000-0000-0000-0000-000000000001')::text ~ '"marker"',
  'a changed closed round serves its stored rows until the refresh');
-- The refresh is behind (its oldest pending change is over 5 minutes old): everything is built live.
reset role;
update climber_cache_changes set at = now() - interval '6 minutes';
select pg_temp.login(null);
select pg_temp.assert(private.climber_history_cached('00000000-0000-0000-0000-000000000001') is null
  and climber_page('00000000-0000-0000-0000-000000000001')::text = :'live_noa',
  'a change pending for over 5 minutes (a stopped cron): climber_page builds live');
reset role;
select refresh_climber_cache() as built \gset
select pg_temp.login(null);
select pg_temp.assert(:built = 1 and climber_page('00000000-0000-0000-0000-000000000001')::text = :'live_noa',
  'the refresh rebuilds only the changed round');
reset role;
update categories set name = name where id = '20000000-0000-0000-0000-000000000001';
select pg_temp.assert((select array_agg(round_id order by round_id) from climber_cache_changes)
  = (select array_agg(id order by id) from rounds where category_id = '20000000-0000-0000-0000-000000000001'),
  'a category write marks its rounds');
delete from climber_cache_changes;
update round_starters set group_label = group_label where round_id = '99999999-0000-0000-0000-000000000009';
update profiles set club = club where id = '60000000-0000-0000-0000-00000000000a';
select pg_temp.assert(not exists (select 1 from climber_cache_changes), 'an empty statement and a profile write mark nothing');
-- anon and non-admin writes that change no row mark nothing (anon is refused outright).
select pg_temp.login('00000000-0000-0000-0000-000000000002');
do $$
declare t text; c text;
begin
  for t, c in values ('competitions', 'name'), ('categories', 'name'), ('rounds', 'kind'), ('boulders', 'number'),
                     ('boulder_results', 'attempts'), ('lead_results', 'hold'), ('round_starters', 'start_order'),
                     ('round_totals', 'tops') loop
    begin execute format('update public.%I set %I = %I', t, c, c); exception when insufficient_privilege then null; end;
    begin execute format('delete from public.%I', t); exception when insufficient_privilege then null; end;
  end loop;
end $$;
reset role;
select pg_temp.assert(not exists (select 1 from climber_cache_changes), 'non-admin writes that change no row mark nothing');
-- Everything stale (a truncate, or by hand after a migration): served stale, rebuilt within the budget,
-- live rounds first. A zero budget builds one batch per call.
insert into climber_cache_changes (round_id) values (null);
select refresh_climber_cache('0 seconds') as built \gset
select pg_temp.assert(:built = (select count(*) from rounds) and not exists (select 1 from climber_cache_rounds where stale),
  'every round rebuilt (one batch holds them all here)');
select pg_temp.login(null);
select pg_temp.assert(climber_page('00000000-0000-0000-0000-000000000001')::text = :'live_noa'
  and climber_page('60000000-0000-0000-0000-00000000000a')::text = :'live_lead', 'after a full rebuild: the same pages');
reset role;

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

-- ---------------------------------------------------------------- home_page(): one call for the home page
-- fixtures: a draft competition with a live round, someone on the wall, a finished competition,
-- an upcoming and a past published competition (dates relative to Israel's today)
insert into rounds (id, category_id, kind, status) values
  ('3f000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'final', 'live');
insert into judge_claims (boulder_id, climber_id, round_id, judge_id, claimed_at, on_wall_since) values
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000000e', now(), now())
  on conflict (boulder_id, climber_id) do update set claimed_at = now(), on_wall_since = now(), judge_id = excluded.judge_id;
update competitions set status = 'finished' where id = '10000000-0000-0000-0000-000000000003';
insert into competitions (id, name, starts_on, ends_on, status) values
  ('1a000000-0000-0000-0000-000000000001', 'Tomorrow cup', (now() at time zone 'Asia/Jerusalem')::date + 1, (now() at time zone 'Asia/Jerusalem')::date + 1, 'published'),
  ('1a000000-0000-0000-0000-000000000002', 'Past cup', (now() at time zone 'Asia/Jerusalem')::date - 10, (now() at time zone 'Asia/Jerusalem')::date - 10, 'published');
update competitions set starts_on = (now() at time zone 'Asia/Jerusalem')::date + 1,
  ends_on = (now() at time zone 'Asia/Jerusalem')::date + 1 where id = '10000000-0000-0000-0000-000000000002';
-- a published competition starting tomorrow that is already live: under "live now", not "upcoming"
insert into competitions (id, name, starts_on, ends_on, status) values
  ('1a000000-0000-0000-0000-000000000003', 'Live tomorrow cup', (now() at time zone 'Asia/Jerusalem')::date + 1, (now() at time zone 'Asia/Jerusalem')::date + 1, 'published');
insert into categories (id, competition_id, name, gender) values
  ('2a000000-0000-0000-0000-000000000003', '1a000000-0000-0000-0000-000000000003', 'Open Men', 'male');
insert into rounds (id, category_id, kind, status) values
  ('3a000000-0000-0000-0000-000000000003', '2a000000-0000-0000-0000-000000000003', 'qualification', 'live');
-- the finished competition gets a category climbed only in a two-group qualification: no single winner
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into categories (id, competition_id, name, gender) values
  ('2a000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'Grouped Women', 'female');
insert into rounds (id, category_id, kind, status) values
  ('3a000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-000000000001', 'qualification', 'closed');
insert into boulders (id, round_id, number) values ('4a000000-0000-0000-0000-000000000001', '3a000000-0000-0000-0000-000000000001', 1);
insert into registrations values
  ('2a000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 1),
  ('2a000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 2);
update round_starters set group_label = case when climber_id = '00000000-0000-0000-0000-000000000001' then 'A' else 'B' end
  where round_id = '3a000000-0000-0000-0000-000000000001';
insert into boulder_results (boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt) values
  ('4a000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '3a000000-0000-0000-0000-000000000001', 1, 1, 1),
  ('4a000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '3a000000-0000-0000-0000-000000000001', 2, 1, 2);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.login(null);
select pg_temp.assert((select count(*) from round_ranks_for(array['3a000000-0000-0000-0000-000000000001'::uuid]) where rank = 1) = 2,
  'fixture: the two-group qualification has a rank 1 in each group');
select pg_temp.assert(home_page() is not null and json_typeof(home_page() -> 'live') = 'array'
  and json_typeof(home_page() -> 'upcoming') = 'array' and json_typeof(home_page() -> 'latest') = 'array',
  'anon gets home_page()');
select pg_temp.assert(exists (select 1 from json_array_elements(home_page() -> 'live') e
    where e ->> 'round_id' = '30000000-0000-0000-0000-000000000001'
      and e -> 'competition' ->> 'name' = 'Israeli Cup #1' and e -> 'category' ->> 'name' = 'Open Women'),
  'home_page: the live section lists a live round with its competition and category');
select pg_temp.assert((select json_agg(w ->> 'number' || ':' || (w ->> 'full_name'))::text
    from json_array_elements(home_page() -> 'live') e, json_array_elements(e -> 'on_wall') w
    where e ->> 'round_id' = '30000000-0000-0000-0000-000000000001') = '["2:Noa"]',
  'home_page: who is on the wall in a live round (boulder number, name)');
select pg_temp.assert(home_page()::text !~ '10000000-0000-0000-0000-000000000002'
  and home_page()::text !~ '3f000000-0000-0000-0000-000000000001' and home_page()::text !~ '3d000000-0000-0000-0000-000000000001'
  and home_page()::text !~ 'Secret draft', 'home_page: nothing of a draft competition (public)');
select pg_temp.assert(home_page()::text !~* 'birth' and home_page()::text !~ 'asthma' and home_page()::text !~ '050-'
  and home_page()::text !~* 'updated_by' and home_page()::text !~* 'email' and home_page()::text !~* 'judge',
  'home_page carries no private columns (birth dates, phones, medical notes, emails, judges)');
select pg_temp.assert(exists (select 1 from json_array_elements(home_page() -> 'upcoming') e where e ->> 'id' = '1a000000-0000-0000-0000-000000000001')
  and not exists (select 1 from json_array_elements(home_page() -> 'upcoming') e where e ->> 'id' = '1a000000-0000-0000-0000-000000000002')
  and json_array_length(home_page() -> 'upcoming') <= 3,
  'home_page: upcoming lists the next published competitions only (at most 3)');
select pg_temp.assert((select json_agg((w ->> 'full_name') || '@' || (w ->> 'round_kind'))::text
    from json_array_elements(home_page() -> 'latest') e, json_array_elements(e -> 'winners') w
    where e ->> 'id' = '10000000-0000-0000-0000-000000000003' and w ->> 'category' = 'Open Women') = '["Tamar@final"]',
  'home_page: a finished competition with its winner per category (rank 1 of the final, after countback)');
select pg_temp.assert((select json_agg(w ->> 'full_name' order by w ->> 'full_name')::text
    from json_array_elements(home_page() -> 'latest') e, json_array_elements(e -> 'winners') w
    where e ->> 'id' = '10000000-0000-0000-0000-000000000003' and w ->> 'category' = 'Tie Men') = '["Noa", "Tamar"]',
  'home_page: tied winners are all listed');
select pg_temp.assert(not exists (select 1 from json_array_elements(home_page() -> 'latest') e
    where e ->> 'id' not in (select id::text from competitions where status = 'finished'))
  and home_page()::text !~ '1a000000-0000-0000-0000-000000000002',
  'home_page: latest results are finished competitions only (a past published one is not listed anywhere)');
select pg_temp.assert(not exists (select 1 from json_array_elements(home_page() -> 'latest') e, json_array_elements(e -> 'winners') w
    where w ->> 'category' = 'Grouped Women'),
  'home_page: a last round climbed in groups gives no winner (no rank 1 per group)');
select pg_temp.assert(exists (select 1 from json_array_elements(home_page() -> 'live') e where e ->> 'round_id' = '3a000000-0000-0000-0000-000000000003')
  and not exists (select 1 from json_array_elements(home_page() -> 'upcoming') e where e ->> 'id' = '1a000000-0000-0000-0000-000000000003'),
  'home_page: a competition with a live round is under live now, not upcoming');
select pg_temp.assert((home_page(true) -> 'live')::text = (home_page() -> 'live')::text
  and home_page(true) -> 'upcoming' is null and home_page(true) -> 'latest' is null
  and home_page(true)::text !~ '3f000000-0000-0000-0000-000000000001',
  'home_page(true): only the live part (same as the full page), no drafts');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.assert(home_page()::text !~ '10000000-0000-0000-0000-000000000002' and home_page()::text !~ '3f000000-0000-0000-0000-000000000001',
  'home_page: drafts stay off the home page for admins too');
select pg_temp.login(null);
select pg_temp.assert(json_array_length(favorites_page(array['00000000-0000-0000-0000-000000000001'::uuid]) -> 'profiles') = 1
  and json_array_length(favorites_page(array['00000000-0000-0000-0000-000000000001'::uuid]) -> 'history')
    = (select count(*) from climber_history_for(array['00000000-0000-0000-0000-000000000001'::uuid]))
  and json_array_length(favorites_page(array['00000000-0000-0000-0000-000000000001'::uuid]) -> 'history') > 0
  and favorites_page(array['00000000-0000-0000-0000-000000000001'::uuid])::text !~* 'birth|asthma|050-|email',
  'favorites_page: public profiles and history of the starred climbers, nothing private');
select pg_temp.assert(json_array_length(favorites_page(array_prepend('00000000-0000-0000-0000-000000000001'::uuid,
    array(select gen_random_uuid() from generate_series(1, 300)))) -> 'profiles') = 1
  and json_array_length(favorites_page(array_append(array(select gen_random_uuid() from generate_series(1, 300)),
    '00000000-0000-0000-0000-000000000001'::uuid)) -> 'profiles') = 0,
  'favorites_page reads at most the first 200 climbers');
select pg_temp.assert(json_array_length(favorites_page('{}') -> 'profiles') = 0
  and json_array_length(favorites_page('{}') -> 'history') = 0, 'favorites_page: nothing for no favorites');
reset role;
delete from judge_claims where boulder_id = '40000000-0000-0000-0000-000000000002' and climber_id = '00000000-0000-0000-0000-000000000001';
delete from rounds where id = '3f000000-0000-0000-0000-000000000001';
delete from competitions where id in ('1a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000002',
  '1a000000-0000-0000-0000-000000000003');
delete from categories where id = '2a000000-0000-0000-0000-000000000001';
update competitions set starts_on = '2026-12-01', ends_on = '2026-12-01' where id = '10000000-0000-0000-0000-000000000002';
update competitions set status = 'published' where id = '10000000-0000-0000-0000-000000000003';

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
insert into profiles (id, full_name) values ('dddd0000-0000-0000-0000-000000000005', 'Only suggested');
insert into ifsc_pending (ifsc_athlete_id, firstname, lastname, suggested_profile) values (777001, 'Only', 'Suggested', 'dddd0000-0000-0000-0000-000000000005');
set role service_role;
select pg_temp.assert(delete_account_profile('dddd0000-0000-0000-0000-000000000005'), 'an IFSC suggestion alone does not keep a profile');
select pg_temp.assert((select suggested_profile from ifsc_pending where ifsc_athlete_id = 777001) is null, 'the athlete stays waiting, without the suggestion');
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
                  'public.rounds_seed_starters()', 'public.profiles_ifsc_id_guard()', 'public.ifsc_pending_forget_birthday()', 'public.profiles_ifsc_id_changed()',
                  'public.rankings_cache_touch_rounds()', 'public.rankings_cache_touch_seasons()',
                  'public.rankings_cache_touch_all()']) f;
-- Rankings cache: the stored payload is anon's view; only the refresh (pg_cron, postgres) writes it.
select pg_temp.assert(not has_table_privilege(r, t, p), r || ' cannot ' || p || ' ' || t)
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['public.season_rankings_cache', 'public.rankings_cache_changes']) t,
     unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p;
-- Ranking tables: everyone reads them; nobody writes them but store_ranking_tables() (service role).
select pg_temp.assert(has_table_privilege(r, 'public.ranking_tables', 'select'), r || ' reads ranking_tables')
from unnest(array['anon', 'authenticated']) r;
select pg_temp.assert(not has_table_privilege(r, 'public.ranking_tables', p), r || ' cannot ' || p || ' ranking_tables')
from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['insert', 'update', 'delete', 'truncate']) p;
select pg_temp.assert(not has_function_privilege(r, f, 'execute'), r || ' cannot execute ' || f)
from unnest(array['anon', 'authenticated']) r,
     unnest(array['public.ranking_tables_due(integer)', 'public.ranking_tables_input(text)', 'public.ranking_tables_invalidate()',
                  'public.store_ranking_tables(text, timestamptz, integer, jsonb)']) f;
select pg_temp.assert(not prosecdef, f || ' runs with the caller''s rights')
from unnest(array['public.ranking_page(integer, text, text, text, text, text)', 'public.home_rankings(integer, text[], integer)']) f
join pg_proc on oid = f::regprocedure;
select pg_temp.assert(not has_sequence_privilege(r, 'public.rankings_cache_changes_id_seq', p),
  r || ' cannot ' || p || ' the change log sequence')
from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['usage', 'select', 'update']) p;
-- anon never writes: no write privilege on any table or view in public, not even per column.
select pg_temp.assert(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update')
         or has_table_privilege('anon', c.oid, 'delete') or has_table_privilege('anon', c.oid, 'truncate')
         or has_any_column_privilege('anon', c.oid, 'insert') or has_any_column_privilege('anon', c.oid, 'update'))),
  'anon holds no write privilege on any public table');
-- TRUNCATE bypasses RLS: no API role may truncate a public table.
select pg_temp.assert(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege(r, c.oid, 'truncate')),
  r || ' cannot truncate any public table') from unnest(array['anon', 'authenticated', 'service_role']) r;
select pg_temp.assert(not has_function_privilege(r, 'public.refresh_rankings_cache()', 'execute'),
  r || ' cannot execute refresh_rankings_cache') from unnest(array['anon', 'authenticated', 'service_role']) r;
-- Climber page cache: the stored rows are anon's view; only the refresh (pg_cron, postgres) writes them.
select pg_temp.assert(not has_table_privilege(r, t, p), r || ' cannot ' || p || ' ' || t)
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['public.climber_cache_rounds', 'public.climber_cache_entries', 'public.climber_cache_changes']) t,
     unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p;
select pg_temp.assert(not has_sequence_privilege(r, 'public.climber_cache_changes_id_seq', p),
  r || ' cannot ' || p || ' the climber cache change log sequence')
from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['usage', 'select', 'update']) p;
select pg_temp.assert(not has_function_privilege(r, f, 'execute'), r || ' cannot execute ' || f)
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['public.refresh_climber_cache(interval)', 'public.climber_cache_touch()']) f;
select pg_temp.login(null);
select pg_temp.denied($$select * from climber_cache_entries$$, 'anon reads the climber cache');
select pg_temp.denied($$insert into climber_cache_changes (round_id) values (null)$$, 'anon marks the climber cache');
select pg_temp.denied($$select refresh_climber_cache()$$, 'anon refreshes the climber cache');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.denied($$update climber_cache_entries set entry = '{}'$$, 'admin writes the climber cache');
select pg_temp.denied($$delete from climber_cache_rounds$$, 'admin clears the built rounds');
select pg_temp.denied($$select refresh_climber_cache()$$, 'admin refreshes the climber cache');
reset role;
select pg_temp.assert(not prosecdef, f || ' runs with the caller''s rights (RLS as the caller)')
from unnest(array['public.climber_page(uuid)', 'private.climber_cache_build(uuid[])', 'private.round_history_for(uuid[])',
                  'public.refresh_climber_cache(interval)']) f
join pg_proc on oid = f::regprocedure;
select pg_temp.assert(prosecdef, 'climber_history_cached reads the closed cache tables')
from pg_proc where oid = 'private.climber_history_cached(uuid)'::regprocedure;
-- The helpers are in schema private, which the API does not expose; anon may run them (climber_page does).
select pg_temp.assert(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('round_history_for', 'climber_cache_build', 'climber_history_cached', 'climber_page_entry'))
  and has_schema_privilege('anon', 'private', 'usage')
  and has_function_privilege('anon', 'private.climber_cache_build(uuid[])', 'execute')
  and not has_schema_privilege('anon', 'private', 'create'),
  'climber page cache helpers live outside the exposed schema');
select pg_temp.assert(not exists (select 1 from pg_indexes where indexname = 'boulder_results_round_id_idx')
  and exists (select 1 from pg_indexes where indexname = 'boulder_results_round_climber_idx'),
  'boulder_results: the (round_id, climber_id) index replaces the round_id one');
select pg_temp.login(null);
select pg_temp.denied($$select * from season_rankings_cache$$, 'anon reads the rankings cache');
select pg_temp.denied($$insert into season_rankings_cache (season, payload) values ('2030-31', '{}')$$, 'anon writes the rankings cache');
select pg_temp.denied($$select refresh_rankings_cache()$$, 'anon refreshes the rankings cache');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.denied($$update season_rankings_cache set payload = '{}'$$, 'admin writes the rankings cache');
select pg_temp.denied($$delete from rankings_cache_changes$$, 'admin clears the pending changes');
select pg_temp.denied($$select refresh_rankings_cache()$$, 'admin refreshes the rankings cache');
reset role;
select pg_temp.assert(not prosecdef, f || ' runs with the caller''s rights (RLS as the caller)')
from unnest(array['public.season_rankings(text)', 'public.season_rankings_build(text)', 'public.refresh_rankings_cache()']) f
join pg_proc on oid = f::regprocedure;
select pg_temp.assert(prosecdef, 'season_rankings_cached reads the closed cache table')
from pg_proc where oid = 'public.season_rankings_cached(text)'::regprocedure;
select pg_temp.assert(has_function_privilege('authenticated', 'public.admin_accounts()', 'execute')
  and has_function_privilege('anon', 'public.has_role(public.app_role)', 'execute'),
  'admins (authenticated) keep admin RPCs; RLS helpers stay executable');

\echo ALL RLS TESTS PASSED
