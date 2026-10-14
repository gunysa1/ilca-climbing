import { useEffect, useState } from 'react';
import { CoachNotes } from '../components/CoachNotes';
import { History } from '../components/History';
import { useAuth } from '../lib/auth';
import { localized, useI18n } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';

export function Coach() {
  const { t, lang } = useI18n();
  const { profileId } = useAuth();
  const [athletes, setAthletes] = useState<Profile[] | null>(null);
  const [selected, setSelected] = useState<Profile | null>(null);

  useEffect(() => {
    if (!profileId) return;
    supabase.from('coach_athletes').select('climber:profiles!coach_athletes_climber_id_fkey(id, full_name, full_name_he, club, country)')
      .eq('coach_id', profileId)
      .then(({ data }) => {
        const list = ((data ?? []) as unknown as { climber: Profile }[]).map((r) => r.climber);
        setAthletes(list);
        setSelected((s) => s ?? list[0] ?? null);
      });
  }, [profileId]);

  return (
    <section>
      <h1>{t('myAthletes')}</h1>
      {athletes === null && <p className="muted">{t('loading')}</p>}
      {athletes?.length === 0 && <p className="muted">{t('empty')}</p>}
      <div className="chips">
        {athletes?.map((a) => (
          <button key={a.id} className={`chip ${selected?.id === a.id ? 'selected' : ''}`} onClick={() => setSelected(a)}>
            {localized(lang, a.full_name, a.full_name_he)}
          </button>
        ))}
      </div>
      {selected && (
        <>
          <h2>{localized(lang, selected.full_name, selected.full_name_he)}</h2>
          <History climberId={selected.id} />
          <CoachNotes climberId={selected.id} canWrite />
        </>
      )}
    </section>
  );
}
