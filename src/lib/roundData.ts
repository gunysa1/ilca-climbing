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
  loading: boolean;
}

export const resultKey = (boulderId: string, climberId: string) => `${boulderId}:${climberId}`;

/** Loads a round with its boulders, starters and results, and keeps results live via Realtime. */
export function useRoundData(roundId: string | undefined): RoundData {
  const [state, setState] = useState<RoundData>({ round: null, boulders: [], starters: [], results: new Map(), loading: true });

  useEffect(() => {
    if (!roundId) return;
    let cancelled = false;

    (async () => {
      const { data: round } = await supabase.from('rounds').select('*').eq('id', roundId).single();
      if (!round || cancelled) { setState((s) => ({ ...s, loading: false })); return; }
      const [{ data: boulders }, { data: regs }, { data: results }] = await Promise.all([
        supabase.from('boulders').select('*').eq('round_id', roundId).order('number'),
        supabase.from('registrations').select('climber_id, bib, profile:profiles(id, full_name, full_name_he, club, country)')
          .eq('category_id', round.category_id).order('bib'),
        supabase.from('boulder_results').select(RESULT_COLUMNS).eq('round_id', roundId),
      ]);
      if (cancelled) return;
      setState({
        round: round as Round,
        boulders: (boulders as Boulder[]) ?? [],
        starters: (regs as unknown as Starter[]) ?? [],
        results: new Map(((results as ResultRow[]) ?? []).map((r) => [resultKey(r.boulder_id, r.climber_id), r])),
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
