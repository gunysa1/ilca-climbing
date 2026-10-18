// Supabase / network errors as plain he/en text. The common ones are mapped; anything else keeps the
// server's own message (English), so a rare error is still readable by whoever helps.
import type { MsgKey } from './i18n';

type T = (k: MsgKey) => string;
const NETWORK = /failed to fetch|networkerror|network request failed|load failed|fetch failed|network error/i;

export function errorKey(e: unknown): MsgKey | null {
  if (!e || typeof e !== 'object') return null;
  const { code, message, name, status } = e as { code?: unknown; message?: unknown; name?: unknown; status?: unknown };
  const msg = typeof message === 'string' ? message : '';
  if (code === '23505' || /duplicate key/i.test(msg)) return 'errDuplicate';
  if (code === 'PGRST301' || code === 'PGRST303' || code === 'bad_jwt' || /jwt expired|jwt is expired/i.test(msg)) return 'errSession';
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'errPermission';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'errBadLogin';
  if (name === 'AuthRetryableFetchError' || status === 0 || NETWORK.test(msg)) return 'errNetwork';
  return null;
}

/** Text for an error: mapped to the user's language when known, else the original message. */
export function errorText(e: unknown, t: T): string | null {
  if (!e) return null;
  const key = errorKey(e);
  if (key) return t(key);
  const msg = (e as { message?: unknown }).message;
  return typeof msg === 'string' && msg ? msg : String(e);
}
