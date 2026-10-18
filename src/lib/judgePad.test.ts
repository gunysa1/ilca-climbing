import { describe, expect, it } from 'vitest';
import { padIndex, pickPadPage } from './judgePad';

describe('judge pad', () => {
  it('stays on the same climber when the start list changes under it', () => {
    expect(padIndex(['a', 'b', 'c'], { id: 'b', at: 1 })).toBe(1);
    expect(padIndex(['c', 'a', 'b'], { id: 'b', at: 1 })).toBe(2);  // regenerated: same climber, new place
    expect(padIndex(['a', 'c'], { id: 'b', at: 1 })).toBe(1);       // gone: the same place
    expect(padIndex(['a'], { id: 'b', at: 3 })).toBe(0);            // gone, list shorter: the last one
    expect(padIndex(['a', 'b'], null)).toBeNull();
    expect(padIndex([], { id: 'b', at: 0 })).toBeNull();
  });

  it('first load: the copy on the phone only when the server could not be reached', () => {
    expect(pickPadPage({ page: 'fresh', reachable: true }, 'kept')).toEqual({ page: 'fresh', offline: false });
    expect(pickPadPage({ page: null, reachable: true }, 'kept')).toEqual({ page: null, offline: false }); // refused / gone
    expect(pickPadPage({ page: null, reachable: false }, 'kept')).toEqual({ page: 'kept', offline: true });
    expect(pickPadPage({ page: null, reachable: false }, undefined)).toEqual({ page: null, offline: false });
  });
});
