// The finished ranking tables of the seasons whose cached payload changed since their tables were built, or
// whose tables come from another version of the ranking code. The payload is the anonymous visitor's view
// (season_rankings_cache, migration 033); the tables come from the app's own ranking code
// (src/lib/rankingTables.ts → rankings.ts, criteria.ts), so the stored rows are exactly what the rankings page
// computes from the same payload. No Deno APIs here: e2e runs it under Node too.
import { parseSeason, RANKING_CODE_VERSION, seasonTables } from '../../../src/lib/rankingTables.ts';

/** The part of the Supabase client this needs (service role: the RPCs are not granted to anyone else). */
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
  /** Seasons still due after this call (the next cron run continues). */
  remaining: number;
}

/** Seasons per call: each is ~0.8 MB of JSON to parse plus 16 tables, so one call stays well inside the edge
 *  runtime's CPU budget; the cron job calls again every minute while seasons are due. */
export const SEASONS_PER_CALL = 2;

/** Builds and stores up to `limit` due seasons, newest first. `all` first makes every stored season due (its
 *  tables are served until rebuilt). `version` is this code's RANKING_CODE_VERSION (a parameter for tests). */
export async function buildDue(db: Rpc, opts: { all?: boolean; limit?: number; version?: number } = {}): Promise<BuildSummary> {
  const version = opts.version ?? RANKING_CODE_VERSION;
  if (opts.all) check(await db.rpc('ranking_tables_invalidate', {}), 'ranking_tables_invalidate');
  const due = check<{ season: string }[]>(await db.rpc('ranking_tables_due', { p_version: version }), 'ranking_tables_due') ?? [];
  const now = due.slice(0, opts.limit ?? SEASONS_PER_CALL);
  const out: BuildSummary = { built: [], skipped: [], remaining: due.length - now.length };
  for (const { season } of now) {
    const input = check<{ payload: unknown; built_at: string } | null>(
      await db.rpc('ranking_tables_input', { p_season: season }), `ranking_tables_input ${season}`);
    if (!input) continue; // no cached payload (any more)
    const tables = seasonTables(parseSeason(input.payload), season);
    const stored = check<boolean>(await db.rpc('store_ranking_tables', {
      p_season: season, p_source_built_at: input.built_at, p_code_version: version, p_tables: tables,
    }), `store_ranking_tables ${season}`);
    (stored ? out.built : out.skipped).push(season);
  }
  return out;
}

/** The request body (raw text): empty or `{}` (the due seasons), or `{ "all": true }` (every season due again,
 *  e.g. after the ranking code changed). */
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
