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
    when insufficient_privilege or check_violation or raise_exception then
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
  ('40000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', 3, 2, null),
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

\echo ALL RLS TESTS PASSED
