import { describe, expect, it } from 'vitest';
import { inviteTarget } from './AcceptInvite';

const SB = 'https://abc.supabase.co';
const link = `${SB}/auth/v1/verify?token=t0k&type=invite&redirect_to=https://staff.example/set-password`;

describe('invite landing', () => {
  it('accepts the project verify link, raw or encoded', () => {
    expect(inviteTarget(`#${link}`, SB)).toBe(link);
    expect(inviteTarget(`#${encodeURIComponent(link)}`, SB)).toBe(link);
  });
  it('rejects anything else', () => {
    expect(inviteTarget('#https://evil.example/auth/v1/verify?token=x', SB)).toBeNull();
    expect(inviteTarget(`#${SB}/rest/v1/profiles`, SB)).toBeNull();
    expect(inviteTarget('#javascript:alert(1)', SB)).toBeNull();
    expect(inviteTarget('', SB)).toBeNull();
  });
});
