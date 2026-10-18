// Calendar dates (starts_on, ends_on: 'YYYY-MM-DD', no time zone) shown the same everywhere. The day is
// read as a UTC date and formatted in UTC, so a phone set to another time zone shows the same day.
export function formatDate(iso: string, lang: string, options?: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', { ...options, timeZone: 'UTC' });
}
