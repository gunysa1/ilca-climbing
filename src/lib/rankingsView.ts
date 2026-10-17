// What the rankings page shows for an address (season?, class, gender, discipline), with the loaders passed in
// (seasonRankings.ts; tests pass fakes). Normally one request: ranking_page() (season list + stored table). A
// table not stored (or stored by another code version) is computed from the season's data; when ranking_page()
// is missing or fails, the season list comes from the competitions as before, and the table is computed.
import type { Discipline, Gender, RankClass } from './rankings';
import type { RankingTable } from './rankingTables';

export interface RankingPage {
  /** Seasons with ranked competitions, newest first. */
  seasons: string[];
  /** The season asked for, or the newest. */
  season: string | null;
  /** The stored table (of this code version), or null. */
  table: RankingTable | null;
}

export interface RankingsLoaders {
  page(season: string | null, rankClass: RankClass, gender: Gender, discipline: Discipline | 'speed'): Promise<RankingPage | null>;
  seasons(): Promise<string[] | null>;
  computed(season: string, rankClass: RankClass, gender: Gender, discipline: Discipline): Promise<RankingTable | null>;
}

export interface RankingsView {
  /** null: the season list could not be loaded. */
  seasons: string[] | null;
  season: string | null;
  /** null: nothing to show (speed, no season) or loading failed. */
  table: RankingTable | null;
}

const orNull = <T,>(p: Promise<T | null>) => p.catch(() => null);

export async function loadRankingsView(l: RankingsLoaders, asked: string | null, rankClass: RankClass, gender: Gender,
  discipline: Discipline | 'speed'): Promise<RankingsView> {
  const page = await orNull(l.page(asked, rankClass, gender, discipline));
  if (page?.table) return { seasons: page.seasons, season: page.season, table: page.table };
  const seasons = page ? page.seasons : await orNull(l.seasons());
  const season = page ? page.season : asked ?? seasons?.[0] ?? null;
  if (!season || discipline === 'speed') return { seasons, season, table: null };
  return { seasons, season, table: await orNull(l.computed(season, rankClass, gender, discipline)) };
}
