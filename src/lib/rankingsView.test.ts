import { describe, expect, it } from 'vitest';
import type { RankingTable } from './rankingTables';
import { loadRankingsView, type RankingsLoaders } from './rankingsView';

const table = (season: string): RankingTable => ({ rank_class: 'senior', gender: 'female', discipline: 'boulder', rows: [],
  meta: { criteria: season < '2026-27' ? 'ilca2025' : 'ilca2027', assumed: false, world_missing: false, provisional: false } });

/** Loaders that record their calls; `page` / `seasons` / `computed` give each one's answer (an Error: it throws). */
function loaders(answers: { page?: unknown; seasons?: unknown; computed?: unknown }) {
  const calls: string[] = [];
  const answer = async <T,>(name: string, a: unknown): Promise<T> => {
    calls.push(name);
    if (a instanceof Error) throw a;
    return a as T;
  };
  const l: RankingsLoaders = {
    page: (season) => answer(`page ${season}`, answers.page),
    seasons: () => answer('seasons', answers.seasons),
    computed: (season) => answer(`computed ${season}`, answers.computed),
  };
  return { l, calls };
}

describe('rankings page data', () => {
  it('stored table: one request', async () => {
    const { l, calls } = loaders({ page: { seasons: ['2026-27', '2025-26'], season: '2026-27', table: table('2026-27') } });
    expect(await loadRankingsView(l, null, 'senior', 'female', 'boulder'))
      .toEqual({ seasons: ['2026-27', '2025-26'], season: '2026-27', table: table('2026-27') });
    expect(calls).toEqual(['page null']);
  });

  it('no stored table (or another code version): computed from the season data', async () => {
    const { l, calls } = loaders({ page: { seasons: ['2026-27'], season: '2026-27', table: null }, computed: table('x') });
    expect(await loadRankingsView(l, '2026-27', 'senior', 'female', 'boulder')).toEqual({ seasons: ['2026-27'], season: '2026-27', table: table('x') });
    expect(calls).toEqual(['page 2026-27', 'computed 2026-27']);
  });

  it('ranking_page missing or failing: the season list as before, then computed', async () => {
    for (const page of [null, new Error('404')]) {
      const { l, calls } = loaders({ page, seasons: ['2026-27', '2025-26'], computed: table('x') });
      expect(await loadRankingsView(l, null, 'senior', 'female', 'boulder')).toEqual({ seasons: ['2026-27', '2025-26'], season: '2026-27', table: table('x') });
      expect(calls).toEqual(['page null', 'seasons', 'computed 2026-27']);
      const asked = loaders({ page, seasons: ['2026-27', '2025-26'], computed: table('x') });
      expect((await loadRankingsView(asked.l, '2025-26', 'senior', 'female', 'boulder')).season).toBe('2025-26');
      expect(asked.calls).toEqual(['page 2025-26', 'seasons', 'computed 2025-26']);
    }
  });

  it('everything failing: no table (the page says so); no seasons at all: nothing to compute', async () => {
    const failing = loaders({ page: new Error('x'), seasons: new Error('y'), computed: new Error('z') });
    expect(await loadRankingsView(failing.l, '2026-27', 'senior', 'female', 'boulder')).toEqual({ seasons: null, season: '2026-27', table: null });
    const none = loaders({ page: { seasons: [], season: null, table: null } });
    expect(await loadRankingsView(none.l, null, 'senior', 'female', 'boulder')).toEqual({ seasons: [], season: null, table: null });
    expect(none.calls).toEqual(['page null']);
  });

  it('speed: the season list only', async () => {
    const { l, calls } = loaders({ page: { seasons: ['2026-27'], season: '2026-27', table: null } });
    expect(await loadRankingsView(l, null, 'senior', 'female', 'speed')).toEqual({ seasons: ['2026-27'], season: '2026-27', table: null });
    expect(calls).toEqual(['page null']);
  });
});
