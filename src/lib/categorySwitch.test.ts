import { describe, expect, it } from 'vitest';
import { switchTarget } from './categorySwitch';

const r = (id: string, kind: 'qualification' | 'semifinal' | 'final', status: 'planned' | 'live' | 'closed') => ({ id, kind, status });

describe('category switch', () => {
  it('goes to the same round in the other category', () => {
    expect(switchTarget([r('q', 'qualification', 'closed'), r('s', 'semifinal', 'live')], 'semifinal')).toBe('s');
  });
  it('falls back to the latest started round', () => {
    expect(switchTarget([r('q', 'qualification', 'closed'), r('s', 'semifinal', 'live'), r('f', 'final', 'planned')], 'final')).toBe('s');
    expect(switchTarget([r('q', 'qualification', 'live')], 'semifinal')).toBe('q');
  });
  it('has nowhere to go when nothing has started', () => {
    expect(switchTarget([r('q', 'qualification', 'planned')], 'qualification')).toBeNull();
    expect(switchTarget([], 'final')).toBeNull();
  });
});
