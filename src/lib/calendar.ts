// The calendar page's pure steps: status of a competition, seasons and months.
import { disciplinesOf, type Discipline } from './discipline';
import { seasonOf } from './season';
import type { Competition, Round, RoundFormat } from './types';

export type CalendarCompetition = Competition & { categories: { rounds: { scoring: RoundFormat; status: Round['status'] }[] }[] };
export type CalendarStatus = 'upcoming' | 'live' | 'finished';

/** Today in Israel as 'YYYY-MM-DD' (competitions are dated there, whatever the phone's zone). */
export function israelToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Live: a round is live, or today is one of the competition days (published). Finished: marked
 * finished or the last day has passed. Everything else is upcoming. */
export function calendarStatus(c: CalendarCompetition, today: string): CalendarStatus {
  if (c.categories.some((cat) => cat.rounds.some((r) => r.status === 'live'))) return 'live';
  if (c.status === 'finished' || c.ends_on.slice(0, 10) < today) return 'finished';
  if (c.starts_on.slice(0, 10) <= today) return 'live';
  return 'upcoming';
}

export const seasonOfCompetition = (c: Pick<Competition, 'season' | 'starts_on'>) => c.season ?? seasonOf(c.starts_on);

/** Seasons that have competitions, newest first; the current season is always offered. */
export function calendarSeasons(comps: CalendarCompetition[], today: string): string[] {
  const set = new Set(comps.map(seasonOfCompetition));
  set.add(seasonOf(today));
  return [...set].sort((a, b) => b.localeCompare(a));
}

export interface MonthGroup { month: string; items: CalendarCompetition[] }

/** A season's competitions by the month they start in, in date order. */
export function groupByMonth(comps: CalendarCompetition[]): MonthGroup[] {
  const sorted = [...comps].sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.name.localeCompare(b.name));
  const groups: MonthGroup[] = [];
  for (const c of sorted) {
    const month = c.starts_on.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last?.month === month) last.items.push(c); else groups.push({ month, items: [c] });
  }
  return groups;
}

/** Where the "today" marker goes: before the first competition that has not ended (null: after all). */
export function todayMarkerBefore(comps: CalendarCompetition[], today: string): string | null {
  const sorted = [...comps].sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  return sorted.find((c) => c.ends_on.slice(0, 10) >= today)?.id ?? null;
}

export const disciplinesOfCompetition = (c: CalendarCompetition): Discipline[] =>
  [...disciplinesOf(c.categories.flatMap((cat) => cat.rounds.map((r) => r.scoring)))];
