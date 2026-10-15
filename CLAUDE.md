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
- National rankings (ILCA criteria 2025) are computed only in `src/lib/rankings.ts` from the
  `ranking_rounds` view, `season_age_classes()`, `international_results` and `ranking_adjustments`
  (admin-entered). Tests: the criteria document's worked examples; validated against ILCA's published
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

Done: viewer + staff apps; IFSC 2025 / classic / lead scoring with tie-breaks (SQL + TS); start
lists, advancement, qualification groups, age classes; judge pad (one climber at a time, claims
stale after 30 s, locking); appeals; PDF print; admin (competitions, CSV roster, corrections +
audit, people/roles, rankings inputs); national rankings per the ILCA 2025 criteria (validated
against ILCA's published 2023-24 / 2024-25 tables); LogLig history 2020-21 to 2025-26 (80
competitions, 99.6% of ranks identical); live mirror of the temporary app (tools/tempapp).

Live project `rkuuzforzfjbdnybddwb`: all migrations applied (through 20261015000019) with
`npx -y supabase@2.121.0 db push --linked`; `.env.local` uses the publishable key. Run
`db advisors --linked` after schema changes. Live writes (imports, data fixes) only with the
user's explicit go-ahead. Seasons run September to August.

Open work: Netlify deploy (needs `netlify login`); first event fully on these apps; offline retry
queue for the judge pad; judge invites instead of creating users in the Supabase dashboard; admin
screen for qualification groups; merging duplicate climber profiles; speed discipline; calendar;
notifications. Test data to remove when done: draft competition "בדיקת שיפוט"
(`f0000000-0000-4000-8000-000000000001`) and profiles `f0000000-0000-4000-8000-0000000001xx`.

Decisions: results are public like IFSC; climbers have no sign-in page (view-only app); no IFSC
data imported (international results are admin-entered); LogLig test entries, simulations and
training camps are not imported.

Local toolchain: Node 25 (REA needs Node 24 at `~/.nvm/versions/node/v24.22.0`), Postgres 16 under
/usr/lib/postgresql/16, Java 21, Playwright Chromium in ~/.cache/ms-playwright.
