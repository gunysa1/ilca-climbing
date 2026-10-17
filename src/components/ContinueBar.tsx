import { useState } from 'react';
import { Link } from 'react-router-dom';
import { lastViewedHref, readLastViewed, saveLastViewed, type LastViewed } from '../lib/lastViewed';
import { localized, useI18n } from '../lib/i18n';

/** "Continue watching": one tap back to the competition (and round) viewed last on this device. */
export function ContinueBar() {
  const { t, lang } = useI18n();
  const [last, setLast] = useState<LastViewed | null>(readLastViewed);
  if (!last) return null;
  return (
    <div className="continue-bar">
      <Link to={lastViewedHref(last)} className="continue-link">
        <span className="muted small">{t('continueWatching')}</span>
        <span className="continue-title">
          {localized(lang, last.competition, last.competition_he)}
          {last.round_kind && <> · {last.category && `${localized(lang, last.category, last.category_he)} · `}{t(last.round_kind)}</>}
        </span>
      </Link>
      <button type="button" className="link" aria-label={t('dismiss')} onClick={() => { saveLastViewed(null); setLast(null); }}>✕</button>
    </div>
  );
}
