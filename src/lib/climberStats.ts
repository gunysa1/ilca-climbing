// A climber's results per event (competition + category + discipline) and summary stats, from
// public.climber_history rows. Used by the public climber page and the "my history" / coach views.
import { disciplineOfFormat, type Discipline } from './discipline';
import type { HistoryRow } from './types';

const ROUND_ORDER = { qualification: 0, semifinal: 1, final: 2 } as const;

export interface ClimberEvent {
  key: string;
  competition_id: string;
  competition: string;
  competition_he: string | null;
  starts_on: string;
  category: string;
  category_he: string | null;
  discipline: Discipline;
  /** Rounds the climber started, in order. */
  rounds: HistoryRow[];
  /** Rank in the last round the climber was ranked in (their result in the event), or null. */
  placing: number | null;
  reached: HistoryRow['round'] | null;
  /** Field size of that round. */
  field: number | null;
}

/** Group history rows into events, newest first. */
export function climberEvents(rows: HistoryRow[]): ClimberEvent[] {
  const groups = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const key = `${r.competition_id}|${r.category}|${disciplineOfFormat(r.discipline)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()].map(([key, rs]) => {
    const rounds = [...rs].sort((a, b) => ROUND_ORDER[a.round] - ROUND_ORDER[b.round]);
    const last = [...rounds].reverse().find((r) => r.rank != null) ?? null;
    const first = rounds[0];
    return {
      key, competition_id: first.competition_id, competition: first.competition, competition_he: first.competition_he,
      starts_on: first.starts_on, category: first.category, category_he: first.category_he,
      discipline: disciplineOfFormat(first.discipline), rounds,
      placing: last?.rank ?? null, reached: last?.round ?? null, field: last?.starters ?? null,
    };
  }).sort((a, b) => b.starts_on.localeCompare(a.starts_on) || a.category.localeCompare(b.category));
}

export interface ClimberStats { events: number; gold: number; silver: number; bronze: number; best: number | null; finals: number }

export function climberStats(events: ClimberEvent[]): ClimberStats {
  const placings = events.map((e) => e.placing).filter((p): p is number => p != null);
  return {
    events: events.length,
    gold: placings.filter((p) => p === 1).length,
    silver: placings.filter((p) => p === 2).length,
    bronze: placings.filter((p) => p === 3).length,
    best: placings.length ? Math.min(...placings) : null,
    finals: events.filter((e) => e.reached === 'final').length,
  };
}
