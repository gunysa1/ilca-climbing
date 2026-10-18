import { describe, expect, it } from 'vitest';
import { isRankedCompetition, uncountedCategories } from './mixedCategories';

const cats = [
  { name: 'Open Women', gender: 'female' as const },
  { name: 'U17', gender: 'mixed' as const },
  { name: 'Open Men', gender: 'male' as const },
];

describe('mixed categories in ranked competitions', () => {
  it('a ranked series in a ranked season is ranked; "other", no season or an old season is not', () => {
    expect(isRankedCompetition({ series: 'premier_league', season: '2026-27' })).toBe(true);
    expect(isRankedCompetition({ series: 'youth_championship', season: '2023-24' })).toBe(true);
    expect(isRankedCompetition({ series: 'other', season: '2026-27' })).toBe(false);
    expect(isRankedCompetition({ series: 'premier_league', season: null })).toBe(false);
    expect(isRankedCompetition({ series: 'israeli_championship', season: '2021-22' })).toBe(false);
  });

  it('lists the mixed categories of a ranked competition only', () => {
    expect(uncountedCategories({ series: 'premier_league', season: '2026-27' }, cats).map((c) => c.name)).toEqual(['U17']);
    expect(uncountedCategories({ series: 'other', season: '2026-27' }, cats)).toEqual([]);
    expect(uncountedCategories({ series: 'premier_league', season: '2026-27' }, cats.filter((c) => c.gender !== 'mixed'))).toEqual([]);
  });
});
