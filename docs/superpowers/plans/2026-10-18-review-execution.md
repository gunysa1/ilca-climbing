# Executing the 2026-10-18 project review — plan

> For agentic workers: the review is `docs/superpowers/plans/2026-10-18-project-review.md` (item ids A1…E
> refer to it; read the items of your track there). Read CLAUDE.md first; it is binding. Each track runs on its
> own branch/worktree, is reviewed, then merged by the controller.

Requested by the user 2026-10-18 ("read the plan and implement using agents"). The first live event on the
apps is the lead league 28–29.10.26: everything here must be merged and deployed by 25.10; no deploys or
database changes from the day before the event until it is over.

## Rulings on the review's open questions (controller; the user may override)

- F3 lead finals: ILCA follows IFSC — the faster time breaks a tie left after countback in a final. A1 builds it.
- F5 push while closed: not built (in-app alerts only). D3 out of scope.
- F7 speed: not built. D2 out of scope. D6 public launch, D4 climber accounts, D8 (no value yet): out of scope.
- C2 admin MFA: after the event (an enrolment mistake could lock the only admin out the week of the event);
  only the dashboard switch "leaked password protection" — listed for the user.
- C1 backups: a dump script + docs; the plan check is the user's.
- C5 rate limits: docs note only.

## Global constraints (every track)

- CLAUDE.md ground rules: RLS is the security boundary; new access paths get assertions in
  `supabase/tests/rls_test.sql`; the viewer never gets sign-in, writes or staff pages; scoring changes in TS and
  SQL together with the same test cases.
- Hebrew default: every new string in `src/lib/i18n.tsx` (he + en), plain words. RTL; works at 360 px.
- Migrations: `supabase/migrations/20261018000042_*.sql` onwards, numbers reserved per track below. Security
  definer functions set `search_path = public`, revoke execute from public/anon unless anon is meant to call.
- Match the surrounding code (comments, naming, idioms). No new npm dependencies.
- Checks before reporting done: `npm run typecheck && npm test && npm run build && PGPORT_TEST=<port> npm run
  test:db`. Run `npm ci` in the worktree first if node_modules is missing. Do **not** run `npm run test:e2e`
  (fixed ports; the controller runs it after merging) unless your track says so — Track 1 writes e2e steps and
  may run e2e only after checking no other run is active (`ss -ltn | grep 54339` empty).
- Never touch the live project: no `db push`, no `functions deploy`, no `git push`, no live queries.
- Commit on your branch with clear messages. Do not dispatch subagents.

## Track 1 — lead event readiness (no migration expected; may take 046; PGPORT_TEST=54341)

Review items A1, A2, A3 (option a), A4, B6, and the Judge.tsx split from E (do the split first, as its own
commit, behaviour unchanged).

- A1: lead time in finals. Judge pad (`LeadPad`): when the round is a final with `time_tiebreak` not false, a
  time input (seconds with optional decimals, or m:ss; stored as `time_ms`), saved through the outbox with the
  row. Admin correction form for lead rounds: time column (finals). Public results and PDF: show the time in
  lead finals. Unit tests (parse/format of the time; saveQueue row with time_ms), an RLS/SQL assertion that a
  judge writes time_ms and a tie in a final breaks on it.
- A2: e2e lead competition (2-route qualification, 1-route final): roster, judge scores via the pad incl. one
  offline save, admin corrects a height, public shows "12+"/"TOP", a final tie broken by time. Run the e2e at
  the end (see constraints).
- A3(a): JudgeHome also lists the judge's assignments in planned rounds of competitions starting within the
  next 2 days (Israel date), greyed "not live yet", and prefetches those rounds' round_page into the offline
  store, so a pad opened the evening before reopens offline. Check RLS lets a judge read planned rounds'
  round_page (rounds/boulders/starters); if not, migration 046.
- A4: printable lead score sheet per route (start order, bib, name, blank height/time boxes, judge signature)
  from the admin round page, via the print view; add "paper score sheets printed" to the checklist's manual items.
- B6: "reopen" of a closed round sets `live` (not `planned`), with a confirmation.

## Track 2 — database fixes and system status (migrations 042–045; PGPORT_TEST=54342)

Review items B1, B2, B3, B7, C4, C7.

- B1 (042): profiles column grants — anon/authenticated select only the public columns; admins keep reading
  `user_id` (check every client read of profiles.user_id: AdminPeople, auth.tsx reads its own profile by
  user_id — keep that working, e.g. a column grant plus RLS, or `my_profile_id()`). RLS tests both ways.
- B2 (043): `home_page` upcoming uses `ends_on >= today`, flags `today` when on; Home shows "today". Tests.
- B3: admin competition page warns on a mixed-gender category in a ranked competition; roster import preview
  shows the gender each new category gets. No ranking change.
- B7 (044): `link_account` decides "has data" from the FK inventory (reuse `private.profile_refs()` from 040),
  not a hand list. RLS test with a lead result.
- C4 (045): admin-only `system_status()` (security definer; reads cron.job_run_details for the four jobs —
  guard so it works in the test Postgres without pg_cron —, rankings cache age per season, climber cache
  backlog, last IFSC run, ranking tables due) and a status box on the admin home, red when a job's last success
  is older than 10 minutes (IFSC: 26 hours).
- C7 (045, same migration): `admin_log` (who, when, table, row id, action, changed columns as jsonb, no
  personal data values) written by triggers on competitions, rounds, judge_assignments, user_roles, appeals;
  admin read only; shown on the round page change log and the competition page. RLS tests.

## Track 3 — infra, viewer and docs (no migration; PGPORT_TEST=54343)

Review items B4, B5, C1, C3, C6, E (error message mapping, docs refresh).

- B4: viewer service worker like the staff one (cache per build via `?v=`, shell re-cached when it changes,
  old assets pruned), keeping `notificationclick`.
- B5: one `formatDate(iso, lang)` helper used for every date shown; unit test with a western time zone.
- C1: `tools/backup/dump.sh` (data-only dump of the linked project to a path outside the repo, gzip, prints
  the size; refuses inside the repo) + docs/operations.md backup section (when to run, restore drill, delete
  after the retention period).
- C3: security headers in both `_headers` (nosniff, referrer policy, permissions policy, frame-ancestors none,
  a CSP allowing self, the Supabase origin https+wss, Google Fonts, data: images). Verify with `vite preview`
  that both apps load with no CSP violations (Playwright, any free port other than the e2e ports).
- C6: `.github/workflows/ci.yml`: typecheck, unit tests, build, test:db (Postgres 16), e2e (Docker +
  Playwright Chromium) on push and PR. Pinned action versions.
- E: map common Supabase errors (23505, 42501, network, JWT expired) to he/en text in one helper, used by
  Login, AdminRound, RosterImport, AdminCompetition; docs refresh (README features, CLAUDE.md status: merging,
  calendar, notifications, big screen, checklist are live; open work updated).

## After the tracks (controller)

Review each track, merge in order 1, 2, 3, resolve shared-file conflicts by keeping both, run all five checks
incl. e2e, then db push 042–046, advisors, push main (deploys), live smoke checks, memory/CLAUDE.md update.
Second wave after the event: D1 qualification groups (before 10.11), C2 MFA, D7.
