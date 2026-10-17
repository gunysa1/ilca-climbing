"""Match IFSC ISR athletes to profiles: same birth date (and gender), then a rough Hebrew→Latin name check.
Writes matches.json; prints one line per athlete (no birth dates)."""
import json, sys, pathlib, difflib, unicodedata

D = pathlib.Path(sys.argv[1])
athletes = json.loads((D / 'isr_athletes.json').read_text())
profiles = json.loads((D / 'profiles.json').read_text())['rows']

HE = {'א': 'a', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'o', 'ז': 'z', 'ח': 'h', 'ט': 't', 'י': 'i', 'כ': 'k', 'ך': 'k',
      'ל': 'l', 'מ': 'm', 'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's', 'ע': 'a', 'פ': 'p', 'ף': 'f', 'צ': 'tz', 'ץ': 'tz', 'ק': 'k',
      'ר': 'r', 'ש': 'sh', 'ת': 't', ' ': ' ', '-': ' ', "'": ''}

def skel(s):
    """Consonant skeleton, so 'Yonatan' and 'יונתן' compare: drop vowels, unify similar sounds."""
    s = unicodedata.normalize('NFKD', s.lower())
    s = ''.join(HE.get(c, c) for c in s if not unicodedata.combining(c))
    s = s.replace('ph', 'f').replace('ch', 'h').replace('kh', 'h').replace('ts', 'tz').replace('c', 'k').replace('w', 'v').replace('y', 'i').replace('j', 'i').replace('q', 'k')
    s = s.replace('p', 'f').replace('v', 'b')
    return ''.join(c for c in s if c not in 'aeiouh ')

def name_score(a, p):
    he = p['full_name_he'] or p['full_name'] or ''
    lat = f"{a['firstname']} {a['lastname']}"
    lat2 = f"{a['lastname']} {a['firstname']}"
    s1 = max(difflib.SequenceMatcher(None, skel(lat), skel(he)).ratio(), difflib.SequenceMatcher(None, skel(lat2), skel(he)).ratio())
    # also try the stored full_name when it is Latin
    s2 = difflib.SequenceMatcher(None, skel(lat), skel(p['full_name'] or '')).ratio()
    return round(max(s1, s2), 2)

by_bd = {}
for p in profiles:
    if p['birth_date']: by_bd.setdefault(p['birth_date'], []).append(p)

out = {}
for aid, a in athletes.items():
    cands = [p for p in by_bd.get(a['birthday'] or '', [])]
    g = {'male': 'male', 'female': 'female'}.get(a['gender'] or '')
    cands = [p for p in cands if not p['gender'] or not g or p['gender'] == g]
    scored = sorted(((name_score(a, p), p) for p in cands), key=lambda x: -x[0])
    best = scored[0] if scored else None
    if best and best[0] >= 0.5 and (len(scored) == 1 or scored[1][0] < best[0] - 0.15):
        status = 'match'
    elif best:
        status = 'check'
    else:
        # no birth-date hit: best name match among all profiles of that gender, for review only
        allc = sorted(((name_score(a, p), p) for p in profiles if not g or p['gender'] in (None, g)), key=lambda x: -x[0])
        best = allc[0] if allc and allc[0][0] >= 0.75 else None
        status = 'name-only' if best else 'none'
    out[aid] = dict(ifsc=f"{a['firstname']} {a['lastname']}", status=status,
                    profile_id=best[1]['id'] if best else None, profile=(best[1]['full_name_he'] or best[1]['full_name']) if best else None,
                    score=best[0] if best else None, candidates=len(cands))
(D / 'matches.json').write_text(json.dumps(out, ensure_ascii=False, indent=1))
for aid, m in sorted(out.items(), key=lambda kv: kv[1]['status']):
    print(m['status'], aid, m['ifsc'], '→', m['profile'], m['score'], m['candidates'])
