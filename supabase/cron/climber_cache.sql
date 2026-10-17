-- Climber page cache (migration 036): every minute, pg_cron rebuilds, as the anon role, the rounds changed
-- since the last run and any round not built yet (up to ~20 s of work per run; the rest waits for the
-- next run). A minute with no writes costs a few small queries.
-- Applied by hand at rollout (not a migration: the local test Postgres has no pg_cron), in the dashboard's
-- SQL editor as postgres, right after `db push` applied migration 036 (not during an event: the push
-- builds an index on boulder_results, which blocks result writes briefly).
--
-- Schedule and build in one step: once the triggers exist, a change left pending for more than 5 minutes
-- makes every climber page build live again (correct, but slow), so do not leave the job unscheduled.
--   select pg_has_role('postgres', 'anon', 'SET');      -- must be true (postgres may SET ROLE anon)
--   (this file: schedules the job)
--   select public.refresh_climber_cache();               -- repeat until it returns 0 (~20 s per call)
-- After 2 minutes, check the runs:
--   select status, return_message, start_time, end_time from cron.job_run_details
--   where command like '%climber_cache%' order by start_time desc limit 5;
--
-- Force a full rebuild (e.g. after a migration that changes scoring or the stored rows): marks every round
-- stale; closed rounds serve their stored rows until each is rebuilt.
--   insert into public.climber_cache_changes (round_id) values (null);
--   select public.refresh_climber_cache();                -- repeat until it returns 0
--
-- Rollback (climber pages then build live, as before 036, still with its index):
--   select cron.unschedule('climber-cache');
--   do $$ declare t text; begin
--     foreach t in array array['boulder_results', 'lead_results', 'round_starters', 'round_totals', 'boulders',
--                              'rounds', 'categories', 'competitions'] loop
--       execute format('alter table public.%I disable trigger climber_cache_ins, disable trigger climber_cache_upd,
--                       disable trigger climber_cache_del, disable trigger climber_cache_trunc', t);
--     end loop; end $$;
--   delete from public.climber_cache_rounds;   -- the entries go with them
--   delete from public.climber_cache_changes;

create extension if not exists pg_cron;

select cron.schedule('climber-cache', '* * * * *', 'select public.refresh_climber_cache()');
