import type { RoundFormat } from './types';

export type Discipline = 'boulder' | 'lead' | 'speed';
export const DISCIPLINES: Discipline[] = ['boulder', 'lead', 'speed'];

/** Discipline of a round from its scoring format. */
export function disciplineOfFormat(format: RoundFormat): Discipline {
  return format === 'lead' ? 'lead' : 'boulder';
}

/** Disciplines a competition covers, from all its rounds' formats (none when it has no rounds yet). */
export function disciplinesOf(formats: RoundFormat[]): Set<Discipline> {
  return new Set(formats.map(disciplineOfFormat));
}
