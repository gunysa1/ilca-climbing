// Daily IFSC sync: Israeli results of the last 60 days into international_results, new athletes matched to
// profiles or left pending for an admin, and the season's world ranking. Pure logic over IFSC and a store (no Deno).
import { currentSeason, eventType, ilcaSeason, pickMatch, reachedOf, type Candidate } from '../_shared/ifsc.ts';

/** IFSC API (`/api/v1/...`); throws on non-2xx or non-JSON. */
export interface Ifsc { get(path: string): Promise<unknown> }

/** An international_results row without climber_id (also the shape kept in ifsc_pending.results). */
export interface ResultRow {
  season: string; discipline: 'boulder' | 'lead'; event_type: string; event_name: string; starts_on: string;
  place: number; field_size: number; reached: string; ifsc_event_id: number; ifsc_dcat_id: number;
}

export interface PendingAthlete {
  ifsc_athlete_id: number; firstname: string; lastname: string; gender: string | null; birthday: string | null;
  suggested_profile: string | null; score: number | null; results: ResultRow[];
}

export interface Store {
  /** ifsc_id → profile id. */
  linkedProfiles(): Promise<Map<number, string>>;
  /** Profiles with this birth date (profile_private.birth_date). */
  candidates(birthday: string): Promise<Candidate[]>;
  /** `${season}|${class}|${discipline}` groups holding ILCA-published ('manual') rows. */
  manualGroups(): Promise<Set<string>>;
  /** `${climberId}|${eventId}|${dcatId}` of IFSC results an admin deleted (ifsc_dismissed): never imported again. */
  dismissed(): Promise<Set<string>>;
  /** Every ifsc_pending row (any status): ifsc_athlete_id → status and waiting results. */
  pendingResults(): Promise<Map<number, { status: 'pending' | 'ignored'; results: ResultRow[] }>>;
  /** Deletes an athlete's pending row (after their results were imported). */
  clearPending(ifscId: number): Promise<void>;
  /** Add-only: inserts rows whose (discipline, event_name, starts_on) the climber lacks, sets ifsc ids where null on
   *  the ones they have; returns the number inserted. */
  insertResults(climberId: string, rows: ResultRow[]): Promise<number>;
  linkProfile(profileId: string, ifscId: number): Promise<void>;
  /** Merges results into an existing row and keeps its status. */
  upsertPending(p: PendingAthlete): Promise<void>;
  worldRows(season: string): Promise<{ as_of: string }[]>;
  /** Replaces the season's positions (all disciplines) with these rows. */
  replaceWorld(season: string, rows: { climber_id: string; discipline: 'boulder' | 'lead'; position: number }[], asOf: string): Promise<void>;
}

export interface RunSummary { added: number; linked: number; pending: number; world: number }

const LEAGUES = new Set(['World Cups and World Championships', 'IFSC Youth', 'IFSC Europe Adults', 'IFSC Europe Youth']);
const WORLD_DCATS: [number, 'boulder' | 'lead'][] = [[3, 'boulder'], [7, 'boulder'], [1, 'lead'], [5, 'lead']];
const YOUTH = new Set(['european_youth_cup', 'european_youth_championship', 'world_youth_championship']);

// deno-lint-ignore no-explicit-any
type Json = any;

/** Field `key` of an IFSC response, which must be an array (else the response is malformed and the run stops). */
function list(d: Json, key: string, path: string): Json[] {
  const v = d && typeof d === 'object' ? d[key] : undefined;
  if (!Array.isArray(v)) throw new Error(`IFSC ${path}: no ${key} in the response`);
  return v;
}

const rowKey = (r: ResultRow) => `${r.discipline}|${r.event_name}|${r.starts_on}`;
const groupKey = (r: ResultRow) => `${r.season}|${YOUTH.has(r.event_type) ? 'youth' : 'senior'}|${r.discipline}`;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dedupe(rows: ResultRow[]): ResultRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(rowKey(r)) && !!seen.add(rowKey(r)));
}

/** Inserts the rows outside manual groups and not dismissed; returns the number added. */
async function importRows(store: Store, skip: { manual: Set<string>; dismissed: Set<string> }, climberId: string,
  rows: ResultRow[]): Promise<number> {
  const keep = dedupe(rows).filter((r) => !skip.manual.has(groupKey(r))
    && !skip.dismissed.has(`${climberId}|${r.ifsc_event_id}|${r.ifsc_dcat_id}`));
  return keep.length ? store.insertResults(climberId, keep) : 0;
}

/** One sync run. Every IFSC request happens before the first store write, so an IFSC error changes nothing. */
export async function runSync(ifsc: Ifsc, store: Store, today: string, opts: { onlyAthlete?: number } = {}): Promise<RunSummary> {
  const linked = await store.linkedProfiles();
  const sum: RunSummary = { added: 0, linked: 0, pending: 0, world: 0 };

  if (opts.onlyAthlete !== undefined) {
    // An admin just linked this athlete: import what waited for them, without asking IFSC.
    const profile = linked.get(opts.onlyAthlete);
    if (!profile) return sum;
    const skip = { manual: await store.manualGroups(), dismissed: await store.dismissed() };
    const waiting = (await store.pendingResults()).get(opts.onlyAthlete);
    if (!waiting) return sum;
    sum.added += await importRows(store, skip, profile, waiting.results);
    await store.clearPending(opts.onlyAthlete);
    return sum;
  }

  // 1. Israeli results of events that started in the last 60 days.
  const from = addDays(today, -60);
  const years = new Set([from.slice(0, 4), today.slice(0, 4)]);
  const athletes = new Map<number, { firstname: string; lastname: string; rows: ResultRow[] }>();
  for (const s of list(await ifsc.get('/api/v1/'), 'seasons', '/api/v1/')) {
    if (!years.has(String(s.name))) continue;
    for (const lg of list(await ifsc.get(s.url), 'leagues', s.url)) {
      if (!LEAGUES.has(lg.name)) continue;
      for (const ev of list(await ifsc.get(lg.url), 'events', lg.url)) {
        const date: string = ev.local_start_date;
        if (!date || date < from || date > today) continue;
        const type = eventType(ev.event);
        if (!type) continue;
        for (const dc of list(ev, 'd_cats', lg.url)) {
          const disc = String(dc.name).split(' ')[0].toLowerCase() as ResultRow['discipline'];
          if ((disc !== 'boulder' && disc !== 'lead') || dc.status !== 'finished') continue;
          const ranking = list(await ifsc.get(dc.result_url), 'ranking', dc.result_url);
          const dcatId = Number(dc.id ?? String(dc.result_url).match(/\/result\/(\d+)/)?.[1]);
          if (!Number.isInteger(dcatId)) throw new Error(`IFSC ${lg.url}: no category id for ${ev.event} ${dc.name}`);
          const fieldSize = ranking.filter((x) => x.rank).length;
          for (const x of ranking) {
            if (x.country !== 'ISR' || !x.rank) continue;
            const a = athletes.get(x.athlete_id) ?? { firstname: x.firstname, lastname: x.lastname, rows: [] as ResultRow[] };
            a.rows.push({ season: ilcaSeason(date), discipline: disc, event_type: type, event_name: `${ev.event} (${dc.name})`,
              starts_on: date, place: x.rank, field_size: fieldSize, reached: reachedOf(x.rounds ?? []),
              ifsc_event_id: ev.event_id, ifsc_dcat_id: dcatId });
            athletes.set(x.athlete_id, a);
          }
        }
      }
    }
  }

  // 2. Details of athletes without a profile.
  const details = new Map<number, { firstname: string; lastname: string; gender: string | null; birthday: string | null }>();
  for (const [id, a] of athletes) {
    if (linked.has(id)) continue;
    const path = `/api/v1/athletes/${id}`;
    const d: Json = await ifsc.get(path);
    if (!d || typeof d !== 'object' || 'error' in d) throw new Error(`IFSC ${path}: no athlete in the response`);
    details.set(id, { firstname: d.firstname ?? a.firstname, lastname: d.lastname ?? a.lastname,
      gender: d.gender ?? null, birthday: d.birthday ?? null });
  }

  // 3. World ranking: today's list until 1 January of the season's end year, then that day's official list once.
  const season = currentSeason(today);
  const official = `${Number(season.slice(0, 4)) + 1}-01-01`;
  let worldDate: string | null = today;
  if (today >= official) worldDate = (await store.worldRows(season)).some((r) => r.as_of === official) ? null : official;
  const worldIsr: { athlete: number; discipline: 'boulder' | 'lead'; position: number }[] = [];
  if (worldDate) {
    for (const [dcat, discipline] of WORLD_DCATS) {
      const path = `/api/v1/cuwr/${dcat}?date=${worldDate}`;
      const ranking = list(await ifsc.get(path), 'ranking', path);
      if (!ranking.length) throw new Error(`IFSC ${path}: empty world ranking`);
      for (const x of ranking) {
        if (x.country === 'ISR' && x.rank) worldIsr.push({ athlete: x.athlete_id, discipline, position: x.rank });
      }
    }
  }

  // 4. Matching (store reads only). A profile already linked, or claimed earlier in this run, is not matched again.
  const taken = new Set(linked.values());
  const newLinks = new Map<number, string>();
  const pending: PendingAthlete[] = [];
  for (const [id, d] of details) {
    const cands = d.birthday ? (await store.candidates(d.birthday)).filter((c) => !taken.has(c.id)) : [];
    const m = pickMatch(d, cands);
    if (m.status === 'match' && ![...newLinks.values()].includes(m.profileId)) {
      newLinks.set(id, m.profileId);
      continue;
    }
    const [suggested_profile, score] = m.status === 'match' ? [m.profileId, m.score] : [m.suggestion, m.score];
    pending.push({ ifsc_athlete_id: id, ...d, suggested_profile, score, results: athletes.get(id)!.rows });
  }
  const skip = { manual: await store.manualGroups(), dismissed: await store.dismissed() };
  const waiting = await store.pendingResults();

  // 5. Writes. A waiting row is cleared only once its results are in.
  for (const [id, profile] of newLinks) {
    await store.linkProfile(profile, id);
    sum.linked++;
  }
  const allLinks = new Map([...linked, ...newLinks]);
  for (const id of new Set([...athletes.keys(), ...waiting.keys()])) {
    const profile = allLinks.get(id);
    if (!profile) continue;
    const w = waiting.get(id);
    sum.added += await importRows(store, skip, profile, [...(athletes.get(id)?.rows ?? []), ...(w?.results ?? [])]);
    if (w) await store.clearPending(id);
  }
  for (const p of pending) {
    await store.upsertPending(p);
    if (waiting.get(p.ifsc_athlete_id)?.status !== 'ignored') sum.pending++;
  }
  if (worldDate) {
    const seen = new Set<string>();
    const rows: { climber_id: string; discipline: 'boulder' | 'lead'; position: number }[] = [];
    for (const w of worldIsr) {
      const climber_id = allLinks.get(w.athlete);
      if (!climber_id || seen.has(`${climber_id}|${w.discipline}`)) continue;
      seen.add(`${climber_id}|${w.discipline}`);
      rows.push({ climber_id, discipline: w.discipline, position: w.position });
    }
    await store.replaceWorld(season, rows, worldDate);
    sum.world = rows.length;
  }
  return sum;
}
