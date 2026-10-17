-- Climber page cache (migration 036): every minute, pg_cron rebuilds, as the anon role, the rounds changed
-- since the last run and any round not built yet (up to ~20 s of work per run; the rest waits for the
-- next run). A minute with no writes costs a few small queries.
-- Applied by hand at rollout (not a migration: the local test Postgres has no pg_cron), in the dashboard's
-- SQL editor as postgres, after `db push` applied migration 036.
--
-- Before scheduling, check that postgres may act as anon and run the first build by hand (every round;
-- call it until it returns 0, or give it a longer budget):
--   select pg_has_role('postgres', 'anon', 'SET');      -- must be true (postgres may SET ROLE anon)
--   select public.refresh_climber_cache('5 minutes');    -- the number of rounds built
--
-- Force a full rebuild (e.g. after a migration that changes scoring or the stored rows): marks every round
-- stale; the stored rows are served until each is rebuilt.
--   insert into public.climber_cache_changes (round_id) values (null);
--   select public.refresh_climber_cache('5 minutes');
--
-- Rollback (climber_page() keeps serving the stored rows; delete them to build live again):
--   select cron.unschedule('climber-cache');
--   delete from public.climber_cache_rounds;   -- the entries go with them

create extension if not exists pg_cron;

select cron.schedule('climber-cache', '* * * * *', 'select public.refresh_climber_cache()');
