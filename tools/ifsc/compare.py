"""Compare ILCA-published (manual) international points with points derived from the IFSC rows."""
import json, sys, collections as C
sys.path.insert(0, sys.argv[2])
from points import youth_points, senior_points, YOUTH

D = sys.argv[1] + '/'
r = json.load(open(D + 'isr_results.json')); m = json.load(open(D + 'matches.json')); man = json.load(open(D + 'manual.json'))['rows']
prof = {x['id']: x['full_name_he'] for x in json.load(open(D + 'profiles.json'))['rows']}
calc = C.defaultdict(list)
for x in r:
    mm = m[str(x['athlete_id'])]
    if not mm['profile_id'] or (mm['status'] == 'check' and x['athlete_id'] != 13365): continue
    if x['event_type'] in YOUTH: calc[(mm['profile_id'], x['season'], x['discipline'], 'youth')].append((youth_points(x), x['event']))
    elif x['event_type']: calc[(mm['profile_id'], x['season'], x['discipline'], 'senior')].append((senior_points(x), x['event']))
same = diff = 0
manual = C.defaultdict(list)
for q in man: manual[(q['climber_id'], q['season'], q['discipline'], q['for_class'])].append(float(q['points']))
for k in sorted(manual, key=lambda k: (k[1], k[2], -sum(manual[k]))):
    v = calc.get(k, [])
    if k[3] == 'youth':  # ILCA publishes the bonus total
        ilca, ifsc = sum(manual[k]), sum(p for p, _ in v)
    else:  # one row per counted international event; the best 2 count
        ilca, ifsc = sorted(manual[k], reverse=True), sorted((p for p, _ in v if p), reverse=True)[:2]
    ok = ilca == ifsc
    same += ok; diff += not ok
    print('OK ' if ok else 'DIFF', k[1], k[2], k[3], '|', prof[k[0]], '| ILCA', ilca, '| IFSC', ifsc, '' if ok else [(p, e) for p, e in v if p])
print('same', same, 'different', diff)
