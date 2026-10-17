import { describe, expect, it } from 'vitest';
import { ILCA_2025, ILCA_2027, criteriaForSeason } from './criteria';
import { youthBonusPoints, type IntlResult } from './rankings';

const intl = (r: Partial<IntlResult>): IntlResult => ({
  climber_id: 'x', discipline: 'lead', event_type: 'world_cup', event_name: 'E', starts_on: '2027-06-01',
  place: 1, field_size: 40, reached: 'final', ...r,
});

describe('criteriaForSeason', () => {
  it('maps seasons to editions and flags assumed ones', () => {
    expect(criteriaForSeason('2024-25')).toEqual({ criteria: ILCA_2025, assumed: false });
    expect(criteriaForSeason('2025-26')).toEqual({ criteria: ILCA_2025, assumed: true });
    expect(criteriaForSeason('2026-27')).toEqual({ criteria: ILCA_2027, assumed: false });
    expect(criteriaForSeason('2027-28')).toEqual({ criteria: ILCA_2027, assumed: true });
    expect(criteriaForSeason('2019-20')).toEqual({ criteria: ILCA_2025, assumed: true });
  });
});

describe('ILCA 2027', () => {
  it('scores senior world ranking positions in bands of ten', () => {
    const p = ILCA_2027.worldRankingPoints;
    expect([1, 10, 11, 20, 21, 30, 31, 40, 41].map(p)).toEqual([400, 400, 300, 300, 200, 200, 100, 100, 0]);
  });
  it('gives youth bonus only for championship finals', () => {
    const b = ILCA_2027.youthBonus;
    expect(b(intl({ event_type: 'world_youth_championship', place: 2 }))).toBe(100);
    expect(b(intl({ event_type: 'world_youth_championship', place: 5 }))).toBe(60);
    expect(b(intl({ event_type: 'world_youth_championship', place: 5, reached: 'semifinal' }))).toBe(0);
    expect(b(intl({ event_type: 'european_youth_championship', place: 3 }))).toBe(60);
    expect(b(intl({ event_type: 'european_youth_championship', place: 7 }))).toBe(40);
    expect(b(intl({ event_type: 'european_youth_cup', place: 1 }))).toBe(0);
    expect(b(intl({ event_type: 'european_youth_championship', place: 3, field_size: 10 }))).toBe(60);
  });
  it('does not count U17 in open events', () => {
    expect(ILCA_2027.u17OpenEvents).toBe(false);
    expect(ILCA_2025.u17OpenEvents).toBe(true);
  });
});

describe('ILCA 2025', () => {
  it('keeps the 2025 youth bonus and no world ranking points', () => {
    const r = intl({ event_type: 'european_youth_cup', place: 9, field_size: 37 });
    expect(ILCA_2025.youthBonus(r)).toBe(20);
    expect(ILCA_2025.youthBonus(r)).toBe(youthBonusPoints(r));
    expect(ILCA_2025.worldRankingPoints(1)).toBe(0);
    expect(ILCA_2025.seniorIntl).toBe('per_event');
    expect(ILCA_2027.seniorIntl).toBe('world_ranking');
  });
});
