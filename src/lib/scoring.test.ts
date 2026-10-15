import { describe, expect, it } from 'vitest';
import { applyAction, boulderPoints, EMPTY_RESULT, rank, standings, totals } from './scoring';

describe('boulderPoints (IFSC 2025)', () => {
  it('scores flash top, late top, zone and nothing', () => {
    expect(boulderPoints({ zone_attempt: 1, top_attempt: 1 })).toBe(25);
    expect(boulderPoints({ zone_attempt: 1, top_attempt: 3 })).toBe(24.8); // same case as rls_test.sql
    expect(boulderPoints({ zone_attempt: 2, top_attempt: null })).toBe(9.9);
    expect(boulderPoints({ zone_attempt: null, top_attempt: null })).toBe(0);
  });

  it('matches official IFSC 2026 results (Innsbruck boulder final)', () => {
    expect(boulderPoints({ zone_attempt: 8, top_attempt: 11 })).toBe(24);
    expect(boulderPoints({ zone_attempt: 4, top_attempt: null })).toBe(9.7);
    expect(boulderPoints({ zone_attempt: 12, top_attempt: null })).toBe(8.9);
  });

  it('never goes below zero', () => {
    expect(boulderPoints({ zone_attempt: 150, top_attempt: null })).toBe(0);
    expect(boulderPoints({ zone_attempt: 1, top_attempt: 300 })).toBe(0);
  });
});

describe('totals', () => {
  it('sums without floating point drift', () => {
    const t = totals('a', [
      { attempts: 3, zone_attempt: 1, top_attempt: 3 },
      { attempts: 2, zone_attempt: 2, top_attempt: null },
      { attempts: 7, zone_attempt: 7, top_attempt: null },
    ]);
    expect(t).toMatchObject({ tops: 1, zones: 3, top_attempts: 3, zone_attempts: 10, points: 24.8 + 9.9 + 9.4 });
    expect(t.points).toBe(44.1);
  });
});

describe('rank', () => {
  const a = { climber_id: 'a', tops: 2, zones: 2, top_attempts: 2, zone_attempts: 2, points: 50 };
  const b = { climber_id: 'b', tops: 2, zones: 2, top_attempts: 4, zone_attempts: 2, points: 49.8 };
  const c = { climber_id: 'c', tops: 1, zones: 3, top_attempts: 1, zone_attempts: 3, points: 45 };
  const d = { ...c, climber_id: 'd' };

  it('ranks by points with shared ranks for ties', () => {
    expect(rank([c, b, d, a], 'ifsc2025').map((r) => [r.climber_id, r.rank])).toEqual([
      ['a', 1], ['b', 2], ['c', 3], ['d', 3],
    ]);
  });

  it('breaks equal points by previous-round rank (countback)', () => {
    // Innsbruck 2026 boulder final: 59.3 each, 2nd vs 5th in the semi-final.
    const kawamata = { ...c, climber_id: 'kawamata', points: 59.3, prev_rank: 2 };
    const lee = { ...c, climber_id: 'lee', points: 59.3, prev_rank: 5 };
    expect(rank([lee, kawamata], 'ifsc2025').map((r) => [r.climber_id, r.rank])).toEqual([
      ['kawamata', 1], ['lee', 2],
    ]);
  });

  it('then fewer top attempts, then fewer zone attempts', () => {
    const e = { climber_id: 'e', tops: 1, zones: 2, top_attempts: 3, zone_attempts: 4, points: 34.7 };
    const f = { ...e, climber_id: 'f', top_attempts: 2, zone_attempts: 5 };
    const g = { ...e, climber_id: 'g', zone_attempts: 3 };
    expect(rank([e, g, f], 'ifsc2025').map((r) => [r.climber_id, r.rank])).toEqual([
      ['f', 1], ['g', 2], ['e', 3],
    ]);
  });

  it('a climber without a previous-round rank sorts after one with it', () => {
    const p = { ...c, climber_id: 'p', prev_rank: 9 };
    const q = { ...c, climber_id: 'q', prev_rank: null };
    expect(rank([q, p], 'ifsc2025').map((r) => r.climber_id)).toEqual(['p', 'q']);
  });

  it('classic format uses tops, zones, then attempts', () => {
    expect(rank([b, c, a], 'classic').map((r) => r.climber_id)).toEqual(['a', 'b', 'c']);
  });

  it('classic: countback breaks a full tie only in a final (LogLig 2024-25 youth championship)', () => {
    const t = (climber_id: string, prev_rank: number) =>
      ({ climber_id, tops: 1, zones: 2, top_attempts: 3, zone_attempts: 5, points: 0, prev_rank });
    expect(rank([t('x', 4), t('y', 2)], 'classic', true).map((r) => [r.climber_id, r.rank])).toEqual([['y', 1], ['x', 2]]);
    expect(rank([t('x', 4), t('y', 2)], 'classic').map((r) => r.rank)).toEqual([1, 1]);
  });
});

describe('applyAction (judge pad)', () => {
  it('records attempts, zone and top on the current attempt', () => {
    let r = EMPTY_RESULT;
    r = applyAction(r, 'attempt');
    r = applyAction(r, 'attempt');
    r = applyAction(r, 'zone');
    expect(r).toEqual({ attempts: 2, zone_attempt: 2, top_attempt: null });
    r = applyAction(r, 'attempt');
    r = applyAction(r, 'top');
    expect(r).toEqual({ attempts: 3, zone_attempt: 2, top_attempt: 3 });
  });

  it('top without prior zone implies zone on the same attempt', () => {
    expect(applyAction(EMPTY_RESULT, 'top')).toEqual({ attempts: 1, zone_attempt: 1, top_attempt: 1 });
  });

  it('ignores input after a top', () => {
    const topped = { attempts: 1, zone_attempt: 1, top_attempt: 1 };
    expect(applyAction(topped, 'attempt')).toBe(topped);
  });
});

describe('standings', () => {
  const row = (id: string, points: number) => ({ climber_id: id, tops: 0, zones: 0, top_attempts: 0, zone_attempts: 0, points });
  it('climbers without any attempt get no rank and follow the ranked ones in start order', () => {
    const out = standings([row('a', 0), row('b', 10), row('c', 0), row('d', 0)], 'ifsc2025', new Set(['b', 'c']));
    expect(out.map((r) => [r.climber_id, r.rank])).toEqual([['b', 1], ['c', 2], ['a', null], ['d', null]]);
  });
  it('nobody climbed yet: nobody is ranked', () => {
    expect(standings([row('a', 0), row('b', 0)], 'ifsc2025', new Set()).every((r) => r.rank === null)).toBe(true);
  });
});
