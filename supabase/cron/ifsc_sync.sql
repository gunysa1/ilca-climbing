-- Daily IFSC sync at 03:00 UTC: pg_cron calls the ifsc-sync edge function with the x-sync-secret header.
-- Applied by hand at rollout (not a migration: the local test Postgres has no pg_cron),
--   in the dashboard's SQL editor, after the function is deployed and IFSC_SYNC_SECRET is set.
--
-- First create the two Vault secrets once (never commit the values; the secret is the same value as the
-- function's IFSC_SYNC_SECRET, generated with `openssl rand -hex 32`):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<value>', 'ifsc_sync_secret');
--
-- Rollback:
--   select cron.unschedule('ifsc-sync');

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule('ifsc-sync', '0 3 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/ifsc-sync',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ifsc_sync_secret')),
    body := '{}'::jsonb,
    -- pg_net's default is 5 s; a run can take longer.
    timeout_milliseconds := 150000)
$$);
