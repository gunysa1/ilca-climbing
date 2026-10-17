import { describe, expect, it } from 'vitest';
import type { Candidate } from '../_shared/ifsc.ts';
import { runSync, type Ifsc, type ResultRow, type Store } from './sync.ts';

type Pending = Parameters<Store['upsertPending']>[0] & { status: 'pending' | 'ignored' };
const key = (r: ResultRow) => `${r.discipline}|${r.event_name}|${r.starts_on}`;

/** In-memory store; `writes` lists every write call. */
function memStore(init: { linked?: [number, string][]; candidates?: Candidate[]; manual?: string[]; pending?: Pending[];
  world?: { as_of: string }[] } = {}) {
  const linked = new Map(init.linked ?? []);
  const results = new Map<string, ResultRow[]>();
  const pending = new Map((init.pending ?? []).map((p) => [p.ifsc_athlete_id, p]));
  const world = { rows: init.world ?? [], replaced: [] as { season: string; rows: unknown[]; asOf: string }[] };
  const writes: string[] = [];
  const store: Store = {
    linkedProfiles: async () => new Map(linked),
    candidates: async (birthday) => (init.candidates ?? []).filter((c) => c.birth_date === birthday),
    manualGroups: async () => new Set(init.manual ?? []),
    takePending: async (id) => {
      const p = pending.get(id);
      if (!p) return null;
      writes.push(`takePending ${id}`);
      pending.delete(id);
      return p.results;
    },
    insertResults: async (climber, rows) => {
      writes.push(`insert ${climber}`);
      const have = results.get(climber) ?? [];
      const fresh = rows.filter((r) => !have.some((h) => key(h) === key(r)));
      results.set(climber, [...have, ...fresh]);
      return fresh.length;
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
  };
  return { store, linked, results, pending, world, writes };
}

const rnk = (athlete_id: number, rank: number | null, country = 'ISR', firstname = 'X', lastname = 'Y') =>
  ({ athlete_id, firstname, lastname, country, rank, rounds: [{ round_name: 'Qualification', score: '1T', rank }] });

/** IFSC API of one season (2026): a World Cup with BOULDER Men (ISR 101 linked, 102 matchable, 103 unknown, 104 no place). */
function api(over: Record<string, unknown> = {}) {
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
    for (const c of [7, 1, 5]) paths[`/api/v1/cuwr/${c}?date=${d}`] = { ranking: [] };
  }
  Object.assign(paths, over);
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

describe('runSync', () => {
  it('imports linked and newly matched athletes, keeps the unknown one pending', async () => {
    const s = base();
    const { ifsc, calls } = api();
    expect(await runSync(ifsc, s.store, '2026-10-17')).toEqual({ added: 2, linked: 1, pending: 1, world: 2 });
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
    // linked athletes need no details; the athlete without a place is skipped entirely
    expect(calls.filter((c) => c.startsWith('/api/v1/athletes/'))).toEqual(['/api/v1/athletes/102', '/api/v1/athletes/103']);
    expect(s.world.replaced).toEqual([{ season: '2026-27', asOf: '2026-10-17', rows: [
      { climber_id: 'p1', discipline: 'boulder', position: 40 }, { climber_id: 'p2', discipline: 'boulder', position: 77 }] }]);
  });

  it('adds nothing on a second run; a pending athlete seen again stays one row with merged results', async () => {
    const s = base();
    await runSync(api().ifsc, s.store, '2026-10-17');
    expect(await runSync(api().ifsc, s.store, '2026-10-17')).toEqual({ added: 0, linked: 0, pending: 1, world: 2 });
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
    expect((await runSync(api().ifsc, s.store, '2026-10-17')).pending).toBe(1);
    expect(s.pending.get(103)?.status).toBe('ignored');
    expect(s.pending.get(103)?.results).toHaveLength(2);
  });

  it('skips groups that hold ILCA-published (manual) points', async () => {
    const s = memStore({ linked: [[101, 'p1']], candidates: [p2], manual: ['2026-27|senior|boulder'] });
    expect(await runSync(api().ifsc, s.store, '2026-10-17')).toEqual({ added: 0, linked: 1, pending: 1, world: 2 });
    expect(s.results.get('p1') ?? []).toEqual([]);
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
    ['an error object for a category', { '/api/v1/events/1500/result/3': { error: 'not found' } }],
    ['a failing request', { '/api/v1/athletes/102': undefined }],
    ['an error object for an athlete', { '/api/v1/athletes/103': { error: 'not found' } }],
    ['a world ranking without a list', { '/api/v1/cuwr/5?date=2026-10-17': { error: 'x' } }],
    ['a league without events', { '/api/v1/season_leagues/457': {} }],
  ])('rejects on %s without writing anything', async (_, over) => {
    const s = base();
    const o = over as Record<string, unknown>;
    const { ifsc } = api(o);
    const failing: Ifsc = { get: async (p) => { if (p in o && o[p] === undefined) throw new Error('HTTP 500'); return ifsc.get(p); } };
    await expect(runSync(failing, s.store, '2026-10-17')).rejects.toThrow();
    expect(s.writes).toEqual([]);
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

  it('leaves the official list alone once stored', async () => {
    const s = memStore({ linked: [[101, 'p1']], world: [{ as_of: '2027-01-01' }] });
    const { ifsc, calls } = api({ '/api/v1/seasons/38': { leagues: [] } });
    expect((await runSync(ifsc, s.store, '2027-03-05')).world).toBe(0);
    expect(calls.some((c) => c.includes('cuwr'))).toBe(false);
    expect(calls).not.toContain('/api/v1/seasons/38'); // March: 60 days back stays in 2027
    expect(s.world.replaced).toEqual([]);
  });

  it('onlyAthlete imports that athlete\'s waiting results without asking IFSC', async () => {
    const s = memStore({ linked: [[103, 'p3']], manual: ['2025-26|senior|boulder'],
      pending: [{ ifsc_athlete_id: 103, firstname: 'Dan', lastname: 'LEVI', gender: 'male', birthday: '2009-01-01',
        suggested_profile: null, score: null, status: 'pending',
        results: [row(), row({ season: '2025-26', event_name: 'Old (BOULDER Men)', starts_on: '2025-06-01' })] },
      { ifsc_athlete_id: 105, firstname: 'A', lastname: 'B', gender: null, birthday: null, suggested_profile: null, score: null,
        status: 'pending', results: [row()] }] });
    const { ifsc, calls } = api();
    expect(await runSync(ifsc, s.store, '2026-10-17', { onlyAthlete: 103 })).toEqual({ added: 1, linked: 0, pending: 0, world: 0 });
    expect(calls).toEqual([]);
    expect(s.results.get('p3')?.map((r) => r.event_name)).toEqual(['IFSC World Cup Bern 2026 (BOULDER Men)']);
    expect([...s.pending.keys()]).toEqual([105]);
  });

  it('onlyAthlete for an athlete without a profile changes nothing', async () => {
    const s = memStore({ pending: [{ ifsc_athlete_id: 103, firstname: 'Dan', lastname: 'LEVI', gender: null, birthday: null,
      suggested_profile: null, score: null, status: 'pending', results: [row()] }] });
    expect(await runSync(api().ifsc, s.store, '2026-10-17', { onlyAthlete: 103 })).toEqual({ added: 0, linked: 0, pending: 0, world: 0 });
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
});
