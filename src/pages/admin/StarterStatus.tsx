import { useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { errorText } from '../../lib/errors';
import { localized, useI18n } from '../../lib/i18n';
import type { Starter, StarterStatus as Status } from '../../lib/roundData';
import { supabase } from '../../lib/supabase';

/** A starter's status in this round: climbs / DNS / DSQ. DSQ asks first. `onDone(error)` after the save. */
export function StarterStatus({ roundId, starter, onDone }: { roundId: string; starter: Starter; onDone: (error: string | null) => void }) {
  const { t, lang } = useI18n();
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = starter.status ?? '';
  async function save(status: Status) {
    setAsking(false);
    setSaving(true);
    const { error } = await supabase.from('round_starters').update({ status }).eq('round_id', roundId).eq('climber_id', starter.climber_id);
    setSaving(false);
    onDone(errorText(error, t));
  }
  return (
    <>
      <select value={current} disabled={saving} aria-label={`${t('starterStatus')}: ${starter.profile.full_name}`}
        onChange={(e) => { const v = e.target.value as Status | ''; if (v === 'dsq') setAsking(true); else void save(v || null); }}>
        <option value="">{t('statusClimbs')}</option>
        <option value="dns">{t('statusDns')}</option>
        <option value="dsq">{t('statusDsq')}</option>
      </select>
      {asking && (
        <Sheet title={t('dsqTitle')} confirm={t('dsqConfirm')} danger onConfirm={() => void save('dsq')} onCancel={() => setAsking(false)}>
          <p className="sheet-result">{localized(lang, starter.profile.full_name, starter.profile.full_name_he)}</p>
          <p>{t('dsqText')}</p>
        </Sheet>
      )}
    </>
  );
}
