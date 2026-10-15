import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { LEAD_COLUMNS, RESULT_COLUMNS, TOTALS_COLUMNS, type Boulder, type Profile, type Round } from './types';
import type { LeadResult } from './lead';
import type { BoulderResult } from './scoring';

/** A climber on a round's start list (round_starters + their registration). */
export interface Starter {
  climber_id: string;
  bib: number | null;
  age_class: string | null;
  start_order: number | null;
  /** Previous-round place (countback seed), stored when the start list was generated. */
  prev_place: number | null;
  /** Qualification group (A, B, ...): groups are ranked separately. */
  group_label: string | null;
  profile: Profile;
}
export interface ResultRow extends BoulderResult { boulder_id: string; climber_id: string }
/** Stored round totals (totals-only rounds imported from LogLig). */
export interface TotalsRow { climber_id: string; tops: number; zones: number; top_attempts: number; zone_attempts: number }
export interface LeadRow { boulder_id: string; climber_id: string; hold: number; plus: boolean; top: boolean; time_ms: number | null }

/** lead.ts works on route_id; routes are rows of `boulders`. */
export const toLeadResult = (r: LeadRow): LeadResult => ({ climber_id: r.climber_id, route_id: r.boulder_id, hold: r.hold, plus: r.plus, top: r.top, time_ms: r.time_ms });

export interface RoundData {
  round: Round | null;
  boulders: Boulder[];
  /** Ordered by start order. */
  starters: Starter[];
  results: Map<string, ResultRow>; // key: `${boulder_id}:${climber_id}`
  /** Lead rounds: results per route, same key. */
  leadResults: Map<string, LeadRow>;
  /** Totals-only rounds: stored totals per climber id. */
  totals: Map<string, TotalsRow>;
  loading: boolean;
}

/** Start list of a round, joined with bib and age class from the category's registrations. */
export async function loadStarters(round: Pick<Round, 'id' | 'category_id'>): Promise<{ starters: Starter[]; error: string | null }> {
  const [{ data: rows, error: e1 }, { data: regs, error: e2 }] = await Promise.all([
    supabase.from('round_starters')
      .select('climber_id, start_order, prev_place, group_label, profile:profiles(id, full_name, full_name_he, club, country)')
      .eq('round_id', round.id),
    supabase.from('registrations').select('climber_id, bib, age_class').eq('category_id', round.category_id),
  ]);
  const reg = new Map((regs ?? []).map((g) => [g.climber_id as string, g as { bib: number | null; age_class: string | null }]));
  const starters = ((rows ?? []) as unknown as Omit<Starter, 'bib' | 'age_class'>[]).map((r) => ({
    ...r, bib: reg.get(r.climber_id)?.bib ?? null, age_class: reg.get(r.climber_id)?.age_class ?? null,
  })).sort((a, b) => (a.start_order ?? 1e9) - (b.start_order ?? 1e9) || (a.bib ?? 1e9) - (b.bib ?? 1e9));
  return { starters, error: e1?.message ?? e2?.message ?? null };
}

export const resultKey = (boulderId: string, climberId: string) => `${boulderId}:${climberId}`;

/** Loads a round with its boulders, starters and results, and keeps results live via Realtime. */
export function useRoundData(roundId: string | undefined): RoundData {
  const [state, setState] = useState<RoundData>({ round: null, boulders: [], starters: [], results: new Map(), leadResults: new Map(), totals: new Map(), loading: true });

  useEffect(() => {
    if (!roundId) return;
    let cancelled = false;
    // A different round: never show the previous round's data while this one loads.
    setState({ round: null, boulders: [], starters: [], results: new Map(), leadResults: new Map(), totals: new Map(), loading: true });

    (async () => {
      const { data: round } = await supabase.from('rounds').select('*').eq('id', roundId).single();
      if (!round || cancelled) { setState((s) => ({ ...s, loading: false })); return; }
      const lead = (round as Round).scoring === 'lead';
      const [{ data: boulders }, { starters }, { data: results }, { data: leadRows }, { data: totalRows }] = await Promise.all([
        supabase.from('boulders').select('*').eq('round_id', roundId).order('number'),
        loadStarters(round as Round),
        lead ? Promise.resolve({ data: [] }) : supabase.from('boulder_results').select(RESULT_COLUMNS).eq('round_id', roundId),
        lead ? supabase.from('lead_results').select(LEAD_COLUMNS).eq('round_id', roundId) : Promise.resolve({ data: [] }),
        (round as Round).scoring === 'classic' ? supabase.from('round_totals').select(TOTALS_COLUMNS).eq('round_id', roundId) : Promise.resolve({ data: [] }),
      ]);
      if (cancelled) return;
      setState({
        round: round as Round,
        boulders: (boulders as Boulder[]) ?? [],
        starters,
        results: new Map(((results as ResultRow[]) ?? []).map((r) => [resultKey(r.boulder_id, r.climber_id), r])),
        leadResults: new Map(((leadRows as LeadRow[]) ?? []).map((r) => [resultKey(r.boulder_id, r.climber_id), r])),
        totals: new Map(((totalRows as TotalsRow[]) ?? []).map((r) => [r.climber_id, r])),
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
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'lead_results', filter: `round_id=eq.${roundId}` },
        (payload) => {
          const row = payload.new as LeadRow;
          if (!row?.boulder_id) return;
          setState((s) => {
            const leadResults = new Map(s.leadResults);
            leadResults.set(resultKey(row.boulder_id, row.climber_id), row);
            return { ...s, leadResults };
          });
        })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [roundId]);

  return state;
}
