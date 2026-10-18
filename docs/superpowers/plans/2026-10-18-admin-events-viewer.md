# Admin fix, profile merging, event day, calendar, notifications, big screen — plan

> For agentic workers: three independent tracks, each on its own branch/worktree, built in parallel,
> reviewed, then merged by the controller. Read CLAUDE.md first; it is binding.

Requested by the user 2026-10-18 ("Do the admin fix, duplicate profiles, event checklist, calendar,
notifications, big-screen. Now"). First live event on the apps: 28-29.10.26 (no deploys on event days).

## Global constraints (every track)

- CLAUDE.md ground rules: RLS is the security boundary; new access paths get assertions in
  `supabase/tests/rls_test.sql`; the viewer never gets sign-in, writes or staff pages.
- Hebrew is the default language: every new string goes into `src/lib/i18n.tsx` in both he and en.
  Plain words, no jargon. RTL layouts; must work at phone width (360 px).
- Migrations: `supabase/migrations/20261018000038_*.sql` onwards, numbers reserved per track below.
  `security definer` functions set `search_path = public` and revoke execute from public/anon unless
  anon is meant to call them.
- Match the surrounding code: comment density, naming, idioms. No new npm dependencies.
- Checks before reporting done: `npm run typecheck && npm test && npm run build &&
  PGPORT_TEST=<your port> npm run test:db`. Do **not** run `npm run test:e2e` (fixed ports, the
  controller runs it after merging). Add e2e steps to `e2e/admin-flow.mjs` only if cheap; say so.
- Never touch the live project: no `db push`, no `functions deploy`, no `git push`, no live queries.
- Commit on your branch with clear messages. Do not dispatch subagents.

## Track A — admin fix + merging duplicate profiles (migrations 038, 039; PGPORT_TEST=54331)

### A1. release_claim only releases the caller's own claim (038)

`release_claim` (20261015000018_judging_appeals.sql) deletes when `judge_id = my_profile_id() or
has_role('admin')`. An admin who also judges can free another judge's claim. Redefine it to delete
only the caller's own claim. Client callers (judgeOutbox.ts, Judge.tsx) only release their own, so
no client change expected — confirm. RLS test: an admin's release_claim leaves another judge's claim;
the owner's call removes it.

### A2. Merge two climber profiles (039 + admin UI)

Why: LogLig imports and IFSC matching left the same climber as two profiles (spelling variants).
History, rankings and the climber page must show one person.

Database: `merge_profiles(p_keep uuid, p_drop uuid, p_apply boolean default false) returns jsonb`,
admin only (raise 42501 otherwise), security definer.
- Returns a report: per table, how many rows move; profile field differences; `conflicts` (list of
  human-readable items with competition/round names); `applied` boolean. With `p_apply = false`
  nothing changes (preview). With `p_apply = true` and conflicts, raise with the conflicts in the
  message; no partial change.
- Refuse: same id, unknown id, both linked to a login (`user_id` both set), different non-null
  `ifsc_id`s.
- Conflicts (refuse): both have results/starters in the same round, both registered in the same
  category, both have an international result for the same event, both have a world-ranking row for the
  same season/discipline, a ranking adjustment that would duplicate a unique key. Find every unique
  constraint on tables referencing profiles and treat a collision as a conflict.
- Move every row in every table that references `profiles(id)` (inventory via pg_constraint; today
  includes registrations, boulder_results, round_starters, round_totals, lead_results, score_events,
  judge_assignments, judge_claims, appeals, coach_athletes, coach_notes, international_results,
  ranking_adjustments, world_rankings, ifsc_pending.suggested_profile, ifsc_dismissed, user_roles,
  profile_private, audit columns such as updated_by — verify each). Rows of the duplicate's own
  private data (profile_private, user_roles): keep's row wins, fill keep's nulls from drop.
- Profile fields: keep's value wins; fill keep's nulls from drop (birth date, gender, club, ifsc_id,
  user_id, …). Mind `profiles_ifsc_id_guard`, the unique ifsc_id index and the ifsc_id-change trigger
  (037): clear on drop before setting on keep, and the world-ranking clearing trigger must not wipe
  keep's moved rows.
- Safety net: after moving, check dynamically (pg_constraint) that no row anywhere still references
  p_drop; if one does, raise (a future table must make merging fail, not cascade-delete data). Then
  delete the drop profile.
- Record the merge (who, when, both ids, drop's name, the report) in a table `profile_merges`
  (admin read only).
- Caches: rankings change log (033) and climber cache (036) must pick the change up — verify the
  statement triggers fire for these updates; the drop's climber cache entry must go.
- `possible_duplicate_profiles() returns table (a uuid, a_name text, b uuid, b_name text, reason text)`,
  admin only: pairs whose names are equal after normalising (trim, collapse spaces, drop `-`, `'`, `"`,
  `׳`, `״`, case-insensitive), or same birth date and same first and last word in swapped order.
- RLS tests: non-admin refused; preview changes nothing; apply moves rows across tables incl. results,
  intl, world rankings, ifsc fields; conflicts refuse with no change; two logins refused; nothing
  references the dropped id; profile_merges readable by admin only.

Admin UI (`src/pages/admin/AdminPeople.tsx` or a new `AdminMerge.tsx` linked from it): pick "keep"
and "duplicate" (reuse ClimberPicker), show the preview (counts, differences, conflicts), "Merge" only
when no conflicts, a second confirmation naming both people and saying it cannot be undone. Show the
possible-duplicates list with a "compare" button that fills the two pickers. After merging, show the
kept climber's link.

## Track B — event-day checklist + error reporting (migration 040; PGPORT_TEST=54332)

### B1. Event-day checklist (staff, admin)

Route `admin/competition/:id/checklist`, linked from AdminCompetition. Automatic checks (green / red
with a link to fix), loaded with one admin-only RPC `event_checklist(p_competition uuid) returns jsonb`:
competition published and dated; every category has rounds; every round has a scoring format and at
least one boulder/route; first rounds have starters and every starter has a bib; non-final rounds
have an advance quota; every boulder/route has at least one judge; every assigned judge has a login
and has signed in at least once (auth.users last_sign_in_at, not exposed beyond "signed in / when");
no appeals left open from earlier days. Manual items (checkboxes kept in localStorage per competition,
per device, wrapped in try/catch), from docs/operations.md and docs/dry-run-2026-10.md "event
morning": no deploys or database changes today; every judge opened the app once on good signal after
the last deploy; venue wifi/cellular checked; temporary app ready as fallback; phones charged / power
banks; PDF printing works. Also show the newest client errors (B2) for this competition's day.

### B2. Error reporting (staff app only)

The viewer must not write, so it does not report (it may get a non-reporting error boundary with a
reload button).
- Table `client_errors` (id, created_at, profile_id default my_profile_id(), app, path, message,
  stack, user_agent, build, context jsonb). Insert only through RPC `report_client_error(...)`
  (authenticated): caps on field sizes (message 500, stack 4000, context 2000 chars), a rate limit
  (e.g. at most 30 per profile per 10 minutes; extra calls return quietly), deletes rows older than
  30 days. Admin can read and delete. RLS tests for each.
- Client (`src/lib/errorReport.ts`): window error + unhandledrejection handlers, a React error
  boundary around the staff layout (friendly message + reload), and the judge pad's permanent save
  failures / conflicts from saveQueue (not the normal offline retries). Dedupe identical messages for
  a minute; when offline keep up to 20 in memory and send when back online. Never report while
  signed out. Include the build id the service worker uses.
- Admin page `admin/errors`: last 7 days grouped by message (count, last seen, who, page, app
  build), expand for stack and context, "clear" per group. Linked from AdminHome.
- docs/operations.md: a short "Event day" addition — open the checklist, watch admin/errors.

## Track C — viewer: calendar, big screen, notifications (no migration expected; PGPORT_TEST=54333)

All read-only. If a new SQL read is truly needed, take migration number 041 and tell the controller.

### C1. Calendar

Route `/calendar` in the viewer (and staff, cheap to add), linked from the competitions page header
and from the home page's upcoming section — not a new top-nav item (phone width). Season selector
(seasons September–August, `src/lib/season.ts`), competitions grouped by month with date range, name
(name_he in Hebrew), venue, discipline and series tags, status (upcoming / live / finished), link to the
competition page, a "today" marker. "Add to calendar": an .ics file built in the browser per competition
and for the whole season (all-day events, UTF-8, proper escaping, stable UIDs from competition ids).
Pure .ics builder in `src/lib/ics.ts` with unit tests.

### C2. Big-screen mode

Route `/screen/:competitionId` (viewer) for a TV/projector at the venue: no top bar, large type,
dark high-contrast theme, rotates through the competition's live rounds/categories every ~20 s
(only live ones; if none live, the latest finished results), auto-scrolls lists longer than the screen,
shows who is on the wall, refreshes like the round page does, Wake Lock to keep the screen on, a
fullscreen button that hides itself, a small QR-free footer with the viewer address. Linked as
"מסך גדול" from the competition page. Reuse existing data loaders (round_page etc.); no extra load
beyond one viewer's polling.

### C3. Notifications (favourites, while the app is open)

Real push when the app is closed needs the viewer to store a subscription on the server — a write,
which the viewer must not do. So: in-app notifications for followed (★) climbers while the viewer is
open or in a background tab. On the favourites page, "Notify me" asks the browser permission and
explains plainly that it works while the app is open (on iPhone: only when installed to the home
screen). While enabled and a competition is live, poll cheaply (≤ one request per 30 s per open
viewer, paused when nothing is live and when the page is hidden for over 10 minutes) and notify when
a followed climber: is on the wall, gets a new result in a round (top/zone or place), advances to the
next round's start list, or finishes on the podium. Use the service worker's showNotification when
available (Android needs it), else `new Notification`. Remember what was already notified in
localStorage (try/catch). A pure diff function `src/lib/favoriteAlerts.ts` with unit tests. Settings:
on/off, which events. No server writes.

## After the tracks (controller)

Review each track, merge into main in order A, B, C, resolve i18n/rls_test/docs conflicts by keeping
both, run all five checks incl. e2e, db push 038-040 (and 041 if any) with the user's go-ahead
already given ("Now"), advisors, push to main (publishes), smoke-check live, update CLAUDE.md status.
