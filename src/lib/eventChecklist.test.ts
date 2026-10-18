import { describe, expect, it } from 'vitest';
import { fixPath, readTicks, writeTicks } from './eventChecklist';

describe('eventChecklist', () => {
  it('keeps ticks per competition and survives broken storage', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
    writeTicks('c1', ['pdf', 'power'], storage);
    expect(readTicks('c1', storage)).toEqual(['pdf', 'power']);
    expect(readTicks('c2', storage)).toEqual([]);
    data.set('ilca.checklist.c3', 'junk');
    expect(readTicks('c3', storage)).toEqual([]);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    expect(readTicks('c1', broken)).toEqual([]);
    expect(() => writeTicks('c1', ['pdf'], broken)).not.toThrow();
    expect(readTicks('c1', null)).toEqual([]);
  });
  it('links a failing check to the place that fixes it', () => {
    expect(fixPath('c1', 'round_boulders', { round_id: 'r1' })).toBe('/admin/round/r1');
    expect(fixPath('c1', 'published')).toBe('/admin/competition/c1');
    expect(fixPath('c1', 'judges_signed_in', { profile_id: 'p' })).toBe('/admin/people');
  });
});
