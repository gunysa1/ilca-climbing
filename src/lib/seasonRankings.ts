// National ranking tables for the rankings page and home: the stored tables (ranking_tables, built server-side by
// the rankings-build edge function from the same code), or, for a table not stored yet, the season's data
// (season_rankings(), one request) and the table computed here (rankingTables.ts).
import type { Discipline, Gender, RankClass } from './rankings';
import { FIRST_SEASON } from './criteria';
import { parseSeason, rankingTable, type RankingTable, type SeasonData, type TableRow } from './rankingTables';
import { supabase } from './supabase';

export { rankingTable, seasonRanking, type RankingTable, type SeasonData, type TableRow } from './rankingTables';

/** Seasons already loaded in this visit: switching back (or opening the rankings from home) shows them at once. */
export const seasonCache = new Map<string, SeasonData>();

/** season_rankings(): everything one season's ranking needs, in one request. */
export async function loadSeason(season: string): Promise<SeasonData | null> {
  const { data: page, error } = await supabase.rpc('season_rankings', { p_season: season });
  if (error || !page) return null;
  const data = parseSeason(page);
  seasonCache.set(season, data);
  return data;
}

/** A season from this visit's cache, else from the database. */
export const seasonData = (season: string) => (seasonCache.has(season) ? Promise.resolve(seasonCache.get(season)!) : loadSeason(season));

/** A table computed in the browser (the fallback while a table isn't stored). */
export async function computedTable(season: string, rankClass: RankClass, gender: Gender, discipline: Discipline): Promise<RankingTable | null> {
  const data = await seasonData(season);
  return data && rankingTable(data, season, rankClass, gender, discipline);
}

export interface RankingPage {
  /** Seasons with ranked competitions, newest first. */
  seasons: string[];
  /** The season asked for, or the newest. */
  season: string | null;
  /** The stored table, or null when not stored (yet). */
  table: RankingTable | null;
}

/** ranking_page(): the season list and the stored table, in one request. */
export async function loadRankingPage(season: string | null, rankClass: RankClass, gender: Gender, discipline: Discipline | 'speed'): Promise<RankingPage | null> {
  const { data, error } = await supabase.rpc('ranking_page', {
    p_first_season: FIRST_SEASON, p_season: season, p_class: rankClass, p_gender: gender, p_discipline: discipline,
  });
  if (error || !data) return null;
  const d = data as { seasons?: string[] | null; season?: string | null; table?: { rows: TableRow[]; meta: RankingTable['meta'] } | null };
  return {
    seasons: d.seasons ?? [],
    season: d.season ?? null,
    table: d.table && discipline !== 'speed' ? { rank_class: rankClass, gender, discipline, rows: d.table.rows, meta: d.table.meta } : null,
  };
}

/** The top of the stored senior tables of the given seasons (home_rankings()): season → tables. Seasons without
 *  stored tables are missing from the map; null when the request failed. */
export async function loadHomeRankings(seasons: string[], top: number): Promise<Map<string, { gender: Gender; discipline: Discipline; rows: TableRow[] }[]> | null> {
  const { data, error } = await supabase.rpc('home_rankings', { p_seasons: seasons, p_top: top });
  if (error || !data) return null;
  const out = new Map<string, { gender: Gender; discipline: Discipline; rows: TableRow[] }[]>();
  for (const t of data as { season: string; gender: Gender; discipline: Discipline; rows: TableRow[] }[]) {
    if (!out.has(t.season)) out.set(t.season, []);
    out.get(t.season)!.push({ gender: t.gender, discipline: t.discipline, rows: t.rows });
  }
  return out;
}

/** Ranking points as the tables show them (whole numbers plain, else up to two decimals). */
export const fmtPoints = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0$/, ''));
