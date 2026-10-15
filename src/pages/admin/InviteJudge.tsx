import { useState, type FormEvent } from 'react';
import { useI18n } from '../../lib/i18n';
import { supabase } from '../../lib/supabase';

type Result = { status: 'emailed' | 'existing'; email: string } | { status: 'link'; email: string; name: string; link: string };

/** Invite a judge by email or with a share link (edge function invite-judge, admins only). */
export function InviteJudge({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  async function invite(e: FormEvent, mode: 'email' | 'link') {
    e.preventDefault();
    const form = (e.target as HTMLElement).closest('form');
    if (form && !form.reportValidity()) return;
    setBusy(true); setError(null); setResult(null); setCopied(false);
    const { data, error } = await supabase.functions.invoke('invite-judge', {
      body: { email, full_name: name, mode, redirect_to: `${window.location.origin}/set-password` },
    });
    setBusy(false);
    if (error) {
      // The function's JSON error explains what failed (e.g. email sending not set up yet).
      const body = await (error as { context?: Response }).context?.json?.().catch(() => null) as { error?: string; message?: string } | null;
      return setError(body?.error === 'email_failed' ? `${t('inviteEmailFailed')} (${body.message ?? ''})` : body?.error ?? error.message);
    }
    const d = data as { status: 'emailed' | 'existing' | 'link'; link?: string };
    setResult(d.status === 'link' ? { status: 'link', email, name, link: `${window.location.origin}/invite#${encodeURIComponent(d.link!)}` } : { status: d.status, email });
    setName(''); setEmail('');
    onDone();
  }

  const shareText = (r: Extract<Result, { status: 'link' }>) => `${t('inviteShareText')} ${r.name}:\n${r.link}`;

  return (
    <div className="panel">
      <h2>{t('inviteJudge')}</h2>
      <form className="inline-form" onSubmit={(e) => void invite(e, 'email')}>
        <input placeholder={t('fullName')} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        <input type="email" placeholder={t('email')} required value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="primary" disabled={busy}>✉ {t('inviteByEmail')}</button>
        <button type="button" className="secondary" disabled={busy} onClick={(e) => void invite(e, 'link')}>🔗 {t('inviteByLink')}</button>
      </form>
      <p className="muted small">{t('inviteHint')}</p>
      {error && <p className="error">{error}</p>}
      {result?.status === 'emailed' && <p className="notice">✓ {t('inviteEmailed')} {result.email}</p>}
      {result?.status === 'existing' && <p className="notice">✓ {result.email}: {t('inviteExisting')}</p>}
      {result?.status === 'link' && (
        <div className="notice invite-link">
          <p>✓ {t('inviteLinkReady')} {result.email}</p>
          <input readOnly value={result.link} onFocus={(e) => e.target.select()} aria-label={t('inviteByLink')} />
          <div className="chips">
            <a className="chip" href={`https://wa.me/?text=${encodeURIComponent(shareText(result))}`} target="_blank" rel="noreferrer">WhatsApp</a>
            {'share' in navigator && (
              <button className="chip" onClick={() => void navigator.share({ text: shareText(result) }).catch(() => {})}>{t('share')}</button>
            )}
            <button className="chip" onClick={() => void navigator.clipboard.writeText(result.link).then(() => setCopied(true))}>
              {copied ? `✓ ${t('copied')}` : t('copy')}
            </button>
          </div>
          <p className="muted small">{t('inviteLinkHint')}</p>
        </div>
      )}
    </div>
  );
}
