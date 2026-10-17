// Pure helpers for the edge functions (no Deno or network), unit-tested with vitest.

/** Bearer token of the caller, or null. */
export function bearer(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Why an admin may not delete this account, or null when they may: never yourself, never the last admin. */
export function deleteRefusal(callerId: string, targetId: unknown, targetRoles: string[], adminCount: number): string | null {
  if (typeof targetId !== 'string' || !UUID.test(targetId)) return 'invalid user';
  if (targetId === callerId) return 'cannot delete your own account';
  if (targetRoles.includes('admin') && adminCount <= 1) return 'cannot delete the last admin';
  return null;
}

/** Whether the caller's x-sync-secret equals the configured secret, in time independent of where they differ.
 *  An unset or empty configured secret never matches. */
export function sameSecret(given: string | null, expected: string | undefined): boolean {
  if (!expected || given === null) return false;
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}

/** The ifsc-sync request body: `{}` (full run) or `{ athlete: <positive integer> }`. */
export function parseSyncBody(body: unknown): { athlete?: number } | { error: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid body' };
  const athlete = (body as { athlete?: unknown }).athlete;
  if (athlete === undefined) return {};
  if (typeof athlete !== 'number' || !Number.isSafeInteger(athlete) || athlete <= 0) return { error: 'invalid athlete' };
  return { athlete };
}
