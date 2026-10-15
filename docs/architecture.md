# Architecture

## Apps

One repository, two Vite builds (`vite --mode viewer|staff`):

| | Viewer ("ILCA Live") | Staff ("ILCA Staff") |
|---|---|---|
| Entry | `apps/viewer/index.html` → `src/apps/viewer/ViewerApp.tsx` | `apps/staff/index.html` → `src/apps/staff/StaffApp.tsx` |
| Sign-in | none; the app has no auth provider at all | everything except `/login` |
| Routes | `/`, `/competition/:id`, `/round/:id`, `/climber/:id`, `/favorites`, `/search`, `/rankings` | a home with one tile per role, `/judge`, `/coach`, `/admin/*`, plus the results pages |
| Output | `dist/viewer` | `dist/staff` |
| Dev | `npm run dev` (5173) | `npm run dev:staff` (5174) |

Each app has its own manifest and service worker (a minimal offline shell; API calls always go to
the network). `VITE_STAFF_URL` / `VITE_VIEWER_URL` link the two headers.

Rule: never add sign-in, writes or staff pages to the viewer.

## Data model

```
competitions (season, series)
  └─ categories (gender)
       ├─ registrations (climber, bib, age_class)
       └─ rounds (kind: qualification|semifinal|final, status: planned|live|closed,
          │       scoring: ifsc2025|classic|lead, advance_quota, time_tiebreak)
          ├─ boulders (number)            -- also the routes of a lead round
          ├─ round_starters (start_order, prev_place = countback seed, group_label)
          ├─ boulder_results (attempts, zone_attempt, top_attempt, locked)  → score_events (audit)
          ├─ lead_results (hold, plus, top, time_ms, locked)                → lead_events (audit)
          ├─ round_totals (tops, zones, attempts)  -- older LogLig rounds with totals only
          ├─ judge_assignments (judge, whole round or one boulder)
          ├─ judge_claims (who is scoring a climber on a boulder right now)
          └─ appeals (open|upheld|rejected) + appeal_details (reason, decision; admins only)
profiles (climbers and staff; user_id links a login, optional) + profile_private (birth date, contact)
user_roles (climber, coach, judge, admin), coach_athletes, coach_notes
international_results, ranking_adjustments   -- national rankings inputs (admin-entered)
```

Climbers are profiles without accounts. A login is linked to a profile only through the admin
function `link_account()`. Policies identify the caller with `my_profile_id()`.

## Scoring in the database

Ranks are computed by views, so the app, the history and the rankings always agree:

- `round_scores`: boulder (IFSC 2025 points, countback, attempts; classic T/Z; totals-only rounds)
- `lead_scores`: lead (single route by height; several routes by the geometric mean of route ranks)
- `round_ranks`: both together. `climber_history`, `ranking_rounds`: per climber / per season.

The same rules exist in TypeScript (`src/lib/scoring.ts`, `src/lib/lead.ts`) for live pages; tests
on both sides use the same cases. Details: [scoring-and-rankings.md](scoring-and-rankings.md).

### Performance

Window functions over every round are expensive, and Postgres can't push a filter into them, so
reading `climber_history` or `ranking_rounds` directly ranks the whole database (several seconds
with the full history, over the API's statement timeout). Pages call functions that compute only
the rounds they need, tested to return exactly the views' rows:

| Function | Instead of |
|---|---|
| `round_ranks_for(rounds)` | `round_ranks` |
| `lead_scores_for(rounds)` (the `lead_scores` view wraps it) | `lead_scores` |
| `climber_history_for(climbers)` | `climber_history` |
| `season_ranking_rounds(season)` | `ranking_rounds` |

The API returns at most 1000 rows per request; the rankings page pages through
`season_ranking_rounds`.

## Security

Isolation is enforced in Postgres with row level security. The staff app hiding a menu is cosmetic;
calling the API directly still gets only what the policies allow.

| Who | Reads | Writes |
|---|---|---|
| Public (no sign-in) | published competitions, results of rounds that aren't planned, open appeals (not their reasons), rankings inputs | nothing |
| Judge | results and claims of their assigned boulders | results of their assigned boulders, only while the round is live and the result isn't locked; claims through `claim_climber()` |
| Coach | private data and history of linked athletes | private notes on linked athletes |
| Admin | everything, incl. audit logs and appeal reasons | everything |

Further guarantees:

- Who entered a score is hidden from everyone but admins (column privileges); every change is
  appended to `score_events` / `lead_events`.
- Results are accepted only for climbers on the round's start list; a top implies a zone on the
  same or an earlier attempt (check constraints).
- Birth dates stay in `profile_private`. The rankings get youth age classes from
  `season_age_classes(season)`, which returns only the class, and only for climbers with a public
  result in a ranked competition that season.
- Admin and trigger functions are not executable by anonymous users (tested).

All of this is in `supabase/tests/rls_test.sql`.

## Realtime

The results page subscribes to `boulder_results`, `lead_results` and `appeals` of its round; the
judge pad to `judge_claims` of its boulder. Everything else loads on navigation.

## Migrations

`supabase/migrations/`, applied in order with `npx supabase db push --linked`:

| # | What |
|---|---|
| 20261014000001 | schema, RLS, IFSC 2025 scoring, audit log, history |
| 20261015000001 | tie-breaks (countback, attempts) |
| 20261015000002 | profiles without accounts, `link_account`, `my_profile_id` |
| 20261015000003 | CSV roster import (`import_roster`) |
| 20261015000004 | Supabase advisor hardening |
| 20261015000005-6 | start lists, advancement quota, seeds |
| 20261015000007-8 | lead format, lead results and scoring |
| 20261015000009 | climbers without attempts are unranked; lead time rule |
| 20261015000010 | history rows link to their round |
| 20261015000011 | qualification groups |
| 20261015000012 | lead: time breaks ties only in finals |
| 20261015000013 | totals-only rounds (`round_totals`) |
| 20261015000014 | classic rounds: countback in finals |
| 20261015000015 | national rankings (season, series, age classes, international results, adjustments) |
| 20261015000016 | per-round lead time tie-break flag (LogLig 2022-23 finals) |
| 20261015000017 | fast ranks (`*_for` functions) |
| 20261015000018 | judge claims, locked results, appeals |
| 20261015000019 | claims stale after 30 s |
