"""Read-only: Israeli (ISR) positions in the IFSC world ranking (boulder, lead; men and women) on DATE.
Usage: world_ranking.py OUT SEASON DATE  (e.g. OUT 2026-27 2026-10-17). Needs OUT/profiles.json (id, ifsc_id).
Writes OUT/world_ranking.sql: one transaction of upserts into world_rankings; prints unmatched athletes."""
import json, sys, time, subprocess, pathlib, re

if len(sys.argv) != 4: sys.exit('usage: world_ranking.py OUT SEASON DATE   (e.g. OUT 2026-27 2026-10-17)')
OUT = pathlib.Path(sys.argv[1]); SEASON, DATE = sys.argv[2], sys.argv[3]
if not re.fullmatch(r'\d{4}-\d{2}', SEASON): sys.exit(f'bad SEASON {SEASON!r}: expected YYYY-YY')
if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', DATE): sys.exit(f'bad DATE {DATE!r}: expected YYYY-MM-DD')
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
BASE = 'https://ifsc.results.info'
DCATS = [(3, 'boulder'), (7, 'boulder'), (1, 'lead'), (5, 'lead')]  # men/women boulder, men/women lead

def get(path):
    for i in range(4):
        out = subprocess.run(['curl', '-s', '-m', '60', '-H', 'referer: ' + BASE + '/', '-H', 'accept: application/json', BASE + path],
                             capture_output=True, text=True)
        try: return json.loads(out.stdout)
        except ValueError:
            if i == 3: raise RuntimeError(f'{path}: {out.stdout[:200]}')
            time.sleep(3 * (i + 1))

profiles = json.load(open(OUT / 'profiles.json'))
profiles = profiles['rows'] if isinstance(profiles, dict) else profiles
by_ifsc = {str(p['ifsc_id']): p['id'] for p in profiles if p.get('ifsc_id')}

rows, unmatched, counts = {}, [], {}
for dcat, disc in DCATS:
    d = get(f'/api/v1/cuwr/{dcat}?date={DATE}')
    ranking = d.get('ranking') if isinstance(d, dict) else None
    if not ranking: sys.exit(f'dcat {dcat} ({disc}): no ranking in the response: {str(d)[:200]}')
    for x in ranking:
        if x.get('country') != 'ISR': continue
        pid = by_ifsc.get(str(x['athlete_id']))
        if not pid: unmatched.append(f"{x['firstname']} {x['lastname']} ({disc}, {x['rank']})"); continue
        if not UUID.fullmatch(str(pid)): sys.exit(f'bad profile id {pid!r}')
        rows[(pid, disc)] = x['rank']
        counts[disc] = counts.get(disc, 0) + 1
    time.sleep(0.4)

sql = ['begin;']
for (pid, disc), pos in sorted(rows.items()):
    sql.append(f"insert into public.world_rankings (climber_id, season, discipline, position, as_of) values "
               f"('{pid}', '{SEASON}', '{disc}', {int(pos)}, '{DATE}') "
               "on conflict (climber_id, season, discipline) do update set position = excluded.position, as_of = excluded.as_of;")
sql.append('commit;')
(OUT / 'world_ranking.sql').write_text('\n'.join(sql) + '\n')
print(f'{len(rows)} rows', counts, 'as of', DATE)
for u in unmatched: print('unmatched:', u)
