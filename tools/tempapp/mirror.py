#!/usr/bin/env python3
"""Mirror the round currently running in the temporary ILCA scoring app into this app (read-only on
the temporary app's side).

The temporary app (ilca-boulder-score.netlify.app, Firebase RTDB) keeps one round at a time: a roster
with bibs, age categories, combined groups ("בוגרים" = בוגרים + U21 + U19) and each climber's
previous-round place, and per-boulder results keyed "bib|category|gender|route". This prints one SQL
transaction that upserts the competition, one category per group, the round (kind given on the command
line), its start list with seeds, boulders and results. Results upsert only when changed, so the audit log
records real changes only. Re-run it to sync; ids are uuid5, so nothing is duplicated.

Lead events (config.discipline "lead") go to lead_results (hold, plus, top; time only in finals).

Usage: mirror.py EVENT_JSON --competition-key KEY --name NAME --starts YYYY-MM-DD --ends YYYY-MM-DD
                 --series SERIES --kind semifinal [--status live|closed] [--groups G1,G2] > sync.sql
       mirror.py EVENT_JSON --competition-id UUID --kind qualification ...   (a competition set up in the admin)
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
    ap.add_argument('--competition-key', help='new competition: its key (ids are derived from it)')
    ap.add_argument('--competition-id', help='an existing competition: categories, rounds and routes are matched by name, kind, number')
    ap.add_argument('--name')
    ap.add_argument('--starts')
    ap.add_argument('--ends')
    ap.add_argument('--series', default='other')
    ap.add_argument('--kind', required=True, choices=['qualification', 'semifinal', 'final'])
    ap.add_argument('--status', default='live', choices=['live', 'closed'])
    ap.add_argument('--groups', help='only these groups (comma separated)')
    a = ap.parse_args()
    if not (a.competition_id or (a.competition_key and a.name and a.starts and a.ends)):
        ap.error('give --competition-id, or --competition-key with --name, --starts and --ends')

    ev = json.load(open(a.event, encoding='utf-8'))
    config = ev.get('config') or {}
    lead = config.get('discipline') == 'lead'
    scoring = 'lead' if lead else 'ifsc2025'
    group_of = {c: g for g, cs in (config.get('categoryGroups') or {}).items() for c in cs}
    key = a.competition_id or a.competition_key
    comp_id = a.competition_id or uid('competition', key)

    # Which groups have results this round (the roster also lists groups that already finished).
    keys = [unquote(k).split('|') for k in (ev.get('results') or {})]
    active = {group_of.get(k[1], k[1]) for k in keys}
    if a.groups:
        active &= set(a.groups.split(','))
    roster = [r for r in ev.get('roster') or [] if group_of.get(r['category'], r['category']) in active]

    def gender(g: str) -> str:
        return 'female' if re.search(r'בוגרות|בנות|נערות|נשים', g) else 'male'

    groups = sorted({group_of.get(r['category'], r['category']) for r in roster})
    def english(g: str) -> str:
        age = re.search(r'U\d+', g)
        if age:
            return f"{age.group(0)} {'girls' if gender(g) == 'female' else 'boys'}"
        return 'Senior women' if gender(g) == 'female' else 'Senior men' if re.search(r'בוגרי|גברים', g) else g

    cats = [{'id': uid('category', key, g), 'name': english(g), 'name_he': g, 'gender': gender(g)} for g in groups]
    rounds = [{'id': uid('round', key, g, a.kind), 'grp': g} for g in groups]
    route_counts = config.get('categoryRouteCounts') or {}
    boulders = []
    for g in groups:
        n_routes = max([int(k[3]) for k in keys if k[3].isdigit() and group_of.get(k[1], k[1]) == g]
                       + [int(route_counts.get(g) or config.get('routeCount') or 0)])
        boulders += [{'id': uid('boulder', uid('round', key, g, a.kind), n), 'grp': g, 'number': n} for n in range(1, n_routes + 1)]

    climbers = []
    for r in roster:
        climbers.append({
            'key': f"{r['bib']}|{r['category']}|{r['gender']}", 'name': r['name'].strip(), 'club': (r.get('club') or '').strip() or None,
            'gender': 'female' if r['gender'] == 'W' else 'male', 'bib': int(r['bib']) if str(r['bib']).isdigit() else None,
            'age_class': r['category'], 'grp': group_of.get(r['category'], r['category']), 'start_order': r.get('startingOrder'),
            'prev_place': r.get('previousPlace') or None, 'new_id': uid('climber', r['name'].strip(), r.get('club') or ''),
        })
    by_key = {c['key']: c for c in climbers}
    # did not start: on the start list, unranked (the temporary app can hold an empty placeholder result for them)
    dns = {f"{r['bib']}|{r['category']}|{r['gender']}" for r in roster if r.get('liveFlag') == 'DNS'}

    results = []
    for raw, rec in (ev.get('results') or {}).items():
        bib, cat, gen, route = unquote(raw).split('|')
        c = by_key.get(f'{bib}|{cat}|{gen}')
        if not c or not route.isdigit() or c['key'] in dns:
            continue
        if lead:
            top = bool(rec.get('top'))
            # time breaks ties only in finals (and only if the temporary app uses it)
            time_ms = int(rec['timeMs']) if a.kind == 'final' and config.get('leadUseTimeTieBreak') and rec.get('timeMs') else None
            results.append({'key': c['key'], 'grp': c['grp'], 'number': int(route), 'hold': int(rec.get('hold') or 0),
                            'plus': bool(rec.get('plus')) and not top, 'top': top, 'time_ms': time_ms})
            continue
        attempts = int(rec.get('attempts') or 0)
        top = rec.get('topAttempts') or None
        zone = rec.get('zoneAttempts') or top or None  # a top implies the zone
        if top and zone and zone > top:
            zone = top
        attempts = max(attempts, top or 0, zone or 0)
        results.append({'key': c['key'], 'grp': c['grp'], 'number': int(route),
                        'attempts': attempts, 'zone_attempt': zone, 'top_attempt': top})

    payload = json.dumps({'cats': cats, 'rounds': rounds, 'boulders': boulders, 'climbers': climbers, 'results': results},
                         ensure_ascii=False)
    assert '$m$' not in payload
    q = lambda s: "'" + s.replace("'", "''") + "'"
    competition = f"""insert into public.competitions (id, name, name_he, starts_on, ends_on, status, season, series, discipline)
values ({q(comp_id)}, {q(a.name)}, {q(a.name)}, {q(a.starts)}, {q(a.ends)}, 'published', {q(season_of(a.starts))}, {q(a.series)}, {q('lead' if lead else 'boulder')})
on conflict (id) do update set name = excluded.name, name_he = excluded.name_he, starts_on = excluded.starts_on,
  ends_on = excluded.ends_on, season = excluded.season, series = excluded.series,
  discipline = coalesce(public.competitions.discipline, excluded.discipline);""" if not a.competition_id else f"""do $$ begin
  if not exists (select 1 from public.competitions where id = {q(comp_id)}) then raise exception 'no competition {comp_id}'; end if;
end $$;"""
    if lead:
        upsert = """insert into public.lead_results (boulder_id, climber_id, round_id, hold, plus, top, time_ms)
select b.id, c.climber_id, b.round_id, x.hold, x.plus, x.top, x.time_ms
from _m, jsonb_to_recordset(d->'results') x(key text, grp text, number int, hold int, plus boolean, top boolean, time_ms int)
join _c c on c.key = x.key join _b b on b.grp = x.grp and b.number = x.number
on conflict (boulder_id, climber_id) do update set hold = excluded.hold, plus = excluded.plus, top = excluded.top,
  time_ms = excluded.time_ms
where (lead_results.hold, lead_results.plus, lead_results.top, lead_results.time_ms)
  is distinct from (excluded.hold, excluded.plus, excluded.top, excluded.time_ms);"""
    else:
        upsert = """insert into public.boulder_results (boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt)
select b.id, c.climber_id, b.round_id, x.attempts, x.zone_attempt, x.top_attempt
from _m, jsonb_to_recordset(d->'results') x(key text, grp text, number int, attempts int, zone_attempt int, top_attempt int)
join _c c on c.key = x.key join _b b on b.grp = x.grp and b.number = x.number
on conflict (boulder_id, climber_id) do update set attempts = excluded.attempts, zone_attempt = excluded.zone_attempt,
  top_attempt = excluded.top_attempt
where (boulder_results.attempts, boulder_results.zone_attempt, boulder_results.top_attempt)
  is distinct from (excluded.attempts, excluded.zone_attempt, excluded.top_attempt);"""
    tiebreak = f",\n  time_tiebreak = {'true' if config.get('leadUseTimeTieBreak') else 'false'}" if lead else ''
    print(f"""-- Generated by tools/tempapp/mirror.py: mirror of the temporary scoring app's current round.
begin;
create temp table _m on commit drop as select $m${payload}$m$::jsonb as d;
{competition}
-- categories by name, rounds by kind, routes by number: new ones get the mirror's ids
insert into public.categories (id, competition_id, name, name_he, gender)
select x.id, {q(comp_id)}, x.name, x.name_he, x.gender::public.gender
from _m, jsonb_to_recordset(d->'cats') x(id uuid, name text, name_he text, gender text)
where not exists (select 1 from public.categories k where k.competition_id = {q(comp_id)} and k.name_he = x.name_he)
on conflict (id) do nothing;
create temp table _k on commit drop as
select x.name_he as grp, k.id from _m, jsonb_to_recordset(d->'cats') x(name_he text)
join public.categories k on k.competition_id = {q(comp_id)} and k.name_he = x.name_he;
insert into public.rounds (id, category_id, kind, status, scoring)
select x.id, k.id, {q(a.kind)}::public.round_kind, 'live', {q(scoring)}::public.scoring_format
from _m, jsonb_to_recordset(d->'rounds') x(id uuid, grp text) join _k k on k.grp = x.grp
on conflict (category_id, kind) do nothing;
create temp table _r on commit drop as
select k.grp, r.id, r.scoring::text as scoring from _k k join public.rounds r on r.category_id = k.id and r.kind = {q(a.kind)};
do $$ begin
  if exists (select 1 from _r where scoring <> {q(scoring)}) then raise exception 'a round is not scored {scoring}'; end if;
end $$;
insert into public.boulders (id, round_id, number)
select x.id, r.id, x.number from _m, jsonb_to_recordset(d->'boulders') x(id uuid, grp text, number int) join _r r on r.grp = x.grp
on conflict (round_id, number) do nothing;
create temp table _b on commit drop as
select r.grp, b.number, b.id, b.round_id from _r r join public.boulders b on b.round_id = r.id;

create temp table _c on commit drop as
select x.*, k.id as category_id, r.id as round_id, coalesce(
  (select p.id from public.profiles p where p.full_name = x.name
   order by (p.club is not distinct from x.club) desc, p.id limit 1),
  -- the temporary app sometimes adds a middle name ("משב אלי קוראין" = "משב קוראין"): same first and last name, if unique
  -- in the club ("הלל כרמל שפירא", מכבי טס"ה), else if unique
  (select min(p.id::text)::uuid from public.profiles p
   where split_part(p.full_name, ' ', 1) = split_part(x.name, ' ', 1)
     and reverse(split_part(reverse(p.full_name), ' ', 1)) = reverse(split_part(reverse(x.name), ' ', 1))
     and p.club is not distinct from x.club
   having count(*) = 1),
  (select min(p.id::text)::uuid from public.profiles p
   where split_part(p.full_name, ' ', 1) = split_part(x.name, ' ', 1)
     and reverse(split_part(reverse(p.full_name), ' ', 1)) = reverse(split_part(reverse(x.name), ' ', 1))
   having count(*) = 1),
  x.new_id) as climber_id
from _m, jsonb_to_recordset(d->'climbers') x(key text, name text, club text, gender text, bib int, age_class text,
  grp text, start_order int, prev_place int, new_id uuid)
join _k k on k.grp = x.grp join _r r on r.grp = x.grp;
insert into public.profiles (id, full_name, full_name_he, club, gender)
select climber_id, name, name, club, gender::public.gender from _c on conflict (id) do nothing;
insert into public.profile_private (id) select climber_id from _c on conflict (id) do nothing;
insert into public.registrations (category_id, climber_id, bib, age_class)
select category_id, climber_id, bib, age_class from _c
on conflict (category_id, climber_id) do update set bib = excluded.bib, age_class = excluded.age_class;
insert into public.round_starters (round_id, climber_id, start_order, prev_place)
select round_id, climber_id, start_order, prev_place from _c
on conflict (round_id, climber_id) do update set start_order = excluded.start_order, prev_place = excluded.prev_place;

{upsert}
update public.rounds r set status = {q(a.status)}::public.round_status{tiebreak}
from _r where r.id = _r.id;
select (select count(*) from _c) as climbers, (select count(*) from _m, jsonb_array_elements(d->'results')) as results;
commit;""")

if __name__ == '__main__':
    main()
