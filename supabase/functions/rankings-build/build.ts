// The finished ranking tables of every season whose cached payload changed since its tables were built.
// The payload is the anonymous visitor's view (season_rankings_cache, migration 033); the tables come from the
// app's own ranking code (src/lib/rankingTables.ts → rankings.ts, criteria.ts), so the stored rows are exactly
// what the rankings page computes from the same payload. No Deno APIs here: e2e runs it under Node too.
import { parseSeason, seasonTables } from '../../../src/lib/rankingTables.ts';

/** The part of the Supabase client this needs (service role: the three RPCs are not granted to anyone else). */
export interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

function check<T>(r: { data: unknown; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export interface BuildSummary {
  /** Seasons whose tables were stored. */
  built: string[];
  /** Seasons a newer build had stored meanwhile (left as they are). */
  skipped: string[];
}

/** Builds and stores the due seasons (every cached season with `all`), one season at a time. */
export async function buildDue(db: Rpc, opts: { all?: boolean } = {}): Promise<BuildSummary> {
  const due = check<{ season: string }[]>(await db.rpc('ranking_tables_due', { p_all: opts.all ?? false }), 'ranking_tables_due') ?? [];
  const out: BuildSummary = { built: [], skipped: [] };
  for (const { season } of due) {
    const input = check<{ payload: unknown; built_at: string } | null>(
      await db.rpc('ranking_tables_input', { p_season: season }), `ranking_tables_input ${season}`);
    if (!input) continue; // no cached payload (any more)
    const tables = seasonTables(parseSeason(input.payload), season);
    const stored = check<boolean>(await db.rpc('store_ranking_tables', {
      p_season: season, p_source_built_at: input.built_at, p_tables: tables,
    }), `store_ranking_tables ${season}`);
    (stored ? out.built : out.skipped).push(season);
  }
  return out;
}

/** The request body (raw text): empty or `{}` (the due seasons), or `{ "all": true }` (every season, e.g. after
 *  the ranking code changed). */
export function parseBuildBody(raw: string): { all: boolean } | { error: string } {
  if (!raw.trim()) return { all: false };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { error: 'invalid body' };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid body' };
  const all = (body as { all?: unknown }).all;
  if (all !== undefined && typeof all !== 'boolean') return { error: 'invalid all' };
  return { all: all ?? false };
}
