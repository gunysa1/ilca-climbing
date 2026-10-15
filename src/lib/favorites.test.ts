import { describe, expect, it } from 'vitest';
import { parseFavorites, toggleFavorite } from './favorites';

describe('favorites', () => {
  it('toggles in order of first starring', () => {
    expect(toggleFavorite(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleFavorite(['a', 'b'], 'a')).toEqual(['b']);
  });
  it('ignores corrupt storage', () => {
    expect(parseFavorites('not json')).toEqual([]);
    expect(parseFavorites('{"a":1}')).toEqual([]);
    expect(parseFavorites('["x", 3]')).toEqual(['x']);
    expect(parseFavorites(null)).toEqual([]);
  });
});
