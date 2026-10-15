# ILCA Climbing — project notes for Claude

Competition app for the Israeli climbing team (ILCA): live boulder results, judge scoring pad,
coach views, per-climber history. React + Vite PWA, Supabase backend, Hebrew RTL default + English.
See README.md for the role/isolation table and scripts.

## Ground rules
- Role isolation lives in Postgres RLS (`supabase/migrations/`). UI gating (`RequireRole`) is cosmetic.
  Any change to tables/policies must keep `npm run test:db` green and add assertions to
  `supabase/tests/rls_test.sql` for new access paths.
- Scoring logic exists twice: `src/lib/scoring.ts` and SQL `boulder_points` / `round_scores` (latest
  definition in `20261015000005_start_lists.sql`; countback reads the stored seed `round_starters.prev_place`). Change both together; tests on both sides use
  the same cases (top on 3rd attempt = 24.8; tie-breaks: points, previous-round rank, top attempts,
  zone attempts).
- Identity: profiles exist without accounts. `profiles.user_id` links a login (only via `link_account()`);
  policies use `my_profile_id()`, never `auth.uid()` = profile id. Client code uses `useAuth().profileId`.
- Who climbs a round = `round_starters` (first rounds follow registrations by trigger; later rounds via
  `generate_start_list()`, top `rounds.advance_quota`). Results are only accepted for starters.
- Clients must select `RESULT_COLUMNS` from `boulder_results` (never `*`): `updated_by` is not granted.
- Dependencies are pinned exact; `.npmrc` sets legacy-peer-deps (npm 10 crashes on vitest 5 peers).
- Before claiming done: `npm run typecheck && npm test && npm run build && npm run test:db`; for UI/admin
  changes also `npm run test:e2e` (Docker + Playwright Chromium; screenshots in `$E2E_OUT`).

## Status (2026-10-15, local session)
Done: schema + RLS + scoring tests (80 DB assertions, 23 unit tests, admin E2E flow), app pages (live
results, competition, round results with Realtime, login, judge home + scoring pad, coach, my history),
PWA shell, reference analysis (`docs/reference-analysis.md`, IFSC style + tie-breaks), profiles without
accounts, admin UI (competitions/categories/rounds/boulders, registrations + CSV roster import, judge
assignments, result corrections + audit, accounts/roles/linking, coach links), per-round start lists
with advancement quota and seeds, age classes inside combined categories (results filter), "–" for
climbers who haven't climbed.

Local toolchain: REA needs Node 24 (`~/.nvm/versions/node/v24.22.0`), default Node is 25. Postgres 16
under /usr/lib/postgresql/16, Java 21, Playwright Chromium in ~/.cache/ms-playwright.

Live data (2026-10-15): the 2025-26 season imported from the recovered LogLig archive
(~/ilca-loglig-archive, private, not in git) with tools/loglig/import_loglig.py: 16 competitions
(8 boulder, 8 lead), 624 climbers; 97.9% of ranks identical to LogLig (rest: 0-point ties LogLig
ordered by unpublished data, one LogLig-internal inconsistency). Not importable from LogLig:
national-league boulder events (only "0T 0Z 0 0" placeholders) and classic-total-only boulder
results (no per-boulder detail). Other seasons: archive crawl in progress; import per season after
the same dry-run + rank comparison.

Open work, in order:
1. Parity gaps from the reference analysis: appeals, judge claim/lock, favorites, PDF/Excel export,
   notifications. Live project is at migration 20261015000006 (all applied).
2. Real Supabase project `rkuuzforzfjbdnybddwb` (linked 2026-10-15, all migrations applied with
   `npx -y supabase@2.121.0 db push --linked`; `.env.local` uses the publishable key). Remaining: first
   admin account, end-to-end test of all roles on the live project. Run `db advisors --linked` after
   schema changes; remaining SECURITY warnings are the intended RLS helpers and admin RPCs.
3. Netlify deploy (netlify.toml present).
4. LogLig history import **via export** (decided 2026-10-15): the user/ILCA will get a CSV/Excel export
   from LogLig; build an importer into competitions/categories/rounds/results once a sample file exists.

Decisions (2026-10-15): climber results stay **public** like IFSC (published competitions and their
results readable without login; private profile data stays RLS-protected). History comes from a
LogLig export, not its API.
