import { describe, expect, it } from 'vitest';
import { searchTerm } from './Search';

describe('searchTerm', () => {
  it('strips characters that would break the PostgREST filter', () => {
    expect(searchTerm('  כהן, (תמר)* ')).toBe('כהן תמר');
    expect(searchTerm('a.b:c%d')).toBe('a b c d');
  });
});
