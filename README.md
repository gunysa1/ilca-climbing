# ILCA Climbing

Competition app for the Israeli climbing team: live boulder results, a judge scoring pad,
coach views and a full results history per climber. Hebrew (RTL) by default, English toggle.
Installable as a PWA; deploys to Netlify; data in Supabase (Postgres + Auth + Realtime).

## Roles and isolation

Isolation is enforced **in the database** with row level security (RLS), not in the UI.
Hiding a menu item is cosmetic; a user who calls the API directly still gets only what RLS allows.

| Role | Can read | Can write |
|---|---|---|
| Public (no login) | Published competitions, live/closed results | – |
| Climber | Own private profile, own history, coach notes **shared** with them | Own profile |
| Coach | Private profile + history of **linked** athletes only | Notes on linked athletes |
| Judge | Results of boulders they are assigned to | Results **only** for assigned boulders, **only** while the round is live |
| Admin | Everything, incl. the score audit log | Competitions, rounds, roles, judge/coach assignments |

Extra guarantees:
- Who entered a score (`updated_by`) is hidden from everyone but admins (column privileges).
- Every score change is appended to `score_events` (judge, time, values) for disputes.
- Climbers can only be scored in categories they are registered in.
- A top always implies a zone on the same or an earlier attempt (DB check constraint).

Climbers don't need a login. Admins create or import climber profiles; `profiles.user_id` optionally
links a login account, set only through the admin-only `link_account()` function (clients can't write
that column). Every "is this me" check uses `my_profile_id()`.

All of this is covered by `supabase/tests/rls_test.sql` (51 assertions, incl. scoring tie-breaks,
profiles without accounts and the roster import).

## Scoring

Default format is **IFSC 2025** boulder scoring: top = 25 points, zone = 10 points, minus 0.1 for
each failed attempt before the highest hold reached (never below 0); rank by total points. Equal
points are broken by countback to the previous round's rank, then fewer attempts on tops, then
fewer attempts on zones; remaining ties share a rank. A `classic` format
(tops, zones, top attempts, zone attempts) is available per round. Logic lives in
`src/lib/scoring.ts` and is mirrored in SQL (`boulder_points`, `round_scores`).

Verified against official IFSC 2026 results and the temporary ILCA app's scoring code
(see `docs/reference-analysis.md`).

## Climber history

`climber_history` (SQL view) lists every round a climber competed in: competition, date,
category, round, tops, zones, points, rank and field size. Shown on **My history** for climbers
and per athlete on the **Coach** page.

## Getting started

```bash
npm install
cp .env.example .env.local      # fill in your Supabase URL + anon key
npm run dev
```

Database:
1. Create a Supabase project.
2. Apply `supabase/migrations/*.sql` (Supabase CLI `supabase db push`, or paste into the SQL editor).
3. Create users (Authentication → Users). Each new user automatically gets a profile and the
   `climber` role. Make the first admin with the snippet in `supabase/admin.sql`; after that use the
   **Admin** pages in the app.

## Admin

`/admin` (admin role only):
- **Competitions**: create/edit competitions (draft → published → finished), categories, rounds
  (scoring format, planned → live → closed), number of boulders.
- **Registrations**: search or create climbers, bibs, and **CSV roster import** (same Hebrew/English
  headers as the temporary app; ID numbers are ignored; preview first, then one all-or-nothing import).
- **Round**: assign judges (whole round or one boulder), correct results after the round, audit log.
- **People**: accounts with roles (judge/coach/admin), link a login to an imported climber, coach ↔
  athlete links.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm test` | Unit tests (scoring, judge pad) |
| `npm run test:db` | Spins up a throwaway Postgres and runs the RLS isolation tests (needs Postgres 16 binaries) |
| `npm run test:e2e` | Admin UI end to end: throwaway Postgres + PostgREST (Docker) + Playwright Chromium |

## Not built yet

- Parity gaps from `docs/reference-analysis.md`: category groups, advancement quota, appeals,
  judge locking, exports, notifications
- Import of history from the current LogLig app
