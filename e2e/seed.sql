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
  ('00000000-0000-0000-0000-0000000000a3', 'parent@ilca.test', '{"full_name":"Parent"}');
insert into user_roles values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'judge');
