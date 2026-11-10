-- Start-list changes (DNS / DSQ, groups, start order) reach open pages live: the round page, big screen
-- and judge pad subscribe to round_starters and refetch. Read access is already public (starters_read).
-- Safe to re-run: skipped when the publication is missing (plain Postgres) or the table is already in it.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'round_starters') then
    alter publication supabase_realtime add table public.round_starters;
  end if;
end $$;
