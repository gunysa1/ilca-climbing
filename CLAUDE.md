# ILCA Climbing — project notes for Claude

Competition app for the Israeli climbing team (ILCA): live boulder results, judge scoring pad,
coach views, per-climber history. React + Vite PWA, Supabase backend, Hebrew RTL default + English.
See README.md for the role/isolation table and scripts.

## Ground rules
- Role isolation lives in Postgres RLS (`supabase/migrations/`). UI gating (`RequireRole`) is cosmetic.
  Any change to tables/policies must keep `npm run test:db` green and add assertions to
  `supabase/tests/rls_test.sql` for new access paths.
- Scoring logic exists twice: `src/lib/scoring.ts` and SQL `boulder_points` / `round_scores`. Change both
  together; tests on both sides use the same case (top on 3rd attempt = 24.8).
- Clients must select `RESULT_COLUMNS` from `boulder_results` (never `*`): `updated_by` is not granted.
- Dependencies are pinned exact; `.npmrc` sets legacy-peer-deps (npm 10 crashes on vitest 5 peers).
- Before claiming done: `npm run typecheck && npm test && npm run build && npm run test:db`.

## Status (handoff from cloud session, 2026-10-14)
Done: schema + RLS (28 tests), scoring (7 tests), app pages (live results, competition, round results
with Realtime, login, judge home + scoring pad, coach, my history), PWA shell.

Open work, in order:
1. **Reference analysis with REA** (couldn't be done in the cloud sandbox — hosts were blocked).
   Install/connect REA locally: `npx -y rea-agents@6.5.0 setup --client claude_code --dry-run`, review,
   then `--yes`; restart Claude Code. Then:
   - ifsc.results.info → capture style tokens + results table layout; replace placeholder tokens in
     `src/styles.css`.
   - ilca-boulder-score.netlify.app/live.html (current temporary app) → confirm scoring model and data
     backend; check for data to migrate. Verify IFSC 2025 scoring assumption.
   - Android apps org.ifsc.boulder14 (IFSC) and com.loglig.climbing (current LogLig app): get APKs
     (preferably `adb pull` from a phone; user also OK'd APKMirror), then REA `inspect_android_package`
     (needs Java + jadx-headless-mcp 0.7.1 JAR via `REA_JADX_MCP_JAR`). Feature inventory for parity.
   Log findings in `docs/reference-analysis.md`.
2. Admin UI (competitions/categories/rounds/boulders, registrations, judge + coach assignments, roles).
   Today this is done with `supabase/admin.sql`.
3. Real Supabase project: apply migrations, set `.env.local`, end-to-end test of all roles.
4. Netlify deploy (netlify.toml present).
5. Open questions for the user: should climber results be private (currently public like IFSC)?
   Import history from LogLig?
