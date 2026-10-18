# Project review and plan — 2026-10-18

A review of the whole project as it is live today (main ec98b75, migrations 001–041 applied). Nothing in
this document is implemented; it is a plan for the user to review. Items are ordered by what matters for
the first live event, ליגת העל בהובלה 28–29.10.26, then by risk.

What was reviewed: README, docs (architecture, operations, scoring-and-rankings, guide-he, dry-run), every
migration, both apps' routes, all pages and libraries, the four edge functions, the cron jobs, the unit /
database / end-to-end tests, the deployment files (Cloudflare `_headers`, service workers, manifests) and
read-only checks of the live project (counts, cron run history, public column access, advisors).

Live facts used below: 1,558 profiles, 90 competitions, 40 MB database, **1 login (the admin) and no judge
accounts**, 9 season competitions entered as shells (the 28–29.10 lead league has **0 categories**), all four
cron jobs succeeded on every run of the last two days (no failures), 4 mixed-gender categories in ranked
series (all 2021-22, before the first ranked youth season, so no effect today).

---

## A. Must be done before 28.10 (the lead league)

### A1. Lead finals: nobody can enter the climbing time — BUG, blocks the event
- `lead_results.time_ms` exists and the ranking uses it (SQL `lead_scores`, `src/lib/lead.ts`: in a final,
  the faster time breaks a tie left after countback). But **no screen writes it**: the judge pad's `LeadPad`
  (src/pages/Judge.tsx) has hold / + / TOP only; the admin correction form on the round page has hold / + /
  TOP only (src/pages/admin/AdminRound.tsx). docs/dry-run-2026-10.md step 12 ("Final: 1 route, with times;
  ties in the final break on time") cannot be done.
- Effect: a tie in a lead final is shared instead of broken by time (IFSC 11.6), and there is no way to fix
  it in the app.
- Plan: (1) judge pad, lead finals only (`round.kind = 'final'` and `time_tiebreak`): a time field
  (mm:ss or seconds, stored as ms) next to the height, through the outbox like the other fields; (2) the admin
  correction form: a time column for lead rounds; (3) the public results and PDF: show the time in finals;
  (4) tests: saveQueue (row shape), RLS test asserting a judge can write `time_ms` and the SQL tie-break, e2e
  step for a lead final with a tie. Small (~1 day). Bump nothing in rankings (time only affects round rank,
  which the rankings read from `round_ranks`).

### A2. Lead judge flow has no end-to-end coverage
- e2e/admin-flow.mjs scores only boulder rounds. The first event on the apps is a lead event; the lead pad,
  lead corrections, lead start lists with 2 routes (geometric mean) and the final (1 route, countback, time)
  are only unit- and SQL-tested.
- Plan: add a lead competition to the e2e (2-route qualification, 1-route final), judge scores through the
  pad (incl. offline step), admin corrects a height, public page shows "12+" / "TOP", a tie breaks on time
  (after A1). ~half a day.

### A3. Judges cannot pre-cache the pad before the round is live
- docs/operations.md says every judge opens the staff app once on good signal after the last deploy so the
  pad reopens without signal. But `JudgeHome` lists assignments only where `round.status = 'live'`
  (src/pages/Judge.tsx:39), and the round page is kept offline only when it is opened. Opened the day before
  (round planned), the judge sees "no assignments" and nothing round-specific is cached; on the morning the
  admin sets the round live, and the judge must open the pad again on signal.
- Plan: either (a) list planned rounds of today's/tomorrow's competitions too (greyed, "not live yet") and
  prefetch their round page for offline, or (b) say so plainly in the guide and checklist ("after the admin
  sets the round live, open your boulder/route once"). (a) is ~half a day; (b) is a docs change. Recommend (a).

### A4. No fallback for a lead event
- The documented fallback is the temporary scoring app (tools/tempapp mirror), which is a **boulder** app.
  For 28–29.10 the fallback is paper. Plan: a one-page printable lead score sheet per route from the start
  list (reuses the PDF print view), listed in the checklist's manual items. ~2 hours.

### A5. Event setup and accounts (user's work, with app support)
- The lead league has no categories, rounds, roster or judges yet; there is one login in the project and
  no judge accounts. The checklist page will show all of this red. Plan: the user enters the event; judges
  are invited by share link (SMTP state unknown — see F1); the dry run (docs/dry-run-2026-10.md) is still
  unscheduled. Recommend running it on a weekday before 25.10 with at least the lead pad.

---

## B. Bugs and defects found (not blocking the event)

### B1. Public can read `profiles.user_id` (and `created_at`)
- `profiles_read` is `using (true)` and the table keeps the default full `select` grant; a live anon query
  returns `user_id` (the auth user id of linked accounts). Not a secret, but it ties a public profile to an
  account id and is not needed by any public screen (the apps use `my_profile_id()`).
- Plan: migration — revoke select on profiles from anon/authenticated, grant the public columns only
  (id, full_name, full_name_he, gender, club, country, ifsc_id, created_at optional); keep admin reads via
  `admin_accounts()`; check `AdminPeople` (reads `user_id` through the table as an admin — needs a column grant
  for authenticated plus RLS, or an admin RPC). RLS test: anon cannot select user_id. Small.

### B2. Home page: a multi-day competition disappears on its second day
- `home_page` "upcoming" takes `starts_on >= today`; "latest" takes `status = 'finished'`; "live" needs a
  live round. On day 2 of a 2-day event, between rounds (nothing live, not yet finished), the event is in
  none of the three lists. Plan: upcoming = `ends_on >= today` (ordered by starts_on), label it "today" when
  `starts_on <= today`. Small; home.test.ts + e2e.

### B3. Mixed-gender categories are silently left out of the rankings
- `computeRanking` keeps rows with `r.gender === gender` (male/female); a category with gender `mixed` in a
  ranked series never scores. Today only 2021-22 youth championship categories are mixed (unranked season),
  so no live effect — but a future league category entered as "mixed" by mistake (the roster import defaults
  to `mixed` when a row has no gender) would drop silently. Plan: admin competition page warns when a ranked
  competition has a mixed category; roster import preview shows the gender it will set; optionally the
  rankings admin page lists "categories not counted". Small.

### B4. Viewer service worker: stale shell, unbounded cache
- apps/viewer/public/sw.js caches `/` once at install under a fixed cache name (`ilca-viewer-shell-v2`) and
  caches every `/assets/*` forever. After deploys, an offline open serves an old `index.html` that points at
  asset names that may no longer be cached (blank page offline), and the cache grows with every build.
- Plan: copy the staff worker's approach (cache named by build, shell re-cached when it changes, prune old
  assets), or drop the shell cache in the viewer (it is online-only anyway) and keep only `notificationclick`.
  Small.

### B5. Dates shown off by one in some time zones
- `AdminHome`, `Live` and `Search` format `new Date(c.starts_on)` (UTC midnight) with `toLocaleDateString`;
  `Home` uses `T12:00:00`. In Israel this is fine; a phone set to a western time zone shows the previous day.
  Plan: one `formatDate(iso, lang)` helper (noon-anchored or Intl with timeZone UTC) used everywhere. Trivial.

### B6. Round "reopen" sets `planned`
- AdminRound offers "reopen" → `status = 'planned'` for a closed round. A planned round is not public
  (`round_is_public`), so reopening a round with results hides it from the viewer and from the rankings
  (`season_ranking_rounds` takes `status <> 'planned'`) until it is set live or closed again. Plan: reopen →
  `live` (that is what "reopen" means on an event day), or a confirmation that explains it. Trivial.

### B7. `delete_account_profile` and `link_account` miss the newer tables
- `link_account()` (migration 002) checks a hand-written list (registrations, boulder_results,
  coach_athletes, coach_notes, judge_assignments) before deleting the account's auto-created profile;
  lead_results, international_results, ranking_adjustments, world_rankings, appeals, client_errors are not
  on it, so a profile with such rows could be deleted on link. `delete_account_profile` (024) uses the FK
  inventory and is fine. Plan: make `link_account` use the same FK inventory (or `private.profile_refs()`
  from 040). RLS test. Small.

### B8. Appeals open-state check is per Israel day only in the checklist
- Minor: `event_checklist` "old appeals" uses created date < today; an appeal opened at 00:30 on day 2 is
  "old" at once. Fine as a reminder; no change needed unless it annoys.

---

## C. Security and operations hardening

### C1. Backups — verify, then automate
- docs/operations.md says "check what the plan backs up". If the project is on the Free plan there are **no
  backups**; the only copies are the migrations (schema) and the LogLig archive (history up to 2025-26).
  Results scored on the apps from 28.10 on would exist nowhere else.
- Plan: (1) the user checks Settings → Database → Backups; (2) if none: a weekly (and the morning after each
  event) `supabase db dump --linked --data-only` to an encrypted location outside git, documented with a
  restore drill; or move to Pro (daily backups, PITR optional). Personal data: dumps are deleted after the
  retention agreed with ILCA.

### C2. Auth hardening (dashboard, user's work)
- Advisors: "leaked password protection" is off → enable (Authentication → Settings).
- Admin accounts: enable MFA for admins (Supabase supports TOTP; the staff app would need a small
  enrol/verify screen — ~half a day) or at least a long password policy.
- Password reset and invites by email depend on SMTP (F1).

### C3. HTTP security headers on both sites
- `apps/*/public/_headers` set only `noindex` and asset caching. Plan: add `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation
  off), `X-Frame-Options: DENY` (or `frame-ancestors`), and a `Content-Security-Policy` allowing self, the
  Supabase URL (https + wss), Google Fonts (fonts.googleapis.com / fonts.gstatic.com), `data:` for the icon.
  Test in e2e that the pages still load (CSP breaks inline scripts; the apps have none). Small.

### C4. Monitoring: nobody is told when a background job fails
- The four cron jobs and the two secret-driven edge functions log to `cron.job_run_details` / `ifsc_sync_runs`
  only. A failing `rankings-cache` leaves the rankings a minute old forever; a failing `climber-cache` makes
  climber pages build live (slow) — silently.
- Plan: a "system" box on the admin home: last success time of each job, rankings cache age per season,
  climber-cache backlog (`climber_cache_changes` count), last IFSC run; red when older than 10 minutes. One
  admin RPC reading `cron.job_run_details` (security definer, admin-only) plus the existing tables. Optional:
  a daily email (pg_cron + SMTP via edge function) when something is red. ~half a day.

### C5. Rate limits on public RPCs
- Anon can call `season_rankings`, `climber_page`, `favorites_live`, `home_page`, `round_page` without
  limit. Caches make the common paths cheap; `favorites_live` is capped at 200 climbers; `season_rankings`
  for an unknown season falls back to a live build (cheap when empty). Low risk; Cloudflare's free WAF rate
  rules could cap `/rest/v1/rpc/*` per IP if abuse ever shows. No change now; note it in operations.

### C6. CI
- There is no `.github/workflows`: the five checks run only on the developer's machine; Cloudflare builds run
  `tsc` only. Plan: one GitHub Actions workflow on push/PR: typecheck, unit tests, build, `test:db` (Postgres
  16 service), and e2e (Docker PostgREST + Playwright Chromium) — the e2e needs Docker on the runner; GitHub's
  ubuntu runners have it. ~2 hours; keeps the "no deploys on event days" rule honest by catching a red build
  before Cloudflare publishes it.

### C7. Admin audit beyond scores
- Score changes are logged (score_events, lead_events); publishing a competition, changing quotas, assigning
  judges, resolving appeals, merging profiles (logged), changing roles are not. Plan: a small `admin_log`
  table written by triggers on competitions / rounds / judge_assignments / user_roles / appeals, shown on the
  round page's "change log" and the competition page. ~half a day. Nice to have.

---

## D. Missing features (by priority)

### D1. Qualification groups admin screen (needed for the boulder league 10–12.11 if it runs in groups)
- `round_starters.group_label` is set only in the database. Plan: on the admin round page, "split into N
  groups" (by start order, snake or alternating; or by a roster column) with a per-climber group selector and
  the group count shown; `generate_start_list` already handles groups. Checklist item: a grouped round has
  every starter in a group. ~1 day. Spec question: how ILCA assigns groups (by ranking seed, random, by club).

### D2. Speed discipline
- Types mention `speed`, the UI says "coming soon". Needs: a `speed` scoring format (two lanes, best time,
  false starts), speed results table, a speed judge pad (time entry, maybe a timer), knockout brackets for
  finals, rankings rules (criteria list speed?). Largest item (~1–2 weeks). Only if ILCA runs speed events on
  the apps this season.

### D3. Real push notifications (closed app)
- Today alerts work only while the viewer is open. Real push needs a server-side subscription store, which
  breaks the "viewer never writes" rule. Options: (a) a tiny write-only `push_subscriptions` table + a
  `subscribe` RPC that stores an endpoint and the climber ids (no identity), an edge function that sends Web
  Push (VAPID) on result events — accept the single write path and document it; (b) leave as is. Decision
  for the user. (a) ~2–3 days incl. iOS home-screen testing.

### D4. Climber accounts and self-service (deferred by decision)
- Climbers have no sign-in; "shared with climber" coach notes have no reader. Keep deferred unless ILCA asks.

### D5. Coach view improvements
- The coach page shows history and private notes only. Candidates: a "my athletes today" list on event days
  (their rounds, start order, live results), export notes. Low priority.

### D6. Public launch
- `noindex` on both sites and `Disallow: /` in robots.txt; a public launch means removing those on the
  viewer, adding Open Graph tags (title/description per competition and climber pages for WhatsApp previews),
  a sitemap for competitions, and a short privacy note (names of minors are public, like IFSC — decided).
  ~half a day when ILCA decides.

### D7. Big-screen mode polish (after seeing it on a real TV)
- Untested on a real screen; rotation across several live rounds was unit-tested only. Plan: try on the
  venue TV during the dry run; add a "pin one category" mode and a results-only mode without the on-wall
  banner if judges rarely mark it.

### D8. World Championships senior points (ILCA 2025 edition)
- Still 0 (no table in the document); the user is asking ILCA. When the value arrives: `seniorIntlPoints`,
  tests, `RANKING_CODE_VERSION` bump, redeploy rankings-build, POST `{"all": true}`.

---

## E. Code and test quality

- **Scoring in two places** (TS + SQL) is documented and tested on both sides; keep it. The lead time rule is
  the one place the TS and SQL agree but the UI never exercises (A1).
- **Judge.tsx (548 lines)** holds the home, claims, both pads and notices; splitting into `judge/` (JudgeHome,
  ScorePad, LeadPad, OutboxNotices, useClaim) would help the lead work in A1. Mechanical, ~1 hour.
- **i18n**: 452 keys, type-checked (`MsgKey`); a few Supabase error messages reach users in English
  (`error.message` in Login, AdminRound, RosterImport). Map the common codes (23505 duplicate, 42501
  permission, network) to he/en strings. Small.
- **Accessibility**: pads and results have aria labels; the admin forms rely on placeholder text in places
  (`placeholder="2025-26"`); dark mode exists for the viewer. Low priority.
- **Bundles**: viewer 478 KB of assets (272 KB main chunk + 161 KB supabase viewer client), staff 702 KB. Fine
  for a PWA; the viewer could lazy-load Rankings (currently in the main chunk by design for cold loads).
- **Advisors**: 150 "multiple permissive policies" warnings (read + admin policies on each table). Performance
  only; folding `has_role('admin')` into the read policies would halve the policy checks per row on the busy
  tables (boulder_results, round_starters). Optional, measure first.
- **Tests**: 278 unit, ~2,100 lines of RLS/scoring SQL tests, one long e2e flow. Gaps: lead judge flow (A2),
  calendar/big-screen/notifications are unit-tested only, merge page only opened (no merge performed in
  e2e). Add an e2e merge of two seeded duplicates.
- **Docs**: CLAUDE.md status and README still say the open work includes "admin screen for qualification
  groups, merging duplicate climber profiles, speed, calendar, notifications" — merging, calendar and
  notifications are live now. Update after this plan is agreed.

---

## F. Questions for the user

1. **SMTP**: is email delivery set up in Supabase (invites, forgot-password)? If not, judges are invited by
   share link only and "forgot password" does nothing — say so on the login page.
2. **Backups**: which Supabase plan is the project on (Free: no backups)? See C1.
3. **Lead finals**: does ILCA time the finals and break ties by time (IFSC rule), or does it leave ties
   shared? A1 assumes yes.
4. **Groups**: will the 10–12.11 boulder league run qualification in groups? Decides D1's date.
5. **Push notifications** while the app is closed: accept one write path in the viewer (D3a) or keep in-app
   only (D3b)?
6. **Dry run date**: before 25.10, with the lead pad.
7. **Speed**: any speed event on the apps this season?

---

## Suggested order

| When | Items | Size |
|---|---|---|
| This week (before 25.10, then no deploys until the event is over) | A1, A2, A3(a), A4, B2, B6 | ~2.5 days |
| Right after the event | D1 (if groups), C1 backups, C6 CI, B1, B7, B4, B5, C3, C4 | ~3 days |
| November | C2 MFA, C7 audit, D7, docs refresh (E), D8 when ILCA answers | ~2 days |
| When decided | D3 push, D6 launch, D2 speed | — |
