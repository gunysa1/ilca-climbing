import { describe, expect, it } from 'vitest';
import { dwellMs, nextRoundId, screenRounds } from './bigScreen';

const cat = (id: string, rounds: [string, 'qualification' | 'semifinal' | 'final', 'planned' | 'live' | 'closed'][]) => ({
  id, name: id, name_he: null, rounds: rounds.map(([rid, kind, status]) => ({ id: rid, kind, status })),
});

describe('big screen', () => {
  it('shows only live rounds when some are live', () => {
    const r = screenRounds([cat('men', [['m-q', 'qualification', 'closed'], ['m-f', 'final', 'live']]), cat('women', [['w-q', 'qualification', 'live']]), cat('u', [['u-q', 'qualification', 'closed']])]);
    expect(r.map((x) => x.round_id)).toEqual(['m-f', 'w-q']);
    expect(r.every((x) => x.live)).toBe(true);
  });

  it('with nothing live shows each category\'s latest finished round', () => {
    const r = screenRounds([cat('men', [['m-q', 'qualification', 'closed'], ['m-s', 'semifinal', 'closed'], ['m-f', 'final', 'planned']]), cat('women', [['w-q', 'qualification', 'planned']])]);
    expect(r.map((x) => x.round_id)).toEqual(['m-s']);
    expect(r[0].live).toBe(false);
  });

  it('nothing at all gives an empty list', () => {
    expect(screenRounds([])).toEqual([]);
    expect(screenRounds([cat('a', [['a-q', 'qualification', 'planned']])])).toEqual([]);
  });

  it('rotates in order, wraps, and recovers when the current round left the list', () => {
    const rounds = screenRounds([cat('a', [['a1', 'qualification', 'live']]), cat('b', [['b1', 'qualification', 'live']]), cat('c', [['c1', 'qualification', 'live']])]);
    expect(nextRoundId(rounds, 'a1')).toBe('b1');
    expect(nextRoundId(rounds, 'c1')).toBe('a1');
    expect(nextRoundId(rounds, 'gone')).toBe('a1');
    expect(nextRoundId(rounds, null)).toBe('a1');
    expect(nextRoundId([], 'a1')).toBeNull();
  });

  it('stays 20 s, longer when the list scrolls', () => {
    expect(dwellMs(0)).toBe(20000);
    expect(dwellMs(-5)).toBe(20000);
    expect(dwellMs(200)).toBe(20000); // 6 s pauses + 5 s scrolling
    expect(dwellMs(2000)).toBe(6000 + 50000);
  });
});
