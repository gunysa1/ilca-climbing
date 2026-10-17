-- Rankings cache (migration 033): every minute, pg_cron rebuilds the seasons with pending changes (and any
-- season not cached yet) as the anon role. A minute with no writes costs one small query.
-- Applied by hand at rollout (not a migration: the local test Postgres has no pg_cron), in the dashboard's
-- SQL editor as postgres, after `db push` applied migration 033.
--
-- Before scheduling, check that postgres may act as anon and run the first build by hand (~0.7 s per season):
--   select pg_has_role('postgres', 'anon', 'SET');      -- must be true (postgres may SET ROLE anon)
--   select public.refresh_rankings_cache();             -- the number of seasons built
--
-- Force a full rebuild (e.g. after a migration that changes scoring or the payload):
--   insert into public.rankings_cache_changes (season) values (null);
--   select public.refresh_rankings_cache();
--
-- Rollback (season_rankings() keeps serving the last stored payloads; delete them to build live again):
--   select cron.unschedule('rankings-cache');
--   delete from public.season_rankings_cache;

create extension if not exists pg_cron;

select cron.schedule('rankings-cache', '* * * * *', 'select public.refresh_rankings_cache()');
