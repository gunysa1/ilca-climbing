// The ranked rows of a round (rank and score text), shared by the round page and the big screen.
import { leadStandings } from './lead';
import { resultKey, toLeadResult, type LeadRow, type ResultRow, type Starter, type TotalsRow } from './roundData';
import { EMPTY_RESULT, standings, totals, type ScoringFormat } from './scoring';
import type { Boulder, Round } from './types';

export interface Row { climber_id: string; rank: number | null; score: string }

/** Ranks of `shown` (the starters being ranked together: one group / age class) with the score text. */
export function roundRows(
  round: Round, shown: Starter[], boulders: Boulder[], results: Map<string, ResultRow>, leadResults: Map<string, LeadRow>,
  storedTotals: Map<string, TotalsRow>,
): Row[] {
  if (round.scoring === 'lead') {
    const multi = boulders.length > 1;
    const seeds = new Map(shown.filter((s) => s.prev_place != null).map((s) => [s.climber_id, s.prev_place!]));
    return leadStandings(shown.map((s) => s.climber_id), boulders.map((b) => b.id), [...leadResults.values()].map(toLeadResult), seeds,
      round.kind === 'final' && round.time_tiebreak !== false)
      // single route: the height is on the route chip; several routes: the geometric mean of rank points
      .map((s) => ({ climber_id: s.climber_id, rank: s.rank, score: s.rank === null ? '–' : multi ? s.points.toFixed(2) : '' }));
  }
  const format = round.scoring as ScoringFormat;
  // Totals-only rounds (older LogLig history) carry stored totals instead of per-boulder results.
  const totalsRows = shown.map((s) => {
    const stored = storedTotals.get(s.climber_id);
    return stored ? { ...stored, points: 0, prev_rank: s.prev_place } : {
      ...totals(s.climber_id, boulders.map((b) => results.get(resultKey(b.id, s.climber_id)) ?? EMPTY_RESULT)),
      prev_rank: s.prev_place,
    };
  });
  const climbed = new Set(shown.filter((s) => storedTotals.has(s.climber_id)
    || boulders.some((b) => (results.get(resultKey(b.id, s.climber_id))?.attempts ?? 0) > 0)).map((s) => s.climber_id));
  return standings(totalsRows, format, climbed, round.kind === 'final').map((r) => ({
    climber_id: r.climber_id, rank: r.rank,
    score: r.rank === null ? '–' : format === 'ifsc2025'
      ? r.points.toFixed(1) : `${r.tops}T${r.zones}z ${r.top_attempts} ${r.zone_attempts}`,
  }));
}
