import { describe, expect, it } from 'vitest';
import type { Candidate } from '../_shared/ifsc.ts';
import { runSync, type Ifsc, type ResultRow, type Store, type WorldRow } from './sync.ts';

type Pending = Parameters<Store['upsertPending']>[0] & { status: 'pending' | 'ignored' };
const key = (r: ResultRow) => `${r.discipline}|${r.event_name}|${r.starts_on}`;
type Stored = Omit<ResultRow, 'event_type'> & { event_type: string };

/** In-memory store; `writes` lists every write call. */
function memStore(init: { linked?: [number, string][]; candidates?: Candidate[]; manual?: string[]; pending?: Pending[];
  world?: WorldRow[]; dismissed?: string[]; results?: [string, Stored[]][] } = {}) {
  const linked = new Map(init.linked ?? []);
  const results = new Map<string, Stored[]>(init.results ?? []);
  const pending = new Map((init.pending ?? []).map((p) => [p.ifsc_athlete_id, p]));
  const world = { rows: init.world ?? [], replaced: [] as { season: string; rows: unknown[]; asOf: string }[],
    replacedFor: [] as { season: string; climber: string; rows: unknown[]; asOf: string }[] };
  const writes: string[] = [];
  const store: Store = {
    linkedProfiles: async () => new Map(linked),
    candidates: async (birthday) => (init.candidates ?? []).filter((c) => c.birth_date === birthday),
    manualGroups: async () => new Set(init.manual ?? []),
    dismissed: async () => new Set(init.dismissed ?? []),
    pendingResults: async () => new Map([...pending].map(([id, p]) => [id, { status: p.status, results: structuredClone(p.results) }])),
    clearPending: async (id) => { writes.push(`clear ${id}`); pending.delete(id); },
    insertResults: async (climber, rows) => {
      writes.push(`insert ${climber}`);
      const have = results.get(climber) ?? [];
      const fresh = rows.filter((r) => !have.some((h) => key(h) === key(r)));
      results.set(climber, [...have, ...fresh]);
      return fresh.length;
    },
    correctResults: async (climber, rows) => {
      writes.push(`correct ${climber}`);
      let n = 0;
      for (const h of results.get(climber) ?? []) {
        const r = rows.find((x) => x.ifsc_event_id === h.ifsc_event_id && x.ifsc_dcat_id === h.ifsc_dcat_id);
        if (!r || h.event_type === 'manual' || (h.place === r.place && h.field_size === r.field_size && h.reached === r.reached)) continue;
        Object.assign(h, { place: r.place, field_size: r.field_size, reached: r.reached });
        n++;
      }
      return n;
    },
    linkProfile: async (profile, ifscId) => { writes.push(`link ${profile}`); linked.set(ifscId, profile); },
    upsertPending: async (p) => {
      writes.push(`pending ${p.ifsc_athlete_id}`);
      const old = pending.get(p.ifsc_athlete_id);
      const merged = [...(old?.results ?? []), ...p.results.filter((r) => !old?.results.some((o) => key(o) === key(r)))];
      pending.set(p.ifsc_athlete_id, { ...p, results: merged, status: old?.status ?? 'pending' });
    },
    worldRows: async () => world.rows,
    replaceWorld: async (season, rows, asOf) => { writes.push('world'); world.replaced.push({ season, rows, asOf }); },
    replaceWorldFor: async (season, climber, rows, asOf) => {
      writes.push(`world ${climber}`);
      world.replacedFor.push({ season, climber, rows, asOf });
    },
  };
  return { store, linked, results, pending, world, writes };
}

const rnk = (athlete_id: number, rank: number | null, country = 'ISR', firstname = 'X', lastname = 'Y') =>
  ({ athlete_id, firstname, lastname, country, rank, rounds: [{ round_name: 'Qualification', score: '1T', rank }] });

/** The fixtures below are written per league (the IFSC shape until 2026-10); IFSC now answers league pages only when
 * signed in. This serves them as IFSC does now: the season page lists the events with their league_season_id, each
 * event page (/api/v1/events/<id>) its d_cats; the league pages are removed, so a request for one fails the test. */
function publicShape(paths: Record<string, unknown>) {
  for (const [path, season] of Object.entries(paths)) {
    if (!/^\/api\/v1\/seasons\/\d+$/.test(path) || !season) continue;
    const events: unknown[] = [];
    for (const lg of (season as { leagues: { url: string }[] }).leagues) {
      const league = paths[lg.url] as { events?: { event_id: number; d_cats: Record<string, unknown>[] }[] } | undefined;
      for (const { d_cats, ...ev } of league?.events ?? []) {
        events.push({ ...ev, league_season_id: Number(lg.url.split('/').pop()) });
        paths[`/api/v1/events/${ev.event_id}`] = { d_cats: d_cats.map(({ id, name, result_url, ...dc }) =>
          ({ ...dc, ...(id === undefined ? {} : { dcat_id: id }), dcat_name: name, full_results_url: result_url })) };
      }
    }
    paths[path] = { ...(season as object), events };
  }
  for (const path of Object.keys(paths)) if (path.startsWith('/api/v1/season_leagues/')) delete paths[path];
}

/** IFSC API of one season (2026): a World Cup with BOULDER Men (ISR 101 linked, 102 matchable, 103 unknown, 104 no place).
 * `raw` paths are served as given, after the reshaping. */
function api(over: Record<string, unknown> = {}, raw: Record<string, unknown> = {}) {
  const paths: Record<string, unknown> = {
    '/api/v1/': { seasons: [{ name: '2027', url: '/api/v1/seasons/39' }, { name: '2026', url: '/api/v1/seasons/38' },
      { name: '2025', url: '/api/v1/seasons/37' }] },
    '/api/v1/seasons/38': { leagues: [{ name: 'World Cups and World Championships', url: '/api/v1/season_leagues/457' },
      { name: 'Games', url: '/api/v1/season_leagues/999' }] },
    '/api/v1/seasons/39': { leagues: [] },
    '/api/v1/season_leagues/457': { events: [
      { event_id: 1500, event: 'IFSC World Cup Prague 2026', local_start_date: '2026-09-20', d_cats: [
        { id: 3, name: 'BOULDER Men', status: 'finished', result_url: '/api/v1/events/1500/result/3' },
        { id: 4, name: 'SPEED Men', status: 'finished', result_url: '/api/v1/events/1500/result/4' },
        { id: 7, name: 'BOULDER Women', status: 'active', result_url: '/api/v1/events/1500/result/7' }] },
      { event_id: 1490, event: 'IFSC World Cup Bern 2026', local_start_date: '2026-06-01', d_cats: [
        { id: 3, name: 'BOULDER Men', status: 'finished', result_url: '/api/v1/events/1490/result/3' }] },
      { event_id: 1501, event: 'Some Open 2026', local_start_date: '2026-09-25', d_cats: [
        { name: 'BOULDER Men', status: 'finished', result_url: '/api/v1/events/1501/result/3' }] }] },
    '/api/v1/events/1500/result/3': { ranking: [rnk(200, 1, 'FRA'), rnk(101, 5), rnk(102, 12, 'ISR', 'Yonatan', 'Cohen'),
      rnk(103, 30), rnk(104, null)] },
    '/api/v1/events/1501/result/3': { ranking: [rnk(101, 2)] },
    '/api/v1/athletes/102': { firstname: 'Yonatan', lastname: 'COHEN', gender: 'male', birthday: '2008-03-01', country: 'ISR' },
    '/api/v1/athletes/103': { firstname: 'Dan', lastname: 'LEVI', gender: 'male', birthday: '2009-01-01', country: 'ISR' },
  };
  for (const d of ['2026-10-17', '2027-01-01']) {
    paths[`/api/v1/cuwr/3?date=${d}`] = { ranking: [{ athlete_id: 200, rank: 1, country: 'FRA' },
      { athlete_id: 101, rank: 40, country: 'ISR' }, { athlete_id: 102, rank: 77, country: 'ISR' }] };
    for (const c of [7, 1, 5]) paths[`/api/v1/cuwr/${c}?date=${d}`] = { ranking: [{ athlete_id: 300 + c, rank: 1, country: 'USA' }] };
  }
  Object.assign(paths, over);
  publicShape(paths);
  Object.assign(paths, raw);
  const calls: string[] = [];
  const ifsc: Ifsc = {
    get: async (path) => {
      calls.push(path);
      if (!(path in paths)) throw new Error(`unexpected ${path}`);
      return structuredClone(paths[path]);
    },
  };
  return { ifsc, calls };
}

const p2: Candidate = { id: 'p2', full_name: 'Yonatan Cohen', full_name_he: 'יונתן כהן', gender: 'male', birth_date: '2008-03-01' };
const base = () => memStore({ linked: [[101, 'p1']], candidates: [p2] });
const row = (over: Partial<ResultRow> = {}): ResultRow => ({ season: '2026-27', discipline: 'boulder', event_type: 'world_cup',
  event_name: 'IFSC World Cup Bern 2026 (BOULDER Men)', starts_on: '2026-06-01', place: 9, field_size: 60, reached: 'semifinal',
  ifsc_event_id: 1490, ifsc_dcat_id: 3, ...over });

/** Prague plus a second category (Innsbruck, 101 only), so one broken category is not "every request failing". */
const twoCategories: Record<string, unknown> = {
  '/api/v1/season_leagues/457': { events: [
    { event_id: 1500, event: 'IFSC World Cup Prague 2026', local_start_date: '2026-09-20', d_cats: [
      { id: 3, name: 'BOULDER Men', status: 'finished', result_url: '/api/v1/events/1500/result/3' }] },
    { event_id: 1503, event: 'IFSC World Cup Innsbruck 2026', local_start_date: '2026-10-10', d_cats: [
      { id: 3, name: 'BOULDER Men', status: 'finished', result_url: '/api/v1/events/1503/result/3' }] }] },
  '/api/v1/events/1503/result/3': { ranking: [rnk(101, 4)] },
};

describe('runSync', () => {
  it('imports linked and newly matched athletes, keeps the unknown one pending', async () => {
    const s = base();
    const { ifsc, calls } = api();
    expect(await runSync(ifsc, s.store, '2026-10-17')).toEqual({ added: 2, updated: 0, linked: 1, pending: 1, world: 2, warnings: [] });
    expect(s.results.get('p1')).toEqual([{ season: '2026-27', discipline: 'boulder', event_type: 'world_cup',
      event_name: 'IFSC World Cup Prague 2026 (BOULDER Men)', starts_on: '2026-09-20', place: 5, field_size: 4,
      reached: 'qualification', ifsc_event_id: 1500, ifsc_dcat_id: 3 }]);
    expect(s.results.get('p2')?.map((r) => r.place)).toEqual([12]);
    expect(s.linked.get(102)).toBe('p2');
    expect(s.pending.get(103)).toMatchObject({ firstname: 'Dan', lastname: 'LEVI', gender: 'male', birthday: '2009-01-01',
      suggested_profile: null, score: null, status: 'pending' });
    expect(s.pending.get(103)?.results).toHaveLength(1);
    // only 2026 is fetched; out-of-window and non-ILCA events, other leagues, speed and unfinished categories are not
    expect(calls).not.toContain('/api/v1/seasons/37');
    expect(calls).not.toContain('/api/v1/seasons/39');
    expect(calls.filter((c) => c.includes('/result/'))).toEqual(['/api/v1/events/1500/result/3']);
    // event pages only for ILCA events in the window; never a league page (signed-in only at IFSC since 2026-10)
    expect(calls.filter((c) => /^\/api\/v1\/events\/\d+$/.test(c))).toEqual(['/api/v1/events/1500']);
    expect(calls.some((c) => c.includes('season_leagues'))).toBe(false);
    // linked athletes need no details; the athlete without a place is skipped entirely
    expect(calls.filter((c) => c.startsWith('/api/v1/athletes/'))).toEqual(['/api/v1/athletes/102', '/api/v1/athletes/103']);
    expect(s.world.replaced).toEqual([{ season: '2026-27', asOf: '2026-10-17', rows: [
      { climber_id: 'p1', discipline: 'boulder', position: 40 }, { climber_id: 'p2', discipline: 'boulder', position: 77 }] }]);
  });

  it('adds nothing on a second run; a pending athlete seen again stays one row with merged results', async () => {
    const s = base();
    await runSync(api().ifsc, s.store, '2026-10-17');
    expect(await runSync(api().ifsc, s.store, '2026-10-17')).toEqual({ added: 0, updated: 0, linked: 0, pending: 1, world: 2, warnings: [] });
    expect([...s.pending.keys()]).toEqual([103]);
    expect(s.pending.get(103)?.results.map((r) => r.event_name)).toEqual(['IFSC World Cup Prague 2026 (BOULDER Men)']);
  });

  it('skips events without an ILCA type and takes the dcat id from result_url when the d_cat has no id', async () => {
    const s = base();
    const { ifsc } = api({
      '/api/v1/season_leagues/457': { events: [{ event_id: 1502, event: 'IFSC Europe Cup Kranj 2026', local_start_date: '2026-10-01',
        d_cats: [{ name: 'LEAD Women', status: 'finished', result_url: '/api/v1/events/1502/result/5' }] }] },
      '/api/v1/events/1502/result/5': { ranking: [rnk(101, 3)] },
    });
    await runSync(ifsc, s.store, '2026-10-17');
    expect(s.results.get('p1')).toMatchObject([{ discipline: 'lead', event_type: 'european_cup', ifsc_event_id: 1502, ifsc_dcat_id: 5,
      event_name: 'IFSC Europe Cup Kranj 2026 (LEAD Women)', field_size: 1 }]);
  });

  it('skips an event whose page fails with a warning, keeps the other events', async () => {
    const s = base();
    const { ifsc } = api(twoCategories);
    const failing: Ifsc = { get: async (p) => { if (p === '/api/v1/events/1500') throw new Error(`IFSC ${p}: HTTP 401`); return ifsc.get(p); } };
    const sum = await runSync(failing, s.store, '2026-10-17');
    expect(sum.warnings).toEqual(['IFSC /api/v1/events/1500: HTTP 401']);
    expect(s.results.get('p1')?.map((r) => r.ifsc_event_id)).toEqual([1503]);
    expect(sum.world).toBe(1);
  });

  it('merges a pending athlete\'s results seen in another event', async () => {
    const s = base();
    await runSync(api().ifsc, s.store, '2026-10-17');
    const again = api({
      '/api/v1/season_leagues/457': { events: [{ event_id: 1503, event: 'IFSC World Cup Innsbruck 2026', local_start_date: '2026-10-10',
        d_cats: [{ id: 3, name: 'BOULDER Men', status: 'finished', result_url: '/api/v1/events/1503/result/3' }] }] },
      '/api/v1/events/1503/result/3': { ranking: [rnk(103, 20)] },
    });
    expect((await runSync(again.ifsc, s.store, '2026-10-17')).pending).toBe(1);
    expect(s.pending.size).toBe(1);
    expect(s.pending.get(103)?.results.map((r) => r.ifsc_event_id)).toEqual([1500, 1503]);
  });

  it('keeps an ignored athlete ignored while merging results', async () => {
    const s = memStore({ linked: [[101, 'p1']], candidates: [p2],
      pending: [{ ifsc_athlete_id: 103, firstname: 'Dan', lastname: 'LEVI', gender: 'male', birthday: '2009-01-01',
        suggested_profile: null, score: null, results: [row()], status: 'ignored' }] });
    expect((await runSync(api().ifsc, s.store, '2026-10-17')).pending).toBe(0);
    expect(s.pending.get(103)?.status).toBe('ignored');
    expect(s.pending.get(103)?.results).toHaveLength(2);
    expect(s.pending.get(103)?.birthday).toBeNull(); // only needed for matching
  });

  it('skips groups that hold ILCA-published (manual) points', async () => {
    const s = memStore({ linked: [[101, 'p1']], candidates: [p2], manual: ['2026-27|senior|boulder'] });
    expect(await runSync(api().ifsc, s.store, '2026-10-17')).toEqual({ added: 0, updated: 0, linked: 1, pending: 1, world: 2, warnings: [] });
    expect(s.results.get('p1') ?? []).toEqual([]);
  });

  it('skips results an admin deleted (ifsc_dismissed), fresh or waiting', async () => {
    const s = memStore({ linked: [[101, 'p1'], [108, 'p8']], candidates: [p2], dismissed: ['p1|1500|3', 'p8|1490|3'],
      pending: [{ ifsc_athlete_id: 108, firstname: 'A', lastname: 'B', gender: null, birthday: null, suggested_profile: null,
        score: null, status: 'pending', results: [row(), row({ event_name: 'Other (BOULDER Men)', ifsc_event_id: 1491 })] }] });
    expect((await runSync(api().ifsc, s.store, '2026-10-17')).added).toBe(2); // p2: Prague; p8: Other
    expect(s.results.get('p1') ?? []).toEqual([]);
    expect(s.results.get('p8')?.map((r) => r.ifsc_event_id)).toEqual([1491]);
    expect(s.pending.has(108)).toBe(false);
  });

  it('onlyAthlete skips dismissed results too', async () => {
    const s = memStore({ linked: [[103, 'p3']], dismissed: ['p3|1490|3'],
      pending: [{ ifsc_athlete_id: 103, firstname: 'Dan', lastname: 'LEVI', gender: null, birthday: null,
        suggested_profile: null, score: null, status: 'pending', results: [row()] }] });
    expect((await runSync(api().ifsc, s.store, '2026-10-17', { onlyAthlete: 103 })).added).toBe(0);
    expect(s.results.get('p3') ?? []).toEqual([]);
    expect(s.pending.has(103)).toBe(false);
  });

  it('counts youth events in the youth class', async () => {
    const s = memStore({ linked: [[101, 'p1']], manual: ['2026-27|senior|boulder'] });
    const { ifsc } = api({
      '/api/v1/season_leagues/457': { events: [{ event_id: 1504, event: 'World Climbing Europe Youth Series Soure 2026',
        local_start_date: '2026-10-01', d_cats: [{ id: 825, name: 'BOULDER U19 Men', status: 'finished', result_url: '/api/v1/events/1504/result/825' }] }] },
      '/api/v1/events/1504/result/825': { ranking: [rnk(101, 7)] },
    });
    expect((await runSync(ifsc, s.store, '2026-10-17')).added).toBe(1);
    expect(s.results.get('p1')?.[0]).toMatchObject({ event_type: 'european_youth_cup', ifsc_dcat_id: 825 });
  });

  it.each([
    ['a season page without events', {}, { '/api/v1/seasons/38': { leagues: [] } }],
    ['a failing season list', { '/api/v1/': undefined }],
    ['every category and world-list request failing', { '/api/v1/events/1500/result/3': undefined, '/api/v1/events/1503/result/3': undefined,
      ...Object.fromEntries([3, 7, 1, 5].map((c) => [`/api/v1/cuwr/${c}?date=2026-10-17`, undefined])) }],
    ['every event page failing', {}, { '/api/v1/events/1500': undefined, '/api/v1/events/1503': undefined }],
  ])('rejects on %s without writing anything', async (_, over, raw: Record<string, unknown> = {}) => {
    const s = base();
    const o = { ...twoCategories, ...over, ...raw } as Record<string, unknown>;
    const { ifsc } = api({ ...twoCategories, ...over }, raw);
    const failing: Ifsc = { get: async (p) => { if (p in o && o[p] === undefined) throw new Error('HTTP 500'); return ifsc.get(p); } };
    await expect(runSync(failing, s.store, '2026-10-17')).rejects.toThrow();
    expect(s.writes).toEqual([]);
  });

  it.each([
    ['an error object', { error: 'not found' }],
    ['a failing request', undefined],
    ['a category without an id', 'no id'],
  ])('skips a category with %s, keeps the rest of the run and logs a warning', async (_, bad) => {
    const s = base();
    const over: Record<string, unknown> = { ...twoCategories };
    if (bad === 'no id') {
      over['/api/v1/season_leagues/457'] = { events: [...(twoCategories['/api/v1/season_leagues/457'] as { events: unknown[] }).events,
        { event_id: 1505, event: 'IFSC World Cup Keqiao 2026', local_start_date: '2026-10-01',
          d_cats: [{ name: 'BOULDER Men', status: 'finished', result_url: '/api/v1/results/x' }] }] };
      over['/api/v1/results/x'] = { ranking: [rnk(101, 1)] };
    } else over['/api/v1/events/1500/result/3'] = bad;
    const { ifsc } = api(over);
    const failing: Ifsc = { get: async (p) => { if (p in over && over[p] === undefined) throw new Error(`IFSC ${p}: HTTP 404`); return ifsc.get(p); } };
    const sum = await runSync(failing, s.store, '2026-10-17');
    expect(sum.warnings).toHaveLength(1);
    expect(sum.warnings[0]).toContain(bad === 'no id' ? 'Keqiao' : '/api/v1/events/1500/result/3');
    // Innsbruck still comes in; with a broken Prague nothing of Prague is written (102, 103 only appear there)
    expect(s.results.get('p1')?.map((r) => r.ifsc_event_id)).toEqual(bad === 'no id' ? [1500, 1503] : [1503]);
    if (bad !== 'no id') expect([...s.pending.keys(), ...s.linked.keys()]).toEqual([101]);
    expect(sum.world).toBe(bad === 'no id' ? 2 : 1);
  });

  it.each([
    ['a failing request', undefined],
    ['an error object', { error: 'not found' }],
  ])('skips an athlete whose details come back with %s', async (_, bad) => {
    const s = base();
    const o: Record<string, unknown> = { '/api/v1/athletes/102': bad };
    const { ifsc } = api(o);
    const failing: Ifsc = { get: async (p) => { if (p in o && o[p] === undefined) throw new Error(`IFSC ${p}: HTTP 500`); return ifsc.get(p); } };
    const sum = await runSync(failing, s.store, '2026-10-17');
    expect(sum).toMatchObject({ added: 1, linked: 0, pending: 1 });
    expect(sum.warnings).toEqual([expect.stringContaining('/api/v1/athletes/102')]);
    expect(s.linked.has(102)).toBe(false);
    expect(s.pending.has(102)).toBe(false);
    expect(s.pending.has(103)).toBe(true);
  });

  it.each([
    ['a world ranking without a list', { '/api/v1/cuwr/5?date=2026-10-17': { error: 'x' } }],
    ['an empty world ranking', { '/api/v1/cuwr/7?date=2026-10-17': { ranking: [] } }],
  ])('on %s leaves the stored world ranking alone and imports the results', async (_, over) => {
    const s = base();
    const sum = await runSync(api(over).ifsc, s.store, '2026-10-17');
    expect(sum).toMatchObject({ added: 2, linked: 1, pending: 1, world: 0 });
    expect(sum.warnings).toEqual([expect.stringContaining('world ranking')]);
    expect(s.world.replaced).toEqual([]);
  });

  it('two categories failing while the world lists answer: an ok run with warnings, the world written', async () => {
    const s = base();
    const o: Record<string, unknown> = { ...twoCategories, '/api/v1/events/1500/result/3': undefined, '/api/v1/events/1503/result/3': undefined };
    const { ifsc } = api(o);
    const failing: Ifsc = { get: async (p) => { if (p in o && o[p] === undefined) throw new Error(`IFSC ${p}: HTTP 404`); return ifsc.get(p); } };
    const sum = await runSync(failing, s.store, '2026-10-17');
    expect(sum.warnings).toHaveLength(2);
    expect(sum.world).toBe(1); // p1 (linked); 102 was never seen, so not linked
    expect(s.world.replaced).toHaveLength(1);
  });

  it('exactly one category, failing: an ok run with a warning (one request is not an outage)', async () => {
    const s = base();
    const o: Record<string, unknown> = { '/api/v1/events/1500/result/3': undefined };
    const { ifsc } = api(o);
    const failing: Ifsc = { get: async (p) => { if (p in o) throw new Error(`IFSC ${p}: HTTP 404`); return ifsc.get(p); } };
    const sum = await runSync(failing, s.store, '2026-10-17');
    expect(sum.warnings).toEqual([expect.stringContaining('/api/v1/events/1500/result/3')]);
    expect(sum.world).toBe(1);
  });

  it('tried = 1: one failing category and no world list due (after January) is a warning, not a failed run', async () => {
    const s = memStore({ linked: [[101, 'p1']], world: [{ climber_id: 'p1', discipline: 'boulder', position: 40, as_of: '2027-01-01' }] });
    const o: Record<string, unknown> = {
      '/api/v1/seasons/38': { leagues: [] },
      '/api/v1/seasons/39': { leagues: [{ name: 'World Cups and World Championships', url: '/api/v1/season_leagues/500' }] },
      '/api/v1/season_leagues/500': { events: [{ event_id: 1600, event: 'IFSC World Cup Keqiao 2027', local_start_date: '2027-03-01',
        d_cats: [{ id: 3, name: 'BOULDER Men', status: 'finished', result_url: '/api/v1/events/1600/result/3' }] }] },
    };
    const { ifsc, calls } = api(o);
    const failing: Ifsc = { get: async (p) => { if (p === '/api/v1/events/1600/result/3') throw new Error(`IFSC ${p}: HTTP 404`); return ifsc.get(p); } };
    const sum = await runSync(failing, s.store, '2027-03-05');
    expect(sum).toEqual({ added: 0, updated: 0, linked: 0, pending: 0, world: 0, warnings: [expect.stringContaining('1600')] });
    expect(calls.some((c) => c.includes('cuwr'))).toBe(false);
  });

  it('does not correct rows in a group with ILCA-published (manual) points', async () => {
    const s = memStore({ linked: [[101, 'p1']], manual: ['2026-27|senior|boulder'], results: [['p1', [{ season: '2026-27', discipline: 'boulder',
      event_type: 'world_cup', event_name: 'IFSC World Cup Prague 2026 (BOULDER Men)', starts_on: '2026-09-20', ifsc_event_id: 1500,
      ifsc_dcat_id: 3, place: 6, field_size: 70, reached: 'semifinal' }]]] });
    expect((await runSync(api().ifsc, s.store, '2026-10-17')).updated).toBe(0);
    expect(s.results.get('p1')).toMatchObject([{ place: 6, field_size: 70, reached: 'semifinal' }]);
  });

  it('never links an ignored athlete by itself, even on a confident match', async () => {
    const s = memStore({ linked: [[101, 'p1']], candidates: [p2], pending: [{ ifsc_athlete_id: 102, firstname: 'IFSC', lastname: '#102',
      gender: null, birthday: null, suggested_profile: null, score: null, status: 'ignored', results: [] }] });
    const sum = await runSync(api().ifsc, s.store, '2026-10-17');
    expect(sum.linked).toBe(0);
    expect(s.linked.has(102)).toBe(false);
    expect(s.pending.get(102)).toMatchObject({ status: 'ignored', firstname: 'Yonatan', lastname: 'COHEN', suggested_profile: 'p2' });
  });

  it('corrects place, field size and round of recent IFSC rows, never manual ones', async () => {
    const prague = { season: '2026-27', discipline: 'boulder' as const, event_name: 'IFSC World Cup Prague 2026 (BOULDER Men)',
      starts_on: '2026-09-20', ifsc_event_id: 1500, ifsc_dcat_id: 3 };
    const s = memStore({ linked: [[101, 'p1'], [102, 'p2']], results: [
      ['p1', [{ ...prague, event_type: 'world_cup', place: 6, field_size: 70, reached: 'semifinal' }]],
      ['p2', [{ ...prague, event_type: 'manual', place: 1, field_size: 1, reached: 'final' }]]] });
    const sum = await runSync(api().ifsc, s.store, '2026-10-17');
    expect(sum.updated).toBe(1);
    expect(s.results.get('p1')).toMatchObject([{ place: 5, field_size: 4, reached: 'qualification' }]);
    expect(s.results.get('p2')).toMatchObject([{ place: 1, field_size: 1, reached: 'final' }]);
    expect((await runSync(api().ifsc, s.store, '2026-10-17')).updated).toBe(0);
  });

  it('on/after 1 January fetches the official 1 January list once', async () => {
    const s = base();
    const { ifsc, calls } = api({ '/api/v1/seasons/38': { leagues: [] } });
    const sum = await runSync(ifsc, s.store, '2027-01-05');
    expect(calls).toContain('/api/v1/seasons/39'); // 60 days back reaches 2026: both years
    expect(calls).toContain('/api/v1/seasons/38');
    expect(calls).toContain('/api/v1/cuwr/3?date=2027-01-01');
    expect(s.world.replaced).toEqual([{ season: '2026-27', asOf: '2027-01-01',
      rows: [{ climber_id: 'p1', discipline: 'boulder', position: 40 }] }]);
    expect(sum.world).toBe(1);
  });

  it('leaves the official list alone after January', async () => {
    const s = memStore({ linked: [[101, 'p1']], world: [{ climber_id: 'p1', discipline: 'boulder', position: 40, as_of: '2027-01-01' }] });
    const { ifsc, calls } = api({ '/api/v1/seasons/38': { leagues: [] } });
    expect((await runSync(ifsc, s.store, '2027-03-05')).world).toBe(0);
    expect(calls.some((c) => c.includes('cuwr'))).toBe(false);
    expect(calls).not.toContain('/api/v1/seasons/38'); // March: 60 days back stays in 2027
    expect(s.world.replaced).toEqual([]);
  });

  it('February: a newly linked athlete gets their 1 January positions; nobody else is touched', async () => {
    const official: WorldRow = { climber_id: 'p1', discipline: 'boulder', position: 40, as_of: '2027-01-01' };
    const s = memStore({ linked: [[101, 'p1']], candidates: [p2], world: [official] });
    const o: Record<string, unknown> = {
      '/api/v1/seasons/38': { leagues: [] },
      '/api/v1/seasons/39': { leagues: [{ name: 'World Cups and World Championships', url: '/api/v1/season_leagues/500' }] },
      '/api/v1/season_leagues/500': { events: [{ event_id: 1600, event: 'IFSC World Cup Keqiao 2027', local_start_date: '2027-02-01',
        d_cats: [{ id: 3, name: 'BOULDER Men', status: 'finished', result_url: '/api/v1/events/1600/result/3' }] }] },
      '/api/v1/events/1600/result/3': { ranking: [rnk(101, 3), rnk(102, 9, 'ISR', 'Yonatan', 'Cohen')] },
    };
    const { ifsc, calls } = api(o);
    const sum = await runSync(ifsc, s.store, '2027-02-10');
    expect(sum).toMatchObject({ linked: 1, world: 1, warnings: [] });
    expect(calls).toContain('/api/v1/cuwr/3?date=2027-01-01');
    expect(s.world.replaced).toEqual([]);
    expect(s.world.replacedFor).toEqual([{ season: '2026-27', climber: 'p2', asOf: '2027-01-01',
      rows: [{ climber_id: 'p2', discipline: 'boulder', position: 77 }] }]);
    // the same run without a new link asks IFSC for no world list
    const again = api(o);
    expect((await runSync(again.ifsc, s.store, '2027-02-11')).world).toBe(0);
    expect(again.calls.some((c) => c.includes('cuwr'))).toBe(false);
  });

  it('February: a failing 1 January list for a new link is a warning; the link and results still go in', async () => {
    const s = memStore({ linked: [[101, 'p1']], candidates: [p2],
      world: [{ climber_id: 'p1', discipline: 'boulder', position: 40, as_of: '2027-01-01' }] });
    const o: Record<string, unknown> = {
      '/api/v1/seasons/38': { leagues: [] },
      '/api/v1/seasons/39': { leagues: [{ name: 'World Cups and World Championships', url: '/api/v1/season_leagues/500' }] },
      '/api/v1/season_leagues/500': { events: [{ event_id: 1600, event: 'IFSC World Cup Keqiao 2027', local_start_date: '2027-02-01',
        d_cats: [{ id: 3, name: 'BOULDER Men', status: 'finished', result_url: '/api/v1/events/1600/result/3' }] }] },
      '/api/v1/events/1600/result/3': { ranking: [rnk(102, 9, 'ISR', 'Yonatan', 'Cohen')] },
      '/api/v1/cuwr/7?date=2027-01-01': { error: 'x' },
    };
    const sum = await runSync(api(o).ifsc, s.store, '2027-02-10');
    expect(sum).toMatchObject({ linked: 1, added: 1, world: 0, warnings: [expect.stringContaining('world ranking')] });
    expect(s.world.replacedFor).toEqual([]);
  });

  it('during January re-fetches the 1 January list and replaces it only when IFSC revised it', async () => {
    const stored: WorldRow = { climber_id: 'p1', discipline: 'boulder', position: 40, as_of: '2027-01-01' };
    const same = memStore({ linked: [[101, 'p1']], world: [stored] });
    const { ifsc, calls } = api({ '/api/v1/seasons/38': { leagues: [] } });
    expect((await runSync(ifsc, same.store, '2027-01-20')).world).toBe(0);
    expect(calls).toContain('/api/v1/cuwr/3?date=2027-01-01');
    expect(same.world.replaced).toEqual([]);

    const revised = memStore({ linked: [[101, 'p1']], world: [{ ...stored, position: 41 }] });
    expect((await runSync(api({ '/api/v1/seasons/38': { leagues: [] } }).ifsc, revised.store, '2027-01-31')).world).toBe(1);
    expect(revised.world.replaced).toEqual([{ season: '2026-27', asOf: '2027-01-01',
      rows: [{ climber_id: 'p1', discipline: 'boulder', position: 40 }] }]);
  });

  it('onlyAthlete writes the newly linked athlete\'s world positions from the current list', async () => {
    const s = memStore({ linked: [[101, 'p1'], [102, 'p2']],
      pending: [{ ifsc_athlete_id: 102, firstname: 'Yonatan', lastname: 'COHEN', gender: null, birthday: null,
        suggested_profile: null, score: null, status: 'pending', results: [row()] }] });
    expect(await runSync(api().ifsc, s.store, '2026-10-17', { onlyAthlete: 102 })).toMatchObject({ added: 1, world: 1 });
    expect(s.world.replacedFor).toEqual([{ season: '2026-27', climber: 'p2', asOf: '2026-10-17',
      rows: [{ climber_id: 'p2', discipline: 'boulder', position: 77 }] }]);
    expect(s.world.replaced).toEqual([]);
    // after 1 January: the official list
    const later = memStore({ linked: [[102, 'p2']] });
    const { ifsc, calls } = api();
    await runSync(ifsc, later.store, '2027-03-05', { onlyAthlete: 102 });
    expect(calls).toContain('/api/v1/cuwr/3?date=2027-01-01');
    expect(later.world.replacedFor[0]).toMatchObject({ climber: 'p2', asOf: '2027-01-01' });
  });

  it('onlyAthlete still imports when the world ranking fails', async () => {
    const s = memStore({ linked: [[103, 'p3']], pending: [{ ifsc_athlete_id: 103, firstname: 'Dan', lastname: 'LEVI', gender: null,
      birthday: null, suggested_profile: null, score: null, status: 'pending', results: [row()] }] });
    const sum = await runSync(api({ '/api/v1/cuwr/1?date=2026-10-17': { error: 'x' } }).ifsc, s.store, '2026-10-17', { onlyAthlete: 103 });
    expect(sum).toMatchObject({ added: 1, world: 0, warnings: [expect.stringContaining('world ranking')] });
    expect(s.world.replacedFor).toEqual([]);
  });

  it('onlyAthlete imports that athlete\'s waiting results, asking IFSC only for the world ranking', async () => {
    const s = memStore({ linked: [[103, 'p3']], manual: ['2025-26|senior|boulder'],
      pending: [{ ifsc_athlete_id: 103, firstname: 'Dan', lastname: 'LEVI', gender: 'male', birthday: '2009-01-01',
        suggested_profile: null, score: null, status: 'pending',
        results: [row(), row({ season: '2025-26', event_name: 'Old (BOULDER Men)', starts_on: '2025-06-01' })] },
      { ifsc_athlete_id: 105, firstname: 'A', lastname: 'B', gender: null, birthday: null, suggested_profile: null, score: null,
        status: 'pending', results: [row()] }] });
    const { ifsc, calls } = api();
    expect(await runSync(ifsc, s.store, '2026-10-17', { onlyAthlete: 103 }))
      .toEqual({ added: 1, updated: 0, linked: 0, pending: 0, world: 0, warnings: [] });
    expect(calls.every((c) => c.startsWith('/api/v1/cuwr/'))).toBe(true); // only the world ranking
    expect(s.world.replacedFor).toEqual([{ season: '2026-27', climber: 'p3', rows: [], asOf: '2026-10-17' }]);
    expect(s.results.get('p3')?.map((r) => r.event_name)).toEqual(['IFSC World Cup Bern 2026 (BOULDER Men)']);
    expect([...s.pending.keys()]).toEqual([105]);
  });

  it('onlyAthlete for an athlete without a profile changes nothing', async () => {
    const s = memStore({ pending: [{ ifsc_athlete_id: 103, firstname: 'Dan', lastname: 'LEVI', gender: null, birthday: null,
      suggested_profile: null, score: null, status: 'pending', results: [row()] }] });
    expect(await runSync(api().ifsc, s.store, '2026-10-17', { onlyAthlete: 103 })).toEqual({ added: 0, updated: 0, linked: 0, pending: 0, world: 0, warnings: [] });
    expect(s.writes).toEqual([]);
  });

  it('imports the waiting results of a linked athlete seen again, without duplicates', async () => {
    const fresh = row({ event_name: 'IFSC World Cup Prague 2026 (BOULDER Men)', starts_on: '2026-09-20', place: 5, field_size: 4,
      reached: 'qualification', ifsc_event_id: 1500 });
    const s = memStore({ linked: [[101, 'p1']], candidates: [p2],
      pending: [{ ifsc_athlete_id: 101, firstname: 'X', lastname: 'Y', gender: null, birthday: null, suggested_profile: null,
        score: null, status: 'pending', results: [row(), fresh] }] });
    expect((await runSync(api().ifsc, s.store, '2026-10-17')).added).toBe(3); // p1: Bern (waiting) + Prague; p2: Prague
    expect(s.results.get('p1')?.map((r) => r.ifsc_event_id).sort()).toEqual([1490, 1500]);
    expect(s.pending.has(101)).toBe(false);
  });

  it('does not match a candidate whose profile already has an IFSC id', async () => {
    const s = memStore({ linked: [[101, 'p1'], [999, 'p2']], candidates: [p2] });
    expect(await runSync(api().ifsc, s.store, '2026-10-17')).toMatchObject({ added: 1, linked: 0, pending: 2 });
    expect(s.pending.get(102)).toMatchObject({ suggested_profile: null, score: null });
  });

  it('sends the second athlete resolving to the same profile to pending', async () => {
    const s = memStore({ linked: [[101, 'p1']], candidates: [p2] });
    const { ifsc } = api({
      '/api/v1/events/1500/result/3': { ranking: [rnk(101, 5), rnk(102, 12, 'ISR', 'Yonatan', 'Cohen'), rnk(103, 30),
        rnk(106, 13, 'ISR', 'Yonatan', 'Cohen')] },
      '/api/v1/athletes/106': { firstname: 'Yonatan', lastname: 'COHEN', gender: 'male', birthday: '2008-03-01', country: 'ISR' },
    });
    expect(await runSync(ifsc, s.store, '2026-10-17')).toMatchObject({ linked: 1, pending: 2 });
    expect(s.linked.get(102)).toBe('p2');
    expect(s.pending.get(106)).toMatchObject({ suggested_profile: 'p2', score: 1 });
  });

  it('imports and clears waiting results of a linked athlete absent from this run', async () => {
    const s = memStore({ linked: [[101, 'p1'], [108, 'p8']], candidates: [p2],
      pending: [{ ifsc_athlete_id: 108, firstname: 'A', lastname: 'B', gender: null, birthday: null, suggested_profile: null,
        score: null, status: 'pending', results: [row()] }] });
    expect((await runSync(api().ifsc, s.store, '2026-10-17')).added).toBe(3);
    expect(s.results.get('p8')?.map((r) => r.ifsc_event_id)).toEqual([1490]);
    expect(s.pending.has(108)).toBe(false);
  });

  it('keeps the waiting row when inserting fails', async () => {
    const s = memStore({ linked: [[101, 'p1'], [108, 'p8']], candidates: [p2],
      pending: [{ ifsc_athlete_id: 108, firstname: 'A', lastname: 'B', gender: null, birthday: null, suggested_profile: null,
        score: null, status: 'pending', results: [row()] }] });
    const insert = s.store.insertResults;
    s.store.insertResults = async (climber, rows) => { if (climber === 'p8') throw new Error('db down'); return insert(climber, rows); };
    await expect(runSync(api().ifsc, s.store, '2026-10-17')).rejects.toThrow('db down');
    await expect(runSync(api().ifsc, s.store, '2026-10-17', { onlyAthlete: 108 })).rejects.toThrow('db down');
    expect(s.pending.has(108)).toBe(true);
  });

  it('accepts a world ranking without Israelis', async () => {
    const s = base();
    const { ifsc } = api({ '/api/v1/cuwr/3?date=2026-10-17': { ranking: [{ athlete_id: 200, rank: 1, country: 'FRA' }] } });
    expect((await runSync(ifsc, s.store, '2026-10-17')).world).toBe(0);
    expect(s.world.replaced).toEqual([{ season: '2026-27', asOf: '2026-10-17', rows: [] }]);
  });
});
