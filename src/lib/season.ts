/** ILCA season of a date: September to August ("2025-26"; ILCA's own LogLig seasons), as on
 * competitions.season and in the rankings. */
export function seasonOf(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T12:00:00Z`) : date;
  const start = d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Group items by season, newest season first (items keep their order). */
export function bySeason<T>(items: T[], season: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const s = season(item);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s)!.push(item);
  }
  return [...groups].sort((a, b) => b[0].localeCompare(a[0]));
}
