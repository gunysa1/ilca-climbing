import { describe, expect, it } from 'vitest';
import { bySeason, seasonOf } from './season';

describe('seasons', () => {
  it('run September to August, like ILCA\'s LogLig seasons', () => {
    expect(['2025-08-31', '2025-09-01', '2025-10-20', '2026-02-17', '2026-07-01', '2026-10-15'].map(seasonOf))
      .toEqual(['2024-25', '2025-26', '2025-26', '2025-26', '2025-26', '2026-27']);
    expect(seasonOf('2099-12-01')).toBe('2099-00');
  });
  it('groups newest season first, keeping order inside a season', () => {
    const items = ['2025-10-20', '2026-10-15', '2026-02-17', '2024-12-04'];
    expect(bySeason(items, seasonOf)).toEqual([
      ['2026-27', ['2026-10-15']], ['2025-26', ['2025-10-20', '2026-02-17']], ['2024-25', ['2024-12-04']],
    ]);
  });
});
