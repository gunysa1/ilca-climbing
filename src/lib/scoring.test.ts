import { describe, expect, it } from 'vitest';
import { applyAction, boulderPoints, EMPTY_RESULT, rank, totals } from './scoring';

describe('boulderPoints (IFSC 2025)', () => {
  it('scores flash top, late top, zone and nothing', () => {
    expect(boulderPoints({ zone_attempt: 1, top_attempt: 1 })).toBe(25);
    expect(boulderPoints({ zone_attempt: 1, top_attempt: 3 })).toBe(24.8); // same case as rls_test.sql
    expect(boulderPoints({ zone_attempt: 2, top_attempt: null })).toBe(9.9);
    expect(boulderPoints({ zone_attempt: null, top_attempt: null })).toBe(0);
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

  it('classic format uses tops, zones, then attempts', () => {
    expect(rank([b, c, a], 'classic').map((r) => r.climber_id)).toEqual(['a', 'b', 'c']);
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
