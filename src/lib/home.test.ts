import { describe, expect, it } from 'vitest';
import { favoritesLatest, parseHome, topOfRanking, winnersByCategory, type HomeWinner } from './home';
import type { RankingRow } from './rankings';
import type { HistoryRow, Profile } from './types';

const winner = (o: Partial<HomeWinner>): HomeWinner => ({
  category_id: 'w', category: 'Women', category_he: 'נשים', gender: 'female', round_id: 'f', round_kind: 'final',
  climber_id: 'a', full_name: 'A', full_name_he: null, club: null, ...o,
});
const rankRow = (climber_id: string, rank: number): RankingRow =>
  ({ climber_id, rank, total: 100 - rank, events: [], championship: null, bonus: 0, adjustment: 0 });
const row = (o: Partial<HistoryRow>): HistoryRow => ({
  climber_id: 'c', competition_id: 'comp1', competition: 'Cup', competition_he: null, starts_on: '2026-01-10',
  category: 'Women', category_he: null, round: 'qualification', round_status: 'closed', tops: 0, zones: 0,
  top_attempts: 0, zone_attempts: 0, points: 0, rank: 1, starters: 20, discipline: 'ifsc2025', round_id: 'r', ...o,
});
const profile = (id: string): Profile => ({ id, full_name: id.toUpperCase(), full_name_he: null, club: null, country: 'ISR' });

describe('parseHome', () => {
  it('fills missing parts with empty lists', () => {
    expect(parseHome(null)).toEqual({ live: [], upcoming: [], latest: [] });
    const d = parseHome({ live: [{ round_id: 'r' }], latest: [{ id: 'c' }] });
    expect(d.live[0].on_wall).toEqual([]);
    expect(d.latest[0].winners).toEqual([]);
  });
});

describe('winnersByCategory', () => {
  it('one entry per category; a tie keeps every rank-1 climber', () => {
    const groups = winnersByCategory([
      winner({ climber_id: 'a' }),
      winner({ category_id: 'm', category: 'Men', climber_id: 'b' }),
      winner({ category_id: 'm', category: 'Men', climber_id: 'c' }),
    ]);
    expect(groups.map((g) => [g.category, g.climbers.map((c) => c.climber_id)])).toEqual([['Women', ['a']], ['Men', ['b', 'c']]]);
  });
});

describe('topOfRanking', () => {
  it('places 1 to 3, keeping a tie at third', () => {
    const rows = [rankRow('a', 1), rankRow('b', 2), rankRow('c', 3), rankRow('d', 3), rankRow('e', 5)];
    expect(topOfRanking(rows).map((r) => r.climber_id)).toEqual(['a', 'b', 'c', 'd']);
    expect(topOfRanking([])).toEqual([]);
  });
});

describe('favoritesLatest', () => {
  it('starring order, latest event per climber, planned rounds ignored, unknown ids dropped', () => {
    const out = favoritesLatest(['b', 'x', 'a'], [profile('a'), profile('b')], [
      row({ climber_id: 'a', competition_id: 'old', starts_on: '2025-01-01', rank: 4 }),
      row({ climber_id: 'a', competition_id: 'new', starts_on: '2026-03-01', rank: 2 }),
      row({ climber_id: 'b', competition_id: 'soon', starts_on: '2026-12-01', round_status: 'planned', rank: null }),
    ]);
    expect(out.map((f) => [f.profile.id, f.latest?.competition_id ?? null, f.latest?.placing ?? null]))
      .toEqual([['b', null, null], ['a', 'new', 2]]);
  });
});
