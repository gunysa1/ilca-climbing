import { describe, expect, it } from 'vitest';
import { moveStarter } from './startOrder';

// Same cases as supabase/tests/rls_test.sql (move_starter): climbers 1..5 with a gapped start order 10..50.
const start = () => [1, 2, 3, 4, 5].map((i) => ({ climber_id: String(i), start_order: i * 10 }));
const order = (rows: { climber_id: string; start_order: number | null }[]) =>
  `${[...rows].sort((a, b) => a.start_order! - b.start_order!).map((r) => r.climber_id).join('')}:${[...rows].map((r) => r.start_order).sort().join('')}`;

describe('moveStarter', () => {
  it('moves to the first place; gapped orders become 1..n', () => {
    expect(order(moveStarter(start(), '3', 1))).toBe('31245:12345');
  });
  it('moves to the last place', () => {
    expect(order(moveStarter(moveStarter(start(), '3', 1), '3', 5))).toBe('12453:12345');
  });
  it('moves to a middle place', () => {
    expect(order(moveStarter(moveStarter(moveStarter(start(), '3', 1), '3', 5), '5', 2))).toBe('15243:12345');
  });
  it('a place past the end is the last, a place below 1 the first', () => {
    expect(order(moveStarter(start(), '1', 99))).toBe('23451:12345');
    expect(order(moveStarter(start(), '4', -3))).toBe('41235:12345');
  });
  it('moving to the place it holds changes nothing but the gaps', () => {
    expect(order(moveStarter(start(), '2', 2))).toBe('12345:12345');
  });
  it('a climber who is not a starter changes nothing', () => {
    const rows = start();
    expect(moveStarter(rows, 'x', 1)).toEqual(rows);
  });
  it('keeps the other fields and does not change the input', () => {
    const rows = [{ climber_id: 'a', start_order: 7, group_label: 'A' }, { climber_id: 'b', start_order: 9, group_label: 'B' }];
    const out = moveStarter(rows, 'b', 1);
    expect(out.map((r) => [r.climber_id, r.start_order, r.group_label])).toEqual([['b', 1, 'B'], ['a', 2, 'A']]);
    expect(rows[0].start_order).toBe(7);
  });
  it('starters without a start order come last, by climber id', () => {
    const rows = [{ climber_id: 'b', start_order: null }, { climber_id: 'a', start_order: null }, { climber_id: 'c', start_order: 5 }];
    expect(moveStarter(rows, 'b', 2).map((r) => r.climber_id)).toEqual(['c', 'b', 'a']);
  });
});
