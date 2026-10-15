import { describe, expect, it } from 'vitest';
import { inviteTarget } from './AcceptInvite';

const SB = 'https://abc.supabase.co';
const APP = 'https://staff.example';
const link = `${SB}/auth/v1/verify?token=t0k&type=invite&redirect_to=${encodeURIComponent(`${APP}/set-password`)}`;
const expected = `${SB}/auth/v1/verify?token=t0k&type=invite&redirect_to=${encodeURIComponent(`${APP}/set-password`)}`;

describe('invite landing', () => {
  it('accepts an invite of the project, raw or encoded', () => {
    expect(inviteTarget(`#${link}`, SB, APP)).toBe(expected);
    expect(inviteTarget(`#${encodeURIComponent(link)}`, SB, APP)).toBe(expected);
  });
  it('always returns to this app and drops anything extra', () => {
    expect(inviteTarget(`#${SB}/auth/v1/verify?token=t0k&type=invite&redirect_to=https://evil.example&x=1`, SB, APP)).toBe(expected);
  });
  it('rejects anything else', () => {
    expect(inviteTarget('#https://evil.example/auth/v1/verify?token=x&type=invite', SB, APP)).toBeNull();
    expect(inviteTarget(`#${SB}/auth/v1/verify?token=x&type=magiclink`, SB, APP)).toBeNull();
    expect(inviteTarget(`#${SB}/auth/v1/verify?type=invite`, SB, APP)).toBeNull();
    expect(inviteTarget(`#${SB}/rest/v1/profiles`, SB, APP)).toBeNull();
    expect(inviteTarget('#javascript:alert(1)', SB, APP)).toBeNull();
    expect(inviteTarget('', SB, APP)).toBeNull();
  });
});
