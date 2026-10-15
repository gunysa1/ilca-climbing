import { useI18n } from '../lib/i18n';

/** The one-time Supabase link, carried in the hash (never sent to a server, so link previews in
 *  WhatsApp or mail scanners can't use it up). Accepts it raw or URI-encoded; only this project's
 *  Supabase verify endpoint. */
export function inviteTarget(hash: string, supabaseUrl: string): string | null {
  let raw = hash.replace(/^#/, '');
  if (/^https?%3A/i.test(raw)) { try { raw = decodeURIComponent(raw); } catch { return null; } }
  try {
    const u = new URL(raw);
    const base = new URL(supabaseUrl);
    return u.origin === base.origin && u.pathname === '/auth/v1/verify' ? u.toString() : null;
  } catch { return null; }
}

/** Landing page of a shared invite: one tap continues to Supabase, which returns to /set-password. */
export function AcceptInvite() {
  const { t } = useI18n();
  const target = inviteTarget(window.location.hash, import.meta.env.VITE_SUPABASE_URL as string);
  return (
    <div className="panel form narrow">
      <h1>{t('inviteWelcome')}</h1>
      {target
        ? <><p>{t('inviteContinueHint')}</p><a className="button primary" href={target}>{t('inviteContinue')}</a></>
        : <p className="error">{t('linkInvalid')}</p>}
    </div>
  );
}
