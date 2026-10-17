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

type Discipline = 'boulder' | 'lead';
export interface WorldRow { climber_id: string; discipline: Discipline; position: number; as_of: string }
type WorldPosition = Omit<WorldRow, 'as_of'>;

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
  /** The climber's non-manual rows with the same IFSC event and category as one of `rows` take its place,
   *  field_size and reached where they differ; returns the number of rows changed. */
  correctResults(climberId: string, rows: ResultRow[]): Promise<number>;
  linkProfile(profileId: string, ifscId: number): Promise<void>;
  /** Merges results into an existing row and keeps its status. */
  upsertPending(p: PendingAthlete): Promise<void>;
  worldRows(season: string): Promise<WorldRow[]>;
  /** Replaces the season's positions (all disciplines) with these rows. */
  replaceWorld(season: string, rows: WorldPosition[], asOf: string): Promise<void>;
  /** Replaces one climber's positions of the season (the other climbers' rows stay). */
  replaceWorldFor(season: string, climberId: string, rows: WorldPosition[], asOf: string): Promise<void>;
}

/** Counts of a run; `warnings` lists the IFSC categories, athletes or world lists skipped because IFSC failed. */
export interface RunSummary { added: number; updated: number; linked: number; pending: number; world: number; warnings: string[] }

const LEAGUES = new Set(['World Cups and World Championships', 'IFSC Youth', 'IFSC Europe Adults', 'IFSC Europe Youth']);
const WORLD_DCATS: [number, Discipline][] = [[3, 'boulder'], [7, 'boulder'], [1, 'lead'], [5, 'lead']];
const YOUTH = new Set(['european_youth_cup', 'european_youth_championship', 'world_youth_championship']);

// deno-lint-ignore no-explicit-any
type Json = any;

/** Field `key` of an IFSC response, which must be an array (else the response is malformed). */
function list(d: Json, key: string, path: string): Json[] {
  const v = d && typeof d === 'object' ? d[key] : undefined;
  if (!Array.isArray(v)) throw new Error(`IFSC ${path}: no ${key} in the response`);
  return v;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
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

type Skip = { manual: Set<string>; dismissed: Set<string> };
const notDismissed = (skip: Skip, climberId: string) => (r: ResultRow) =>
  !skip.dismissed.has(`${climberId}|${r.ifsc_event_id}|${r.ifsc_dcat_id}`);

/** Inserts the rows outside manual groups and not dismissed; returns the number added. */
async function importRows(store: Store, skip: Skip, climberId: string, rows: ResultRow[]): Promise<number> {
  const keep = dedupe(rows).filter((r) => !skip.manual.has(groupKey(r))).filter(notDismissed(skip, climberId));
  return keep.length ? store.insertResults(climberId, keep) : 0;
}

/** Which world list to read today. Until 1 January of the season's end year: today's, replacing the stored one.
 *  In January: the 1 January list every day, replacing the stored one only when IFSC revised it. After January:
 *  the 1 January list once, if it was never stored; otherwise none. */
function worldDate(today: string, season: string, stored: WorldRow[]): string | null {
  const official = `${Number(season.slice(0, 4)) + 1}-01-01`;
  if (today < official) return today;
  if (today <= `${official.slice(0, 4)}-01-31`) return official;
  return stored.some((r) => r.as_of === official) ? null : official;
}

type WorldIsr = { athlete: number; discipline: Discipline; position: number };

/** Israeli positions of one world list (by IFSC athlete id); throws if it fails or is empty. */
async function worldListOf(ifsc: Ifsc, dcat: number, discipline: Discipline, date: string): Promise<WorldIsr[]> {
  const path = `/api/v1/cuwr/${dcat}?date=${date}`;
  const ranking = list(await ifsc.get(path), 'ranking', path);
  if (!ranking.length) throw new Error(`IFSC ${path}: empty world ranking`);
  return ranking.filter((x) => x.country === 'ISR' && x.rank).map((x) => ({ athlete: x.athlete_id, discipline, position: x.rank }));
}

/** All four world lists on `date`; throws at the first failure. */
async function worldList(ifsc: Ifsc, date: string): Promise<WorldIsr[]> {
  const out: WorldIsr[] = [];
  for (const [dcat, discipline] of WORLD_DCATS) out.push(...await worldListOf(ifsc, dcat, discipline, date));
  return out;
}

/** World positions of linked athletes, one per climber and discipline. */
function worldPositions(isr: WorldIsr[], links: Map<number, string>): WorldPosition[] {
  const seen = new Set<string>();
  const rows: WorldPosition[] = [];
  for (const w of isr) {
    const climber_id = links.get(w.athlete);
    if (!climber_id || seen.has(`${climber_id}|${w.discipline}`)) continue;
    seen.add(`${climber_id}|${w.discipline}`);
    rows.push({ climber_id, discipline: w.discipline, position: w.position });
  }
  return rows;
}

const sameWorld = (stored: WorldRow[], rows: WorldPosition[], asOf: string) => stored.length === rows.length
  && rows.every((r) => stored.some((s) => s.climber_id === r.climber_id && s.discipline === r.discipline
    && s.position === r.position && s.as_of === asOf));

/**
 * One sync run. Every IFSC request happens before the first store write. The season, league and event lists must
 * all succeed, else the run fails and writes nothing. A category or athlete whose request fails (non-JSON, HTTP
 * error, malformed answer) is skipped with a warning, nothing is written for it, and the next run tries again.
 * A failing world list skips the world part only (the stored positions stay). When at least two category, athlete
 * and world-list requests were made and every one failed, IFSC is taken as down and the run fails; any success
 * (e.g. the world lists) keeps it a run with warnings, so a few broken categories never block the world update.
 */
export async function runSync(ifsc: Ifsc, store: Store, today: string, opts: { onlyAthlete?: number } = {}): Promise<RunSummary> {
  const linked = await store.linkedProfiles();
  const sum: RunSummary = { added: 0, updated: 0, linked: 0, pending: 0, world: 0, warnings: [] };
  const season = currentSeason(today);

  if (opts.onlyAthlete !== undefined) {
    // An admin just linked this athlete: import what waited for them, and their positions in the current world list.
    const profile = linked.get(opts.onlyAthlete);
    if (!profile) return sum;
    const official = `${Number(season.slice(0, 4)) + 1}-01-01`;
    const date = today < official ? today : official;
    let world: WorldPosition[] | null = null;
    try {
      world = worldPositions(await worldList(ifsc, date), new Map([[opts.onlyAthlete, profile]]));
    } catch (e) {
      sum.warnings.push(`world ranking skipped: ${message(e)}`);
    }
    const skip = { manual: await store.manualGroups(), dismissed: await store.dismissed() };
    const waiting = (await store.pendingResults()).get(opts.onlyAthlete);
    if (waiting) {
      sum.added += await importRows(store, skip, profile, waiting.results);
      await store.clearPending(opts.onlyAthlete);
    }
    if (world) {
      await store.replaceWorldFor(season, profile, world, date);
      sum.world = world.length;
    }
    return sum;
  }

  // A category or athlete request: its failure is a warning, unless every one fails.
  let tried = 0;
  async function attempt<T>(f: () => Promise<T>): Promise<T | null> {
    tried++;
    try {
      return await f();
    } catch (e) {
      sum.warnings.push(message(e));
      return null;
    }
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
          // The category's Israeli rows, all or none.
          const found = await attempt(async () => {
            const dcatId = Number(dc.id ?? String(dc.result_url).match(/\/result\/(\d+)/)?.[1]);
            if (!Number.isInteger(dcatId)) throw new Error(`IFSC ${lg.url}: no category id for ${ev.event} ${dc.name}`);
            const ranking = list(await ifsc.get(dc.result_url), 'ranking', dc.result_url);
            const fieldSize = ranking.filter((x) => x.rank).length;
            return ranking.filter((x) => x.country === 'ISR' && x.rank).map((x) => ({ x, row: {
              season: ilcaSeason(date), discipline: disc, event_type: type, event_name: `${ev.event} (${dc.name})`,
              starts_on: date, place: x.rank, field_size: fieldSize, reached: reachedOf(x.rounds ?? []),
              ifsc_event_id: ev.event_id, ifsc_dcat_id: dcatId } as ResultRow }));
          });
          for (const { x, row } of found ?? []) {
            const a = athletes.get(x.athlete_id) ?? { firstname: x.firstname, lastname: x.lastname, rows: [] as ResultRow[] };
            a.rows.push(row);
            athletes.set(x.athlete_id, a);
          }
        }
      }
    }
  }

  // 2. Details of athletes without a profile; an athlete whose details fail waits for the next run.
  const details = new Map<number, { firstname: string; lastname: string; gender: string | null; birthday: string | null }>();
  for (const [id, a] of athletes) {
    if (linked.has(id)) continue;
    const path = `/api/v1/athletes/${id}`;
    const d: Json = await attempt(async () => {
      const d: Json = await ifsc.get(path);
      if (!d || typeof d !== 'object' || 'error' in d) throw new Error(`IFSC ${path}: no athlete in the response`);
      return d;
    });
    if (!d) {
      athletes.delete(id);
      continue;
    }
    details.set(id, { firstname: d.firstname ?? a.firstname, lastname: d.lastname ?? a.lastname,
      gender: d.gender ?? null, birthday: d.birthday ?? null });
  }

  // 3. World ranking (see worldDate): every list is asked (each counts for the outage check); one failing skips the
  // world part.
  const stored = await store.worldRows(season);
  const wDate = worldDate(today, season, stored);
  let worldIsr: WorldIsr[] | null = null;
  if (wDate) {
    const lists: (WorldIsr[] | null)[] = [];
    for (const [dcat, discipline] of WORLD_DCATS) {
      lists.push(await attempt(() => worldListOf(ifsc, dcat, discipline, wDate)
        .catch((e) => { throw new Error(`world ranking skipped: ${message(e)}`); })));
    }
    if (lists.every((l) => l)) worldIsr = lists.flatMap((l) => l!);
  }
  if (tried >= 2 && sum.warnings.length === tried) throw new Error(`IFSC failing: every request failed (${sum.warnings[0]})`);

  // 4. Matching (store reads only). A profile already linked, or claimed earlier in this run, is not matched again;
  // an athlete an admin ignored (or unlinked) is never linked by the sync, only suggested.
  const waiting = await store.pendingResults();
  const taken = new Set(linked.values());
  const newLinks = new Map<number, string>();
  const pending: PendingAthlete[] = [];
  for (const [id, d] of details) {
    const cands = d.birthday ? (await store.candidates(d.birthday)).filter((c) => !taken.has(c.id)) : [];
    const m = pickMatch(d, cands);
    if (m.status === 'match' && waiting.get(id)?.status !== 'ignored' && ![...newLinks.values()].includes(m.profileId)) {
      newLinks.set(id, m.profileId);
      continue;
    }
    const [suggested_profile, score] = m.status === 'match' ? [m.profileId, m.score] : [m.suggestion, m.score];
    pending.push({ ifsc_athlete_id: id, ...d, suggested_profile, score, results: athletes.get(id)!.rows });
  }
  const skip = { manual: await store.manualGroups(), dismissed: await store.dismissed() };

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
    const fresh = dedupe(athletes.get(id)?.rows ?? []).filter(notDismissed(skip, profile));
    // IFSC may revise a recent result (a late appeal, a disqualification): the rows seen now win, outside groups
    // with ILCA-published points.
    const correctable = fresh.filter((r) => !skip.manual.has(groupKey(r)));
    if (correctable.length) sum.updated += await store.correctResults(profile, correctable);
    sum.added += await importRows(store, skip, profile, [...fresh, ...(w?.results ?? [])]);
    if (w) await store.clearPending(id);
  }
  for (const p of pending) {
    const ignored = waiting.get(p.ifsc_athlete_id)?.status === 'ignored';
    // An ignored athlete's birthday is not kept: it was only needed for matching.
    await store.upsertPending(ignored ? { ...p, birthday: null } : p);
    if (!ignored) sum.pending++;
  }
  if (wDate && worldIsr) {
    const rows = worldPositions(worldIsr, allLinks);
    if (wDate === today || !sameWorld(stored, rows, wDate)) {
      await store.replaceWorld(season, rows, wDate);
      sum.world = rows.length;
    }
  }
  return sum;
}
