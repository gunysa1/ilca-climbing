#!/usr/bin/env python3
"""Mirror the round currently running in the temporary ILCA scoring app into this app (read-only on
the temporary app's side).

The temporary app (ilca-boulder-score.netlify.app, Firebase RTDB) keeps one round at a time: a roster
with bibs, age categories, combined groups ("בוגרים" = בוגרים + U21 + U19) and each climber's
previous-round place, and per-boulder results keyed "bib|category|gender|route". This prints one SQL
transaction that upserts the competition, one category per group, the round (kind given on the command
line), its start list with seeds, boulders and results. Results upsert only when changed, so the audit log
records real changes only. Re-run it to sync; ids are uuid5, so nothing is duplicated.

Usage: mirror.py EVENT_JSON --competition-key KEY --name NAME --starts YYYY-MM-DD --ends YYYY-MM-DD
                 --series SERIES --kind semifinal [--status live|closed] > sync.sql
"""
import argparse
import json
import re
import uuid
from urllib.parse import unquote

NS = uuid.UUID('6b7f4a52-2c1e-4f4e-9a3b-1c0de1ca0002')  # temporary-app mirror namespace


def uid(*parts: object) -> str:
    return str(uuid.uuid5(NS, ':'.join(str(p) for p in parts)))


def season_of(date: str) -> str:
    y, m = int(date[:4]), int(date[5:7])
    start = y if m >= 9 else y - 1
    return f'{start}-{(start + 1) % 100:02d}'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('event')
    ap.add_argument('--competition-key', required=True)
    ap.add_argument('--name', required=True)
    ap.add_argument('--starts', required=True)
    ap.add_argument('--ends', required=True)
    ap.add_argument('--series', default='other')
    ap.add_argument('--kind', required=True, choices=['qualification', 'semifinal', 'final'])
    ap.add_argument('--status', default='live', choices=['live', 'closed'])
    a = ap.parse_args()

    ev = json.load(open(a.event, encoding='utf-8'))
    config = ev.get('config') or {}
    group_of = {c: g for g, cs in (config.get('categoryGroups') or {}).items() for c in cs}
    comp_id = uid('competition', a.competition_key)

    # Which groups have results this round (the roster also lists groups that already finished).
    keys = [unquote(k).split('|') for k in (ev.get('results') or {})]
    active = {group_of.get(k[1], k[1]) for k in keys}
    roster = [r for r in ev.get('roster') or [] if group_of.get(r['category'], r['category']) in active]

    def gender(g: str) -> str:
        return 'female' if re.search(r'בוגרות|בנות|נשים', g) else 'male'

    groups = sorted({group_of.get(r['category'], r['category']) for r in roster})
    cats = [{'id': uid('category', a.competition_key, g), 'competition_id': comp_id, 'name': g, 'name_he': g, 'gender': gender(g)}
            for g in groups]
    rounds = [{'id': uid('round', a.competition_key, g, a.kind), 'category_id': uid('category', a.competition_key, g),
               'kind': a.kind, 'status': a.status, 'scoring': 'ifsc2025'} for g in groups]
    n_routes = max([int(k[3]) for k in keys if k[3].isdigit()] + [int(config.get('routeCount') or 0)])
    boulders = [{'id': uid('boulder', r['id'], n), 'round_id': r['id'], 'number': n} for r in rounds for n in range(1, n_routes + 1)]

    climbers = []
    for r in roster:
        g = group_of.get(r['category'], r['category'])
        climbers.append({
            'key': f"{r['bib']}|{r['category']}|{r['gender']}", 'name': r['name'].strip(), 'club': (r.get('club') or '').strip() or None,
            'gender': 'female' if r['gender'] == 'W' else 'male', 'bib': int(r['bib']) if str(r['bib']).isdigit() else None,
            'age_class': r['category'], 'category_id': uid('category', a.competition_key, g),
            'round_id': uid('round', a.competition_key, g, a.kind), 'start_order': r.get('startingOrder'),
            'prev_place': r.get('previousPlace') or None, 'new_id': uid('climber', r['name'].strip(), r.get('club') or ''),
        })
    by_key = {c['key']: c for c in climbers}

    results = []
    for raw, rec in (ev.get('results') or {}).items():
        bib, cat, gen, route = unquote(raw).split('|')
        c = by_key.get(f'{bib}|{cat}|{gen}')
        if not c or not route.isdigit():
            continue
        attempts = int(rec.get('attempts') or 0)
        top = rec.get('topAttempts') or None
        zone = rec.get('zoneAttempts') or top or None  # a top implies the zone
        if top and zone and zone > top:
            zone = top
        attempts = max(attempts, top or 0, zone or 0)
        results.append({'key': c['key'], 'boulder_id': uid('boulder', c['round_id'], int(route)), 'round_id': c['round_id'],
                        'attempts': attempts, 'zone_attempt': zone, 'top_attempt': top})

    payload = json.dumps({'cats': cats, 'rounds': rounds, 'boulders': boulders, 'climbers': climbers, 'results': results},
                         ensure_ascii=False)
    assert '$m$' not in payload
    q = lambda s: "'" + s.replace("'", "''") + "'"
    print(f"""-- Generated by tools/tempapp/mirror.py: mirror of the temporary scoring app's current round.
begin;
create temp table _m on commit drop as select $m${payload}$m$::jsonb as d;
insert into public.competitions (id, name, name_he, starts_on, ends_on, status, season, series)
values ({q(comp_id)}, {q(a.name)}, {q(a.name)}, {q(a.starts)}, {q(a.ends)}, 'published', {q(season_of(a.starts))}, {q(a.series)})
on conflict (id) do update set name = excluded.name, name_he = excluded.name_he, starts_on = excluded.starts_on,
  ends_on = excluded.ends_on, season = excluded.season, series = excluded.series;
insert into public.categories (id, competition_id, name, name_he, gender)
select x.id, x.competition_id, x.name, x.name_he, x.gender::public.gender
from _m, jsonb_to_recordset(d->'cats') x(id uuid, competition_id uuid, name text, name_he text, gender text)
on conflict (id) do nothing;
insert into public.rounds (id, category_id, kind, status, scoring)
select x.id, x.category_id, x.kind::public.round_kind, x.status::public.round_status, x.scoring::public.scoring_format
from _m, jsonb_to_recordset(d->'rounds') x(id uuid, category_id uuid, kind text, status text, scoring text)
on conflict (id) do update set status = excluded.status;
insert into public.boulders (id, round_id, number)
select x.id, x.round_id, x.number from _m, jsonb_to_recordset(d->'boulders') x(id uuid, round_id uuid, number int)
on conflict (id) do nothing;

create temp table _c on commit drop as
select x.*, coalesce(
  (select p.id from public.profiles p where p.full_name = x.name
   order by (p.club is not distinct from x.club) desc, p.id limit 1),
  -- the temporary app sometimes adds a middle name ("משב אלי קוראין" = "משב קוראין"): same first and last name, if unique
  (select min(p.id::text)::uuid from public.profiles p
   where split_part(p.full_name, ' ', 1) = split_part(x.name, ' ', 1)
     and reverse(split_part(reverse(p.full_name), ' ', 1)) = reverse(split_part(reverse(x.name), ' ', 1))
   having count(*) = 1),
  x.new_id) as climber_id
from _m, jsonb_to_recordset(d->'climbers') x(key text, name text, club text, gender text, bib int, age_class text,
  category_id uuid, round_id uuid, start_order int, prev_place int, new_id uuid);
insert into public.profiles (id, full_name, full_name_he, club, gender)
select climber_id, name, name, club, gender::public.gender from _c on conflict (id) do nothing;
insert into public.profile_private (id) select climber_id from _c on conflict (id) do nothing;
insert into public.registrations (category_id, climber_id, bib, age_class)
select category_id, climber_id, bib, age_class from _c
on conflict (category_id, climber_id) do update set bib = excluded.bib, age_class = excluded.age_class;
insert into public.round_starters (round_id, climber_id, start_order, prev_place)
select round_id, climber_id, start_order, prev_place from _c
on conflict (round_id, climber_id) do update set start_order = excluded.start_order, prev_place = excluded.prev_place;

insert into public.boulder_results (boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt)
select x.boulder_id, c.climber_id, x.round_id, x.attempts, x.zone_attempt, x.top_attempt
from _m, jsonb_to_recordset(d->'results') x(key text, boulder_id uuid, round_id uuid, attempts int, zone_attempt int, top_attempt int)
join _c c on c.key = x.key
on conflict (boulder_id, climber_id) do update set attempts = excluded.attempts, zone_attempt = excluded.zone_attempt,
  top_attempt = excluded.top_attempt
where (boulder_results.attempts, boulder_results.zone_attempt, boulder_results.top_attempt)
  is distinct from (excluded.attempts, excluded.zone_attempt, excluded.top_attempt);
select (select count(*) from _c) as climbers, (select count(*) from _m, jsonb_array_elements(d->'results')) as results;
commit;""")


if __name__ == '__main__':
    main()
