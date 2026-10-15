#!/usr/bin/env python3
"""Import archived LogLig competitions (ILCA's own data, recovered from the defunct vendor) as SQL.

Reads the private archive written by the recovery crawler (raw/<season>/<competition>/
competition.html, results-<id>.html, ls-results-<id>.html) and prints one SQL transaction that
replaces the given competitions in the app's schema:

  competitions (finished), categories (one per LogLig category), rounds (closed) with start lists
  and seeds, boulder_results (boulder: per-boulder top/zone attempts from the plain pages) or
  lead_results (lead: per-route height and time from the LS pages), round_totals (older boulder
  pages that only publish per-round totals "2T 3Z 3 5": rounds scored 'classic' without boulders),
  climber profiles without accounts (+ private birth date).

Ids are uuid5 of LogLig ids, so re-running replaces the same competitions, and a climber (name +
birth date) maps to the same profile across competitions. LogLig does not publish total attempts
per boulder: attempts = the minimum consistent with the recorded top/zone attempts (min. 1).

Usage: import_loglig.py ARCHIVE_DIR SEASON_ID:COMP_ID [...] > import.sql
       import_loglig.py --check ARCHIVE_DIR SEASON_ID:COMP_ID [...]   # print LogLig ranks as JSON
"""
import html
import json
import re
import sys
import uuid
from pathlib import Path

NS = uuid.UUID('6b7f4a52-2c1e-4f4e-9a3b-1c0de1ca0001')  # ILCA LogLig import namespace
# LogLig test entries, not ILCA competitions: "אליפות פקטיבית לבדיקת מערכת", "בדיקה", "ניסוי".
TEST_COMPETITIONS = {'4768', '12829', '15209'}


def is_practice(title: str) -> bool:
    """Club simulations ("סימולציית ...") and training camps ("מחנה ...") are rehearsals, not ILCA competitions."""
    return bool(re.search(r'סימולצי|מחנה', title))


def season_of(date: str | None) -> str | None:
    """Ranking season from the event date. LogLig's season folders don't match ILCA's ranking seasons
    (e.g. the August 2025 league event sits in LogLig's 2024-25); an ILCA season runs June to May."""
    if not date:
        return None
    y, m = int(date[:4]), int(date[5:7])
    start = y if m >= 6 else y - 1
    return f'{start}-{(start + 1) % 100:02d}'


def series_of(title: str) -> str:
    """Which national ranking an event feeds (ILCA criteria 2025). Older youth leagues ("לנוער A+J")
    and kids / para championships feed none."""
    if 'ליגת העל' in title:
        if 'U17' in title and not re.search(r'בוגרים\s*\+\s*U17', title):  # "בוגרים + U17" is a joint open event
            return 'premier_league_u17'
        return 'other' if 'לנוער' in title else 'premier_league'
    if 'אליפות ישראל' in title and not re.search(r'לילדים|פארא|נכים', title):
        return 'youth_championship' if 'לנוער' in title else 'israeli_championship'
    return 'other'
ROUND_KINDS = {'מוקדמות': 'qualification', 'מוקדמות לגמר': 'qualification', 'חצי גמר': 'semifinal', 'גמר': 'final'}


def uid(*parts: object) -> str:
    return str(uuid.uuid5(NS, ':'.join(str(p) for p in parts)))


def text(fragment: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', fragment))).strip()


def sections(page: str) -> list[tuple[str, list[list[str]]]]:
    """(round heading, rows of cell texts) for each results table on a page."""
    page = re.sub(r'(?s)<(script|style)[^>]*>.*?</\1>', '', page)
    parts = re.split(r'(?s)<h4[^>]*>(.*?)</h4>', page)
    out = []
    for i in range(1, len(parts), 2):
        heading = text(parts[i])
        if heading not in ROUND_KINDS:
            continue
        rows = [[text(c) for c in re.findall(r'(?s)<td[^>]*>(.*?)</td>', tr)]
                for tr in re.findall(r'(?s)<tr[^>]*>(.*?)</tr>', parts[i + 1])]
        out.append((heading, [r for r in rows if len(r) >= 3]))
    return out


def gender_of(category: str) -> str:
    if re.search(r'בנות|נשים|בוגרות|women|girls', category, re.I):
        return 'female'
    if re.search(r'בנים|גברים|בוגרים|men|boys', category, re.I):
        return 'male'
    return 'mixed'


def parse_rank(cell: str) -> int | None:
    return int(cell) if cell.isdigit() else None


def parse_competition(archive: Path, season: str, cid: str) -> dict:
    cdir = archive / 'raw' / season / cid
    page = (cdir / 'competition.html').read_text(encoding='utf-8')
    body = text(re.sub(r'(?s)<(script|style)[^>]*>.*?</\1>', '', page))
    titles = {str(c['Id']): c['Title'].strip() for c in json.loads((archive / 'seasons' / f'{season}.json').read_text())}
    date = re.search(r'(\d{2})/(\d{2})/(\d{4})', body)
    cats = {}
    for did, name in re.findall(r'competitionDisciplineId=(\d+)[^"]*competitionName=([^&"]+)', page):
        cats.setdefault(did, re.sub(r'\s+', ' ', html.unescape(__import__('urllib.parse').parse.unquote(name))).strip())
    comp = {'id': cid, 'title': re.sub(r'\s+', ' ', titles.get(cid, cid)), 'date': f'{date[3]}-{date[2]}-{date[1]}' if date else None,
            'categories': []}
    for did, cname in cats.items():
        plain_path, ls_path = cdir / f'results-{did}.html', cdir / f'ls-results-{did}.html'
        if not plain_path.exists():
            continue
        plain = plain_path.read_text(encoding='utf-8')
        discipline = detect_discipline(plain)
        if discipline is None:
            continue  # only 0T 0Z placeholders (national league): nothing faithful to import
        dob = {}  # name -> birth date (plain pages only)
        rounds = []
        if discipline == 'boulder_totals':
            for heading, rows in sections(plain):
                climbers = [{'name': r[1], 'dob': r[2], 'club': r[3], 'rank': parse_rank(r[0]), 'total': r[-1],
                             'totals': tuple(int(x) for x in m.groups()) if (m := TOTALS.fullmatch(r[-1])) else None}
                            for r in rows]
                # a round of only "0T 0Z 0 0" is a placeholder, not results
                if any(c['totals'] and any(c['totals']) for c in climbers):
                    rounds.append({'kind': ROUND_KINDS[heading], 'climbers': climbers})
        elif discipline == 'boulder':
            for heading, rows in sections(plain):
                climbers = []
                for r in rows:
                    m = re.match(r'(.*?)\s((?:\d+ \d+:\d+\s?)+)$', r[1])
                    name = (m.group(1) if m else r[1]).strip()
                    boulders = [(int(n), int(t), int(z)) for n, t, z in re.findall(r'(\d+) (\d+):(\d+)', m.group(2))] if m else []
                    climbers.append({'name': name, 'dob': r[2], 'club': r[3], 'rank': parse_rank(r[0]), 'boulders': boulders, 'total': r[-1]})
                rounds.append({'kind': ROUND_KINDS[heading], 'climbers': climbers})
        else:
            for heading, rows in sections(plain):
                for r in rows:
                    dob[r[1]] = r[2]
            if not ls_path.exists():
                continue
            for heading, rows in sections(ls_path.read_text(encoding='utf-8')):
                climbers = []
                for r in rows:
                    # rank, name, club, then per route (height, time, route rank), then total
                    routes = []
                    rest = r[3:-1]
                    for k in range(0, len(rest) - 2, 3):
                        routes.append({'height': rest[k], 'time': rest[k + 1], 'route_rank': rest[k + 2]})
                    climbers.append({'name': r[1], 'dob': dob.get(r[1], ''), 'club': r[2], 'rank': parse_rank(r[0]),
                                     'routes': routes, 'total': r[-1]})
                rounds.append({'kind': ROUND_KINDS[heading], 'climbers': climbers})
        # LogLig keeps empty shells (rounds nobody climbed, registration-only categories): skip them.
        rounds = [r for r in rounds if any(c['rank'] is not None for c in r['climbers'])]
        if rounds:
            comp['categories'].append({'id': did, 'name': cname, 'discipline': discipline, 'rounds': rounds})
    comp['categories'] = merge_split_categories(cid, comp['categories'])
    return comp


NEXT_KIND = {'qualification': 'semifinal', 'semifinal': 'final', 'final': 'final'}


def merge_split_categories(cid: str, cats: list[dict]) -> list[dict]:
    """LogLig championships split one category into several: qualification groups ("X קבוצה א'"),
    a later round as its own category ("X חצי גמר", "סיבוב שני X"). Fold them back into X with
    proper rounds; group climbers keep their group label (groups are ranked separately)."""
    def split(name: str) -> tuple[str, str, str | None] | None:
        if m := re.match(r"^(.+?)\s*קבוצה\s*(\S+?)'?$", name):
            return (m[1].strip(), 'group', m[2])
        if m := re.match(r'^(.+?)\s*חצי גמר$', name):
            return (m[1].strip(), 'later', None)
        if m := re.match(r'^סיבוב שני\s+(.+)$', name):
            return (m[1].strip(), 'later', None)
        return None

    parts = {c['id']: split(c['name']) for c in cats}
    bases = {(p[0], c['discipline']) for c in cats if (p := parts[c['id']])}
    if not bases:
        return cats
    out = [c for c in cats if not parts[c['id']] and (c['name'], c['discipline']) not in bases]
    for base, discipline in sorted(bases):
        own = next((c for c in cats if not parts[c['id']] and c['name'] == base and c['discipline'] == discipline), None)
        rounds: dict[str, list[dict]] = {}
        for r in (own['rounds'] if own else []):
            rounds.setdefault(r['kind'], []).extend(r['climbers'])
        for c in cats:
            p = parts[c['id']]
            if not p or p[0] != base or c['discipline'] != discipline:
                continue
            for r in c['rounds']:
                if p[1] == 'group':
                    rounds.setdefault(r['kind'], []).extend({**x, 'group': p[2]} for x in r['climbers'])
                else:
                    # LogLig ranked these as a standalone category (no countback to the previous round):
                    # no seeds, so ties resolve like the published results.
                    rounds.setdefault(NEXT_KIND[r['kind']], []).extend({**x, 'unseeded': True} for x in r['climbers'])
        out.append({'id': own['id'] if own else f'{cid}-{base}', 'name': base, 'discipline': discipline,
                    'rounds': [{'kind': k, 'climbers': rounds[k]} for k in ('qualification', 'semifinal', 'final') if k in rounds]})
    return out


TOTALS = re.compile(r'(\d+)T (\d+)Z (\d+) (\d+)')


def detect_discipline(plain: str) -> str | None:
    """'boulder' when per-boulder detail ("1 2:1 2 0:3 ...") is present, 'lead' when results are lead
    rank points (e.g. 2.121; heights are on the LS page), 'boulder_totals' when only classic per-round
    totals ("5T 7Z 9 12") are published, else None: national-league pages only hold "0T 0Z 0 0"."""
    rows = [r for _, rows in sections(plain) for r in rows if parse_rank(r[0]) is not None]
    if any(re.search(r'\d+ \d+:\d+', r[1]) for r in rows):
        return 'boulder'
    if any(re.fullmatch(r'\d+\.\d+', r[-1]) for r in rows):
        return 'lead'
    if any(TOTALS.fullmatch(r[-1]) and r[-1] != '0T 0Z 0 0' for r in rows):
        return 'boulder_totals'
    return None


def iso_date(dob: str) -> str | None:
    m = re.match(r'(\d{2})/(\d{2})/(\d{4})$', dob)
    return f'{m[3]}-{m[2]}-{m[1]}' if m else None


def parse_height(h: str) -> tuple[int, bool, bool] | None:
    h = h.strip()
    if h in ('', '-'):
        return None
    if re.fullmatch(r'(?i)top|טופ', h):
        return (0, False, True)
    m = re.fullmatch(r'(\d+)(\+?)', h)
    return (int(m[1]), bool(m[2]), False) if m else None


def time_tie_left(rnd: dict) -> bool:
    """A lead round where LogLig ranked climbers equal although their climbing times differ: LogLig did
    not break ties by time there (2022-23 finals), so neither must we."""
    by_rank: dict[int, set[str]] = {}
    for c in rnd['climbers']:
        if c['rank'] is not None and len(c.get('routes', [])) == 1:
            by_rank.setdefault(c['rank'], set()).add(c['routes'][0]['time'])
    return any(len(times) > 1 for times in by_rank.values())


def to_rows(comps: list[dict]) -> dict:
    """Rows for each table, keyed by table name."""
    t = {k: [] for k in ('competitions', 'categories', 'rounds', 'boulders', 'profiles', 'profile_private',
                         'registrations', 'round_starters', 'round_totals', 'boulder_results', 'lead_results')}
    seen_profiles = set()
    for comp in comps:
        comp_id = uid('competition', comp['id'])
        t['competitions'].append({'id': comp_id, 'name': comp['title'], 'name_he': comp['title'],
                                  'starts_on': comp['date'], 'ends_on': comp['date'], 'status': 'finished',
                                  'season': season_of(comp['date']), 'series': series_of(comp['title'])})
        for cat in comp['categories']:
            cat_id = uid('category', cat['id'])
            t['categories'].append({'id': cat_id, 'competition_id': comp_id, 'name': cat['name'], 'name_he': cat['name'],
                                    'gender': gender_of(cat['name'])})
            registered = set()
            prev_rank: dict[str, int] = {}
            for rnd in cat['rounds']:
                if not rnd['climbers']:
                    continue
                round_id = uid('round', cat['id'], rnd['kind'])
                t['rounds'].append({'id': round_id, 'category_id': cat_id, 'kind': rnd['kind'], 'status': 'closed',
                                    'scoring': {'lead': 'lead', 'boulder_totals': 'classic'}.get(cat['discipline'], 'ifsc2025'),
                                    'time_tiebreak': not time_tie_left(rnd)})
                n_routes = max([b[0] for c in rnd['climbers'] for b in c.get('boulders', [])] +
                               [len(c.get('routes', [])) for c in rnd['climbers']] + [0])
                route_ids = {n: uid('route', round_id, n) for n in range(1, n_routes + 1)}
                t['boulders'] += [{'id': rid, 'round_id': round_id, 'number': n} for n, rid in route_ids.items()]
                ranks: dict[str, int] = {}
                for order, c in enumerate(rnd['climbers'], 1):
                    pid = uid('climber', c['name'], c['dob'])
                    if pid not in seen_profiles:
                        seen_profiles.add(pid)
                        t['profiles'].append({'id': pid, 'full_name': c['name'], 'full_name_he': c['name'], 'club': c['club'] or None,
                                              'gender': None if gender_of(cat['name']) == 'mixed' else gender_of(cat['name'])})
                        t['profile_private'].append({'id': pid, 'birth_date': iso_date(c['dob'])})
                    if pid not in registered:
                        registered.add(pid)
                        t['registrations'].append({'category_id': cat_id, 'climber_id': pid})
                    t['round_starters'].append({'round_id': round_id, 'climber_id': pid, 'start_order': order,
                                                'prev_place': None if c.get('unseeded') else prev_rank.get(pid),
                                                'group_label': c.get('group')})
                    if c['rank'] is not None:
                        ranks[pid] = c['rank']
                        if c.get('totals'):
                            tops, zones, top_att, zone_att = c['totals']
                            t['round_totals'].append({'round_id': round_id, 'climber_id': pid, 'tops': tops, 'zones': zones,
                                                      'top_attempts': top_att, 'zone_attempts': zone_att})
                    for n, top, zone in c.get('boulders', []):
                        zone = zone or top  # a top implies the zone
                        if top and zone > top:  # zone can't come after the top
                            zone = top
                        t['boulder_results'].append({'boulder_id': route_ids[n], 'climber_id': pid, 'round_id': round_id,
                                                     'attempts': max(top, zone, 1), 'zone_attempt': zone or None,
                                                     'top_attempt': top or None})
                    for n, route in enumerate(c.get('routes', []), 1):
                        h = parse_height(route['height'])
                        if h is None:
                            continue
                        mm = re.fullmatch(r'(\d+):(\d+)', route['time'])
                        t['lead_results'].append({'boulder_id': route_ids[n], 'climber_id': pid, 'round_id': round_id,
                                                  'hold': h[0], 'plus': h[1], 'top': h[2],
                                                  'time_ms': (int(mm[1]) * 60 + int(mm[2])) * 1000 if mm and (mm[1], mm[2]) != ('00', '00') else None})
                prev_rank = ranks
    return t


def sql(comps: list[dict]) -> str:
    rows = to_rows(comps)
    payload = json.dumps(rows, ensure_ascii=False)
    assert '$loglig$' not in payload
    comp_ids = ', '.join(f"'{r['id']}'" for r in rows['competitions'])
    lines = ['-- Generated by tools/loglig/import_loglig.py: ILCA competitions recovered from LogLig.', 'begin;',
             f'delete from public.competitions where id in ({comp_ids});',  # cascades to categories/rounds/results
             f"create temp table _loglig on commit drop as select $loglig${payload}$loglig$::jsonb as d;"]
    cols = {
        'competitions': 'id, name, name_he, starts_on, ends_on, status, season, series',
        'categories': 'id, competition_id, name, name_he, gender',
        'rounds': 'id, category_id, kind, status, scoring, time_tiebreak',
        'boulders': 'id, round_id, number',
        'profiles': 'id, full_name, full_name_he, club, gender',
        'profile_private': 'id, birth_date',
        'registrations': 'category_id, climber_id',
        'round_starters': 'round_id, climber_id, start_order, prev_place, group_label',
        'round_totals': 'round_id, climber_id, tops, zones, top_attempts, zone_attempts',
        'boulder_results': 'boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt',
        'lead_results': 'boulder_id, climber_id, round_id, hold, plus, top, time_ms',
    }
    conflict = {'profiles': ' on conflict (id) do nothing', 'profile_private': ' on conflict (id) do nothing',
                'round_starters': ' on conflict (round_id, climber_id) do update set start_order = excluded.start_order,'
                                  ' prev_place = excluded.prev_place, group_label = excluded.group_label'}
    for table, c in cols.items():
        lines.append(f"insert into public.{table} ({c}) select {c} from _loglig, "
                     f"jsonb_populate_recordset(null::public.{table}, d->'{table}'){conflict.get(table, '')};")
    lines.append('commit;')
    return '\n'.join(lines) + '\n'


def main() -> None:
    args = sys.argv[1:]
    check = args[0] == '--check'
    if check:
        args = args[1:]
    archive = Path(args[0])
    specs = [spec for spec in args[1:] if spec.split(':')[1] not in TEST_COMPETITIONS]
    if len(specs) < len(args) - 1:
        print('skipping LogLig test competitions', file=sys.stderr)
    comps = [parse_competition(archive, *spec.split(':')) for spec in specs]
    practice = [c for c in comps if is_practice(c['title'])]
    if practice:
        print('skipping simulations / training camps:', ', '.join(c['id'] for c in practice), file=sys.stderr)
    comps = [c for c in comps if not is_practice(c['title'])]
    if check:
        ranks = [{'round_id': uid('round', cat['id'], rnd['kind']), 'climber_id': uid('climber', c['name'], c['dob']), 'rank': c['rank']}
                 for comp in comps for cat in comp['categories'] for rnd in cat['rounds'] for c in rnd['climbers']]
        print(json.dumps(ranks))
    else:
        sys.stdout.write(sql(comps))


if __name__ == '__main__':
    main()
