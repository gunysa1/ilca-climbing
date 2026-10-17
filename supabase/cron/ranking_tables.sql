-- Ranking tables (migration 035): every minute, when a season's cached payload (rankings-cache job) is newer
-- than its stored tables, pg_cron calls the rankings-build edge function with the x-sync-secret header. A minute
-- with nothing due costs one small query and no call.
-- Applied by hand at rollout (not a migration: the local test Postgres has no pg_cron or pg_net), in the
-- dashboard's SQL editor as postgres, after `db push` applied migration 035, the function is deployed and
-- RANKINGS_BUILD_SECRET is set (`openssl rand -hex 32`; never commit the value):
--   select vault.create_secret('<value>', 'rankings_build_secret');
-- (the 'project_url' secret exists already: supabase/cron/ifsc_sync.sql)
--
-- First build by hand (or wait a minute after scheduling), then check:
--   select count(*), max(built_at) from public.ranking_tables;   -- 16 per cached season
--   select * from public.ranking_tables_due();                     -- empty
--
-- After a change to the ranking code (src/lib/rankings.ts, criteria.ts, rankingTables.ts): redeploy the function,
-- then rebuild every season: POST {"all": true} as an admin or with the secret, or
--   delete from public.ranking_tables;   -- every season is due again; the pages compute until rebuilt
--
-- Rollback (the pages compute every table in the browser again, as before):
--   select cron.unschedule('ranking-tables');
--   delete from public.ranking_tables;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule('ranking-tables', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/rankings-build',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'rankings_build_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
  where exists (select 1 from public.ranking_tables_due())
$$);
