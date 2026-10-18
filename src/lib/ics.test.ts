import { describe, expect, it } from 'vitest';
import { buildIcs, icsEscape, icsFileName, icsFold, icsUid, nextDay } from './ics';

const NOW = new Date('2026-10-18T08:30:00.123Z');

describe('ics', () => {
  it('escapes backslash, semicolon, comma and line breaks', () => {
    expect(icsEscape('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });

  it('next day crosses month and year ends', () => {
    expect(nextDay('2026-10-29')).toBe('2026-10-30');
    expect(nextDay('2026-10-31')).toBe('2026-11-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
  });

  it('builds all-day events with an exclusive end, CRLF lines and a stable UID', () => {
    const ics = buildIcs([{ id: 'abc-1', title: 'Cup; Final, 2026', starts_on: '2026-10-28', ends_on: '2026-10-29', venue: 'Tel Aviv', url: 'https://x.test/competition/abc-1' }], 'ILCA', NOW);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('UID:abc-1@ilca-climbing\r\n');
    expect(ics).toContain('DTSTAMP:20261018T083000Z\r\n');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261028\r\n');
    expect(ics).toContain('DTEND;VALUE=DATE:20261030\r\n');
    expect(ics).toContain('SUMMARY:Cup\\; Final\\, 2026\r\n');
    expect(ics).toContain('LOCATION:Tel Aviv\r\n');
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(icsUid('abc-1')).toBe('abc-1@ilca-climbing');
  });

  it('a one-day event ends the next day; a bad range is a one-day event', () => {
    expect(buildIcs([{ id: 'a', title: 't', starts_on: '2026-11-05', ends_on: '2026-11-05' }], 'x', NOW)).toContain('DTEND;VALUE=DATE:20261106');
    expect(buildIcs([{ id: 'a', title: 't', starts_on: '2026-11-05', ends_on: '2026-11-01' }], 'x', NOW)).toContain('DTEND;VALUE=DATE:20261106');
  });

  it('folds long lines at 75 octets without splitting Hebrew letters', () => {
    const line = 'SUMMARY:' + 'אליפות ישראל בטיפוס '.repeat(8);
    const parts = icsFold(line).split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
  });

  it('file names keep Hebrew and drop punctuation', () => {
    expect(icsFileName('ליגת העל / 2026-27')).toBe('ליגת-העל-2026-27.ics');
    expect(icsFileName('???')).toBe('calendar.ics');
  });
});
