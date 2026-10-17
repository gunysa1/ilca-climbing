-- Senior World Championships as an international event type. They earn points, but the ILCA 2025
-- criteria have no table for them yet: they score 0 (src/lib/rankings.ts) until the table is known.
alter type public.intl_event_type add value if not exists 'world_championship' after 'world_cup';
