# ILCA Climbing

Results, judging and rankings for the Israel Climbing Association (ILCA, התאחדות הטיפוס בישראל):
live boulder and lead results, a judge scoring pad, coach views, the full history of every climber
since 2020-21, and the national rankings. Hebrew (RTL) by default with an English toggle.
React + Vite PWAs on Cloudflare Pages, data in Supabase (Postgres, Auth, Realtime; Frankfurt).

## Two apps, one codebase

| App | For | Sign-in | What it has |
|---|---|---|---|
| **ILCA Live** (viewer) | the public, climbers, families | none, view only (like the IFSC app) | live results by season, competitions, rounds (results + start list), climber pages, favorites, search, national rankings, PDF print |
| **ILCA Staff** | judges, coaches, admins | required | judge pad, coach view and notes, admin (competitions, rosters, start lists, corrections, appeals, rankings inputs), plus the results pages |

Both read the same database. Who may do what is enforced in Postgres with row level security; the
viewer's bundle doesn't even contain sign-in, judge, coach or admin code.

## Features

- **Live results** in IFSC style (IFSC 2025 boulder points with countback, lead geometric-mean
  ranking, classic T/Z for older rounds), updating in real time, with start lists, qualification
  groups, age-class filters inside combined categories, a men / women (category) switch, "on the wall now" per boulder, favorites, open-appeal badges, the time of
  the last update and a print/PDF view.
- **Judge pad**: one climber at a time in start order, large + / − attempt stepper, Top / Zone,
  live points, confirmations before locking, auto-advance to the next climber still to judge.
  "▶ On the wall" shows the public who is climbing now on each boulder (only when the judge marks
  it or counts an attempt; off on lock, leaving the climber, or 30 s without the pad).
  Claims stop two judges scoring the same climber (stale after 30 s); locked results change only
  through an admin.
- **Judge invites** from the staff app (email or a WhatsApp-safe share link), choose-a-password and
  forgot-password pages; admins delete accounts after a confirmation (climbers' history stays).
- **Admin**: competitions → categories → rounds → boulders, CSV roster import, start lists with
  advancement quotas and seeds, judge assignments, result corrections with a full audit log,
  appeals, international results and ranking adjustments.
- **History**: every ILCA competition 2020-21 to 2025-26 recovered from the defunct LogLig system
  (80 competitions, ~1,550 climbers; 99.6% of ranks identical to LogLig).
- **National rankings** (מדרג לאומי) per the ILCA 2025 criteria: seniors and U21 / U19 / U17, boulder
  and lead, validated against ILCA's published ranking tables.

## Quick start

```bash
npm install
cp .env.example .env.local        # Supabase URL + publishable (anon) key
npm run dev                       # viewer on http://localhost:5173
npm run dev:staff                 # staff on  http://localhost:5174
```

Database: create a Supabase project, then `npx supabase login`, `npx supabase link --project-ref <ref>`
and `npx supabase db push --linked` to apply `supabase/migrations/`. Make the first admin with
`supabase/admin.sql`; everything after that is done in the staff app. Details:
[docs/operations.md](docs/operations.md).

## Repository

```
apps/viewer, apps/staff     page shell, manifest and service worker of each app
src/apps/{viewer,staff}     the two apps' routes and layouts
src/pages, src/components   screens (shared; each app mounts the ones it needs)
src/lib                     scoring, lead, rankings, seasons, data loading, i18n
supabase/migrations         schema, row level security, scoring views (SQL)
supabase/tests              RLS and scoring tests (rls_test.sql)
e2e                         end-to-end test of both apps (Postgres + PostgREST + Playwright)
tools/loglig                importer for the recovered LogLig archive
tools/tempapp               live mirror of the temporary scoring app
supabase/functions          edge functions for admins: invite-judge, delete-account
docs                        architecture, scoring and rankings, operations, Hebrew user guide
```

## Testing

| Command | What it checks |
|---|---|
| `npm run typecheck` | TypeScript |
| `npm test` | unit tests: scoring and tie-breaks, lead, judge pad, rankings (the criteria document's worked examples), seasons, favorites, search |
| `npm run test:db` | a throwaway Postgres with all migrations: ~120 assertions on row level security, scoring views, start lists, claims, locks, appeals, rankings functions |
| `npm run test:e2e` | both apps end to end: admin builds a competition, imports a roster, corrects results, a judge scores and locks, an appeal shows publicly, rankings, the viewer stays view-only |
| `npm run build` | production builds to `dist/viewer` and `dist/staff` |

Run all of them before merging; scoring lives in both TypeScript and SQL and the tests on both
sides use the same cases.

## Documentation

- [Architecture](docs/architecture.md): apps, data model, security, performance
- [Scoring and rankings](docs/scoring-and-rankings.md): every rule, where it comes from, how it was checked
- [Operations](docs/operations.md): running an event, imports, deploying, maintenance
- [מדריך לשופטים ולמנהלים](docs/guide-he.md): the Hebrew guide for judges and admins
- [Reference analysis](docs/reference-analysis.md): the IFSC, LogLig and temporary-app study behind the design
