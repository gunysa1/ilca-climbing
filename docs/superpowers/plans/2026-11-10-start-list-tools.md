# Start-list tools — plan

> For agentic workers: tasks run one after another on branch `start-list` (worktree
> `.worktrees/start-list`). Read CLAUDE.md first; it is binding. Spec:
> `docs/superpowers/specs/2026-11-10-start-list-tools-design.md`.

Requested 2026-11-10 after comparing the temporary app's admin with ours ("Create a task list and start
subagent driven design").

## Global constraints (every task)

- CLAUDE.md ground rules. RLS is the security boundary; every new access path gets assertions in
  `supabase/tests/rls_test.sql`. The viewer never gets sign-in, writes or staff pages.
- Scoring lives twice (SQL + TS): change both together, test both sides with the same cases.
- Migrations: `supabase/migrations/20261110000049_*.sql` onwards, one number per task as listed.
  `security definer` functions `set search_path = public` and revoke execute from public / anon unless
  anon is meant to call them. Admin-only functions raise `insufficient_privilege` for others.
- Hebrew is the default: every new string in `src/lib/i18n.tsx` in he and en, plain words. RTL; must work at
  360 px phone width.
- Match the surrounding code (comment density, naming, idioms). No new npm dependencies.
- Checks before reporting done: `npm run typecheck && npm test && npm run build && npm run test:db`.
  Tasks marked UI also run `npm run test:e2e` if Docker is available; say if it was not.
- Never touch the live project: no `db push`, no `functions deploy`, no `git push`, no live queries.
- Commit on the branch with clear messages. Do not dispatch subagents.

## Task 1 — DNS / DSQ in the database (migration 049)

- `round_starters.status text null check (status in ('dns', 'dsq'))`.
- `round_scores` (latest: 20261015000014): `climbed` also requires `s.status is null`. Keep everything
  else identical.
- `lead_scores_for` (latest: 20261015000017): the `climbed` CTE skips starters whose status is not null.
- Writes refused for a starter with a status: extend the trigger that accepts results only for starters
  (`boulder_results_check_registration`, 20261015000005; find the lead_results equivalent) to raise a clear
  error (`check_violation`, message "climber is marked DNS/DSQ in this round") on insert or update.
  Deleting a result stays allowed.
- `round_page` (find its latest definition, likely 20261018000042) and any other RPC returning starters to
  clients (search `round_starters` in migrations: page RPCs, favorites_live, on_wall, Screen data) return
  `status`. Keep `src/lib/types.ts` / `roundData.ts` column lists in sync (see the comment there).
- Admin change log (045): add `round_starters` to `admin_log.table_name` and an UPDATE-only trigger on
  `round_starters` (inserts / deletes come from imports and start-list generation: not logged).
- The migration queues full cache rebuilds (scoring changed): `insert into public.rankings_cache_changes
  (season) values (null); insert into public.climber_cache_changes (round_id) values (null);`.
- Tests (`supabase/tests`): boulder ifsc2025 and classic, lead (several routes and one-route final), with
  groups: DNS / DSQ have rank null, the others ranked as if absent; `generate_start_list` doesn't advance
  them; result insert / update refused for them, allowed after clearing; status update allowed for admin
  only (judge, coach, anon refused); the admin_log row is written.

## Task 2 — DNS / DSQ in the apps (UI)

- `Starter.status: 'dns' | 'dsq' | null`, loaded wherever starters are (`roundData.ts` select and the
  round_page mapping).
- `src/lib/roundRows.ts`: DNS / DSQ are never in the `climbed` set (same rule as SQL), rows carry the
  status, and they sort after the unranked (DNS before DSQ, then start order). Lead rounds the same
  (`leadStandings` receives only starters without a status, or the equivalent). Vitest cases mirror Task
  1's SQL cases.
- Results (`RoundResults.tsx`, big screen `Screen.tsx`, PDF `printing.ts`): the place column shows
  "DNS" / "DSQ"; their scores are shown greyed (DSQ) or empty (DNS).
- Judge pad (`src/lib/judgePad.ts`, `src/pages/judge/*`): starters with a status are not offered (list,
  "next", the "3 / 24" count). If a save is refused because of the status, the outbox (`judgeOutbox.ts` /
  `saveQueue.ts`) must treat it as final (not retried forever) and the pad says the climber is marked
  DNS / DSQ.
- Admin round page (`AdminRound.tsx`): per starter a status choice (climbs / DNS / DSQ); DSQ asks for
  confirmation (`src/components/Sheet.tsx` like the other confirmations).
- `tools/tempapp/mirror.py`: climbers with `liveFlag == 'DNS'` get `status = 'dns'` on the round's starter
  row (still no results for them); a climber no longer DNS gets `status = null`. Keep the sync idempotent.
- UI task: e2e step in `e2e/admin-flow.mjs`: mark a starter DNS, see "DNS" on the public results.

## Task 3 — start order and groups in the database (migration 050)

- `move_starter(p_round uuid, p_climber uuid, p_position int) returns void`, security invoker (RLS:
  `starters_admin`), plpgsql: the climber takes position `p_position` (clamped to 1..n), the others keep
  their relative order, the round's `start_order` becomes 1..n with no gaps. Raises if the climber is not
  a starter of the round.
- `split_groups(p_round uuid, p_labels text[] default array['A','B']) returns int`, security invoker:
  by start order, the k-th starter (1-based) gets `p_labels[(k-1) % n + 1]`; returns rows updated.
  Passing an empty array clears the groups.
- Tests: renumbering (first, last, middle, out of range, already gapped orders), A/B split with odd
  counts, clearing, non-admins refused (RLS), admin_log rows written (Task 1's trigger).

## Task 4 — start order and groups in the admin (UI)

- Admin round page: a start-list section listing starters in order with: position number input (on
  change → `move_starter`), group choice (none / A / B, direct update of `group_label`), the status choice
  from Task 2 in the same row. Buttons "split into A / B by start order" (`split_groups`) and "clear
  groups" (`split_groups` with an empty array).
- When the round already has results, changing groups first shows a warning sheet ("the ranking of the
  round will change").
- A pure helper for the optimistic reorder (`src/lib/startOrder.ts`) with vitest cases matching Task 3's.
- UI task: e2e step: move a climber to position 1, split into groups, see the groups on the public results.

## Task 5 — merging two categories (migration 051 + admin UI)

- `merge_categories(p_keep uuid, p_drop uuid, p_apply boolean default false) returns jsonb`, security
  definer, admin only. Report: `moving` (climbers with names and bibs), `conflicts` (human-readable),
  `applied`. Preview with `p_apply = false` changes nothing; apply with conflicts raises with the list.
- Conflicts: same id, unknown id, different competitions, any `boulder_results` / `lead_results` /
  `round_totals` in either category's rounds, a climber registered in both, a bib used in both.
- Apply in one transaction: for each registration of drop, delete it and insert it into keep with
  `age_class = coalesce(age_class, <drop's name_he or name>)` (the starters trigger puts the climbers on
  keep's first round); then delete drop (rounds cascade). Check `registrations` columns in the latest
  migrations (age_class was added after init) and keep every column.
- Admin UI on the competition page (`AdminCompetition.tsx`): "merge categories": pick the category to
  keep and the one to merge into it, show the preview, confirm in a sheet, then reload.
- Tests: SQL preview, each conflict, apply (registrations moved, starters on keep's first round, drop
  gone, age_class filled), non-admin refused; RLS assertions. UI task: e2e step merging two small
  categories.

## Task 6 — results export (CSV)

- `src/lib/resultsCsv.ts`: pure builder from the same rows the PDF uses (`roundRows` / `printing.ts`):
  columns place (or DNS / DSQ), bib, name (Hebrew name when the language is he, like the page), club,
  age class, one column per boulder (boulder: "T2 Z1" style as in the PDF; lead: height like "36+",
  "TOP") and totals. RFC 4180 quoting, CRLF, UTF-8 with BOM. Vitest: quoting of commas / quotes /
  newlines, BOM, Hebrew, DNS / DSQ, lead and boulder.
- A "CSV" button next to the "PDF" button on the round results (viewer and staff: export is a download in
  the browser, no write) and on the competition page for all rounds (one file, a block per round with its
  title). File names: `<competition>-<category>-<round>.csv`, safe characters.
- UI task: e2e step: the download happens and starts with the BOM and the header row.

## Task 7 — docs

- `docs/guide-he.md` (admins: DNS / DSQ, start order, groups, merging categories, CSV), `docs/operations.md`
  (running a competition: the same, and remove "qualification groups have no admin screen yet"),
  `docs/architecture.md` (migrations 049–051), `docs/scoring-and-rankings.md` (DNS / DSQ unranked),
  CLAUDE.md (status; remove "admin screen for qualification groups" from open work).

## After the tasks (controller)

Final whole-branch review, then ask the user before merging to main (pushing publishes both sites) and
before `db push` of 049–051 to the live project (049 queues full cache rebuilds).
