import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { type Boulder, type Profile, type Round } from './types';
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
export interface ResultRow extends BoulderResult { boulder_id: string; climber_id: string; locked?: boolean; updated_at?: string }
/** Stored round totals (totals-only rounds imported from LogLig). */
export interface TotalsRow { climber_id: string; tops: number; zones: number; top_attempts: number; zone_attempts: number }
export interface LeadRow { boulder_id: string; climber_id: string; hold: number; plus: boolean; top: boolean; time_ms: number | null; locked?: boolean; updated_at?: string }
/** An appeal on a climber's result in this round (boulder_id null: the whole round). */
export interface Appeal { id: string; boulder_id: string | null; climber_id: string; status: 'open' | 'upheld' | 'rejected' }

/** lead.ts works on route_id; routes are rows of `boulders`. */
export const toLeadResult = (r: LeadRow): LeadResult => ({ climber_id: r.climber_id, route_id: r.boulder_id, hold: r.hold, plus: r.plus, top: r.top, time_ms: r.time_ms });

/** The round's category and competition (breadcrumbs). */
export interface RoundCategory { id: string; name: string; name_he: string | null;
  competition: { id: string; name: string; name_he: string | null } }
/** The competition's categories with their rounds (round chips, men / women switch). */
export interface CategoryRounds { id: string; name: string; name_he: string | null;
  rounds: { id: string; kind: Round['kind']; status: Round['status'] }[] }

export interface RoundData {
  round: Round | null;
  category: RoundCategory | null;
  categories: CategoryRounds[];
  boulders: Boulder[];
  /** Ordered by start order. */
  starters: Starter[];
  results: Map<string, ResultRow>; // key: `${boulder_id}:${climber_id}`
  /** Lead rounds: results per route, same key. */
  leadResults: Map<string, LeadRow>;
  /** Totals-only rounds: stored totals per climber id. */
  totals: Map<string, TotalsRow>;
  appeals: Appeal[];
  loading: boolean;
  /** Shown from the copy kept on the device: the server couldn't be reached (judge pad). */
  offline?: boolean;
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
  }));
  return { starters: sortStarters(starters), error: e1?.message ?? e2?.message ?? null };
}

/** round_page(): the whole page in one response. */
interface RoundPage {
  round: Round; category: RoundCategory; categories: CategoryRounds[]; boulders: Boulder[]; starters: Starter[];
  results: ResultRow[]; lead_results: LeadRow[]; totals: TotalsRow[]; appeals: Appeal[];
}

/** Start order, then bib (climbers without a start order last). */
const sortStarters = (starters: Starter[]) =>
  [...starters].sort((a, b) => (a.start_order ?? 1e9) - (b.start_order ?? 1e9) || (a.bib ?? 1e9) - (b.bib ?? 1e9));

export const resultKey = (boulderId: string, climberId: string) => `${boulderId}:${climberId}`;

const EMPTY: RoundData = { round: null, category: null, categories: [], boulders: [], starters: [], results: new Map(), leadResults: new Map(), totals: new Map(), appeals: [], loading: true };

/** Round pages already loaded or prefetched in this visit: switching men / women (or Q / S / F)
 *  shows them at once, then refreshes. */
const pageCache = new Map<string, RoundPage>();
/** When each cached page was fetched (ms). */
const pageAt = new Map<string, number>();
const inFlight = new Map<string, Promise<RoundPage | null>>();

function fetchRoundPage(roundId: string): Promise<RoundPage | null> {
  let p = inFlight.get(roundId);
  if (!p) {
    p = Promise.resolve(supabase.rpc('round_page', { p_round: roundId })).then(({ data }) => {
      const page = data as RoundPage | null;
      if (page) { pageCache.set(roundId, page); pageAt.set(roundId, Date.now()); }
      return page;
    }).finally(() => inFlight.delete(roundId));
    inFlight.set(roundId, p);
  }
  return p;
}

/** Judge pad: the last round pages it opened or prefetched (JudgeHome), kept on the device (per profile,
 *  under `key`) so the pad reopens without signal. */
export const OFFLINE_KEEP = 8;
function readOffline(key: string): Record<string, RoundPage> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, RoundPage> : {};
  } catch { return {}; }
}
function keepOffline(key: string, roundId: string, page: RoundPage) {
  const all = readOffline(key);
  delete all[roundId];
  const kept = Object.entries(all).slice(-(OFFLINE_KEEP - 1));
  try { localStorage.setItem(key, JSON.stringify(Object.fromEntries([...kept, [roundId, page]]))); } catch { /* full or blocked */ }
}

/** Judge home: load a round page now and keep it on the device (`key`), so its pad opens without
 *  signal later (e.g. the evening before). False when it couldn't be loaded. */
export async function keepRoundOffline(key: string, roundId: string): Promise<boolean> {
  const page = await fetchRoundPage(roundId);
  if (page) keepOffline(key, roundId, page);
  return !!page;
}

/** Load a round page in the background (e.g. the other category's round), so opening it is instant. */
export function prefetchRound(roundId: string, maxAgeMs = Infinity) {
  const at = pageAt.get(roundId);
  if (!pageCache.has(roundId) || (at !== undefined && Date.now() - at > maxAgeMs)) void fetchRoundPage(roundId);
}

const toState = (page: RoundPage): RoundData => ({
  round: page.round,
  category: page.category,
  categories: page.categories,
  boulders: page.boulders,
  starters: sortStarters(page.starters),
  results: new Map(page.results.map((r) => [resultKey(r.boulder_id, r.climber_id), r])),
  leadResults: new Map(page.lead_results.map((r) => [resultKey(r.boulder_id, r.climber_id), r])),
  totals: new Map(page.totals.map((r) => [r.climber_id, r])),
  appeals: page.appeals,
  loading: false,
});

/** Loads a round with its boulders, starters and results, and keeps results live via Realtime.
 *  `offlineKey`: keep the page on the device and show it when it can't be loaded (judge pad). */
export function useRoundData(roundId: string | undefined, { offlineKey, reuseMs = 0 }: { offlineKey?: string; reuseMs?: number } = {}): RoundData {
  const [state, setState] = useState<RoundData>(() => {
    const cached = roundId ? pageCache.get(roundId) : undefined;
    return cached ? toState(cached) : EMPTY;
  });

  useEffect(() => {
    if (!roundId) return;
    let cancelled = false;
    // A different round: show it from the cache when it's there (instant), never the previous
    // round's data; then load it fresh in one request (round_page).
    const cached = pageCache.get(roundId);
    setState(cached ? toState(cached) : EMPTY);
    // `reuseMs`: a copy fetched that recently is used as it is (the big screen prefetches the next round a
    // moment before showing it); live changes arrive through Realtime below
    const recent = reuseMs > 0 && cached && Date.now() - (pageAt.get(roundId) ?? 0) < reuseMs;
    if (!recent) pageCache.delete(roundId); // so this load fetches fresh data
    if (!recent) void fetchRoundPage(roundId).then((loaded) => {
      if (cancelled) return;
      if (loaded && offlineKey) keepOffline(offlineKey, roundId, loaded);
      const page = loaded ?? (offlineKey ? readOffline(offlineKey)[roundId] : undefined);
      setState(page ? { ...toState(page), offline: !loaded } : (s) => ({ ...s, loading: false }));
    });
    // Offline-capable (judge pad): back online, catch up with what others saved meanwhile.
    const reload = () => {
      pageCache.delete(roundId);
      void fetchRoundPage(roundId).then((page) => { if (!cancelled && page) { if (offlineKey) keepOffline(offlineKey, roundId, page); setState(toState(page)); } });
    };
    if (offlineKey) window.addEventListener('online', reload);

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
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'appeals', filter: `round_id=eq.${roundId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as Appeal;
          if (!row?.id) return;
          setState((s) => ({ ...s, appeals: payload.eventType === 'DELETE'
            ? s.appeals.filter((a) => a.id !== row.id)
            : [...s.appeals.filter((a) => a.id !== row.id), payload.new as Appeal] }));
        })
      .subscribe();

    return () => { cancelled = true; window.removeEventListener('online', reload); supabase.removeChannel(channel); };
  }, [roundId, offlineKey]);

  return state;
}
