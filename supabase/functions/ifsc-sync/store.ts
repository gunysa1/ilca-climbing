// The sync's Store on Supabase (service-role client). profiles.ifsc_id is text in the database, numbers here.
// Every error from the database is thrown, so the run fails and is logged instead of half-succeeding silently.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import type { Candidate } from '../_shared/ifsc.ts';
import type { ResultRow, Store } from './sync.ts';

const PAGE = 1000;

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

/** All rows of a query, page by page until an empty page (a short page does not end it: the server's row limit
 *  may be below PAGE). Each query must have a stable order. */
async function all<T>(what: string, page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = check(await page(from, from + PAGE - 1), what) ?? [];
    if (!rows.length) return out;
    out.push(...rows);
  }
}

const rowKey = (r: { discipline: string; event_name: string; starts_on: string }) => `${r.discipline}|${r.event_name}|${r.starts_on}`;

export function supabaseStore(db: SupabaseClient): Store {
  return {
    async linkedProfiles() {
      const rows = await all<{ id: string; ifsc_id: string }>('profiles', (a, b) =>
        db.from('profiles').select('id, ifsc_id').not('ifsc_id', 'is', null).order('id').range(a, b));
      const m = new Map<number, string>();
      for (const r of rows) {
        if (!/^\d+$/.test(r.ifsc_id)) continue;
        const n = Number(r.ifsc_id);
        if (Number.isSafeInteger(n) && n > 0) m.set(n, r.id);
      }
      return m;
    },

    async candidates(birthday) {
      const priv = check(await db.from('profile_private').select('id').eq('birth_date', birthday), 'profile_private') ?? [];
      if (!priv.length) return [];
      const ids = priv.map((p: { id: string }) => p.id);
      const profiles = check(await db.from('profiles').select('id, full_name, full_name_he, gender')
        .in('id', ids).is('ifsc_id', null), 'profiles') ?? [];
      return profiles.map((p: Omit<Candidate, 'birth_date'>) => ({ ...p, birth_date: birthday }));
    },

    async manualGroups() {
      const rows = await all<{ season: string; for_class: string; discipline: string }>('international_results', (a, b) =>
        db.from('international_results').select('season, for_class, discipline').eq('event_type', 'manual').order('id').range(a, b));
      return new Set(rows.map((r) => `${r.season}|${r.for_class}|${r.discipline}`));
    },

    async pendingResults() {
      const rows = await all<{ ifsc_athlete_id: number; status: 'pending' | 'ignored'; results: ResultRow[] }>('ifsc_pending', (a, b) =>
        db.from('ifsc_pending').select('ifsc_athlete_id, status, results').order('ifsc_athlete_id').range(a, b));
      return new Map(rows.map((r) => [r.ifsc_athlete_id, { status: r.status, results: r.results ?? [] }]));
    },

    async clearPending(ifscId) {
      check(await db.from('ifsc_pending').delete().eq('ifsc_athlete_id', ifscId), 'ifsc_pending delete');
    },

    async insertResults(climberId, rows) {
      const have = check(await db.from('international_results')
        .select('id, discipline, event_name, starts_on, ifsc_event_id, ifsc_dcat_id').eq('climber_id', climberId),
        'international_results') as { id: string; discipline: string; event_name: string; starts_on: string;
          ifsc_event_id: number | null; ifsc_dcat_id: number | null }[];
      const byKey = new Map<string, typeof have>();
      for (const h of have) byKey.set(rowKey(h), [...(byKey.get(rowKey(h)) ?? []), h]);
      const add: ResultRow[] = [];
      for (const r of rows) {
        const existing = byKey.get(rowKey(r));
        if (!existing) { add.push(r); continue; }
        // Existing rows are never changed, except their IFSC ids where still unset.
        for (const h of existing) {
          const fill: { ifsc_event_id?: number; ifsc_dcat_id?: number } = {};
          if (h.ifsc_event_id === null) fill.ifsc_event_id = r.ifsc_event_id;
          if (h.ifsc_dcat_id === null) fill.ifsc_dcat_id = r.ifsc_dcat_id;
          if (!Object.keys(fill).length) continue;
          let q = db.from('international_results').update(fill).eq('id', h.id);
          for (const col of Object.keys(fill)) q = q.is(col, null);
          check(await q, 'international_results ifsc ids');
          h.ifsc_event_id ??= r.ifsc_event_id;
          h.ifsc_dcat_id ??= r.ifsc_dcat_id;
        }
      }
      if (!add.length) return 0;
      check(await db.from('international_results').insert(add.map((r) => ({ climber_id: climberId, ...r }))),
        'international_results insert');
      return add.length;
    },

    async linkProfile(profileId, ifscId) {
      // Only an unlinked profile; a profile linked meanwhile, or this athlete on another profile (unique index), fails the run.
      const updated = check(await db.from('profiles').update({ ifsc_id: String(ifscId) })
        .eq('id', profileId).is('ifsc_id', null).select('id'), `link profile ${profileId} to IFSC ${ifscId}`) ?? [];
      if (!updated.length) throw new Error(`link profile ${profileId} to IFSC ${ifscId}: profile already has an IFSC id`);
    },

    async upsertPending(p) {
      const old = check(await db.from('ifsc_pending').select('results').eq('ifsc_athlete_id', p.ifsc_athlete_id).maybeSingle(),
        'ifsc_pending') as { results: ResultRow[] } | null;
      const merged = new Map<string, ResultRow>();
      for (const r of [...(old?.results ?? []), ...p.results]) merged.set(rowKey(r), r);
      // status is not sent: new rows get 'pending', existing rows keep theirs.
      check(await db.from('ifsc_pending').upsert({
        ifsc_athlete_id: p.ifsc_athlete_id, firstname: p.firstname, lastname: p.lastname, gender: p.gender,
        birthday: p.birthday, suggested_profile: p.suggested_profile, score: p.score, results: [...merged.values()],
        last_seen: new Date().toISOString(),
      }, { onConflict: 'ifsc_athlete_id' }), 'ifsc_pending upsert');
    },

    async worldRows(season) {
      return check(await db.from('world_rankings').select('as_of').eq('season', season), 'world_rankings') ?? [];
    },

    async replaceWorld(season, rows, asOf) {
      // Upsert the new positions first, then delete the season's rows missing from the list: a failure never
      // leaves the season empty (at worst stale rows remain, with their older as_of).
      if (rows.length) {
        check(await db.from('world_rankings').upsert(rows.map((r) => ({ ...r, season, as_of: asOf })),
          { onConflict: 'climber_id,season,discipline' }), 'world_rankings upsert');
      }
      const keep = new Set(rows.map((r) => `${r.climber_id}|${r.discipline}`));
      const old = check(await db.from('world_rankings').select('climber_id, discipline').eq('season', season),
        'world_rankings') as { climber_id: string; discipline: string }[];
      for (const discipline of ['boulder', 'lead']) {
        const stale = old.filter((o) => o.discipline === discipline && !keep.has(`${o.climber_id}|${o.discipline}`)).map((o) => o.climber_id);
        if (!stale.length) continue;
        check(await db.from('world_rankings').delete().eq('season', season).eq('discipline', discipline).in('climber_id', stale),
          'world_rankings delete');
      }
    },
  };
}

const STALE_MINUTES = 15;

/** Starts a run in ifsc_sync_runs, one at a time: runs still `running` after 15 minutes are marked failed
 *  ('timed out'); if another run is younger, returns null (busy). Soft lock: two calls in the same instant can
 *  both start. */
export async function startRun(db: SupabaseClient): Promise<number | null> {
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
  check(await db.from('ifsc_sync_runs').update({ status: 'failed', error: 'timed out', finished_at: new Date().toISOString() })
    .eq('status', 'running').lt('started_at', cutoff), 'ifsc_sync_runs stale');
  const busy = check(await db.from('ifsc_sync_runs').select('id').eq('status', 'running').limit(1), 'ifsc_sync_runs') ?? [];
  if (busy.length) return null;
  const run = check(await db.from('ifsc_sync_runs').insert({ status: 'running' }).select('id').single(), 'ifsc_sync_runs insert') as { id: number };
  return run.id;
}

/** Ends a run (ok with counts, or failed with the error). Logs, never throws: the reply must still go out. */
export async function finishRun(db: SupabaseClient, id: number, fields: Record<string, unknown>): Promise<void> {
  const { error } = await db.from('ifsc_sync_runs').update({ ...fields, finished_at: new Date().toISOString() }).eq('id', id);
  if (error) console.error(`ifsc_sync_runs ${id} finish: ${error.message}`);
}
