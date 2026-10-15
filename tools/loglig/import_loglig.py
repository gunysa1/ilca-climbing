#!/usr/bin/env python3
"""Import archived LogLig competitions (ILCA's own data, recovered from the defunct vendor) as SQL.

Reads the private archive written by the recovery crawler (raw/<season>/<competition>/
competition.html, results-<id>.html, ls-results-<id>.html) and prints one SQL transaction that
replaces the given competitions in the app's schema:

  competitions (finished), categories (one per LogLig category), rounds (closed) with start lists
  and seeds, boulder_results (boulder: per-boulder top/zone attempts from the plain pages) or
  lead_results (lead: per-route height and time from the LS pages), climber profiles without
  accounts (+ private birth date).

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
        discipline = 'boulder' if 'value="Bouldering"' in plain else 'lead'
        dob = {}  # name -> birth date (plain pages only)
        rounds = []
        if discipline == 'boulder':
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
    return comp


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


def to_rows(comps: list[dict]) -> dict:
    """Rows for each table, keyed by table name."""
    t = {k: [] for k in ('competitions', 'categories', 'rounds', 'boulders', 'profiles', 'profile_private',
                         'registrations', 'round_starters', 'boulder_results', 'lead_results')}
    seen_profiles = set()
    for comp in comps:
        comp_id = uid('competition', comp['id'])
        t['competitions'].append({'id': comp_id, 'name': comp['title'], 'name_he': comp['title'],
                                  'starts_on': comp['date'], 'ends_on': comp['date'], 'status': 'finished'})
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
                                    'scoring': 'lead' if cat['discipline'] == 'lead' else 'ifsc2025'})
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
                                                'prev_place': prev_rank.get(pid)})
                    if c['rank'] is not None:
                        ranks[pid] = c['rank']
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
        'competitions': 'id, name, name_he, starts_on, ends_on, status',
        'categories': 'id, competition_id, name, name_he, gender',
        'rounds': 'id, category_id, kind, status, scoring',
        'boulders': 'id, round_id, number',
        'profiles': 'id, full_name, full_name_he, club, gender',
        'profile_private': 'id, birth_date',
        'registrations': 'category_id, climber_id',
        'round_starters': 'round_id, climber_id, start_order, prev_place',
        'boulder_results': 'boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt',
        'lead_results': 'boulder_id, climber_id, round_id, hold, plus, top, time_ms',
    }
    conflict = {'profiles': ' on conflict (id) do nothing', 'profile_private': ' on conflict (id) do nothing',
                'round_starters': ' on conflict (round_id, climber_id) do update set start_order = excluded.start_order, prev_place = excluded.prev_place'}
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
    comps = [parse_competition(archive, *spec.split(':')) for spec in args[1:]]
    if check:
        ranks = [{'round_id': uid('round', cat['id'], rnd['kind']), 'climber_id': uid('climber', c['name'], c['dob']), 'rank': c['rank']}
                 for comp in comps for cat in comp['categories'] for rnd in cat['rounds'] for c in rnd['climbers']]
        print(json.dumps(ranks))
    else:
        sys.stdout.write(sql(comps))


if __name__ == '__main__':
    main()
