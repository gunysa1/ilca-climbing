"""Read-only: Israeli (ISR) positions in the IFSC world ranking (boulder, lead; men and women) on DATE.
Usage: world_ranking.py OUT SEASON DATE [--force]  (e.g. OUT 2026-27 2026-10-17). Needs OUT/profiles.json (id, ifsc_id).
Writes OUT/world_ranking.sql: one transaction that deletes the season's positions of each discipline fetched, then
inserts the new ones; prints unmatched athletes. A DATE after 1 January of the season's second year is refused
(the official list of that day must not be overwritten) unless --force is given."""
import json, sys, time, subprocess, pathlib, re

FORCE = '--force' in sys.argv[1:]
args = [a for a in sys.argv[1:] if a != '--force']
if len(args) != 3: sys.exit('usage: world_ranking.py OUT SEASON DATE [--force]   (e.g. OUT 2026-27 2026-10-17)')
OUT = pathlib.Path(args[0]); SEASON, DATE = args[1], args[2]
if not re.fullmatch(r'\d{4}-\d{2}', SEASON): sys.exit(f'bad SEASON {SEASON!r}: expected YYYY-YY')
if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', DATE): sys.exit(f'bad DATE {DATE!r}: expected YYYY-MM-DD')
OFFICIAL = f'{int(SEASON[:4]) + 1}-01-01'
if DATE > OFFICIAL and not FORCE:
    sys.exit(f'DATE {DATE} is after {OFFICIAL}, the official list of {SEASON}: use {OFFICIAL}, or --force to overwrite it')
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
for disc in sorted({d for _, d in DCATS}):  # rows of an earlier run must not survive
    sql.append(f"delete from public.world_rankings where season = '{SEASON}' and discipline = '{disc}';")
for (pid, disc), pos in sorted(rows.items()):
    sql.append(f"insert into public.world_rankings (climber_id, season, discipline, position, as_of) values "
               f"('{pid}', '{SEASON}', '{disc}', {int(pos)}, '{DATE}') "
               "on conflict (climber_id, season, discipline) do update set position = excluded.position, as_of = excluded.as_of;")
sql.append('commit;')
(OUT / 'world_ranking.sql').write_text('\n'.join(sql) + '\n')
print(f'{len(rows)} rows', counts, 'as of', DATE)
for u in unmatched: print('unmatched:', u)
