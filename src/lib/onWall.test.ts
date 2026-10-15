import { describe, expect, it } from 'vitest';
import { onWallByClimber, onWallList } from './onWall';
import type { Boulder } from './types';

const boulders = [{ id: 'b2', number: 2 }, { id: 'b1', number: 1 }, { id: 'b3', number: 3 }] as Boulder[];

describe('on the wall', () => {
  it('lists climbers in boulder order and drops unknown boulders', () => {
    const list = onWallList([{ boulder_id: 'b3', climber_id: 'c' }, { boulder_id: 'b1', climber_id: 'a' },
      { boulder_id: 'x', climber_id: 'z' }], boulders);
    expect(list.map((w) => `${w.number}:${w.climber_id}`)).toEqual(['1:a', '3:c']);
  });
  it('maps climbers to their boulders', () => {
    const m = onWallByClimber(onWallList([{ boulder_id: 'b2', climber_id: 'a' }, { boulder_id: 'b1', climber_id: 'b' }], boulders));
    expect(m.get('a')).toEqual(['b2']);
    expect(m.get('b')).toEqual(['b1']);
    expect(m.has('c')).toBe(false);
  });
});
