-- E2E only: make the plain-Postgres shim behave like Supabase behind PostgREST.
-- PostgREST passes JWT claims as request.jwt.claims (JSON); Supabase's auth.uid() reads both forms.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
create role authenticator login noinherit;
grant anon, authenticated to authenticator;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@ilca.test',  '{"full_name":"Admin ILCA"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'judge@ilca.test',  '{"full_name":"Judge Yossi"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'parent@ilca.test', '{"full_name":"Parent"}'),
  ('00000000-0000-0000-0000-0000000000a4', 'dana@ilca.test',   '{"full_name":"Dana Suggested"}');
insert into user_roles values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'judge');

-- IFSC sync admin screen: one run with a skipped category; athletes waiting for confirmation (a confident and a
-- weak suggestion) and one ignored.
insert into ifsc_sync_runs (started_at, finished_at, status, added, updated, linked, pending, world, warnings)
  values (now(), now(), 'ok', 3, 1, 1, 1, 80, '["IFSC /api/v1/events/1/result/3: HTTP 404"]');
insert into ifsc_pending (ifsc_athlete_id, firstname, lastname, gender, birthday, suggested_profile, score, status, results) values
  (9001, 'Dana', 'Suggestion', 'female', '2008-05-05', '00000000-0000-0000-0000-0000000000a4', 0.8, 'pending',
   '[{"event_name": "IFSC World Cup Prague 2026 (BOULDER Women)"}, {"event_name": "IFSC World Cup Bern 2026 (BOULDER Women)"}]'),
  (9002, 'Weak', 'Guess', 'male', '2009-02-02', '00000000-0000-0000-0000-0000000000a4', 0.15, 'pending', '[{}]'),
  (9003, 'Gone', 'Away', 'male', null, null, null, 'ignored', '[{}]');
