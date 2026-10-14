import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { RESULT_COLUMNS, type Boulder, type Profile, type Round } from './types';
import type { BoulderResult } from './scoring';

export interface Starter { climber_id: string; bib: number | null; profile: Profile }
export interface ResultRow extends BoulderResult { boulder_id: string; climber_id: string }

export interface RoundData {
  round: Round | null;
  boulders: Boulder[];
  starters: Starter[];
  results: Map<string, ResultRow>; // key: `${boulder_id}:${climber_id}`
  /** Final rank per climber in the previous round of the category (countback tie-break). */
  prevRanks: Map<string, number>;
  loading: boolean;
}

const ROUND_ORDER: Round['kind'][] = ['qualification', 'semifinal', 'final'];

/** Ranks from the latest earlier round of the same category, as computed by public.round_scores. */
async function loadPrevRanks(round: Round): Promise<Map<string, number>> {
  const earlier = ROUND_ORDER.slice(0, ROUND_ORDER.indexOf(round.kind));
  if (earlier.length === 0) return new Map();
  const { data: rounds } = await supabase.from('rounds').select('id, kind')
    .eq('category_id', round.category_id).in('kind', earlier);
  const prev = (rounds ?? []).sort((a, b) => ROUND_ORDER.indexOf(b.kind) - ROUND_ORDER.indexOf(a.kind))[0];
  if (!prev) return new Map();
  const { data: scores } = await supabase.from('round_scores').select('climber_id, rank').eq('round_id', prev.id);
  return new Map((scores ?? []).map((s) => [s.climber_id as string, s.rank as number]));
}

export const resultKey = (boulderId: string, climberId: string) => `${boulderId}:${climberId}`;

/** Loads a round with its boulders, starters and results, and keeps results live via Realtime. */
export function useRoundData(roundId: string | undefined): RoundData {
  const [state, setState] = useState<RoundData>({ round: null, boulders: [], starters: [], results: new Map(), prevRanks: new Map(), loading: true });

  useEffect(() => {
    if (!roundId) return;
    let cancelled = false;

    (async () => {
      const { data: round } = await supabase.from('rounds').select('*').eq('id', roundId).single();
      if (!round || cancelled) { setState((s) => ({ ...s, loading: false })); return; }
      const [{ data: boulders }, { data: regs }, { data: results }, prevRanks] = await Promise.all([
        supabase.from('boulders').select('*').eq('round_id', roundId).order('number'),
        supabase.from('registrations').select('climber_id, bib, profile:profiles(id, full_name, full_name_he, club, country)')
          .eq('category_id', round.category_id).order('bib'),
        supabase.from('boulder_results').select(RESULT_COLUMNS).eq('round_id', roundId),
        loadPrevRanks(round as Round),
      ]);
      if (cancelled) return;
      setState({
        round: round as Round,
        boulders: (boulders as Boulder[]) ?? [],
        starters: (regs as unknown as Starter[]) ?? [],
        results: new Map(((results as ResultRow[]) ?? []).map((r) => [resultKey(r.boulder_id, r.climber_id), r])),
        prevRanks,
        loading: false,
      });
    })();

    const channel = supabase.channel(`round:${roundId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'boulder_results', filter: `round_id=eq.${roundId}` },
        (payload) => {
          const row = payload.new as ResultRow;
          if (!row?.boulder_id) return;
          setState((s) => {
            const results = new Map(s.results);
            results.set(resultKey(row.boulder_id, row.climber_id), row);
            return { ...s, results };
          });
        })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [roundId]);

  return state;
}
