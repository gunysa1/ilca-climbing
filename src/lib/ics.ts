// iCalendar (.ics) files for competitions, built in the browser: all-day events, UTF-8, CRLF lines.
export interface IcsEvent {
  id: string;
  title: string;
  /** First and last day, 'YYYY-MM-DD' (the last day is included). */
  starts_on: string;
  ends_on: string;
  venue?: string | null;
  description?: string | null;
  url?: string | null;
}

/** Escape text values (RFC 5545 3.3.11): backslash, semicolon, comma and line breaks. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold a content line to at most 75 octets per line (continuation lines start with a space), never
 * splitting a UTF-8 character. */
export function icsFold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > 75) { out.push(cur); cur = ' '; size = 1; }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

const compact = (date: string) => date.slice(0, 10).replace(/-/g, '');

/** The day after 'YYYY-MM-DD' (the end of an all-day event is exclusive). */
export function nextDay(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Stable per competition, so adding the file again updates the event instead of duplicating it. */
export const icsUid = (id: string) => `${id}@ilca-climbing`;

const stamp = (now: Date) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

/** A calendar with one all-day event per competition. `now` is the DTSTAMP (a parameter for tests). */
export function buildIcs(events: IcsEvent[], calendarName: string, now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ILCA//ILCA Live//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calendarName)}`];
  for (const e of events) {
    const end = e.ends_on < e.starts_on ? e.starts_on : e.ends_on;
    lines.push('BEGIN:VEVENT', `UID:${icsUid(e.id)}`, `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${compact(e.starts_on)}`, `DTEND;VALUE=DATE:${compact(nextDay(end))}`,
      `SUMMARY:${icsEscape(e.title)}`);
    if (e.venue) lines.push(`LOCATION:${icsEscape(e.venue)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.url) lines.push(`URL:${e.url.replace(/[\r\n]/g, '')}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/** A file name safe on every system: letters and digits kept (Hebrew too), the rest becomes '-'. */
export function icsFileName(name: string): string {
  return `${name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'calendar'}.ics`;
}

/** Hand the file to the browser as a download. */
export function downloadIcs(ics: string, name: string) {
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = icsFileName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
