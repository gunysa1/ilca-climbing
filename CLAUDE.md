# ILCA Climbing — project notes for Claude

Competition app for the Israeli climbing team (ILCA): live boulder results, judge scoring pad,
coach views, per-climber history. React + Vite PWA, Supabase backend, Hebrew RTL default + English.
See README.md for the role/isolation table and scripts.

## Ground rules
- Role isolation lives in Postgres RLS (`supabase/migrations/`). UI gating (`RequireRole`) is cosmetic.
  Any change to tables/policies must keep `npm run test:db` green and add assertions to
  `supabase/tests/rls_test.sql` for new access paths.
- Scoring logic exists twice: `src/lib/scoring.ts` and SQL `boulder_points` / `round_scores` (latest
  definition in `20261015000001_scoring_tiebreaks.sql`). Change both together; tests on both sides use
  the same cases (top on 3rd attempt = 24.8; tie-breaks: points, previous-round rank, top attempts,
  zone attempts).
- Clients must select `RESULT_COLUMNS` from `boulder_results` (never `*`): `updated_by` is not granted.
- Dependencies are pinned exact; `.npmrc` sets legacy-peer-deps (npm 10 crashes on vitest 5 peers).
- Before claiming done: `npm run typecheck && npm test && npm run build && npm run test:db`.

## Status (2026-10-15, local session)
Done: schema + RLS + scoring tests (32 DB assertions, 12 unit tests), app pages (live results,
competition, round results with Realtime, login, judge home + scoring pad, coach, my history), PWA shell.
Reference analysis done (`docs/reference-analysis.md`): IFSC style tokens + results layout applied,
scoring confirmed against official IFSC data, tie-breaks added (countback, top/zone attempts).

Local toolchain: REA needs Node 24 (`~/.nvm/versions/node/v24.22.0`), default Node is 25. Postgres 16
under /usr/lib/postgresql/16, Java 21, Playwright Chromium in ~/.cache/ms-playwright.

Open work, in order:
1. Admin UI (competitions/categories/rounds/boulders, registrations incl. CSV import, judge + coach
   assignments, roles). Today this is done with `supabase/admin.sql`.
2. Parity gaps from the reference analysis: category groups, advancement quota + next-round start
   lists, appeals, judge claim/lock, favorites, PDF/Excel export, notifications.
3. Real Supabase project: apply migrations, set `.env.local`, end-to-end test of all roles.
4. Netlify deploy (netlify.toml present).
5. Open questions for the user: should climber results be private (currently public like IFSC)?
   Import history from LogLig (needs a LogLig token/export; see reference analysis §4)?
