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
