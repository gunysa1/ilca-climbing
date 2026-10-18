import type { MsgKey } from './i18n';
import type { RoundFormat } from './types';

export type Discipline = 'boulder' | 'lead' | 'speed';
export const DISCIPLINES: Discipline[] = ['boulder', 'lead', 'speed'];
export const DISC_LABEL: Record<Discipline, MsgKey> = { boulder: 'discBoulder', lead: 'discLead', speed: 'discSpeed' };

/** Discipline of a round from its scoring format. */
export function disciplineOfFormat(format: RoundFormat): Discipline {
  return format === 'lead' ? 'lead' : 'boulder';
}

/** Disciplines a competition covers, from all its rounds' formats (none when it has no rounds yet). */
export function disciplinesOf(formats: RoundFormat[]): Set<Discipline> {
  return new Set(formats.map(disciplineOfFormat));
}

/** A competition's disciplines: the one the admin chose (competitions.discipline), else (older rows) the
 *  rounds' formats. */
export function competitionDisciplines(discipline: Discipline | null | undefined, formats: RoundFormat[]): Set<Discipline> {
  return discipline ? new Set([discipline]) : disciplinesOf(formats);
}

/** Whether the problems are routes (lead, speed) or boulders. A round's own scoring decides; before a round
 *  exists, the competition's discipline. Speed rounds have no scoring of their own yet: always routes. */
export function climbsRoutes(discipline: Discipline | null | undefined, scoring?: RoundFormat | null): boolean {
  if (discipline === 'speed' || scoring === 'lead') return true;
  return scoring == null && discipline === 'lead';
}

/** Problem nouns: route / routes (lead, speed) or boulder / boulders. */
export const problemWord = (routes: boolean): MsgKey => (routes ? 'route' : 'boulder');
export const problemsWord = (routes: boolean): MsgKey => (routes ? 'routes' : 'boulders');

/** Scoring formats a new round may use, the first being the default. Speed: none (not built yet). */
export function roundFormatsFor(discipline: Discipline | null | undefined): RoundFormat[] {
  switch (discipline) {
    case 'lead': return ['lead'];
    case 'boulder': return ['ifsc2025', 'classic'];
    case 'speed': return [];
    default: return ['ifsc2025', 'classic', 'lead'];
  }
}
