# Operations

## Environments

| | |
|---|---|
| Supabase project | `tsahkbtxjlgmebfmwkbq`, Frankfurt / eu-central-1 (Postgres, Auth, Realtime). Moved from Seoul on 2026-10-15 for latency |
| Sites | https://ilca-climbing.pages.dev (viewer), https://ilca-climbing-staff.pages.dev (staff); Cloudflare Pages |
| Settings | `.env` (committed, public values only): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the publishable key), `VITE_VIEWER_URL` / `VITE_STAFF_URL`. `.env.local` (not in git) overrides them locally |
| Supabase CLI | `npx -y supabase@2.121.0` (pinned), linked with `supabase link --project-ref …` |

Never put the service-role key in the app or in git; the apps only need the publishable key.

## Deploying

Two Cloudflare Pages projects connected to this GitHub repository; every push to `main` builds
and publishes both (free plan: 500 builds a month, no cost per deploy).

| Project | Build command | Output directory |
|---|---|---|
| viewer (`ilca-climbing`, ilca-climbing.pages.dev) | `npm run build:viewer` | `dist/viewer` |
| staff (`ilca-climbing-staff`, ilca-climbing-staff.pages.dev) | `npm run build:staff` | `dist/staff` |

Root directory: the repository root; Node from `.node-version`. The production settings are in the
committed `.env` (Supabase URL, publishable key, the two site addresses; nothing secret);
`.env.local` overrides them for local development. `apps/*/public/_headers` set `noindex` and the
one-year cache for `/assets/*`; Cloudflare serves `index.html` for app routes (single-page app).

- To publish a change: push to `main`. Cloudflare builds both projects (about a minute); the
  build log is in the Cloudflare dashboard → Workers & Pages → the project → Deployments.
- When creating a project, choose **Pages** ("Looking to deploy Pages?"), not Workers: a Worker
  runs `wrangler deploy` and gets a workers.dev address.
- Public launch of the viewer: remove the `noindex` block in `apps/viewer/public/_headers` and the
  `Disallow` line in `apps/viewer/public/robots.txt`.
- History: the apps were on Netlify until 2026-10-15 (free credits ran out; those sites are deleted).

## Database changes

1. Add a migration in `supabase/migrations/` (next number); add assertions for every new access
   path to `supabase/tests/rls_test.sql`.
2. `npm run test:db` and the other checks (see the README).
3. Preview: `npx -y supabase@2.121.0 db push --linked --dry-run`; apply: `… db push --linked --yes`.
4. `npx -y supabase@2.121.0 db advisors --linked`: the remaining warnings are the intended RLS
   helpers and admin RPCs.

## Accounts and roles

- **Judges are invited in the staff app**: ניהול → אנשים → "הזמנת שופט/ת" (name + email), then
  "שליחה במייל" or "קישור לשיתוף" (WhatsApp / copy). The judge chooses a password and lands in the
  judge screen with the judge role; then assign them on the round page. Other accounts can still be
  created in Supabase (Authentication → Add user); a new user gets a profile and the `climber` role.
- One-time Supabase setup for invites and "forgot password":
  - Authentication → URL Configuration: Site URL = the staff site; add `<staff site>/**` to the
    redirect URLs.
  - Email delivery: Supabase's built-in email only reaches the project's team members. Connect SMTP
    (Authentication → Emails → SMTP settings), e.g. Gmail with an app password. Without it, use
    the share link.
  - Optional: the invite email template in Hebrew with the ILCA logo (`supabase/templates/invite.html`), and a longer "Email OTP expiration" so links
    stay valid longer (default 1 hour).
- **Removing someone**: untick their roles (access ends immediately), or ניהול → אנשים → "מחיקה" on
  their account row, confirmed in a sheet. Their login and roles go; climbers' results and history stay.
  You can't delete your own account or the last admin.
- Deploy the functions: `npx -y supabase@2.121.0 functions deploy invite-judge delete-account --use-api`.
- The first admin: `supabase/admin.sql`. After that: staff app → ניהול → אנשים (roles judge /
  coach / admin, linking a login to an existing climber profile, coach ↔ athlete links).
- Judges score only boulders they are assigned to (round page → judges), only while the round is live.

## Running a competition

1. **Competition**: ניהול → new competition (draft; the public doesn't see drafts). Set its season
   and series if it counts for the national rankings.
2. **Categories** (one per group; age classes inside a group are fine) and **registrations**:
   search/create climbers, or import the roster CSV (same Hebrew/English headers as the temporary
   app; a "קבוצה" column becomes the category and the row's category the age class).
3. **Rounds**: qualification with its number of boulders (lead: routes). Later rounds: set
   "advance from previous round" and generate the start list (ties at the cutoff advance; seeds are
   kept for countback). Qualification groups have no admin screen yet: set `round_starters.group_label`
   in the database (each group is ranked separately).
4. **Judges**: assign each judge to the whole round or one boulder.
5. **Publish** the competition and set the round **live**. Judges work in the staff app; the public
   follows in the viewer.
6. **During the round**: corrections and unlocks on the round page (every change is in the audit
   log); appeals are opened and resolved there and show as "ערעור" on the public results.
7. **Close** the round, generate the next start list, repeat; mark the competition finished.

### Event days (judge pad offline)

- **No deploys on event days** (nothing pushed to main from the day before until the event is over).
  A deploy changes the staff app's shell: a judge's phone keeps working from its cached copy, but a
  phone that hasn't picked up the new one can't reopen the pad without signal until it has.
- **After the last deploy before an event, every judge opens the staff app once on good signal**
  (Wi-Fi), signs in and opens their judge screen: that caches the app, their roles, assignments and
  round on the phone, so the pad reopens even without signal at the venue.
- Judges use one tab, don't clear browser data and don't sign out while "⏳ N ממתינים" shows (results
  wait on the phone and are sent by themselves). Results a judge reports from "N תוצאות לא נשמרו"
  (held by another judge, changed by an admin meanwhile, locked) are fixed on the round page.

## Imports

### LogLig history (`tools/loglig/import_loglig.py`)

LogLig, ILCA's previous system, is defunct. Its public pages were archived to a private directory
outside git (it contains minors' personal data; never commit it). The importer turns one
competition into one SQL transaction:

```bash
python3 tools/loglig/import_loglig.py ARCHIVE SEASON_ID:COMP_ID [...] > import.sql   # SQL
python3 tools/loglig/import_loglig.py --check ARCHIVE SEASON_ID:COMP_ID [...]        # LogLig ranks as JSON
```

- Ids are uuid5 of LogLig ids, so re-importing replaces a competition in place; a climber (name +
  birth date) maps to one profile across competitions. Birth dates go to `profile_private` only.
- It merges LogLig's split categories, skips LogLig test entries, club simulations and training
  camps, and sets each competition's season (by date) and series (by title).
- Workflow per season: import into a throwaway Postgres, compare ranks with `--check`, explain
  every difference, then import live. Delete local SQL files afterwards (personal data).
- Imported so far: 2020-21 to 2025-26, 80 competitions, 99.6% of ranks identical to LogLig.

### IFSC daily sync (edge function `ifsc-sync`)

Every day at 03:00 UTC pg_cron calls the `ifsc-sync` edge function. It reads the IFSC results API for
events of the last 60 days, counted on the Israel calendar (World Cups and Championships, European and youth
events; boulder and lead), adds Israeli results to `international_results` (never into a season/class/discipline
group with ILCA-published points), corrects `place`, `field_size` and `reached` of its own recent rows when IFSC
revised them (never `manual` rows; counted as "corrected"), links new athletes to a profile when the match is
confident (birth date, gender, name; sets `profiles.ifsc_id`) and leaves the others in `ifsc_pending` for an
admin, and refreshes the season's `world_rankings`: today's list until 1 January; during January the 1 January
list daily, replaced only when IFSC revised it; after January the 1 January list once if never stored.

Failures: all IFSC requests happen before the first write. If the season, league or event lists fail, or every
category, athlete and world-list request fails (at least two), the run is `failed` and writes nothing; any success
(e.g. the world lists) keeps it an `ok` run with warnings. A single category or
athlete that fails (HTTP error, not JSON, malformed) is skipped, listed in the run's `warnings` (shown on the
admin page as "N skipped") and tried again next run; nothing is written for it. A failing world list skips the
world part only (the stored positions stay). An IFSC row an admin deletes (ניהול → דירוגים) is remembered in
`ifsc_dismissed` and never imported again.

Admin (staff app): ניהול → דירוגים lists the athletes to confirm with gender, birth date and their events.
**Confirm** appears only for a confident suggestion (score ≥ 0.5); a weaker one is shown as text with "pick
another climber" as the main action, and every link asks again, naming both people. Ignored athletes ("not on
the team", birthday cleared) sit in a collapsed list with **restore**. ניהול → אנשים shows each climber's IFSC
number (link to the IFSC athlete page) with edit and unlink (replacing a number asks first; a number taken by
another climber is refused). Any change of `profiles.ifsc_id` (trigger, migration 037) deletes the climber's
current-season world positions and keeps the old athlete in `ifsc_pending` as ignored (shown as "IFSC #<id>"
until the next run sees them), so the sync never links them again by itself; results already imported stay
(delete wrong ones under דירוגים). A newly set number is imported right away (`{ athlete }`). The sync never
auto-links an ignored athlete; `profiles.ifsc_id` must be a plain number (check constraint). Results link to the
IFSC event page: IFSC has no stable URL for one category's results (its category page is
`/event/<id>/general/<discipline>` and opens the category last viewed in that browser).

Setup (once; the secret is never committed):

```bash
npx -y supabase@2.121.0 functions deploy ifsc-sync --no-verify-jwt --use-api   # it checks auth itself (also in config.toml)
openssl rand -hex 32                                            # the secret
npx -y supabase@2.121.0 secrets set IFSC_SYNC_SECRET=<secret> --project-ref tsahkbtxjlgmebfmwkbq
```

Store the same value in Vault as `ifsc_sync_secret`, and the project URL as `project_url`, then run
`supabase/cron/ifsc_sync.sql` in the SQL editor (both steps are in its header; rollback:
`select cron.unschedule('ifsc-sync')`).

Manual run: "run now" on the admin page, or `POST <project_url>/functions/v1/ifsc-sync` with header
`x-sync-secret` (or an admin's `Authorization: Bearer` token) and body `{}`; `{"athlete": <IFSC id>}`
imports the waiting results of a just-linked athlete and writes their positions in the current world list.
Each call logs a row in `ifsc_sync_runs` (`running`, then `ok` with counts and `warnings`, or `failed` with the
error), shown on the admin page. One run at a time (a partial unique index allows one `running` row,
migration 037): a call while another runs gets 409 `busy`; a run still `running` after 15 minutes is marked
`failed` ("timed out"). The sync's list replaces the season's positions daily until 1 January
(only climbers with an `ifsc_id`), so positions loaded by `tools/ifsc/world_ranking.py` don't last.

### Rankings cache (pg_cron `rankings-cache`)

The rankings page reads a stored payload per season (`season_rankings_cache`, migration 033). Every
minute pg_cron runs `select public.refresh_rankings_cache()`, which rebuilds, as the anon role, the
seasons whose data changed since the last run (results, start lists, competitions, profiles,
international results, adjustments, world rankings) and any season not stored yet. Until the refresh,
a changed season shows its previous payload (at most about a minute old).

Setup (once, after `db push` applied 033): run `supabase/cron/rankings_cache.sql` in the SQL editor
(its header checks `pg_has_role('postgres', 'anon', 'SET')` and runs the first build by hand).

- Force a refresh now: `select public.refresh_rankings_cache();` (returns the number of seasons rebuilt).
- Force a full rebuild (after a migration that changes scoring, the build or the payload, which no
  trigger notices): `insert into public.rankings_cache_changes (season) values (null);` then the refresh.
- Check: `select season, built_at, length(payload::text) from public.season_rankings_cache order by 1;`
  and `select count(*) from public.rankings_cache_changes;` (pending; 0 right after a refresh);
  failed runs: `select * from cron.job_run_details where command like '%rankings%' order by start_time desc limit 5;`
- Rollback: `select cron.unschedule('rankings-cache'); delete from public.season_rankings_cache;`
  (without stored rows `season_rankings` builds live, as before 033).
- Emergency switch for event day (if the result triggers ever slow the judge pad): stop marking on
  result writes; the public rankings then keep the last stored payload.
  ```sql
  alter table public.boulder_results disable trigger rankings_cache_ins, disable trigger rankings_cache_upd, disable trigger rankings_cache_del;
  alter table public.lead_results disable trigger rankings_cache_ins, disable trigger rankings_cache_upd, disable trigger rankings_cache_del;
  ```
  Afterwards re-enable and rebuild everything (the writes in between were not marked):
  ```sql
  alter table public.boulder_results enable trigger rankings_cache_ins, enable trigger rankings_cache_upd, enable trigger rankings_cache_del;
  alter table public.lead_results enable trigger rankings_cache_ins, enable trigger rankings_cache_upd, enable trigger rankings_cache_del;
  insert into public.rankings_cache_changes (season) values (null);
  select public.refresh_rankings_cache();
  ```

### IFSC international results (`tools/ifsc`, backfills)

The manual tools below are now for backfills (older seasons, one-off checks); the daily sync keeps the
current season. Reads the public IFSC results API (ifsc.results.info; curl, since other clients get 403) for every
Israeli boulder/lead result at World Cups, World and European Championships, European Cups and the
youth European/World events, then matches athletes to profiles by birth date and name:

```bash
python3 -I tools/ifsc/scrape.py OUT          # OUT/isr_results.json, isr_athletes.json (+ cache)
# export profiles (id, full_name, full_name_he, gender, ifsc_id, birth_date) to OUT/profiles.json and
# the current international_results to OUT/manual.json (supabase db query --linked … > file)
python3 -I tools/ifsc/match.py OUT           # OUT/matches.json; review "check" and "name-only" lines
python3 -I tools/ifsc/to_sql.py OUT tools/ifsc   # OUT/ifsc_import.sql: add-only, one transaction
python3 -I tools/ifsc/compare.py OUT tools/ifsc  # computed vs ILCA-published points
```

The import skips groups (season, class, discipline) where ILCA published points, events without a
table and athletes without a reliable match, and sets `profiles.ifsc_id`. Loaded 2026-10-17: 428
results, 100 climbers. The exports hold birth dates: keep OUT outside git and delete it afterwards.

World ranking positions (for the ILCA 2027 criteria, season 2026-27): export `id, ifsc_id` of profiles
to OUT/profiles.json:

```bash
npx -y supabase@2.121.0 db query --linked "select id, ifsc_id from profiles where ifsc_id is not null" > OUT/profiles.json
```

then

```bash
python3 -I tools/ifsc/world_ranking.py OUT 2026-27 $(date +%F)   # OUT/world_ranking.sql, lists unmatched ISR athletes
```

It reads the IFSC world ranking (boulder and lead, men and women) on that date and writes one
transaction that replaces the season's positions per discipline (delete, then insert: a climber missing
from the list loses old points) in `world_rankings`. A date after 1 January of the season's second year is
refused unless `--force` is passed, so the official list is not overwritten. Run it during the season with today's date (provisional
positions) and again with `2027-01-01` once that date has passed: that sets the official position for
2026-27. Load the SQL only with the user's go-ahead.

### Temporary scoring app (`tools/tempapp/mirror.py`)

While events still run on the temporary app (ilca-boulder-score.netlify.app), its current round can
be mirrored read-only into this app: the script reads the app's public event data and prints one
idempotent SQL sync (competition, groups with age classes, the round with seeds, results upserted
only when changed). Run it every minute during the round and stop when the temporary app moves to
another round (it keeps one round at a time and clears results between rounds).

## Backups

Check what the project's Supabase plan backs up (project settings → Database → Backups). Before
large imports, export the affected tables (`supabase db dump --linked --data-only -t …`). Dumps
contain personal data (minors' birth dates): keep them out of git and delete them after use.

The previous project in Seoul (`rkuuzforzfjbdnybddwb`) was deleted on 2026-10-17.

## Moving the database to another Supabase project

How the move Seoul → Frankfurt was done (2026-10-15), with the CLI only (no database password):

1. Create the new project in the dashboard (its owner keeps the password).
2. In a separate folder with a copy of `supabase/`: `supabase link --project-ref <new>`,
   `db push --linked` (all migrations), `functions deploy invite-judge delete-account --use-api`.
3. From the old project: `db dump --linked --data-only -f data.sql` (includes `auth.users` with
   password hashes). Drop the `auth.sessions`, `refresh_tokens`, `one_time_tokens` and
   `mfa_amr_claims` inserts and the psql-only `\restrict` lines; wrap the inserts in one transaction.
4. Load it as the new folder's `supabase/seed.sql` with `db push --linked --include-seed` (the
   dump sets `session_replication_role = replica`, so triggers don't fire).
5. Verify: row counts per table, and hashes of `round_ranks_for(…)` and
   `season_ranking_rounds(season)` on both sides; then point `.env` at the new project, relink the
   repo, and redo the dashboard settings (URL configuration, sign-up off, SMTP, email template).
