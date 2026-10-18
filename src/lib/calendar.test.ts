import { describe, expect, it } from 'vitest';
import { calendarSeasons, calendarStatus, disciplinesOfCompetition, groupByMonth, israelToday, todayMarkerBefore, type CalendarCompetition } from './calendar';

const comp = (id: string, starts_on: string, ends_on: string, extra: Partial<CalendarCompetition> = {}): CalendarCompetition => ({
  id, name: id, name_he: null, venue: null, starts_on, ends_on, status: 'published', season: null, series: 'other', categories: [], ...extra,
});

describe('calendar', () => {
  it('today is the date in Israel, not in UTC', () => {
    expect(israelToday(new Date('2026-10-17T22:30:00Z'))).toBe('2026-10-18'); // 01:30 in Israel (UTC+3 in October)
    expect(israelToday(new Date('2026-12-31T22:30:00Z'))).toBe('2027-01-01'); // UTC+2 in winter
  });

  it('status: upcoming, live (on the days or a live round), finished', () => {
    const today = '2026-10-28';
    expect(calendarStatus(comp('a', '2026-11-05', '2026-11-05'), today)).toBe('upcoming');
    expect(calendarStatus(comp('a', '2026-10-28', '2026-10-29'), today)).toBe('live');
    expect(calendarStatus(comp('a', '2026-10-27', '2026-10-28'), today)).toBe('live');
    expect(calendarStatus(comp('a', '2026-10-20', '2026-10-21'), today)).toBe('finished');
    expect(calendarStatus(comp('a', '2026-10-28', '2026-10-29', { status: 'finished' }), today)).toBe('finished');
    // a live round wins (a final that runs past midnight, a wrong date)
    expect(calendarStatus(comp('a', '2026-10-20', '2026-10-21', { categories: [{ rounds: [{ scoring: 'lead', status: 'live' }] }] }), today)).toBe('live');
  });

  it('seasons: those with competitions plus the current one, newest first', () => {
    const list = [comp('a', '2025-10-01', '2025-10-01'), comp('b', '2026-02-01', '2026-02-01', { season: '2025-26' })];
    expect(calendarSeasons(list, '2026-10-18')).toEqual(['2026-27', '2025-26']);
  });

  it('groups by start month in date order', () => {
    const g = groupByMonth([comp('c', '2026-11-02', '2026-11-02'), comp('a', '2026-10-28', '2026-11-01'), comp('b', '2026-10-05', '2026-10-05')]);
    expect(g.map((m) => [m.month, m.items.map((c) => c.id)])).toEqual([['2026-10', ['b', 'a']], ['2026-11', ['c']]]);
  });

  it('the today marker sits before the first competition not yet over', () => {
    const list = [comp('a', '2026-10-01', '2026-10-02'), comp('b', '2026-10-18', '2026-10-19'), comp('c', '2026-11-01', '2026-11-01')];
    expect(todayMarkerBefore(list, '2026-10-18')).toBe('b');
    expect(todayMarkerBefore(list, '2026-10-20')).toBe('c');
    expect(todayMarkerBefore(list, '2026-12-01')).toBeNull();
  });

  it('disciplines come from the rounds', () => {
    expect(disciplinesOfCompetition(comp('a', '2026-10-01', '2026-10-01', { categories: [{ rounds: [{ scoring: 'lead', status: 'planned' }, { scoring: 'ifsc2025', status: 'planned' }] }] })).sort()).toEqual(['boulder', 'lead']);
  });
});
