import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DisciplineBar, useDiscipline } from '../components/DisciplineBar';
import { History } from '../components/History';
import { localized, useI18n } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';

/** Public climber page (like the IFSC app): profile, per-discipline stats and results. */
export function Climber() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [discipline, setDiscipline] = useDiscipline();

  useEffect(() => {
    if (!id) return;
    // Public columns only; private data (birth date, contacts) lives in profile_private.
    supabase.from('profiles').select('id, full_name, full_name_he, club, country, gender').eq('id', id).maybeSingle()
      .then(({ data }) => setProfile((data as Profile) ?? null));
  }, [id]);

  if (profile === undefined) return <p className="muted">{t('loading')}</p>;
  if (profile === null || !id) return <p className="muted">{t('empty')}</p>;
  return (
    <section className="with-bottom-bar">
      <h1>{localized(lang, profile.full_name, profile.full_name_he)}</h1>
      {profile.club && <p className="muted climber-club">{profile.club}</p>}
      <History climberId={id} discipline={discipline} />
      <DisciplineBar value={discipline} onChange={setDiscipline} />
    </section>
  );
}
