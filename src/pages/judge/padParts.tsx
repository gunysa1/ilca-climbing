import { type ReactNode } from 'react';
import { localized, useI18n } from '../../lib/i18n';
import { type Starter } from '../../lib/roundData';
import { type OutboxEntry } from '../../lib/saveQueue';

export interface PadNav { onLocked: () => void; nextFree: number; onGo: (index: number) => void }
export type PadLabel = NonNullable<OutboxEntry['meta']>;
export type Row = Record<string, unknown>;

/** Name, club and the state badges of the climber being judged. */
export function PadHeader({ starter, badge }: { starter: Starter; badge: ReactNode }) {
  const { lang } = useI18n();
  return (
    <div className="pad-head">
      <span className="pad-bib">#{starter.bib ?? '–'}</span>
      <div>
        <h2>{localized(lang, starter.profile.full_name, starter.profile.full_name_he)}</h2>
        <span className="muted small">{[starter.age_class, starter.profile.club].filter(Boolean).join(' · ')}</span>
      </div>
      {badge}
    </div>
  );
}

/** Read-only states: locked (next climber), or held by another judge (next free climber). */
export function PadBlocked({ locked, holder, nav }: { locked: boolean; holder: { judge_name: string } | null; nav: PadNav }) {
  const { t } = useI18n();
  if (locked) return <p className="notice">🔒 {t('resultLockedHint')}</p>;
  if (!holder) return null;
  return (
    <div className="notice claim-banner">
      ✋ {t('claimedBy')} {holder.judge_name}. {t('claimedHint')}
      <button className="primary" disabled={nav.nextFree < 0} onClick={() => nav.onGo(nav.nextFree)}>{t('nextFreeClimber')}</button>
    </div>
  );
}
