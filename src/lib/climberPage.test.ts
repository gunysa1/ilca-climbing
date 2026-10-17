import { describe, expect, it } from 'vitest';
import { climberIdFromPath, oneShotPrefetch, toClimberPage } from './climberPage';
import type { HistoryEntry } from './types';

describe('climberIdFromPath', () => {
  it('reads the id of a climber page path only', () => {
    expect(climberIdFromPath('/climber/0c4df775-90d0-55d0-84c5-03764cf89101')).toBe('0c4df775-90d0-55d0-84c5-03764cf89101');
    expect(climberIdFromPath('/climber/abc/')).toBe('abc');
    expect(climberIdFromPath('/climber/')).toBeNull();
    expect(climberIdFromPath('/rankings')).toBeNull();
    expect(climberIdFromPath('/round/abc')).toBeNull();
  });
});

describe('oneShotPrefetch', () => {
  it('the first get takes the prefetched request; later gets load again', async () => {
    const calls: string[] = [];
    let now = 0;
    const p = oneShotPrefetch((id: string) => { calls.push(id); return Promise.resolve(`${id}#${calls.length}`); }, 10_000, () => now);
    p.prefetch('a');
    expect(calls).toEqual(['a']);
    expect(await p.get('a')).toBe('a#1');
    expect(calls).toEqual(['a']);
    expect(await p.get('a')).toBe('a#2');  // taken: a later visit loads fresh data
    expect(await p.get('b')).toBe('b#3');  // another climber: never the prefetched one
  });

  it('a prefetch older than maxAge is not used', async () => {
    let now = 0;
    let n = 0;
    const p = oneShotPrefetch((id: string) => Promise.resolve(`${id}#${++n}`), 10_000, () => now);
    p.prefetch('a');
    now = 10_001;
    expect(await p.get('a')).toBe('a#2');
  });
});

describe('toClimberPage', () => {
  const entry = (o: Partial<HistoryEntry>): HistoryEntry => ({
    round_id: 'r', competition_id: 'c1', competition: 'Cup', competition_he: null, starts_on: '2026-01-10',
    category: 'Women', category_he: null, round: 'qualification', round_status: 'closed', discipline: 'ifsc2025',
    rank: 1, starters: 20, ...o,
  });
  it('drops planned rounds and marks the competitions that count for the rankings', () => {
    const page = toClimberPage({
      profile: { id: 'p', full_name: 'Noa', full_name_he: null, club: null, country: 'ISR' },
      history: [entry({ round_id: 'q' }), entry({ round_id: 'f', round: 'final', round_status: 'planned' })],
      competitions: [
        { id: 'c1', season: '2025-26', series: 'premier_league' },
        { id: 'c2', season: '2025-26', series: 'other' },
        { id: 'c3', season: '2021-22', series: 'premier_league' },
        { id: 'c4', season: null, series: 'premier_league' },
      ],
    });
    expect(page.profile?.full_name).toBe('Noa');
    expect(page.history.map((h) => h.round_id)).toEqual(['q']);
    expect([...page.ranked]).toEqual([['c1', true], ['c2', false], ['c3', false], ['c4', false]]);
  });
  it('no data: no profile, no history', () => {
    const page = toClimberPage(null);
    expect([page.profile, page.history, page.ranked.size]).toEqual([null, [], 0]);
  });
});
