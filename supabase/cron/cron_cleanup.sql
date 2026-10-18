-- Weekly cleanup of pg_cron's run log: cron.job_run_details is never purged, and the three every-minute jobs
-- add ~4,300 rows a day. system_status() (migration 045, the admin home's system box) looks up each job's last
-- run and last success there; 14 days of runs are plenty (a job without a success in 14 days is red anyway).
-- Applied by hand (not a migration: the local test Postgres has no pg_cron), in the dashboard's SQL editor as
-- postgres, any time.
--
-- Rollback:
--   select cron.unschedule('cron-cleanup');

create extension if not exists pg_cron;

select cron.schedule('cron-cleanup', '30 2 * * 0', $$
  delete from cron.job_run_details where end_time < now() - interval '14 days'
$$);
