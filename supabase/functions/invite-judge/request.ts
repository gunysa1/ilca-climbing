// Pure request handling for invite-judge (no Deno or network), unit-tested with vitest.

export type InviteMode = 'email' | 'link';
export interface InviteRequest { email: string; full_name: string; mode: InviteMode; redirect_to: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates the JSON body: an email, a name, how to deliver, and where the link lands (an http(s) URL;
 *  Supabase Auth also checks it against the project's allowed redirect URLs). */
export function parseInvite(body: unknown): InviteRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'invalid body' };
  const b = body as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const fullName = typeof b.full_name === 'string' ? b.full_name.trim() : '';
  const mode = b.mode === 'email' || b.mode === 'link' ? b.mode : null;
  const redirect = typeof b.redirect_to === 'string' ? b.redirect_to : '';
  if (!EMAIL.test(email) || email.length > 255) return { error: 'invalid email' };
  if (!fullName || fullName.length > 120) return { error: 'invalid name' };
  if (!mode) return { error: 'invalid mode' };
  try {
    const u = new URL(redirect);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'invalid redirect' };
  } catch { return { error: 'invalid redirect' }; }
  return { email, full_name: fullName, mode, redirect_to: redirect };
}
