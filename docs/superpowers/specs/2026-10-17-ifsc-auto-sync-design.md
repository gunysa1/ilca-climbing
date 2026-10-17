# Automatic international results (IFSC sync)

## Goal

International results and world-ranking positions reach the national rankings without anyone running
`tools/ifsc` by hand. A scheduled job inside Supabase fetches IFSC (World Climbing) data, adds new
results for Israeli athletes, keeps the world-ranking positions current, and asks an admin only when
it cannot tell who an athlete is. Decided with the user on 2026-10-17: confident matches are linked
automatically; unclear ones wait for an admin.

## What it does on each run

1. **Events.** IFSC events of the leagues World Cups and World Championships, IFSC Youth, IFSC Europe
   Adults and IFSC Europe Youth whose start date is within the last 60 days (finished categories
   only). For every boulder and lead category: the ranking, keeping athletes with country ISR. Same
   rules as `tools/ifsc`: event type from the name (both the IFSC and the "World Climbing" names;
   senior World Championships = `world_championship`), season = the calendar year of the event
   (2026 events → 2026-27), place, field size = ranked athletes, last round reached.
2. **Athletes.** An ISR athlete whose IFSC id is in `profiles.ifsc_id` is that profile. Otherwise:
   - candidates = profiles with the same birth date (IFSC publishes the athlete's birthday) and
     gender, scored by the name comparison of `tools/ifsc/match.py` (consonant skeleton);
   - **confident** (one candidate, score ≥ 0.5, the next at least 0.15 lower): set `profiles.ifsc_id`
     and import;
   - otherwise the athlete goes to `ifsc_pending` with the best suggestion (if any) and their
     results wait.
3. **Results.** Insert into `international_results` only rows that don't exist yet (same climber,
   discipline, event and date). Never delete or change rows; never add rows to a (season, class,
   discipline) group that holds ILCA-published (`manual`) points. Rows get `ifsc_event_id` and
   `ifsc_dcat_id` so the pages can link to the IFSC results.
4. **World ranking** (`/api/v1/cuwr/{3,7,1,5}`): for the current season (Sept–Aug), before
   1 January the latest list replaces the season's positions (provisional); from 1 January the list
   `?date=<end year>-01-01` is loaded once and then left alone (official).
5. **Log.** One row per run in `ifsc_sync_runs`: start, end, status, results added, athletes linked,
   athletes pending, world-ranking rows, error text.

## Parts

- `supabase/functions/_shared/ifsc.ts` — pure functions (event type, season, reached, field size,
  name skeleton and match score, confident-match rule), unit-tested with Vitest.
- Edge function `ifsc-sync` (Deno): fetches IFSC with `referer: https://ifsc.results.info/`, reads
  and writes with the service role inside the function. Accepts either the cron secret
  (`IFSC_SYNC_SECRET`, a function secret, also stored in Vault for the cron call) or an admin's JWT
  ("run now"). Stops at the first IFSC error and logs it; a failed run changes nothing. (Task 8: a single failing
  category or athlete is skipped and listed in the run's warnings instead; see docs/operations.md.)
- Migration: `international_results` + `ifsc_event_id int`, `ifsc_dcat_id int` (nullable);
  `ifsc_pending (ifsc_athlete_id int primary key, name, birthday, gender, suggested_profile uuid null,
  score, first_seen, results jsonb)` and `ifsc_sync_runs` — admin read/write only (RLS + tests);
  `pg_cron` + `pg_net` job, daily at 03:00 UTC, calling the function URL with the secret from Vault.
- Admin (staff app, ניהול ← מדרג): "IFSC" box with the last runs, **run now**, and the pending
  athletes: suggested climber with **confirm**, **pick another climber** (existing ClimberPicker),
  or **ignore** (not an Israeli-team climber). Confirming sets `ifsc_id` and imports that athlete's
  waiting results right away.
- Public pages: international events link to their IFSC results page when `ifsc_event_id` is set
  (rankings rows and climber page).
- Existing rows from the 2026-10-17 import get their IFSC ids on the first run (matched by climber,
  event name and date).

## Not included

Results before the last 60 days (already imported); speed and combined; Asian/other continental
events; changing ILCA-published rows; any write from the public viewer.

## Rollout (needs the user's go-ahead)

Function deploy, `supabase secrets set IFSC_SYNC_SECRET` (a random value generated on this machine,
also written to Vault), migration push, one manual run with its log shown to the user, then the
daily schedule.
