import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { IlcaBanner } from './AcceptInvite';
import { useI18n } from '../lib/i18n';
import { supabase } from '../lib/supabase';

export const MIN_PASSWORD = 8;

/** Choose a password: the landing page of an invite or password-reset link (session from the URL). */
export function SetPassword() {
  const { t } = useI18n();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [linkError] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('error_code'));
  const [waited, setWaited] = useState(false);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // supabase-js reads the session from the link's hash right after load.
  useEffect(() => { const h = setTimeout(() => setWaited(true), 3000); return () => clearTimeout(h); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(t('passwordTooShort'));
    if (password !== again) return setError(t('passwordsDiffer'));
    setBusy(true); setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    navigate('/', { replace: true });
  }

  if (!session) {
    if (!linkError && !waited) return <p className="muted">{t('loading')}</p>;
    return (
      <div className="panel form narrow">
        <IlcaBanner />
        <h1>{t('setPassword')}</h1>
        <p className="error">{t('linkInvalid')}</p>
        <Link to="/login">{t('login')}</Link>
      </div>
    );
  }
  return (
    <form className="panel form narrow" onSubmit={submit}>
      <IlcaBanner />
      <h1>{t('setPassword')}</h1>
      <p className="muted small">{session.user.email}</p>
      <label>{t('newPassword')}
        <input type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label>{t('repeatPassword')}
        <input type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy}>{t('savePassword')}</button>
    </form>
  );
}
