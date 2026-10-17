"""One transaction: IFSC results → international_results (add-only), profiles.ifsc_id where empty.
Skips (season, class, discipline) groups that already hold ILCA-published ('manual') points, events with
no table in the ILCA 2025 criteria, and athletes without a reliable profile match."""
import json, sys, collections as C
sys.path.insert(0, sys.argv[2])
from points import YOUTH

D = sys.argv[1] + '/'
r = json.load(open(D + 'isr_results.json')); m = json.load(open(D + 'matches.json'))
man = json.load(open(D + 'manual.json'))['rows']
manual_groups = {(q['season'], q['for_class'], q['discipline']) for q in man}
ACCEPT_CHECK = {'13365'}  # twins share a birth date; the first name decides (Alma, not Maya)

def q(s): return "'" + str(s).replace("'", "''") + "'"

rows, skipped, ifsc_ids = [], C.Counter(), {}
for x in r:
    mm = m[str(x['athlete_id'])]
    ok = mm['status'] in ('match', 'name-only') or str(x['athlete_id']) in ACCEPT_CHECK
    if not ok or not mm['profile_id']: skipped['no profile: ' + mm['ifsc']] += 1; continue
    if x['season'] > '2025-26': skipped['2026-27 waits for the 2027 criteria'] += 1; continue
    if not x['event_type']: skipped['no ILCA table: ' + x['event']] += 1; continue
    if not x['place'] or not x['field_size']: skipped['no place'] += 1; continue
    cls = 'youth' if x['event_type'] in YOUTH else 'senior'
    if (x['season'], cls, x['discipline']) in manual_groups: skipped[f"ILCA published: {x['season']} {cls} {x['discipline']}"] += 1; continue
    rows.append((mm['profile_id'], x['season'], x['discipline'], x['event_type'], f"{x['event']} ({x['dcat']})", x['date'], x['place'], x['field_size'], x['reached']))
    ifsc_ids[mm['profile_id']] = str(x['athlete_id'])

sql = ['begin;']
for pid, aid in sorted(ifsc_ids.items()):
    sql.append(f"update public.profiles set ifsc_id = {q(aid)} where id = {q(pid)} and ifsc_id is null;")
for row in rows:
    pid, season, disc, et, name, date, place, n, reached = row
    sql.append(
        "insert into public.international_results (climber_id, season, discipline, event_type, event_name, starts_on, place, field_size, reached) "
        f"select {q(pid)}, {q(season)}, {q(disc)}, {q(et)}, {q(name)}, {q(date)}, {place}, {n}, {q(reached)} "
        f"where not exists (select 1 from public.international_results where climber_id = {q(pid)} and discipline = {q(disc)} and event_name = {q(name)} and starts_on = {q(date)});")
sql.append('commit;')
open(D + 'ifsc_import.sql', 'w').write('\n'.join(sql) + '\n')
print(len(rows), 'rows,', len(ifsc_ids), 'climbers')
print(C.Counter((x[1], 'youth' if x[3] in YOUTH else 'senior', x[2]) for x in rows))
for k, v in sorted(skipped.items()): print('skip', v, k)
