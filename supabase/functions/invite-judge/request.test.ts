import { describe, expect, it } from 'vitest';
import { bearer, parseInvite } from './request';

const ok = { email: ' Judge@Example.com ', full_name: ' Dana Levi ', mode: 'link', redirect_to: 'https://staff.example/set-password' };

describe('invite-judge request', () => {
  it('normalises a valid request', () => {
    expect(parseInvite(ok)).toEqual({ email: 'judge@example.com', full_name: 'Dana Levi', mode: 'link',
      redirect_to: 'https://staff.example/set-password' });
  });
  it('rejects bad input', () => {
    expect(parseInvite(null)).toEqual({ error: 'invalid body' });
    expect(parseInvite({ ...ok, email: 'nope' })).toEqual({ error: 'invalid email' });
    expect(parseInvite({ ...ok, full_name: '  ' })).toEqual({ error: 'invalid name' });
    expect(parseInvite({ ...ok, mode: 'sms' })).toEqual({ error: 'invalid mode' });
    expect(parseInvite({ ...ok, redirect_to: 'javascript:alert(1)' })).toEqual({ error: 'invalid redirect' });
    expect(parseInvite({ ...ok, redirect_to: 'not a url' })).toEqual({ error: 'invalid redirect' });
  });
  it('reads the bearer token', () => {
    expect(bearer('Bearer abc.def')).toBe('abc.def');
    expect(bearer('Basic x')).toBeNull();
    expect(bearer(null)).toBeNull();
  });
});
