import { describe, expect, it } from 'vitest';
import { addDays, judgeAssignmentsShown, plannedSoon, roundsToKeep, type JudgeAssignment } from './judgeHome';

const a = (id: string, status: string, starts_on?: string, ends_on?: string): JudgeAssignment => ({
  id, round_id: `r-${id}`, boulder_id: null,
  round: { kind: 'qualification', status, scoring: 'lead', boulders: [],
    category: { name: 'U17', name_he: null, competition: { name: 'Lead league', name_he: null, starts_on, ends_on } } },
});

describe('judge home', () => {
  it('adds days across months', () => {
    expect(addDays('2026-10-30', 2)).toBe('2026-11-01');
    expect(addDays('2026-10-28T00:00:00', 0)).toBe('2026-10-28');
  });

  it('lists planned rounds from two days before the competition until its last day', () => {
    const lead = a('1', 'planned', '2026-10-28', '2026-10-29');
    expect(plannedSoon(lead, '2026-10-25')).toBe(false);
    expect(plannedSoon(lead, '2026-10-26')).toBe(true);   // two days before
    expect(plannedSoon(lead, '2026-10-27')).toBe(true);   // the evening before
    expect(plannedSoon(lead, '2026-10-29')).toBe(true);   // second day: the final
    expect(plannedSoon(lead, '2026-10-30')).toBe(false);
    expect(plannedSoon(a('2', 'planned', '2026-10-28'), '2026-10-28')).toBe(true); // one day, no end date
    expect(plannedSoon(a('3', 'planned'), '2026-10-28')).toBe(false);              // kept before dates were stored
    expect(plannedSoon(a('4', 'closed', '2026-10-28', '2026-10-28'), '2026-10-28')).toBe(false);
  });

  it('shows live rounds first, then the soonest planned; keeps their pages, most needed first', () => {
    const items = [a('late', 'planned', '2026-10-29', '2026-10-29'), a('far', 'planned', '2026-11-10', '2026-11-12'),
      a('live', 'live', '2026-10-01', '2026-10-01'), a('soon', 'planned', '2026-10-28', '2026-10-29')];
    const shown = judgeAssignmentsShown(items, '2026-10-27');
    expect(shown.map((x) => x.id)).toEqual(['live', 'soon', 'late']);
    expect(roundsToKeep([...shown, { ...shown[1], id: 'same round' }], 8)).toEqual(['r-live', 'r-soon', 'r-late']);
    expect(roundsToKeep(shown, 2)).toEqual(['r-live', 'r-soon']);
  });
});
