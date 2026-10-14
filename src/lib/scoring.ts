// Boulder scoring shared by the judge pad and live results.
// Mirrors public.boulder_points / public.round_scores in the SQL migration;
// keep both in sync (tests in scoring.test.ts and supabase/tests/rls_test.sql).

export type ScoringFormat = 'ifsc2025' | 'classic';

/** One climber on one boulder. Attempt numbers are 1-based; null = not reached. */
export interface BoulderResult {
  attempts: number;
  zone_attempt: number | null;
  top_attempt: number | null;
}

export const EMPTY_RESULT: BoulderResult = { attempts: 0, zone_attempt: null, top_attempt: null };

/** IFSC 2025: top 25, zone 10, minus 0.1 per failed attempt before the highest hold reached (never below 0). */
export function boulderPoints(r: Pick<BoulderResult, 'zone_attempt' | 'top_attempt'>): number {
  // Work in tenths to avoid floating point drift.
  if (r.top_attempt != null) return Math.max(250 - (r.top_attempt - 1), 0) / 10;
  if (r.zone_attempt != null) return Math.max(100 - (r.zone_attempt - 1), 0) / 10;
  return 0;
}

export interface RoundTotals {
  climber_id: string;
  tops: number;
  zones: number;
  top_attempts: number;
  zone_attempts: number;
  points: number;
  /** Rank in the previous round of the same category (countback), if any. */
  prev_rank?: number | null;
}

export function totals(climber_id: string, results: BoulderResult[]): RoundTotals {
  const t: RoundTotals = { climber_id, tops: 0, zones: 0, top_attempts: 0, zone_attempts: 0, points: 0 };
  let tenths = 0;
  for (const r of results) {
    if (r.top_attempt != null) { t.tops++; t.top_attempts += r.top_attempt; }
    if (r.zone_attempt != null) { t.zones++; t.zone_attempts += r.zone_attempt; }
    tenths += Math.round(boulderPoints(r) * 10);
  }
  t.points = tenths / 10;
  return t;
}

const tenths = (points: number) => Math.round(points * 10);

/**
 * IFSC 2025 order: points, then countback to the previous-round rank (missing ranks last),
 * then fewer attempts on tops, then fewer attempts on zones. Same order as the temporary
 * ILCA app and public.round_scores.
 */
function compare(a: RoundTotals, b: RoundTotals, format: ScoringFormat): number {
  if (format === 'ifsc2025') {
    const ap = a.prev_rank ?? Infinity;
    const bp = b.prev_rank ?? Infinity;
    return tenths(b.points) - tenths(a.points) || (ap === bp ? 0 : ap - bp) ||
      a.top_attempts - b.top_attempts || a.zone_attempts - b.zone_attempts;
  }
  return b.tops - a.tops || b.zones - a.zones || a.top_attempts - b.top_attempts || a.zone_attempts - b.zone_attempts;
}

/** Sort and assign competition ranks (ties share a rank: 1, 1, 3). */
export function rank(rows: RoundTotals[], format: ScoringFormat): (RoundTotals & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => compare(a, b, format));
  const ranked: (RoundTotals & { rank: number })[] = [];
  sorted.forEach((row, i) => {
    const prev = ranked[i - 1];
    const tied = prev !== undefined && compare(prev, row, format) === 0;
    ranked.push({ ...row, rank: tied ? prev.rank : i + 1 });
  });
  return ranked;
}

// ---------------------------------------------------------------------------
// Judge pad state machine. "attempts" includes the attempt in progress;
// zone/top attach to the current attempt.
// ---------------------------------------------------------------------------
export type JudgeAction = 'attempt' | 'zone' | 'top';

export function applyAction(r: BoulderResult, action: JudgeAction): BoulderResult {
  if (r.top_attempt != null) return r; // topped: boulder finished for this climber
  const current = Math.max(r.attempts, 1);
  switch (action) {
    case 'attempt':
      return { ...r, attempts: r.attempts + 1 };
    case 'zone':
      if (r.zone_attempt != null) return r;
      return { ...r, attempts: current, zone_attempt: current };
    case 'top':
      return { attempts: current, zone_attempt: r.zone_attempt ?? current, top_attempt: current };
  }
}
