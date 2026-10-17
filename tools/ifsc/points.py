"""ILCA 2025 international points (same rules as src/lib/rankings.ts) for scraped IFSC rows."""
YOUTH = {'european_youth_cup': (0, 20, 30), 'european_youth_championship': (20, 30, 40), 'world_youth_championship': (30, 40, 50)}


def youth_points(x):
    p, n = x['place'], x['field_size']
    if not p or n < 30 or p / n > 0.5 or x['event_type'] not in YOUTH: return 0
    t = YOUTH[x['event_type']]
    if x['reached'] == 'final' and p <= 3: return t[2]
    return t[1] if x['reached'] == 'final' else t[0] if x['reached'] == 'semifinal' else 0


def senior_points(x):
    p, n, b = x['place'], x['field_size'], x['discipline'] == 'boulder'
    if not p or p / n > 0.6: return 0
    f = x['reached'] == 'final'; s = x['reached'] != 'qualification'; e = x['event_type']
    if e == 'world_cup':
        if f and p <= 3: return 300
        if f and p <= (6 if b else 8): return 200
        if s and p <= (20 if b else 26): return 140
        return 100 if p <= 30 else 60 if p <= 40 else 0
    if e == 'european_cup': return 100 if f and p <= 3 else 60 if f and p <= 8 else 0
    if e == 'european_championship':
        if f and p <= 3: return 200
        if f and p <= 8: return 140
        if s and p <= 24: return 100
        return 60 if p <= 30 else 0
    return 0
