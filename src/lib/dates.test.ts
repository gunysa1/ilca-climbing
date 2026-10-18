import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate } from './dates';

describe('formatDate', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('shows the same calendar day in a western and an eastern time zone', () => {
    for (const zone of ['America/Los_Angeles', 'Asia/Jerusalem', 'Pacific/Auckland']) {
      vi.stubEnv('TZ', zone);
      expect(formatDate('2026-10-28', 'en')).toBe('28/10/2026');
      expect(formatDate('2026-10-28T00:00:00+00:00', 'en')).toBe('28/10/2026');
      expect(formatDate('2026-10-28', 'he')).toMatch(/28\.10\.2026/);
    }
  });
  it('passes format options', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    expect(formatDate('2026-10-28', 'en', { day: 'numeric', month: 'long', year: 'numeric' })).toBe('28 October 2026');
  });
});
