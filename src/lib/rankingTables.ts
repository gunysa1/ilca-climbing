// The finished national ranking tables of one season, as the rankings page and home show them.
// Pure (no browser, no Vite): the rankings-build edge function (Deno) runs the same code server-side and stores
// its output in ranking_tables; the pages render stored tables, or compute them here when a table isn't stored
// yet. So both paths show exactly the same calculation. Imports name the .ts extension (Deno needs it).
import { criteriaForSeason, type CriteriaId } from './criteria.ts';
import {
  computeRanking, RANK_CLASSES, type Adjustment, type Discipline, type Gender, type IntlResult, type RankClass,
  type RankingRow, type RoundPlacing,
} from './rankings.ts';

/** Version of the ranking code (this file, rankings.ts, criteria.ts), stored with the tables: the pages take
 *  only tables of their own version (else they compute), and the build redoes tables of another version.
 *  Bump it with every change to the three files (rankingTables.test.ts pins their hash per version). */
export const RANKING_CODE_VERSION = 1;

export interface SeasonProfile {
  id: string;
  full_name: string;
  full_name_he: string | null;
  club: string | null;
  country: string;
  gender: Gender | null;
}

/** One season's ranking inputs (the season_rankings() payload, parsed). */
export interface SeasonData {
  rounds: RoundPlacing[];
  ageClass: Map<string, RankClass>;
  tooYoung: Set<string>;
  intl: IntlResult[];
  adjustments: (Adjustment & { season: string })[];
  profiles: Map<string, SeasonProfile>;
  world: { climber_id: string; discipline: string; position: number; as_of: string }[];
}

/** The season_rankings() / season_rankings_cache payload as parsed JSON. */
export function parseSeason(page: unknown): SeasonData {
  const d = (page ?? {}) as {
    rounds?: RoundPlacing[]; age_classes?: { climber_id: string; age_class: RankClass }[]; too_young?: string[];
    intl?: IntlResult[]; adjustments?: (Adjustment & { season: string })[]; world?: SeasonData['world'];
    profiles?: SeasonProfile[];
  };
  return {
    rounds: d.rounds ?? [],
    ageClass: new Map((d.age_classes ?? []).map((a) => [a.climber_id, a.age_class])),
    tooYoung: new Set(d.too_young ?? []),
    intl: (d.intl ?? []).map((r) => ({ ...r, points: r.points == null ? null : Number(r.points) })),
    adjustments: (d.adjustments ?? []).map((a) => ({ ...a, points: Number(a.points) })),
    profiles: new Map((d.profiles ?? []).map((p) => [p.id, p])),
    world: d.world ?? [],
  };
}

/** The ranking of one season, class, gender and discipline (criteria edition of the season). */
export function seasonRanking(data: SeasonData, season: string, rankClass: RankClass, gender: Gender, discipline: Discipline): RankingRow[] {
  const worldRank = new Map(data.world.filter((w) => w.discipline === discipline).map((w) => [w.climber_id, Number(w.position)]));
  return computeRanking({ criteria: criteriaForSeason(season).criteria, worldRank, rankClass, gender, discipline, rounds: data.rounds, ageClass: data.ageClass, tooYoung: data.tooYoung, intl: data.intl,
    adjustments: data.adjustments, climberGender: new Map([...data.profiles].map(([id, p]) => [id, p.gender])) });
}

/** A ranking row with the climber's name and club (null when the profile is not in the payload). */
export interface TableRow extends RankingRow {
  full_name: string | null;
  full_name_he: string | null;
  club: string | null;
}

/** What the page says about the table besides its rows. */
export interface TableMeta {
  criteria: CriteriaId;
  /** The season has no criteria document of its own (an earlier one is taken to continue). */
  assumed: boolean;
  /** The edition ranks seniors by world ranking, and none is loaded for the season. */
  world_missing: boolean;
  /** World ranking positions from before 1 January of the season's second year (fixed only then). */
  provisional: boolean;
}

export interface RankingTable {
  rank_class: RankClass;
  gender: Gender;
  discipline: Discipline;
  rows: TableRow[];
  meta: TableMeta;
}

/** One finished table: what the rankings page renders. */
export function rankingTable(data: SeasonData, season: string, rankClass: RankClass, gender: Gender, discipline: Discipline): RankingTable {
  const edition = criteriaForSeason(season);
  const rows = seasonRanking(data, season, rankClass, gender, discipline).map((r) => {
    const p = data.profiles.get(r.climber_id);
    return { ...r, full_name: p?.full_name ?? null, full_name_he: p?.full_name_he ?? null, club: p?.club ?? null };
  });
  // the world ranking is fixed on 1 January of the season's second year; earlier (or no) rows are provisional
  const usesWorld = edition.criteria.seniorIntl === 'world_ranking' && rankClass === 'senior';
  const worldMissing = usesWorld && data.world.length === 0;
  const provisional = usesWorld && !worldMissing && data.world.some((w) => w.as_of < `${Number(season.slice(0, 4)) + 1}-01-01`);
  return { rank_class: rankClass, gender, discipline, rows,
    meta: { criteria: edition.criteria.id, assumed: edition.assumed, world_missing: worldMissing, provisional } };
}

export const TABLE_GENDERS: Gender[] = ['male', 'female'];
export const TABLE_DISCIPLINES: Discipline[] = ['boulder', 'lead'];

/** Every table of a season (class × gender × discipline), as ranking_tables stores them. */
export function seasonTables(data: SeasonData, season: string): RankingTable[] {
  return RANK_CLASSES.flatMap((c) => TABLE_GENDERS.flatMap((g) => TABLE_DISCIPLINES.map((d) => rankingTable(data, season, c, g, d))));
}
