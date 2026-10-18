import { describe, expect, it } from 'vitest';
import { resultKey, type LeadRow, type Starter } from './roundData';
import { roundRows } from './roundRows';
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
      .toEqual([{ climber_id: 'b', rank: 1, score: '2:10' }, { climber_id: 'a', rank: 2, score: '3:08' }]);
  });

  it('semifinal, or a final without the time tie-break: the tie stands and no time is shown', () => {
    for (const r of [round('semifinal'), round('final', false)]) {
      expect(roundRows(r, starters, boulders, new Map(), rows, new Map()).map((x) => [x.climber_id, x.rank, x.score]))
        .toEqual([['a', 1, ''], ['b', 1, '']]);
    }
  });
});
