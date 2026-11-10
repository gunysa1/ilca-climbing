import { describe, expect, it } from 'vitest';
import { formatHeight, heightValue, leadStandings, parseHold, routeRankPoints, type LeadResult } from './lead';

const r = (climber_id: string, route: string, hold: number, plus = false, top = false, time_ms: number | null = null): LeadResult =>
  ({ climber_id, route_id: route, hold, plus, top, time_ms });

describe('heightValue / formatHeight', () => {
  it('orders top > hold+ > hold', () => {
    expect(heightValue(r('a', 'r1', 30, false, true))).toBeGreaterThan(heightValue(r('a', 'r1', 45, true)));
    expect(heightValue(r('a', 'r1', 31))).toBeGreaterThan(heightValue(r('a', 'r1', 30, true)));
    expect(heightValue(r('a', 'r1', 30, true))).toBeGreaterThan(heightValue(r('a', 'r1', 30)));
  });
  it('formats like IFSC', () => {
    expect(formatHeight(r('a', 'r1', 30, true))).toBe('30+');
    expect(formatHeight(r('a', 'r1', 30))).toBe('30');
    expect(formatHeight(r('a', 'r1', 40, false, true))).toBe('TOP');
  });
  // Half holds, as in the temporary app: + counts as 0.1 for ranking only (24+ = 24.1).
  // Same cases as supabase/tests/rls_test.sql ("lead half holds").
  it('half holds: 24.5 before 24+, before 24; 24.5+ before 24.5; a 24.1 hold ties 24+', () => {
    expect(heightValue(r('a', 'r1', 24.5))).toBeGreaterThan(heightValue(r('a', 'r1', 24, true)));
    expect(heightValue(r('a', 'r1', 24, true))).toBeGreaterThan(heightValue(r('a', 'r1', 24)));
    expect(heightValue(r('a', 'r1', 24.5, true))).toBeGreaterThan(heightValue(r('a', 'r1', 24.5)));
    expect(heightValue(r('a', 'r1', 24.1))).toBe(heightValue(r('a', 'r1', 24, true)));
    expect(heightValue(r('a', 'r1', 24, true))).toBe(24.1);
    expect(heightValue(r('a', 'r1', 24.5, true))).toBe(24.6);
    expect(heightValue(r('a', 'r1', 99.99, false, true))).toBeGreaterThan(heightValue(r('a', 'r1', 999.99, true)));
  });
  it('formats half holds without a trailing .0', () => {
    expect(formatHeight(r('a', 'r1', 24.5))).toBe('24.5');
    expect(formatHeight(r('a', 'r1', 24.5, true))).toBe('24.5+');
    expect(formatHeight(r('a', 'r1', 24, true))).toBe('24+');
    expect(formatHeight(r('a', 'r1', 24))).toBe('24');
    expect(formatHeight(r('a', 'r1', 24.25))).toBe('24.25');
  });
});

describe('parseHold', () => {
  it('takes a hold with up to two decimals, dot or comma', () => {
    expect(parseHold('24')).toBe(24);
    expect(parseHold(' 24.5 ')).toBe(24.5);
    expect(parseHold('24,5')).toBe(24.5);
    expect(parseHold('24.25')).toBe(24.25);
    expect(parseHold('0')).toBe(0);
    expect(parseHold('999.99')).toBe(999.99);
  });
  it('refuses anything else', () => {
    for (const bad of ['', ' ', '24.255', '-1', '1000', 'abc', '24.', '.5', '2 4', '1e2', '24+']) expect(parseHold(bad)).toBeUndefined();
  });
});

describe('routeRankPoints', () => {
  it('tied climbers share the average of their positions', () => {
    const pts = routeRankPoints([r('a', 'r1', 30), r('b', 'r1', 35), r('c', 'r1', 30), r('d', 'r1', 10)]);
    expect(Object.fromEntries(pts)).toEqual({ b: 1, a: 2.5, c: 2.5, d: 4 });
  });
});

describe('leadStandings', () => {
  it('single route: height, then countback, remaining ties share', () => {
    const out = leadStandings(['a', 'b', 'c', 'd'], ['r1'],
      [r('a', 'r1', 30, true), r('b', 'r1', 30, true), r('c', 'r1', 40, false, true), r('d', 'r1', 30, true)],
      new Map([['a', 5], ['b', 2]]));
    expect(out.map((s) => [s.climber_id, s.rank])).toEqual([['c', 1], ['b', 2], ['a', 3], ['d', 4]]);
  });

  it('two routes: geometric mean of route rank points (lower is better)', () => {
    // route 1: a 1st, b 2nd, c 3rd; route 2: c 1st, b 2nd, a 3rd
    const res = [r('a', 'r1', 40), r('b', 'r1', 30), r('c', 'r1', 20), r('a', 'r2', 10), r('b', 'r2', 20), r('c', 'r2', 30)];
    const out = leadStandings(['a', 'b', 'c'], ['r1', 'r2'], res, new Map());
    // a: sqrt(1*3)=1.73, b: sqrt(2*2)=2, c: sqrt(3*1)=1.73 -> a and c tie (no seeds) and share 1st
    expect(out.map((s) => [s.climber_id, s.rank, Number(s.points.toFixed(2))])).toEqual([
      ['a', 1, 1.73], ['c', 1, 1.73], ['b', 3, 2],
    ]);
  });

  it('final: after countback, the faster climbing time ranks higher (IFSC final rule)', () => {
    // LogLig Israeli lead championship 2026, men's final: both 35+, same qualification place, 02:10 vs 03:08
    const out = leadStandings(['slow', 'fast'], ['r1'],
      [r('slow', 'r1', 35, true, false, 188_000), r('fast', 'r1', 35, true, false, 130_000)],
      new Map([['slow', 3], ['fast', 3]]), true);
    expect(out.map((s) => [s.climber_id, s.rank])).toEqual([['fast', 1], ['slow', 2]]);
  });

  it('other rounds: time does not break a tie (LogLig 2024-25 semifinals)', () => {
    const out = leadStandings(['slow', 'fast'], ['r1'],
      [r('slow', 'r1', 26, false, false, 205_000), r('fast', 'r1', 26, false, false, 168_000)],
      new Map([['slow', 1], ['fast', 1]]));
    expect(out.map((s) => [s.climber_id, s.rank])).toEqual([['slow', 1], ['fast', 1]]);
  });

  it('a missing route result counts as the lowest height on that route', () => {
    const out = leadStandings(['a', 'b'], ['r1', 'r2'], [r('a', 'r1', 20), r('b', 'r1', 20), r('b', 'r2', 5)], new Map());
    expect(out.map((s) => s.climber_id)).toEqual(['b', 'a']);
  });

  it('half holds on a single route: 24.5 > 24+ = 24.1 > 24 (same case as the SQL test)', () => {
    const out = leadStandings(['a', 'b', 'c', 'd'], ['r1'],
      [r('a', 'r1', 24.5), r('b', 'r1', 24, true), r('c', 'r1', 24), r('d', 'r1', 24.1)], new Map());
    expect(out.map((s) => [s.climber_id, s.rank, s.points])).toEqual([['a', 1, 24.5], ['b', 2, 24.1], ['d', 2, 24.1], ['c', 4, 24]]);
  });

  it('half holds on two routes: rank points per route', () => {
    // route 1: a 24.5, b 24+, c 24 -> 1, 2, 3; route 2: all 10 -> 2 each
    const out = leadStandings(['a', 'b', 'c'], ['r1', 'r2'],
      [r('a', 'r1', 24.5), r('b', 'r1', 24, true), r('c', 'r1', 24), r('a', 'r2', 10), r('b', 'r2', 10), r('c', 'r2', 10)], new Map());
    expect(out.map((s) => [s.climber_id, s.rank, Number(s.points.toFixed(2))])).toEqual([['a', 1, 1.41], ['b', 2, 2], ['c', 3, 2.45]]);
  });

  it('climbers without any result are not ranked', () => {
    const out = leadStandings(['a', 'b'], ['r1'], [r('a', 'r1', 12)], new Map());
    expect(out.map((s) => [s.climber_id, s.rank])).toEqual([['a', 1], ['b', null]]);
  });
});
