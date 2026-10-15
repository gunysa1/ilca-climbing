# Operations

## Environments

| | |
|---|---|
| Supabase project | `tsahkbtxjlgmebfmwkbq`, Frankfurt / eu-central-1 (Postgres, Auth, Realtime). Moved from Seoul on 2026-10-15 for latency |
| Local env | `.env.local` (not in git): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the publishable key), optional `VITE_VIEWER_URL` / `VITE_STAFF_URL` |
| Supabase CLI | `npx -y supabase@2.121.0` (pinned), linked with `supabase link --project-ref …` |

Never put the service-role key in the app or in git; the apps only need the publishable key.

## Deploying

Two Cloudflare Pages projects connected to this GitHub repository; every push to `main` builds
and publishes both (free plan: 500 builds a month, no cost per deploy).

| Project | Build command | Output directory |
|---|---|---|
| viewer (`ilca-live-…`) | `npm run build:viewer` | `dist/viewer` |
| staff (`ilca-staff-…`) | `npm run build:staff` | `dist/staff` |

Root directory: the repository root; Node from `.node-version`. The production settings are in the
committed `.env` (Supabase URL, publishable key, the two site addresses; nothing secret);
`.env.local` overrides them for local development. `apps/*/public/_headers` set `noindex` and the
one-year cache for `/assets/*`; Cloudflare serves `index.html` for app routes (single-page app).

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

### Temporary scoring app (`tools/tempapp/mirror.py`)

While events still run on the temporary app (ilca-boulder-score.netlify.app), its current round can
be mirrored read-only into this app: the script reads the app's public event data and prints one
idempotent SQL sync (competition, groups with age classes, the round with seeds, results upserted
only when changed). Run it every minute during the round and stop when the temporary app moves to
another round (it keeps one round at a time and clears results between rounds).

## Backups

Check what the project's Supabase plan backs up (project settings → Database → Backups). Before
large imports, export the affected tables (`supabase db dump --linked --data-only -t …`).
