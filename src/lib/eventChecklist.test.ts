import { describe, expect, it } from 'vitest';
import { checkText, fixPath, manualItemsFor, type CheckId, readTicks, writeTicks } from './eventChecklist';

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
    const item = { round_id: 'r1', category_id: 'k1', profile_id: 'p' };
    const expected: Record<CheckId, string> = {
      published: '/admin/competition/c1', category_rounds: '/admin/competition/c1', round_boulders: '/admin/competition/c1',
      first_starters: '/admin/competition/c1', starter_bibs: '/admin/competition/c1', advance_quota: '/admin/competition/c1',
      boulder_judges: '/admin/round/r1', judges_signed_in: '/admin/people', old_appeals: '/admin/round/r1',
    };
    for (const id of Object.keys(expected) as CheckId[]) expect(fixPath('c1', id, item), id).toBe(expected[id]);
    expect(fixPath('c1', 'boulder_judges')).toBe('/admin/competition/c1');
  });
  it('names boulders or routes by the competition discipline', () => {
    expect(checkText('round_boulders', 'lead')).toBe('checkRoundHasRoutes');
    expect(checkText('boulder_judges', 'lead')).toBe('checkRouteHasJudge');
    expect(checkText('round_boulders', 'boulder')).toBe('checkRoundHasBoulders');
    expect(checkText('boulder_judges', 'boulder')).toBe('checkBoulderHasJudge');
    expect(checkText('round_boulders', null)).toBe('checkRoundBoulders');
    expect(checkText('published', 'lead')).toBe('checkPublished');
    expect(manualItemsFor('boulder').some((m) => m.id === 'score_sheets')).toBe(false);
    expect(manualItemsFor('lead').some((m) => m.id === 'score_sheets')).toBe(true);
    expect(manualItemsFor(null).some((m) => m.id === 'score_sheets')).toBe(true);
  });
});
