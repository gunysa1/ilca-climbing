# ILCA Climbing — project notes for Claude

Competition app for the Israeli climbing team (ILCA): live boulder results, judge scoring pad,
coach views, per-climber history. React + Vite PWA, Supabase backend, Hebrew RTL default + English.
See README.md for the role/isolation table and scripts. Two apps share `src/`: the **viewer** (public,
view only, no sign-in; `src/apps/viewer`) and the **staff** app (sign-in; judge, coach, admin;
`src/apps/staff`). Never add sign-in, writes or staff pages to the viewer.

## Ground rules
- Role isolation lives in Postgres RLS (`supabase/migrations/`). UI gating (`RequireRole`) is cosmetic.
  Any change to tables/policies must keep `npm run test:db` green and add assertions to
  `supabase/tests/rls_test.sql` for new access paths.
- Scoring logic exists twice: `src/lib/scoring.ts` / `src/lib/lead.ts` and SQL `boulder_points` /
  `round_scores` / `lead_scores` (latest definitions: `20261015000014_classic_final_countback.sql`,
  `20261015000012_lead_time_final_only.sql`; countback reads the stored seed `round_starters.prev_place`).
  Change both together; tests on both sides use the same cases (top on 3rd attempt = 24.8; tie-breaks:
  points, previous-round rank, top attempts, zone attempts; classic: T, Z, attempts, countback in finals;
  lead: time only in finals). Totals-only rounds (older LogLig history) read `round_totals`.
- National rankings follow criteria editions (`src/lib/criteria.ts`: ILCA 2025 for 2023-24..2025-26,
  ILCA 2027 for 2026-27) and are computed only in `src/lib/rankings.ts` from `season_rankings`
  (`season_ranking_rounds`, `season_age_classes`, `season_senior_too_young`, `international_results`,
  `ranking_adjustments`, `world_rankings`; the last three admin-entered or tool-loaded). Tests: the criteria document's worked examples; validated against ILCA's published
  2024-25 youth bouldering ranking.
- Identity: profiles exist without accounts. `profiles.user_id` links a login (only via `link_account()`);
  policies use `my_profile_id()`, never `auth.uid()` = profile id. Client code uses `useAuth().profileId`.
- Who climbs a round = `round_starters` (first rounds follow registrations by trigger; later rounds via
  `generate_start_list()`, top `rounds.advance_quota`). Results are only accepted for starters.
- Clients must select `RESULT_COLUMNS` from `boulder_results` (never `*`): `updated_by` is not granted.
- Dependencies are pinned exact; `.npmrc` sets legacy-peer-deps (npm 10 crashes on vitest 5 peers).
- Before claiming done: `npm run typecheck && npm test && npm run build && npm run test:db`; for UI/admin
  changes also `npm run test:e2e` (Docker + Playwright Chromium; screenshots in `$E2E_OUT`).

## Status (2026-10-15)
Docs: README.md, docs/architecture.md, docs/scoring-and-rankings.md, docs/operations.md,
docs/guide-he.md (judges/admins, Hebrew), docs/reference-analysis.md.

Done: viewer + staff apps; judge invites (email or share link) and account deletion (edge
functions); "on the wall" marking; men / women switch; one-request round pages (`round_page`); IFSC 2025 / classic / lead scoring with tie-breaks (SQL + TS); start
lists, advancement, qualification groups, age classes; judge pad (one climber at a time, claims
stale after 30 s, locking); appeals; PDF print; admin (competitions, CSV roster, corrections +
audit, people/roles, rankings inputs); national rankings per the ILCA 2025 criteria (validated
against ILCA's published 2023-24 / 2024-25 tables); LogLig history 2020-21 to 2025-26 (80
competitions, 99.6% of ranks identical); live mirror of the temporary app (tools/tempapp).

Live project `tsahkbtxjlgmebfmwkbq` (Frankfurt; moved from Seoul 2026-10-15): all migrations applied with
`npx -y supabase@2.121.0 db push --linked`; the committed `.env` has the publishable key. Run
`db advisors --linked` after schema changes. Live writes (imports, data fixes) only with the
user's explicit go-ahead. Seasons run September to August.

Rankings follow criteria editions (`src/lib/criteria.ts`: ILCA 2025 for 2023-24..2025-26, ILCA 2027 for
2026-27); IFSC world-ranking positions for 2026-27 live in `world_rankings`. Edge function `ifsc-sync` (daily 03:00 UTC via
pg_cron + Vault; admin "run now" on the rankings admin page) adds new IFSC results for Israeli athletes, refreshes
`world_rankings` and leaves unclear athlete matches in `ifsc_pending`; `tools/ifsc` is for backfills.

Hosting: Cloudflare Pages builds both apps on every push to main (settings in the committed `.env`):
https://ilca-climbing.pages.dev (viewer), https://ilca-climbing-staff.pages.dev (staff); both noindex
until the public launch. Pushing to main publishes. The old Seoul project was deleted 2026-10-17; sign-up is off in Frankfurt.
Open work: first event fully on these apps (dry run: docs/dry-run-2026-10.md); offline retry queue for the judge pad; admin
screen for qualification groups; merging duplicate climber profiles; speed discipline; calendar;
notifications.

Decisions: results are public like IFSC; climbers have no sign-in page (view-only app); international
results come from IFSC (tools/ifsc for 2023-24 to 2026-27, then `ifsc-sync` daily; world_rankings for 2026-27, provisional until the 1.1.2027 list) where ILCA published no points, plus admin entries; LogLig test entries, simulations and
training camps are not imported.

Local toolchain: Node 25 (REA needs Node 24 at `~/.nvm/versions/node/v24.22.0`), Postgres 16 under
/usr/lib/postgresql/16, Java 21, Playwright Chromium in ~/.cache/ms-playwright.
