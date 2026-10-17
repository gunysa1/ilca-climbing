# IFSC Auto Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily job inside Supabase adds new IFSC results and world-ranking positions for Israeli athletes, links confident athlete matches itself and leaves unclear ones for an admin.

**Architecture:** Pure rules in `supabase/functions/_shared/ifsc.ts` (tested with Vitest); the sync logic in `supabase/functions/ifsc-sync/sync.ts` works against two injected interfaces (IFSC fetcher, data store) so it is tested with fakes; `index.ts` wires the real fetch and a Supabase service-role store. New tables hold pending athletes and the run log; the staff admin page shows both; public pages link international events to IFSC.

**Tech Stack:** Deno edge function (Supabase), TypeScript, Vitest, Postgres/RLS, React (staff + viewer apps), pg_cron + pg_net + Vault (rollout only).

**Spec:** `docs/superpowers/specs/2026-10-17-ifsc-auto-sync-design.md`

## Global Constraints

- IFSC requests: `https://ifsc.results.info/api/v1/...` with headers `referer: https://ifsc.results.info/` and `accept: application/json`; stop the run at the first IFSC error (non-JSON, non-2xx, or a category/ranking response without an array) and change nothing. *(Relaxed in Task 8: a single failing category or athlete is skipped with a warning; a failing world list skips the world part.)*
- Leagues: `World Cups and World Championships`, `IFSC Youth`, `IFSC Europe Adults`, `IFSC Europe Youth`; events whose `local_start_date` is within the last 60 days; categories whose first word is BOULDER or LEAD and status `finished`; athletes with `country === 'ISR'`.
- Same rules as `tools/ifsc/scrape.py` and `tools/ifsc/match.py`: event type from the name (incl. "World Climbing" names; senior World Championships → `world_championship`), season = calendar year (`2026-…` → `2026-27`), field size = athletes with a rank, reached = last round with a score/rank.
- Confident match: exactly one candidate with the athlete's birth date and gender (or no gender on the profile), score ≥ 0.5, and no second candidate within 0.15. Score = consonant-skeleton similarity of `match.py`.
- Never delete or update `international_results` rows (except setting `ifsc_event_id`/`ifsc_dcat_id` where null); never insert into a (season, class, discipline) group that has `event_type = 'manual'` rows; skip rows without a place.
- World ranking: dcats 3 boulder men, 7 boulder women, 1 lead men, 5 lead women; current season (Sept–Aug). Before 1 January of the season's end year: replace that season's rows with today's list (`as_of` = today). On/after: if no row with `as_of = <end year>-01-01` exists, replace with `?date=<end year>-01-01`; otherwise leave them.
- Auth: header `x-sync-secret` equal to env `IFSC_SYNC_SECRET`, or an admin JWT (existing `requireAdmin`). Anything else → 401.
- New tables are admin-only (RLS + `supabase/tests/rls_test.sql` assertions); the viewer never writes.
- No secret in git. pg_cron/pg_net/Vault SQL lives in `supabase/cron/ifsc_sync.sql` (applied at rollout, not a migration — local test Postgres has no pg_cron).
- Checks before done: `npm run typecheck && npm test && npm run build && npm run test:db`, plus `npm run test:e2e` for UI tasks. No live writes before Task 7.

## Review Focus

- IFSC returns an error body or empty ranking for one category mid-run → the run is logged `failed` and nothing is written → test in Task 3.
- The same run executed twice → the second adds nothing (idempotent) → test in Task 3.
- An athlete already pending is seen again in a later run → no duplicate pending row; new results merged into its `results` → test in Task 3.
- Twins (same birth date, different first names) → the right one is linked, or both pending if scores are close → test in Task 1 (Alma/Maya Sapir Halevi case: `ALMA SAPIR HALEVI` vs 'עלמה ספיר הלוי' and 'מיה ספיר הלוי').
- A run after 1 January when the official list is already stored → world rankings untouched → test in Task 3.

---

### Task 1: Pure IFSC rules

**Files:**
- Create: `supabase/functions/_shared/ifsc.ts`
- Test: `supabase/functions/_shared/ifsc.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type IntlEventType = 'world_cup' | 'world_championship' | 'european_cup' | 'european_championship'
    | 'european_youth_cup' | 'european_youth_championship' | 'world_youth_championship';
  export function eventType(name: string): IntlEventType | null;
  export function ilcaSeason(date: string): string;                 // '2026-05-01' → '2026-27'
  export function currentSeason(today: string): string;             // Sept–Aug: '2026-10-17' → '2026-27', '2027-03-01' → '2026-27'
  export function reachedOf(rounds: { round_name: string; score?: string | null; rank?: number | null }[]): 'qualification' | 'semifinal' | 'final';
  export function skeleton(name: string): string;                   // port of match.py skel()
  export function nameScore(first: string, last: string, he: string | null, full: string | null): number;  // 0..1, 2 decimals
  export interface Candidate { id: string; full_name: string | null; full_name_he: string | null; gender: string | null; birth_date: string | null }
  export function pickMatch(a: { firstname: string; lastname: string; gender: string | null; birthday: string | null }, profiles: Candidate[]):
    { status: 'match'; profileId: string; score: number } | { status: 'pending'; suggestion: string | null; score: number | null };
  ```
  No Deno APIs in this file (Vitest imports it).

- [ ] **Step 1: Write the failing tests** — `eventType`: 'IFSC Climbing World Cup Innsbruck 2025' → world_cup; 'World Climbing Series Bern 2026' → world_cup; 'IFSC Climbing World Championships Seoul 2025' → world_championship; 'World Climbing Europe Championship Laval 2026' → european_championship; 'World Climbing Europe Series Kaunas 2026' → european_cup; 'IFSC Europe - Youth Championship - Helsinki (FIN) 2023' → european_youth_championship; 'World Climbing Europe Youth Series Graz 2026' → european_youth_cup; 'World Climbing Youth Championship Arco 2026' → world_youth_championship; 'IFSC Asian Cup' → null. `ilcaSeason('2026-12-31')` → '2026-27'. `currentSeason` cases above. `reachedOf`: rounds [Qualification(score), Semi-final(score)] → semifinal; [.., Final(rank 3)] → final; [] → qualification. `pickMatch`: one candidate same birthday 'יונתן כץ' for KATZ Yonatan → match; twins birthday shared, 'עלמה ספיר הלוי' and 'מיה ספיר הלוי', athlete Alma SAPIR HALEVI → match to Alma; no birthday hit → pending with suggestion null; gender mismatch excluded.
- [ ] **Step 2: Run** `npx vitest run supabase/functions/_shared/ifsc.test.ts` — FAIL (module not found).
- [ ] **Step 3: Implement** by porting `tools/ifsc/scrape.py` (`event_type`, `ilca_season`, reached logic) and `tools/ifsc/match.py` (`HE` map, `skel`, `name_score`, the confident rule from Global Constraints).
- [ ] **Step 4: Run** the test — PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — "ifsc-sync: pure IFSC rules (event types, seasons, athlete matching)".

### Task 2: Tables for the sync

**Files:**
- Create: `supabase/migrations/20261017000031_ifsc_sync.sql`
- Modify: `supabase/tests/rls_test.sql`

**Interfaces:**
- Produces:
  - `international_results` + `ifsc_event_id int null`, `ifsc_dcat_id int null` (public read like the table).
  - `public.ifsc_pending (ifsc_athlete_id int primary key, firstname text not null, lastname text not null, gender text, birthday date, suggested_profile uuid references profiles(id) on delete set null, score numeric(4,2), status text not null default 'pending' check (status in ('pending','ignored')), results jsonb not null default '[]', first_seen timestamptz not null default now(), last_seen timestamptz not null default now())` — `results` holds result rows in the `international_results` insert shape minus `climber_id`.
  - `public.ifsc_sync_runs (id bigint generated always as identity primary key, started_at timestamptz not null default now(), finished_at timestamptz, status text not null check (status in ('running','ok','failed')), added int not null default 0, linked int not null default 0, pending int not null default 0, world int not null default 0, error text)`.
  - RLS on both: admins `for all` (`has_role('admin')`, same expression as `international_results`' admin policy); no anon/non-admin access; grants: revoke from anon; select/insert/update/delete to authenticated (RLS decides).
  - Admins may set `profiles.ifsc_id` (already granted to authenticated; check the profiles update policy allows admins — add an assertion).

- [ ] **Step 1: RLS assertions** — anon cannot select either table; a non-admin user cannot select/insert; admin inserts a pending row and a run row and reads them back; admin updates `profiles.ifsc_id`; anon still reads `international_results.ifsc_event_id`.
- [ ] **Step 2:** `npm run test:db` — FAIL (relation does not exist).
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `npm run test:db` — `ALL RLS TESTS PASSED`.
- [ ] **Step 5: Commit** — "ifsc-sync: pending athletes and run log tables".

### Task 3: Sync logic

**Files:**
- Create: `supabase/functions/ifsc-sync/sync.ts`
- Test: `supabase/functions/ifsc-sync/sync.test.ts`

**Interfaces:**
- Consumes: Task 1 functions.
- Produces:
  ```ts
  export interface Ifsc { get(path: string): Promise<unknown> }   // throws on non-JSON / non-2xx
  export interface ResultRow { season: string; discipline: 'boulder' | 'lead'; event_type: string; event_name: string;
    starts_on: string; place: number; field_size: number; reached: string; ifsc_event_id: number; ifsc_dcat_id: number }
  export interface Store {
    linkedProfiles(): Promise<Map<number, string>>;                 // ifsc_id → profile id
    candidates(birthday: string): Promise<Candidate[]>;             // profiles + profile_private.birth_date
    manualGroups(): Promise<Set<string>>;                           // `${season}|${class}|${discipline}`
    existing(climberId: string): Promise<Set<string>>;              // `${discipline}|${event_name}|${starts_on}`
    insertResults(climberId: string, rows: ResultRow[]): Promise<number>;   // also fills ifsc ids on matching existing rows
    linkProfile(profileId: string, ifscId: number): Promise<void>;
    upsertPending(p: { ifsc_athlete_id: number; firstname: string; lastname: string; gender: string | null; birthday: string | null;
      suggested_profile: string | null; score: number | null; results: ResultRow[] }): Promise<void>;   // merges results, keeps status
    worldRows(season: string): Promise<{ as_of: string }[]>;
    replaceWorld(season: string, rows: { climber_id: string; discipline: 'boulder' | 'lead'; position: number }[], asOf: string): Promise<void>;
  }
  export interface RunSummary { added: number; linked: number; pending: number; world: number }
  export async function runSync(ifsc: Ifsc, store: Store, today: string, opts?: { onlyAthlete?: number }): Promise<RunSummary>;
  ```
  Event-name format stored: `${event} (${dcat name})` (same as `tools/ifsc/to_sql.py`). Class of a row: youth for `european_youth_*`/`world_youth_championship`, else senior. Throws on IFSC errors before any store write (collect everything first, then write).

- [ ] **Step 1: Failing tests** with an in-memory `Store` and a fake `Ifsc` built from small JSON fixtures (one season, one league, one event with a BOULDER Men category containing two ISR athletes: one linked, one new with a confident candidate, and one with no candidate): first run → added 2 (linked athlete + newly linked), linked 1, pending 1; second run → added 0; a manual group for that season/class/discipline → those rows skipped; fake IFSC returning `{error: …}` for the category → rejects and the store received no writes; pending athlete seen again → one pending row, results merged; world ranking: today 2026-10-17 → `replaceWorld('2026-27', …, '2026-10-17')`; today 2027-01-05 with no 2027-01-01 rows → fetch `?date=2027-01-01` and replace; with 2027-01-01 rows present → no world fetch, world 0; `onlyAthlete` → only that athlete's waiting results imported.
- [ ] **Step 2:** `npx vitest run supabase/functions/ifsc-sync/sync.test.ts` — FAIL.
- [ ] **Step 3:** Implement `runSync`.
- [ ] **Step 4:** Test — PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — "ifsc-sync: sync logic against IFSC and a store".

### Task 4: Edge function

**Files:**
- Create: `supabase/functions/ifsc-sync/index.ts`, `supabase/functions/ifsc-sync/store.ts`, `supabase/cron/ifsc_sync.sql`
- Modify: `docs/operations.md` (IFSC section: deploy, secret, schedule, manual run)

**Interfaces:**
- Consumes: `runSync`, `Store` (Task 3); `cors`, `json`, `serviceClient`, `requireAdmin` from `supabase/functions/_shared/admin.ts`; tables of Task 2.
- Produces: `POST /functions/v1/ifsc-sync` body `{ athlete?: number }` → `{ status: 'ok', ...RunSummary }` or `{ status: 'failed', error }` (500). Every call inserts an `ifsc_sync_runs` row (`running` → `ok`/`failed` with counts or error). `supabaseStore(client): Store` in store.ts (service role; `candidates` joins `profiles` with `profile_private`; `insertResults` uses the not-exists rule and fills ifsc ids where null).
- `supabase/cron/ifsc_sync.sql`: `create extension if not exists pg_cron; create extension if not exists pg_net;` and `select cron.schedule('ifsc-sync', '0 3 * * *', $$ select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/ifsc-sync', headers := jsonb_build_object('content-type','application/json','x-sync-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'ifsc_sync_secret')), body := '{}'::jsonb) $$);` with a comment on creating the two Vault secrets.

- [ ] **Step 1:** Implement index.ts (auth per Global Constraints; `athlete` must be a positive integer if present) and store.ts.
- [ ] **Step 2:** `npm run typecheck && npm test` — PASS (index/store are Deno files outside Vitest; keep their logic thin).
- [ ] **Step 3:** Docs in operations.md.
- [ ] **Step 4: Commit** — "ifsc-sync: edge function, store and schedule SQL".

### Task 5: Admin screen

**Files:**
- Modify: `src/pages/admin/AdminRankings.tsx` (new `IfscSync` section), `src/lib/i18n.tsx`, `e2e/admin-flow.mjs`

**Interfaces:**
- Consumes: tables of Task 2; function of Task 4 via `supabase.functions.invoke('ifsc-sync', { body: { athlete } })`; existing `ClimberPicker`.
- Produces: i18n keys `ifscSync` ('IFSC – עדכון אוטומטי' / 'IFSC – automatic updates'), `ifscRunNow` ('הרצה עכשיו' / 'Run now'), `ifscLastRuns` ('הרצות אחרונות' / 'Last runs'), `ifscPending` ('ספורטאי IFSC לאישור' / 'IFSC athletes to confirm'), `ifscConfirm` ('אישור' / 'Confirm'), `ifscPickOther` ('בחירת מטפס/ת אחר/ת' / 'Pick another climber'), `ifscIgnore` ('לא מהנבחרת' / 'Not on the team').

- [ ] **Step 1:** The section lists the last 5 runs (time, status, added/linked/pending/world, error), a run-now button, and pending athletes (status `pending`): name, birthday, suggestion with confirm, pick another (ClimberPicker) or ignore. Confirm/pick: update `profiles.ifsc_id`, then invoke the function with `{ athlete }` and refresh; ignore: set status `ignored`.
- [ ] **Step 2:** e2e: seed one pending row and one run row (local DB), the admin sees both, ignore hides the pending row. Run-now is not exercised in e2e (no function runtime locally) — assert the button exists.
- [ ] **Step 3:** `npm run typecheck && npm test && npm run build && npm run test:e2e` — PASS.
- [ ] **Step 4: Commit** — "Admin: IFSC sync runs and athletes to confirm".

### Task 6: Links to IFSC

**Files:**
- Modify: `src/lib/rankings.ts` (`IntlResult` + `ifsc_event_id?: number | null`; `EventScore` + `href?: string`), `src/pages/Rankings.tsx`, `src/components/History.tsx` only if international events appear there (check), `supabase/migrations/20261017000031_ifsc_sync.sql` is NOT changed — the RPCs return `international_results` rows with `select *`/`to_jsonb`, so the new columns flow through (verify in `season_rankings`).

**Interfaces:**
- Produces: international `EventScore.href = 'https://ifsc.results.info/event/' + ifsc_event_id` when set; rendered as an external link (`target="_blank" rel="noopener"`) with the same chip style.

- [ ] **Step 1: Test** in `src/lib/rankings.test.ts`: an intl row with `ifsc_event_id: 1366` yields an event with `href` 'https://ifsc.results.info/event/1366'; without it, no `href`.
- [ ] **Step 2:** Run — FAIL; implement; run — PASS.
- [ ] **Step 3:** `npm run typecheck && npm test && npm run build && npm run test:e2e` — PASS.
- [ ] **Step 4: Commit** — "Rankings: international events link to IFSC".

### Task 7: Rollout (only after the user confirms)

- [ ] **Step 1:** `db push --linked --dry-run` → only `20261017000031_ifsc_sync.sql`; apply.
- [ ] **Step 2:** Generate the secret locally (`openssl rand -hex 32`), `npx -y supabase@2.121.0 secrets set IFSC_SYNC_SECRET=… --project-ref tsahkbtxjlgmebfmwkbq`, deploy `npx -y supabase@2.121.0 functions deploy ifsc-sync --use-api`.
- [ ] **Step 3:** One manual run (POST with the secret); show the user the run row (added/linked/pending) — expected: 0 or few new results (the history is already imported), ifsc ids filled on existing rows.
- [ ] **Step 4:** Create the Vault secrets `project_url` and `ifsc_sync_secret`, apply `supabase/cron/ifsc_sync.sql`, confirm `cron.job` lists `ifsc-sync`.
- [ ] **Step 5:** Push main; update CLAUDE.md status (automatic IFSC sync daily 03:00 UTC).

### Task 8: Follow-ups (after rollout; from the final review's "declined to judge" list, added by the user 2026-10-17)

Each item is small and independent; batch the UI ones into one dispatch.

- [x] **Un-ignore:** the admin IFSC box lists ignored athletes (collapsed) with **restore** (status back to `pending`).
- [x] **IFSC link in People admin:** show a profile's `ifsc_id` (link to `https://ifsc.results.info/athlete/{id}`) with **unlink** (admin; sets null) and edit.
- [x] **IFSC corrections:** for rows with `ifsc_event_id`/`ifsc_dcat_id` inside the 60-day window, update `place`, `field_size`, `reached` when IFSC changed them (never `manual` rows); count them in the run log (`updated`).
- [x] **Pending list detail:** show gender and the event names of the waiting results.
- [x] **Category link:** link to the category's results page instead of the event page, once the IFSC URL format for a category is verified (uses `ifsc_dcat_id`). *Checked 2026-10-17 in the IFSC site's router: no stable per-category URL (`/event/{id}/general/{discipline}` shows the category last viewed in that browser; `/event/{id}/cr/{category_round_id}` is one round and needs an id we don't store). The event link stays.*
- [x] **Local date:** `today` = the date in Asia/Jerusalem, not UTC.
- [x] **Revised 1 January list:** during January, re-fetch `?date=<end year>-01-01` daily and replace when it differs from the stored rows; after January leave it alone.
- [x] **World ranking for a newly confirmed athlete:** the `{ athlete }` run also writes that athlete's world-ranking rows from the current list.
- [x] **Hard lock:** partial unique index on `ifsc_sync_runs (status) where status = 'running'`, so two runs can never start together (replace the soft check).
- [x] **Account deletion:** a profile referenced only by `ifsc_pending.suggested_profile` is deleted with its account (user decision 2026-10-17; migration 032).
- [ ] **Merging duplicate profiles (future work, not part of this task):** the merge must move `ifsc_id` to the kept profile (unique index), plus `ifsc_dismissed` and `suggested_profile` references.
- [x] **Birthdays in `ifsc_pending`:** clear `birthday` when an athlete is ignored (it was only needed for matching).
- [x] **Robustness (added 2026-10-17):** a failing category or athlete is skipped with a warning in `ifsc_sync_runs.warnings`; every category/athlete request failing (≥ 2) or a failing season/league/event list still fails the run with no writes; a failing world list skips the world part only.
- [x] **Confirm safety (added 2026-10-17, after a wrong 0.15-score confirm):** Confirm only for score ≥ 0.5, otherwise "pick another climber" is the main action; every link asks a second time naming both people.

Done in migration 037 (`20261017000037_ifsc_sync_followups.sql`) plus the function and admin pages.
