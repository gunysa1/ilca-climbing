import { describe, expect, it } from 'vitest';
import { groupErrors, type ClientErrorRow } from './clientErrors';

const row = (id: string, message: string, at: string, over: Partial<ClientErrorRow> = {}): ClientErrorRow => ({
  id, created_at: at, app: 'staff', path: '/judge', message, stack: null, build: 'b1', context: null, profile: null, ...over,
});

describe('groupErrors', () => {
  it('groups by message, newest group first, with who / page / build', () => {
    const g = groupErrors([
      row('1', 'A', '2026-10-18T10:00:00Z', { profile: { full_name: 'Dana', full_name_he: null }, stack: 'old' }),
      row('2', 'B', '2026-10-18T12:00:00Z'),
      row('3', 'A', '2026-10-18T11:00:00Z', { profile: { full_name: 'Dana', full_name_he: null }, path: '/admin', build: 'b2', stack: 'new' }),
    ]);
    expect(g.map((x) => x.message)).toEqual(['B', 'A']);
    const a = g[1];
    expect(a.count).toBe(2);
    expect(a.lastSeen).toBe('2026-10-18T11:00:00Z');
    expect(a.who).toHaveLength(1);
    expect(a.paths).toEqual(['/judge', '/admin']);
    expect(a.builds).toEqual(['b1', 'b2']);
    expect(a.stack).toBe('new');
    expect(a.ids).toEqual(['1', '3']);
  });
});
