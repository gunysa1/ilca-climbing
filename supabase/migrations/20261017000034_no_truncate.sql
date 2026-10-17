-- TRUNCATE bypasses row level security and no app path uses it: take it away from the API roles
-- (anon lost it in migration 033), on the existing tables and on tables created later.
revoke truncate on all tables in schema public from authenticated, service_role;
alter default privileges in schema public revoke truncate on tables from authenticated, service_role;
