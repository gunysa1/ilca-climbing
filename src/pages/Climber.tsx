import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DisciplineBar, useDiscipline } from '../components/DisciplineBar';
import { FavoriteStar } from '../components/FavoriteStar';
import { History } from '../components/History';
import { localized, useI18n } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import type { HistoryRow, Profile } from '../lib/types';

/** Public climber page (like the IFSC app): profile, per-discipline stats and results. */
export function Climber() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [page, setPage] = useState<{ id: string; profile: Profile | null; history: HistoryRow[] } | null>(null);
  const [discipline, setDiscipline] = useDiscipline();

  useEffect(() => {
    if (!id) return;
    // One request: public profile columns (private data lives in profile_private) and the history.
    supabase.rpc('climber_page', { p_climber: id }).then(({ data }) => {
      const d = data as { profile: Profile | null; history: HistoryRow[] } | null;
      setPage({ id, profile: d?.profile ?? null, history: (d?.history ?? []).filter((r) => r.round_status !== 'planned') });
    });
  }, [id]);

  const profile = page && page.id === id ? page.profile : undefined;
  if (profile === undefined) return <p className="muted">{t('loading')}</p>;
  if (profile === null || !id) return <p className="muted">{t('empty')}</p>;
  return (
    <section className="with-bottom-bar">
      <h1>{localized(lang, profile.full_name, profile.full_name_he)} <FavoriteStar climberId={profile.id} name={profile.full_name} /></h1>
      {profile.club && <p className="muted climber-club">{profile.club}</p>}
      <History climberId={id} discipline={discipline} rows={page!.history} />
      <DisciplineBar value={discipline} onChange={setDiscipline} />
    </section>
  );
}
