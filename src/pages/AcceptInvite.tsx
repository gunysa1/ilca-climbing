import { useI18n } from '../lib/i18n';

/** The one-time Supabase link, carried in the hash (never sent to a server, so link previews in
 *  WhatsApp or mail scanners can't use it up). Accepts it raw or URI-encoded, but only an invite of
 *  this project, and rebuilds it with just its token and our own /set-password as the return page,
 *  so this trusted page can't be used to pass on other links (e.g. someone else's sign-in link). */
export function inviteTarget(hash: string, supabaseUrl: string, appOrigin: string): string | null {
  let raw = hash.replace(/^#/, '');
  if (/^https?%3A/i.test(raw)) { try { raw = decodeURIComponent(raw); } catch { return null; } }
  try {
    const u = new URL(raw);
    const base = new URL(supabaseUrl);
    const token = u.searchParams.get('token');
    if (u.origin !== base.origin || u.pathname !== '/auth/v1/verify' || u.searchParams.get('type') !== 'invite' || !token) return null;
    const out = new URL('/auth/v1/verify', base);
    out.searchParams.set('token', token);
    out.searchParams.set('type', 'invite');
    out.searchParams.set('redirect_to', `${appOrigin}/set-password`);
    return out.toString();
  } catch { return null; }
}

/** ILCA's logo (white, from ilca.org.il) on the staff header's navy: invite and password pages. */
export function IlcaBanner() {
  return <div className="ilca-banner"><img src="/ilca-logo.png" alt="התאחדות הטיפוס בישראל" width={208} height={90} /></div>;
}

/** Landing page of a shared invite: one tap continues to Supabase, which returns to /set-password. */
export function AcceptInvite() {
  const { t } = useI18n();
  const target = inviteTarget(window.location.hash, import.meta.env.VITE_SUPABASE_URL as string, window.location.origin);
  return (
    <div className="panel form narrow">
      <IlcaBanner />
      <h1>{t('inviteWelcome')}</h1>
      {target
        ? <><p>{t('inviteContinueHint')}</p><a className="button primary" href={target}>{t('inviteContinue')}</a></>
        : <p className="error">{t('linkInvalid')}</p>}
    </div>
  );
}
