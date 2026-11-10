import { describe, expect, it } from 'vitest';
import { resultKey, type LeadRow, type ResultRow, type Starter } from './roundData';
import { groupName, inGroup, mixedGroups, NO_GROUP, roundGroups, roundRows } from './roundRows';
import type { Round } from './types';

const starter = (id: string, order: number, prev: number | null): Starter => ({
  climber_id: id, bib: order, age_class: null, start_order: order, prev_place: prev, group_label: null,
  profile: { id, full_name: id, full_name_he: null, club: null, country: 'ISR' },
});
const lead = (climber: string, hold: number, time_ms: number | null): LeadRow =>
  ({ boulder_id: 'r1', climber_id: climber, hold, plus: true, top: false, time_ms });
const results = (rows: LeadRow[]) => new Map(rows.map((r) => [resultKey(r.boulder_id, r.climber_id), r]));
const round = (kind: Round['kind'], time_tiebreak?: boolean): Round => ({ id: 'f', category_id: 'c', kind, status: 'live', scoring: 'lead', time_tiebreak });

describe('round rows: lead', () => {
  // Same height, same seed (the lead.test.ts / rls_test.sql case): the faster time ranks higher in a final.
  const starters = [starter('a', 1, 3), starter('b', 2, 3)];
  const rows = results([lead('a', 35, 188_000), lead('b', 35, 130_000)]);
  const boulders = [{ id: 'r1', round_id: 'f', number: 1 }];

  it('final: the time breaks the tie and is shown as the score', () => {
    expect(roundRows(round('final'), starters, boulders, new Map(), rows, new Map()))
      .toEqual([{ climber_id: 'b', rank: 1, score: '2:10', status: null }, { climber_id: 'a', rank: 2, score: '3:08', status: null }]);
  });

  it('semifinal, or a final without the time tie-break: the tie stands and no time is shown', () => {
    for (const r of [round('semifinal'), round('final', false)]) {
      expect(roundRows(r, starters, boulders, new Map(), rows, new Map()).map((x) => [x.climber_id, x.rank, x.score]))
        .toEqual([['a', 1, ''], ['b', 1, '']]);
    }
  });
});

// DNS / DSQ: the cases of supabase/tests/rls_test.sql (DNS / DSQ, migration 049).
describe('round rows: DNS / DSQ', () => {
  const st = (id: string, order: number, status: Starter['status'], group: string | null = null): Starter =>
    ({ ...starter(id, order, null), status, group_label: group });
  const rd = (scoring: Round['scoring'], kind: Round['kind'] = 'qualification'): Round => ({ id: 'q', category_id: 'c', kind, status: 'live', scoring });
  const bres = (boulder: string, climber: string, attempts: number, zone: number | null, top: number | null): [string, ResultRow] =>
    [resultKey(boulder, climber), { boulder_id: boulder, climber_id: climber, attempts, zone_attempt: zone, top_attempt: top }];
  const show = (rows: ReturnType<typeof roundRows>) => rows.map((r) => `${r.climber_id}${r.rank ?? '-'}`);

  it('ifsc: DNS and DSQ are unranked even with results, the others rank as if they were absent', () => {
    const boulders = [{ id: 'b1', round_id: 'q', number: 1 }];
    const results = new Map([bres('b1', 'a', 1, 1, 1), bres('b1', 'c', 2, 1, 2), bres('b1', 'b', 2, 1, null), bres('b1', 'd', 3, 2, null)]);
    const all = [st('a', 1, null), st('b', 2, null), st('c', 3, null), st('d', 4, null)];
    expect(show(roundRows(rd('ifsc2025'), all, boulders, results, new Map(), new Map()))).toEqual(['a1', 'c2', 'b3', 'd4']);
    const marked = [st('a', 1, null), st('b', 2, null), st('c', 3, 'dsq'), st('d', 4, 'dns')];
    const rows = roundRows(rd('ifsc2025'), marked, boulders, results, new Map(), new Map());
    expect(show(rows)).toEqual(['a1', 'b2', 'd-', 'c-']); // DNS before DSQ
    expect(rows.map((r) => r.status)).toEqual([null, null, 'dns', 'dsq']);
  });

  it('they sort after the unranked, DNS before DSQ, each by start order', () => {
    const boulders = [{ id: 'b1', round_id: 'q', number: 1 }];
    const results = new Map([bres('b1', 'a', 1, 1, 1)]);
    const rows = roundRows(rd('ifsc2025'), [st('a', 1, null), st('x', 2, 'dsq'), st('y', 3, null), st('z', 4, 'dns'), st('w', 5, 'dns')],
      boulders, results, new Map(), new Map());
    expect(show(rows)).toEqual(['a1', 'y-', 'z-', 'w-', 'x-']);
  });

  it('classic with groups: DNS unranked, the group ranks as if the climber were absent', () => {
    const boulders = [{ id: 'b1', round_id: 'q', number: 1 }];
    const results = new Map([bres('b1', 'a', 1, 1, 1), bres('b1', 'b', 2, 1, null), bres('b1', 'c', 1, 1, 1), bres('b1', 'd', 2, 1, null)]);
    const all = [st('a', 1, null, 'A'), st('b', 2, null, 'A'), st('c', 3, null, 'B'), st('d', 4, 'dns', 'B')];
    const g = (label: string) => show(roundRows(rd('classic'), all.filter((s) => s.group_label === label), boulders, results, new Map(), new Map()));
    expect([...g('A'), ...g('B')]).toEqual(['a1', 'b2', 'c1', 'd-']);
  });

  it('classic with groups and a starter without one: that starter ranks alone, as "No group" (rls_test.sql case)', () => {
    const boulders = [{ id: 'b1', round_id: 'q', number: 1 }];
    const results = new Map([bres('b1', 'a', 1, 1, 1), bres('b1', 'b', 2, 1, null), bres('b1', 'c', 1, 1, 1), bres('b1', 'd', 2, 1, null)]);
    const all = [st('a', 1, null, 'A'), st('b', 2, null, null), st('c', 3, null, 'B'), st('d', 4, 'dns', 'B')];
    const groups = roundGroups(all);
    expect(groups).toEqual(['A', 'B', NO_GROUP]);
    expect(groups.flatMap((g) => show(roundRows(rd('classic'), all.filter((s) => inGroup(s, g)), boulders, results, new Map(), new Map()))))
      .toEqual(['a1', 'c1', 'd-', 'b1']);
  });

  it('lead, two routes: route points are computed without the DNS climber (d would have been first on both)', () => {
    const boulders = [{ id: 'r1', round_id: 'q', number: 1 }, { id: 'r2', round_id: 'q', number: 2 }];
    const l = (route: string, climber: string, hold: number): LeadRow => ({ boulder_id: route, climber_id: climber, hold, plus: false, top: false, time_ms: null });
    const rows = [l('r1', 'a', 40), l('r1', 'b', 30), l('r1', 'c', 20), l('r1', 'd', 45), l('r2', 'a', 30), l('r2', 'b', 20), l('r2', 'c', 10), l('r2', 'd', 45)];
    const out = roundRows(rd('lead'), [st('a', 1, null), st('b', 2, null), st('c', 3, null), st('d', 4, 'dns')], boulders, new Map(), results(rows), new Map());
    expect(out.map((r) => `${r.climber_id}${r.rank ?? '-'}:${r.score}`)).toEqual(['a1:1.00', 'b2:2.00', 'c3:3.00', 'd-:–']);
  });

  it('lead, one-route final: a DSQ climber is unranked, the others rank as if absent', () => {
    const boulders = [{ id: 'r1', round_id: 'q', number: 1 }];
    const rows = [lead('a', 20, null), lead('b', 25, null), lead('c', 30, null)];
    const fin = (c: Starter['status']) => show(roundRows(round('final'), [st('a', 1, null), st('b', 2, null), st('c', 3, c)], boulders, new Map(), results(rows), new Map()));
    expect(fin(null)).toEqual(['c1', 'b2', 'a3']);
    expect(fin('dsq')).toEqual(['b1', 'a2', 'c-']);
  });
});

describe('round groups', () => {
  const g = (id: string, label: string | null): Starter => ({ ...starter(id, 1, null), group_label: label });
  it('no groups: one list; all in groups: the named ones sorted; some without: "No group" last', () => {
    expect(roundGroups([g('a', null), g('b', null)])).toEqual([]);
    expect(roundGroups([g('a', 'B'), g('b', 'A')])).toEqual(['A', 'B']);
    expect(roundGroups([g('a', null), g('b', 'B'), g('c', 'A')])).toEqual(['A', 'B', NO_GROUP]);
  });
  it('mixedGroups only when some have a group and some do not', () => {
    expect(mixedGroups([g('a', null)])).toBe(false);
    expect(mixedGroups([g('a', 'A')])).toBe(false);
    expect(mixedGroups([g('a', 'A'), g('b', null)])).toBe(true);
  });
  it('names: "Group A" and "No group"', () => {
    const t = (k: 'group' | 'noGroup') => (k === 'group' ? 'Group' : 'No group');
    expect(groupName('A', t)).toBe('Group A');
    expect(groupName(NO_GROUP, t)).toBe('No group');
  });
});
