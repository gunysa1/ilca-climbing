// Categories the national rankings skip: the rankings count male and female categories only
// (rankings.ts keeps rows of the table's gender), so a "mixed" category of a ranked competition never
// scores. The roster import gives a new category "mixed" when its rows have no gender (or both), so the
// admin competition page warns about them. Pure; no ranking change.
import { FIRST_SEASON } from './criteria';
import type { Category, Competition } from './types';

/** The competition feeds a national ranking: a ranked series in a ranked season (as on the climber page). */
export const isRankedCompetition = (c: Pick<Competition, 'series' | 'season'>) =>
  c.series !== 'other' && c.season != null && c.season >= FIRST_SEASON;

/** The mixed-gender categories of a ranked competition (none for an unranked one), in the order given. */
export function uncountedCategories<C extends Pick<Category, 'gender'>>(comp: Pick<Competition, 'series' | 'season'>, cats: C[]): C[] {
  return isRankedCompetition(comp) ? cats.filter((c) => c.gender === 'mixed') : [];
}
