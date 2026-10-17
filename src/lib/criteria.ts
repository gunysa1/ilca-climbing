import { youthBonusPoints, type IntlResult } from './rankings';

// One object per ILCA criteria document; rankings.ts takes the edition as a parameter.

/** Seasons ranked with these rules: seniors from 2023-24 (ILCA's published 23/24 senior rankings use the
 * same rules), youth from 2024-25 (earlier youth leagues were organised differently). */
export const FIRST_SEASON = '2023-24';
export const FIRST_YOUTH_SEASON = '2024-25';

export type CriteriaId = 'ilca2025' | 'ilca2027';

export interface Criteria {
  id: CriteriaId;
  /** Hebrew title of the criteria document. */
  title: string;
  /** Published document, null while not yet published. */
  url: string | null;
  /** Senior international points: per event (2025 tables 5-7) or by world ranking position. */
  seniorIntl: 'per_event' | 'world_ranking';
  worldRankingPoints(position: number): number;
  youthBonus(r: IntlResult): number;
  /** Whether U17 climbers' results in open (senior) events count. */
  u17OpenEvents: boolean;
}

export const ILCA_2025: Criteria = {
  id: 'ilca2025',
  title: 'אמות מידה לנבחרות 2025',
  url: 'https://drive.google.com/file/d/1KyP2ZN2tPtorrS13sRHVOU4TLQvyQQij/view',
  seniorIntl: 'per_event',
  worldRankingPoints: () => 0,
  youthBonus: youthBonusPoints,
  u17OpenEvents: true,
};

/** Youth bonus 2027: championship finals only, no field-size minimum. [podium (1-3), rest of final] */
const YOUTH_2027: Partial<Record<IntlResult['event_type'], [number, number]>> = {
  european_youth_championship: [60, 40],
  world_youth_championship: [100, 60],
};

export const ILCA_2027: Criteria = {
  id: 'ilca2027',
  title: 'אמות מידה לנבחרות 2027',
  url: null,
  seniorIntl: 'world_ranking',
  worldRankingPoints(position) {
    if (position < 1 || position > 40) return 0;
    return 400 - 100 * Math.floor((position - 1) / 10);
  },
  youthBonus(r) {
    if (r.event_type === 'manual') return r.for_class === 'youth' ? r.points ?? 0 : 0;
    const t = YOUTH_2027[r.event_type];
    if (!t || r.reached !== 'final' || r.place == null) return 0;
    return r.place <= 3 ? t[0] : t[1];
  },
  u17OpenEvents: false,
};

/** Seasons with an edition; `assumed` where the document of an earlier season is taken to continue. */
const SEASONS: Record<string, { criteria: Criteria; assumed: boolean }> = {
  '2023-24': { criteria: ILCA_2025, assumed: false },
  '2024-25': { criteria: ILCA_2025, assumed: false },
  '2025-26': { criteria: ILCA_2025, assumed: true },
  '2026-27': { criteria: ILCA_2027, assumed: false },
};

/** The edition for a season ('2026-27'); `assumed` when the season has no document of its own. */
export function criteriaForSeason(season: string): { criteria: Criteria; assumed: boolean } {
  const known = SEASONS[season];
  if (known) return known;
  // Unknown seasons: before the first known one the 2025 criteria, otherwise the latest edition.
  return { criteria: season < '2023-24' ? ILCA_2025 : ILCA_2027, assumed: true };
}
