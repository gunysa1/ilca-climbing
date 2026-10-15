import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { supabase } from '../lib/supabase';

export function Login() {
  const { t } = useI18n();
  const { session } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  if (session) return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  // Forgot password: Supabase emails a reset link to the choose-a-password page.
  async function reset() {
    if (!email) return setError(t('enterEmailFirst'));
    setBusy(true); setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/set-password` });
    setBusy(false);
    if (error) setError(error.message); else setResetSent(true);
  }

  return (
    <form className="panel form narrow" onSubmit={submit}>
      <h1>{t('login')}</h1>
      <label>{t('email')}
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>{t('password')}
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy}>{t('login')}</button>
      {resetSent ? <p className="notice">{t('resetSent')}</p>
        : <button type="button" className="link" onClick={() => void reset()} disabled={busy}>{t('forgotPassword')}</button>}
    </form>
  );
}
