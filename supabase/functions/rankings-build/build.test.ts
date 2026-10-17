import { describe, expect, it } from 'vitest';
import { RANK_CLASSES } from '../../../src/lib/rankings.ts';
import { parseSeason, rankingTable, TABLE_DISCIPLINES, TABLE_GENDERS, type RankingTable } from '../../../src/lib/rankingTables.ts';
import { seasonPayload } from '../../../src/lib/testdata/seasonPayload.ts';
import { buildDue, parseBuildBody, type Rpc } from './build.ts';

/** The three RPCs over in-memory cache rows; stores go through JSON like jsonb. `calls` lists every call. */
function fakeDb(cache: Record<string, { payload: unknown; built_at: string }>, opts: { refuse?: string[] } = {}) {
  const stored = new Map<string, { source: string; tables: RankingTable[] }>();
  const calls: string[] = [];
  const db: Rpc = {
    rpc: async (fn, args = {}) => {
      calls.push(`${fn} ${JSON.stringify(args)}`);
      if (fn === 'ranking_tables_due') {
        const due = Object.entries(cache).filter(([s, c]) => args.p_all || stored.get(s)?.source !== c.built_at).map(([season]) => ({ season }));
        return { data: due, error: null };
      }
      if (fn === 'ranking_tables_input') {
        const c = cache[args.p_season as string];
        return { data: c ? JSON.parse(JSON.stringify(c)) : null, error: null };
      }
      if (fn === 'store_ranking_tables') {
        if (opts.refuse?.includes(args.p_season as string)) return { data: false, error: null };
        stored.set(args.p_season as string, { source: args.p_source_built_at as string, tables: JSON.parse(JSON.stringify(args.p_tables)) });
        return { data: true, error: null };
      }
      return { data: null, error: { message: `unknown ${fn}` } };
    },
  };
  return { db, stored, calls };
}

describe('rankings-build', () => {
  const cache = {
    '2024-25': { payload: seasonPayload('2024-25'), built_at: '2026-10-17T10:00:00.123456+00:00' },
    '2026-27': { payload: seasonPayload('2026-27'), built_at: '2026-10-17T10:00:01.5+00:00' },
  };

  it('stores exactly the tables the page computes client-side from the same payload', async () => {
    const { db, stored } = fakeDb(cache);
    expect(await buildDue(db)).toEqual({ built: ['2024-25', '2026-27'], skipped: [] });
    for (const season of Object.keys(cache)) {
      const s = stored.get(season)!;
      expect(s.source).toBe(cache[season as keyof typeof cache].built_at);
      expect(s.tables).toHaveLength(16);
      // what the page gets from the database (JSON) for the payload season_rankings() returns
      const client = parseSeason(JSON.parse(JSON.stringify(cache[season as keyof typeof cache].payload)));
      for (const c of RANK_CLASSES) for (const g of TABLE_GENDERS) for (const d of TABLE_DISCIPLINES) {
        const row = s.tables.find((t) => t.rank_class === c && t.gender === g && t.discipline === d)!;
        expect(row).toStrictEqual(rankingTable(client, season, c, g, d));
      }
      expect(s.tables.some((t) => t.rows.length > 2)).toBe(true);
    }
  });

  it('builds only what changed; all rebuilds everything; a newer stored build is left alone', async () => {
    const { db, calls } = fakeDb(cache, { refuse: ['2026-27'] });
    expect(await buildDue(db)).toEqual({ built: ['2024-25'], skipped: ['2026-27'] });
    calls.length = 0;
    expect(await buildDue(db)).toEqual({ built: [], skipped: ['2026-27'] });
    expect(calls.filter((c) => c.startsWith('store_ranking_tables'))).toHaveLength(1);
    expect(await buildDue(db, { all: true })).toEqual({ built: ['2024-25'], skipped: ['2026-27'] });
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
