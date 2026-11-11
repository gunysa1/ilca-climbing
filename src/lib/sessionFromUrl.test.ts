import { describe, expect, it } from 'vitest';
import { acceptSessionFromUrl } from './sessionFromUrl';

const at = (path: string) => new URL(`https://staff.example${path}`);
const tokens = { access_token: 'a', refresh_token: 'r' };

describe('acceptSessionFromUrl', () => {
  it('accepts invite and recovery sessions on /set-password', () => {
    expect(acceptSessionFromUrl(at('/set-password'), { ...tokens, type: 'invite' })).toBe(true);
    expect(acceptSessionFromUrl(at('/set-password'), { ...tokens, type: 'recovery' })).toBe(true);
  });
  it('accepts the error a used or expired link returns, so the page can explain it', () => {
    expect(acceptSessionFromUrl(at('/set-password'), { error_code: 'otp_expired', error_description: 'x' })).toBe(true);
  });
  it('ignores a session in the hash of any other page', () => {
    expect(acceptSessionFromUrl(at('/'), { ...tokens, type: 'invite' })).toBe(false);
    expect(acceptSessionFromUrl(at('/judge'), { ...tokens, type: 'recovery' })).toBe(false);
  });
  it('ignores other link types and bare tokens, even on /set-password', () => {
    expect(acceptSessionFromUrl(at('/set-password'), { ...tokens, type: 'magiclink' })).toBe(false);
    expect(acceptSessionFromUrl(at('/set-password'), { ...tokens })).toBe(false);
    expect(acceptSessionFromUrl(at('/set-password'), { type: 'invite' })).toBe(false);
  });
});
