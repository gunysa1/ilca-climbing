// One season's national ranking data (season_rankings(), one request) and the table built from it.
// Shared by the rankings page and the home page, so both show exactly the same calculation.
import { criteriaForSeason } from './criteria';
import {
  computeRanking, type Adjustment, type Discipline, type Gender, type IntlResult, type RankClass, type RankingRow, type RoundPlacing,
} from './rankings';
import { supabase } from './supabase';
import type { Profile } from './types';

export interface SeasonData {
  rounds: RoundPlacing[];
  ageClass: Map<string, RankClass>;
  tooYoung: Set<string>;
  intl: IntlResult[];
  adjustments: (Adjustment & { season: string })[];
  profiles: Map<string, Profile & { gender: Gender | null }>;
  world: { climber_id: string; discipline: string; position: number; as_of: string }[];
}

/** Seasons already loaded in this visit: switching back (or opening the rankings from home) shows them at once. */
export const seasonCache = new Map<string, SeasonData>();

/** season_rankings(): everything one season's ranking needs, in one request. */
export async function loadSeason(season: string): Promise<SeasonData | null> {
  const { data: page, error } = await supabase.rpc('season_rankings', { p_season: season });
  if (error || !page) return null;
  const d = (page ?? {}) as {
    rounds?: RoundPlacing[]; age_classes?: { climber_id: string; age_class: RankClass }[]; too_young?: string[];
    intl?: IntlResult[]; adjustments?: (Adjustment & { season: string })[]; world?: SeasonData['world'];
    profiles?: (Profile & { gender: Gender | null })[];
  };
  const data: SeasonData = {
    rounds: d.rounds ?? [],
    ageClass: new Map((d.age_classes ?? []).map((a) => [a.climber_id, a.age_class])),
    tooYoung: new Set(d.too_young ?? []),
    intl: (d.intl ?? []).map((r) => ({ ...r, points: r.points == null ? null : Number(r.points) })),
    adjustments: (d.adjustments ?? []).map((a) => ({ ...a, points: Number(a.points) })),
    profiles: new Map((d.profiles ?? []).map((p) => [p.id, p])),
    world: d.world ?? [],
  };
  seasonCache.set(season, data);
  return data;
}

/** The ranking table of one season, class, gender and discipline (criteria edition of the season). */
export function seasonRanking(data: SeasonData, season: string, rankClass: RankClass, gender: Gender, discipline: Discipline): RankingRow[] {
  const worldRank = new Map(data.world.filter((w) => w.discipline === discipline).map((w) => [w.climber_id, Number(w.position)]));
  return computeRanking({ criteria: criteriaForSeason(season).criteria, worldRank, rankClass, gender, discipline, rounds: data.rounds, ageClass: data.ageClass, tooYoung: data.tooYoung, intl: data.intl,
    adjustments: data.adjustments, climberGender: new Map([...data.profiles].map(([id, p]) => [id, p.gender])) });
}

/** Ranking points as the tables show them (whole numbers plain, else up to two decimals). */
export const fmtPoints = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0$/, ''));
