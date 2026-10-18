import { describe, expect, it } from 'vitest';
import { isMissingInDb } from './schemaMissing';

describe('isMissingInDb', () => {
  it('a missing function or table (before db push) vs. any other error', () => {
    expect(isMissingInDb({ code: 'PGRST202' })).toBe(true);
    expect(isMissingInDb({ code: 'PGRST205' })).toBe(true);
    expect(isMissingInDb({ code: '42P01' })).toBe(true);
    expect(isMissingInDb({ code: '42883' })).toBe(true);
    expect(isMissingInDb({ code: '42501' })).toBe(false);
    expect(isMissingInDb({})).toBe(false);
    expect(isMissingInDb(null)).toBe(false);
  });
});
