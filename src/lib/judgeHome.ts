// The judge's home list: assignments in live rounds, and in planned rounds of competitions starting
// soon (Israel dates), so a judge who opens the app the evening before has the pad on the phone.
import type { Discipline } from './discipline';
import type { Boulder, Round, RoundFormat } from './types';

export interface JudgeAssignment {
  id: string;
  round_id: string;
  boulder_id: string | null;
  round: {
    kind: Round['kind'];
    status: string;
    scoring: RoundFormat;
    boulders: Boulder[];
    category: { name: string; name_he: string | null;
      /** Dates: missing in lists kept on the device before they were added. */
      competition: { name: string; name_he: string | null; starts_on?: string; ends_on?: string; discipline?: Discipline | null } };
  };
}

/** Planned rounds are listed this many days before the competition starts. */
export const PLANNED_AHEAD_DAYS = 2;

/** 'YYYY-MM-DD' plus `days`. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A planned round whose competition starts within PLANNED_AHEAD_DAYS of `today` (or is on now). */
export function plannedSoon(a: JudgeAssignment, today: string): boolean {
  const c = a.round.category.competition;
  if (a.round.status !== 'planned' || !c.starts_on) return false;
  return c.starts_on.slice(0, 10) <= addDays(today, PLANNED_AHEAD_DAYS) && (c.ends_on ?? c.starts_on).slice(0, 10) >= today;
}

/** What the judge home shows: live rounds first, then planned rounds starting soon (earliest first). */
export function judgeAssignmentsShown(items: JudgeAssignment[], today: string): JudgeAssignment[] {
  const live = items.filter((a) => a.round.status === 'live');
  const soon = items.filter((a) => plannedSoon(a, today))
    .sort((x, y) => (x.round.category.competition.starts_on ?? '').localeCompare(y.round.category.competition.starts_on ?? ''));
  return [...live, ...soon];
}

/** Rounds to keep on the device, most needed first (live, then the soonest planned), at most `keep`. */
export function roundsToKeep(shown: JudgeAssignment[], keep: number): string[] {
  return [...new Set(shown.map((a) => a.round_id))].slice(0, keep);
}
