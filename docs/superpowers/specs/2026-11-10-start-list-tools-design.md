# Start-list tools: DNS / DSQ, start order, groups, merging categories, results export — design

Requested 2026-11-10: compare the admin of the temporary app (ilca-boulder-score.netlify.app/admin.html)
with ours and build what is missing ("Create a task list and start subagent driven design").

## Goal

An admin can run every event on our apps without falling back to the temporary app for these
everyday jobs: a climber who doesn't show up or is disqualified, a late arrival who needs another
place in the start order, a qualification split into groups A / B, a category too small to run on
its own, and handing the results to ILCA as a spreadsheet.

Success: each job is done from the staff app in a few taps, the public results and the judge pads
follow at once, rankings and advancement stay correct, and `npm run typecheck && npm test &&
npm run build && npm run test:db && npm run test:e2e` stays green.

## 1. DNS / DSQ per climber per round

- Database: `round_starters.status text null check (status in ('dns', 'dsq'))`. Null = climbs
  normally. DNS = did not start, DSQ = disqualified. Set by admins only (existing `starters_admin`
  policy).
- Ranking: a DNS or DSQ starter has no rank in that round. In `round_scores` the `climbed` flag
  becomes `… and s.status is null`; in `lead_scores_for` the `climbed` CTE skips starters with a
  status. Everyone else is ranked as if they were not there. Because they have no rank they don't
  advance (`generate_start_list` takes ranked climbers only) and get no ranking points
  (`ranking_rounds` reads the same ranks). The caches refresh by their existing `round_starters`
  triggers.
- Results stay: setting DSQ does not delete scores (it can be undone). New writes for a starter with a
  status are refused (`boulder_results` / `lead_results` insert or update → error), so a judge pad
  can't score them by mistake; to correct, the admin clears the status first.
- TS side: `Starter.status`; `roundRows` leaves DNS / DSQ out of the `climbed` set (same rule as SQL)
  and returns the status so the rank column can show "DNS" / "DSQ". They sort after the unranked.
- Judge pad: starters with a status are not offered (not in the list, not "next", not counted in
  "3 / 24"). A climber marked while on a judge's screen: the save is refused and the pad shows why.
- Admin: on the round page, each starter has a status choice (climbs / DNS / DSQ). DSQ asks for
  confirmation. Every change goes to the admin change log.
- The temporary-app mirror writes `status = 'dns'` for climbers it marks DNS (today it only skips
  their results).

## 2. Changing the start order

- Admin round page, start-list section: set a climber's position by number; the others shift (the
  new number pushes the rest down, like the temporary app). One RPC does it atomically:
  `move_starter(p_round uuid, p_climber uuid, p_position int)`, security invoker (RLS: admins),
  renumbers the round's starters 1..n.
- Allowed at any time (a late arrival during the round), logged in the admin change log.
- No new ordering modes (random, lowest/highest first): later rounds keep reverse ranking (the ILCA
  rule) and the first round goes by bib, which can now be changed by hand.

## 3. Qualification groups

- Same section: a group choice per starter (none / A / B). Writes `round_starters.group_label`.
  Groups are already ranked separately everywhere (SQL and TS) and shown in the results.
- Changing groups after results exist re-ranks the round: allowed, with a warning.
- A button "split into A / B by start order" (odd positions A, even B) for the common case.

## 4. Merging two categories

- `merge_categories(p_keep uuid, p_drop uuid, p_apply boolean default false) returns jsonb`, admin
  only, security definer, same shape as `merge_profiles`: a preview (climbers moving, conflicts)
  and, with `p_apply`, the change in one transaction.
- Refused: same id, different competitions, any result or stored total in either category's rounds,
  a climber registered in both, a bib taken in both.
- Apply: move every registration of drop to keep (delete + insert, so the starters trigger puts them
  on keep's first round), filling an empty `age_class` with drop's name so the results can still be
  filtered by it; then delete drop (its rounds go with it). Logged in the admin change log.
- Different genders are allowed (the existing mixed-gender warning still shows).
- No undo: only possible before any result, and the preview shows exactly what happens.

## 5. Exporting results

- A "CSV" button next to "PDF" on the results of a round, and on the competition page for all its
  rounds. UTF-8 with BOM so Excel opens Hebrew correctly; built from the same rows as the PDF
  (`roundRows` / `printing`): place (or DNS / DSQ), bib, name, club, age class, a column per boulder
  / route, totals.
- CSV, not xlsx: no new dependency. No restore from file (the database is the record, with backups).

## Out of scope

Random or score-based start orders, restoring from a file, test-data loading, undo for merges.

## Testing

- SQL (`supabase/tests`): DNS / DSQ unranked and not advancing, the others ranked as if absent
  (boulder and lead, groups); writes refused for a starter with a status; `move_starter`
  renumbering and RLS (admin only); `merge_categories` preview, each refusal, apply, and non-admins
  refused.
- TS (vitest): `roundRows` with DNS / DSQ (same cases as SQL), the start-order shift, the A / B
  split, the CSV builder (BOM, quoting, Hebrew).
- e2e: mark a DNS, move a climber, set a group, merge two categories, download a CSV.
