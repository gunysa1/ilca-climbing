import { describe, expect, it } from 'vitest';
import { climberEvents, climberStats } from './climberStats';
import type { HistoryRow } from './types';

const row = (o: Partial<HistoryRow>): HistoryRow => ({
  climber_id: 'c', competition_id: 'comp1', competition: 'Cup', competition_he: null, starts_on: '2026-01-10',
  category: 'Women', category_he: null, round: 'qualification', round_status: 'closed', tops: 0, zones: 0,
  top_attempts: 0, zone_attempts: 0, points: 0, rank: 1, starters: 20, discipline: 'ifsc2025', round_id: 'r', ...o,
});

describe('climberEvents', () => {
  it('placing = rank in the last round the climber reached; newest first', () => {
    const events = climberEvents([
      row({ round: 'qualification', rank: 4, round_id: 'q1' }),
      row({ round: 'semifinal', rank: 6, round_id: 's1' }),
      row({ round: 'final', rank: 2, round_id: 'f1', starters: 8 }),
      row({ competition_id: 'comp2', starts_on: '2026-02-01', round: 'qualification', rank: 30, starters: 40, round_id: 'q2' }),
      row({ competition_id: 'comp2', starts_on: '2026-02-01', round: 'semifinal', rank: null, round_id: 's2' }),
    ]);
    expect(events.map((e) => [e.competition_id, e.placing, e.reached, e.field])).toEqual([
      ['comp2', 30, 'qualification', 40],
      ['comp1', 2, 'final', 8],
    ]);
    expect(events[1].rounds.map((r) => r.round)).toEqual(['qualification', 'semifinal', 'final']);
  });

  it('lead and boulder of the same competition are separate events', () => {
    const events = climberEvents([row({ discipline: 'lead', category: 'Women' }), row({ discipline: 'ifsc2025', category: 'Women' })]);
    expect(events.map((e) => e.discipline).sort()).toEqual(['boulder', 'lead']);
  });
});

describe('climberStats', () => {
  it('counts competitions, podiums by medal, best placing and finals', () => {
    const stats = climberStats(climberEvents([
      row({ competition_id: 'a', round: 'final', rank: 1 }),
      row({ competition_id: 'b', round: 'final', rank: 3 }),
      row({ competition_id: 'c', round: 'final', rank: 5 }),
      row({ competition_id: 'd', round: 'qualification', rank: 2 }), // single-round event (league day): 2nd is a podium
    ]));
    expect(stats).toEqual({ events: 4, gold: 1, silver: 1, bronze: 1, best: 1, finals: 3 });
  });
});
