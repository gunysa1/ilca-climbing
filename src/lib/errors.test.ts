import { describe, expect, it } from 'vitest';
import { errorKey, errorText } from './errors';

const t = ((k: string) => `T:${k}`) as Parameters<typeof errorText>[1];

describe('errorText', () => {
  it('maps duplicate keys, permission, network, expired session and bad login', () => {
    expect(errorKey({ code: '23505', message: 'duplicate key value violates unique constraint "x"' })).toBe('errDuplicate');
    expect(errorKey({ code: '42501', message: 'new row violates row-level security policy for table "rounds"' })).toBe('errPermission');
    expect(errorKey({ message: 'permission denied for table profiles' })).toBe('errPermission');
    expect(errorKey(new TypeError('Failed to fetch'))).toBe('errNetwork');
    expect(errorKey({ name: 'AuthRetryableFetchError', message: 'x', status: 0 })).toBe('errNetwork');
    expect(errorKey({ code: 'PGRST301', message: 'JWT expired' })).toBe('errSession');
    expect(errorKey({ message: 'JWT expired' })).toBe('errSession');
    expect(errorKey({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('errBadLogin');
  });
  it('keeps the original message for everything else, and null for no error', () => {
    expect(errorText({ code: '23514', message: 'check constraint x' }, t)).toBe('check constraint x');
    expect(errorText(new Error('boom'), t)).toBe('boom');
    expect(errorText(null, t)).toBeNull();
    expect(errorText(undefined, t)).toBeNull();
    expect(errorText({ code: '23505', message: 'dup' }, t)).toBe('T:errDuplicate');
  });
});
