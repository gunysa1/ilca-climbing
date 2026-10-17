# Ranking Criteria Editions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank each season by the ILCA criteria document that governs it, adding the 2027 criteria for 2026-27.

**Architecture:** A `Criteria` object per ILCA document (`src/lib/criteria.ts`) holds what differs between editions; `computeRanking` takes the season's criteria and, for `ilca2027`, each climber's world-ranking position. Positions live in a new `world_rankings` table filled from IFSC by `tools/ifsc/world_ranking.py`.

**Tech Stack:** TypeScript, React, Vitest; Postgres/Supabase migrations with `supabase/tests/rls_test.sql`; Python 3 + curl for tools.

**Spec:** `docs/superpowers/specs/2026-10-17-ranking-criteria-editions-design.md`

## Global Constraints

- Ranking logic stays only in `src/lib/rankings.ts` (+ the new `src/lib/criteria.ts`); no ranking maths in SQL.
- Season → edition: `2023-24`, `2024-25`, `2025-26` → `ilca2025` (2025-26 `assumed: true`); `2026-27` → `ilca2027`; seasons after the last mapped one use the latest edition with `assumed: true`.
- `ilca2027` world-ranking points: positions 1-10 → 400, 11-20 → 300, 21-30 → 200, 31-40 → 100, else 0.
- `ilca2027` youth bonus: `world_youth_championship` final 60 / podium 100; `european_youth_championship` final 40 / podium 60; every other type 0; no field-size condition; podium = `reached === 'final'` and place ≤ 3.
- `ilca2027` U17 league: only `premier_league_u17` events.
- Existing validated results must not change: every current test in `src/lib/rankings.test.ts` passes unchanged in its expectations under `ilca2025`.
- Each new access path gets assertions in `supabase/tests/rls_test.sql`; dependencies pinned exact (none needed).
- Before done: `npm run typecheck && npm test && npm run build && npm run test:db`, plus `npm run test:e2e` for the page task.
- Live writes (db push, loading positions or results) only after the user says so.

## Review Focus

- A senior with **no** league events but a top-40 world ranking: the ranking points must still count (fill an empty slot) → test in Task 2.
- A senior with exactly **one** league event: world-ranking points add as the second event, not replace the only one → test in Task 2.
- World ranking for a climber below the senior minimum age: must not put them in the senior table → test in Task 2.
- A season with no `world_rankings` rows yet (before the tool runs): 2026-27 ranks from league + championship without errors → test in Task 2.
- Seasons later than 2026-27 (e.g. `2027-28`): resolve to the latest edition marked assumed, not crash → test in Task 1.

---

### Task 1: Criteria editions

**Files:**
- Create: `src/lib/criteria.ts`
- Test: `src/lib/criteria.test.ts`

**Interfaces:**
- Consumes: `IntlResult`, `IntlEventType`, `youthBonusPoints` from `src/lib/rankings.ts` (2025 bonus stays there).
- Produces:
  ```ts
  export type CriteriaId = 'ilca2025' | 'ilca2027';
  export interface Criteria {
    id: CriteriaId;
    title: string;                    // Hebrew document title, e.g. 'אמות מידה לנבחרות 2027'
    url: string | null;               // 2025: https://drive.google.com/file/d/1KyP2ZN2tPtorrS13sRHVOU4TLQvyQQij/view ; 2027: null (not published yet)
    seniorIntl: 'per_event' | 'world_ranking';
    worldRankingPoints(position: number): number;   // ilca2025: always 0
    youthBonus(r: IntlResult): number;              // ilca2025: youthBonusPoints
    u17OpenEvents: boolean;                         // ilca2025 true, ilca2027 false
  }
  export const ILCA_2025: Criteria;
  export const ILCA_2027: Criteria;
  export function criteriaForSeason(season: string): { criteria: Criteria; assumed: boolean };
  ```

- [ ] **Step 1: Write the failing tests** in `src/lib/criteria.test.ts`:
  - `criteriaForSeason('2024-25')` → `{ criteria: ILCA_2025, assumed: false }`; `'2025-26'` → ILCA_2025, `assumed: true`; `'2026-27'` → ILCA_2027, `assumed: false`; `'2027-28'` → ILCA_2027, `assumed: true`.
  - `ILCA_2027.worldRankingPoints`: 1→400, 10→400, 11→300, 20→300, 21→200, 30→200, 31→100, 40→100, 41→0.
  - `ILCA_2025.worldRankingPoints(1)` → 0.
  - `ILCA_2027.youthBonus`: world youth champs final place 2 → 100, final place 5 → 60, semifinal → 0; European youth champs final place 3 → 60, final place 7 → 40; European youth cup final place 1 → 0; field size 10 still scores.
  - `ILCA_2025.youthBonus` equals `youthBonusPoints` for the appendix B case (European youth cup 9/37 final → 20).
- [ ] **Step 2: Run** `npx vitest run src/lib/criteria.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement** `src/lib/criteria.ts` with the interface above; a `SEASONS` record maps the three ILCA 2025 seasons and `2026-27`; unknown seasons → the latest edition by season order, `assumed: true` (seasons before 2023-24 → ILCA_2025, assumed).
- [ ] **Step 4: Run** `npx vitest run src/lib/criteria.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `git add src/lib/criteria.ts src/lib/criteria.test.ts && git commit` — "Rankings: criteria editions (ILCA 2025, ILCA 2027)".

### Task 2: computeRanking by edition

**Files:**
- Modify: `src/lib/rankings.ts` (`RankingInput`, `computeRanking`: league pools, international loop, best-2)
- Test: `src/lib/rankings.test.ts`
- Modify: `docs/scoring-and-rankings.md` (an "Editions" section: the table and the 2027 differences from the spec)

**Interfaces:**
- Consumes: `Criteria`, `ILCA_2025`, `ILCA_2027` from Task 1.
- Produces: `RankingInput` gains `criteria: Criteria` (required) and `worldRank?: Map<string, number>` (position per climber for this discipline and season). A world-ranking score appears in `RankingRow.events` as `{ kind: 'world', label: 'דירוג עולמי ' + position, place: position, points, competition_id: 'world-ranking', starts_on: '', counted }`; `EventScore['kind']` becomes `'league' | 'intl' | 'world'`.

- [ ] **Step 1: Update existing tests** to pass `criteria: ILCA_2025` in every `computeRanking` call (expectations unchanged).
- [ ] **Step 2: Write the failing tests** (`describe('ILCA 2027')`):
  - Senior, league 1st and 2nd (100, 80), championship 3rd (130), world rank 14 → total 130 + 300 + 100 = 530; counted events are the world ranking and the 100.
  - Senior, one league event 1st (100), world rank 35 → 200 (100 + 100, no championship).
  - Senior, no league events, world rank 5 → 400 and listed.
  - Senior, world rank 50 → no world event (0 points), total from league only.
  - Senior in `tooYoung` with world rank 1 → not listed.
  - Senior, `intl` contains a world_cup 3/50 final → contributes 0 under ILCA_2027 (event shown with 0 points, not counted over league).
  - No `worldRank` map at all → same totals as league + championship.
  - U21 youth, World Youth Championships final place 2 → bonus 100; European youth cup final place 1 → bonus 0.
  - U17, open event with category 'גברים+ U17' → no U17 points under ILCA_2027, 100 under ILCA_2025.
- [ ] **Step 3: Run** `npx vitest run src/lib/rankings.test.ts` — expect the new tests FAIL.
- [ ] **Step 4: Implement:** youth bonus via `input.criteria.youthBonus(r)`; U17 open events only when `criteria.u17OpenEvents`; for `seniorIntl === 'per_event'` keep today's international loop; for `'world_ranking'` push the world event from `worldRank` (when points > 0 and the climber passes `inClass`), and international rows push with points 0. Best-2 stays one sort over all events (there is at most one world event, so best-2 = "replace the weaker").
- [ ] **Step 5: Run** `npm test` — expect PASS (all old and new tests).
- [ ] **Step 6: Commit** — "Rankings: compute by criteria edition; ILCA 2027 world ranking and youth championships".

### Task 3: world_rankings table

**Files:**
- Create: `supabase/migrations/20261017000028_world_rankings.sql`
- Modify: `supabase/tests/rls_test.sql`

**Interfaces:**
- Produces: table `public.world_rankings (climber_id uuid not null references profiles(id) on delete cascade, season text not null check (season ~ '^\d{4}-\d{2}$'), discipline text not null check (discipline in ('boulder','lead')), position int not null check (position > 0), as_of date not null, primary key (climber_id, season, discipline))`; RLS: select for everyone, all for admins — the same policy expressions and grants as `international_results` (`20261015000015_rankings.sql:86-96`).

- [ ] **Step 1: Write the failing RLS assertions:** anon reads a row; anon insert denied; a non-admin authenticated user insert denied; admin inserts and updates a row; deleting the profile removes its rows.
- [ ] **Step 2: Run** `npm run test:db` — expect FAIL (relation does not exist).
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** `npm run test:db` — expect `ALL RLS TESTS PASSED`.
- [ ] **Step 5: Commit** — "Rankings: world_rankings table (public read, admin write)".

### Task 4: Rankings page by edition

**Files:**
- Modify: `src/pages/Rankings.tsx` (load `world_rankings` for the season; pass `criteria` and `worldRank`)
- Modify: `src/lib/i18n.tsx` (keys below)
- Modify: `e2e/admin-flow.mjs` (the "rankings: season + series, international result, public table" step) to assert the edition line

**Interfaces:**
- Consumes: `criteriaForSeason` (Task 1), `RankingInput.criteria/worldRank` (Task 2), `world_rankings` (Task 3).
- Produces: i18n keys `criteriaLine` ({he: 'לפי', en: 'Per'}), `criteriaAssumed` ({he: 'הנחה: מסמך העונה לא זמין, לפי המסמך הקודם', en: 'Assumed: this season's document is not available; using the previous one'}), `worldRankProvisional` ({he: 'דירוג עולמי זמני (נקבע ב-1 בינואר)', en: 'Provisional world ranking (set on 1 January)'}).

- [ ] **Step 1: Implement:** select `climber_id, discipline, position, as_of` from `world_rankings` for the season; build `worldRank` per discipline; under the season chips show `criteriaLine` + title (link when `url`), `criteriaAssumed` when assumed, `worldRankProvisional` when the edition is `world_ranking` and any `as_of` is before 1 January of the season's end year (or no rows exist).
- [ ] **Step 2: Extend the e2e rankings step:** the public table page shows the edition line for the seeded season.
- [ ] **Step 3: Run** `npm run typecheck && npm test && npm run build && npm run test:e2e` — expect all PASS.
- [ ] **Step 4: Commit** — "Rankings page: criteria edition, assumed and provisional notes".

### Task 5: IFSC tools for 2026-27

**Files:**
- Create: `tools/ifsc/world_ranking.py`
- Modify: `tools/ifsc/to_sql.py` (drop the `season > '2025-26'` skip)
- Modify: `docs/operations.md` (IFSC section: world ranking command and when to run it), `CLAUDE.md` (status: editions)

**Interfaces:**
- Consumes: `profiles.ifsc_id` (set by the earlier import) via an exported `OUT/profiles.json` with `id, ifsc_id`.
- Produces: `python3 -I tools/ifsc/world_ranking.py OUT SEASON DATE` → `OUT/world_ranking.sql`: one transaction of `insert … on conflict (climber_id, season, discipline) do update set position = excluded.position, as_of = excluded.as_of` for ISR athletes in `/api/v1/cuwr/{3,7,1,5}?date=DATE` (boulder men, boulder women, lead men, lead women) with a matching `ifsc_id`; prints unmatched ISR athletes.

- [ ] **Step 1: Write** `world_ranking.py` (curl with `referer: https://ifsc.results.info/`, like `scrape.py`).
- [ ] **Step 2: Dry run:** `python3 -I tools/ifsc/world_ranking.py OUT 2026-27 <today>` — expect SQL for the ISR athletes in the current list (boulder men today: places 14, 33, 34, 52, 54, 57, 75) and a list of unmatched names.
- [ ] **Step 3: Docs** in `docs/operations.md`: run with today's date during the season (provisional), again with `2027-01-01` once that date has passed.
- [ ] **Step 4: Commit** — "tools/ifsc: world ranking positions; import 2026 results".

### Task 6: Live rollout (only after the user confirms)

- [ ] **Step 1:** `npx -y supabase@2.121.0 db push --linked --dry-run` — expect only `20261017000028_world_rankings.sql`; then apply.
- [ ] **Step 2:** Load `world_ranking.sql` for 2026-27 (provisional, today's date) and the 2026 IFSC results (`to_sql.py`).
- [ ] **Step 3:** Compare 2023-24, 2024-25 and 2025-26 tables before/after: identical. Show the user the 2026-27 senior and youth tables.
- [ ] **Step 4:** `git push origin main`; delete the private exports in `OUT`.
