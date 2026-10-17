# Architecture

## Apps

One repository, two Vite builds (`vite --mode viewer|staff`):

| | Viewer ("ILCA Live") | Staff ("ILCA Staff") |
|---|---|---|
| Entry | `apps/viewer/index.html` → `src/apps/viewer/ViewerApp.tsx` | `apps/staff/index.html` → `src/apps/staff/StaffApp.tsx` |
| Sign-in | none; the app has no auth provider at all | everything except `/login` |
| Routes | `/` (home), `/competitions`, `/competition/:id`, `/round/:id`, `/climber/:id`, `/favorites`, `/search`, `/rankings` | a home with one tile per role, `/judge`, `/coach`, `/admin/*`, plus the results pages |
| Output | `dist/viewer` | `dist/staff` |
| Site | https://ilca-climbing.pages.dev | https://ilca-climbing-staff.pages.dev |
| Dev | `npm run dev` (5173) | `npm run dev:staff` (5174) |

Both are Cloudflare Pages projects built from `main`; the data is in Supabase in Frankfurt.
Each app has its own manifest and service worker (a minimal offline shell; API calls always go to
the network). `VITE_STAFF_URL` / `VITE_VIEWER_URL` link the two headers.

Rule: never add sign-in, writes or staff pages to the viewer.

The viewer's Supabase client is `src/lib/supabaseViewer.ts` (PostgREST + Realtime only); a small
plugin in `vite.config.ts` swaps it in for every import of `src/lib/supabase.ts` in the viewer
build, so the public app carries no sign-in or storage code (~30% smaller). Less used pages
(rankings, climber, search, favorites; in the staff app also admin and coach) load when opened.

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
international_results, ranking_adjustments, world_rankings   -- national rankings inputs (admin-entered; world_rankings by tools/ifsc/world_ranking.py)
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

The API returns at most 1000 rows per request, so the rankings page does not page: it loads one
`season_rankings(season)` RPC (rounds, age classes, too-young seniors, international results,
adjustments, world rankings and profiles in one JSON), and the climber page one `climber_page(climber)`
RPC (profile, history and the competitions' series and season).

The viewer opens on a home page (`/`, `src/pages/Home.tsx`): continue watching, rounds live now (with
who is on the wall; refreshed every 5 s while something is live), the next 3 published competitions,
the 3 latest finished ones with each category's winners (rank 1 of its last round, ties all shown),
and the favorites. All of that but the favorites is one `home_page()` call (security invoker, explicit
public columns, drafts left out); the favorites are one `favorites_page(climbers)` call, only when the
device has some. After that the page loads this season's `season_rankings` for the top 3 senior men /
women in boulder and lead, through `lib/seasonRankings.ts`, the same loader, cache and calculation as
the rankings page. The competitions list by season is at `/competitions`.

A round page (results and judge pad) loads with one call, `round_page(round)`: the round, its
category and competition, the competition's categories with their rounds (men / women switch),
boulders, the start list, results and appeals (security invoker: the same RLS as separate
queries). Built files are cached for a year (`/assets/*`, content-hashed names), and the page
opens its connection to Supabase while the app downloads (preconnect). Round pages are cached for the visit and
the other categories' matching rounds are prefetched, so the men / women switch and the Q / S / F
chips open instantly; each visit then refreshes in the background.

## Security

Isolation is enforced in Postgres with row level security. The staff app hiding a menu is cosmetic;
calling the API directly still gets only what the policies allow.

| Who | Reads | Writes |
|---|---|---|
| Public (no sign-in) | published competitions, results of rounds that aren't planned, open appeals (not their reasons), rankings inputs | nothing |
| Judge | results and claims of their assigned boulders | results of their assigned boulders, only while the round is live and the result isn't locked; claims through `claim_climber()`, on the wall through `set_on_wall()` (only for a climber they hold) |
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

## Edge functions

`supabase/functions/` is the only server code. The functions hold the service-role key (on
Supabase, never in the apps) and accept calls only from signed-in admins (`_shared/admin.ts`).

**delete-account** deletes a login (its roles go with it; `profiles.user_id` is set null, so a
climber's profile and results always stay). It refuses the caller's own account and the last admin,
and removes the account's own profile only when nothing else references it (checked from the
foreign keys, so new tables count too; a judge's assignments and claims and an empty private row
don't). The staff app asks first.

**invite-judge** invites a judge:
`mode: "email"` lets Supabase Auth email the invite (needs SMTP), `mode: "link"` returns a one-time
link that the staff app wraps in its own `/invite#…` page, so link previews (WhatsApp, mail scanners)
can't use it up. An existing account just gets the judge role. Invite and reset links land on
`/set-password`. Request validation is in `request.ts` (unit-tested).

## Realtime

The results page subscribes to `boulder_results`, `lead_results` and `appeals` of its round, and
polls `on_wall(round)` every 5 s in live rounds (claims aren't public, so no Realtime for them); the
judge pad subscribes to `judge_claims` of its boulder. Everything else loads on navigation.

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
| 20261015000020 | on the wall: judges mark the climber climbing now (`set_on_wall`); public `on_wall(round)` |
| 20261015000021 | `admin_accounts()` casts the email (Supabase stores it as varchar) |
| 20261015000022 | `account_by_email()` for the invite-judge function (service role only) |
| 20261015000023 | `delete_account_profile()` for the delete-account function (service role only) |
| 20261015000024 | `delete_account_profile()` keeps a profile that any table references (from the foreign keys) |
| 20261015000025 | `round_page(round)`: a round page in one request (round, categories, start list, results) |
| 20261017000026 | `world_championship` event type for international results |
| 20261017000027 | senior minimum age (`season_senior_too_young`) |
| 20261017000028 | `world_rankings` (IFSC world-ranking position per climber, season, discipline) |
| 20261017000029 | page RPCs `season_rankings(season)` and `climber_page(climber)`; NULL-array fix |
| 20261017000030 | home page RPCs `home_page()` (live rounds and who is on the wall, upcoming, latest with winners) and `favorites_page(climbers)` |
