import { describe, expect, it } from 'vitest';
import { RANK_CLASSES } from '../../../src/lib/rankings.ts';
import {
  parseSeason, RANKING_CODE_VERSION, rankingTable, TABLE_DISCIPLINES, TABLE_GENDERS, type RankingTable,
} from '../../../src/lib/rankingTables.ts';
import { seasonPayload } from '../../../src/lib/testdata/seasonPayload.ts';
import { buildDue, parseBuildBody, type Rpc } from './build.ts';

type Cache = Record<string, { payload: unknown; built_at: string }>;

/** The four RPCs over in-memory cache rows, like migration 035: due = no tables, or tables from another payload
 *  or code version (newest season first); stores go through JSON like jsonb. `calls` lists every call. */
function fakeDb(cache: Cache, opts: { refuse?: string[] } = {}) {
  const stored = new Map<string, { source: string; version: number; tables: RankingTable[] }>();
  const calls: string[] = [];
  const db: Rpc = {
    rpc: async (fn, args = {}) => {
      calls.push(`${fn} ${JSON.stringify(args)}`);
      if (fn === 'ranking_tables_due') {
        const due = Object.entries(cache)
          .filter(([s, c]) => stored.get(s)?.source !== c.built_at || stored.get(s)?.version !== args.p_version)
          .map(([season]) => ({ season })).sort((a, b) => b.season.localeCompare(a.season));
        return { data: due, error: null };
      }
      if (fn === 'ranking_tables_invalidate') {
        for (const s of stored.values()) s.source = '-infinity';
        return { data: null, error: null };
      }
      if (fn === 'ranking_tables_input') {
        const c = cache[args.p_season as string];
        return { data: c ? JSON.parse(JSON.stringify(c)) : null, error: null };
      }
      if (fn === 'store_ranking_tables') {
        if (opts.refuse?.includes(args.p_season as string)) return { data: false, error: null };
        stored.set(args.p_season as string, { source: args.p_source_built_at as string, version: args.p_code_version as number,
          tables: JSON.parse(JSON.stringify(args.p_tables)) });
        return { data: true, error: null };
      }
      return { data: null, error: { message: `unknown ${fn}` } };
    },
  };
  return { db, stored, calls };
}

const at = (s: number) => `2026-10-17T10:00:0${s}.123456+00:00`;
const cacheOf = (...seasons: string[]): Cache =>
  Object.fromEntries(seasons.map((s, i) => [s, { payload: seasonPayload(s), built_at: at(i) }]));

describe('rankings-build', () => {
  it('stores exactly the tables the page computes client-side from the same payload, with the code version', async () => {
    const cache = cacheOf('2024-25', '2026-27');
    const { db, stored } = fakeDb(cache);
    expect(await buildDue(db)).toEqual({ built: ['2026-27', '2024-25'], skipped: [], remaining: 0 });
    for (const [season, c] of Object.entries(cache)) {
      const s = stored.get(season)!;
      expect([s.source, s.version]).toEqual([c.built_at, RANKING_CODE_VERSION]);
      expect(s.tables).toHaveLength(16);
      // what the page gets from the database (JSON) for the payload season_rankings() returns
      const client = parseSeason(JSON.parse(JSON.stringify(c.payload)));
      for (const k of RANK_CLASSES) for (const g of TABLE_GENDERS) for (const d of TABLE_DISCIPLINES) {
        const table = s.tables.find((t) => t.rank_class === k && t.gender === g && t.discipline === d)!;
        expect(table).toStrictEqual(rankingTable(client, season, k, g, d));
      }
      expect(s.tables.some((t) => t.rows.length > 2)).toBe(true);
    }
  });

  it('at most `limit` seasons per call, newest first; the next calls work through the rest', async () => {
    const { db, calls } = fakeDb(cacheOf('2023-24', '2024-25', '2025-26', '2026-27', '2022-23'));
    expect(await buildDue(db)).toEqual({ built: ['2026-27', '2025-26'], skipped: [], remaining: 3 });
    expect(await buildDue(db)).toEqual({ built: ['2024-25', '2023-24'], skipped: [], remaining: 1 });
    expect(await buildDue(db)).toEqual({ built: ['2022-23'], skipped: [], remaining: 0 });
    calls.length = 0;
    expect(await buildDue(db)).toEqual({ built: [], skipped: [], remaining: 0 });
    expect(calls).toEqual([`ranking_tables_due {"p_version":${RANKING_CODE_VERSION}}`]);
    expect(await buildDue(db, { limit: 5 })).toEqual({ built: [], skipped: [], remaining: 0 });
  });

  it('all: every season due again (served meanwhile), worked through `limit` at a time', async () => {
    const { db, calls } = fakeDb(cacheOf('2024-25', '2025-26', '2026-27'));
    await buildDue(db, { limit: 5 });
    calls.length = 0;
    expect(await buildDue(db, { all: true })).toEqual({ built: ['2026-27', '2025-26'], skipped: [], remaining: 1 });
    expect(calls[0]).toBe('ranking_tables_invalidate {}');
    expect(await buildDue(db)).toEqual({ built: ['2024-25'], skipped: [], remaining: 0 });
  });

  it('tables of another code version are due', async () => {
    const { db } = fakeDb(cacheOf('2026-27'));
    await buildDue(db);
    expect(await buildDue(db, { version: RANKING_CODE_VERSION + 1 })).toEqual({ built: ['2026-27'], skipped: [], remaining: 0 });
  });

  it('a newer stored build is left alone', async () => {
    const { db } = fakeDb(cacheOf('2024-25', '2026-27'), { refuse: ['2026-27'] });
    expect(await buildDue(db)).toEqual({ built: ['2024-25'], skipped: ['2026-27'], remaining: 0 });
  });

  it('a database error fails the run', async () => {
    const db: Rpc = { rpc: async () => ({ data: null, error: { message: 'permission denied' } }) };
    await expect(buildDue(db)).rejects.toThrow('ranking_tables_due: permission denied');
  });

  it('body: empty, {}, or { all: true }', () => {
    expect(parseBuildBody('')).toEqual({ all: false });
    expect(parseBuildBody('{}')).toEqual({ all: false });
    expect(parseBuildBody('{"all":true}')).toEqual({ all: true });
    expect(parseBuildBody('{"all":"yes"}')).toEqual({ error: 'invalid all' });
    expect(parseBuildBody('[]')).toEqual({ error: 'invalid body' });
    expect(parseBuildBody('nope')).toEqual({ error: 'invalid body' });
  });
});
