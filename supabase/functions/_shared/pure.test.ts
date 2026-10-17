import { describe, expect, it } from 'vitest';
import { bearer, deleteRefusal, parseSyncBody, sameSecret } from './pure';

const ME = '9bae8b20-b87a-422a-b916-0004543af8ba';
const OTHER = '5c6b4b23-114e-42d9-bde8-4d0eb287975f';

describe('edge function helpers', () => {
  it('reads the bearer token', () => {
    expect(bearer('Bearer abc.def')).toBe('abc.def');
    expect(bearer('Basic x')).toBeNull();
    expect(bearer(null)).toBeNull();
  });
  it('allows deleting another account', () => {
    expect(deleteRefusal(ME, OTHER, ['climber', 'judge'], 1)).toBeNull();
    expect(deleteRefusal(ME, OTHER, ['admin'], 2)).toBeNull();
  });
  it('refuses yourself, the last admin and bad ids', () => {
    expect(deleteRefusal(ME, ME, ['admin'], 2)).toBe('cannot delete your own account');
    expect(deleteRefusal(ME, OTHER, ['admin'], 1)).toBe('cannot delete the last admin');
    expect(deleteRefusal(ME, 'x', [], 1)).toBe('invalid user');
    expect(deleteRefusal(ME, undefined, [], 1)).toBe('invalid user');
  });
});

describe('ifsc-sync request', () => {
  it('accepts only the configured, non-empty secret', () => {
    expect(sameSecret('s3cret', 's3cret')).toBe(true);
    expect(sameSecret('s3cre', 's3cret')).toBe(false);
    expect(sameSecret('s3cret!', 's3cret')).toBe(false);
    expect(sameSecret('x3cret', 's3cret')).toBe(false);
    expect(sameSecret(null, 's3cret')).toBe(false);
    expect(sameSecret('', '')).toBe(false);
    expect(sameSecret('anything', undefined)).toBe(false);
  });
  it('reads the body', () => {
    expect(parseSyncBody('')).toEqual({});
    expect(parseSyncBody('  ')).toEqual({});
    expect(parseSyncBody('{}')).toEqual({});
    expect(parseSyncBody('{"athlete": 1234}')).toEqual({ athlete: 1234 });
    for (const a of ['0', '-1', '1.5', '"1234"', 'null']) expect(parseSyncBody(`{"athlete": ${a}}`)).toEqual({ error: 'invalid athlete' });
    for (const raw of ['{', 'not json', 'null', '[]', '"x"', '3']) expect(parseSyncBody(raw)).toEqual({ error: 'invalid body' });
  });
});
