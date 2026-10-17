"""Read-only: every Israeli (ISR) boulder/lead result at IFSC world/European adult and youth events
held from 2023 on (season = calendar year: 2024 events → 2024-25). Writes isr_results.json + isr_athletes.json to OUT."""
import json, sys, time, subprocess, pathlib, re

OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(exist_ok=True)
BASE = 'https://ifsc.results.info'
LEAGUES = {'World Cups and World Championships', 'IFSC Youth', 'IFSC Europe Adults', 'IFSC Europe Youth'}
CACHE = OUT / 'cache'; CACHE.mkdir(exist_ok=True)

def get(path):
    f = CACHE / (re.sub(r'[^A-Za-z0-9]+', '_', path) + '.json')
    if f.exists(): return json.loads(f.read_text())
    for i in range(4):
        out = subprocess.run(['curl', '-s', '-m', '60', '-H', 'referer: ' + BASE + '/', '-H', 'accept: application/json', BASE + path],
                             capture_output=True, text=True)
        try:
            d = json.loads(out.stdout); break
        except ValueError:
            if i == 3: raise RuntimeError(f'{path}: {out.stdout[:200]}')
            time.sleep(3 * (i + 1))
    f.write_text(json.dumps(d)); time.sleep(0.4)
    return d

def ilca_season(date):
    """ILCA criteria 2025: the 24/25 rankings count the international events of calendar year 2024."""
    y = int(date[:4])
    return f'{y}-{str(y + 1)[2:]}'

def event_type(name):
    """IFSC names until 2025, "World Climbing" names after the 2025 rebrand."""
    n = name.lower()
    youth = 'youth' in n
    europe = 'europe' in n  # "European Cup", "Europe Series", "IFSC Europe - Youth Championship"
    champs = 'championship' in n
    if 'world championships' in n and not youth: return 'world_championship'
    if youth:
        if champs: return 'european_youth_championship' if europe else 'world_youth_championship'
        if europe and ('cup' in n or 'series' in n): return 'european_youth_cup'
    else:
        if europe and champs: return 'european_championship'
        if europe and ('cup' in n or 'series' in n): return 'european_cup'
        if 'world cup' in n or n.startswith('world climbing series'): return 'world_cup'
    return None

root = get('/api/v1/')
season_ids = [s for s in root.get('seasons', []) if 2023 <= int(s['name']) <= 2026]
results, athletes = [], {}
for s in season_ids:
    sd = get(s['url'])
    for lg in sd['leagues']:
        if lg['name'] not in LEAGUES: continue
        for ev in get(lg['url'])['events']:
            date = ev['local_start_date']
            if date < '2023-01-01': continue
            for dc in ev['d_cats']:
                disc = dc['name'].split()[0].lower()
                if disc not in ('boulder', 'lead') or dc.get('status') not in ('finished', None): continue
                try: r = get(dc['result_url'])
                except Exception as e: print('skip', ev['event'], dc['name'], e, file=sys.stderr); continue
                ranking = r.get('ranking') or []
                rounds = [cr['name'] for cr in r.get('category_rounds', [])]
                ranked = [x for x in ranking if x.get('rank')]
                for x in ranking:
                    if x.get('country') != 'ISR': continue
                    done = [rd['round_name'] for rd in x.get('rounds', []) if rd.get('score') or rd.get('rank')]
                    last = done[-1].lower() if done else 'qualification'
                    reached = 'final' if 'final' in last and 'semi' not in last else 'semifinal' if 'semi' in last else 'qualification'
                    results.append(dict(athlete_id=x['athlete_id'], firstname=x['firstname'], lastname=x['lastname'],
                        event_id=ev['event_id'], event=ev['event'], date=date, season=ilca_season(date),
                        dcat=dc['name'], discipline=disc, event_type=event_type(ev['event']),
                        place=x.get('rank'), field_size=len(ranked), reached=reached, rounds=rounds))
                    athletes[x['athlete_id']] = None
for aid in athletes:
    a = get(f'/api/v1/athletes/{aid}')
    athletes[aid] = {k: a.get(k) for k in ('id', 'firstname', 'lastname', 'gender', 'birthday', 'country')}
(OUT / 'isr_results.json').write_text(json.dumps(results, ensure_ascii=False, indent=1))
(OUT / 'isr_athletes.json').write_text(json.dumps(athletes, ensure_ascii=False, indent=1))
print(len(results), 'results,', len(athletes), 'athletes')
